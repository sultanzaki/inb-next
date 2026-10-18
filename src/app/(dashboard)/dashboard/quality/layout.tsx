import { QualityGate } from "@/components/erp/quality-gate";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <QualityGate>{children}</QualityGate>;
}
