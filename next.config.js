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
  poweredByHeader: false,

  // Suppress verbose request logs in development
  logging: {
    fetches: {
      fullUrl: false,
    },
  },

  /**
   * The money page is /business-os/orders now.
   *
   * The old path is in the wild — in chat replies the assistant has already
   * sent, in the CRM drawer's deep links, in bookmarks, and in the URL the
   * Stripe Connect callback returns people to. Next carries the query string
   * across, which matters because those links arrive carrying `?invoice=`,
   * `?transaction=` or `?action=create`.
   *
   * Temporary rather than permanent: a 308 is cached by the browser forever,
   * and that is a hard thing to take back if the name changes again.
   */
  async redirects() {
    return [
      {
        source: '/business-os/payments',
        destination: '/business-os/orders',
        permanent: false,
      },
    ];
  },
}

module.exports = nextConfig