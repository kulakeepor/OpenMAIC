import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['postgres'],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
