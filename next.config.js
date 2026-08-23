/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath: process.env.GITHUB_ACTIONS ? "/OTA-App" : "",
  assetPrefix: process.env.GITHUB_ACTIONS ? "/OTA-App/" : undefined,
  // Keep production validation/build artifacts isolated from a running dev
  // server. Sharing `.next` lets webpack runtimes reference chunks from the
  // other mode (for example, the intermittent missing `819.js` error).
  distDir: process.env.NODE_ENV === "production"
    ? (process.env.GITHUB_ACTIONS ? "out" : ".next-prod")
    : ".next",
};

module.exports = nextConfig;
