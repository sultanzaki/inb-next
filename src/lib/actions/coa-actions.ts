"use server";
import { mutate } from "./mutate";
import { issueSchema, updateCoaSchema, uuid } from "@/lib/domain/validation";
export type { ActionResult } from "./mutate";
export interface IssueCoaPayload {
  id_hasil: string;
  /** Kosong => nomor diturunkan otomatis dari max-seq server. */
  no_coa: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  mfg_date: string;
  tanda_tangan: string;
}

/** Payload untuk mengubah COA yang sudah ada. */
export interface UpdateCoaPayload {
  id: string;
  no_coa: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  mfg_date: string;
  tanda_tangan: string;
}


export async function issueCoaAction(payload: IssueCoaPayload) {
 return mutate("issue_coa", payload, issueSchema);
}
export async function updateCoaAction(payload: UpdateCoaPayload) {
 return mutate("update_coa", payload, updateCoaSchema);
}
export async function deleteCoaAction(id: string) {
 return mutate("delete_coa", id, uuid.transform(id => ({ id })));
}
