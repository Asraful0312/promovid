import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep Remotion renderer/bundler in Node.js runtime only (they use native modules)
  serverExternalPackages: [
    '@remotion/renderer',
    '@remotion/bundler',
    '@remotion/compositor-darwin-arm64',
    '@remotion/compositor-darwin-x64',
    '@remotion/compositor-linux-arm64-gnu',
    '@remotion/compositor-linux-x64-gnu',
    '@remotion/compositor-linux-x64-musl',
  ],
};

export default nextConfig;
