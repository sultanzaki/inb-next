# Status lima fase

## Implementasi yang selesai

1. Keamanan: gateway baca server + allowlist/GET-HEAD, guard sesi di setiap request, migrasi pencabutan anon/authenticated, deny unknown actions, bootstrap tanpa password tetap, password hash malformed ditolak, limiter login bersama/atomik, kegagalan revoke logout diperiksa.
2. QC: parsing angka penuh/koma desimal, skema payload runtime, evaluasi/status kanonik di PostgreSQL, ID versi parameter, parameter duplikat ditolak, blok simpan ketika spesifikasi belum berhasil dimuat, stale response/edit ditolak, perlindungan histori setelah versi berubah/COA terbit.
3. Database/COA: transaksi produk+spesifikasi+audit, unique sumber COA dan locking, allocator numerik per tahun, nomor otomatis tidak bergantung prefill, tanggal/check constraint, update nol baris menjadi not-found, audit error teramati, trigger updated_at, snapshot nama/kode pada daftar, detail dan cetakan COA, operator batas cetak inklusif, serta nilai MAX yang sebelumnya tidak ditampilkan.
4. Operasional: pencarian melalui scalar computed field PostgREST, offset pagination yang benar dengan urutan ID stabil, request guard, pemilih COA memakai anti-join dan pagination alih-alih potongan 500 baris, state kegagalan/retry, tanggal baru per pembukaan form dengan zona Jakarta, loader effect yang dapat dibatalkan.
5. Stabilitas: schema/index idempotent, proxy.ts mengganti middleware deprecated, CLI non-runtime dihapus, pengujian domain/password, PostgreSQL, HTTP PostgREST, serta browser production dan lint/build.

## Tetap tertunda/di luar deployment saat ini

- Migrasi produksi belum dijalankan; akses database Supabase aktif belum boleh dianggap aman sampai langkah DEPLOYMENT.md diterapkan dan diverifikasi. Hanya service-role REST credential tersedia pada task, bukan akses admin SQL.
- Lima entri advisory dev-tooling dengan satu akar braces masih menunggu patch upstream; runtime audit bersih. Rincian dan batas mitigasi di DEPLOYMENT.md.
- Redesign dan seluruh temuan UI/UX terkait layout, label aksesibilitas, kontras, dirty dialog, navigasi aktif, detail viewer, dan wording Upload ditunda sesuai instruksi. Pesan error/loading dan disabled state yang menyangkut integritas data diperbaiki tanpa mengubah desain visual.
- Keaslian tanda tangan digital kriptografis, alur revisi/revocation sertifikat, dan aturan pencocokan TEXT bukan fitur yang ditambahkan diam-diam dalam perbaikan bug.
- Backfill kode produk historis hanya dapat memakai data yang tersedia saat migrasi; tidak mengklaim mengembalikan kode historis yang tidak pernah disimpan.

Lihat DEPLOYMENT.md untuk urutan penerapan, preflight, bootstrap aman, dan verifikasi.

## Hasil verifikasi

- 6 pengujian domain/password.
- 22 pengujian PostgreSQL, termasuk rollback dan concurrency lintas koneksi.
- 3 pengujian HTTP PostgREST terhadap grant, pencarian, dan relasi view.
- 1 skenario browser production yang menjalankan login, gateway, pagination 120 produk unik, mutasi produk/inspeksi, pemilihan sumber COA melewati 500 baris, snapshot setelah master berubah, error dependency, kegagalan revoke, dan logout berhasil.
- Lint, TypeScript, dan build production lulus; audit dependency runtime 0.
