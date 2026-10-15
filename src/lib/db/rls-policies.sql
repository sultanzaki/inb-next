-- INBIONUSA — RLS Policies
-- Izinkan semua operasi dari anon key (app handle auth sendiri)

-- Helper: enable public access for each table
do $$
declare
  tables text[] := array['users', 'master_produk', 'spesifikasi', 'hasil_uji', 'coa', 'dokumen_arsip', 'audit_log', 'sessions'];
  t text;
begin
  foreach t in array tables loop
    execute format('drop policy if exists "public_access" on public.%I', t);
    execute format('create policy "public_access" on public.%I for all using (true) with check (true)', t);
  end loop;
end $$;
