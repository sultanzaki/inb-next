import type { Metadata } from "next";
export const metadata: Metadata = {
  title: { absolute: "Production | INBIONUSA" },
  description:
    "Production in the INBIONUSA operations workspace for PT Inovasi Biokem Nusantara.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
