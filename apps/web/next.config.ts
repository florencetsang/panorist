import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared workspace package ships TypeScript source.
  transpilePackages: ['@panorist/core'],
};

export default config;
