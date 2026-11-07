import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Menu PDFs can be up to 25 MB; leave room for multipart form overhead.
      bodySizeLimit: '26mb',
    },
  },
};

export default nextConfig;
