// lib/ai/pricingCacheTtl.ts
//
// How long a serverless instance keeps the price rows it read: the token rows in
// `lib/ai/pricing.ts` and the image rows in `lib/ai/imagePricing.ts`.
//
// A module of its own so that both caches share ONE number without an import
// cycle (`pricing.ts` imports `imagePricing.ts`, so `imagePricing.ts` must never
// import `pricing.ts`; AI model price review slice 7, SA RC7-3). Each instance
// refreshes on its own, so a changed price is in effect on all servers within
// this window (requirement finding 4).

/** One hour. */
export const PRICING_CACHE_TTL_MS = 60 * 60 * 1000;
