begin;
-- Transfers, returns and disposals must not be reversed outside their controlling workflow.
create or replace function public.work_manage_transaction() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if coalesce(current_setting('work.stock_flow',true),'') in ('transfer','disposal') or coalesce(current_setting('inb.action',true),'') in ('consume_material','return_manufacturing_material') then new.managed_by_workflow:=true;end if;return new;
end $$;
drop trigger if exists work_manage_transaction on public.erp_material_transactions;
create trigger work_manage_transaction before insert on public.erp_material_transactions for each row execute function public.work_manage_transaction();
revoke all on function public.work_manage_transaction() from public,anon,authenticated,service_role;
-- Finished goods from a controlled batch cannot leave before the batch record is closed.
create or replace function public.work_assert_output_ready(p_movement uuid,p_lot uuid,p_quantity numeric) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if p_quantity<0 and exists(select from public.erp_movements where id=p_movement and kind in ('delivery','issue')) and exists(select from public.erp_manufacturing_outputs o join public.erp_manufacturing_orders m on m.id=o.manufacturing_order_id where o.lot_id=p_lot and m.state<>'closed') then raise exception using errcode='P0001',message='Reconcile and close the production order before shipping this finished batch.';end if;
end $$;
do $$declare definition text;begin
 select pg_get_functiondef('public.erp_delta(uuid,integer,uuid,uuid,numeric,uuid)'::regprocedure) into definition;
 if position('work_assert_output_ready' in definition)=0 then
  if position(' if qty=0 then return; end if;' in definition)=0 then raise exception 'Unexpected stock delta definition. Review the migration before continuing.';end if;
  definition:=replace(definition,' if qty=0 then return; end if;',' perform public.work_assert_output_ready(doc,lot,qty); if qty=0 then return; end if;');execute definition;
 end if;
end $$;
revoke all on function public.work_assert_output_ready(uuid,uuid,numeric) from public,anon,authenticated,service_role;
-- Validate references even when a caller supplies IDs without using a picker.
create or replace function public.work_reference_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=nullif(current_setting('inb.actor',true),'')::uuid;d public.erp_deviations;begin
 if actor is null then return new;end if;
 if tg_table_name='erp_capas' then
  select * into d from public.erp_deviations where id=new.deviation_id;
  if not exists(select from public.users where id=new.assignee and is_active and public.erp_can(id,'quality','write')) then raise exception using errcode='P0001',message='Assign CAPA to an active Quality operator.';end if;
 else d:=new;end if;
 if d.material_lot_id is not null and not exists(select from public.erp_material_balances b where b.lot_id=d.material_lot_id and public.work_location_allowed(actor,b.location_id)) then raise insufficient_privilege;end if;
 if d.inspection_id is not null and not exists(select from public.erp_incoming_inspections i join public.erp_material_balances b on b.lot_id=i.lot_id where i.id=d.inspection_id and public.work_location_allowed(actor,b.location_id)) then raise insufficient_privilege;end if;
 if d.manufacturing_order_id is not null and not exists(select from public.erp_manufacturing_orders m where m.id=d.manufacturing_order_id and public.work_location_allowed(actor,m.location_id)) then raise insufficient_privilege;end if;
 return new;
end $$;
drop trigger if exists work_reference_guard on public.erp_deviations;
create trigger work_reference_guard before insert or update on public.erp_deviations for each row execute function public.work_reference_guard();
drop trigger if exists work_reference_guard on public.erp_capas;
create trigger work_reference_guard before insert or update on public.erp_capas for each row execute function public.work_reference_guard();
create or replace function public.work_case_scope_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=nullif(current_setting('inb.actor',true),'')::uuid;r jsonb;begin
 if actor is null then return new;end if;
 if tg_table_name='erp_cases' then r:=to_jsonb(new);else select to_jsonb(c) into r from public.erp_cases c where c.id=new.case_id;end if;
 if not public.work_row_allowed(actor,'ops_cases',r) then raise insufficient_privilege using message='This service case is outside your assigned warehouse access.';end if;return new;
end $$;
do $$declare t text;begin foreach t in array array['erp_cases','erp_case_events','erp_case_executions'] loop
 execute format('drop trigger if exists work_case_scope_guard on public.%I',t);
 execute format('create trigger work_case_scope_guard before insert or update on public.%I for each row execute function public.work_case_scope_guard()',t);
end loop;end $$;
revoke all on function public.work_case_scope_guard() from public,anon,authenticated,service_role;
-- Scope legacy reports and lookup counts before pagination, not after rows are returned.
do $$declare f regprocedure;definition text;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('erp_overview_v5','erp_insights') loop
  definition:=pg_get_functiondef(f);
  if position('/* work_report_scope */' in definition)=0 then
   definition:=replace(definition,'from public.erp_movements where','from public.erp_movements where /* work_report_scope */ (public.work_location_allowed(u.id,from_location) or public.work_location_allowed(u.id,to_location)) and');
   definition:=replace(definition,'from public.erp_counts where','from public.erp_counts where public.work_location_allowed(u.id,location_id) and');
   definition:=replace(definition,'from public.erp_lots where','from public.erp_lots where exists(select from public.erp_balances sb where sb.lot_id=erp_lots.id and public.work_location_allowed(u.id,sb.location_id)) and');
   definition:=replace(definition,'b.quantity>0 and l.expiry_date','public.work_location_allowed(u.id,b.location_id) and b.quantity>0 and l.expiry_date');
   execute definition;
  end if;
 end loop;
 select pg_get_functiondef('public.erp_ops_read(text,text,text,text,integer,text)'::regprocedure) into definition;
 if position('/* work_case_scope */' in definition)=0 then
  definition:=replace(definition,'(p_id is null or c.id::text=p_id)','/* work_case_scope */ public.work_row_allowed(u.id,''ops_cases'',to_jsonb(c)) and (p_id is null or c.id::text=p_id)');
  definition:=replace(definition,'(p_id is null or r.delivery_id::text=p_id)','public.work_location_allowed(u.id,m.from_location) and (p_id is null or r.delivery_id::text=p_id)');
  definition:=replace(definition,'where kind=''receipt'' and number ilike','where public.work_row_allowed(u.id,''ops_material_receipts'',jsonb_build_object(''id'',id)) and kind=''receipt'' and number ilike');
  execute definition;
 end if;
 select pg_get_functiondef('public.qc_global_search(text,text)'::regprocedure) into definition;
 if position('/* work_search_scope */' in definition)=0 then
  definition:=replace(definition,'where exists(select from allowed where key=''warehouse'')','where /* work_search_scope */ exists(select from public.erp_balances sb where sb.lot_id=l.id and public.work_location_allowed(u.id,sb.location_id)) and exists(select from allowed where key=''warehouse'')');
  definition:=replace(definition,'m.kind=''production'' and exists','m.kind=''production'' and (public.work_location_allowed(u.id,m.from_location) or public.work_location_allowed(u.id,m.to_location)) and exists');
  execute definition;
 end if;
end $$;
revoke all on function public.work_reference_guard() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
