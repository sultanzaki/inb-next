begin;
do $$begin
 if to_regprocedure('public.erp_controls(text,text,text,integer)') is null then raise exception 'Migration 016 requires migration 015.';end if;
end $$;
-- Expose only the lot's production dates through the existing private QC view.
-- No stock, inspection or issued certificate is changed by this migration.
create or replace function public.qc_coa_lot_dates(p_inspection uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('mfg_date',l.mfg_date::text,'expiry_date',l.expiry_date::text,
   'locked',exists(select from public.erp_ledger w where w.lot_id=l.id),
   'source',case when exists(select from public.erp_ledger w join public.erp_movements m on m.id=w.movement_id where w.lot_id=l.id and m.kind='production' and m.state='posted') then 'production' else 'stock' end)
 from public.hasil_uji h join public.erp_lots l on l.product_id=h.id_produk and l.number=h.no_lot
 where h.id=p_inspection and not h.superseded
$$;
revoke all on function public.qc_coa_lot_dates(uuid) from public,anon,authenticated;
grant execute on function public.qc_coa_lot_dates(uuid) to service_role;
create or replace view public.available_hasil_uji with(security_invoker=true) as
 select h.*,public.qc_coa_lot_dates(h.id) coa_lot from public.hasil_uji h
 where h.status='PASS' and h.qc_version=1 and not h.superseded
 and not exists(select from public.coa c where c.id_hasil_uji=h.id or (c.id_produk=h.id_produk and c.no_lot=h.no_lot and not c.withdrawn));
revoke all on public.available_hasil_uji from public,anon,authenticated;
grant select on public.available_hasil_uji to service_role;
notify pgrst,'reload schema';
commit;
