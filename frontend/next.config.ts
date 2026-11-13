import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A static site (frontend/out) that the backend serves, in the desktop app and in Docker.
  output: 'export',
  // Each page becomes <page>/index.html, so the backend can serve /data/ and the like.
  trailingSlash: true,
  // A static site has no server to resize images, so images are used as they are.
  images: { unoptimized: true },
};

export default nextConfig;
