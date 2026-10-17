# INBIONUSA — Quality Control System

Fitur draft inspeksi, COA server, administrasi akun, audit, pencarian dan ekspor: lihat [alur QC dan panduan migrasi 003](docs/QC-WORKFLOWS.md).

Sistem Manajemen Mutu dan Quality Control berbasis web, dibangun dengan Next.js + Supabase.

Migrasi dari Google Apps Script + Google Sheets ke arsitektur modern.

## Stack

- **Next.js 16.4** (App Router)
- **Supabase** (PostgreSQL; sesi aplikasi diverifikasi server)
- **shadcn/ui** + **Tailwind v4**
- **TypeScript**

## Fitur

| Fitur                 | Deskripsi                                                             |
| --------------------- | --------------------------------------------------------------------- |
| **Dashboard**         | Ringkasan statistik: total produk, lot diuji, pass/fail, COA, dokumen |
| **Master Produk**     | CRUD produk dengan spesifikasi parameter uji dinamis                  |
| **Inspeksi**          | Input hasil uji per lot, auto PASS/FAIL evaluation                    |
| **COA**               | Terbitkan Certificate of Analysis untuk lot lulus QC                  |
| **Arsip Dokumen**     | Kelola dokumen mutu dengan masa berlaku                               |
| **Audit Log**         | Semua aktivitas tercatat otomatis                                     |
| **Role-based Access** | Admin QC, Administrator, QC Supervisor, Viewer                        |

## Menjalankan

1. Salin `.env.example` ke `.env.local` dan isi credential server Supabase melalui konfigurasi aman. Browser tidak lagi memerlukan anon key.
2. Untuk database baru: jalankan `src/lib/db/schema.sql`, lalu migrasi `001_private_access.sql` dan `002_integrity.sql` di `src/lib/db/migrations/`. Untuk database yang sudah ada: ikuti [panduan penerapan](docs/DEPLOYMENT.md), jangan membuat ulang tabel atau menghapus histori.
3. `npm ci` lalu `npm run dev`.
4. Tidak ada password admin bawaan. Bootstrap akun bernama dengan `npm run bootstrap:admin` dan environment aman seperti dijelaskan di panduan penerapan.

## Pengujian

```bash
npm test
npm run lint
npm run typecheck
bash scripts/test-services.sh start
npm run test:db
npm run test:http
npm run build
npm run test:e2e
bash scripts/test-services.sh stop
```

Docker diperlukan untuk PostgreSQL/PostgREST lokal yang terisolasi. Test database hanya menerima loopback port 55432 dan mereset schema disposable tersebut; jangan hubungkan ke database aktif. Browser test memakai Chromium sistem (`/usr/bin/chromium`) atau `TEST_CHROMIUM_PATH`; jika tidak tersedia, install Chromium Playwright dengan `npx playwright install chromium`.

[Status perbaikan lima fase](docs/FIX-STATUS.md) · [Migrasi dan keterbatasan deployment](docs/DEPLOYMENT.md)

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

| Aksi             | Role                                   |
| ---------------- | -------------------------------------- |
| Delete produk    | Admin QC, Administrator                |
| Delete hasil uji | Admin QC, Administrator                |
| Delete COA       | Admin QC, Administrator                |
| Issue/Update COA | Admin QC, Administrator, QC Supervisor |
| View data        | Semua role (termasuk Viewer)           |

## Migrasi Data

Untuk migrasi data dari Google Sheets:

1. Export setiap sheet sebagai CSV
2. Import ke tabel Supabase yang sesuai
3. Gunakan hash scrypt untuk password baru; kompatibilitas hash legacy hanya untuk migrasi dan ditingkatkan saat login. Password bootstrap publik lama ditolak.

---

Dibangun dengan [Next.js](https://nextjs.org/) + [Supabase](https://supabase.com/)
