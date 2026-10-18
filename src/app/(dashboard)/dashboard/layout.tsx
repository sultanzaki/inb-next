import type { Metadata } from "next";
export const metadata: Metadata = {
  title: { absolute: "Overview | INBIONUSA" },
  description:
    "Overview in the INBIONUSA operations workspace for PT Inovasi Biokem Nusantara.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
