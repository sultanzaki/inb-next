"use server";
import { mutate } from "./mutate";
import { documentSchema, uuid } from "@/lib/domain/validation";
export type { ActionResult } from "./mutate";
export interface UploadDokumenPayload {
  judul_dokumen: string;
  kategori: string;
  tanggal_berlaku: string;
  masa_kadaluarsa: string;
  link_drive: string;
}


export async function uploadDokumenAction(payload: UploadDokumenPayload) {
 return mutate("create_doc", payload, documentSchema);
}
export async function deleteDokumenAction(id: string) {
 return mutate("delete_doc", id, uuid.transform(id => ({ id })));
}
