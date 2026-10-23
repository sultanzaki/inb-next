import type { Metadata } from "next";
import {Suspense} from "react";
import {OperationsWorkspace} from "@/components/operations/workspace";
export const metadata: Metadata = {title: {absolute: "Material inventory | INBIONUSA"}};
export default function Page(){return <Suspense fallback={<p role="status">Preparing workspace…</p>}><OperationsWorkspace entity="material_inventory"/></Suspense>;}
