/** @type {import('next').NextConfig} */
const extraAllowedOrigins = (process.env.NEXT_SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const devAllowedOrigins = [
  "localhost:3000",
  "127.0.0.1:3000",
  "*.app.github.dev",
  "**.app.github.dev",
  "*.preview.app.github.dev",
  "**.preview.app.github.dev",
  "*.githubpreview.dev",
  "**.githubpreview.dev",
  "*.devtunnels.ms",
  "**.devtunnels.ms",
  ...extraAllowedOrigins,
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      allowedOrigins: devAllowedOrigins,
    },
  },
};

module.exports = nextConfig;
