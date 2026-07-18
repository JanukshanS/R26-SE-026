import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "export",
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: path.join(appDir, "../.."),
  },
};

export default nextConfig;
