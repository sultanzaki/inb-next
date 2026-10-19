begin;
alter table public.hasil_uji add column if not exists superseded boolean not null default false;
-- Withdrawn certificates remain available to audit; only the current certificate occupies a lot.
alter table public.coa add column if not exists withdrawn boolean not null default false;
drop index if exists public.qc_unique_coa_lot;
create unique index qc_unique_coa_lot on public.coa(id_produk,no_lot) where not withdrawn;
do $$declare body text;begin
 body:=pg_get_functiondef('public.qc_mutate_core(text,text,jsonb)'::regprocedure);
 body:=replace(body,'where id_produk=h.id_produk and no_lot=h.no_lot)','where id_produk=h.id_produk and no_lot=h.no_lot and not withdrawn)');
 execute body;
end $$;
create or replace view public.available_hasil_uji with(security_invoker=true) as
 select h.* from public.hasil_uji h where h.status='PASS' and h.qc_version=1 and not h.superseded
 and not exists(select from public.coa c where c.id_hasil_uji=h.id or (c.id_produk=h.id_produk and c.no_lot=h.no_lot and not c.withdrawn));
-- One current inspection per lot, with immutable historical revisions for approved retests.
alter table public.hasil_uji add column if not exists superseded boolean not null default false;
alter table public.hasil_uji drop constraint if exists hasil_uji_id_produk_no_lot_key;
create unique index if not exists qc_current_inspection_lot on public.hasil_uji(id_produk,no_lot) where not superseded;
create or replace function public.qc_certified_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
 if tg_op='UPDATE' and new.superseded and not old.superseded and (to_jsonb(new)-'superseded'-'updated_at')=(to_jsonb(old)-'superseded'-'updated_at') and exists(select from public.erp_retests where previous_inspection=old.id and new_inspection is null) then return new;end if;
 if old.superseded then raise sqlstate '55000' using message='Superseded inspections are immutable.';end if;
 if exists(select from public.coa where id_hasil_uji=old.id or (id_produk=old.id_produk and no_lot=old.no_lot and not withdrawn)) then raise sqlstate '55000' using message='Certified inspections are immutable.';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create or replace function public.erp_archive_retest_inspection() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
 update public.hasil_uji set superseded=true where id=new.previous_inspection;return new;
end $$;
drop trigger if exists erp_archive_retest_inspection on public.erp_retests;
create trigger erp_archive_retest_inspection after insert on public.erp_retests for each row execute function public.erp_archive_retest_inspection();
-- Apply the withdrawal flag transactionally, without altering the signed snapshot.
create or replace function public.erp_mark_coa_withdrawn() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 update public.coa set withdrawn=true where id=new.coa_id;return new;
end $$;
drop trigger if exists erp_mark_coa_withdrawn on public.erp_coa_withdrawals;
create trigger erp_mark_coa_withdrawn after insert on public.erp_coa_withdrawals for each row execute function public.erp_mark_coa_withdrawn();
update public.coa set withdrawn=true where id in(select coa_id from public.erp_coa_withdrawals) and not withdrawn;
-- New actions are handled inside the same global transaction lock as all other ERP mutations.
do $$begin
 if to_regprocedure('public.erp_ops_mutate_v13(text,text,jsonb)') is null then alter function public.erp_ops_mutate(text,text,jsonb) rename to erp_ops_mutate_v13;end if;
end $$;
create or replace function public.erp_ops_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;c public.erp_cases;o public.erp_orders;p public.erp_purchase_orders;l public.erp_order_lines;pl public.erp_purchase_lines;ln jsonb;before_data jsonb;after_data jsonb;result jsonb;qty numeric;net numeric:=0;tax numeric;freight numeric;original numeric;lines jsonb:='[]';why text:=btrim(coalesce(p_payload->>'reason',''));r public.erp_returns;
begin
 if p_action not in ('ops_amend_order','ops_amend_purchase','ops_customer_return') then return public.erp_ops_mutate_v13(p_token,p_action,p_payload);end if;
 perform pg_advisory_xact_lock(49281041);u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'service','write');
 select * into c from public.erp_cases where id=(p_payload->>'id')::uuid for update;
 if not found or c.version<>(p_payload->>'version')::integer or c.state not in ('approved','in_progress') or length(why)<3 then raise check_violation;end if;
 if p_action='ops_customer_return' then
  perform public.erp_assert(u.id,'warehouse','write');
  if c.source_type<>'delivery' or c.resolution<>'return' or c.quantity is null then raise check_violation;end if;
  if exists(select from public.erp_case_executions where case_id=c.id and kind='retur_customer') then raise exception using errcode='P0001',message='A return request is already linked. Process it in Warehouse returns.';end if;
  result:=public.erp_mutate(p_token,'create_return',jsonb_build_object('delivery_id',c.source_id,'lot_id',c.lot_id,'location_id',p_payload->>'location_id','quantity',c.quantity::text,'reason',c.number||' · '||why));
  select * into r from public.erp_returns where id=(result->>'id')::uuid;
  insert into public.erp_case_executions(case_id,kind,quantity,reference,created_by) values(c.id,'retur_customer',0,r.id::text,u.id);
 else
  if c.kind<>'change_request' or c.resolution<>'correction' then raise check_violation;end if;
  if exists(select from public.erp_case_executions where case_id=c.id and kind='correction') then raise check_violation;end if;
  if p_action='ops_amend_order' then
   perform public.erp_assert(u.id,'sales','approve');
   if c.source_type<>'order' then raise check_violation;end if;
   select * into o from public.erp_orders where id=c.source_id for update;
   if o.state<>'confirmed' or exists(select from public.erp_movements where order_id=o.id and state='draft') or exists(select from public.erp_fin_documents where order_id=o.id and state<>'void') then raise exception using errcode='P0001',message='Resolve draft deliveries and billing before changing order quantities. Issued billing requires a credit/correction workflow.';end if;
   before_data:=to_jsonb(o)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(x)) from public.erp_order_lines x where order_id=o.id));
   if jsonb_array_length(p_payload->'lines')<>(select count(*) from public.erp_order_lines where order_id=o.id) then raise check_violation;end if;
   for ln in select * from jsonb_array_elements(p_payload->'lines') loop
    select * into l from public.erp_order_lines where id=(ln->>'line_id')::uuid and order_id=o.id;
    if not found or (select count(*) from jsonb_array_elements(p_payload->'lines') x where x->>'line_id'=l.id::text)<>1 then raise check_violation;end if;
    qty:=public.erp_qty(ln->>'quantity');if qty<l.delivered then raise check_violation;end if;
    -- Reservation changes are explicit: release all affected reservations before re-planning dispatch.
    update public.erp_reservations set state='cancelled',remaining=0 where order_line_id=l.id and state='active';
    original:=(l.snapshot->>'amount')::numeric/l.quantity;
    update public.erp_order_lines set quantity=qty,snapshot=snapshot||jsonb_build_object('base_quantity',qty::text,'quantity',round(coalesce((l.snapshot->>'quantity')::numeric,l.quantity)*qty/l.quantity,6)::text,'amount',round(qty*original,6)::text) where id=l.id;
    net:=net+round(qty*original,6);
   end loop;
   tax:=round(net*coalesce((o.snapshot->>'tax_rate')::numeric,0)/100,6);freight:=coalesce((o.snapshot->'totals'->>'freight')::numeric,0);
   select jsonb_agg(snapshot order by position) into lines from public.erp_order_lines where order_id=o.id;
   update public.erp_orders set snapshot=snapshot||jsonb_build_object('lines',lines,'totals',jsonb_build_object('subtotal',net::text,'tax',tax::text,'freight',freight::text,'total',(net+tax+freight)::text)) where id=o.id returning to_jsonb(erp_orders) into after_data;
   update public.erp_fin_terms set state='pending',approved_by=null,version=version+1 where order_id=o.id;
  else
   perform public.erp_assert(u.id,'purchase','approve');if c.source_type<>'purchase' then raise check_violation;end if;
   select * into p from public.erp_purchase_orders where id=c.source_id for update;
   if p.state not in ('confirmed','partial') or exists(select from public.erp_fin_documents where purchase_id=p.id and state<>'void') then raise exception using errcode='P0001',message='Only open purchases without billing can be amended. Use supplier credits for billed changes.';end if;
   before_data:=to_jsonb(p)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(x)) from public.erp_purchase_lines x where order_id=p.id));
   if jsonb_array_length(p_payload->'lines')<>(select count(*) from public.erp_purchase_lines where order_id=p.id) then raise check_violation;end if;
   for ln in select * from jsonb_array_elements(p_payload->'lines') loop
    select * into pl from public.erp_purchase_lines where id=(ln->>'line_id')::uuid and order_id=p.id;
    if not found or (select count(*) from jsonb_array_elements(p_payload->'lines') x where x->>'line_id'=pl.id::text)<>1 then raise check_violation;end if;
    qty:=public.erp_qty(ln->>'quantity');if qty<pl.received then raise exception using errcode='P0001',message='Amended quantity cannot be lower than received stock.';end if;
    update public.erp_purchase_lines set quantity=qty where id=pl.id;
   end loop;
   update public.erp_purchase_orders set expected_date=(p_payload->>'expected_date')::date,terms=p_payload->>'terms',version=version+1 where id=p.id;
   select to_jsonb(x)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(y)) from public.erp_purchase_lines y where order_id=p.id)) into after_data from public.erp_purchase_orders x where id=p.id;
  end if;
  insert into public.erp_amendments(source_type,source_id,before_data,after_data,reason,actor_id) values(c.source_type,c.source_id,before_data,after_data,why,u.id);
  insert into public.erp_case_executions(case_id,kind,reference,created_by) values(c.id,'correction',why,u.id);
 end if;
 update public.erp_cases set version=version+1,updated_at=now() where id=c.id;
 insert into public.erp_case_events(case_id,actor_id,event,notes) values(c.id,u.id,p_action,why);
 return jsonb_build_object('id',c.id,'entity','ops_cases');
end $$;
-- A physical customer return counts as completed only after goods are actually received.
create or replace function public.erp_link_return_case() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
 if new.state in ('received','released','scrapped') then update public.erp_case_executions set quantity=new.quantity,movement_id=new.receipt_id where kind='retur_customer' and reference=new.id::text;end if;
 return new;end $$;
drop trigger if exists erp_link_return_case on public.erp_returns;
create trigger erp_link_return_case after update on public.erp_returns for each row execute function public.erp_link_return_case();
revoke all on function public.erp_ops_mutate(text,text,jsonb),public.erp_ops_mutate_v13(text,text,jsonb),public.erp_mark_coa_withdrawn(),public.erp_link_return_case(),public.erp_archive_retest_inspection() from public,anon,authenticated,service_role;
-- Reversing a refund reopens its linked case; stale completion references cannot settle it.
create or replace function public.erp_fin_case_settled(p_case uuid,p_resolution text) returns numeric language sql stable set search_path=pg_catalog,public as $$
 select case when p_resolution='credit' then coalesce((select sum(a.amount) from public.erp_fin_credit_applications a join public.erp_fin_documents d on d.id=a.credit_id where d.case_id=p_case and d.state='issued'),0)
 else coalesce((select sum(a.amount) from public.erp_fin_allocations a join public.erp_fin_documents d on d.id=a.document_id join public.erp_fin_payments p on p.id=a.payment_id where d.case_id=p_case and d.state='issued' and a.state='active' and p.state='verified' and p.direction in ('refund','supplier_refund')),0) end
$$;
create or replace function public.erp_reopen_reversed_settlement() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare linked uuid;begin
 if old.state='active' and new.state='reversed' then
  select case_id into linked from public.erp_fin_documents where id=new.document_id;
  if linked is not null then
   update public.erp_cases set state='under_review',completion_evidence=null,version=version+1,updated_at=now() where id=linked;
   insert into public.erp_case_events(case_id,actor_id,event,notes) values(linked,new.reversed_by,'settlement_reversed',new.reversal_reason);
  end if;
 end if;return new;
end $$;
drop trigger if exists erp_reopen_reversed_settlement on public.erp_fin_allocations;
create trigger erp_reopen_reversed_settlement after update on public.erp_fin_allocations for each row execute function public.erp_reopen_reversed_settlement();
revoke all on function public.erp_fin_case_settled(uuid,text),public.erp_reopen_reversed_settlement() from public,anon,authenticated,service_role;
-- Lot counts describe the current inspection, while trend charts retain all test events.
do $$declare body text;begin
 body:=pg_get_functiondef('public.qc_quality_summary(text)'::regprocedure);
 body:=replace(body,'into counts from public.hasil_uji;','into counts from public.hasil_uji where not superseded;');
 execute body;
end $$;
-- Extend the existing bounded global search while retaining its module filtering.
do $$begin
 if to_regprocedure('public.qc_global_search_v13(text,text)') is null then alter function public.qc_global_search(text,text) rename to qc_global_search_v13;end if;
end $$;
create or replace function public.qc_global_search(p_token text,p_search text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;result jsonb;extra jsonb;pattern text;
begin
 u:=public.erp_actor(p_token);result:=public.qc_global_search_v13(p_token,p_search);
 if length(btrim(p_search))<2 or length(p_search)>100 then return result;end if;
 pattern:='%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%';
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into extra from (
 (select c.id,'Case'::text type,c.number title,c.title description,'/dashboard/service'::text path,null::text view,c.number query from public.erp_cases c where exists(select from public.erp_modules where key='service' and state<>'disabled') and public.erp_can(u.id,'service','read') and (c.number ilike pattern or c.title ilike pattern) order by c.created_at desc,c.id limit 8)
 union all (select d.id,'Billing',d.number,d.kind||' · '||d.currency,'/dashboard/finance','documents',d.number from public.erp_fin_documents d where exists(select from public.erp_modules where key='finance' and state<>'disabled') and public.erp_can(u.id,'finance','read') and (d.number ilike pattern or d.external_reference ilike pattern) order by d.created_at desc,d.id limit 8)
 union all (select p.id,'Payment',p.number,p.bank_reference,'/dashboard/finance','payments',p.number from public.erp_fin_payments p where exists(select from public.erp_modules where key='finance' and state<>'disabled') and public.erp_can(u.id,'finance','read') and (p.number ilike pattern or p.bank_reference ilike pattern) order by p.created_at desc,p.id limit 8)
 ) x;
 return result||extra;
end $$;
revoke all on function public.qc_global_search(text,text),public.qc_global_search_v13(text,text) from public,anon,authenticated,service_role;
grant execute on function public.qc_global_search(text,text) to service_role;
notify pgrst,'reload schema';
commit;
