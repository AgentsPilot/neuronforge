/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NANGO_PUBLIC_KEY: process.env.NANGO_PUBLIC_KEY,
    NANGO_SECRET_KEY: process.env.NANGO_SECRET_KEY,
  },
  // Add these for proper Vercel function detection
  experimental: {
    serverComponentsExternalPackages: ['bullmq', 'ioredis'],
  },
  // Ensure proper API route compilation
  output: 'standalone',
  poweredByHeader: false,
}

module.exports = nextConfig