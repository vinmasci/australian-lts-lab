import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  assetPrefix: process.env.NODE_ENV === 'production' ? 'https://australian-lts-lab.vercel.app' : undefined,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
