"use server";
import type { HasilUjiItem } from "@/lib/types";
import { mutate } from "./mutate";
import { inspectionSchema, draftSchema, uuid } from "@/lib/domain/validation";
export type { ActionResult } from "./mutate";
export interface SaveInspeksiPayload {
  /** Ada => edit hasil uji yang sudah ada; null/undefined => hasil uji baru. */
  id?: string | null;
  draft_id?: string | null;
  failure_reason?: string;
  id_produk: string;
  no_lot: string;
  tgl_sampling: string;
  tgl_uji: string;
  inspector: string;
  catatan: string;
  status: "PASS" | "FAIL";
  hasil_detail: HasilUjiItem[];
}

export async function saveInspeksiAction(payload: SaveInspeksiPayload) {
  return mutate(
    payload?.id ? "update_uji" : "create_uji",
    payload,
    inspectionSchema,
  );
}
export async function deleteInspeksiAction(id: string) {
  return mutate(
    "delete_uji",
    id,
    uuid.transform((id) => ({ id })),
  );
}

export async function saveDraftAction(payload: unknown) {
  return mutate("save_draft", payload, draftSchema);
}
export async function deleteDraftAction(id: string) {
  return mutate(
    "delete_draft",
    id,
    uuid.transform((id) => ({ id })),
  );
}
