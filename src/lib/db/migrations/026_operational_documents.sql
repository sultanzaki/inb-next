begin;
alter table public.erp_manufacturing_orders add column if not exists batch_snapshot jsonb;
alter table public.erp_manufacturing_orders add column if not exists closed_at timestamptz;
alter table public.erp_manufacturing_orders add column if not exists closed_by uuid references public.users(id);
-- Freeze a final batch record in the same transaction that closes production.
create or replace function public.work_freeze_batch() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare snapshot jsonb;begin
 if tg_op='UPDATE' and old.state='closed' and new is distinct from old then raise exception using errcode='P0001',message='Closed production records are immutable. Record a linked deviation instead.';end if;
 if new.state='closed' and old.state<>'closed' then
  perform set_config('work.detail','true',true);
  select r into snapshot from public.work_records(nullif(current_setting('inb.actor',true),'')::uuid,'manufacturing_orders') r where r->>'id'=new.id::text;
  if snapshot is null then raise check_violation using message='Cannot close an inaccessible production record.';end if;
  -- Capture all actual inputs, independent of the creator\'s later access assignment.
  select snapshot||jsonb_build_object('inputs',coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('lot',ml.number,'material',ma.name,'unit',u.code,'quantity',i.quantity::text,'location',l.name,'operator',a.nama_lengkap) order by i.created_at),'[]')) into snapshot from public.erp_manufacturing_inputs i join public.erp_material_lots ml on ml.id=i.lot_id join public.erp_materials ma on ma.id=ml.material_id join public.erp_units u on u.id=ma.unit_id join public.erp_locations l on l.id=i.location_id join public.users a on a.id=i.measured_by where i.manufacturing_order_id=new.id;
  new.closed_at:=now();new.closed_by:=nullif(current_setting('inb.actor',true),'')::uuid;
  new.batch_snapshot:=snapshot||jsonb_build_object('state','closed','version',new.version,'closure_reason',new.closure_reason,'closed_at',new.closed_at,'closed_by_name',(select nama_lengkap from public.users where id=new.closed_by));
 end if;return new;
end $$;
drop trigger if exists work_freeze_batch on public.erp_manufacturing_orders;
create trigger work_freeze_batch before update on public.erp_manufacturing_orders for each row execute function public.work_freeze_batch();
create or replace function public.work_genealogy(p_user uuid,p_lot uuid) returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',m.id,'label',m.number,'number',m.number,'state',m.state,
 'inputs',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('lot',l.number,'material',mat.name,'quantity',i.quantity::text)) from public.erp_manufacturing_inputs i join public.erp_material_lots l on l.id=i.lot_id join public.erp_materials mat on mat.id=l.material_id where i.manufacturing_order_id=m.id and public.work_location_allowed(p_user,i.location_id)),'[]'),
 'outputs',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('lot',l.number,'quantity',o.quantity::text)) from public.erp_manufacturing_outputs o join public.erp_lots l on l.id=o.lot_id where o.manufacturing_order_id=m.id),'[]'),
 'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'number',d.number,'date',d.date,'lot',l.number,'quantity',x->>'base_quantity','customer',case when public.erp_can(p_user,'sales','read') and exists(select from public.erp_modules where key='sales' and state<>'disabled') then coalesce(d.snapshot->'customer'->>'name',(select so.snapshot->'customer'->>'name' from public.erp_orders so where so.id=d.order_id)) else 'Customer details require Sales access' end)) from public.erp_movements d cross join lateral jsonb_array_elements(d.lines) x join public.erp_lots l on l.id=(x->>'lot_id')::uuid where d.kind='delivery' and d.state='posted' and not exists(select from public.erp_movements rev where rev.reverses=d.id and rev.state='posted') and public.work_location_allowed(p_user,d.from_location) and exists(select from public.erp_manufacturing_outputs o where o.manufacturing_order_id=m.id and o.lot_id=l.id)),'[]'))
 from public.erp_manufacturing_orders m where public.work_location_allowed(p_user,m.location_id) and (exists(select from public.erp_manufacturing_inputs where manufacturing_order_id=m.id and lot_id=p_lot) or exists(select from public.erp_manufacturing_outputs where manufacturing_order_id=m.id and lot_id=p_lot))
$$;
create or replace function public.erp_work_document(p_token text,p_entity text,p_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;r jsonb;frozen jsonb;begin
 u:=public.erp_actor(p_token);perform set_config('work.detail','true',true);
 if p_entity not in ('manufacturing_orders','incoming_inspections','warehouse_transfers') then raise check_violation;end if;
 perform public.work_read_guard(u.id,p_entity);
 select record into r from public.work_records(u.id,p_entity) record where record->>'id'=p_id::text;
 if r is null then raise insufficient_privilege;end if;
 if p_entity='manufacturing_orders' then
  if exists(select from public.erp_manufacturing_inputs where manufacturing_order_id=p_id and not public.work_location_allowed(u.id,location_id)) then raise insufficient_privilege using message='The complete batch document requires access to every material source warehouse.';end if;
  select batch_snapshot into frozen from public.erp_manufacturing_orders where id=p_id;
  if r->>'state'='closed' then
   if frozen is null then raise exception using errcode='P0001',message='This historical order has no frozen batch document. View its transaction history instead.';end if;r:=frozen;
  end if;
 end if;
 return r;
end $$;
-- Index relation lookups used by workspaces, snapshots and traceability.
create index if not exists work_inputs_order on public.erp_manufacturing_inputs(manufacturing_order_id,created_at);
create index if not exists work_outputs_order on public.erp_manufacturing_outputs(manufacturing_order_id);
create index if not exists work_transfer_lines_transfer on public.erp_transfer_lines(transfer_id);
create index if not exists work_pallet_contents_pallet on public.erp_pallet_contents(pallet_id);
create index if not exists work_inspection_lot on public.erp_incoming_inspections(lot_id,created_at desc);
create index if not exists work_deviations_order on public.erp_deviations(manufacturing_order_id);
create index if not exists work_capas_deviation on public.erp_capas(deviation_id);
revoke all on function public.work_freeze_batch(),public.work_genealogy(uuid,uuid),public.erp_work_document(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.erp_work_document(text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
