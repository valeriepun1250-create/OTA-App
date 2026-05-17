/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      allowedOrigins: [
        "*.app.github.dev",
        "*.githubpreview.dev",
        "*.preview.app.github.dev",
      ],
    },
  },
};

module.exports = nextConfig;
