import type { NextConfig } from 'next';

// Static export: every page is client-rendered against Firebase, so the build
// is plain HTML/JS in `out/`, served by Firebase Hosting on the free plan.
const nextConfig: NextConfig = {
  output: 'export',
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
