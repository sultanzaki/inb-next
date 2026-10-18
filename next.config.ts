import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/erp/**": [
      "./src/assets/fonts/**/*",
      "./src/assets/coa/**/*",
      "./public/logo.png",
    ],
    "/api/coa/**": ["./src/assets/coa/**/*"],
    "/dashboard/quality/certificates": ["./src/assets/coa/**/*"],
  },
  redirects: async () => [
    {
      source: "/dashboard/produk",
      destination: "/dashboard/master-data/products",
      permanent: true,
    },
    {
      source: "/dashboard/inspeksi",
      destination: "/dashboard/quality/inspections",
      permanent: true,
    },
    {
      source: "/dashboard/coa",
      destination: "/dashboard/quality/certificates",
      permanent: true,
    },
    {
      source: "/dashboard/pengguna",
      destination: "/dashboard/admin/users",
      permanent: true,
    },
    {
      source: "/dashboard/audit",
      destination: "/dashboard/admin/audit-log",
      permanent: true,
    },
    {
      source: "/dashboard/settings",
      destination: "/dashboard/admin/settings",
      permanent: true,
    },
    {
      source: "/dashboard/materials",
      destination: "/dashboard/warehouse/materials",
      permanent: true,
    },
    {
      source: "/dashboard/documents",
      destination: "/dashboard/product-documents",
      permanent: true,
    },
    {
      source: "/dashboard/work",
      destination: "/dashboard/workspaces",
      permanent: true,
    },
    {
      source: "/dashboard/arsip",
      destination: "/dashboard/product-documents",
      permanent: true,
    },
  ],
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
