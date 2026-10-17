import { z } from "zod";

export const text = z.string().trim().max(1000);
const required = text.min(1, "Field wajib diisi.");
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
        message: "Batas minimum harus berupa angka.",
        path: ["nilai_min"],
      });
    if ((s.tipe_batas === "MAX" || s.tipe_batas === "RANGE") && max === null)
      ctx.addIssue({
        code: "custom",
        message: "Batas maksimum harus berupa angka.",
        path: ["nilai_maks"],
      });
    if (s.tipe_batas === "RANGE" && min !== null && max !== null && min > max)
      ctx.addIssue({
        code: "custom",
        message: "Minimum tidak boleh melebihi maksimum.",
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
    "Nama parameter tidak boleh duplikat.",
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
    "Tanggal uji tidak boleh sebelum sampling.",
  )
  .refine(
    (p) =>
      new Set(p.hasil_detail.map((v) => v.p)).size === p.hasil_detail.length,
    "Parameter hasil uji duplikat.",
  )
  .superRefine((p, ctx) => {
    if (p.status === "FAIL" && !p.failure_reason.trim())
      ctx.addIssue({
        code: "custom",
        message: "Jelaskan hasil FAIL sebelum menyimpan inspeksi final.",
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
    tanggal_expired: date,
    mfg_date: z.union([date, z.literal("")]),
    tanda_tangan: required,
  })
  .refine(
    (p) => p.tanggal_expired >= p.tanggal_rilis,
    "Tanggal kedaluwarsa tidak boleh sebelum rilis.",
  )
  .refine(
    (p) => !p.mfg_date || p.mfg_date <= p.tanggal_rilis,
    "Tanggal produksi tidak boleh setelah rilis.",
  );
export const issueSchema = coaSchema.and(z.object({ id_hasil: uuid }));
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
    }, "Link harus menggunakan http/https."),
  })
  .refine(
    (p) => p.masa_kadaluarsa >= p.tanggal_berlaku,
    "Tanggal kedaluwarsa tidak boleh sebelum tanggal berlaku.",
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
  .min(16, "Password minimal 16 karakter.")
  .max(1024)
  .refine((v) => v.trim() !== "INBIONUSA", "Gunakan password baru.");
export const userRoleSchema = z.enum([
  "admin qc",
  "administrator inbionusa",
  "qc supervisor",
  "viewer",
]);
export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[a-zA-Z0-9_.@-]+$/,
      "Username hanya boleh berisi huruf, angka, titik, @, - atau _.",
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
  .refine(
    (v) => v.password === v.confirmation,
    "Konfirmasi password tidak sama.",
  )
  .refine(
    (v) => v.current_password !== v.password,
    "Password baru harus berbeda.",
  );
