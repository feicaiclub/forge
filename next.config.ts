import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  compress: false, // Disable gzip — local Electron app doesn't need compression, and it buffers SSE streams
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['better-sqlite3', '@larksuiteoapi/node-sdk'],
}

export default nextConfig
