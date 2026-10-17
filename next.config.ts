import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/erp/**": [
      "./src/assets/fonts/**/*",
      "./src/assets/coa/**/*",
      "./public/logo.png",
    ],
    "/api/coa/**": ["./src/assets/coa/**/*"],
    "/dashboard/coa": ["./src/assets/coa/**/*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
