import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@notelm/db", "@notelm/core"],
};

export default nextConfig;
