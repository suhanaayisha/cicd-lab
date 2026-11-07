export type StorageConfig =
  | { driver: 'local'; dir: string }
  | { driver: 'memory' }
  | {
      driver: 'r2';
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
    };

export interface Config {
  port: number;
  appVersion: string;
  /** Public base URL used in QR codes, e.g. https://menus.example.com. Derived from the request when unset. */
  publicUrl: string | undefined;
  mongodbUri: string;
  mongodbDb: string;
  storage: StorageConfig;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const driver = env.STORAGE_DRIVER ?? 'local';
  let storage: StorageConfig;

  if (driver === 'r2') {
    storage = {
      driver,
      accountId: required(env, 'R2_ACCOUNT_ID'),
      accessKeyId: required(env, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY'),
      bucket: required(env, 'R2_BUCKET'),
    };
  } else if (driver === 'local') {
    storage = { driver, dir: env.LOCAL_STORAGE_DIR ?? 'uploads' };
  } else if (driver === 'memory') {
    storage = { driver };
  } else {
    throw new Error(`Unknown STORAGE_DRIVER "${driver}" (expected local, memory or r2)`);
  }

  return {
    port: Number.parseInt(env.PORT ?? '3000', 10),
    // On Render, fall back to the deployed commit so /api/version shows exactly what is live.
    appVersion: env.APP_VERSION ?? env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'development',
    publicUrl: env.PUBLIC_URL?.replace(/\/+$/, '') || undefined,
    mongodbUri: env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017',
    mongodbDb: env.MONGODB_DB ?? 'menus',
    storage,
  };
}
