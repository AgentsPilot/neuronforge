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

  /*
   * PDF FONT METRICS HAVE TO BE COPIED INTO THE SERVERLESS BUNDLE.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `@react-pdf/renderer` renders through pdfkit, and pdfkit loads the metrics
   * for the fourteen standard PDF fonts with a RUNTIME require built from a
   * string — `.../standard-fonts/Helvetica.cjs` and its siblings. Next traces
   * static imports to decide what to ship; a path assembled at runtime is
   * invisible to it, so those files were left out of the deployed function and
   * every render died with
   *
   *   Cannot find module '/var/task/node_modules/pdfkit/js/standard-fonts/Helvetica.cjs'
   *
   * `/var/task` is the Lambda root: the code was there, the font data was not.
   *
   * IT IS NOT A HEBREW PROBLEM, despite surfacing on a Hebrew invoice. pdfkit
   * initialises with Helvetica whatever font the document then asks for, so
   * EVERY invoice PDF failed — the Hebrew one simply happened to be the one on
   * the hourly abandoned-invoice cron, which is why it was the one that showed
   * up in the logs, once an hour, for as long as it has been deployed.
   *
   * The data directories of all three pdfkit copies in the tree are included,
   * because which one resolves depends on hoisting and has already differed
   * between this machine and the deployment.
   * ───────────────────────────────────────────────────────────────────────────
   */
  experimental: {
    outputFileTracingIncludes: {
      '/api/**/*': [
        './node_modules/pdfkit/js/**/*',
        './node_modules/@react-pdf/pdfkit/**/*',
        './node_modules/pdfmake-rtl/node_modules/pdfkit/js/**/*',
        './node_modules/fontkit/**/*',
      ],
    },
  },

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