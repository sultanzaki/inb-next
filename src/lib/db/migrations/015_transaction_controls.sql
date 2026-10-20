begin;
-- Phase 4 core: explicit remaining-quantity closure, reviewed purchase variance,
-- and append-only document history. No tolerance or automatic write-off policy.
do $$begin
 if to_regprocedure('public.erp_choices(text,text,text,integer,jsonb)') is null then raise exception 'Migration 015 requires migration 014.';end if;
end $$;
alter table public.erp_purchase_orders drop constraint if exists erp_purchase_orders_state_check;
alter table public.erp_purchase_orders add constraint erp_purchase_orders_state_check check(state in ('draft','confirmed','partial','received','cancelled','closed'));
create table if not exists public.erp_order_closures(
 id uuid primary key default gen_random_uuid(),source_type text not null check(source_type in ('order','purchase')),source_id uuid not null,
 reason text not null check(length(btrim(reason))>=3),lines jsonb not null,financial_snapshot jsonb not null,review_token text not null,
 approved_by uuid not null references public.users(id),created_at timestamptz not null default now(),unique(source_type,source_id));
create table if not exists public.erp_bill_reviews(
 document_id uuid primary key references public.erp_fin_documents(id),document_version integer not null,purchase_version integer not null,
 review_token text not null,reason text not null check(length(btrim(reason))>=10),reviewed_by uuid not null references public.users(id),created_at timestamptz not null default now());
create table if not exists public.erp_document_events(
 id bigint generated always as identity primary key,transaction_id bigint not null default txid_current(),
 entity text not null,source_id uuid not null,action text not null,actor_id uuid references public.users(id),actor_name text not null,
 reason text not null default '',changes jsonb not null,created_at timestamptz not null default now());
create index if not exists erp_document_events_source on public.erp_document_events(entity,source_id,id desc);
create or replace function public.erp_event_immutable() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
 raise sqlstate '55000' using message='Document history and closure records are immutable.';
end $$;
drop trigger if exists erp_document_events_immutable on public.erp_document_events;
create trigger erp_document_events_immutable before update or delete on public.erp_document_events for each row execute function public.erp_event_immutable();
drop trigger if exists erp_closure_immutable on public.erp_order_closures;
create trigger erp_closure_immutable before update or delete on public.erp_order_closures for each row execute function public.erp_event_immutable();

create or replace function public.erp_delivered_order_total(p_order uuid) returns numeric language sql stable set search_path=pg_catalog,public as $$
 select round(coalesce((o.snapshot->'totals'->>'total')::numeric,0)*coalesce((select sum((l.snapshot->>'amount')::numeric*l.delivered/nullif(l.quantity,0)) from public.erp_order_lines l where l.order_id=o.id),0)/nullif((o.snapshot->'totals'->>'subtotal')::numeric,0),6) from public.erp_orders o where o.id=p_order
$$;
create or replace function public.erp_close_preview(p_type text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare source jsonb;lines jsonb;docs jsonb;terms jsonb;blocks jsonb:='[]';cap numeric;requests numeric;billed numeric;credits numeric;info jsonb;
begin
 if p_type='order' then
  select to_jsonb(o) into source from public.erp_orders o where id=p_id;
  if source is null then raise no_data_found;end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'product',l.snapshot->>'product','unit',l.snapshot->>'base_unit','ordered',l.quantity::text,'actual',l.delivered::text,'closing',(l.quantity-l.delivered)::text,'reserved',coalesce((select sum(remaining) from public.erp_reservations where order_line_id=l.id and state='active'),0)::text) order by l.position),'[]') into lines from public.erp_order_lines l where order_id=p_id;
  if source->>'state'<>'confirmed' then blocks:=blocks||jsonb_build_array('Only an open confirmed sales order can close its remaining quantities.');end if;
  if exists(select from public.erp_movements where order_id=p_id and kind='delivery' and state='draft') then blocks:=blocks||jsonb_build_array('Post or cancel draft deliveries before closing the order.');end if;
  cap:=coalesce(public.erp_delivered_order_total(p_id),0);
  select coalesce(to_jsonb(t),'{}') into terms from public.erp_fin_terms t where order_id=p_id;
  if exists(select from public.erp_modules where key='finance' and state<>'disabled') and cap>0 and coalesce(terms->>'state','')<>'approved' then blocks:=blocks||jsonb_build_array('Approve payment terms before closing a partially delivered order so final billing can continue.');end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'state',state,'version',version,'amount',amount::text,'allocated',public.erp_fin_allocated(id)::text) order by id),'[]'),coalesce(sum(amount) filter(where kind='payment_request' and state<>'void'),0),coalesce(sum(amount) filter(where kind='invoice' and state='issued'),0) into docs,requests,billed from public.erp_fin_documents where order_id=p_id;
  select coalesce(sum(a.amount),0) into credits from public.erp_fin_credit_applications a join public.erp_fin_documents d on d.id=a.invoice_id where d.order_id=p_id;
 else
  if p_type<>'purchase' then raise check_violation;end if;
  select to_jsonb(p) into source from public.erp_purchase_orders p where id=p_id;
  if source is null then raise no_data_found;end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'product',l.snapshot->>'name','unit',l.snapshot->>'unit','ordered',l.quantity::text,'actual',l.received::text,'closing',(l.quantity-l.received)::text) order by l.position),'[]'),coalesce(sum(l.received*l.price),0) into lines,cap from public.erp_purchase_lines l where order_id=p_id;
  if source->>'state' not in ('confirmed','partial') then blocks:=blocks||jsonb_build_array('Only confirmed or partially received purchases can close their remaining quantities.');end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'state',state,'version',version,'amount',amount::text,'allocated',public.erp_fin_allocated(id)::text) order by id),'[]'),coalesce(sum(amount) filter(where kind='supplier_request' and state<>'void'),0) into docs,requests from public.erp_fin_documents where purchase_id=p_id;
 end if;
 if not exists(select from jsonb_array_elements(lines) x where (x->>'closing')::numeric>0) then blocks:=blocks||jsonb_build_array('There is no remaining quantity to close.');end if;
 if exists(select from jsonb_array_elements(docs) d where d->>'state'='draft') then blocks:=blocks||jsonb_build_array('Issue or void draft billing documents before closing.');end if;
 if requests>cap then blocks:=blocks||jsonb_build_array('Advance requests exceed the delivered/received value. Finance must reverse active allocations as needed and cancel or replace excess requests before closing. Funds remain recorded; cancellation is not a refund.');end if;
 if p_type='order' and billed-coalesce(credits,0)>cap+0.00001 then blocks:=blocks||jsonb_build_array('Issued invoices exceed the delivered value. Issue and apply the required credit correction before closing.');end if;
 info:=jsonb_build_object('source_type',p_type,'source_id',p_id,'number',source->>'number','state',source->>'state','version',source->'version','lines',lines,'financial',jsonb_build_object('actual_value',cap::text,'advance_requested',requests::text,'issued_invoices',billed::text,'applied_credits',credits::text),'documents',docs,'terms',terms,'blockers',blocks,'can_close',jsonb_array_length(blocks)=0);
 return info||jsonb_build_object('review_token',md5(info::text));
end $$;

create or replace function public.erp_bill_match(p_document uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare d public.erp_fin_documents;p public.erp_purchase_orders;items jsonb;outcome jsonb;
begin
 select * into d from public.erp_fin_documents where id=p_document and kind='supplier_bill';if not found then return null;end if;
 select * into p from public.erp_purchase_orders where id=d.purchase_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'product',l.snapshot->>'name','unit',l.snapshot->>'unit','ordered',l.quantity::text,'received',l.received::text,'billed_elsewhere',coalesce(other.quantity,0)::text,'bill_quantity',x->>'quantity','agreed_price',l.price::text,'bill_price',x->>'price','price_variance',(((x->>'price')::numeric-l.price)*(x->>'quantity')::numeric)::text,'quantity_valid',coalesce(other.quantity,0)+(x->>'quantity')::numeric<=l.received) order by l.position),'[]') into items
 from jsonb_array_elements(d.lines) x join public.erp_purchase_lines l on l.id=(x->>'line_id')::uuid and l.order_id=p.id
 left join lateral (select sum((z->>'quantity')::numeric) quantity from public.erp_fin_documents b cross join lateral jsonb_array_elements(b.lines) z where b.purchase_id=p.id and b.kind='supplier_bill' and b.state<>'void' and b.id<>d.id and z->>'line_id'=l.id::text) other on true;
 outcome:=jsonb_build_object('purchase_id',p.id,'purchase_number',p.number,'purchase_version',p.version,'document_version',d.version,'lines',items,'quantity_valid',jsonb_array_length(items)=jsonb_array_length(d.lines) and not exists(select from jsonb_array_elements(items) x where not (x->>'quantity_valid')::boolean),'has_variance',exists(select from jsonb_array_elements(items) x where (x->>'price_variance')::numeric<>0));
 return outcome||jsonb_build_object('review_token',md5(outcome::text));
end $$;

-- Capture compact business changes from the underlying tables, including nested
-- mutations. Existing records are not backfilled into invented historical events.
create or replace function public.erp_capture_document_event() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare before_row jsonb;after_row jsonb;r jsonb;e text;ids uuid[];target uuid;actor uuid;actor_name text;summary jsonb;
begin
 before_row:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;r:=case when tg_op='DELETE' then before_row else after_row end;
 if tg_op='UPDATE' and before_row-'updated_at'=after_row-'updated_at' then return new;end if;
 case tg_table_name
 when 'erp_orders' then e:='order';ids:=array[(r->>'id')::uuid];
 when 'erp_order_lines' then e:='order';ids:=array[(r->>'order_id')::uuid];
 when 'erp_reservations' then e:='order';select array[order_id] into ids from public.erp_order_lines where id=(r->>'order_line_id')::uuid;
 when 'erp_fin_terms' then e:='order';ids:=array[(r->>'order_id')::uuid];
 when 'erp_purchase_orders' then e:='purchase';ids:=array[(r->>'id')::uuid];
 when 'erp_purchase_lines' then e:='purchase';ids:=array[(r->>'order_id')::uuid];
 when 'erp_quotes' then e:='quote';ids:=array[(r->>'id')::uuid];
 when 'erp_movements' then e:='movement';ids:=array[(r->>'id')::uuid];
 when 'erp_fin_documents' then e:='billing';ids:=array[(r->>'id')::uuid];
 when 'erp_fin_payments' then e:='payment';ids:=array[(r->>'id')::uuid];
 when 'erp_fin_allocations' then
  actor:=nullif(current_setting('inb.actor',true),'')::uuid;select nama_lengkap into actor_name from public.users where id=actor;
  summary:=jsonb_build_object('table',tg_table_name,'row_id',r->>'id','before',before_row-'evidence','after',after_row-'evidence');
  insert into public.erp_document_events(entity,source_id,action,actor_id,actor_name,reason,changes) values('payment',(r->>'payment_id')::uuid,coalesce(nullif(current_setting('inb.action',true),''),lower(tg_op)),actor,coalesce(actor_name,'Database administrator'),coalesce(current_setting('inb.reason',true),''),summary);
  e:='billing';ids:=array[(r->>'document_id')::uuid];
 when 'erp_fin_credit_applications' then e:='billing';ids:=array[(r->>'credit_id')::uuid,(r->>'invoice_id')::uuid];
 when 'erp_bill_reviews' then e:='billing';ids:=array[(r->>'document_id')::uuid];
 when 'erp_order_closures' then e:=r->>'source_type';ids:=array[(r->>'source_id')::uuid];
 else return null;end case;
 actor:=nullif(current_setting('inb.actor',true),'')::uuid;select nama_lengkap into actor_name from public.users where id=actor;
 select coalesce(jsonb_object_agg(key,value),'{}') into before_row from jsonb_each(before_row) where key in ('state','version','number','quantity','delivered','received','remaining','amount','date','due_date','price','mode','deposit_percent','due_days','billing_event','reason','lines','document_version','purchase_version','review_token');
 select coalesce(jsonb_object_agg(key,value),'{}') into after_row from jsonb_each(after_row) where key in ('state','version','number','quantity','delivered','received','remaining','amount','date','due_date','price','mode','deposit_percent','due_days','billing_event','reason','lines','document_version','purchase_version','review_token');
 foreach target in array ids loop
  insert into public.erp_document_events(entity,source_id,action,actor_id,actor_name,reason,changes) values(e,target,coalesce(nullif(current_setting('inb.action',true),''),lower(tg_op)),actor,coalesce(actor_name,'Database administrator'),coalesce(current_setting('inb.reason',true),''),jsonb_build_object('table',tg_table_name,'row_id',r->>'id','before',before_row,'after',after_row));
 end loop;return null;
end $$;
do $$declare t text;begin
 foreach t in array array['erp_orders','erp_order_lines','erp_reservations','erp_fin_terms','erp_purchase_orders','erp_purchase_lines','erp_quotes','erp_movements','erp_fin_documents','erp_fin_payments','erp_fin_allocations','erp_fin_credit_applications','erp_bill_reviews','erp_order_closures'] loop
  execute format('drop trigger if exists erp_document_history on public.%I',t);
  execute format('create trigger erp_document_history after insert or update or delete on public.%I for each row execute function public.erp_capture_document_event()',t);
 end loop;
end $$;

-- Preserve existing accounting, warehouse and role checks behind one serial guard.
do $$begin
 if to_regprocedure('public.erp_mutate_v15(text,text,jsonb)') is null then alter function public.erp_mutate(text,text,jsonb) rename to erp_mutate_v15;end if;
end $$;
create or replace function public.erp_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;o public.erp_orders;p public.erp_purchase_orders;d public.erp_fin_documents;preview jsonb;matching jsonb;result jsonb;kind text;target uuid;why text:=btrim(coalesce(p_payload->>'reason',''));review public.erp_bill_reviews;prior_actor text;prior_action text;prior_reason text;
begin
 perform pg_advisory_xact_lock(49281041);u:=public.erp_actor(p_token);
 prior_actor:=current_setting('inb.actor',true);prior_action:=current_setting('inb.action',true);prior_reason:=current_setting('inb.reason',true);
 perform set_config('inb.actor',u.id::text,true);perform set_config('inb.action',p_action,true);perform set_config('inb.reason',why,true);
 target:=nullif(p_payload->>'id','')::uuid;
 if p_action like 'fin_%' then perform public.erp_assert(u.id,'finance','write');end if;
 if p_action='reverse_move' then perform public.erp_assert(u.id,case when (select m.kind from public.erp_movements m where m.id=target)='production' then 'production' else 'warehouse' end,'approve');end if;
 if p_action='reverse_material_transaction' then perform public.erp_assert(u.id,'warehouse','approve');end if;
 if p_action in ('close_order','close_purchase') then
  kind:=case when p_action='close_order' then 'order' else 'purchase' end;
  perform public.erp_assert(u.id,case kind when 'order' then 'sales' else 'purchase' end,'approve');
  if kind='order' then select * into o from public.erp_orders where id=target for update;if not found then raise no_data_found;end if;perform public.erp_approval(u.id,(select created_by from public.erp_quotes where id=o.quote_id),why);
  else select * into p from public.erp_purchase_orders where id=target for update;if not found then raise no_data_found;end if;perform public.erp_approval(u.id,p.created_by,why);end if;
  preview:=public.erp_close_preview(kind,target);
  if not (preview->>'can_close')::boolean then raise exception using errcode='P0001',message=preview->'blockers'->>0;end if;
  if coalesce(p_payload->>'review_token','')<>preview->>'review_token' then raise exception using errcode='P0001',message='Order details changed. Reopen the closure preview and review the current quantities and billing.';end if;
  if kind='purchase' and p.version is distinct from (p_payload->>'version')::integer then raise exception using errcode='P0001',message='Purchase order changed. Review the latest closure preview.';end if;
  insert into public.erp_order_closures(source_type,source_id,reason,lines,financial_snapshot,review_token,approved_by) values(kind,target,why,preview->'lines',preview->'financial',preview->>'review_token',u.id);
  if kind='order' then
   update public.erp_reservations set remaining=0,state='cancelled' where order_line_id in(select id from public.erp_order_lines where order_id=target) and state='active';
   update public.erp_orders set state='closed' where id=target;
  else update public.erp_purchase_orders set state='closed',reason=why,version=version+1 where id=target;end if;
  result:=jsonb_build_object('id',target,'entity',case kind when 'order' then 'orders' else 'purchases' end);
 elsif p_action='fin_review_variance' then
  perform public.erp_assert(u.id,'finance','approve');
  select * into d from public.erp_fin_documents where id=target for update;
  if not found or d.kind<>'supplier_bill' or d.state<>'draft' or d.version is distinct from (p_payload->>'version')::integer then raise exception using errcode='P0001',message='Choose the current draft supplier bill.';end if;
  perform public.erp_approval(u.id,d.created_by,why);matching:=public.erp_bill_match(target);
  if length(why)<10 or not coalesce((p_payload->>'acknowledged')::boolean,false) then raise exception using errcode='P0001',message='Acknowledge the variance and explain the review in at least 10 characters.';end if;
  if not (matching->>'quantity_valid')::boolean then raise exception using errcode='P0001',message='Billed quantities exceed current receipts. Correct or void the draft bill before reviewing a price variance.';end if;
  if matching->>'review_token'<>coalesce(p_payload->>'review_token','') then raise exception using errcode='P0001',message='Matching details changed. Refresh and review the current values.';end if;
  insert into public.erp_bill_reviews(document_id,document_version,purchase_version,review_token,reason,reviewed_by) values(target,d.version,(matching->>'purchase_version')::integer,matching->>'review_token',why,u.id)
  on conflict(document_id) do update set document_version=excluded.document_version,purchase_version=excluded.purchase_version,review_token=excluded.review_token,reason=excluded.reason,reviewed_by=excluded.reviewed_by,created_at=now();
  result:=jsonb_build_object('id',target,'entity','fin_documents');
 elsif p_action='fin_cancel_request' then
  perform public.erp_assert(u.id,'finance','approve');select * into d from public.erp_fin_documents where id=target for update;
  if not found or d.kind not in ('payment_request','supplier_request') or d.state<>'issued' or d.version is distinct from (p_payload->>'version')::integer then raise exception using errcode='P0001',message='Choose the current issued advance request.';end if;
  perform public.erp_approval(u.id,d.created_by,why);
  if exists(select from public.erp_fin_allocations where document_id=target and state='active') then raise exception using errcode='P0001',message='Reverse or move active allocations before cancelling this request. Recorded funds are retained and are not refunded automatically.';end if;
  update public.erp_fin_documents set state='void',version=version+1,notes=notes||E'\nRequest cancelled: '||why where id=target;
  result:=jsonb_build_object('id',target,'entity','fin_documents');
 else
  if p_action='cancel_purchase' then
   select * into p from public.erp_purchase_orders where id=target;perform public.erp_assert(u.id,'purchase',case when p.state='draft' then 'write' else 'approve' end);
   if exists(select from public.erp_purchase_lines where order_id=target and received>0) then raise exception using errcode='P0001',message='This purchase has received quantities. Use Close remaining quantities to retain the completed receipt history.';end if;
   if exists(select from public.erp_fin_documents fd where fd.purchase_id=target and fd.state<>'void') then raise exception using errcode='P0001',message='Resolve linked billing before cancelling this purchase.';end if;
  end if;
  if p_action='reverse_move' and exists(select from public.erp_movements m join public.erp_order_closures c on c.source_type='order' and c.source_id=m.order_id where m.id=target) then raise exception using errcode='P0001',message='This order is closed. Use a controlled claim/return; reversing it would change the approved closure quantities.';end if;
  if p_action='reverse_material_transaction' and exists(select from public.erp_material_transactions t join public.erp_order_closures c on c.source_type='purchase' and c.source_id=t.order_id where t.id=target) then raise exception using errcode='P0001',message='This purchase is closed. Use a supplier claim/return instead of reopening received quantities.';end if;
  if p_action='fin_create_document' and p_payload->>'kind' in ('payment_request','supplier_request') and exists(select from public.erp_order_closures oc where oc.source_id=coalesce(nullif(p_payload->>'order_id','')::uuid,nullif(p_payload->>'purchase_id','')::uuid) and source_type=case when p_payload->>'kind'='payment_request' then 'order' else 'purchase' end) then raise exception using errcode='P0001',message='This order is closed. No new advance requests are allowed; bill only the delivered or received quantities.';end if;
  if p_action='fin_issue_document' then
   perform public.erp_assert(u.id,'finance','approve');select * into d from public.erp_fin_documents where id=target;
   if d.kind='supplier_bill' then
    matching:=public.erp_bill_match(target);select * into review from public.erp_bill_reviews where document_id=target;
    if (matching->>'has_variance')::boolean and (review.document_id is null or review.review_token<>matching->>'review_token') then raise exception using errcode='P0001',message='Review and acknowledge the current PO / receipt / bill variance before issuing this bill.';end if;
   end if;
  end if;
  result:=public.erp_mutate_v15(p_token,p_action,p_payload);
 end if;
 if p_action in ('close_order','close_purchase','fin_review_variance','fin_cancel_request') then insert into public.audit_log(user_name,aksi,referensi,after_data) values(u.nama_lengkap,'erp_'||p_action,target::text,jsonb_build_object('request',p_payload,'result',result));end if;
 perform set_config('inb.actor',coalesce(prior_actor,''),true);perform set_config('inb.action',coalesce(prior_action,''),true);perform set_config('inb.reason',coalesce(prior_reason,''),true);
 return result;
end $$;
-- Closed quantities cannot be dispatched/received again, but actual deliveries
-- and receipts must remain billable. Preserve original quantities and totals.
do $$declare body text;begin
 body:=pg_get_functiondef('public.erp_fin_mutate(text,text,jsonb)'::regprocedure);
 body:=replace(body,$old$where id=(p_payload->>'order_id')::uuid and state<>'closed'$old$,$new$where id=(p_payload->>'order_id')::uuid and (state<>'closed' or p_payload->>'kind'='invoice')$new$);
 body:=replace(body,$old$if not found or o.state='closed' then raise check_violation;end if;$old$,$new$if not found or (o.state='closed' and coalesce(public.erp_delivered_order_total(o.id),0)=0) then raise check_violation;end if;$new$);
 body:=replace(body,'maxqty:=ln.quantity;',$patch$maxqty:=case when o.state='closed' then ln.delivered else ln.quantity end;$patch$);
 body:=replace(body,'maxqty:=least(maxqty,ln.quantity-already);',$patch$maxqty:=least(maxqty,(case when o.state='closed' then ln.delivered else ln.quantity end)-already);$patch$);
 execute body;
 body:=pg_get_functiondef('public.erp_fin_read(text,text,text,text,integer,text)'::regprocedure);
 body:=replace(body,$patch$'unbilled',(l.quantity-coalesce($patch$,$patch$'unbilled',((case when o.state='closed' then l.delivered else l.quantity end)-coalesce($patch$);
 execute body;
 body:=pg_get_functiondef('public.erp_fin_dispatch_status(uuid)'::regprocedure);
 if position('erp_delivered_order_total(ord.id)' in body)=0 then
 body:=replace(body,$patch$ord.state in ('confirmed','fulfilled')$patch$, $patch$ord.state in ('confirmed','fulfilled','closed')$patch$);
 body:=replace(body,$patch$(ord.snapshot->'totals'->>'total')::numeric$patch$, $patch$(case when ord.state='closed' then coalesce(public.erp_delivered_order_total(ord.id),0) else (ord.snapshot->'totals'->>'total')::numeric end)$patch$);
 end if;
 execute body;
end $$;

create or replace function public.erp_controls(p_token text,p_entity text,p_id text,p_page integer default 1) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;root jsonb;kind text;preview jsonb;closure jsonb;matching jsonb;review jsonb;history jsonb;total bigint;result jsonb;
begin
 u:=public.erp_actor(p_token);
 if p_entity not in ('orders','fulfillment','fin_orders','purchases','fin_purchases','quotes','movements','production','fin_documents','fin_payments') or p_page<1 or p_page>1000000 then raise check_violation;end if;
 root:=public.erp_read(p_token,p_entity,'','',1,p_id)->'rows'->0;if root is null then raise no_data_found;end if;
 kind:=case when p_entity in ('orders','fulfillment','fin_orders') then 'order' when p_entity in ('purchases','fin_purchases') then 'purchase' when p_entity='quotes' then 'quote' when p_entity in ('movements','production') then 'movement' when p_entity='fin_documents' then 'billing' else 'payment' end;
 if kind in ('order','purchase') then
  preview:=public.erp_close_preview(kind,p_id::uuid);
  select to_jsonb(c)||jsonb_build_object('approver',approver.nama_lengkap) into closure from public.erp_order_closures c join public.users approver on approver.id=c.approved_by where source_type=kind and source_id=p_id::uuid;
  if kind='order' and not public.erp_can(u.id,'sales','read') and not public.erp_can(u.id,'finance','read') then preview:=preview-'financial'-'documents'-'terms'-'review_token';closure:=closure-'financial_snapshot';end if;
 end if;
 if kind='billing' then
  matching:=public.erp_bill_match(p_id::uuid);
  select to_jsonb(r)||jsonb_build_object('reviewer',reviewer.nama_lengkap,'current',case when root->>'document_state'='draft' then r.review_token=matching->>'review_token' else true end) into review from public.erp_bill_reviews r join public.users reviewer on reviewer.id=r.reviewed_by where document_id=p_id::uuid;
 end if;
 select count(*) into total from (select transaction_id,action,actor_id from public.erp_document_events where entity=kind and source_id=p_id::uuid group by 1,2,3) q;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id::bigint desc),'[]') into history from (
  select max(id)::text id,transaction_id::text,action,max(actor_name) actor,max(reason) reason,min(created_at) created_at,jsonb_agg(changes order by id) changes
  from public.erp_document_events where entity=kind and source_id=p_id::uuid group by transaction_id,action,actor_id order by max(id) desc limit 20 offset (p_page-1)*20
 ) q;
 if kind='order' and not public.erp_can(u.id,'sales','read') and not public.erp_can(u.id,'finance','read') then
  -- Fulfillment access must not expose payment terms, prices or billing history.
  select coalesce(jsonb_agg(event-'changes'-'reason'||jsonb_build_object('changes',coalesce((select jsonb_agg(change||jsonb_build_object('before',coalesce((select jsonb_object_agg(key,value) from jsonb_each(change->'before') where key in ('state','quantity','delivered','remaining','number','date')),'{}'::jsonb),'after',coalesce((select jsonb_object_agg(key,value) from jsonb_each(change->'after') where key in ('state','quantity','delivered','remaining','number','date')),'{}'::jsonb))) from jsonb_array_elements(event->'changes') change),'[]'::jsonb))),'[]'::jsonb) into history from jsonb_array_elements(history) event;
 end if;
 -- Historical amendments existed before this release; show their real snapshots
 -- separately instead of manufacturing event timestamps for old documents.
 result:=jsonb_build_object('id',p_id,'kind',kind,'closure_preview',preview,'closure',closure,'matching',matching,'variance_review',review,'history',history,
 'amendments',case when kind in ('order','purchase') and (public.erp_can(u.id,case when kind='order' then 'sales' else 'purchase' end,'read') or public.erp_can(u.id,'finance','read')) then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'reason',a.reason,'actor',editor.nama_lengkap,'created_at',a.created_at,'before',a.before_data->'snapshot'->'totals','after',a.after_data->'snapshot'->'totals') order by a.created_at desc) from public.erp_amendments a join public.users editor on editor.id=a.actor_id where a.source_type=kind and a.source_id=p_id::uuid),'[]') else '[]'::jsonb end);
 return jsonb_build_object('rows',jsonb_build_array(result),'total',total,'page',p_page,'page_size',20);
end $$;

do $$declare t text;begin
 foreach t in array array['erp_order_closures','erp_bill_reviews','erp_document_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on function public.erp_event_immutable(),public.erp_delivered_order_total(uuid),public.erp_close_preview(text,uuid),public.erp_bill_match(uuid),public.erp_capture_document_event(),public.erp_mutate_v15(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.erp_mutate(text,text,jsonb),public.erp_controls(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.erp_mutate(text,text,jsonb),public.erp_controls(text,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
