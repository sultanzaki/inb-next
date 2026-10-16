-- INBIONUSA Quality Control System — Database Schema
-- PostgreSQL (Supabase)

-- 1. USERS
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  role text not null default 'viewer'
    check (role in ('admin qc', 'administrator inbionusa', 'qc supervisor', 'viewer')),
  nama_lengkap text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. MASTER PRODUK
create table if not exists public.master_produk (
  id uuid primary key default gen_random_uuid(),
  kode_produk text unique not null,
  nama_produk text not null,
  kategori text not null,
  satuan text not null,
  status_halal text not null default 'Halal'
    check (status_halal in ('Halal', 'Non-Halal')),
  tipe_kemasan text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. SPESIFIKASI
create table if not exists public.spesifikasi (
  id uuid primary key default gen_random_uuid(),
  id_produk uuid not null references public.master_produk(id) on delete cascade,
  parameter_uji text not null,
  nilai_min text default '',
  nilai_maks text default '',
  satuan text default '',
  keterangan text default '',
  tipe_batas text not null default 'RANGE'
    check (tipe_batas in ('RANGE', 'MIN', 'MAX', 'TEXT')),
  urutan int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_spesifikasi_id_produk on public.spesifikasi(id_produk);

-- 4. HASIL UJI
create table if not exists public.hasil_uji (
  id uuid primary key default gen_random_uuid(),
  no_lot text not null,
  id_produk uuid not null references public.master_produk(id) on delete restrict,
  tgl_sampling date not null,
  tgl_uji date not null,
  inspector text not null,
  hasil_detail jsonb not null default '[]',
  status text not null default 'PASS'
    check (status in ('PASS', 'FAIL')),
  catatan text default '-',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id_produk, no_lot)
);

create index if not exists idx_hasil_uji_id_produk on public.hasil_uji(id_produk);
create index if not exists idx_hasil_uji_status on public.hasil_uji(status);
create index if not exists idx_hasil_uji_created_at on public.hasil_uji(created_at desc);

-- 5. COA (Certificate of Analysis)
create table if not exists public.coa (
  id uuid primary key default gen_random_uuid(),
  no_coa text unique not null,
  id_produk uuid not null references public.master_produk(id) on delete restrict,
  no_lot text not null,
  tanggal_rilis date not null,
  tanggal_expired date not null,
  hasil_uji_snapshot jsonb not null,
  tanda_tangan_digital text not null default 'Terverifikasi Digital',
  mfg_date text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_coa_id_produk on public.coa(id_produk);
create index if not exists idx_coa_created_at on public.coa(created_at desc);

-- 6. DOKUMEN ARSIP
create table if not exists public.dokumen_arsip (
  id uuid primary key default gen_random_uuid(),
  judul_dokumen text not null,
  kategori text not null,
  tanggal_berlaku date not null,
  masa_kadaluarsa date not null,
  link_drive text default '',
  file_url text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. AUDIT LOG
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  waktu timestamptz not null default now(),
  user_name text not null,
  aksi text not null,
  referensi text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_waktu on public.audit_log(waktu desc);

-- 8. SESSIONS (for token-based auth like the original)
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sessions_token on public.sessions(token);
create index if not exists idx_sessions_user_id on public.sessions(user_id);

-- Row Level Security
alter table public.users enable row level security;
alter table public.master_produk enable row level security;
alter table public.spesifikasi enable row level security;
alter table public.hasil_uji enable row level security;
alter table public.coa enable row level security;
alter table public.dokumen_arsip enable row level security;
alter table public.audit_log enable row level security;
alter table public.sessions enable row level security;

-- No default administrator/password is seeded. Bootstrap a named account with
-- scripts/create-admin.ts and a securely supplied password after migrations.
