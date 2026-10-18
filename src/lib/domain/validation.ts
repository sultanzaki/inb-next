import { BUSINESS_ROLES } from "@/lib/rbac";
import { z } from "zod";
import { coaExpiryDate } from "./coa-dates";

export const text = z.string().trim().max(1000);
const required = text.min(1, "Required.");
export const uuid = z.uuid();
export const date = z.iso.date();
const numericPattern = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;
export function parseNumber(value: string): number | null {
  const normalized = value.trim();
  if (!numericPattern.test(normalized)) return null;
  const number = Number(normalized.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}
export const specSchema = z
  .object({
    parameter_en: text.optional().default(""),
    keterangan_en: text.optional().default(""),
    parameter_uji: required,
    tipe_batas: z.enum(["RANGE", "MIN", "MAX", "TEXT"]),
    nilai_min: text,
    nilai_maks: text,
    satuan: text,
    keterangan: text,
  })
  .superRefine((s, ctx) => {
    const min = parseNumber(s.nilai_min),
      max = parseNumber(s.nilai_maks);
    if ((s.tipe_batas === "MIN" || s.tipe_batas === "RANGE") && min === null)
      ctx.addIssue({
        code: "custom",
        message: "Enter a numeric minimum.",
        path: ["nilai_min"],
      });
    if ((s.tipe_batas === "MAX" || s.tipe_batas === "RANGE") && max === null)
      ctx.addIssue({
        code: "custom",
        message: "Enter a numeric maximum.",
        path: ["nilai_maks"],
      });
    if (s.tipe_batas === "RANGE" && min !== null && max !== null && min > max)
      ctx.addIssue({
        code: "custom",
        message: "Minimum cannot exceed maximum.",
      });
  });
export const productSchema = z
  .object({
    inci_name: text.optional().default(""),
    nama_produk_en: text.optional().default(""),
    revision_note: text.optional().default(""),
    id: uuid.nullish(),
    kode_produk: required,
    nama_produk: required,
    kategori: text,
    satuan: text,
    status_halal: z.enum(["Halal", "Non-Halal"]),
    tipe_kemasan: text,
    spesifikasi: z.array(specSchema).max(200),
  })
  .refine(
    (p) =>
      new Set(p.spesifikasi.map((s) => s.parameter_uji.toLowerCase())).size ===
      p.spesifikasi.length,
    "Parameter names must be unique.",
  );
export const inspectionSchema = z
  .object({
    status: z.enum(["PASS", "FAIL"]).optional(),
    draft_id: uuid.nullish(),
    failure_reason: z.string().trim().max(5000).optional().default(""),
    id: uuid.nullish(),
    id_produk: uuid,
    no_lot: required,
    tgl_sampling: date,
    tgl_uji: date,
    inspector: required,
    catatan: text,
    hasil_detail: z
      .array(
        z.object({
          spec_id: uuid,
          p: required,
          val: text,
          val_en: text.optional().default(""),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine(
    (p) => p.tgl_uji >= p.tgl_sampling,
    "Testing cannot be before sampling.",
  )
  .refine(
    (p) =>
      new Set(p.hasil_detail.map((v) => v.p)).size === p.hasil_detail.length,
    "Test parameters must be unique.",
  )
  .superRefine((p, ctx) => {
    if (p.status === "FAIL" && !p.failure_reason.trim())
      ctx.addIssue({
        code: "custom",
        message: "Explain the failure before saving.",
        path: ["failure_reason"],
      });
  });
export const coaSchema = z
  .object({
    language: z.enum(["id", "en"]).optional().default("en"),
    inci_name: text.optional().default(""),
    compliance_statement: z.string().trim().max(3000).optional().default(""),
    delivery_date: z
      .union([date, z.literal("")])
      .optional()
      .default(""),
    no_coa: text,
    tanggal_rilis: date,
    tanggal_expired: z
      .union([date, z.literal("")])
      .optional()
      .default(""),
    mfg_date: z.union([date, z.literal("")]),
    tanda_tangan: required,
  })
  .transform((p) => ({
    ...p,
    tanggal_expired: p.mfg_date ? coaExpiryDate(p.mfg_date) : p.tanggal_expired,
  }))
  .refine(
    (p) => p.tanggal_expired >= p.tanggal_rilis,
    "Expiry cannot be before release.",
  )
  .refine(
    (p) => !p.mfg_date || p.mfg_date <= p.tanggal_rilis,
    "Manufacturing cannot be after release.",
  );
export const issueSchema = coaSchema
  .and(z.object({ id_hasil: uuid }))
  .refine((p) => Boolean(p.mfg_date), {
    message: "Manufacturing date is required.",
    path: ["mfg_date"],
  });
export const updateCoaSchema = coaSchema.and(
  z.object({ id: uuid, no_coa: required }),
);
export const documentSchema = z
  .object({
    judul_dokumen: required,
    kategori: required,
    tanggal_berlaku: date,
    masa_kadaluarsa: date,
    link_drive: text.refine((s) => {
      if (!s) return true;
      try {
        return ["http:", "https:"].includes(new URL(s).protocol);
      } catch {
        return false;
      }
    }, "Use an http or https link."),
  })
  .refine(
    (p) => p.masa_kadaluarsa >= p.tanggal_berlaku,
    "Expiry cannot be before the effective date.",
  );

export function evaluateParam(
  spec: { tipe_batas: string; nilai_min: string; nilai_maks: string },
  value: string,
): "PASS" | "FAIL" {
  if (!value.trim()) return "FAIL";
  if (spec.tipe_batas === "TEXT") return "PASS"; // TEXT is a required observation, not an equality test.
  const number = parseNumber(value),
    min = parseNumber(spec.nilai_min),
    max = parseNumber(spec.nilai_maks);
  if (number === null) return "FAIL";
  if (spec.tipe_batas === "MIN")
    return min !== null && number >= min ? "PASS" : "FAIL";
  if (spec.tipe_batas === "MAX")
    return max !== null && number <= max ? "PASS" : "FAIL";
  return min !== null && max !== null && number >= min && number <= max
    ? "PASS"
    : "FAIL";
}
export function businessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const draftDataSchema = z.object({
  id_produk: z.union([uuid, z.literal("")]),
  no_lot: text,
  tgl_sampling: z.string().max(10),
  tgl_uji: z.string().max(10),
  inspector: text,
  catatan: text,
  failure_reason: z.string().max(5000).optional().default(""),
  hasil_detail: z
    .array(
      z.object({
        spec_id: uuid,
        p: text,
        val: text,
        val_en: text.optional().default(""),
      }),
    )
    .max(200),
});
export const draftSchema = z.object({
  id: uuid.nullish(),
  data: draftDataSchema,
});
export const passwordSchema = z
  .string()
  .min(16, "Use at least 16 characters.")
  .max(1024)
  .refine((v) => v.trim() !== "INBIONUSA", "Choose a new password.");
export const userRoleSchema = z.enum(BUSINESS_ROLES);
export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[a-zA-Z0-9_.@-]+$/,
      "Use letters, numbers, dots, @, hyphens, or underscores.",
    ),
  nama_lengkap: z.string().trim().min(1).max(200),
  role: userRoleSchema,
  password: passwordSchema,
});
export const updateUserSchema = z.object({
  id: uuid,
  nama_lengkap: z.string().trim().min(1).max(200),
  role: userRoleSchema,
  is_active: z.boolean(),
});
export const resetPasswordSchema = z.object({
  id: uuid,
  password: passwordSchema,
});
export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1).max(1024),
    password: passwordSchema,
    confirmation: z.string(),
  })
  .refine((v) => v.password === v.confirmation, "Passwords do not match.")
  .refine(
    (v) => v.current_password !== v.password,
    "Choose a different password.",
  );
