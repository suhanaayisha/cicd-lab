import express from 'express';
import path from 'node:path';

const app = express();

// src/ and dist/ both sit one level below the project root.
app.use(express.static(path.join(import.meta.dirname, '..', 'public')));

app.get('/', (_request, response) => {
  response.type('html').send(`
    <iframe src="/document.pdf" title="Document" width="100%" height="800"></iframe>
  `);
});

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
  });
});

app.get('/api/version', (_request, response) => {
  response.json({
    version: process.env.APP_VERSION ?? 'development',
  });
});

export default app;
