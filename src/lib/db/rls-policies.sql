-- Kept as a secure, idempotent entry point for older setup instructions.
-- Apply src/lib/db/migrations/001_private_access.sql (identical policy).
begin;
do $$
declare t text; p record;
begin
  foreach t in array array['users','sessions','master_produk','spesifikasi','hasil_uji','coa','dokumen_arsip','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
commit;
