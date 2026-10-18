import { Suspense } from "react";
import { GrowthWorkspace } from "@/components/erp/growth-workspace";
export default function Page() {
  return (
    <Suspense fallback={<p>Preparing workspace…</p>}>
      <GrowthWorkspace area="crm" />
    </Suspense>
  );
}
