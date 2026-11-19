import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared workspace package ships TypeScript source.
  transpilePackages: ['@panorist/core'],
  // Dev server only: let a phone load pages (e.g. /mobile/sign-in) through the
  // LAN address or an HTTPS tunnel. Next blocks its dev scripts for other hosts.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '*.trycloudflare.com', '*.ngrok-free.app'],
};

export default config;
