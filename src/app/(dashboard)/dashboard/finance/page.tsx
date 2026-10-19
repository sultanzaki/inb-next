import { Suspense } from "react";
import { OperationalWorkspace } from "@/components/erp/workflows/workspace";
export default function Page(){return <Suspense fallback={<p>Preparing workspace…</p>}><OperationalWorkspace area="finance"/></Suspense>;}
