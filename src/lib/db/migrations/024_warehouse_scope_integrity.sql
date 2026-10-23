begin;
create or replace function public.erp_actor(p_token text) returns public.users language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;begin
 select us.* into u from public.users us join public.sessions s on s.user_id=us.id where s.token=p_token and s.expires_at>now() and us.is_active and not us.must_change_password;
 if not found then raise insufficient_privilege using message='Session expired.';end if;
 perform set_config('app.actor',u.nama_lengkap,true);perform set_config('work.actor',u.id::text,true);return u;
end $$;
create or replace function public.work_row_allowed(p_user uuid,p_entity text,r jsonb) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare target uuid;loc uuid;begin
 if p_user is null or not exists(select from public.erp_warehouse_scopes where user_id=p_user and restricted) or exists(select from public.users where id=p_user and role in ('admin qc','administrator inbionusa')) then return true;end if;
 if r?'body' then r:=r->'body';end if;
 if p_entity='ops_cases' then
  if nullif(r->>'location_id','') is not null and not public.work_location_allowed(p_user,(r->>'location_id')::uuid) then return false;end if;
  if r->>'source_type'='delivery' then return exists(select from public.erp_movements where id=(r->>'source_id')::uuid and public.work_location_allowed(p_user,from_location));
  elsif r->>'source_type'='receipt' then return exists(select from public.erp_material_ledger where transaction_id=(r->>'source_id')::uuid and public.work_location_allowed(p_user,location_id));
  elsif r->>'source_type'='lot' then return exists(select from public.erp_balances where lot_id=(r->>'source_id')::uuid and public.work_location_allowed(p_user,location_id));end if;
  return true;
 end if;
 if nullif(r->>'location_id','') is not null then return public.work_location_allowed(p_user,(r->>'location_id')::uuid);end if;
 if p_entity='locations' then return public.work_location_allowed(p_user,(r->>'id')::uuid);end if;
 if p_entity in ('movements','production','posted_deliveries','ops_receipts','deliveries') then
  return exists(select from public.erp_movements where id=(r->>'id')::uuid and (public.work_location_allowed(p_user,from_location) or public.work_location_allowed(p_user,to_location)));
 end if;
 if p_entity in ('ledger','trace_events') and r->>'id' ~ '^\d+$' then select location_id into loc from public.erp_ledger where id=(r->>'id')::bigint;return public.work_location_allowed(p_user,loc);end if;
 if p_entity in ('counts','count_lines') then select location_id into loc from public.erp_counts where id=coalesce(nullif(r->>'count_id',''),r->>'id')::uuid;return public.work_location_allowed(p_user,loc);end if;
 if p_entity in ('lots','inspection_lots','availability','trace') then target:=coalesce(nullif(r->>'lot_id',''),r->>'id')::uuid;return exists(select from public.erp_balances where lot_id=target and public.work_location_allowed(p_user,location_id));end if;
 if p_entity='material_ledger' then return exists(select from public.erp_material_ledger where transaction_id=(r->>'id')::uuid and public.work_location_allowed(p_user,location_id));end if;
 if p_entity='ops_material_receipts' then return exists(select from public.erp_material_ledger where transaction_id=(r->>'id')::uuid and public.work_location_allowed(p_user,location_id));end if;
 if p_entity='inbox' and r->>'module' in ('warehouse','production','quality') then
  if starts_with(r->>'id','qc:') then return exists(select from public.erp_balances where lot_id=split_part(r->>'id',':',2)::uuid and public.work_location_allowed(p_user,location_id));end if;
  if starts_with(r->>'id','count:') then select location_id into loc from public.erp_counts where id=split_part(r->>'id',':',2)::uuid;return public.work_location_allowed(p_user,loc);end if;
  if starts_with(r->>'id','return:') then select location_id into loc from public.erp_returns where id=split_part(r->>'id',':',2)::uuid;return public.work_location_allowed(p_user,loc);end if;
  return false;
 end if;return true;
end $$;
create or replace function public.work_mask_row(p_user uuid,p_entity text,r jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare field text;items jsonb;total numeric;available numeric;material uuid;location uuid;lot public.erp_material_lots;begin
 if p_entity='materials' then
  material:=(r->>'id')::uuid;
  select coalesce(sum(b.quantity),0),coalesce(sum(case when public.work_material_eligible(l.id) then greatest(0,b.quantity-public.work_material_reserved(l.id,b.location_id)) else 0 end),0) into total,available from public.erp_material_balances b join public.erp_material_lots l on l.id=b.lot_id where l.material_id=material and (p_user is null or public.work_location_allowed(p_user,b.location_id));
  r:=r||jsonb_build_object('on_hand',total::text,'available',available::text,'state',case when r->>'active'='false' then 'inactive' when available<coalesce((r->>'minimum_stock')::numeric,0) then 'low_stock' else 'active' end);
 elsif p_entity='material_stock' then
  select * into lot from public.erp_material_lots where id=(r->>'lot_id')::uuid;location:=(r->>'location_id')::uuid;
  r:=r||jsonb_build_object('held',lot.held,'quality_status',lot.quality_status,'reserved',public.work_material_reserved(lot.id,location)::text,'available',(case when public.work_material_eligible(lot.id) then greatest(0,(r->>'quantity')::numeric-public.work_material_reserved(lot.id,location)) else 0 end)::text,'state',case when lot.held then 'held' when lot.expiry_date<public.erp_today() then 'expired' when exists(select from public.erp_materials where id=lot.material_id and requires_qc) and lot.quality_status<>'released' then lot.quality_status else r->>'state' end);
 end if;
 if p_user is null or not exists(select from public.erp_warehouse_scopes where user_id=p_user and restricted) then return r;end if;
 foreach field in array array['stock','reservations','lines'] loop
  if jsonb_typeof(r->field)='array' and (field<>'lines' or p_entity='material_ledger') then
   select coalesce(jsonb_agg(x),'[]') into items from jsonb_array_elements(r->field) x where nullif(x->>'location_id','') is null or public.work_location_allowed(p_user,(x->>'location_id')::uuid);
   r:=jsonb_set(r,array[field],items);
  end if;
 end loop;
 if jsonb_typeof(r->'deliveries')='array' then select coalesce(jsonb_agg(x),'[]') into items from jsonb_array_elements(r->'deliveries') x where public.work_row_allowed(p_user,'movements',x);r:=jsonb_set(r,'{deliveries}',items);end if;
 return r;
end $$;
-- Apply warehouse predicates before count/order/page on existing stock read paths.
do $$declare f regprocedure;definition text;marker text;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('erp_read_v5','erp_choices') loop
  definition:=pg_get_functiondef(f);if position('warehouse_scoped' in definition)>0 then continue;end if;
  if position('public.erp_table_source(source,' in definition)>0 then marker:=' if p_id is null and nullif(current_setting(''app.table_query''';
  else marker:=' pattern:=';end if;
  if position(marker in definition)=0 then raise exception 'Unexpected warehouse read definition: %',f;end if;
  definition:=replace(definition,marker,E' source:=''select * from (''||source||'') warehouse_scoped where public.work_row_allowed(''||quote_literal(u.id)||''::uuid,''||quote_literal(p_entity)||'',to_jsonb(warehouse_scoped))'';\n'||marker);
  execute definition;
 end loop;
 select pg_get_functiondef('public.erp_table_source(text,text,text,text,integer,text,text)'::regprocedure) into definition;
 if position('warehouse_scoped' in definition)=0 then
  marker:=' predicate:=';
  definition:=replace(definition,marker,E' source_sql:=''select body from (''||source_sql||'') warehouse_scoped where public.work_row_allowed(nullif(current_setting(''''work.actor'''',true),'''''''')::uuid,''||quote_literal(p_entity)||'',body)'';\n'||marker);
  execute definition;
 end if;
 if to_regclass('public.erp_growth_records_v24') is null then alter view public.erp_growth_records rename to erp_growth_records_v24;end if;
end $$;
create or replace view public.erp_growth_records as select r.entity,r.module,r.id,m.body,r.search,coalesce(m.body->>'state',r.state) state,r.sort from public.erp_growth_records_v24 r cross join lateral (select public.work_mask_row(nullif(current_setting('work.actor',true),'')::uuid,r.entity,r.body) body) m where public.work_row_allowed(nullif(current_setting('work.actor',true),'')::uuid,r.entity,r.body);
revoke all on public.erp_growth_records from public,anon,authenticated,service_role;
-- Location access is enforced on reservations/drafts too, before physical stock changes.
create or replace function public.work_location_write_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=nullif(current_setting('inb.actor',true),'')::uuid;r jsonb:=to_jsonb(new);begin
 if actor is null then return new;end if;
 if tg_table_name='erp_movements' and (r->'snapshot')?'warehouse_transfer_id' then
  perform public.work_assert_location(actor,case when r->'snapshot'->>'stage'='dispatch' then (r->>'from_location')::uuid else (r->>'to_location')::uuid end,'write');return new;
 elsif tg_table_name='erp_movements' then
  if nullif(r->>'from_location','') is not null then perform public.work_assert_location(actor,(r->>'from_location')::uuid,'write');end if;
  if nullif(r->>'to_location','') is not null then perform public.work_assert_location(actor,(r->>'to_location')::uuid,'write');end if;
 else perform public.work_assert_location(actor,(r->>'location_id')::uuid,case when tg_table_name='erp_reservations' then 'read' else 'write' end);end if;return new;
end $$;
do $$declare t text;begin foreach t in array array['erp_movements','erp_counts','erp_reservations','erp_returns'] loop
 execute format('drop trigger if exists work_location_write_guard on public.%I',t);execute format('create trigger work_location_write_guard before insert or update on public.%I for each row execute function public.work_location_write_guard()',t);
end loop;end $$;
do $$begin
 if to_regprocedure('public.erp_mutate_v24(text,text,jsonb)') is null then alter function public.erp_mutate(text,text,jsonb) rename to erp_mutate_v24;end if;
 if to_regprocedure('public.erp_read_v24(text,text,text,text,integer,text)') is null then alter function public.erp_read(text,text,text,text,integer,text) rename to erp_read_v24;end if;
end $$;
create or replace function public.erp_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;result jsonb;begin
 u:=public.erp_actor(p_token);
 if starts_with(p_entity,'work_') then return public.erp_work_read(p_token,substr(p_entity,6),jsonb_build_object('search',p_search,'state',p_state,'page',p_page,'id',p_id,'grid',coalesce(nullif(current_setting('app.table_query',true),'')::jsonb,'{}')));end if;
 result:=public.erp_read_v24(p_token,p_entity,p_search,p_state,p_page,p_id);
 if result?'rows' then select jsonb_set(result,'{rows}',coalesce(jsonb_agg(public.work_mask_row(u.id,p_entity,r)),'[]')) into result from jsonb_array_elements(result->'rows') r;end if;
 if p_entity='trace' then result:=public.work_mask_row(u.id,p_entity,result);end if;
 return result;
end $$;
create or replace function public.erp_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;target uuid:=nullif(p_payload->>'id','')::uuid;result jsonb;begin
 perform pg_advisory_xact_lock(49281041);u:=public.erp_actor(p_token);
 if p_action='reverse_material_transaction' and (exists(select from public.erp_manufacturing_inputs where transaction_id=target) or exists(select from public.erp_material_transactions where id=target and managed_by_workflow)) then raise exception using errcode='P0001',message='Use the production material return action so batch genealogy remains reconciled.';end if;
 if p_action='reverse_move' and (exists(select from public.erp_sample_requests where movement_id=target) or exists(select from public.erp_manufacturing_outputs where movement_id=target) or exists(select from public.erp_movements where id=target and (snapshot?'warehouse_transfer_id' or snapshot?'pallet_id'))) then raise exception using errcode='P0001',message='Use a linked production or warehouse correction for this controlled movement.';end if;
 if p_action='set_module' and p_payload->>'state'='disabled' then
  if p_payload->>'module'='production' and exists(select from public.erp_manufacturing_orders where state not in ('closed','cancelled')) then raise exception using errcode='P0001',message='Resolve manufacturing orders before disabling Production; use read-only to pause.';end if;
  if p_payload->>'module'='warehouse' and (exists(select from public.erp_warehouse_transfers where state in ('draft','in_transit','partial')) or exists(select from public.erp_sample_requests where state='prepared')) then raise exception using errcode='P0001',message='Resolve warehouse transfers and prepared samples before disabling Warehouse.';end if;
  if p_payload->>'module'='quality' and (exists(select from public.erp_incoming_inspections where state='draft') or exists(select from public.erp_deviations where state not in ('closed','rejected')) or exists(select from public.erp_capas where state not in ('verified','cancelled'))) then raise exception using errcode='P0001',message='Resolve material inspections, deviations and CAPA before disabling Quality.';end if;
 end if;
 if p_action='reverse_material_transaction' then perform set_config('work.stock_flow','reversal',true);
 elsif p_action='ops_execute_case' and exists(select from public.erp_cases where id=target and kind='supplier_return') then perform set_config('work.stock_flow','supplier_return',true);end if;
 result:=public.erp_mutate_v24(p_token,p_action,p_payload);perform set_config('work.stock_flow','',true);return result;
end $$;
-- Owner-only helper functions are not public APIs, including renamed wrappers.
do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'work_%' or p.proname in ('erp_read_v24','erp_mutate_v24')) loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f);end loop;end $$;
revoke all on function public.erp_read(text,text,text,text,integer,text),public.erp_mutate(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.erp_read(text,text,text,text,integer,text),public.erp_mutate(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
