/** @type {import('next').NextConfig} */
// CLOUD-owned (TEAM-LOCK). Minimal config for Amplify WEB_COMPUTE (SSR).
// NEXT_PUBLIC_ASSET_PREFIX: opt-in prefix for viewing the dev server behind the
// workshop /ports/<n>/ proxy. The proxy STRIPS the /ports/<n> prefix before
// forwarding, so the page is still served at "/" (no basePath) — we only need
// assetPrefix so the browser requests /_next/* assets under the proxied path.
// Unset in Amplify → production config unchanged.
const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;
const nextConfig = assetPrefix ? { assetPrefix } : {};

export default nextConfig;
