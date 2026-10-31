import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The website proxy needs absolute assets in production; previews must use their own build.
  assetPrefix: process.env.VERCEL_ENV === 'production' ? 'https://australian-lts-lab.vercel.app' : undefined,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
