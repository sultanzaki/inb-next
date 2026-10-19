begin;
-- Fail before replacing wrappers or revoking permissions when an earlier release is missing.
do $$begin
 if to_regprocedure('public.erp_quote_order(text,uuid)') is null then
  raise exception using errcode='P0001',
   message='Migration 012 requires migration 009_quotation_order_link.sql.',
   detail='The required function public.erp_quote_order(text, uuid) is missing.',
   hint='Apply migration 009, rerun migration 012, then apply migration 013. Do not reapply older wrapper migrations in isolation.';
 end if;
end $$;
create or replace view public.erp_fin_document_view as
select d.id,d.kind,d.party_type,d.party_id,d.number,d.currency,d.amount,public.erp_fin_outstanding(d.id) outstanding,
 d.date,d.due_date,d.state,d.order_id,d.purchase_id,d.delivery_id,d.case_id,d.related_id,d.external_reference,d.match_state,d.disputed,d.version,d.created_at,d.notes,
 case when d.party_type='customer' then (select name from public.erp_customers where id=d.party_id) else (select name from public.erp_suppliers where id=d.party_id) end party,
 case when d.state<>'issued' then d.state when public.erp_fin_outstanding(d.id)=0 then 'paid' when d.kind in ('credit_note','supplier_credit') then 'available' when d.due_date<public.erp_today() then 'overdue' when public.erp_fin_outstanding(d.id)<d.amount then 'partially_paid' else 'unpaid' end display_state,
 greatest(0,public.erp_today()-d.due_date) days_overdue
from public.erp_fin_documents d;
create or replace function public.erp_fin_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;source text;rows jsonb;total bigint;
begin
 u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'finance','read');
 if p_page<1 or p_page>1000000 or length(p_search)>100 or length(p_state)>30 then raise check_violation;end if;
 if p_entity='fin_documents' then source:=$s$select v.id::text,v.number||' · '||v.party label,v.party name,v.party,v.number,v.currency,v.amount::text amount,v.outstanding::text outstanding,v.kind,v.party_type,v.party_id,v.date,v.due_date,v.days_overdue,v.display_state state,v.state document_state,v.order_id,v.purchase_id,v.delivery_id,v.related_id,v.case_id,v.external_reference,v.match_state,v.disputed,v.version,v.notes,v.created_at,d.lines,d.snapshot,coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.erp_fin_collection_events e where document_id=d.id),'[]') events from public.erp_fin_document_view v join public.erp_fin_documents d on d.id=v.id$s$;
 elsif p_entity='fin_payments' then source:=$s$select p.id::text,p.number label,p.number,p.party_type,p.party_id,p.direction,p.currency,p.amount::text amount,(p.amount-coalesce((select sum(amount) from public.erp_fin_allocations where payment_id=p.id and state='active'),0))::text available,p.state,p.version,p.date,p.bank_account,p.bank_reference,p.evidence,p.notes,p.created_at,case when p.party_type='customer' then (select name from public.erp_customers where id=p.party_id) else (select name from public.erp_suppliers where id=p.party_id) end name,coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text,'document',d.number) order by a.created_at desc) from public.erp_fin_allocations a join public.erp_fin_documents d on d.id=a.document_id where payment_id=p.id),'[]') allocations from public.erp_fin_payments p$s$;
 elsif p_entity='fin_orders' then source:=$s$select o.id::text,o.number label,o.number,o.state,o.snapshot->'customer'->>'name' name,q.customer_id party_id,q.currency,(o.snapshot->'totals'->>'total') amount,o.created_at,coalesce(to_jsonb(t),'{}') terms,public.erp_fin_dispatch_status(o.id) dispatch,coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'product',l.snapshot->>'product','quantity',l.quantity::text,'delivered',l.delivered::text,'unbilled',(l.quantity-coalesce((select sum((x->>'quantity')::numeric) from public.erp_fin_documents d cross join lateral jsonb_array_elements(d.lines) x where d.order_id=o.id and d.kind='invoice' and d.state<>'void' and x->>'line_id'=l.id::text),0))::text)) from public.erp_order_lines l where order_id=o.id),'[]') lines from public.erp_orders o join public.erp_quotes q on q.id=o.quote_id left join public.erp_fin_terms t on t.order_id=o.id$s$;
 elsif p_entity='fin_purchases' then source:=$s$select p.id::text,p.number label,p.number,s.name,p.supplier_id party_id,p.currency,p.state,p.created_at,(select sum(quantity*price)::text from public.erp_purchase_lines where order_id=p.id) amount,coalesce((select jsonb_agg(to_jsonb(l)||l.snapshot||jsonb_build_object('quantity',l.quantity::text,'price',l.price::text,'received',l.received::text,'unbilled',(l.received-coalesce((select sum((x->>'quantity')::numeric) from public.erp_fin_documents d cross join lateral jsonb_array_elements(d.lines) x where d.purchase_id=p.id and d.kind='supplier_bill' and d.state<>'void' and x->>'line_id'=l.id::text),0))::text)) from public.erp_purchase_lines l where order_id=p.id),'[]') lines from public.erp_purchase_orders p join public.erp_suppliers s on s.id=p.supplier_id$s$;
 elsif p_entity='fin_credit_policies' then source:=$s$select cp.customer_id::text||':'||cp.currency id,cp.customer_id,c.name label,c.name,cp.currency,cp.credit_limit::text credit_limit,case when cp.on_hold then 'hold' else 'active' end state,cp.on_hold,cp.hold_overdue,cp.reason,cp.version from public.erp_fin_credit_policy cp join public.erp_customers c on c.id=cp.customer_id$s$;
 elsif p_entity='fin_customers' then source:=$s$select id::text,name label,name,'active' state from public.erp_customers$s$;
 elsif p_entity='fin_suppliers' then source:=$s$select id::text,name label,name,case when active then 'active' else 'inactive' end state from public.erp_suppliers$s$;
 elsif p_entity='fin_aging' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (select party_type,currency,case when days_overdue=0 then 'Current' when days_overdue<=30 then '1–30 days' when days_overdue<=60 then '31–60 days' when days_overdue<=90 then '61–90 days' else '90+ days' end bucket,sum(outstanding)::text amount,count(*) count from public.erp_fin_document_view where state='issued' and kind in ('invoice','supplier_bill') and outstanding>0 group by 1,2,3) q;
  return jsonb_build_object('rows',rows,'total',jsonb_array_length(rows),'page',1,'page_size',50);
 else raise check_violation;end if;
 execute 'select count(*) from ('||source||') s where ($1='''' or (to_jsonb(s)->>''label'') ilike ''%''||replace(replace(replace($1,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($2='''' or s.state=$2) and ($3 is null or s.id=$3)' into total using p_search,p_state,p_id;
 execute 'select coalesce(jsonb_agg(to_jsonb(q)),''[]'') from (select * from ('||source||') s where ($1='''' or (to_jsonb(s)->>''label'') ilike ''%''||replace(replace(replace($1,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($2='''' or s.state=$2) and ($3 is null or s.id=$3) order by s.id desc limit 50 offset $4) q' into rows using p_search,p_state,p_id,(p_page-1)*50;
 if p_id is null then select coalesce(jsonb_agg(r-'snapshot'-'lines'-'events'-'allocations'),'[]') into rows from jsonb_array_elements(rows) r;end if;
 return jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',50);
end $$;
-- Rename once: private previous roots retain all existing validation/workflow boundaries.
do $$begin
 if to_regprocedure('public.erp_mutate_v12(text,text,jsonb)') is null then alter function public.erp_mutate(text,text,jsonb) rename to erp_mutate_v12;end if;
 if to_regprocedure('public.erp_read_v12(text,text,text,text,integer,text)') is null then alter function public.erp_read(text,text,text,text,integer,text) rename to erp_read_v12;end if;
 if to_regprocedure('public.qc_mutate_v12(text,text,jsonb)') is null then alter function public.qc_mutate(text,text,jsonb) rename to qc_mutate_v12;end if;
end $$;
create or replace function public.erp_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;result jsonb;req public.erp_requests;m public.erp_movements;guard jsonb;why text;source jsonb;
begin
 perform pg_advisory_xact_lock(49281041);u:=public.erp_actor(p_token);
 if p_payload ? 'request_key' and (p_action like any(array['ops_%','fin_%']) or p_action in ('receive_purchase','issue_material')) then
  select * into req from public.erp_requests where request_key=(p_payload->>'request_key')::uuid;
  if found then
   if req.actor_id<>u.id or req.action<>p_action or req.payload_hash<>md5(p_payload::text) then raise exception using errcode='P0001',message='This request identifier was already used for a different operation.';end if;return req.result;
  end if;
 end if;
 if p_action like 'ops_%' then result:=public.erp_ops_mutate(p_token,p_action,p_payload);
 elsif p_action like 'fin_%' then result:=public.erp_fin_mutate(p_token,p_action,p_payload);
 else
  -- Authorize before reading business state, including guards added around legacy actions.
  if p_action='set_module' and u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege;end if;
  if p_action in ('post_move','reverse_move') then
   select * into m from public.erp_movements where id=nullif(p_payload->>'id','')::uuid;
   perform public.erp_assert(u.id,case when m.kind='production' then 'production' else 'warehouse' end,case when p_action='reverse_move' then 'approve' else 'write' end);
  elsif p_action='receive_purchase' then perform public.erp_assert(u.id,'warehouse','write');perform public.erp_assert(u.id,'purchase','read');
  elsif p_action='issue_material' then perform public.erp_assert(u.id,'warehouse','write');
  elsif p_action='reverse_material_transaction' then perform public.erp_assert(u.id,'warehouse','approve');end if;
  if p_action in ('reverse_move','reverse_material_transaction') and exists(select from public.erp_case_executions where movement_id=nullif(p_payload->>'id','')::uuid or material_transaction_id=nullif(p_payload->>'id','')::uuid) and not exists(select from public.erp_modules where key='service' and state='active') then raise exception using errcode='P0001',message='Activate Service before correcting stock linked to a claim.';end if;
  if p_action='set_module' and p_payload->>'module'='finance' and p_payload->>'state'='disabled' and (exists(select from public.erp_fin_documents where state<>'void') or exists(select from public.erp_fin_payments where state<>'void')) then raise exception using errcode='P0001',message='Finance has transaction history. Use read-only to retain payment controls and visibility.';end if;
  if p_action='set_module' and p_payload->>'module'='service' and p_payload->>'state'='disabled' and exists(select from public.erp_cases where state not in ('closed','rejected','resolved')) then raise exception using errcode='P0001',message='Resolve open cases or use read-only.';end if;
  if p_action in ('post_move','reverse_move') then
   select * into m from public.erp_movements where id=(p_payload->>'id')::uuid;
   if exists(select from public.erp_modules where key='service' and state<>'disabled') then
    perform public.erp_check_date(m.date);
    if p_action='reverse_move' and exists(select from public.erp_delivery_receipts where delivery_id=m.id) then raise exception using errcode='P0001',message='This delivery has customer receipt history. Use a claim/return instead of reversing it.';end if;
   end if;
   if p_action='post_move' and m.kind='delivery' and m.state='draft' then
    guard:=public.erp_fin_dispatch_status(m.order_id);
    if not (guard->>'cleared')::boolean then raise exception using errcode='P0001',message=guard->>'reason';end if;
    if exists(select from jsonb_array_elements(m.lines) x join public.erp_lots l on l.id=(x->>'lot_id')::uuid join public.erp_coa_withdrawals w on w.coa_id=(select id from public.coa where id_hasil_uji=l.inspection_id)) then raise exception using errcode='P0001',message='A certificate for this shipment has been withdrawn.';end if;
   end if;
   if p_action='reverse_move' and exists(select from public.erp_fin_documents where delivery_id=m.id and state='issued') then raise exception using errcode='P0001',message='Issued billing exists. Resolve the claim/credit before correcting this delivery.';end if;
  end if;
  if p_action='issue_material' and exists(select from public.erp_material_lots where id=(p_payload->>'lot_id')::uuid and (held or expiry_date<public.erp_today())) then raise exception using errcode='P0001',message='Held or expired raw material cannot be issued. Use an approved supplier return for returned goods.';end if;
  if p_action in ('receive_purchase','issue_material') and exists(select from public.erp_modules where key='service' and state<>'disabled') then perform public.erp_check_date((p_payload->>'date')::date);end if;
  if p_action='reverse_material_transaction' and exists(select from public.erp_material_transactions t join public.erp_fin_documents d on d.purchase_id=t.order_id where t.id=(p_payload->>'id')::uuid and d.kind='supplier_bill' and d.state='issued') then raise exception using errcode='P0001',message='An issued supplier bill uses this receipt. Resolve the supplier claim/credit first.';end if;
  if exists(select from public.erp_operating_policy where dual_approval) and p_action in ('issue_quote','confirm_purchase','approve_count','post_move') then
   if p_action='issue_quote' then select created_by into why from public.erp_quotes where id=(p_payload->>'id')::uuid;
   elsif p_action='confirm_purchase' then select created_by into why from public.erp_purchase_orders where id=(p_payload->>'id')::uuid;
   elsif p_action='approve_count' then select assigned_to into why from public.erp_counts where id=(p_payload->>'id')::uuid;
   else select created_by into why from public.erp_movements where id=(p_payload->>'id')::uuid;end if;
   perform public.erp_approval(u.id,why::uuid,coalesce(p_payload->>'reason','Second approver verified'));
  end if;
  result:=public.erp_mutate_v12(p_token,p_action,p_payload);
  if p_action in ('reverse_move','reverse_material_transaction') then
   for source in select distinct jsonb_build_object('id',case_id) from public.erp_case_executions where movement_id=nullif(p_payload->>'id','')::uuid or material_transaction_id=nullif(p_payload->>'id','')::uuid loop
    update public.erp_cases set state='under_review',completion_evidence=null,version=version+1,updated_at=now() where id=(source->>'id')::uuid;
    insert into public.erp_case_events(case_id,actor_id,event,notes) values((source->>'id')::uuid,u.id,'stock_resolution_reversed',p_payload->>'reason');
   end loop;
  end if;
  if p_action='receive_purchase' and (p_payload->>'hold')::boolean then
   update public.erp_material_lots set held=true,hold_reason=coalesce(p_payload->>'reason','Receipt pending inspection') where id in(select lot_id from public.erp_material_ledger where transaction_id in (select id from public.erp_material_transactions where request_key=(p_payload->>'request_key')::uuid));
  end if;
 end if;
 if p_payload ? 'request_key' and (p_action like any(array['ops_%','fin_%']) or p_action in ('receive_purchase','issue_material')) then insert into public.erp_requests(request_key,actor_id,action,payload_hash,result) values((p_payload->>'request_key')::uuid,u.id,p_action,md5(p_payload::text),result);end if;
 return result;
end $$;
create or replace function public.erp_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;result jsonb;row jsonb;rows jsonb;scope text;series jsonb;metrics jsonb;days integer;areas jsonb;
begin
 if p_entity like 'fin_%' then return public.erp_fin_read(p_token,p_entity,p_search,p_state,p_page,p_id);end if;
 if p_entity like 'ops_%' and p_entity not in ('ops_metrics') then return public.erp_ops_read(p_token,p_entity,p_search,p_state,p_page,p_id);end if;
 if p_entity='certificate_status' then
  u:=public.erp_actor(p_token);
  if not exists(select from public.erp_modules where state<>'disabled' and key in ('warehouse','quality') and public.erp_can(u.id,key,'read')) then raise insufficient_privilege;end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('withdrawn',exists(select from public.erp_coa_withdrawals where coa_id=c.id))) from public.coa c where c.id::text=p_id),'[]'),'total',1,'page',1,'page_size',50);
 end if;
 if p_entity='dispatch_status' then
  u:=public.erp_actor(p_token);
  if not exists(select from public.erp_modules where state<>'disabled' and key in ('sales','warehouse','finance') and public.erp_can(u.id,key,'read')) then raise insufficient_privilege;end if;
  return jsonb_build_object('rows',jsonb_build_array(public.erp_fin_dispatch_status(p_id::uuid)),'total',1,'page',1,'page_size',50);
 end if;
 if p_entity='ops_metrics' or (p_entity='overview' and p_state in ('finance','service')) then
  u:=public.erp_actor(p_token);scope:=case when p_entity='ops_metrics' then 'service' else p_state end;perform public.erp_assert(u.id,scope,'read');days:=case when p_search in ('7','30','90') then p_search::integer else 30 end;
  select coalesce(jsonb_agg(key),'[]') into areas from public.erp_modules where state<>'disabled' and public.erp_can(u.id,key,'read');
  if scope='service' then
   select jsonb_build_array(jsonb_build_object('label','Open cases','value',count(*) filter(where state not in ('closed','resolved','rejected'))),jsonb_build_object('label','Overdue cases','value',count(*) filter(where due_date<public.erp_today() and state not in ('closed','resolved','rejected'))),jsonb_build_object('label','Awaiting approval','value',count(*) filter(where state='awaiting_approval'))) into metrics from public.erp_cases;
   select coalesce(jsonb_agg(jsonb_build_object('date',d::date,'count',(select count(*) from public.erp_cases where created_at::date=d::date)) order by d),'[]') into series from generate_series(public.erp_today()-days+1,public.erp_today(),interval '1 day') d;
  else
   select jsonb_build_array(jsonb_build_object('label','Overdue invoices/bills','value',count(*) filter(where display_state='overdue')),jsonb_build_object('label','Draft documents','value',count(*) filter(where state='draft')),jsonb_build_object('label','Disputed documents','value',count(*) filter(where disputed))) into metrics from public.erp_fin_document_view;
   select coalesce(jsonb_agg(jsonb_build_object('date',d::date,'count',(select count(*) from public.erp_fin_documents where date=d::date and state='issued')) order by d),'[]') into series from generate_series(public.erp_today()-days+1,public.erp_today(),interval '1 day') d;
  end if;
  return jsonb_build_object('areas',areas,'metrics',metrics,'series',series,'activity','[]'::jsonb,'chart_label',case when scope='service' then 'Cases opened' else 'Documents issued' end,'days',days);
 end if;
 result:=public.erp_read_v12(p_token,p_entity,p_search,p_state,p_page,p_id);
 if p_entity='material_stock' then
  select coalesce(jsonb_agg(r||jsonb_build_object('held',coalesce((select held from public.erp_material_lots where id=(r->>'lot_id')::uuid),false))),'[]') into rows from jsonb_array_elements(result->'rows') r;result:=jsonb_set(result,'{rows}',rows);
 end if;
 return result;
end $$;
-- Retests retain all previous results/COAs. The selected current inspection is updated by the existing QC trigger.
create or replace function public.qc_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;u public.users;
begin
 perform pg_advisory_xact_lock(49281041);u:=public.erp_actor(p_token);
 if not public.erp_qc_can(u.id,p_action) then raise insufficient_privilege;end if;
 if p_action='issue_coa' and exists(select from public.hasil_uji h where h.id=(p_payload->>'id_hasil')::uuid and h.superseded) then raise exception using errcode='P0001',message='Use the current inspection after the approved retest.';end if;
 if p_action='update_coa' and exists(select from public.coa c where c.id=(p_payload->>'id')::uuid and c.withdrawn) then raise exception using errcode='P0001',message='Withdrawn certificate history cannot be edited.';end if;
 result:=public.qc_mutate_v12(p_token,p_action,p_payload);
 if p_action='create_uji' then
  update public.erp_retests set new_inspection=(result->>'id')::uuid where new_inspection is null and lot_id in(select id from public.erp_lots where product_id=(p_payload->>'id_produk')::uuid and number=p_payload->>'no_lot');
 end if;return result;
end $$;
-- Expand existing permission-filtered inbox with new work. No external messages are sent.
do $$declare source text;begin
 source:=rtrim(pg_get_viewdef('public.erp_inbox'::regclass,true),E';\n ');
 if position('erp_fin_documents' in source)=0 then
 execute 'create or replace view public.erp_inbox as '||source||$v$
 union all select 'case:'||c.id,'service',case when c.state='awaiting_approval' then 'Approve case' else 'Resolve case' end,c.number||' · '||c.title,'/dashboard/service?q='||c.number,c.created_at from public.erp_cases c where c.state not in ('closed','resolved','rejected')
 union all select 'fin:'||d.id,'finance',case when d.state='draft' then 'Review billing draft' else 'Follow up overdue payment' end,d.number,'/dashboard/finance?view=documents&q='||d.number,d.created_at from public.erp_fin_documents d where d.state='draft' or (d.state='issued' and d.kind in ('invoice','supplier_bill') and d.due_date<public.erp_today() and public.erp_fin_outstanding(d.id)>0)
 union all select 'fin-pay:'||p.id,'finance','Verify payment',p.number,'/dashboard/finance?view=payments&q='||p.number,p.created_at from public.erp_fin_payments p where p.state='draft'
 union all select 'fin-promise:'||e.id,'finance','Review broken payment promise',d.number,'/dashboard/finance?view=documents&q='||d.number,e.created_at from public.erp_fin_collection_events e join public.erp_fin_documents d on d.id=e.document_id where e.kind='promise' and e.promised_date<public.erp_today() and d.state='issued' and public.erp_fin_outstanding(d.id)>0 and coalesce(e.outstanding_at_recording,d.amount)-public.erp_fin_outstanding(d.id)<e.promised_amount and not exists(select from public.erp_fin_collection_events newer where newer.document_id=e.document_id and newer.kind='promise' and newer.created_at>e.created_at)
 union all select 'fin-order:'||o.id,'finance','Review dispatch clearance',o.number,'/dashboard/finance?view=orders&q='||o.number,o.created_at from public.erp_orders o where o.state='confirmed' and not exists(select from public.erp_fin_terms where order_id=o.id and state='approved')$v$;
 end if;
end $$;
revoke all on public.erp_fin_document_view from public,anon,authenticated,service_role;
-- Historical roots/helpers remain inaccessible even to service_role.
do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'erp_%' or p.proname='qc_mutate' or p.proname='qc_mutate_v12') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f);end loop;
end $$;
grant execute on function public.erp_read(text,text,text,text,integer,text),public.erp_mutate(text,text,jsonb),public.erp_module_guard(text,text,text),public.erp_permissions(text),public.erp_quote_order(text,uuid),public.qc_mutate(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
