import path from "path";
import type { NextConfig } from "next";

const sharedPackage = path.join(__dirname, "../../packages/shared");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@flux/shared"],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@flux/shared": path.join(sharedPackage, "dist"),
    };
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
