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
    NANGO_SECRET_KEY: process.env.NANGO_SECRET_KEY, // Optional, only if needed
  },
}

module.exports = nextConfig