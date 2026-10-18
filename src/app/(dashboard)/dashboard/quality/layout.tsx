import type { Metadata } from "next";
export const metadata: Metadata = {
  title: { absolute: "Quality overview | INBIONUSA" },
  description:
    "Quality overview in the INBIONUSA operations workspace for PT Inovasi Biokem Nusantara.",
};
import { QualityGate } from "@/components/erp/quality-gate";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <QualityGate>{children}</QualityGate>;
}
