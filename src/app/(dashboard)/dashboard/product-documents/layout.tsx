import type { Metadata } from "next";
export const metadata: Metadata = {
  title: { absolute: "Product documents | INBIONUSA" },
  description:
    "Product documents in the INBIONUSA operations workspace for PT Inovasi Biokem Nusantara.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
