begin;
-- Apply after 009. New workspaces are opt-in; existing records remain unchanged.
alter table public.erp_modules drop constraint if exists erp_modules_key_check;
alter table public.erp_modules add constraint erp_modules_key_check check(key in ('quality','warehouse','production','sales','purchase','crm','documents','service','finance'));
insert into public.erp_modules(key,state) values('service','disabled'),('finance','disabled') on conflict do nothing;
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check(role in ('admin qc','administrator inbionusa','qc supervisor','viewer','quality_manager','quality_officer','warehouse_manager','warehouse_operator','production_operator','purchasing_manager','purchasing_officer','sales_manager','sales_officer','service_manager','service_officer','finance_manager','finance_officer'));
insert into public.erp_role_permissions(role,module,can_read,can_write,can_approve) values
 ('service_manager','service',true,true,true),('service_officer','service',true,true,false),
 ('sales_manager','service',true,true,true),('sales_officer','service',true,true,false),('quality_manager','service',true,true,true),('quality_officer','service',true,true,false),('warehouse_manager','service',true,true,true),('warehouse_operator','service',true,true,false),('purchasing_manager','service',true,true,true),('purchasing_officer','service',true,true,false),
 ('finance_manager','finance',true,true,true),('finance_officer','finance',true,true,false),
 ('finance_manager','sales',true,false,false),('finance_officer','sales',true,false,false),('finance_manager','purchase',true,false,false),('finance_officer','purchase',true,false,false),('finance_manager','warehouse',true,false,false),('finance_officer','warehouse',true,false,false),('finance_manager','service',true,false,false),('finance_officer','service',true,false,false),
 ('service_manager','sales',true,false,false),('service_manager','purchase',true,false,false),('service_manager','warehouse',true,false,false),('service_manager','quality',true,false,false),('service_manager','documents',true,false,false),
 ('service_officer','sales',true,false,false),('service_officer','warehouse',true,false,false)
on conflict(role,module) do nothing;
create table if not exists public.erp_operating_policy(
 id boolean primary key default true check(id),backdate_days integer not null default 30 check(backdate_days between 0 and 3650),locked_through date,dual_approval boolean not null default false,version integer not null default 1);
insert into public.erp_operating_policy(id) values(true) on conflict do nothing;
create table if not exists public.erp_requests(
 request_key uuid primary key,actor_id uuid not null references public.users(id),action text not null,payload_hash text not null,result jsonb not null,created_at timestamptz not null default now());
create table if not exists public.erp_cases(
 id uuid primary key default gen_random_uuid(),number text unique not null,
 kind text not null check(kind in ('customer_claim','supplier_claim','receiving_exception','delivery_incident','quality_retest','recall','document_issue','change_request','supplier_return')),
 source_type text not null check(source_type in ('delivery','receipt','lot','product','order','purchase','document')),
 source_id uuid not null,source_snapshot jsonb not null,title text not null check(length(btrim(title)) between 1 and 200),
 description text not null default '',quantity numeric(24,6) check(quantity>0),lot_id uuid references public.erp_lots(id),
 state text not null default 'open' check(state in ('open','under_review','awaiting_approval','approved','in_progress','resolved','rejected','closed')),
 resolution text not null default '' check(resolution in ('','replacement','refund','credit','return','scrap','correction','no_action')),
 settlement_amount numeric(24,6) check(settlement_amount>0),decision_reason text,completion_evidence text,assigned_to uuid references public.users(id),due_date date,
 cost_payer text not null default 'undecided' check(cost_payer in ('undecided','company','customer','supplier','carrier','shared')),
 currency text not null default 'IDR' check(currency ~ '^[A-Z]{3}$'),estimated_cost numeric(24,6) not null default 0 check(estimated_cost>=0),actual_cost numeric(24,6) not null default 0 check(actual_cost>=0),
 evidence jsonb not null default '[]' check(jsonb_typeof(evidence)='array'),
 created_by uuid not null references public.users(id),approved_by uuid references public.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1);
alter table public.erp_cases add column if not exists settlement_amount numeric(24,6) check(settlement_amount>0);
create index if not exists erp_cases_queue on public.erp_cases(state,due_date,assigned_to);
create index if not exists erp_cases_source on public.erp_cases(source_type,source_id);
create table if not exists public.erp_case_events(id bigint generated always as identity primary key,case_id uuid not null references public.erp_cases(id),actor_id uuid not null references public.users(id),event text not null,notes text not null,data jsonb not null default '{}',created_at timestamptz not null default now());
create index if not exists erp_case_events_case on public.erp_case_events(case_id,id);
create table if not exists public.erp_delivery_receipts(
 delivery_id uuid primary key references public.erp_movements(id),recipient text not null,received_date date not null,
 status text not null check(status in ('received','partial','rejected','returned')),lines jsonb not null,evidence text not null,notes text not null default '',recorded_by uuid not null references public.users(id),created_at timestamptz not null default now(),version integer not null default 1);
create table if not exists public.erp_case_executions(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.erp_cases(id),kind text not null check(kind in ('replacement','supplier_return','retur_customer','financial','correction')),
 movement_id uuid references public.erp_movements(id),material_transaction_id uuid references public.erp_material_transactions(id),quantity numeric(24,6) not null default 0 check(quantity>=0),reference text not null default '',created_by uuid not null references public.users(id),created_at timestamptz not null default now());
create index if not exists erp_case_executions_case on public.erp_case_executions(case_id);
alter table public.erp_material_lots add column if not exists held boolean not null default false;
alter table public.erp_material_lots add column if not exists hold_reason text not null default '';
create table if not exists public.erp_retests(
 id uuid primary key default gen_random_uuid(),lot_id uuid not null references public.erp_lots(id),previous_inspection uuid references public.hasil_uji(id),new_inspection uuid references public.hasil_uji(id),case_id uuid references public.erp_cases(id),reason text not null,created_by uuid not null references public.users(id),created_at timestamptz not null default now());
create unique index if not exists erp_one_pending_retest on public.erp_retests(lot_id) where new_inspection is null;
create table if not exists public.erp_coa_withdrawals(
 id uuid primary key default gen_random_uuid(),coa_id uuid unique not null references public.coa(id),reason text not null,case_id uuid references public.erp_cases(id),created_by uuid not null references public.users(id),created_at timestamptz not null default now());
create table if not exists public.erp_amendments(
 id uuid primary key default gen_random_uuid(),source_type text not null check(source_type in ('order','purchase')),source_id uuid not null,before_data jsonb not null,after_data jsonb not null,reason text not null,actor_id uuid not null references public.users(id),created_at timestamptz not null default now());
create or replace function public.erp_money(v text,positive boolean default true) returns numeric language plpgsql immutable as $$
declare n numeric; begin
 if v is null or replace(v,',','.') !~ '^\d{1,15}(\.\d{1,6})?$' then raise exception using errcode='P0001',message='Use a non-negative amount with up to six decimals.'; end if;
 n:=replace(v,',','.')::numeric; if (positive and n<=0) or n>999999999999999 then raise check_violation; end if; return n;
end $$;
create or replace function public.erp_check_date(d date) returns void language plpgsql stable set search_path=pg_catalog,public as $$begin
 if d is null or d>public.erp_today() or exists(select from public.erp_operating_policy where (locked_through is not null and d<=locked_through) or d<public.erp_today()-backdate_days) then raise exception using errcode='P0001',message='The date is future-dated, locked, or outside the permitted backdate window.'; end if;
end $$;
create or replace function public.erp_approval(p_actor uuid,p_creator uuid,p_reason text) returns void language plpgsql stable set search_path=pg_catalog,public as $$begin
 if length(btrim(coalesce(p_reason,'')))<3 then raise exception using errcode='P0001',message='Enter an approval reason.'; end if;
 if p_actor=p_creator and not exists(select from public.users where id=p_actor and role in ('admin qc','administrator inbionusa')) then raise exception using errcode='P0001',message='A different authorized user must approve this record.'; end if;
end $$;
create or replace function public.erp_ops_source(p_user uuid,p_type text,p_id uuid) returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare r jsonb; scope text;
begin
 case p_type
 when 'delivery' then scope:='warehouse';select to_jsonb(m) into r from public.erp_movements m where id=p_id and kind='delivery' and state='posted';
 when 'receipt' then scope:='warehouse';select to_jsonb(m) into r from public.erp_material_transactions m where id=p_id and kind='receipt';
 when 'lot' then scope:='warehouse';select to_jsonb(l) into r from public.erp_lots l where id=p_id;
 when 'product' then scope:='quality';select to_jsonb(p) into r from public.master_produk p where id=p_id;
 when 'order' then scope:='sales';select to_jsonb(o) into r from public.erp_orders o where id=p_id;
 when 'purchase' then scope:='purchase';select to_jsonb(p) into r from public.erp_purchase_orders p where id=p_id;
 when 'document' then scope:='documents';select to_jsonb(d) into r from public.erp_product_documents d where id=p_id;
 else raise check_violation; end case;
 perform public.erp_assert(p_user,scope,'read'); if r is null then raise no_data_found; end if;return r;
end $$;
create or replace function public.erp_ops_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;c public.erp_cases;source jsonb;target uuid:=nullif(p_payload->>'id','')::uuid;why text:=btrim(coalesce(p_payload->>'reason',''));next_state text;qty numeric;done_qty numeric;lot public.erp_lots;ret jsonb;move uuid;unit uuid;material public.erp_material_lots;entry jsonb;line jsonb;total numeric;affected jsonb;
begin
 perform pg_advisory_xact_lock(49281041);u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'service','write');
 if p_action='ops_create_case' then
  if not ((p_payload->>'kind'='customer_claim' and p_payload->>'source_type' in ('delivery','order')) or (p_payload->>'kind'='delivery_incident' and p_payload->>'source_type'='delivery') or (p_payload->>'kind'='supplier_claim' and p_payload->>'source_type' in ('receipt','purchase')) or (p_payload->>'kind' in ('receiving_exception','supplier_return') and p_payload->>'source_type'='receipt') or (p_payload->>'kind'='quality_retest' and p_payload->>'source_type'='lot') or (p_payload->>'kind'='recall' and p_payload->>'source_type' in ('lot','product')) or (p_payload->>'kind'='document_issue' and p_payload->>'source_type'='document') or (p_payload->>'kind'='change_request' and p_payload->>'source_type' in ('order','purchase'))) then raise check_violation;end if;
  if nullif(p_payload->>'assigned_to','') is not null and not exists(select from public.users where id=(p_payload->>'assigned_to')::uuid and is_active and public.erp_can(id,'service','write')) then raise check_violation;end if;
  source:=public.erp_ops_source(u.id,p_payload->>'source_type',(p_payload->>'source_id')::uuid);
  if length(btrim(coalesce(p_payload->>'title','')))<1 or length(p_payload->>'title')>200 then raise check_violation; end if;
  if p_payload ? 'quantity' and nullif(p_payload->>'quantity','') is not null then qty:=public.erp_qty(p_payload->>'quantity'); end if;
  if p_payload->>'source_type'='delivery' and qty is not null then
   select * into lot from public.erp_lots where id=(p_payload->>'lot_id')::uuid;
   if not found or qty>coalesce((select sum((x->>'base_quantity')::numeric) from jsonb_array_elements(source->'lines') x where (x->>'lot_id')::uuid=lot.id),0) then raise exception using errcode='P0001',message='Choose a delivered lot and a claim quantity within the shipment.'; end if;
  end if;
  if jsonb_array_length(coalesce(p_payload->'evidence','[]'))>10 or exists(select from jsonb_array_elements_text(coalesce(p_payload->'evidence','[]')) e where e !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' or length(e)>2000) then raise check_violation; end if;
  insert into public.erp_cases(number,kind,source_type,source_id,source_snapshot,title,description,quantity,lot_id,assigned_to,due_date,created_by,evidence)
  values(public.erp_number('CASE'),p_payload->>'kind',p_payload->>'source_type',(p_payload->>'source_id')::uuid,source,btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),qty,lot.id,coalesce(nullif(p_payload->>'assigned_to','')::uuid,u.id),nullif(p_payload->>'due_date','')::date,u.id,coalesce(p_payload->'evidence','[]')) returning id into target;
 elsif p_action='ops_policy' then
  if u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  update public.erp_operating_policy set backdate_days=(p_payload->>'backdate_days')::integer,locked_through=nullif(p_payload->>'locked_through','')::date,dual_approval=(p_payload->>'dual_approval')::boolean,version=version+1 where version=(p_payload->>'version')::integer;
  if not found then raise exception using errcode='P0001',message='Policy changed. Reload.'; end if;return '{}'::jsonb;
 elsif p_action='ops_delivery_receipt' then
  if not (public.erp_can(u.id,'warehouse','write') or public.erp_can(u.id,'sales','write')) then raise insufficient_privilege; end if;
  perform public.erp_assert(u.id,case when public.erp_can(u.id,'warehouse','write') then 'warehouse' else 'sales' end,'write');
  source:=public.erp_ops_source(u.id,'delivery',(p_payload->>'delivery_id')::uuid);perform public.erp_check_date((p_payload->>'received_date')::date);
  if (p_payload->>'received_date')::date<(source->>'date')::date then raise check_violation; end if;
  if jsonb_typeof(p_payload->'lines')<>'array' or jsonb_array_length(p_payload->'lines')<>jsonb_array_length(source->'lines') then raise exception using errcode='P0001',message='Record received and rejected quantities for every delivery line.'; end if;
  for entry in select * from jsonb_array_elements(p_payload->'lines') loop
   select x into line from jsonb_array_elements(source->'lines') x where x->>'order_line_id'=entry->>'order_line_id' and x->>'lot_id'=entry->>'lot_id';
   if line is null or public.erp_qty(entry->>'accepted',false)+public.erp_qty(entry->>'rejected',false)>(line->>'base_quantity')::numeric or (select count(*) from jsonb_array_elements(p_payload->'lines') x where x->>'order_line_id'=entry->>'order_line_id' and x->>'lot_id'=entry->>'lot_id')<>1 then raise check_violation; end if;
   if (p_payload->>'status'='received' and (public.erp_qty(entry->>'accepted',false)<>(line->>'base_quantity')::numeric or public.erp_qty(entry->>'rejected',false)<>0)) or (p_payload->>'status' in ('rejected','returned') and public.erp_qty(entry->>'accepted',false)<>0) then raise check_violation;end if;
  end loop;
  if length(btrim(coalesce(p_payload->>'recipient','')))<1 or length(btrim(coalesce(p_payload->>'evidence','')))<3 then raise check_violation; end if;
  insert into public.erp_delivery_receipts(delivery_id,recipient,received_date,status,lines,evidence,notes,recorded_by) values((p_payload->>'delivery_id')::uuid,p_payload->>'recipient',(p_payload->>'received_date')::date,p_payload->>'status',p_payload->'lines',p_payload->>'evidence',coalesce(p_payload->>'notes',''),u.id);
  return jsonb_build_object('id',p_payload->>'delivery_id','entity','ops_receipts');
 elsif p_action='ops_material_hold' then
  if not (public.erp_can(u.id,'warehouse','approve') or public.erp_can(u.id,'quality','approve')) then raise insufficient_privilege; end if;
  perform public.erp_assert(u.id,case when exists(select from public.erp_modules where key='warehouse' and state='active') and public.erp_can(u.id,'warehouse','approve') then 'warehouse' else 'quality' end,'approve');
  if why='' then raise check_violation; end if;
  update public.erp_material_lots set held=(p_payload->>'hold')::boolean,hold_reason=why where id=target; if not found then raise no_data_found; end if;
  return jsonb_build_object('id',target,'entity','material_stock');
 else
  select * into c from public.erp_cases where id=target for update;if not found then raise no_data_found; end if;
  if c.version<>(p_payload->>'version')::integer or not (p_payload ? 'version') then raise exception using errcode='P0001',message='Case changed. Reload before acting.'; end if;
  if p_action='ops_case_comment' then
   if why='' then raise check_violation; end if;
  elsif p_action='ops_assign_case' then
   if not exists(select from public.users where id=(p_payload->>'assigned_to')::uuid and is_active and public.erp_can(id,'service','write')) then raise check_violation; end if;
   update public.erp_cases set assigned_to=(p_payload->>'assigned_to')::uuid,due_date=nullif(p_payload->>'due_date','')::date where id=c.id;
  elsif p_action='ops_case_transition' then
   next_state:=p_payload->>'state';
   if not ((c.state='open' and next_state='under_review') or (c.state in ('open','under_review') and next_state='awaiting_approval') or (c.state='awaiting_approval' and next_state in ('approved','rejected','under_review')) or (c.state='approved' and next_state='in_progress') or (c.state='in_progress' and next_state='resolved') or (c.state in ('resolved','rejected') and next_state='closed')) then raise exception using errcode='P0001',message='Invalid case transition.'; end if;
   if next_state in ('approved','rejected') then
    perform public.erp_assert(u.id,'service','approve');perform public.erp_approval(u.id,c.created_by,why);
    if next_state='approved' and coalesce(p_payload->>'resolution','')='' then raise check_violation; end if;
    if next_state='approved' and c.quantity is not null and c.source_type='delivery' and c.lot_id is not null then
     select coalesce(sum(quantity),0) into done_qty from public.erp_cases where source_type=c.source_type and source_id=c.source_id and lot_id=c.lot_id and id<>c.id and state in ('approved','in_progress','resolved','closed') and resolution<>'no_action';
     if done_qty+c.quantity>(select sum((x->>'base_quantity')::numeric) from jsonb_array_elements(c.source_snapshot->'lines') x where (x->>'lot_id')::uuid=c.lot_id) then raise exception using errcode='P0001',message='Approved claims exceed the original shipment quantity.'; end if;
    end if;
    if next_state='approved' and p_payload->>'resolution' in ('refund','credit') then perform public.erp_money(p_payload->>'settlement_amount');end if;
    update public.erp_cases set settlement_amount=case when p_payload->>'resolution' in ('refund','credit') then public.erp_money(p_payload->>'settlement_amount') else null end,resolution=coalesce(p_payload->>'resolution','no_action'),decision_reason=why,approved_by=u.id,cost_payer=coalesce(p_payload->>'cost_payer','undecided'),currency=coalesce(p_payload->>'currency','IDR'),estimated_cost=public.erp_money(coalesce(p_payload->>'estimated_cost','0'),false) where id=c.id;
   end if;
   if next_state='resolved' then
    if length(why)<3 then raise exception using errcode='P0001',message='Record completion evidence before resolving the case.'; end if;
    if c.resolution in ('replacement','return') and coalesce((select sum(e.quantity) from public.erp_case_executions e left join public.erp_movements m on m.id=e.movement_id where e.case_id=c.id and (e.movement_id is null or m.state='posted') and (e.material_transaction_id is null or not exists(select from public.erp_material_transactions where reverses=e.material_transaction_id))),0)<coalesce(c.quantity,0) then raise exception using errcode='P0001',message='Complete the approved physical resolution first.'; end if;
    if c.resolution in ('refund','credit') and exists(select from public.erp_modules where key='finance' and state<>'disabled') and public.erp_fin_case_settled(c.id,c.resolution)<c.settlement_amount then raise exception using errcode='P0001',message='Verified settlement is below the approved claim amount.';end if;
    if c.resolution in ('refund','credit') and not exists(select from public.erp_case_executions where case_id=c.id and kind='financial') then raise exception using errcode='P0001',message='Record the financial settlement reference first.'; end if;
    update public.erp_cases set completion_evidence=why,actual_cost=public.erp_money(coalesce(p_payload->>'actual_cost','0'),false) where id=c.id;
   end if;
   update public.erp_cases set state=next_state where id=c.id;
  elsif p_action='ops_settlement_reference' then
   perform public.erp_assert(u.id,'service','approve');if c.state not in ('approved','in_progress') or length(why)<3 then raise check_violation; end if;
   if exists(select from public.erp_modules where key='finance' and state<>'disabled') then raise exception using errcode='P0001',message='Use the linked Finance settlement while Finance is enabled.'; end if;
   insert into public.erp_case_executions(case_id,kind,reference,created_by) values(c.id,'financial',why,u.id);
  elsif p_action='ops_retest' then
   perform public.erp_assert(u.id,'quality','approve');
   if c.source_type<>'lot' or c.state not in ('approved','in_progress') or why='' then raise check_violation; end if;
   select * into lot from public.erp_lots where id=c.source_id for update;
   insert into public.erp_retests(lot_id,previous_inspection,case_id,reason,created_by) values(lot.id,lot.inspection_id,c.id,why,u.id);
   update public.erp_lots set inspection_id=null,held=true,qc_status='quarantine' where id=lot.id;
  elsif p_action='ops_withdraw_coa' then
   perform public.erp_assert(u.id,'quality','approve');
   if c.source_type not in ('lot','product') or why='' or c.state not in ('approved','in_progress') then raise check_violation; end if;
   if not exists(select from public.coa where id=(p_payload->>'coa_id')::uuid and id_produk=coalesce((c.source_snapshot->>'product_id')::uuid,(c.source_snapshot->>'id')::uuid)) then raise check_violation; end if;
   insert into public.erp_coa_withdrawals(coa_id,reason,case_id,created_by) values((p_payload->>'coa_id')::uuid,why,c.id,u.id);
   update public.erp_lots set held=true,qc_status='quarantine' where inspection_id=(select id_hasil_uji from public.coa where id=(p_payload->>'coa_id')::uuid);
  elsif p_action in ('ops_replacement','ops_supplier_return') then
   if c.state not in ('approved','in_progress') or c.quantity is null then raise check_violation; end if;
   if c.cost_payer='undecided' then raise exception using errcode='P0001',message='Approve the delivery cost responsibility before execution.'; end if;
   qty:=public.erp_qty(p_payload->>'quantity');select coalesce(sum(e.quantity),0) into done_qty from public.erp_case_executions e where e.case_id=c.id and e.kind in ('replacement','supplier_return') and (e.movement_id is null or exists(select from public.erp_movements where id=e.movement_id and state='posted')) and (e.material_transaction_id is null or not exists(select from public.erp_material_transactions where reverses=e.material_transaction_id));
   if done_qty+qty>c.quantity then raise exception using errcode='P0001',message='Execution exceeds the approved case quantity.'; end if;
   perform public.erp_assert(u.id,'warehouse','write');
   if p_action='ops_replacement' then
    if c.resolution<>'replacement' or c.source_type<>'delivery' then raise check_violation; end if;
    select * into lot from public.erp_lots where id=(p_payload->>'lot_id')::uuid;
    if not found or lot.product_id<>(select product_id from public.erp_lots where id=c.lot_id) or lot.held or lot.qc_status<>'released' or lot.expiry_date<public.erp_today() or lot.expiry_date is null then raise exception using errcode='P0001',message='Choose an eligible released replacement lot for the original product.'; end if;
    if exists(select from public.erp_modules where key='quality' and state<>'disabled') and not exists(select from public.coa co where co.id_hasil_uji=lot.inspection_id and co.tanggal_expired=lot.expiry_date and not exists(select from public.erp_coa_withdrawals where coa_id=co.id)) then raise exception using errcode='P0001',message='Issue a valid COA before the replacement shipment.'; end if;
    select unit_id into unit from public.erp_product_units where product_id=lot.product_id and is_base;
    ret:=public.erp_mutate(p_token,'save_move',jsonb_build_object('kind','issue','date',public.erp_today(),'from_location',p_payload->>'location_id','reason','Replacement '||c.number||' · '||why,'lines',jsonb_build_array(jsonb_build_object('lot_id',lot.id,'unit_id',unit,'quantity',qty::text))));
    move:=(ret->>'id')::uuid;perform public.erp_mutate(p_token,'post_move',jsonb_build_object('id',move));
    insert into public.erp_case_executions(case_id,kind,movement_id,quantity,created_by) values(c.id,'replacement',move,qty,u.id);
   else
    if c.resolution<>'return' or c.source_type<>'receipt' then raise check_violation; end if;
    select * into material from public.erp_material_lots where id=(p_payload->>'lot_id')::uuid;
    if not exists(select from public.erp_material_ledger where transaction_id=c.source_id and lot_id=material.id and delta>0) then raise check_violation; end if;
    if qty+coalesce((select sum(e.quantity) from public.erp_case_executions e join public.erp_cases cc on cc.id=e.case_id join public.erp_material_ledger ml on ml.transaction_id=e.material_transaction_id and ml.lot_id=material.id where cc.source_id=c.source_id and e.kind='supplier_return' and not exists(select from public.erp_material_transactions where reverses=e.material_transaction_id)),0)>(select sum(delta) from public.erp_material_ledger where transaction_id=c.source_id and lot_id=material.id) then raise check_violation; end if;
    -- An approved supplier return may consume held/expired goods; a normal issue may not.
    select quantity into total from public.erp_material_balances where lot_id=material.id and location_id=(p_payload->>'location_id')::uuid for update;
    if not found or total<qty then raise exception using errcode='P0001',message='Insufficient material stock for the approved supplier return.';end if;
    perform public.erp_check_date(public.erp_today());
    insert into public.erp_material_transactions(request_key,number,kind,date,reason,created_by) values(gen_random_uuid(),public.erp_number('SRT'),'issue',public.erp_today(),'Supplier return '||c.number||' · '||why,u.id) returning id into move;
    update public.erp_material_balances set quantity=quantity-qty where lot_id=material.id and location_id=(p_payload->>'location_id')::uuid;
    insert into public.erp_material_ledger(transaction_id,lot_id,location_id,delta) values(move,material.id,(p_payload->>'location_id')::uuid,-qty);
    insert into public.erp_case_executions(case_id,kind,material_transaction_id,quantity,created_by) values(c.id,'supplier_return',move,qty,u.id);
   end if;
  else raise exception using errcode='P0001',message='Unknown operational action.'; end if;
  update public.erp_cases set version=version+1,updated_at=now() where id=c.id;
 end if;
 insert into public.erp_case_events(case_id,actor_id,event,notes,data) values(target,u.id,p_action,why,p_payload- 'request_key');
 return jsonb_build_object('id',target,'entity','ops_cases');
end $$;
-- Read model is deliberately bounded and omits large source snapshots on lists.
create or replace function public.erp_ops_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;rows jsonb;total bigint;
begin
 u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'service','read');
 if p_page<1 or p_page>1000000 or length(p_search)>100 or length(p_state)>30 then raise check_violation; end if;
 if p_entity='ops_cases' then
  select count(*) into total from public.erp_cases c where (p_id is null or c.id::text=p_id) and (p_state='' or c.state=p_state or (p_state='overdue' and c.due_date<public.erp_today() and c.state not in ('closed','rejected','resolved'))) and (p_search='' or c.number ilike '%'||p_search||'%' or c.title ilike '%'||p_search||'%');
  select coalesce(jsonb_agg(body),'[]') into rows from (select (to_jsonb(c)-'source_snapshot')||jsonb_build_object('source_number',coalesce(c.source_snapshot->>'number',c.source_snapshot->>'nama_produk',c.source_snapshot->>'title'),'label',c.number||' · '||c.title,'name',c.title,'quantity',c.quantity::text,'estimated_cost',c.estimated_cost::text,'actual_cost',c.actual_cost::text,'assignee',a.nama_lengkap,'events',case when p_id is not null then coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('actor',u2.nama_lengkap) order by e.id) from public.erp_case_events e join public.users u2 on u2.id=e.actor_id where case_id=c.id),'[]') else '[]'::jsonb end,'executions',case when p_id is not null then coalesce((select jsonb_agg(to_jsonb(e)) from public.erp_case_executions e where case_id=c.id),'[]') else '[]'::jsonb end) body from public.erp_cases c left join public.users a on a.id=c.assigned_to where (p_id is null or c.id::text=p_id) and (p_state='' or c.state=p_state or (p_state='overdue' and c.due_date<public.erp_today() and c.state not in ('closed','rejected','resolved'))) and (p_search='' or c.number ilike '%'||p_search||'%' or c.title ilike '%'||p_search||'%') order by c.created_at desc,c.id limit 50 offset (p_page-1)*50) q;
 elsif p_entity='ops_owners' then
  select count(*) into total from public.users where is_active and public.erp_can(id,'service','write') and nama_lengkap ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select id,nama_lengkap name from public.users where is_active and public.erp_can(id,'service','write') and nama_lengkap ilike '%'||p_search||'%' order by nama_lengkap,id limit 50 offset (p_page-1)*50) r;
 elsif p_entity='ops_policy' then
  if u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  select jsonb_agg(to_jsonb(p)) into rows from public.erp_operating_policy p;total:=1;
 elsif p_entity='ops_receipts' then
  perform public.erp_assert(u.id,'warehouse','read');
  select count(*) into total from public.erp_delivery_receipts r join public.erp_movements m on m.id=r.delivery_id where (p_id is null or r.delivery_id::text=p_id) and (p_state='' or r.status=p_state) and m.number ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (select r.*,r.delivery_id id,m.number,m.number label from public.erp_delivery_receipts r join public.erp_movements m on m.id=r.delivery_id where (p_id is null or r.delivery_id::text=p_id) and (p_state='' or r.status=p_state) and m.number ilike '%'||p_search||'%' order by r.created_at desc limit 50 offset (p_page-1)*50) q;
 elsif p_entity='ops_certificates' then
  perform public.erp_assert(u.id,'quality','read');
  select count(*) into total from public.coa co where (p_id is null or co.id::text=p_id) and co.no_coa ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (select co.id,co.no_coa number,co.no_coa label from public.coa co where (p_id is null or co.id::text=p_id) and co.no_coa ilike '%'||p_search||'%' order by co.id limit 50 offset (p_page-1)*50) q;
 elsif p_entity='ops_material_receipts' then
  perform public.erp_assert(u.id,'warehouse','read');
  select count(*) into total from public.erp_material_transactions where kind='receipt' and number ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (select id,number,number label,date from public.erp_material_transactions where kind='receipt' and number ilike '%'||p_search||'%' order by created_at desc,id limit 50 offset (p_page-1)*50) q;
 else raise check_violation; end if;
 return jsonb_build_object('rows',coalesce(rows,'[]'),'total',total,'page',p_page,'page_size',50);
end $$;
-- Install access protections now; 012 exposes only the authorized root RPCs.
do $$declare t text;begin
 foreach t in array array['erp_operating_policy','erp_requests','erp_cases','erp_case_events','erp_delivery_receipts','erp_case_executions','erp_retests','erp_coa_withdrawals','erp_amendments'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  if t not in ('erp_requests','erp_case_events') then execute format('drop trigger if exists erp_audit on public.%I',t);execute format('create trigger erp_audit after insert or update or delete on public.%I for each row execute function public.erp_audit()',t);end if;
 end loop;
end $$;
revoke all on function public.erp_ops_mutate(text,text,jsonb),public.erp_ops_read(text,text,text,text,integer,text),public.erp_ops_source(uuid,text,uuid),public.erp_money(text,boolean),public.erp_approval(uuid,uuid,text),public.erp_check_date(date) from public,anon,authenticated,service_role;
commit;
