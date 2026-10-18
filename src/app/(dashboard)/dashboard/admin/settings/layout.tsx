import type { Metadata } from "next";
export const metadata: Metadata = {
  title: { absolute: "Workspace settings | INBIONUSA" },
  description:
    "Workspace settings in the INBIONUSA operations workspace for PT Inovasi Biokem Nusantara.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
