/** @type {import('next').NextConfig} */
const apiBaseUrl = process.env.PLATFORM_API_BASE_URL || "http://127.0.0.1:8000";

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/api/:path*`
      },
      {
        source: "/storage/:path*",
        destination: `${apiBaseUrl}/storage/:path*`
      }
    ];
  }
};

export default nextConfig;
