> Rollout 20 October 2026: migration 015 applied to the configured Supabase project. Server-only RPC permissions and RLS for all three new tables verified; REST rejects an empty application session with 403. Local lint, typecheck, 27 unit tests, 115 database tests, 3 HTTP tests, production build, targeted mobile controls and full browser regression passed.

> Phase 4 transaction controls require [migration 015](../src/lib/db/migrations/015_transaction_controls.sql) after 014, before deploying the matching code. See [controls and correction rules](TRANSACTION-CONTROLS.md).

> Operational UX phases 1–3 require [migration 014](../src/lib/db/migrations/014_operational_ux.sql) after 013, before deploying the matching code. See [rollout and checks](OPERATIONAL-UX.md).

> Latest operational expansion: see [Operational Finance rollout](OPERATIONAL-FINANCE.md) for migrations 010–013, opt-in modules and staging acceptance flows.

# Penerapan perbaikan keamanan dan integritas QC

## Status dan urutan

Perubahan kode dan migrasi diuji pada PostgreSQL 17/PostgREST 13 lokal terisolasi. **Migrasi belum diterapkan ke Supabase aktif.** Service-role REST key tidak memberikan akses SQL DDL; diperlukan SQL Editor Supabase atau koneksi database admin yang dikelola pemilik project.

Jangan menganggap perubahan file SQL menutup endpoint database aktif. Terapkan dalam maintenance window agar versi aplikasi lama yang membaca menggunakan anon key tidak dipakai setelah akses tersebut dicabut.

1. Backup database aktif, khususnya produk, spesifikasi, inspeksi, COA, audit dan pengguna. Uji restore pada staging.
2. Jalankan query preflight di bawah. Selesaikan duplikasi/ketidaksesuaian secara manual; jangan menghapus histori untuk memaksa migrasi lulus.
3. Terapkan `src/lib/db/migrations/001_private_access.sql`. Migrasi ini mencabut akses anon/authenticated terhadap tabel aplikasi. Semua pembacaan kini melalui `/api/data/[table]` dengan sesi aplikasi yang diverifikasi.
4. Terapkan `src/lib/db/migrations/002_integrity.sql`. Transaksi ini menambahkan constraint, FK sumber COA, audit atomik, allocator nomor, limiter login bersama, serta RPC mutasi yang memeriksa sesi dan role lagi di database.
5. Untuk versi fitur QC terbaru, terapkan `003_workflows.sql` setelah 002; baca [panduan rollout fitur QC](QC-WORKFLOWS.md). Migrasi mempertahankan akses akun lama.
6. Deploy aplikasi dan jalankan pemeriksaan di bawah. Set `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` secara aman; `NEXT_PUBLIC_SUPABASE_URL` masih didukung sebagai fallback server untuk kompatibilitas. Anon key tidak lagi dibutuhkan browser. Service role key tidak boleh memakai prefix NEXT_PUBLIC.
7. Jika akun masih memakai password bootstrap publik yang dahulu ada di schema, siapkan akun admin baru dengan password aman melalui `npm run bootstrap:admin`. Login dengan **password bootstrap publik lama ditolak**, termasuk jika hash-nya sudah memakai scrypt. Script hanya menambah akun, tidak menimpa pengguna yang ada. Supply BOOTSTRAP_USERNAME, BOOTSTRAP_NAME, BOOTSTRAP_PASSWORD (16+ karakter) dan credential Supabase melalui environment settings, bukan argumen CLI, source, atau chat; hapus BOOTSTRAP_* setelah dipakai.
8. Karena token sesi pernah dapat diakses anonim, pertimbangkan pencabutan seluruh sesi lama setelah memastikan akses admin baru. Script migrasi tidak otomatis menghapus sesi/pengguna atau merotasi credential. Pemeriksaan sebelumnya tidak membuktikan telah terjadi penyalahgunaan.

## Preflight SQL (baca saja)

```sql
select id_produk, lower(btrim(parameter_uji)), count(*)
from public.spesifikasi group by 1,2 having count(*)>1;
select id_produk, no_lot, count(*) from public.coa group by 1,2 having count(*)>1;
select id from public.spesifikasi
where btrim(parameter_uji)='';
select id from public.hasil_uji where tgl_uji<tgl_sampling;
select id from public.coa where tanggal_expired<tanggal_rilis;
select id from public.dokumen_arsip where masa_kadaluarsa<tanggal_berlaku;
select c.id from public.coa c where not exists
(select 1 from public.hasil_uji h where h.id_produk=c.id_produk and h.no_lot=c.no_lot);
```

Unique index menolak parameter/COA duplikat dan me-rollback migrasi 002; keamanan dari migrasi 001 tetap berlaku karena keduanya transaksi terpisah. Constraint tanggal NOT VALID mempertahankan baris lama, namun memvalidasi setiap insert/update baru. Audit dan trigger timestamp mulai berlaku setelah migrasi, bukan rekonstruksi histori.

## Perubahan perilaku penting

- Status inspeksi dihitung ulang di database dari spesifikasi, bukan dipercaya dari browser. Koma desimal didukung, angka dengan suffix/hex/non-finite ditolak. Payload harus memuat ID versi spesifikasi yang sedang dimuat.
- Perubahan spesifikasi mengganti ID versinya. Inspeksi tervalidasi yang masih memakai versi lama tidak boleh diedit diam-diam memakai versi baru; perlukan revisi inspeksi terpisah. Hasil yang sudah memiliki COA dikunci sampai COA dihapus melalui aksi berizin. Tidak ada workflow revocation/revisi baru dalam perubahan ini.
- Inspeksi lama diberi `qc_version=0`. Sebelum COA baru dapat diterbitkan, penulis berizin perlu meninjau dan menyimpan ulang inspeksi yang belum disertifikasi. Ini mencegah status PASS legacy dipercaya tanpa evaluasi server. COA lama tetap dipertahankan.
- Nomor otomatis dialokasikan saat penerbitan, bukan melalui prefill yang dapat basi. Nomor manual tetap diperbolehkan dan harus unik. Suffix numerik standar maksimal 18 digit ikut menentukan allocator; nomor kustom di luar format tersebut tidak mengacaukan urutan. Counter per tahun memakai waktu Asia/Jakarta dan tidak mendaur ulang urutan yang sudah teralokasi setelah sertifikat dihapus.
- Snapshot baru menyimpan nama dan kode produk. COA lama tanpa kode disnapshot memakai kode saat migrasi dan ditandai `legacy_identity_backfill`; kode historis yang tidak pernah tersimpan tidak dapat direkonstruksi. Nama snapshot yang sudah ada tidak ditimpa.
- Limiter login menyimpan reservasi sebelum hashing: maksimum lima percobaan per username (dinormalisasi untuk limiter) per 15 menit, bersama lintas instance, termasuk login berhasil. Sesi/entri limiter kedaluwarsa dibersihkan secara terbatas ketika reservasi dilakukan. Ini bukan pengganti proteksi volumetrik/WAF di deployment publik.
- Logout yang gagal mencabut sesi melaporkan kegagalan dan mempertahankan cookie agar bisa dicoba kembali.
- Perubahan bisnis dan audit-nya satu transaksi; kegagalan menulis audit menggagalkan mutasi. Audit login bersifat best effort tetapi error tidak lagi ditelan tanpa pencatatan.
- Semua keputusan tipe TEXT tetap berarti observasi wajib diisi. Persamaan terhadap standar organoleptik/tanda tangan kriptografis memerlukan keputusan bisnis terpisah.

## Verifikasi setelah penerapan

- Tanpa sesi/anon key: pembacaan `users`, `sessions`, domain dan pemanggilan RPC ditolak.
- `/api/data/master_produk` tanpa sesi menghasilkan 401; users/sessions/audit/RPC tidak termasuk allowlist, dan method tulis tidak diekspor.
- Login pengguna valid, seluruh daftar/dashboard, pencarian nama produk/lot/COA, Muat lagi, simpan inspeksi, penerbitan/cetak COA, dan logout berjalan.
- Viewer tetap dapat membaca data domain melalui gateway, tetapi tidak dapat melakukan mutasi. Supervisor tidak dapat menghapus data atau menambah dokumen.
- Permintaan COA bersamaan menghasilkan satu sertifikat per sumber dan nomor otomatis berbeda untuk sumber berbeda.
- Coba rollback/error/concurrency pada staging saja, jangan sengaja memicu kegagalan data pada produksi.

## Pemulihan

Jangan mengembalikan policy public_access atau grant anonim sebagai cara mengatasi deployment yang belum sinkron. Bila aplikasi perlu ditarik sementara, gunakan maintenance mode dan perbaiki konfigurasi server/migrasi dari staging. Backup database adalah sumber pemulihan histori; jangan menurunkan constraint atau menghapus baris otomatis. Untuk rollback aplikasi ke versi lama diperlukan penyesuaian jalur baca yang aman terlebih dahulu.

## Dependency

CLI shadcn yang tidak dipakai pada runtime dihapus dari dependency aplikasi. `npm audit --omit=dev` melaporkan **0 kerentanan** pada pemeriksaan perubahan ini. Audit penuh masih melaporkan **5 entri high dalam satu rantai advisory braces GHSA-vfj7-8cjw-p6xm** melalui tooling `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. Versi upstream braces terbaru yang tersedia saat diperiksa adalah 3.0.3, masih termasuk advisory; versi plugin Next terbaru yang diperiksa juga masih memakai fast-glob tersebut.

Tidak digunakan audit fix --force, penggantian dependency tidak kompatibel, penonaktifan aturan lint, atau bypass verifikasi paket untuk menyembunyikan temuan. Semua aturan lint Next tetap aktif. Dalam konfigurasi ini rootDir glob tidak menerima input aplikasi; advisory ini bukan bukti endpoint runtime dapat dieksploitasi. Upgrade setelah patch upstream tersedia tetap diperlukan untuk menutup temuan audit tooling sepenuhnya.
