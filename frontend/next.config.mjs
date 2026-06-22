/** @type {import('next').NextConfig} */
// CLOUD-owned (TEAM-LOCK). Minimal config for Amplify WEB_COMPUTE (SSR).
// NEXT_PUBLIC_ASSET_PREFIX: opt-in prefix for viewing the dev server behind the
// workshop /ports/<n>/ proxy. The proxy STRIPS the /ports/<n> prefix before
// forwarding, so the page is still served at "/" (no basePath) — we only need
// assetPrefix so the browser requests /_next/* assets under the proxied path.
// Unset in Amplify → production config unchanged.
const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;
const nextConfig = assetPrefix ? { assetPrefix } : {};

// Next 15.5+ blocks cross-origin /_next/* dev requests unless the origin is
// allow-listed. Behind the workshop proxy the page is served from a *.cloudfront.net
// host while the dev server runs on localhost, so the asset fetches are cross-origin.
// Allow the proxy origin(s) in dev only (no effect on the Amplify production build).
// NEXT_PUBLIC_DEV_ORIGIN can override the host; defaults cover *.cloudfront.net.
if (assetPrefix) {
  nextConfig.allowedDevOrigins = [
    '*.cloudfront.net',
    ...(process.env.NEXT_PUBLIC_DEV_ORIGIN ? [process.env.NEXT_PUBLIC_DEV_ORIGIN] : []),
  ];
}

export default nextConfig;
