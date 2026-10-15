# INBIONUSA — Quality Control System

Sistem Manajemen Mutu dan Quality Control berbasis web, dibangun dengan Next.js + Supabase.

Migrasi dari Google Apps Script + Google Sheets ke arsitektur modern.

## Stack

- **Next.js 15** (App Router)
- **Supabase** (PostgreSQL + Auth)
- **shadcn/ui** + **Tailwind v4**
- **TypeScript**

## Fitur

| Fitur | Deskripsi |
|-------|-----------|
| **Dashboard** | Ringkasan statistik: total produk, lot diuji, pass/fail, COA, dokumen |
| **Master Produk** | CRUD produk dengan spesifikasi parameter uji dinamis |
| **Inspeksi** | Input hasil uji per lot, auto PASS/FAIL evaluation |
| **COA** | Terbitkan Certificate of Analysis untuk lot lulus QC |
| **Arsip Dokumen** | Kelola dokumen mutu dengan masa berlaku |
| **Audit Log** | Semua aktivitas tercatat otomatis |
| **Role-based Access** | Admin QC, Administrator, QC Supervisor, Viewer |

## Menjalankan

1. Salin `.env.example` ke `.env` dan isi kredensial Supabase
2. Jalankan `src/lib/db/schema.sql` di Supabase SQL Editor
3. Jalankan development server:

```bash
npm install
npm run dev
```

## Database

7 tabel utama PostgreSQL:
- `users` — User authentication & roles
- `master_produk` — Product master data
- `spesifikasi` — Test parameters per product
- `hasil_uji` — Inspection results per lot
- `coa` — Certificate of Analysis
- `dokumen_arsip` — Document archive
- `audit_log` — Activity log

## Role Permissions

| Aksi | Role |
|------|------|
| Delete produk | Admin QC, Administrator |
| Delete hasil uji | Admin QC, Administrator |
| Delete COA | Admin QC, Administrator |
| Issue/Update COA | Admin QC, Administrator, QC Supervisor |
| View data | Semua role (termasuk Viewer) |

## Migrasi Data

Untuk migrasi data dari Google Sheets:
1. Export setiap sheet sebagai CSV
2. Import ke tabel Supabase yang sesuai
3. Password user perlu di-hash dengan salt `INBIO::` menggunakan SHA-256

---

Dibangun dengan [Next.js](https://nextjs.org/) + [Supabase](https://supabase.com/)
