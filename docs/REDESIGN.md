# Enterprise workspace redesign

Arah desain: modern enterprise, desktop/laptop sebagai prioritas, dengan seluruh fungsi tetap tersedia pada layar kecil.

## Cakupan

- Login: dua panel, identitas merek asli, bantuan akses, status pengiriman, dan kontrol visibilitas password.
- Shell: sidebar responsif yang dapat diringkas, penanda halaman aktif, breadcrumb, menu akun, panduan, dan pencarian halaman dengan Ctrl/⌘ K.
- Dashboard: metrik dan distribusi hasil dari query nyata, aktivitas inspeksi, dokumen, dan pintasan alur kerja. Kegagalan query tetap ditampilkan sebagai data tidak tersedia.
- Produk, inspeksi, COA, arsip: header, filter yang melakukan query, pencarian yang dapat dikosongkan, pengurutan, pemuatan ulang, tabel, paginasi, skeleton, keadaan kosong, dan pemulihan error.
- Formulir: label terkait kontrol, validasi sebelum pengiriman, pesan error terkait field, fokus ke isian tidak valid, submit lewat keyboard, footer tetap terlihat, status penyimpanan, dan konfirmasi saat menutup perubahan yang belum disimpan. Reload/tab-close memakai peringatan bawaan browser apabila didukung.
- Detail: spesifikasi produk dapat dibaca viewer; inspeksi dan COA menampilkan standar, hasil, satuan, dan status melalui komponen bersama.
- Cetak COA: logo asli, identitas sertifikat, snapshot hasil uji, dan nama penerbit. Data pengguna tetap di-escape sebelum masuk HTML cetak.
- Komponen UI bersama: button, input, textarea, select, badge, card, table, dialog, sheet, menu, command, tooltip, tabs, avatar, switch, progress, separator, scroll area, skeleton, label, alert, dan toast mendapat aturan visual yang konsisten.
- Halaman 404 dan pemulihan error dashboard mengikuti bahasa desain yang sama.

## Identitas dan interaksi

Semua nilai warna literal pada token CSS asli dipertahankan. Bayangan dan transparansi diturunkan dari palet tersebut. `public/logo.png` tidak diubah. Pengujian brand memeriksa token dan SHA-256 aset logo.

Transisi memakai React 19.3 ViewTransition untuk perpindahan halaman, serta animasi ringan untuk panel, dialog, hover, dan skeleton. Preferensi `prefers-reduced-motion` menonaktifkan animasi. Browser tanpa dukungan ViewTransition tetap dapat menavigasi secara normal.

Pintasan: Ctrl/⌘ K untuk pencarian halaman, `/` untuk fokus pencarian daftar, Escape untuk menutup dialog/menu, Tab untuk berpindah kontrol. Navigasi global tidak menginterupsi formulir modal yang sedang terbuka. Sidebar mobile mengunci scroll, membatasi fokus, serta menonaktifkan konten di belakangnya.

## Validasi

Jalankan dari root repositori:

```sh
npm run lint
npm run typecheck
npm test
bash scripts/test-services.sh start
npm run test:db
npm run test:http
npm run build
npm run test:e2e
```

Database dan PostgREST untuk pengujian berjalan dalam container lokal yang terpisah dari Supabase produksi. Jangan arahkan pengujian database ke produksi. `test:db` mereset fixture lokal; jalankan sebelum tes HTTP/browser.

Browser E2E memakai build produksi dan Chromium. Cakupannya mencakup paginasi 120 baris, pembuatan produk dan parameter, inspeksi dengan desimal koma, penerbitan COA dengan sumber melewati 500 baris, ketahanan snapshot, pembuatan dokumen, penanganan kegagalan, logout, validasi form, konfirmasi discard, keyboard, sidebar, viewer, cetak, serta lebar 1440/768/375/320 piksel. Axe memeriksa aturan WCAG A/AA pada halaman dan keadaan yang dikunjungi; ini bukan sertifikasi aksesibilitas atau pengujian perangkat Safari/iOS fisik.

Screenshot review disimpan oleh E2E di `/workspace/redesign-review` (atau direktori `TEST_ARTIFACT_DIR` bila diatur). Isinya fixture pengujian lokal, bukan data produksi. Pengujian tidak melakukan deployment atau menerapkan migrasi Supabase produksi. Kebutuhan migrasi dari perbaikan sebelumnya tetap mengikuti `DEPLOYMENT.md`.

Hasil verifikasi 16 Oktober 2026: build produksi, TypeScript, dan ESLint lolos; 7 pengujian domain/brand, 22 database, 3 HTTP, dan 1 rangkaian E2E browser lolos. Pemeriksaan Axe tidak menemukan pelanggaran pada keadaan yang diuji. Palet literal dan hash logo sesuai baseline sebelum redesign.
