"use server";
import { requireUser } from "@/lib/auth";
import { canAction, type COA } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCoaSource, verifyPreviewProof } from "@/lib/pdf/coa-source";
import { renderCoaPdf } from "@/lib/pdf/coa-document";
import { mutate } from "./mutate";
import { z } from "zod";
import { issueSchema, updateCoaSchema, uuid } from "@/lib/domain/validation";
export type { ActionResult } from "./mutate";
export interface IssueCoaPayload {
  preview_token?: string;
  id_hasil: string;
  /** Kosong => nomor diturunkan otomatis dari max-seq server. */
  no_coa: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  mfg_date: string;
  tanda_tangan: string;
  language?: "id" | "en";
  inci_name?: string;
  compliance_statement?: string;
  delivery_date?: string;
}

/** Payload untuk mengubah COA yang sudah ada. */
export interface UpdateCoaPayload {
  id: string;
  no_coa: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  mfg_date: string;
  tanda_tangan: string;
  language?: "id" | "en";
  inci_name?: string;
  compliance_statement?: string;
  delivery_date?: string;
}

export async function issueCoaAction(payload: IssueCoaPayload) {
  const session = await requireUser();
  if (!session || !canAction(session.user.role, "issue_coa"))
    return { ok: false, error: "Akses tidak diizinkan." };
  const parsed = issueSchema.safeParse(payload);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };
  try {
    const source = await loadCoaSource(parsed.data);
    if (
      !payload.preview_token ||
      !verifyPreviewProof(payload.preview_token, parsed.data, source)
    )
      return {
        ok: false,
        error:
          "Pratinjau kedaluwarsa atau data berubah. Buat pratinjau kembali.",
      };
    // Revalidate rendering and atomically compare source revisions inside the RPC.
    await renderCoaPdf(source.document);
    return mutate(
      "issue_coa",
      {
        ...parsed.data,
        preview_source_updated_at: source.sourceUpdatedAt,
        preview_product_updated_at: source.productUpdatedAt,
      },
      issueSchema.and(
        z.object({
          preview_source_updated_at: z.string(),
          preview_product_updated_at: z.string(),
        }),
      ),
    );
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "COA belum berhasil diterbitkan.",
    };
  }
}
export async function updateCoaAction(payload: UpdateCoaPayload) {
  const session = await requireUser();
  if (!session || !canAction(session.user.role, "update_coa"))
    return { ok: false, error: "Akses tidak diizinkan." };
  const parsed = updateCoaSchema.safeParse(payload);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };
  const { data, error } = await createAdminClient()
    .from("coa")
    .select("*")
    .eq("id", parsed.data.id)
    .single();
  if (error || !data) return { ok: false, error: "COA tidak ditemukan." };
  try {
    await renderCoaPdf({
      ...data,
      ...parsed.data,
      tanda_tangan_digital: parsed.data.tanda_tangan,
    } as COA);
    return mutate("update_coa", payload, updateCoaSchema);
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Data tidak dapat dirender sebagai PDF.",
    };
  }
}
export async function deleteCoaAction(id: string) {
  return mutate(
    "delete_coa",
    id,
    uuid.transform((id) => ({ id })),
  );
}
