# Alur QC, administrasi, dan COA

## Penerapan

Terapkan migrasi `003_workflows.sql` **setelah 001 dan 002, sebelum deploy aplikasi ini**, melalui SQL Editor Supabase/koneksi admin. Backup dan uji pada staging terlebih dahulu. Migrasi dibungkus transaksi dan aman dijalankan ulang. Perubahan ini belum diterapkan pada database produksi oleh agen.

Akun yang sudah ada tetap aktif dan tidak dipaksa mengganti password oleh migrasi. Jangan mengubah password, menonaktifkan akun, atau mencabut seluruh sesi sebagai bagian rollout. Password bootstrap publik lama tetap ditolak seperti sebelumnya.

## Fitur dan aturan

| Fitur             | Perilaku                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft inspeksi    | Simpan formulir yang belum lengkap, lanjutkan atau hapus dari daftar draft. Supervisor hanya melihat draft miliknya; administrator/admin QC dapat mengelola semuanya. Viewer tidak dapat membaca draft. Finalisasi dan penghapusan draft satu transaksi.                                                                                                |
| Penjelasan FAIL   | Hasil dihitung database dari spesifikasi aktif. FAIL wajib disertai alasan; status kiriman browser tidak dipercaya. Inspeksi lama tetap tersimpan.                                                                                                                                                                                                      |
| Versi spesifikasi | Setiap simpan produk membuat revisi berisi identitas, standar, penerjemahan, pelaku, dan catatan. Detail produk menampilkan riwayat dan perbedaan dengan versi aktif. Data sebelum migrasi menjadi baseline, bukan riwayat yang direkonstruksi.                                                                                                         |
| PDF server        | Endpoint sesi-terproteksi menghasilkan A4 dari snapshot COA. Kop, logo, footer, proporsi dan tata letak mengikuti PDF acuan. Data sampel dalam acuan telah dihapus permanen dari aset. Parameter panjang dibungkus dan dipaginasi.                                                                                                                      |
| Pratinjau         | Formulir baru menghasilkan PDF bertanda pratinjau tanpa menulis COA/nomor. Penerbitan memerlukan bukti HMAC berumur 15 menit untuk formulir dan revisi sumber yang sama; perubahan sumber membatalkan pratinjau.                                                                                                                                        |
| Bahasa            | Pilih Indonesia atau English saat membuat COA. Label dokumen diterjemahkan; nama produk, parameter, standar teks dan hasil observasi memiliki isian English opsional. Jika kosong, teks asli digunakan; tidak ada terjemahan otomatis yang mengubah hasil laboratorium.                                                                                 |
| Pengguna          | Administrator dan admin QC membuat akun, mengubah nama/peran/status, dan mereset password. Tidak dapat menonaktifkan/mengubah peran sendiri atau menghilangkan administrator terakhir.                                                                                                                                                                  |
| Password          | Setiap pengguna mengubah password sendiri setelah memverifikasi password saat ini. Akun baru/reset wajib mengganti password sebelum membuka data QC. Reset dan perubahan peran/penonaktifan mencabut sesi; perubahan password sendiri mencabut sesi lain dan membuat sesi pengganti. Password minimal 16 karakter; hash tidak dikirim ke browser/audit. |
| Audit             | Administrator/admin QC dapat mencari, memfilter, mengekspor dan membuka data sebelum/sesudah perubahan. Data sebelum migrasi tidak direkonstruksi.                                                                                                                                                                                                      |
| Pencarian         | Topbar mencari produk, lot dan COA sekaligus; hasil membuka modul dengan identitas terpilih sebagai pencarian.                                                                                                                                                                                                                                          |
| Filter            | Pencarian/status, rentang tanggal, produk, penguji atau kategori sesuai modul. Timestamp menggunakan WIB.                                                                                                                                                                                                                                               |
| Ekspor            | CSV ber-BOM dan Excel XLSX mengikuti filter/pencarian/urutan aktif, bukan hanya halaman yang sudah dimuat. Maksimal 10.000 baris; lebih dari batas ditolak dengan instruksi mempersempit filter. CSV mencegah formula injection; Excel menulis teks sebagai string.                                                                                     |
| Salin identitas   | Tombol salin kode produk, nomor lot, nomor COA, referensi dokumen/audit dan username dengan konfirmasi berhasil/gagal.                                                                                                                                                                                                                                  |

Navigasi seluruh modul berada pada topbar; pada layar kecil menu terbuka dari atas. Menu panduan dan pintasan dihapus. Warna dan logo merek dipertahankan. Pencarian keyboard tetap tersedia tanpa menu panduan.

## COA dan batasan

Template `inb-reference-v1` mempertahankan letterhead acuan. Nomor, produk, INCI, lot, tanggal, hasil, deklarasi kepatuhan dan tanggal pengiriman berasal dari data aplikasi. Pernyataan standar seperti USP/NF tidak ditambahkan otomatis: penerbit harus mengisi deklarasi yang benar-benar berlaku. Kolom penerbit bukan tanda tangan digital kriptografis.

Font subset Aptos dari PDF acuan dipakai untuk karakter yang tersedia; karakter Latin tambahan menggunakan Liberation Sans berlisensi OFL (lihat aset). Identitas yang terlalu panjang untuk template ditolak saat pratinjau, sehingga tidak diterbitkan sebagai PDF terpotong. PDF resmi tidak memiliki tanda pratinjau. Perubahan metadata COA yang diizinkan aturan aplikasi lama tetap tersedia; snapshot hasil tidak dapat diubah.

## Validasi lokal

Gunakan Node 24, `npm ci`, dan Chromium untuk pengujian browser. `npm test` memerlukan `pdftotext` dari Poppler untuk memeriksa isi PDF, bahasa, paginasi dan penghapusan data sampel.

```
bash scripts/test-services.sh start
npm test
npm run test:db
npm run test:http
npm run lint
npm run build
npm run test:e2e
npm audit --omit=dev
```

Database pengujian adalah PostgreSQL/PostgREST Docker lokal, terpisah dari Supabase aktif. Pengujian browser menjalankan build produksi dengan relay REST lokal dan akun fixture; tidak memakai akun pengguna produksi. Jangan menjalankan fixture pengujian terhadap database aktif.

Hasil verifikasi perubahan ini: 14 pengujian domain/PDF, 32 pengujian database, 3 pengujian HTTP, dan 1 skenario browser produksi lengkap lulus. Typecheck, lint tanpa peringatan, serta build produksi lulus. Browser memeriksa aksesibilitas dan overflow pada 1440, 768, 375 dan 320 px, draft, COA/PDF, administrasi/reset password, pembatasan viewer, pencarian dan ekspor. Audit dependency runtime melaporkan 0 kerentanan; ini tidak menyatakan seluruh dependency development bebas advisory. Aset PDF juga ditemukan dalam manifest file tracing endpoint dan halaman COA untuk deployment serverless.

## COA dates from posted production (migration 016)

Apply `016_coa_production_dates.sql` after 015, before deploying the matching application. The private `available_hasil_uji` view exposes a minimal `coa_lot` object through a server-only security-definer helper. Direct warehouse-table access remains revoked, and public/anonymous access stays blocked.

When a passed inspection belongs to a posted production/stock lot with a recorded manufacturing date, selecting the inspection fills and locks MFG Date. Expiry follows the one-year COA policy. Release date stays editable and may differ from the production date. Unposted/manual inspections retain manual MFG entry. A conflicting stored expiry requires review rather than silently changing stock dates.

The preview checks posted dates before rendering; issuance retains the atomic database date guard. Changing source dates requires reselecting the inspection and a fresh preview. Known date, retest and withdrawn-certificate failures now have actionable English messages instead of a generic retry message. No existing lot dates, certificates or users are changed by the migration.
