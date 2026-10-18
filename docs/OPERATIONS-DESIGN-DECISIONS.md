# Catatan keputusan pengembangan INBIONUSA

Tanggal diskusi: 18 Oktober 2026 (Asia/Jakarta).

Dokumen ini mencatat arah pengembangan yang disepakati dalam percakapan. Ini adalah acuan untuk pekerjaan berikutnya, bukan pernyataan bahwa seluruh perilaku di bawah sudah diterapkan. Permintaan saat pencatatan ini hanya menyimpan hasil diskusi; implementasi baru belum dimulai.

## 1. Batas lingkup mini ERP

- INBIONUSA memproduksi sendiri, kemudian menjual hasil produksinya.
- Modul: Production, Quality, Warehouse, Sales, serta administrasi bersama.
- Production cukup mencatat hasil produksi barang jadi terlebih dahulu. BOM, konsumsi bahan baku, dan perencanaan produksi lanjutan ditunda.
- Warehouse berawal dari satu gudang; satuan ditambahkan manual dengan konversi per produk.
- Sales menggunakan quotation, bukan purchase order, kemudian sales order dan pengiriman.
- Finance ditunda.
- Modul dapat aktif, read-only, atau nonaktif, dengan pembatasan akses di backend.
- Data produk sintetis dari seed hanya data pengujian, bukan acuan penamaan produk nyata.

## 2. Identitas produk dan lot/batch

### Keputusan yang disepakati

Nama produk nyata mengikuti pola nama satu kata dan seri angka, misalnya **INDOSTER 01** dan **INBIOSAN 200**. Pengguna memastikan seri angka tersebut unik antarproduk. Simpan seri sebagai field identitas produk tersendiri dengan tipe teks dan keunikan yang ditegakkan database. Pertahankan nol di depan: `01` berbeda penulisannya dari `1`; jangan mengekstrak identitas dari nama pada setiap transaksi.

Format lot:

`SeriProduk.NomorBatch.DDMMYYYY.TahunEXP`

Walaupun format awal disebut DDMMYY, contoh pengguna dan kesepakatan berikutnya menggunakan tahun empat digit: **DDMMYYYY**.

| Contoh | Nomor lot |
| --- | --- |
| INDOSTER 01, batch pertama, 18 Oktober 2026 | `01.01.18102026.2027` |
| INDOSTER 01, batch kedua, 18 Oktober 2026 | `01.02.18102026.2027` |
| INBIOSAN 200, batch pertama, 18 Oktober 2026 | `200.01.18102026.2027` |
| INDOSTER 01, batch pertama, 1 Januari 2027 | `01.01.01012027.2028` |

- Urutan batch terpisah untuk setiap produk dan direset setiap tahun.
- Tahun urutan mengikuti tanggal produksi, bukan tanggal input. Produksi Desember yang dicatat Januari tetap masuk urutan tahun produksi tersebut.
- Nomor resmi dialokasikan server saat **Post**, secara atomik agar posting bersamaan tidak menghasilkan nomor sama. Draft belum mengambil nomor resmi.
- Nomor batch minimal dua digit: `01` sampai `99`, lalu `100` dan seterusnya.
- Nomor yang sudah diposting lalu dibatalkan/reversal tidak digunakan kembali. Jangan menjanjikan urutan tanpa celah.
- Tanggal expiry lengkap tetap disimpan sebagai tanggal produksi + satu tahun kalender; bagian EXP pada kode hanya menampilkan tahunnya. Ikuti aturan kalender/leap-day yang konsisten dengan COA.
- Identitas lot dikunci setelah posting. Koreksi harus tercatat dan menjaga konsistensi stok, inspeksi, COA, dan pengiriman.
- Satu batch adalah satu kelompok hasil produksi, bukan satu kemasan atau satu perpindahan stok. Contoh: 1.000 kg dalam 40 bag dari satu kelompok produksi menggunakan lot yang sama.

### Integrasi Inspection

Kondisi yang dijelaskan saat diskusi: formulir Inspection masih menerima nomor lot manual dan menghubungkan data melalui produk + nomor lot yang sama persis. Ini rawan salah ketik dan perlu disempurnakan.

Arah integrasi: Production membuat lot dan stok quarantine; Inspection memilih lot yang sudah ada, lalu mengambil produk dan tanggal produksi otomatis. QC memasukkan hasil pengujian tanpa membuat ulang identitas lot atau menambah stok. PASS valid melepas lot untuk penjualan, FAIL memblokirnya. COA dan pengiriman menggunakan identitas lot yang sama.

Input manual ketika Production tidak digunakan adalah usulan fallback untuk QC mandiri; aturan detail fallback dan penanganan lot historis masih perlu dipastikan saat implementasi. Jangan menomori ulang lot atau dokumen lama secara otomatis.

## 3. Navigasi desktop

Pengguna membolehkan perubahan dari preferensi topbar sebelumnya untuk mendapatkan navigasi terbaik saat modul bertambah. Arah yang dipilih adalah **sidebar yang dapat diperkecil**, dengan kelompok kerja yang dapat dibuka/tutup. Kelompok halaman aktif terbuka otomatis. Topbar ringkas berisi judul/konteks, pencarian global, dan akun.

Struktur acuan:

| Kelompok | Tujuan |
| --- | --- |
| Overview | Dashboard lintas modul |
| Production | Production records |
| Quality | Inspections, Certificates, Documents |
| Warehouse | Stock, Movements, Stock counts |
| Sales | Quotations, Sales orders, Customers |
| Master data | Products, Units & conversions, Locations |
| Administration | Users & permissions, Audit log, Module settings |

Master data dibedakan dari administrasi akses. Lot dapat diakses dari stok/produksi dan pencarian; keputusan penempatan menu Lots tersendiri belum difinalkan. Struktur ini adalah arah navigasi, bukan alasan menghapus fungsi yang sudah tersedia.

## 4. Navigasi mobile

- Hilangkan navbar global atas yang mengulang logo dan pemilih modul. Tetap pertahankan header kontekstual ringkas berisi judul, konteks, tombol kembali, atau tindakan yang relevan.
- Navigasi bawah tetap berisi tiga tujuan: **Home · Work · Search**. Jumlah tujuan tidak bertambah ketika modul ditambahkan.
- Home: pekerjaan yang perlu perhatian, lanjutkan pekerjaan terakhir, serta ringkasan sesuai akses. Avatar akun tersedia di Home.
- Work: halaman penuh berisi daftar vertikal area kerja, dengan nama, penjelasan singkat, dan area sentuh besar. Hindari drawer panjang, ikon tanpa label, dan deretan tab horizontal yang sulit ditemukan.
- Setelah masuk suatu area, tampilkan halaman kerja. Pilihan tampilan seperti Stock / Movements / Stock counts dibuka melalui pemilih yang menampilkan panel dari bawah.
- Halaman detail memiliki tombol kembali dan judul yang jelas. Navigasi bawah tetap tersedia saat membaca daftar/detail.
- Form panjang seperti quotation dibuka layar penuh. Sembunyikan navigasi bawah selama form terbuka, sediakan Cancel/Save yang mudah dijangkau, dan lindungi isian yang belum disimpan.
- Filter/pilihan tampilan memakai panel dari bawah. Daftar stok dapat menggunakan baris bertumpuk yang mengutamakan produk, lot, dan jumlah; detail kompleks tetap dapat diakses tanpa memotong informasi penting.

## 5. Prinsip navigasi lintas perangkat

- Nama tujuan dan struktur konsisten antara desktop dan mobile.
- Tampilkan menu berdasarkan izin dan mode modul. Modul disabled tidak muncul; read-only tetap bisa dibaca dengan penanda jelas.
- Simpan filter, pagination, dan posisi scroll saat kembali dari detail. Ingat konteks terakhir bila sesuai.
- Hubungkan pekerjaan melalui tindakan langsung yang membawa identitas/data terkait: production → lot → inspection → COA; quotation accepted → sales order → reserve stock → delivery.
- Pengguna tidak perlu mengetik ulang nomor lot atau memilih ulang produk yang sudah diketahui dari konteks.
- Pertahankan logo, palet saat ini, dan DM Sans. Tampilan profesional, ringkas, tidak memiliki ruang kosong berlebihan; desktop/laptop tetap prioritas dan mobile harus lengkap.

## 6. Dashboard dan analytics

Pengguna menyukai arah **tindakan dahulu → satu area performance yang dapat dipilih → aktivitas terbaru**. Dashboard utama menjadi pusat pekerjaan lintas modul; rincian analitik tetap berada di modul masing-masing.

### Needs attention

Tempatkan di bagian teratas. Contoh informasi: lot menunggu inspeksi, pesanan menunggu pengiriman, quotation mendekati akhir masa berlaku, dan stok di bawah batas minimum. Setiap item membuka daftar yang sudah difilter dan mengikuti izin pengguna.

Contoh bukan jaminan metrik sudah tersedia: peringatan stok minimum membutuhkan konfigurasi ambang yang belum ditetapkan dalam diskusi ini.

### Performance

- Satu area analytics dengan pilihan **Overview / Production / Quality / Warehouse / Sales**.
- Setiap pilihan menampilkan satu grafik utama, beberapa angka pendukung, dan penjelasan singkat. Jangan menampilkan semua grafik sekaligus.
- Filter periode berlaku untuk isi area tersebut; ingat pilihan konteks dan periode terakhir.
- Pergantian manual dengan transisi ringan. **Tidak ada carousel yang berjalan otomatis.**
- Desktop menggunakan pilihan konteks dan grafik dengan angka pendukung di sampingnya.
- Mobile menggunakan pemilih konteks ringkas, dua angka terpenting, satu grafik, dan tautan View analytics ke rincian terkait.
- Detail per produk, grafik tambahan, dan perbandingan panjang dibuka pada analytics modul.
- Muat data sesuai konteks yang dipilih; tidak perlu memuat semua statistik sekaligus.

Contoh arah metrik:

| Konteks | Isi |
| --- | --- |
| Overview | Ringkasan produksi, QC, stok, dan pengiriman |
| Production | Tren jumlah produksi per produk |
| Quality | Tren PASS/FAIL dan inspeksi tertunda |
| Warehouse | Stok masuk/keluar dan komposisi status lot |
| Sales | Nilai quotation, tingkat penerimaan, dan sisa pesanan |

Definisi periode, agregasi, dan satuan harus ditetapkan sebelum implementasi; jangan menjumlahkan kuantitas dengan satuan yang tidak sebanding.

### Recent activity dan ketepatan metrik

Tampilkan beberapa kejadian operasional terbaru. Riwayat audit lengkap tetap berada di Audit.

Nilai quotation bukan penjualan, sales order bukan pengiriman, dan pengiriman bukan uang diterima. Karena Finance ditunda, jangan menyebut angka tersebut revenue atau pendapatan terverifikasi.

## 7. Status dan langkah berikutnya

- Catatan ini menyimpan diskusi; belum ada perubahan aplikasi atau migrasi yang dijalankan untuk keputusan baru ini.
- Saat pengecekan koneksi terakhir dalam percakapan, API baca Supabase berhasil; Management API untuk migrasi masih diblokir jaringan environment. Status tersebut harus diuji ulang sebelum pekerjaan database.
- Sebelum implementasi, periksa schema yang benar-benar terpasang dan riwayat migrasi. Jangan menganggap merge kode mini ERP berarti migrasi produksi sudah dijalankan.
- Pekerjaan berikutnya mengikuti keputusan di atas: integritas penomoran batch dan pilihan lot, navigasi desktop/mobile, kemudian dashboard kontekstual. Ini urutan teknis yang disarankan, belum jadwal pengerjaan yang dijanjikan.

## 8. Implementasi pada branch release

Keputusan di atas sekarang ditindaklanjuti pada branch `feat/operations-release-experience`. Lihat `RELEASE-OPERATIONS.md` untuk cakupan, cara penggunaan dan urutan migrasi 005. Catatan status sebelumnya adalah riwayat diskusi, bukan hasil pengujian koneksi terkini. Implementasi dan pengujian lokal tidak berarti database produksi sudah dimigrasikan.
