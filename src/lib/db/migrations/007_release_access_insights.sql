begin;
-- Forward-only; existing admin identities and explicit grants/denials are retained.
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check(role in ('admin qc','administrator inbionusa','qc supervisor','viewer','quality_manager','quality_officer','warehouse_manager','warehouse_operator','production_operator','purchasing_manager','purchasing_officer','sales_manager','sales_officer'));
create table if not exists public.erp_role_permissions(role text not null,module text not null references public.erp_modules(key),can_read boolean not null default true,can_write boolean not null default false,can_approve boolean not null default false,primary key(role,module),check(can_read or not (can_write or can_approve)));
insert into public.erp_role_permissions(role,module,can_read,can_write,can_approve) values
 ('quality_manager','quality',true,true,true),('quality_manager','documents',true,true,true),('quality_manager','warehouse',true,false,false),('quality_manager','production',true,false,false),
 ('quality_officer','quality',true,true,false),('quality_officer','documents',true,true,false),('quality_officer','warehouse',true,false,false),
 ('warehouse_manager','warehouse',true,true,true),('warehouse_manager','purchase',true,false,false),('warehouse_manager','production',true,false,false),('warehouse_manager','sales',true,false,false),('warehouse_manager','documents',true,false,false),
 ('warehouse_operator','warehouse',true,true,false),('warehouse_operator','purchase',true,false,false),('warehouse_operator','documents',true,false,false),
 ('production_operator','production',true,true,false),('production_operator','warehouse',true,false,false),('production_operator','documents',true,false,false),
 ('purchasing_manager','purchase',true,true,true),('purchasing_manager','warehouse',true,false,false),('purchasing_manager','documents',true,false,false),
 ('purchasing_officer','purchase',true,true,false),('purchasing_officer','warehouse',true,false,false),('purchasing_officer','documents',true,false,false),
 ('sales_manager','sales',true,true,true),('sales_manager','crm',true,true,true),('sales_manager','warehouse',true,false,false),('sales_manager','documents',true,false,false),
 ('sales_officer','sales',true,true,false),('sales_officer','crm',true,true,false),('sales_officer','warehouse',true,false,false),('sales_officer','documents',true,false,false)
on conflict(role,module) do nothing;

create or replace function public.erp_can(p_user uuid,p_module text,p_verb text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select case
 when not u.is_active or p_verb not in ('read','write','approve') then false
 when u.role in ('admin qc','administrator inbionusa') then true
 when exists(select from public.erp_access where user_id=u.id and module=p_module) then (select case p_verb when 'read' then can_read when 'write' then can_write when 'approve' then can_approve else false end from public.erp_access where user_id=u.id and module=p_module)
 when exists(select from public.erp_role_permissions where role=u.role and module=p_module) then (select case p_verb when 'read' then can_read when 'write' then can_write when 'approve' then can_approve else false end from public.erp_role_permissions where role=u.role and module=p_module)
 else p_module='quality' and u.role in ('viewer','qc supervisor') and (p_verb='read' or u.role='qc supervisor') end from public.users u where u.id=p_user),false)
$$;
create or replace function public.erp_qc_can(p_user uuid,p_action text) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r text; verb text; mode text;
begin
 select role into r from public.users where id=p_user and is_active and not must_change_password;
 if r is null then return false; end if;
 if r='qc supervisor' and p_action='create_doc' then return false; end if;
 if r in ('admin qc','administrator inbionusa') and p_action in ('create_produk','update_produk') then return true; end if;
 if p_action in ('manage_users','read_audit','delete_produk','delete_uji','delete_coa','delete_doc') then return r in ('admin qc','administrator inbionusa'); end if;
 verb:=case when p_action in ('create_uji','update_uji','save_draft','delete_draft') then 'write' when p_action in ('create_produk','update_produk','issue_coa','update_coa','create_doc') then 'approve' end;
 if verb is null then return false; end if;
 select state into mode from public.erp_modules where key='quality';
 return mode='active' and public.erp_can(p_user,'quality',verb);
end $$;
create or replace function public.erp_permissions(p_token text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; result jsonb;
begin
 u:=public.erp_actor(p_token);
 select coalesce(jsonb_agg(action),'[]'::jsonb) into result from unnest(array['manage_users','read_audit','delete_produk','delete_uji','delete_coa','delete_doc','create_doc','create_produk','update_produk','create_uji','update_uji','issue_coa','update_coa','save_draft','delete_draft']) action where public.erp_qc_can(u.id,action);
 return result;
end $$;
-- Keep the existing validated QC evaluator; replace only its authorization gate.
do $$declare source text; old_gate text; begin
 old_gate:=$old$or u.role not in ('admin qc','administrator inbionusa','qc supervisor')
 or (p_action in ('delete_produk','delete_uji','delete_coa','create_doc','delete_doc') and u.role='qc supervisor')$old$;
 source:=pg_get_functiondef('public.qc_mutate_core(text,text,jsonb)'::regprocedure);
 if position(old_gate in source)>0 then execute replace(source,old_gate,'or not public.erp_qc_can(u.id,p_action)');
 elsif position('erp_qc_can(u.id,p_action)' in source)=0 then raise exception 'Unrecognized QC evaluator authorization gate. Migration aborted.'; end if;
 source:=pg_get_functiondef('public.qc_mutate_v3(text,text,jsonb)'::regprocedure);
 if position($old$if u.role='viewer' then raise insufficient_privilege; end if;$old$ in source)>0 then execute replace(source,$old$if u.role='viewer' then raise insufficient_privilege; end if;$old$,'if not public.erp_qc_can(u.id,p_action) then raise insufficient_privilege; end if;');
 elsif position('erp_qc_can(u.id,p_action)' in source)=0 then raise exception 'Unrecognized inspection draft authorization gate. Migration aborted.'; end if;
 -- COA approval no longer requires a separate write grant.
 source:=pg_get_functiondef('public.qc_mutate_v4(text,text,jsonb)'::regprocedure);
 source:=replace(source,$old$perform public.erp_assert(u.id,'quality','write');$old$,$new$perform public.erp_assert(u.id,'quality',case when p_action in ('issue_coa','update_coa','create_doc') then 'approve' else 'write' end);$new$);
 execute source;
 -- Warehouse receivers can receive an authorized PO without editing commercial terms.
 source:=pg_get_functiondef('public.erp_mutate(text,text,jsonb)'::regprocedure);
 source:=replace(source,$old$('save_supplier','save_material','save_purchase','confirm_purchase','cancel_purchase','receive_purchase')$old$,$new$('save_supplier','save_material','save_purchase','confirm_purchase','cancel_purchase')$new$);
 source:=replace(source,$old$('issue_material','reverse_material_transaction')$old$,$new$('issue_material','reverse_material_transaction','receive_purchase')$new$);
 source:=replace(source,$old$elsif p_action='receive_purchase' then
  perform public.erp_assert(u.id,'warehouse','write');$old$,$new$elsif p_action='receive_purchase' then
  perform public.erp_assert(u.id,'purchase','read');
  perform public.erp_assert(u.id,'warehouse','write');$new$);
 execute source;
end $$;

-- Authorize before business validation, including all legacy QC entry paths.
do $$begin
 if to_regprocedure('public.qc_mutate_v7(text,text,jsonb)') is null then alter function public.qc_mutate(text,text,jsonb) rename to qc_mutate_v7; end if;
end $$;
create or replace function public.qc_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;
begin
 perform pg_advisory_xact_lock(49281041); u:=public.erp_actor(p_token);
 if not public.erp_qc_can(u.id,p_action) then raise insufficient_privilege using message='Access denied.'; end if;
 return public.qc_mutate_v7(p_token,p_action,p_payload);
end $$;
revoke all on function public.qc_mutate_v7(text,text,jsonb),public.qc_mutate(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.qc_mutate(text,text,jsonb) to service_role;

-- Revoke old sessions whenever a role or explicit access row changes.
create or replace function public.erp_revoke_access_sessions() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_table_name='users' then
  if new.role is distinct from old.role then delete from public.erp_access where user_id=new.id; delete from public.sessions where user_id=new.id; end if;
 elsif tg_op='DELETE' then delete from public.sessions where user_id=old.user_id;
 else delete from public.sessions where user_id=new.user_id; end if;
 return null;
end $$;
drop trigger if exists erp_access_sessions on public.erp_access;
create trigger erp_access_sessions after insert or update or delete on public.erp_access for each row execute function public.erp_revoke_access_sessions();
drop trigger if exists erp_role_sessions on public.users;
create trigger erp_role_sessions after update of role on public.users for each row execute function public.erp_revoke_access_sessions();
-- Administrators always retain full access; reject meaningless per-user overrides.
do $$begin
 if to_regprocedure('public.erp_mutate_v7(text,text,jsonb)') is null then alter function public.erp_mutate(text,text,jsonb) rename to erp_mutate_v7; end if;
 if to_regprocedure('public.erp_read_v7(text,text,text,text,integer,text)') is null then alter function public.erp_read(text,text,text,text,integer,text) rename to erp_read_v7; end if;
end $$;
create or replace function public.erp_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;
begin
 perform pg_advisory_xact_lock(49281041); u:=public.erp_actor(p_token);
 if p_action='set_access' and exists(select from public.users where id=(p_payload->>'user_id')::uuid and role in ('admin qc','administrator inbionusa')) then raise exception using errcode='P0001',message='Administrators always have full access. Assign an operational role before setting exceptions.'; end if;
 if p_action='reset_access' then
  if u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  if not exists(select from public.erp_modules where key=p_payload->>'module') then raise check_violation; end if;
  delete from public.erp_access where user_id=(p_payload->>'user_id')::uuid and module=p_payload->>'module';
  return jsonb_build_object('id',p_payload->>'user_id');
 end if;
 return public.erp_mutate_v7(p_token,p_action,p_payload);
end $$;

create or replace function public.erp_insights(p_token text,p_module text,p_days text default '30') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; result jsonb; extra jsonb; amounts jsonb;
begin
 u:=public.erp_actor(p_token); perform public.erp_assert(u.id,p_module,'read');
 if p_module not in ('production','warehouse','sales','purchase','crm','documents') then raise check_violation; end if;
 result:=public.erp_overview(p_token,p_module,p_days);
 extra:=case p_module
 when 'warehouse' then jsonb_build_array(
 jsonb_build_object('label','Finished lots expiring in 30 days','value',(select count(*) from public.erp_lots where expiry_date between public.erp_today() and public.erp_today()+30 and exists(select from public.erp_balances where lot_id=erp_lots.id and quantity>0)),'href','/dashboard/warehouse?view=lots'),
 jsonb_build_object('label','Open stock counts','value',(select count(*) from public.erp_counts where state in ('draft','counting','submitted')),'href','/dashboard/warehouse?view=counts'),
 jsonb_build_object('label','Material lots expired','value',(select count(distinct l.id) from public.erp_material_lots l join public.erp_material_balances b on b.lot_id=l.id where b.quantity>0 and l.expiry_date<public.erp_today()),'href','/dashboard/materials?view=material_stock&state=expired'))
 when 'production' then jsonb_build_array(
 jsonb_build_object('label','Awaiting quality release','value',(select count(*) from public.erp_lots where batch_number is not null and qc_status='quarantine' and exists(select from public.erp_balances where lot_id=erp_lots.id and quantity>0)),'href','/dashboard/warehouse?view=lots'))
 when 'sales' then jsonb_build_array(
 jsonb_build_object('label','Awaiting quotation approval','value',(select count(*) from public.erp_quotes where state='pending'),'href','/dashboard/sales?view=quotes&state=pending'),
 jsonb_build_object('label','Quotations expiring in 7 days','value',(select count(*) from public.erp_quotes where state='issued' and valid_until between public.erp_today() and public.erp_today()+7),'href','/dashboard/sales?view=quotes&state=issued'))
 when 'purchase' then jsonb_build_array(
 jsonb_build_object('label','Draft purchase orders','value',(select count(*) from public.erp_purchase_orders where state='draft'),'href','/dashboard/purchase?view=purchases&state=draft'),
 jsonb_build_object('label','Materials below minimum','value',(select count(*) from public.erp_growth_records where entity='materials' and state='low_stock'),'href','/dashboard/purchase?view=materials&state=low_stock'))
 when 'crm' then jsonb_build_array(
 jsonb_build_object('label','Won opportunities','value',(select count(*) from public.erp_opportunities where stage='won'),'href','/dashboard/crm?view=opportunities&state=won'),
 jsonb_build_object('label','Lost opportunities','value',(select count(*) from public.erp_opportunities where stage='lost'),'href','/dashboard/crm?view=opportunities&state=lost'))
 else jsonb_build_array(
 jsonb_build_object('label','Draft revisions','value',(select count(*) from public.erp_product_documents where state='draft'),'href','/dashboard/documents?state=draft'),
 jsonb_build_object('label','Expired published revisions','value',(select count(*) from public.erp_product_documents where state='published' and expiry_date<public.erp_today()),'href','/dashboard/documents?state=expired')) end;
 -- Commercial totals are exact strings and never mix currencies.
 if p_module='sales' then
  select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) into amounts from (select snapshot->>'currency' currency,sum((snapshot->'totals'->>'total')::numeric)::text amount from public.erp_orders where state='confirmed' group by snapshot->>'currency') v;
 elsif p_module='purchase' then
  select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) into amounts from (select p.currency,sum((l.quantity-l.received)*l.price)::text amount from public.erp_purchase_orders p join public.erp_purchase_lines l on l.order_id=p.id where p.state in ('confirmed','partial') group by p.currency) v;
 elsif p_module='crm' then
  select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) into amounts from (select currency,sum(expected_value)::text amount from public.erp_opportunities where stage not in ('won','lost') group by currency) v;
 end if;
 return result||jsonb_build_object('attention',extra,'amounts',coalesce(amounts,'[]'::jsonb),'amount_label',case p_module when 'sales' then 'Open order value' when 'purchase' then 'Outstanding purchase value' else 'Open pipeline value' end);
end $$;

create or replace function public.erp_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; rows jsonb; target uuid; role_name text; result jsonb;
begin
 if p_entity='insights' then return public.erp_insights(p_token,p_state,p_search); end if;
 if p_entity in ('effective_access','role_access') then
  u:=public.erp_actor(p_token);
  if u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  if p_entity='effective_access' then
   target:=p_id::uuid; select role into role_name from public.users where id=target;
   if not found then raise no_data_found; end if;
  else role_name:=p_search; end if;
  select jsonb_agg(jsonb_build_object('id',m.key,'name',m.key,'state',m.state,'can_read',case when target is not null then m.state<>'disabled' and public.erp_can(target,m.key,'read') else role_name in ('admin qc','administrator inbionusa') or coalesce(rp.can_read,role_name in ('viewer','qc supervisor') and m.key='quality') end,'can_write',case when target is not null then m.state='active' and public.erp_can(target,m.key,'write') else role_name in ('admin qc','administrator inbionusa') or coalesce(rp.can_write,role_name='qc supervisor' and m.key='quality') end,'can_approve',case when target is not null then m.state='active' and public.erp_can(target,m.key,'approve') else role_name in ('admin qc','administrator inbionusa') or coalesce(rp.can_approve,role_name='qc supervisor' and m.key='quality') end,'source',case when exists(select from public.erp_access where user_id=target and module=m.key) then 'User override' else 'Role default' end) order by m.key) into rows from public.erp_modules m left join public.erp_role_permissions rp on rp.role=role_name and rp.module=m.key;
  return jsonb_build_object('rows',rows,'total',jsonb_array_length(rows),'page',1,'page_size',50);
 end if;
 result:=public.erp_read_v7(p_token,p_entity,p_search,p_state,p_page,p_id);
 return result;
end $$;
alter table public.erp_role_permissions enable row level security;
revoke all on public.erp_role_permissions from public,anon,authenticated,service_role;
drop trigger if exists erp_audit on public.erp_role_permissions;
create trigger erp_audit after insert or update or delete on public.erp_role_permissions for each row execute function public.erp_audit();
do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'erp_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop;
end $$;
grant execute on function public.erp_read(text,text,text,text,integer,text),public.erp_mutate(text,text,jsonb),public.erp_module_guard(text,text,text),public.erp_permissions(text) to service_role;
notify pgrst,'reload schema';
commit;
