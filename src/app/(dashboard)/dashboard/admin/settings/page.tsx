import { ERPWorkspace } from "@/components/erp/workspace";
import { Suspense } from "react";
export default function Page() {
  return (
    <Suspense fallback={<p>Preparing workspace…</p>}>
      <ERPWorkspace area="settings" />
    </Suspense>
  );
}
