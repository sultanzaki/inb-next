begin;
-- Operational AR/AP only: no general ledger, payroll, bank transfer execution or tax filing.
create table if not exists public.erp_fin_terms(
 order_id uuid primary key references public.erp_orders(id),mode text not null check(mode in ('prepaid','deposit_before','deposit_credit','credit')),
 deposit_percent numeric(7,4) not null default 0 check(deposit_percent between 0 and 100),due_days integer not null default 30 check(due_days between 0 and 365),
 billing_event text not null default 'dispatch' check(billing_event in ('order','dispatch','receipt')),state text not null default 'pending' check(state in ('pending','approved')),
 created_by uuid not null references public.users(id),approved_by uuid references public.users(id),reason text not null default '',version integer not null default 1,created_at timestamptz not null default now());
create table if not exists public.erp_fin_credit_policy(
 customer_id uuid not null references public.erp_customers(id),currency text not null check(currency ~ '^[A-Z]{3}$'),credit_limit numeric(24,6) not null check(credit_limit>=0),on_hold boolean not null default false,hold_overdue boolean not null default true,reason text not null,version integer not null default 1,primary key(customer_id,currency));
create table if not exists public.erp_fin_dispatch_overrides(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.erp_orders(id),expires_on date not null,reason text not null,approved_by uuid not null references public.users(id),created_at timestamptz not null default now());
create table if not exists public.erp_fin_documents(
 id uuid primary key default gen_random_uuid(),number text unique not null,kind text not null check(kind in ('payment_request','invoice','credit_note','supplier_request','supplier_bill','supplier_credit')),
 party_type text not null check(party_type in ('customer','supplier')),party_id uuid not null,currency text not null check(currency ~ '^[A-Z]{3}$'),
 order_id uuid references public.erp_orders(id),delivery_id uuid references public.erp_movements(id),purchase_id uuid references public.erp_purchase_orders(id),related_id uuid references public.erp_fin_documents(id),case_id uuid references public.erp_cases(id),
 date date not null,due_date date not null,amount numeric(24,6) not null check(amount>0),lines jsonb not null default '[]' check(jsonb_typeof(lines)='array'),
 state text not null default 'draft' check(state in ('draft','issued','void')),external_reference text not null default '',match_state text not null default 'matched' check(match_state in ('matched','variance')),
 notes text not null default '',snapshot jsonb not null,disputed boolean not null default false,dispute_reason text not null default '',
 created_by uuid not null references public.users(id),issued_by uuid references public.users(id),version integer not null default 1,created_at timestamptz not null default now(),check(due_date>=date));
create unique index if not exists erp_fin_supplier_reference on public.erp_fin_documents(party_id,lower(btrim(external_reference))) where kind='supplier_bill' and state<>'void';
create index if not exists erp_fin_due on public.erp_fin_documents(party_type,state,due_date);
create index if not exists erp_fin_order on public.erp_fin_documents(order_id,kind,state);
create index if not exists erp_fin_purchase on public.erp_fin_documents(purchase_id,kind,state);
create table if not exists public.erp_fin_payments(
 id uuid primary key default gen_random_uuid(),number text unique not null,direction text not null check(direction in ('receipt','payment','refund','supplier_refund')),party_type text not null check(party_type in ('customer','supplier')),party_id uuid not null,
 currency text not null check(currency ~ '^[A-Z]{3}$'),amount numeric(24,6) not null check(amount>0),date date not null,bank_account text not null,bank_reference text not null,evidence text not null,notes text not null default '',
 state text not null default 'draft' check(state in ('draft','verified','void')),created_by uuid not null references public.users(id),verified_by uuid references public.users(id),version integer not null default 1,created_at timestamptz not null default now());
create unique index if not exists erp_fin_bank_ref on public.erp_fin_payments(lower(btrim(bank_account)),lower(btrim(bank_reference))) where state='verified';
create table if not exists public.erp_fin_allocations(
 id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.erp_fin_payments(id),document_id uuid not null references public.erp_fin_documents(id),amount numeric(24,6) not null check(amount>0),
 state text not null default 'active' check(state in ('active','reversed')),reason text not null,created_by uuid not null references public.users(id),created_at timestamptz not null default now(),reversed_by uuid references public.users(id),reversed_at timestamptz);
alter table public.erp_fin_allocations add column if not exists reversal_reason text;
create index if not exists erp_fin_allocation_doc on public.erp_fin_allocations(document_id) where state='active';
create index if not exists erp_fin_allocation_pay on public.erp_fin_allocations(payment_id) where state='active';
create table if not exists public.erp_fin_credit_applications(
 id uuid primary key default gen_random_uuid(),credit_id uuid not null references public.erp_fin_documents(id),invoice_id uuid not null references public.erp_fin_documents(id),amount numeric(24,6) not null check(amount>0),reason text not null,created_by uuid not null references public.users(id),created_at timestamptz not null default now());
create index if not exists erp_fin_credit_source on public.erp_fin_credit_applications(credit_id);
create index if not exists erp_fin_credit_target on public.erp_fin_credit_applications(invoice_id);
create table if not exists public.erp_fin_collection_events(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references public.erp_fin_documents(id),kind text not null check(kind in ('follow_up','promise','dispute','resolve_dispute')),notes text not null,promised_date date,promised_amount numeric(24,6),created_by uuid not null references public.users(id),created_at timestamptz not null default now());
alter table public.erp_fin_collection_events add column if not exists outstanding_at_recording numeric(24,6);
create index if not exists erp_fin_collections_doc on public.erp_fin_collection_events(document_id,created_at desc);
create or replace function public.erp_fin_allocated(p_document uuid) returns numeric language sql stable set search_path=pg_catalog,public as $$
 select coalesce(sum(a.amount),0) from public.erp_fin_allocations a join public.erp_fin_payments p on p.id=a.payment_id where a.document_id=p_document and a.state='active' and p.state='verified'
$$;
create or replace function public.erp_fin_outstanding(p_document uuid) returns numeric language sql stable set search_path=pg_catalog,public as $$
 select greatest(0,d.amount-public.erp_fin_allocated(d.id)-case when d.kind in ('credit_note','supplier_credit') then coalesce((select sum(amount) from public.erp_fin_credit_applications where credit_id=d.id),0) else coalesce((select sum(amount) from public.erp_fin_credit_applications where invoice_id=d.id),0) end) from public.erp_fin_documents d where d.id=p_document
$$;
create or replace function public.erp_fin_dispatch_status(p_order uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o public.erp_orders;t public.erp_fin_terms;q public.erp_quotes;policy public.erp_fin_credit_policy;gross numeric;paid numeric;required numeric;exposure numeric;blocked text;
begin
 if not exists(select from public.erp_modules where key='finance' and state<>'disabled') then return jsonb_build_object('cleared',true,'reason','Finance module disabled.'); end if;
 select * into o from public.erp_orders where id=p_order;if not found then raise no_data_found; end if;select * into q from public.erp_quotes where id=o.quote_id;
 if exists(select from public.erp_fin_dispatch_overrides where order_id=o.id and expires_on>=public.erp_today()) then return jsonb_build_object('cleared',true,'reason','Approved time-limited dispatch exception.');end if;
 select * into t from public.erp_fin_terms where order_id=o.id;
 if not found or t.state<>'approved' then return jsonb_build_object('cleared',false,'reason','Finance must approve the order payment terms.');end if;
 gross:=(o.snapshot->'totals'->>'total')::numeric;
 select coalesce(sum(case when p.direction='refund' then -a.amount else a.amount end),0) into paid from public.erp_fin_allocations a join public.erp_fin_documents d on d.id=a.document_id join public.erp_fin_payments p on p.id=a.payment_id where d.order_id=o.id and d.state='issued' and d.kind in ('invoice','payment_request','credit_note') and a.state='active' and p.state='verified' and p.direction in ('receipt','refund');
 required:=case t.mode when 'prepaid' then gross when 'deposit_before' then gross when 'deposit_credit' then round(gross*t.deposit_percent/100,6) else 0 end;
 if paid<required then blocked:='Verified allocated payments do not meet the dispatch requirement.';
 elsif t.mode in ('credit','deposit_credit') then
  select * into policy from public.erp_fin_credit_policy where customer_id=q.customer_id and currency=q.currency;
  if not found then blocked:='Finance must configure the customer credit policy.';
  elsif policy.on_hold then blocked:='Customer is on credit hold.';
  elsif policy.hold_overdue and exists(select from public.erp_fin_documents where party_type='customer' and party_id=q.customer_id and currency=q.currency and kind='invoice' and state='issued' and due_date<public.erp_today() and public.erp_fin_outstanding(id)>0) then blocked:='Customer has overdue invoices.';
  else
   select coalesce(sum(public.erp_fin_outstanding(id)),0) into exposure from public.erp_fin_documents where party_type='customer' and party_id=q.customer_id and currency=q.currency and kind='invoice' and state='issued';
   exposure:=exposure+coalesce((select sum(greatest(0,(ord.snapshot->'totals'->>'total')::numeric-coalesce((select sum(amount) from public.erp_fin_documents where order_id=ord.id and kind='invoice' and state='issued'),0)-coalesce((select sum(a.amount) from public.erp_fin_allocations a join public.erp_fin_documents d on d.id=a.document_id join public.erp_fin_payments pay on pay.id=a.payment_id where d.order_id=ord.id and d.kind='payment_request' and d.state='issued' and a.state='active' and pay.state='verified'),0))) from public.erp_orders ord join public.erp_quotes qq on qq.id=ord.quote_id where qq.customer_id=q.customer_id and qq.currency=q.currency and ord.state in ('confirmed','fulfilled')),0);
   if exposure>policy.credit_limit then blocked:='Customer credit exposure exceeds the approved limit.';end if;
  end if;
 end if;
 return jsonb_build_object('cleared',blocked is null,'reason',coalesce(blocked,'Financial requirements satisfied.'),'required',required::text,'paid',paid::text,'currency',q.currency);
end $$;
create or replace function public.erp_fin_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;target uuid:=nullif(p_payload->>'id','')::uuid;why text:=btrim(coalesce(p_payload->>'reason',''));o public.erp_orders;q public.erp_quotes;po public.erp_purchase_orders;d public.erp_fin_documents;related public.erp_fin_documents;pay public.erp_fin_payments;a public.erp_fin_allocations;t public.erp_fin_terms;doc_id uuid;
 e jsonb;ln public.erp_order_lines;pl public.erp_purchase_lines;lines jsonb:='[]';snap jsonb;qty numeric;v_amount numeric:=0;net numeric:=0;freight numeric;tax numeric;already numeric;maxqty numeric;price numeric;v_kind text:=p_payload->>'kind';party uuid;v_party_type text;v_currency text;match text:='matched';required numeric;
begin
 perform pg_advisory_xact_lock(49281041);u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'finance','write');
 if p_action='fin_terms' then
  select * into o from public.erp_orders where id=(p_payload->>'order_id')::uuid;if not found or o.state='closed' then raise check_violation;end if;
  select * into t from public.erp_fin_terms where order_id=o.id;
  if found and (not (p_payload ? 'version') or t.version<>(p_payload->>'version')::integer) then raise exception using errcode='P0001',message='Payment terms changed. Reload.';end if;
  insert into public.erp_fin_terms(order_id,mode,deposit_percent,due_days,billing_event,created_by) values(o.id,p_payload->>'mode',public.erp_money(p_payload->>'deposit_percent',false),(p_payload->>'due_days')::integer,p_payload->>'billing_event',u.id)
  on conflict(order_id) do update set mode=excluded.mode,deposit_percent=excluded.deposit_percent,due_days=excluded.due_days,billing_event=excluded.billing_event,state='pending',approved_by=null,created_by=u.id,version=erp_fin_terms.version+1;
  return jsonb_build_object('id',o.id,'entity','fin_orders');
 elsif p_action='fin_approve_terms' then
  perform public.erp_assert(u.id,'finance','approve');select * into t from public.erp_fin_terms where order_id=target for update;
  if not found or t.version<>(p_payload->>'version')::integer then raise check_violation;end if;perform public.erp_approval(u.id,t.created_by,why);
  update public.erp_fin_terms set state='approved',approved_by=u.id,reason=why,version=version+1 where order_id=target;return jsonb_build_object('id',target,'entity','fin_orders');
 elsif p_action='fin_credit_policy' then
  perform public.erp_assert(u.id,'finance','approve');if why='' then raise check_violation;end if;
  party:=(p_payload->>'customer_id')::uuid;v_currency:=p_payload->>'currency';
  if exists(select from public.erp_fin_credit_policy where customer_id=party and currency=p_payload->>'currency') then
   update public.erp_fin_credit_policy cp set credit_limit=public.erp_money(p_payload->>'credit_limit',false),on_hold=(p_payload->>'on_hold')::boolean,hold_overdue=(p_payload->>'hold_overdue')::boolean,reason=why,version=version+1 where cp.customer_id=party and cp.currency=p_payload->>'currency' and cp.version=(p_payload->>'version')::integer;
   if not found then raise exception using errcode='P0001',message='Credit policy changed. Reload.';end if;
  else insert into public.erp_fin_credit_policy(customer_id,currency,credit_limit,on_hold,hold_overdue,reason) values(party,v_currency,public.erp_money(p_payload->>'credit_limit',false),(p_payload->>'on_hold')::boolean,(p_payload->>'hold_overdue')::boolean,why);end if;
  return jsonb_build_object('id',party,'entity','fin_credit_policies');
 elsif p_action='fin_dispatch_override' then
  perform public.erp_assert(u.id,'finance','approve');if why='' or (p_payload->>'expires_on')::date<public.erp_today() or (p_payload->>'expires_on')::date>public.erp_today()+7 then raise check_violation;end if;
  insert into public.erp_fin_dispatch_overrides(order_id,expires_on,reason,approved_by) values((p_payload->>'order_id')::uuid,(p_payload->>'expires_on')::date,why,u.id);return jsonb_build_object('id',p_payload->>'order_id','entity','fin_orders');
 elsif p_action='fin_create_document' then
  perform public.erp_check_date((p_payload->>'date')::date);
  if v_kind in ('payment_request','invoice') then
   select * into o from public.erp_orders where id=(p_payload->>'order_id')::uuid and state<>'closed';if not found then raise no_data_found;end if;select * into q from public.erp_quotes where id=o.quote_id;
   party:=q.customer_id;v_party_type:='customer';v_currency:=q.currency;
   select * into t from public.erp_fin_terms where order_id=o.id;if not found or t.state<>'approved' then raise exception using errcode='P0001',message='Approve the order payment terms before billing.';end if;
   snap:=o.snapshot||jsonb_build_object('order_number',o.number);
   if v_kind='payment_request' then
    v_amount:=public.erp_money(p_payload->>'amount');
    if v_amount+coalesce((select sum(dd.amount) from public.erp_fin_documents dd where dd.order_id=o.id and dd.kind='payment_request' and dd.state<>'void'),0)>(o.snapshot->'totals'->>'total')::numeric then raise exception using errcode='P0001',message='Payment requests exceed the order total.';end if;
   else
    if t.billing_event<>'order' then
     select to_jsonb(m) into e from public.erp_movements m where m.id=(p_payload->>'delivery_id')::uuid and order_id=o.id and kind='delivery' and state='posted';
     if e is null then raise exception using errcode='P0001',message='Choose a posted delivery for this billing event.';end if;
     if t.billing_event='receipt' and not exists(select from public.erp_delivery_receipts where delivery_id=(e->>'id')::uuid and status in ('received','partial')) then raise exception using errcode='P0001',message='Record customer receipt before invoicing.';end if;
    end if;
    if jsonb_typeof(p_payload->'lines')<>'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise check_violation;end if;
    for e in select * from jsonb_array_elements(p_payload->'lines') loop
     select * into ln from public.erp_order_lines where id=(e->>'line_id')::uuid and order_id=o.id;
     if not found or (select count(*) from jsonb_array_elements(p_payload->'lines') x where x->>'line_id'=e->>'line_id')<>1 then raise check_violation;end if;
     qty:=public.erp_qty(e->>'quantity');
     select coalesce(sum((x->>'quantity')::numeric),0) into already from public.erp_fin_documents dd cross join lateral jsonb_array_elements(dd.lines) x where dd.order_id=o.id and dd.kind='invoice' and dd.state<>'void' and x->>'line_id'=ln.id::text;
     maxqty:=ln.quantity;
     if t.billing_event<>'order' then
      select coalesce(sum((x->>'base_quantity')::numeric),0) into maxqty from public.erp_movements m cross join lateral jsonb_array_elements(m.lines) x where m.id=(p_payload->>'delivery_id')::uuid and x->>'order_line_id'=ln.id::text;
      -- Bound each delivery and the entire order independently.
      select maxqty-coalesce(sum((x->>'quantity')::numeric),0) into maxqty from public.erp_fin_documents dd cross join lateral jsonb_array_elements(dd.lines) x where dd.delivery_id=(p_payload->>'delivery_id')::uuid and dd.kind='invoice' and dd.state<>'void' and x->>'line_id'=ln.id::text;
     maxqty:=least(maxqty,ln.quantity-already);
     else maxqty:=maxqty-already;end if;
     if qty>maxqty then raise exception using errcode='P0001',message='Invoice quantity exceeds the unbilled order/delivery quantity.';end if;
     price:=(ln.snapshot->>'amount')::numeric/ln.quantity;net:=net+round(qty*price,6);
     lines:=lines||jsonb_build_array(jsonb_build_object('line_id',ln.id,'product_id',ln.product_id,'product',ln.snapshot->>'product','code',ln.snapshot->>'code','unit',ln.snapshot->>'base_unit','quantity',qty::text,'price',price::text,'amount',round(qty*price,6)::text));
    end loop;
    tax:=round(net*coalesce((o.snapshot->>'tax_rate')::numeric,0)/100,6);
    freight:=case when (o.snapshot->'totals'->>'subtotal')::numeric>0 then round(coalesce((o.snapshot->'totals'->>'freight')::numeric,0)*net/(o.snapshot->'totals'->>'subtotal')::numeric,6) else 0 end;
    v_amount:=net+tax+freight;
    select coalesce(sum(dd.amount),0) into already from public.erp_fin_documents dd where dd.order_id=o.id and dd.kind='invoice' and dd.state<>'void';
    if v_amount> (o.snapshot->'totals'->>'total')::numeric-already+0.00001 then raise exception using errcode='P0001',message='Invoices exceed the agreed order total.';end if;
    v_amount:=least(v_amount,(o.snapshot->'totals'->>'total')::numeric-already);
   end if;
  elsif v_kind in ('supplier_request','supplier_bill') then
   select * into po from public.erp_purchase_orders where id=(p_payload->>'purchase_id')::uuid and state<>'draft';if not found or po.state='cancelled' then raise no_data_found;end if;
   party:=po.supplier_id;v_party_type:='supplier';v_currency:=po.currency;snap:=jsonb_build_object('customer',coalesce(po.snapshot,(select to_jsonb(s) from public.erp_suppliers s where id=po.supplier_id)),'order_number',po.number,'currency',po.currency);
   if v_kind='supplier_request' then
    v_amount:=public.erp_money(p_payload->>'amount');
    if v_amount+coalesce((select sum(dd.amount) from public.erp_fin_documents dd where dd.purchase_id=po.id and dd.kind='supplier_request' and dd.state<>'void'),0)>(select sum(ppl.quantity*ppl.price) from public.erp_purchase_lines ppl where ppl.order_id=po.id) then raise check_violation;end if;
   else
    if length(btrim(coalesce(p_payload->>'external_reference','')))<1 or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise check_violation;end if;
    for e in select * from jsonb_array_elements(p_payload->'lines') loop
     select * into pl from public.erp_purchase_lines where id=(e->>'line_id')::uuid and order_id=po.id;if not found then raise no_data_found;end if;
     if (select count(*) from jsonb_array_elements(p_payload->'lines') x where x->>'line_id'=e->>'line_id')<>1 then raise check_violation;end if;
     qty:=public.erp_qty(e->>'quantity');price:=public.erp_money(e->>'price',false);
     select coalesce(sum((x->>'quantity')::numeric),0) into already from public.erp_fin_documents dd cross join lateral jsonb_array_elements(dd.lines) x where dd.purchase_id=po.id and dd.kind='supplier_bill' and dd.state<>'void' and x->>'line_id'=pl.id::text;
     if qty+already>pl.received then raise exception using errcode='P0001',message='Supplier bill exceeds received, unbilled quantity. Use an advance request before receipt.';end if;
     if price<>pl.price then match:='variance';end if;v_amount:=v_amount+round(qty*price,6);
     lines:=lines||jsonb_build_array(jsonb_build_object('line_id',pl.id,'product',pl.snapshot->>'name','code',pl.snapshot->>'code','unit',pl.snapshot->>'unit','quantity',qty::text,'price',price::text,'amount',(qty*price)::text,'agreed_price',pl.price::text));
    end loop;
   end if;
  elsif v_kind in ('credit_note','supplier_credit') then
   select * into related from public.erp_fin_documents where id=(p_payload->>'related_id')::uuid and state='issued' and kind=case when v_kind='credit_note' then 'invoice' else 'supplier_bill' end;
   if not found then raise check_violation;end if;
   v_amount:=public.erp_money(p_payload->>'amount');
   if v_amount+coalesce((select sum(dd.amount) from public.erp_fin_documents dd where dd.related_id=related.id and dd.kind=v_kind and dd.state<>'void'),0)>related.amount then raise exception using errcode='P0001',message='Credits exceed the original invoice amount.';end if;
   net:=round(coalesce((related.snapshot->'totals'->>'subtotal')::numeric,related.amount)*v_amount/related.amount,6);
   freight:=round(coalesce((related.snapshot->'totals'->>'freight')::numeric,0)*v_amount/related.amount,6);
   tax:=v_amount-net-freight;
   party:=related.party_id;v_party_type:=related.party_type;v_currency:=related.currency;snap:=related.snapshot;o.id:=related.order_id;po.id:=related.purchase_id;
   if why='' then raise exception using errcode='P0001',message='Explain the credit correction.';end if;
  else raise check_violation;end if;
  if v_amount is null or v_amount<=0 or v_amount>999999999999999 then raise check_violation;end if;
  if nullif(p_payload->>'case_id','') is not null and not exists(select from public.erp_cases where id=(p_payload->>'case_id')::uuid and state in ('approved','in_progress') and resolution in ('credit','refund')) then raise exception using errcode='P0001',message='Choose an approved financial claim.';end if;
  if nullif(p_payload->>'case_id','') is not null then
   if v_kind not in ('credit_note','supplier_credit') or not exists(select from public.erp_cases c where c.id=(p_payload->>'case_id')::uuid and c.currency=v_currency and ((c.source_type='order' and c.source_id=o.id) or (c.source_type='delivery' and (c.source_snapshot->>'order_id')::uuid=o.id) or (c.source_type='purchase' and c.source_id=po.id) or (c.source_type='receipt' and (c.source_snapshot->>'order_id')::uuid=po.id))) then raise exception using errcode='P0001',message='The credit must match the approved claim source order and counterparty.';end if;
  end if;
  if nullif(p_payload->>'case_id','') is not null and v_amount+coalesce((select sum(fd.amount) from public.erp_fin_documents fd where fd.case_id=(p_payload->>'case_id')::uuid and fd.state<>'void'),0)>(select settlement_amount from public.erp_cases where id=(p_payload->>'case_id')::uuid) then raise exception using errcode='P0001',message='Financial documents exceed the approved claim settlement amount.';end if;
  snap:=snap||jsonb_build_object('currency',v_currency,'lines',lines,'totals',jsonb_build_object('subtotal',(case when net>0 then net else v_amount end)::text,'tax',coalesce(tax,0)::text,'freight',coalesce(freight,0)::text,'total',v_amount::text),'terms',coalesce(nullif(p_payload->>'notes',''),why),'due_date',p_payload->>'due_date','related_number',related.number,'external_reference',p_payload->>'external_reference');
  insert into public.erp_fin_documents(number,kind,party_type,party_id,currency,order_id,delivery_id,purchase_id,related_id,case_id,date,due_date,amount,lines,external_reference,match_state,notes,snapshot,created_by)
  values(public.erp_number(case v_kind when 'invoice' then 'INV' when 'credit_note' then 'CN' when 'supplier_bill' then 'BILL' when 'supplier_credit' then 'SCN' when 'payment_request' then 'REQ' else 'ADV' end),v_kind,v_party_type,party,v_currency,o.id,nullif(p_payload->>'delivery_id','')::uuid,po.id,related.id,nullif(p_payload->>'case_id','')::uuid,(p_payload->>'date')::date,(p_payload->>'due_date')::date,v_amount,lines,coalesce(p_payload->>'external_reference',''),match,coalesce(p_payload->>'notes',why),snap,u.id) returning id into target;
  return jsonb_build_object('id',target,'entity','fin_documents');
 elsif p_action in ('fin_issue_document','fin_void_document') then
  select * into d from public.erp_fin_documents where id=target for update;if not found or d.version<>(p_payload->>'version')::integer then raise check_violation;end if;
  perform public.erp_assert(u.id,'finance','approve');perform public.erp_approval(u.id,d.created_by,why);
  if p_action='fin_void_document' then
   if d.state<>'draft' then raise exception using errcode='P0001',message='Only drafts can be voided. Correct issued invoices with a credit note.';end if;
   update public.erp_fin_documents set state='void',version=version+1 where id=d.id;
  else
   if d.state<>'draft' then raise check_violation;end if;perform public.erp_check_date(d.date);
   -- Re-check bill quantities against current receiving, including receipt reversals after drafting.
   if d.kind='supplier_bill' and exists(select from jsonb_array_elements(d.lines) x join public.erp_purchase_lines l on l.id=(x->>'line_id')::uuid where (select sum((z->>'quantity')::numeric) from public.erp_fin_documents dd cross join lateral jsonb_array_elements(dd.lines) z where dd.purchase_id=d.purchase_id and dd.kind='supplier_bill' and dd.state<>'void' and z->>'line_id'=l.id::text)>l.received) then raise exception using errcode='P0001',message='Receipt quantities changed. Review the supplier bill.';end if;
   if d.kind='invoice' and d.delivery_id is not null and not exists(select from public.erp_movements where id=d.delivery_id and state='posted') then raise check_violation;end if;
   update public.erp_fin_documents set state='issued',issued_by=u.id,version=version+1,snapshot=snapshot||jsonb_build_object('number',number,'date',date,'issuer',u.nama_lengkap,'document_kind',kind) where id=d.id;
  end if;return jsonb_build_object('id',d.id,'entity','fin_documents');
 elsif p_action='fin_record_payment' then
  perform public.erp_check_date((p_payload->>'date')::date);party:=(p_payload->>'party_id')::uuid;v_party_type:=p_payload->>'party_type';
  if (v_party_type='customer' and not exists(select from public.erp_customers where id=party)) or (v_party_type='supplier' and not exists(select from public.erp_suppliers where id=party)) then raise check_violation;end if;
  if (p_payload->>'direction' in ('receipt','refund')) is distinct from (v_party_type='customer') then raise check_violation;end if;
  if length(btrim(coalesce(p_payload->>'bank_account','')))<1 or length(btrim(coalesce(p_payload->>'bank_reference','')))<1 or length(btrim(coalesce(p_payload->>'evidence','')))<3 then raise check_violation;end if;
  insert into public.erp_fin_payments(number,direction,party_type,party_id,currency,amount,date,bank_account,bank_reference,evidence,notes,created_by)
  values(public.erp_number('PAY'),p_payload->>'direction',v_party_type,party,p_payload->>'currency',public.erp_money(p_payload->>'amount'),(p_payload->>'date')::date,p_payload->>'bank_account',p_payload->>'bank_reference',p_payload->>'evidence',coalesce(p_payload->>'notes',''),u.id) returning id into target;return jsonb_build_object('id',target,'entity','fin_payments');
 elsif p_action in ('fin_verify_payment','fin_void_payment') then
  select * into pay from public.erp_fin_payments where id=target for update;if not found or pay.version<>(p_payload->>'version')::integer then raise check_violation;end if;
  perform public.erp_assert(u.id,'finance','approve');perform public.erp_approval(u.id,pay.created_by,why);
  perform public.erp_check_date(pay.date);
  if pay.state='void' or (p_action='fin_verify_payment' and pay.state<>'draft') then raise check_violation;end if;
  if p_action='fin_void_payment' and exists(select from public.erp_fin_allocations where payment_id=pay.id and state='active') then raise exception using errcode='P0001',message='Reverse active allocations before voiding this payment.';end if;
  update public.erp_fin_payments set state=case when p_action='fin_verify_payment' then 'verified' else 'void' end,verified_by=case when p_action='fin_verify_payment' then u.id else verified_by end,version=version+1,notes=notes||E'\n'||why where id=pay.id;return jsonb_build_object('id',pay.id,'entity','fin_payments');
 elsif p_action in ('fin_allocate','fin_move_allocation','fin_reverse_allocation') then
  if p_action in ('fin_move_allocation','fin_reverse_allocation') then
   perform public.erp_assert(u.id,'finance','approve');select * into a from public.erp_fin_allocations where id=target and state='active' for update;if not found or why='' then raise check_violation;end if;
   if p_action='fin_reverse_allocation' then update public.erp_fin_allocations set state='reversed',reversed_by=u.id,reversed_at=now(),reversal_reason=why where id=a.id;return jsonb_build_object('id',a.payment_id,'entity','fin_payments');end if;
   update public.erp_fin_allocations set state='reversed',reversed_by=u.id,reversed_at=now(),reversal_reason=why where id=a.id;pay.id:=a.payment_id;
  else pay.id:=(p_payload->>'payment_id')::uuid;end if;
  select * into pay from public.erp_fin_payments where id=pay.id and state='verified' for update;
  select * into d from public.erp_fin_documents where id=(p_payload->>'document_id')::uuid and state='issued' for update;
  if pay.id is null or d.id is null or pay.party_type<>d.party_type or pay.party_id<>d.party_id or pay.currency<>d.currency then raise exception using errcode='P0001',message='Choose a verified payment and issued document for the same party and currency.';end if;
  if not ((pay.direction='receipt' and d.kind in ('invoice','payment_request')) or (pay.direction='payment' and d.kind in ('supplier_bill','supplier_request')) or (pay.direction='refund' and d.kind='credit_note') or (pay.direction='supplier_refund' and d.kind='supplier_credit')) then raise check_violation;end if;
  v_amount:=public.erp_money(p_payload->>'amount');if p_action='fin_move_allocation' then
   if v_amount>a.amount or d.id=a.document_id then raise check_violation;end if;
   if v_amount<a.amount then insert into public.erp_fin_allocations(payment_id,document_id,amount,reason,created_by) values(pay.id,a.document_id,a.amount-v_amount,'Remainder of allocation '||a.id||' · '||why,u.id);end if;
  end if;
  if v_amount+coalesce((select sum(aa.amount) from public.erp_fin_allocations aa where aa.payment_id=pay.id and aa.state='active'),0)>pay.amount or v_amount>public.erp_fin_outstanding(d.id) then raise exception using errcode='P0001',message='Allocation exceeds the available payment or document balance.';end if;
  insert into public.erp_fin_allocations(payment_id,document_id,amount,reason,created_by) values(pay.id,d.id,v_amount,coalesce(nullif(why,''),'Payment allocation'),u.id);
  if d.case_id is not null and pay.direction in ('refund','supplier_refund') and public.erp_fin_outstanding(d.id)=0 and (select coalesce(sum(fd.amount-public.erp_fin_outstanding(fd.id)),0) from public.erp_fin_documents fd where fd.case_id=d.case_id and fd.state='issued')>=(select settlement_amount from public.erp_cases where id=d.case_id) and exists(select from public.erp_cases where id=d.case_id and resolution='refund') then insert into public.erp_case_executions(case_id,kind,reference,created_by) values(d.case_id,'financial',pay.number||' refund verified',u.id);end if;
  return jsonb_build_object('id',pay.id,'entity','fin_payments');
 elsif p_action='fin_apply_credit' then
  perform public.erp_assert(u.id,'finance','approve');select * into d from public.erp_fin_documents where id=(p_payload->>'credit_id')::uuid and kind in ('credit_note','supplier_credit') and state='issued' for update;
  select * into related from public.erp_fin_documents where id=(p_payload->>'invoice_id')::uuid and kind=case when d.kind='credit_note' then 'invoice' else 'supplier_bill' end and state='issued' for update;
  v_amount:=public.erp_money(p_payload->>'amount');if d.id is null or related.id is null or d.party_id<>related.party_id or d.currency<>related.currency or v_amount>public.erp_fin_outstanding(d.id) or v_amount>public.erp_fin_outstanding(related.id) or why='' then raise check_violation;end if;
  insert into public.erp_fin_credit_applications(credit_id,invoice_id,amount,reason,created_by) values(d.id,related.id,v_amount,why,u.id);
  if d.case_id is not null and public.erp_fin_outstanding(d.id)=0 and (select coalesce(sum(fd.amount-public.erp_fin_outstanding(fd.id)),0) from public.erp_fin_documents fd where fd.case_id=d.case_id and fd.state='issued')>=(select settlement_amount from public.erp_cases where id=d.case_id) and exists(select from public.erp_cases where id=d.case_id and resolution='credit') then insert into public.erp_case_executions(case_id,kind,reference,created_by) values(d.case_id,'financial',d.number||' credit applied',u.id);end if;
  return jsonb_build_object('id',related.id,'entity','fin_documents');
 elsif p_action='fin_collection' then
  select * into d from public.erp_fin_documents where id=(p_payload->>'document_id')::uuid and state='issued' and kind in ('invoice','supplier_bill');if not found or why='' then raise check_violation;end if;
  if p_payload->>'kind'='promise' then
   if (p_payload->>'promised_date')::date<public.erp_today() or public.erp_money(p_payload->>'promised_amount')>public.erp_fin_outstanding(d.id) then raise check_violation;end if;
  elsif p_payload->>'kind'='resolve_dispute' then perform public.erp_assert(u.id,'finance','approve');end if;
  insert into public.erp_fin_collection_events(document_id,kind,notes,promised_date,promised_amount,created_by,outstanding_at_recording) values(d.id,p_payload->>'kind',why,nullif(p_payload->>'promised_date','')::date,nullif(p_payload->>'promised_amount','')::numeric,u.id,public.erp_fin_outstanding(d.id));
  if p_payload->>'kind' in ('dispute','resolve_dispute') then update public.erp_fin_documents set disputed=p_payload->>'kind'='dispute',dispute_reason=why,version=version+1 where id=d.id;end if;
  return jsonb_build_object('id',d.id,'entity','fin_documents');
 else raise exception using errcode='P0001',message='Unknown finance action.';end if;
end $$;
-- Private tables and append-only allocation/collection history, all access through session RPCs.
do $$declare t text;begin
 foreach t in array array['erp_fin_terms','erp_fin_credit_policy','erp_fin_dispatch_overrides','erp_fin_documents','erp_fin_payments','erp_fin_allocations','erp_fin_credit_applications','erp_fin_collection_events'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('drop trigger if exists erp_audit on public.%I',t);execute format('create trigger erp_audit after insert or update or delete on public.%I for each row execute function public.erp_audit()',t);
 end loop;
end $$;
revoke all on function public.erp_fin_mutate(text,text,jsonb),public.erp_fin_allocated(uuid),public.erp_fin_outstanding(uuid),public.erp_fin_dispatch_status(uuid) from public,anon,authenticated,service_role;
commit;
