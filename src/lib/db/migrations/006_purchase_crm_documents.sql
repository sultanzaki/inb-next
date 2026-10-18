begin;
-- Apply after 005. Forward-only: no existing stock, customers or product records are rewritten.
alter table public.erp_modules drop constraint if exists erp_modules_key_check;
alter table public.erp_modules add constraint erp_modules_key_check check(key in ('quality','warehouse','production','sales','purchase','crm','documents'));
insert into public.erp_modules(key) values('purchase'),('crm'),('documents') on conflict do nothing;
create table if not exists public.erp_suppliers(
 id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 1 and 200),contact text not null default '',email text not null default '',phone text not null default '',address text not null default '',tax_id text not null default '',payment_terms text not null default '',active boolean not null default true,version integer not null default 1);
create table if not exists public.erp_materials(
 id uuid primary key default gen_random_uuid(),code text unique not null check(length(btrim(code)) between 1 and 40),name text not null check(length(btrim(name)) between 1 and 200),unit_id uuid not null references public.erp_units(id),minimum_stock numeric(24,6) not null default 0 check(minimum_stock>=0),active boolean not null default true,version integer not null default 1);
create table if not exists public.erp_purchase_orders(
 id uuid primary key default gen_random_uuid(),number text unique not null,supplier_id uuid not null references public.erp_suppliers(id),date date not null,expected_date date not null,currency text not null check(currency ~ '^[A-Z]{3}$'),terms text not null default '',state text not null default 'draft' check(state in ('draft','confirmed','partial','received','cancelled')),version integer not null default 1,snapshot jsonb,reason text,created_by uuid not null references public.users(id),created_at timestamptz not null default now(),check(expected_date>=date));
create table if not exists public.erp_purchase_lines(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.erp_purchase_orders(id),position integer not null,material_id uuid not null references public.erp_materials(id),quantity numeric(24,6) not null check(quantity>0 and quantity<=1000000000),price numeric(24,6) not null check(price>=0 and price<=1000000000),received numeric(24,6) not null default 0 check(received>=0 and received<=quantity),snapshot jsonb not null,unique(order_id,position));
create table if not exists public.erp_material_lots(
 id uuid primary key default gen_random_uuid(),material_id uuid not null references public.erp_materials(id),supplier_id uuid not null references public.erp_suppliers(id),number text not null check(length(btrim(number)) between 1 and 150),expiry_date date,unique(material_id,supplier_id,number));
create table if not exists public.erp_material_balances(
 lot_id uuid not null references public.erp_material_lots(id),location_id uuid not null references public.erp_locations(id),quantity numeric(24,6) not null check(quantity>=0),primary key(lot_id,location_id));
create table if not exists public.erp_material_transactions(
 id uuid primary key default gen_random_uuid(),request_key uuid not null unique,number text not null unique,kind text not null check(kind in ('receipt','issue','reversal')),order_id uuid references public.erp_purchase_orders(id),date date not null,reason text not null default '',created_by uuid not null references public.users(id),created_at timestamptz not null default now());
alter table public.erp_material_transactions drop constraint if exists erp_material_transactions_kind_check;
alter table public.erp_material_transactions add constraint erp_material_transactions_kind_check check(kind in ('receipt','issue','reversal'));
alter table public.erp_material_transactions add column if not exists reverses uuid unique references public.erp_material_transactions(id);
create table if not exists public.erp_material_ledger(
 id bigint generated always as identity primary key,transaction_id uuid not null references public.erp_material_transactions(id),order_line_id uuid references public.erp_purchase_lines(id),lot_id uuid not null references public.erp_material_lots(id),location_id uuid not null references public.erp_locations(id),delta numeric(24,6) not null check(delta<>0),created_at timestamptz not null default now());
create index if not exists erp_material_ledger_trace on public.erp_material_ledger(lot_id,id desc);
create index if not exists erp_purchase_pending on public.erp_purchase_orders(state,expected_date);
create table if not exists public.erp_opportunities(
 id uuid primary key default gen_random_uuid(),number text unique not null,title text not null check(length(btrim(title)) between 1 and 200),company text not null check(length(btrim(company)) between 1 and 200),contact text not null default '',email text not null default '',phone text not null default '',source text not null default '',notes text not null default '',owner_id uuid not null references public.users(id),customer_id uuid references public.erp_customers(id),stage text not null default 'lead' check(stage in ('lead','qualified','proposal','won','lost')),expected_value numeric(24,6) not null default 0 check(expected_value>=0),currency text not null default 'IDR' check(currency ~ '^[A-Z]{3}$'),probability integer not null default 10 check(probability between 0 and 100),expected_close date,loss_reason text,version integer not null default 1,created_at timestamptz not null default now());
create index if not exists erp_crm_pipeline on public.erp_opportunities(stage,owner_id,expected_close);
create table if not exists public.erp_crm_activities(
 id uuid primary key default gen_random_uuid(),opportunity_id uuid not null references public.erp_opportunities(id),title text not null check(length(btrim(title)) between 1 and 200),kind text not null check(kind in ('call','email','meeting','task')),due_date date not null,assigned_to uuid not null references public.users(id),state text not null default 'open' check(state in ('open','done','cancelled')),notes text not null default '',created_at timestamptz not null default now());
create index if not exists erp_crm_activity_opportunity on public.erp_crm_activities(opportunity_id,due_date);
create index if not exists erp_crm_activity_due on public.erp_crm_activities(state,due_date,assigned_to);
alter table public.erp_quotes add column if not exists opportunity_id uuid references public.erp_opportunities(id);
create index if not exists erp_quote_opportunity on public.erp_quotes(opportunity_id);
create table if not exists public.erp_product_documents(
 id uuid primary key default gen_random_uuid(),number text unique not null,product_id uuid not null references public.master_produk(id),kind text not null check(kind in ('SDS','TDS','HALAL','ISO','OTHER')),language text not null check(language in ('en','id')),revision integer not null check(revision>0),title text not null check(length(btrim(title)) between 1 and 200),file_url text not null check(file_url ~ '^https://[^[:space:]]+$' and length(file_url)<=2000),effective_date date not null,expiry_date date,notes text not null default '',state text not null default 'draft' check(state in ('draft','published','superseded','withdrawn')),version integer not null default 1,created_by uuid not null references public.users(id),created_at timestamptz not null default now(),published_at timestamptz,reason text,unique(product_id,kind,language,revision),check(expiry_date is null or expiry_date>=effective_date));
create unique index if not exists erp_document_current on public.erp_product_documents(product_id,kind,language) where state='published';
create index if not exists erp_document_expiry on public.erp_product_documents(expiry_date) where state='published';
drop trigger if exists erp_immutable on public.erp_material_ledger;
create trigger erp_immutable before update or delete on public.erp_material_ledger for each row execute function public.erp_guard_immutable();
drop trigger if exists erp_immutable on public.erp_material_transactions;
create trigger erp_immutable before update or delete on public.erp_material_transactions for each row execute function public.erp_guard_immutable();

do $$begin
 if to_regprocedure('public.erp_mutate_v5(text,text,jsonb)') is null then alter function public.erp_mutate(text,text,jsonb) rename to erp_mutate_v5; end if;
 if to_regprocedure('public.erp_overview_v5(text,text,text)') is null then alter function public.erp_overview(text,text,text) rename to erp_overview_v5; end if;
 if to_regprocedure('public.erp_read_v5(text,text,text,text,integer,text)') is null then alter function public.erp_read(text,text,text,text,integer,text) rename to erp_read_v5; end if;
end $$;
create or replace function public.erp_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
declare u public.users; target uuid:=nullif(p_payload->>'id','')::uuid; result uuid; e jsonb; po public.erp_purchase_orders; pl public.erp_purchase_lines; mat public.erp_materials; opp public.erp_opportunities; doc public.erp_product_documents; lot public.erp_material_lots; supplier public.erp_suppliers; pos integer:=0; qty numeric; price numeric; bal numeric; request_id uuid; tx uuid; original public.erp_material_transactions; entry record; why text:=btrim(coalesce(p_payload->>'reason','')); ver integer:=nullif(p_payload->>'version','')::integer; scope text; prior jsonb;
begin
 perform pg_advisory_xact_lock(49281041); u:=public.erp_actor(p_token);
 if octet_length(p_payload::text)>262144 then raise check_violation; end if;
 if p_action='set_module' and p_payload->>'state'='disabled' then
  if u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  if p_payload->>'module'='purchase' and exists(select from public.erp_purchase_orders where state in ('draft','confirmed','partial')) then raise exception using errcode='P0001',message='Resolve open purchase orders or use read-only.'; end if;
  if p_payload->>'module'='warehouse' and exists(select from public.erp_purchase_orders where state in ('confirmed','partial')) then raise exception using errcode='P0001',message='Resolve open purchase receipts or use read-only.'; end if;
 end if;
 if p_action='revise_quote' then
  prior:=public.erp_mutate_v5(p_token,p_action,p_payload);
  update public.erp_quotes set opportunity_id=(select opportunity_id from public.erp_quotes where id=target) where id=(prior->>'id')::uuid;
  return prior;
 end if;
 if p_action='save_quote' then
  -- Keeping an existing Sales source is allowed when CRM is paused; creating
  -- or changing a source association still needs active CRM read access.
  if nullif(p_payload->>'opportunity_id','') is not null and not exists(
   select from public.erp_quotes where id=target and opportunity_id=(p_payload->>'opportunity_id')::uuid and customer_id=(p_payload->>'customer_id')::uuid
  ) then
   perform public.erp_assert(u.id,'crm','read');
   select * into opp from public.erp_opportunities where id=(p_payload->>'opportunity_id')::uuid;
   if not found or opp.customer_id is distinct from (p_payload->>'customer_id')::uuid or opp.stage='lost' then raise exception using errcode='P0001',message='Select an opportunity linked to this customer.'; end if;
  end if;
  prior:=public.erp_mutate_v5(p_token,p_action,p_payload);
  update public.erp_quotes set opportunity_id=nullif(p_payload->>'opportunity_id','')::uuid where id=(prior->>'id')::uuid;
  return prior;
 end if;
 scope:=case when p_action in ('save_supplier','save_material','save_purchase','confirm_purchase','cancel_purchase','receive_purchase') then 'purchase' when p_action in ('issue_material','reverse_material_transaction') then 'warehouse' when p_action in ('save_opportunity','stage_opportunity','convert_opportunity','save_crm_activity','complete_crm_activity') then 'crm' when p_action in ('save_product_document','publish_product_document','withdraw_product_document') then 'documents' end;
 if scope is null then return public.erp_mutate_v5(p_token,p_action,p_payload); end if;
 perform public.erp_assert(u.id,scope,case
  when p_action in ('confirm_purchase','publish_product_document','withdraw_product_document','reverse_material_transaction') then 'approve'
  when p_action='cancel_purchase' and exists(select from public.erp_purchase_orders where id=target and state<>'draft') then 'approve'
  else 'write' end);
 if p_action='save_supplier' then
  if target is null then insert into public.erp_suppliers(name) values(btrim(p_payload->>'name')) returning id into target;
  else perform 1 from public.erp_suppliers where id=target and version=ver for update; if not found then raise exception using errcode='P0001',message='Supplier changed. Reload before editing.'; end if; end if;
  update public.erp_suppliers set name=btrim(p_payload->>'name'),contact=coalesce(p_payload->>'contact',''),email=coalesce(p_payload->>'email',''),phone=coalesce(p_payload->>'phone',''),address=coalesce(p_payload->>'address',''),tax_id=coalesce(p_payload->>'tax_id',''),payment_terms=coalesce(p_payload->>'payment_terms',''),active=coalesce((p_payload->>'active')::boolean,true),version=version+1 where id=target;
 elsif p_action='save_material' then
  if target is not null then
   select * into mat from public.erp_materials where id=target for update;
   if not found or mat.version is distinct from ver then raise exception using errcode='P0001',message='Material changed. Reload before editing.'; end if;
   if mat.unit_id<>(p_payload->>'unit_id')::uuid and exists(select from public.erp_purchase_lines where material_id=target) then raise exception using errcode='P0001',message='The base unit is locked after the first purchase.'; end if;
  else target:=gen_random_uuid(); end if;
  insert into public.erp_materials(id,code,name,unit_id,minimum_stock,active) values(target,btrim(p_payload->>'code'),btrim(p_payload->>'name'),(p_payload->>'unit_id')::uuid,public.erp_qty(coalesce(p_payload->>'minimum_stock','0'),false),coalesce((p_payload->>'active')::boolean,true)) on conflict(id) do update set code=excluded.code,name=excluded.name,unit_id=excluded.unit_id,minimum_stock=excluded.minimum_stock,active=excluded.active,version=erp_materials.version+1;
 elsif p_action='save_purchase' then
  select * into supplier from public.erp_suppliers where id=(p_payload->>'supplier_id')::uuid and active;
  if not found then raise exception using errcode='P0001',message='Choose an active supplier.'; end if;
  if target is null then
   insert into public.erp_purchase_orders(number,supplier_id,date,expected_date,currency,terms,created_by) values(public.erp_number('PO'),supplier.id,(p_payload->>'date')::date,(p_payload->>'expected_date')::date,p_payload->>'currency',coalesce(p_payload->>'terms',''),u.id) returning id into target;
  else
   select * into po from public.erp_purchase_orders where id=target for update;
   if not found or po.state<>'draft' or po.version is distinct from ver then raise exception using errcode='P0001',message='Purchase order changed or is no longer a draft.'; end if;
   update public.erp_purchase_orders set supplier_id=supplier.id,date=(p_payload->>'date')::date,expected_date=(p_payload->>'expected_date')::date,currency=p_payload->>'currency',terms=coalesce(p_payload->>'terms',''),version=version+1 where id=target;
   delete from public.erp_purchase_lines where order_id=target;
  end if;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise check_violation; end if;
  for e in select * from jsonb_array_elements(p_payload->'lines') loop
   select * into mat from public.erp_materials where id=(e->>'material_id')::uuid and active;
   if not found then raise exception using errcode='P0001',message='Choose an active material.'; end if;
   qty:=public.erp_qty(e->>'quantity'); price:=public.erp_qty(e->>'price',false); pos:=pos+1;
   insert into public.erp_purchase_lines(order_id,position,material_id,quantity,price,snapshot) values(target,pos,mat.id,qty,price,jsonb_build_object('name',mat.name,'code',mat.code,'unit',(select code from public.erp_units where id=mat.unit_id)));
  end loop;
 elsif p_action in ('confirm_purchase','cancel_purchase') then
  select * into po from public.erp_purchase_orders where id=target for update;
  if not found or po.version is distinct from ver then raise exception using errcode='P0001',message='Purchase order changed. Reload first.'; end if;
  if p_action='confirm_purchase' then
   perform public.erp_assert(u.id,'purchase','approve');
   if po.state<>'draft' or not exists(select from public.erp_purchase_lines where order_id=target) then raise exception using errcode='P0001',message='Only a complete draft can be confirmed.'; end if;
   select * into supplier from public.erp_suppliers where id=po.supplier_id and active;
   if not found or exists(select from public.erp_purchase_lines l join public.erp_materials m on m.id=l.material_id where l.order_id=target and not m.active) then raise exception using errcode='P0001',message='Supplier and materials must be active.'; end if;
   update public.erp_purchase_orders set state='confirmed',version=version+1,snapshot=to_jsonb(supplier) where id=target;
  else
   if po.state not in ('draft','confirmed','partial') or why='' then raise exception using errcode='P0001',message='Enter a reason to cancel the outstanding purchase.'; end if;
   if po.state<>'draft' then perform public.erp_assert(u.id,'purchase','approve'); end if;
   update public.erp_purchase_orders set state='cancelled',reason=why,version=version+1 where id=target;
  end if;
 elsif p_action='receive_purchase' then
  perform public.erp_assert(u.id,'warehouse','write');
  request_id:=(p_payload->>'request_key')::uuid;
  select id,order_id into tx,result from public.erp_material_transactions where request_key=request_id;
  if found then if result is distinct from target then raise check_violation; end if; return jsonb_build_object('id',target); end if;
  select * into po from public.erp_purchase_orders where id=target for update;
  if not found or po.state not in ('confirmed','partial') or po.version is distinct from ver then raise exception using errcode='P0001',message='Purchase order changed or is not open for receipt.'; end if;
  if (p_payload->>'date')::date>public.erp_today() or (p_payload->>'date')::date<po.date then raise exception using errcode='P0001',message='Receipt date must be between the order date and today.'; end if;
  insert into public.erp_material_transactions(request_key,number,kind,order_id,date,reason,created_by) values(request_id,public.erp_number('GRN'),'receipt',target,(p_payload->>'date')::date,why,u.id) returning id into tx;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise check_violation; end if;
  for e in select * from jsonb_array_elements(p_payload->'lines') loop
   select * into pl from public.erp_purchase_lines where id=(e->>'line_id')::uuid and order_id=target for update;
   qty:=public.erp_qty(e->>'quantity');
   if not found or pl.received+qty>pl.quantity then raise exception using errcode='P0001',message='Receipt exceeds the outstanding purchase quantity.'; end if;
   select * into lot from public.erp_material_lots where material_id=pl.material_id and supplier_id=po.supplier_id and number=btrim(e->>'lot_number');
   if found then
    if lot.expiry_date is distinct from nullif(e->>'expiry_date','')::date then raise exception using errcode='P0001',message='This supplier lot already has a different expiry date.'; end if;
   else
    insert into public.erp_material_lots(material_id,supplier_id,number,expiry_date) values(pl.material_id,po.supplier_id,btrim(e->>'lot_number'),nullif(e->>'expiry_date','')::date) returning * into lot;
   end if;
   if lot.expiry_date<(p_payload->>'date')::date then raise exception using errcode='P0001',message='Expired raw material cannot be received.'; end if;
   insert into public.erp_material_balances(lot_id,location_id,quantity) values(lot.id,(p_payload->>'location_id')::uuid,qty) on conflict(lot_id,location_id) do update set quantity=erp_material_balances.quantity+excluded.quantity;
   insert into public.erp_material_ledger(transaction_id,order_line_id,lot_id,location_id,delta) values(tx,pl.id,lot.id,(p_payload->>'location_id')::uuid,qty);
   update public.erp_purchase_lines set received=received+qty where id=pl.id;
  end loop;
  update public.erp_purchase_orders set state=case when exists(select from public.erp_purchase_lines where order_id=target and received<quantity) then 'partial' else 'received' end,version=version+1 where id=target;
 elsif p_action='issue_material' then
  request_id:=(p_payload->>'request_key')::uuid;
  select id into target from public.erp_material_transactions where request_key=request_id and kind='issue';
  if found then return jsonb_build_object('id',target); end if;
  if why='' or (p_payload->>'date')::date>public.erp_today() then raise check_violation; end if;
  select * into lot from public.erp_material_lots where id=(p_payload->>'lot_id')::uuid;
  if not found or lot.expiry_date<public.erp_today() then raise exception using errcode='P0001',message='Choose a non-expired material lot.'; end if;
  if (p_payload->>'date')::date<(select min(t.date) from public.erp_material_ledger g join public.erp_material_transactions t on t.id=g.transaction_id where g.lot_id=lot.id and g.location_id=(p_payload->>'location_id')::uuid and t.kind='receipt') then raise exception using errcode='P0001',message='Issue date cannot precede the first receipt of this lot at this location.'; end if;
  qty:=public.erp_qty(p_payload->>'quantity');
  select quantity into bal from public.erp_material_balances where lot_id=lot.id and location_id=(p_payload->>'location_id')::uuid for update;
  if not found or bal<qty then raise exception using errcode='P0001',message='Insufficient material stock.'; end if;
  insert into public.erp_material_transactions(request_key,number,kind,date,reason,created_by) values(request_id,public.erp_number('MI'),'issue',(p_payload->>'date')::date,why,u.id) returning id into target;
  update public.erp_material_balances set quantity=quantity-qty where lot_id=lot.id and location_id=(p_payload->>'location_id')::uuid;
  insert into public.erp_material_ledger(transaction_id,lot_id,location_id,delta) values(target,lot.id,(p_payload->>'location_id')::uuid,-qty);
 elsif p_action='reverse_material_transaction' then
  select * into original from public.erp_material_transactions where id=target;
  if not found or original.kind='reversal' or why='' then raise exception using errcode='P0001',message='Choose an original material transaction and enter a reversal reason.'; end if;
  perform public.erp_assert(u.id,'warehouse','approve');
  if original.kind='receipt' then perform public.erp_assert(u.id,'purchase','approve'); end if;
  if exists(select from public.erp_material_transactions where reverses=target) then return jsonb_build_object('id',target); end if;
  insert into public.erp_material_transactions(request_key,number,kind,order_id,date,reason,created_by,reverses) values(gen_random_uuid(),public.erp_number('MR'),'reversal',original.order_id,public.erp_today(),why,u.id,original.id) returning id into tx;
  for entry in select * from public.erp_material_ledger where transaction_id=original.id order by id loop
   select quantity into bal from public.erp_material_balances where lot_id=entry.lot_id and location_id=entry.location_id for update;
   if bal-entry.delta<0 then raise exception using errcode='P0001',message='The received material has been consumed. Restore stock before reversing the receipt.'; end if;
   update public.erp_material_balances set quantity=quantity-entry.delta where lot_id=entry.lot_id and location_id=entry.location_id;
   insert into public.erp_material_ledger(transaction_id,order_line_id,lot_id,location_id,delta) values(tx,entry.order_line_id,entry.lot_id,entry.location_id,-entry.delta);
   if original.kind='receipt' then update public.erp_purchase_lines set received=received-entry.delta where id=entry.order_line_id; end if;
  end loop;
  if original.kind='receipt' then
   update public.erp_purchase_orders set state=case when state='cancelled' then state when exists(select from public.erp_purchase_lines where order_id=original.order_id and received>0) then 'partial' else 'confirmed' end,version=version+1 where id=original.order_id;
  end if;
 elsif p_action='save_opportunity' then
  if not exists(select from public.users where id=(p_payload->>'owner_id')::uuid and is_active and public.erp_can(id,'crm','write')) then raise check_violation; end if;
  if target is null then insert into public.erp_opportunities(number,title,company,owner_id) values(public.erp_number('CRM'),btrim(p_payload->>'title'),btrim(p_payload->>'company'),(p_payload->>'owner_id')::uuid) returning id into target;
  else select * into opp from public.erp_opportunities where id=target for update;
   if not found or opp.version is distinct from ver or opp.stage in ('won','lost') then raise exception using errcode='P0001',message='Opportunity changed or is closed.'; end if;
  end if;
  update public.erp_opportunities set title=btrim(p_payload->>'title'),company=btrim(p_payload->>'company'),contact=coalesce(p_payload->>'contact',''),email=coalesce(p_payload->>'email',''),phone=coalesce(p_payload->>'phone',''),source=coalesce(p_payload->>'source',''),notes=coalesce(p_payload->>'notes',''),owner_id=(p_payload->>'owner_id')::uuid,expected_value=public.erp_qty(coalesce(p_payload->>'expected_value','0'),false),currency=p_payload->>'currency',probability=(p_payload->>'probability')::integer,expected_close=nullif(p_payload->>'expected_close','')::date,version=version+1 where id=target;
 elsif p_action='stage_opportunity' then
  select * into opp from public.erp_opportunities where id=target for update;
  if not found or opp.version is distinct from ver then raise exception using errcode='P0001',message='Opportunity changed. Reload first.'; end if;
  if p_payload->>'stage'='won' and opp.customer_id is null then raise exception using errcode='P0001',message='Link a customer before marking this opportunity won.'; end if;
  if why='' then raise exception using errcode='P0001',message='Enter a stage-change reason.'; end if;
  update public.erp_opportunities set stage=p_payload->>'stage',loss_reason=case when p_payload->>'stage'='lost' then why else null end,probability=case p_payload->>'stage' when 'won' then 100 when 'lost' then 0 else probability end,notes=notes||E'\n'||why,version=version+1 where id=target;
 elsif p_action='convert_opportunity' then
  perform public.erp_assert(u.id,'sales','write');
  select * into opp from public.erp_opportunities where id=target for update;
  if not found then raise no_data_found; end if;
  if opp.customer_id is not null then return jsonb_build_object('id',opp.customer_id); end if;
  if opp.version is distinct from ver or opp.stage='lost' then raise exception using errcode='P0001',message='Opportunity changed or is lost.'; end if;
  result:=nullif(p_payload->>'customer_id','')::uuid;
  if result is null then insert into public.erp_customers(name,contact,email,phone) values(opp.company,opp.contact,opp.email,opp.phone) returning id into result;
  elsif not exists(select from public.erp_customers where id=result) then raise no_data_found; end if;
  update public.erp_opportunities set customer_id=result,version=version+1 where id=target;
 elsif p_action='save_crm_activity' then
  if not exists(select from public.erp_opportunities where id=(p_payload->>'opportunity_id')::uuid and stage not in ('won','lost')) or not exists(select from public.users where id=(p_payload->>'assigned_to')::uuid and is_active and public.erp_can(id,'crm','write')) then raise check_violation; end if;
  insert into public.erp_crm_activities(opportunity_id,title,kind,due_date,assigned_to,notes) values((p_payload->>'opportunity_id')::uuid,btrim(p_payload->>'title'),p_payload->>'kind',(p_payload->>'due_date')::date,(p_payload->>'assigned_to')::uuid,coalesce(p_payload->>'notes','')) returning id into target;
 elsif p_action='complete_crm_activity' then
  update public.erp_crm_activities set state=p_payload->>'state',notes=coalesce(p_payload->>'notes','') where id=target and state='open';
  if not found then raise exception using errcode='P0001',message='This activity is already closed or no longer exists.'; end if;
 elsif p_action='save_product_document' then
  if target is null then
   select coalesce(max(revision),0)+1 into pos from public.erp_product_documents where product_id=(p_payload->>'product_id')::uuid and kind=p_payload->>'kind' and language=p_payload->>'language';
   insert into public.erp_product_documents(number,product_id,kind,language,revision,title,file_url,effective_date,expiry_date,notes,created_by) values(public.erp_number('DOC'),(p_payload->>'product_id')::uuid,p_payload->>'kind',p_payload->>'language',pos,btrim(p_payload->>'title'),p_payload->>'file_url',(p_payload->>'effective_date')::date,nullif(p_payload->>'expiry_date','')::date,coalesce(p_payload->>'notes',''),u.id) returning id into target;
  else
   update public.erp_product_documents set title=btrim(p_payload->>'title'),file_url=p_payload->>'file_url',effective_date=(p_payload->>'effective_date')::date,expiry_date=nullif(p_payload->>'expiry_date','')::date,notes=coalesce(p_payload->>'notes',''),version=version+1 where id=target and state='draft' and version=ver and product_id=(p_payload->>'product_id')::uuid and kind=p_payload->>'kind' and language=p_payload->>'language';
   if not found then raise exception using errcode='P0001',message='Document changed. Only the original draft can be edited.'; end if;
  end if;
 elsif p_action in ('publish_product_document','withdraw_product_document') then
  perform public.erp_assert(u.id,'documents','approve');
  select * into doc from public.erp_product_documents where id=target for update;
  if not found or doc.version is distinct from ver then raise exception using errcode='P0001',message='Document changed. Reload first.'; end if;
  if p_action='publish_product_document' then
   if doc.state<>'draft' or doc.effective_date>public.erp_today() or doc.expiry_date<public.erp_today() then raise exception using errcode='P0001',message='Only a current, non-expired draft can be published.'; end if;
   if exists(select from public.erp_product_documents where product_id=doc.product_id and kind=doc.kind and language=doc.language and state='published' and revision>doc.revision) then raise exception using errcode='P0001',message='A newer revision is already published.'; end if;
   update public.erp_product_documents set state='superseded',version=version+1 where product_id=doc.product_id and kind=doc.kind and language=doc.language and state='published';
   update public.erp_product_documents set state='published',published_at=now(),version=version+1 where id=target;
  else
   if doc.state not in ('draft','published') or why='' then raise exception using errcode='P0001',message='Enter a withdrawal reason for a draft or published document.'; end if;
   update public.erp_product_documents set state='withdrawn',reason=why,version=version+1 where id=target;
  end if;
 end if;
 return jsonb_build_object('id',coalesce(result,target));
end $$;

create or replace view public.erp_growth_records as
select 'suppliers'::text entity,'purchase'::text module,s.id::text id,to_jsonb(s)||jsonb_build_object('state',case when s.active then 'active' else 'inactive' end,'label',s.name) body,s.name||' '||s.contact||' '||s.email search,case when s.active then 'active' else 'inactive' end state,s.name sort from public.erp_suppliers s
union all
select 'materials','purchase',m.id::text,to_jsonb(m)||jsonb_build_object('minimum_stock',m.minimum_stock::text,'label',m.code||' · '||m.name,'unit',u.code,'on_hand',coalesce((select sum(b.quantity) from public.erp_material_balances b join public.erp_material_lots l on l.id=b.lot_id where l.material_id=m.id),0)::text,'available',coalesce((select sum(b.quantity) from public.erp_material_balances b join public.erp_material_lots l on l.id=b.lot_id where l.material_id=m.id and (l.expiry_date is null or l.expiry_date>=public.erp_today())),0)::text,'state',case when not m.active then 'inactive' when coalesce((select sum(b.quantity) from public.erp_material_balances b join public.erp_material_lots l on l.id=b.lot_id where l.material_id=m.id and (l.expiry_date is null or l.expiry_date>=public.erp_today())),0)<m.minimum_stock then 'low_stock' else 'active' end),m.code||' '||m.name,case when not m.active then 'inactive' when coalesce((select sum(b.quantity) from public.erp_material_balances b join public.erp_material_lots l on l.id=b.lot_id where l.material_id=m.id and (l.expiry_date is null or l.expiry_date>=public.erp_today())),0)<m.minimum_stock then 'low_stock' else 'active' end,m.code from public.erp_materials m join public.erp_units u on u.id=m.unit_id
union all
select 'purchases','purchase',p.id::text,to_jsonb(p)||jsonb_build_object('supplier_data',coalesce(p.snapshot,to_jsonb(s)),'supplier',coalesce(p.snapshot->>'name',s.name),'label',p.number,'total',coalesce((select sum(quantity*price) from public.erp_purchase_lines where order_id=p.id),0)::text,'lines',coalesce((select jsonb_agg(to_jsonb(l)||l.snapshot||jsonb_build_object('quantity',l.quantity::text,'price',l.price::text,'received',l.received::text,'outstanding',(l.quantity-l.received)::text,'amount',(l.quantity*l.price)::text) order by l.position) from public.erp_purchase_lines l where l.order_id=p.id),'[]'::jsonb)),p.number||' '||s.name,p.state,p.created_at::text from public.erp_purchase_orders p join public.erp_suppliers s on s.id=p.supplier_id
union all
select 'material_stock','warehouse',l.id::text||':'||loc.id::text,jsonb_build_object('id',l.id::text||':'||loc.id::text,'lot_id',l.id,'material_id',m.id,'name',m.name,'code',m.code,'lot_number',l.number,'supplier',s.name,'location_id',loc.id,'location',loc.name,'quantity',b.quantity::text,'unit',u.code,'expiry_date',l.expiry_date,'state',case when l.expiry_date<public.erp_today() then 'expired' when l.expiry_date<=public.erp_today()+30 then 'expiring' else 'available' end,'label',m.name||' · '||l.number||' · '||loc.name),m.code||' '||m.name||' '||l.number||' '||s.name||' '||loc.name,case when l.expiry_date<public.erp_today() then 'expired' when l.expiry_date<=public.erp_today()+30 then 'expiring' else 'available' end,l.number from public.erp_material_balances b join public.erp_material_lots l on l.id=b.lot_id join public.erp_materials m on m.id=l.material_id join public.erp_units u on u.id=m.unit_id join public.erp_locations loc on loc.id=b.location_id join public.erp_suppliers s on s.id=l.supplier_id
union all
select 'material_ledger','warehouse',g.id::text,jsonb_build_object('id',g.id::text,'transaction_id',t.id,'reversed',exists(select from public.erp_material_transactions where reverses=t.id),'number',t.number,'kind',t.kind,'date',t.date,'reason',t.reason,'name',m.name,'code',m.code,'lot_number',l.number,'location',loc.name,'quantity',g.delta::text,'unit',u.code,'purchase',p.number,'state',t.kind),t.number||' '||m.code||' '||m.name||' '||l.number||' '||coalesce(p.number,'')||' '||t.reason,t.kind,lpad(g.id::text,20,'0') from public.erp_material_ledger g join public.erp_material_transactions t on t.id=g.transaction_id join public.erp_material_lots l on l.id=g.lot_id join public.erp_materials m on m.id=l.material_id join public.erp_units u on u.id=m.unit_id join public.erp_locations loc on loc.id=g.location_id left join public.erp_purchase_orders p on p.id=t.order_id
union all
select 'opportunities','crm',o.id::text,to_jsonb(o)||jsonb_build_object('state',o.stage,'label',o.number||' · '||o.title,'expected_value',o.expected_value::text,'owner',u.nama_lengkap,'customer',c.name,'activities',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('assignee',au.nama_lengkap) order by a.due_date,a.created_at) from public.erp_crm_activities a join public.users au on au.id=a.assigned_to where a.opportunity_id=o.id),'[]'::jsonb),'quotes',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'number',q.number,'state',q.state)) from public.erp_quotes q where q.opportunity_id=o.id),'[]'::jsonb)),o.number||' '||o.title||' '||o.company||' '||o.contact||' '||coalesce(c.name,'')||' '||u.nama_lengkap,o.stage,o.created_at::text from public.erp_opportunities o join public.users u on u.id=o.owner_id left join public.erp_customers c on c.id=o.customer_id
union all
select 'crm_activities','crm',a.id::text,to_jsonb(a)||jsonb_build_object('name',a.title,'opportunity',o.title,'company',o.company,'assignee',u.nama_lengkap,'display_state',case when a.state='open' and a.due_date<public.erp_today() then 'overdue' else a.state end),a.title||' '||o.number||' '||o.company||' '||o.title||' '||u.nama_lengkap,case when a.state='open' and a.due_date<public.erp_today() then 'overdue' else a.state end,a.due_date::text from public.erp_crm_activities a join public.erp_opportunities o on o.id=a.opportunity_id join public.users u on u.id=a.assigned_to
union all
select 'product_documents','documents',d.id::text,to_jsonb(d)||jsonb_build_object('product',p.nama_produk,'code',p.kode_produk,'label',d.number||' · '||d.title,'display_state',case when d.state<>'published' then d.state when d.expiry_date<public.erp_today() then 'expired' when d.expiry_date<=public.erp_today()+30 then 'expiring' else 'valid' end),d.number||' '||d.title||' '||p.nama_produk||' '||p.kode_produk||' '||d.kind,case when d.state<>'published' then d.state when d.expiry_date<public.erp_today() then 'expired' when d.expiry_date<=public.erp_today()+30 then 'expiring' else 'valid' end,d.created_at::text from public.erp_product_documents d join public.master_produk p on p.id=d.product_id;

create or replace function public.erp_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; scope text; rows jsonb; total bigint; result jsonb;
begin
 u:=public.erp_actor(p_token);
 if length(p_search)>100 or length(p_state)>30 or p_page<1 or p_page>1000000 or length(coalesce(p_id,''))>100 then raise check_violation; end if;
 scope:=case when p_entity in ('suppliers','materials','purchases') then 'purchase' when p_entity in ('material_stock','material_ledger') then 'warehouse' when p_entity in ('opportunities','crm_activities','crm_owners') then 'crm' when p_entity='product_documents' then 'documents' end;
 if scope is null then
  result:=public.erp_read_v5(p_token,p_entity,p_search,p_state,p_page,p_id);
  if p_entity='quotes' then
   select coalesce(jsonb_agg(r||jsonb_build_object('opportunity_id',q.opportunity_id)),'[]'::jsonb) into rows from jsonb_array_elements(result->'rows') r left join public.erp_quotes q on q.id=(r->>'id')::uuid;
   result:=jsonb_set(result,'{rows}',rows);
  end if;
  return result;
 end if;
 perform public.erp_assert(u.id,scope,'read');
 if p_entity='crm_owners' then
  select count(*) into total from public.users where is_active and (nama_lengkap ilike '%'||p_search||'%') and public.erp_can(id,'crm','write');
  select coalesce(jsonb_agg(r),'[]'::jsonb) into rows from (select id,nama_lengkap name,nama_lengkap label from public.users where is_active and nama_lengkap ilike '%'||p_search||'%' and public.erp_can(id,'crm','write') order by nama_lengkap,id limit 50 offset (p_page-1)*50) r;
 else
  select count(*) into total from public.erp_growth_records r where r.entity=p_entity and (p_id is null or r.id=p_id or (p_entity='product_documents' and left(p_id,8)='product:' and r.body->>'product_id'=substr(p_id,9))) and r.search ilike '%'||p_search||'%' and (p_state='' or r.state=p_state);
  select coalesce(jsonb_agg(body),'[]'::jsonb) into rows from (select r.body from public.erp_growth_records r where r.entity=p_entity and (p_id is null or r.id=p_id or (p_entity='product_documents' and left(p_id,8)='product:' and r.body->>'product_id'=substr(p_id,9))) and r.search ilike '%'||p_search||'%' and (p_state='' or r.state=p_state) order by case when p_entity in ('suppliers','materials','material_stock','crm_activities') then r.sort end asc,r.sort desc,r.id limit 50 offset (p_page-1)*50) q;
 end if;
 if p_entity='opportunities' and not (public.erp_can(u.id,'sales','read') and exists(select from public.erp_modules where key='sales' and state<>'disabled')) then
  select coalesce(jsonb_agg(r||jsonb_build_object('quotes','[]'::jsonb)),'[]'::jsonb) into rows from jsonb_array_elements(rows) r;
 end if;
 return jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',50);
end $$;
create or replace view public.erp_inbox as
select 'qc:'||l.id id,'quality' module,'Inspection required' title,l.number description,'/dashboard/inspeksi?lot='||l.id href,l.created_at sort from public.erp_lots l where l.qc_status='quarantine' and l.inspection_id is null and exists(select from public.erp_ledger where lot_id=l.id)
union all select 'quote:'||q.id,'sales','Approve quotation',q.number,'/dashboard/sales?view=quotes&q='||q.number,q.created_at from public.erp_quotes q where q.state='pending'
union all select 'quote-expiry:'||q.id,'sales','Quotation expiring',q.number,'/dashboard/sales?view=quotes&q='||q.number,q.created_at from public.erp_quotes q where q.state='issued' and q.valid_until between public.erp_today() and public.erp_today()+7
union all select 'order:'||o.id,'warehouse','Prepare delivery',o.number,'/dashboard/warehouse?view=fulfillment&q='||o.number,o.created_at from public.erp_orders o where o.state='confirmed'
union all select 'count:'||c.id,'warehouse','Approve stock count',c.number,'/dashboard/warehouse?view=counts&q='||c.number,c.created_at from public.erp_counts c where c.state='submitted'
union all select 'return:'||r.id,'warehouse',case when r.state='requested' then 'Receive return' else 'Review return' end,r.number,'/dashboard/warehouse?view=returns&q='||r.number,r.created_at from public.erp_returns r where r.state in ('requested','received')
union all select 'purchase:'||p.id,'purchase','Receive purchase order',p.number,'/dashboard/purchase?view=purchases&q='||p.number,p.created_at from public.erp_purchase_orders p where p.state in ('confirmed','partial') and p.expected_date<=public.erp_today()
union all select 'crm:'||a.id,'crm','Follow-up due',o.company||' · '||a.title,'/dashboard/crm?view=crm_activities&q='||o.number,a.created_at from public.erp_crm_activities a join public.erp_opportunities o on o.id=a.opportunity_id where a.state='open' and a.due_date<=public.erp_today()
union all select 'document:'||d.id,'documents',case when d.expiry_date<public.erp_today() then 'Product document expired' else 'Product document expiring' end,d.number||' · '||d.title,'/dashboard/documents?q='||d.number,d.created_at from public.erp_product_documents d where d.state='published' and d.expiry_date<=public.erp_today()+30;

create or replace function public.erp_overview(p_token text,p_area text default 'overview',p_days text default '30') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; metrics jsonb; series jsonb; days integer:=case when p_days in ('7','30','90') then p_days::integer else 30 end; firstday date; result jsonb;
begin
 if p_area not in ('purchase','crm','documents') then return public.erp_overview_v5(p_token,p_area,p_days); end if;
 u:=public.erp_actor(p_token); perform public.erp_assert(u.id,p_area,'read'); firstday:=public.erp_today()-days+1;
 metrics:=case p_area
 when 'purchase' then jsonb_build_array(jsonb_build_object('label','Open purchase orders','value',(select count(*) from public.erp_purchase_orders where state in ('confirmed','partial'))),jsonb_build_object('label','Overdue receipts','value',(select count(*) from public.erp_purchase_orders where state in ('confirmed','partial') and expected_date<public.erp_today())))
 when 'crm' then jsonb_build_array(jsonb_build_object('label','Open opportunities','value',(select count(*) from public.erp_opportunities where stage not in ('won','lost'))),jsonb_build_object('label','Overdue follow-ups','value',(select count(*) from public.erp_crm_activities where state='open' and due_date<public.erp_today())))
 else jsonb_build_array(jsonb_build_object('label','Current document revisions','value',(select count(*) from public.erp_product_documents where state='published' and (expiry_date is null or expiry_date>=public.erp_today()))),jsonb_build_object('label','Expiring or expired','value',(select count(*) from public.erp_product_documents where state='published' and expiry_date<=public.erp_today()+30))) end;
 with events as (
 select created_at::date d from public.erp_purchase_orders where p_area='purchase'
 union all select created_at::date from public.erp_opportunities where p_area='crm'
 union all select created_at::date from public.erp_product_documents where p_area='documents'
 ) select jsonb_agg(jsonb_build_object('date',d::date,'count',(select count(*) from events where events.d=d::date)) order by d) into series from generate_series(firstday,public.erp_today(),interval '1 day') d;
 return jsonb_build_object('metrics',metrics,'series',series,'activity','[]'::jsonb,'days',days,'chart_label',case p_area when 'purchase' then 'Purchase orders created' when 'crm' then 'Opportunities created' else 'Document revisions created' end);
end $$;
-- No direct REST/table access, including to historical wrappers and helper views.
do $$declare t text; f regprocedure; begin
 foreach t in array array['erp_suppliers','erp_materials','erp_purchase_orders','erp_purchase_lines','erp_material_lots','erp_material_balances','erp_material_transactions','erp_material_ledger','erp_opportunities','erp_crm_activities','erp_product_documents'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('drop trigger if exists erp_audit on public.%I',t);
  if t not in ('erp_material_balances','erp_material_ledger') then execute format('create trigger erp_audit after insert or update or delete on public.%I for each row execute function public.erp_audit()',t); end if;
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'erp_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop;
end $$;
revoke all on public.erp_growth_records from public,anon,authenticated,service_role;
revoke all on sequence public.erp_material_ledger_id_seq from public,anon,authenticated,service_role;
grant execute on function public.erp_read(text,text,text,text,integer,text),public.erp_mutate(text,text,jsonb),public.erp_module_guard(text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
