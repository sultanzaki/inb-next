begin;
-- Additive UX read models. Existing mutation rules remain authoritative.
create or replace function public.erp_billing_summary(p_order uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object(
  'requested',coalesce((select sum(amount) from public.erp_fin_documents where order_id=p_order and kind='payment_request' and state<>'void'),0)::text,
  'invoiced',coalesce((select sum(amount) from public.erp_fin_documents where order_id=p_order and kind='invoice' and state<>'void'),0)::text,
  'paid',coalesce((select sum(case when p.direction='refund' then -a.amount else a.amount end) from public.erp_fin_allocations a join public.erp_fin_documents d on d.id=a.document_id join public.erp_fin_payments p on p.id=a.payment_id where d.order_id=p_order and d.state='issued' and d.kind in ('invoice','payment_request','credit_note') and a.state='active' and p.state='verified' and p.direction in ('receipt','refund')),0)::text,
  'requests',coalesce((select jsonb_agg(jsonb_build_object('id',id,'number',number,'state',state,'amount',amount::text,'outstanding',public.erp_fin_outstanding(id)::text) order by created_at) from public.erp_fin_documents where order_id=p_order and kind='payment_request' and state<>'void'),'[]'::jsonb))
$$;
create or replace function public.erp_fin_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;source text;rows jsonb;total bigint;
begin
 u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'finance','read');
 if p_page<1 or p_page>1000000 or length(p_search)>100 or length(p_state)>30 then raise check_violation;end if;
 if p_entity='fin_documents' then source:=$s$select v.number||' '||coalesce(v.party,'')||' '||v.external_reference||' '||d.lines::text search,v.id::text,v.number||' · '||v.party label,v.party name,v.party,v.number,v.currency,v.amount::text amount,v.outstanding::text outstanding,v.kind,v.party_type,v.party_id,v.date,v.due_date,v.days_overdue,v.display_state state,v.state document_state,v.order_id,v.purchase_id,v.delivery_id,v.related_id,v.case_id,v.external_reference,v.match_state,v.disputed,v.version,v.notes,v.created_at,d.lines,d.snapshot,coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.erp_fin_collection_events e where document_id=d.id),'[]') events from public.erp_fin_document_view v join public.erp_fin_documents d on d.id=v.id$s$;
 elsif p_entity='fin_payments' then source:=$s$select p.number||' '||p.bank_reference||' '||p.bank_account||' '||coalesce(case when p.party_type='customer' then (select name from public.erp_customers where id=p.party_id) else (select name from public.erp_suppliers where id=p.party_id) end,'') search,p.id::text,p.number||' · '||coalesce(case when p.party_type='customer' then (select name from public.erp_customers where id=p.party_id) else (select name from public.erp_suppliers where id=p.party_id) end,'') label,p.number,p.party_type,p.party_id,p.direction,p.currency,p.amount::text amount,(p.amount-coalesce((select sum(amount) from public.erp_fin_allocations where payment_id=p.id and state='active'),0))::text available,p.state,p.version,p.date,p.bank_account,p.bank_reference,p.evidence,p.notes,p.created_at,case when p.party_type='customer' then (select name from public.erp_customers where id=p.party_id) else (select name from public.erp_suppliers where id=p.party_id) end name,coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text,'document',d.number) order by a.created_at desc) from public.erp_fin_allocations a join public.erp_fin_documents d on d.id=a.document_id where payment_id=p.id),'[]') allocations from public.erp_fin_payments p$s$;
 elsif p_entity='fin_orders' then source:=$s$select o.number||' '||coalesce(o.snapshot->'customer'->>'name','')||' '||o.customer_reference||' '||coalesce((o.snapshot->'lines')::text,'') search,o.id::text,o.number||' · '||coalesce(o.snapshot->'customer'->>'name','') label,o.number,o.state,o.snapshot->'customer'->>'name' name,q.customer_id party_id,q.currency,(o.snapshot->'totals'->>'total') amount,o.created_at,public.erp_billing_summary(o.id) billing,coalesce(to_jsonb(t),'{}') terms,public.erp_fin_dispatch_status(o.id) dispatch,coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'product',l.snapshot->>'product','quantity',l.quantity::text,'delivered',l.delivered::text,'unbilled',(l.quantity-coalesce((select sum((x->>'quantity')::numeric) from public.erp_fin_documents d cross join lateral jsonb_array_elements(d.lines) x where d.order_id=o.id and d.kind='invoice' and d.state<>'void' and x->>'line_id'=l.id::text),0))::text)) from public.erp_order_lines l where order_id=o.id),'[]') lines from public.erp_orders o join public.erp_quotes q on q.id=o.quote_id left join public.erp_fin_terms t on t.order_id=o.id$s$;
 elsif p_entity='fin_purchases' then source:=$s$select p.number||' '||s.name||' '||coalesce((select string_agg(l.snapshot::text,' ') from public.erp_purchase_lines l where l.order_id=p.id),'') search,p.id::text,p.number||' · '||s.name label,p.number,s.name,p.supplier_id party_id,p.currency,p.state,p.created_at,(select sum(quantity*price)::text from public.erp_purchase_lines where order_id=p.id) amount,coalesce((select jsonb_agg(to_jsonb(l)||l.snapshot||jsonb_build_object('quantity',l.quantity::text,'price',l.price::text,'received',l.received::text,'unbilled',(l.received-coalesce((select sum((x->>'quantity')::numeric) from public.erp_fin_documents d cross join lateral jsonb_array_elements(d.lines) x where d.purchase_id=p.id and d.kind='supplier_bill' and d.state<>'void' and x->>'line_id'=l.id::text),0))::text)) from public.erp_purchase_lines l where order_id=p.id),'[]') lines from public.erp_purchase_orders p join public.erp_suppliers s on s.id=p.supplier_id$s$;
 elsif p_entity='fin_credit_policies' then source:=$s$select c.name||' '||cp.currency search,cp.customer_id::text||':'||cp.currency id,cp.customer_id,c.name label,c.name,cp.currency,cp.credit_limit::text credit_limit,case when cp.on_hold then 'hold' else 'active' end state,cp.on_hold,cp.hold_overdue,cp.reason,cp.version from public.erp_fin_credit_policy cp join public.erp_customers c on c.id=cp.customer_id$s$;
 elsif p_entity='fin_customers' then source:=$s$select name search,id::text,name label,name,'active' state from public.erp_customers$s$;
 elsif p_entity='fin_suppliers' then source:=$s$select name search,id::text,name label,name,case when active then 'active' else 'inactive' end state from public.erp_suppliers$s$;
 elsif p_entity='fin_aging' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (select party_type,currency,case when days_overdue=0 then 'Current' when days_overdue<=30 then '1–30 days' when days_overdue<=60 then '31–60 days' when days_overdue<=90 then '61–90 days' else '90+ days' end bucket,sum(outstanding)::text amount,count(*) count from public.erp_fin_document_view where state='issued' and kind in ('invoice','supplier_bill') and outstanding>0 group by 1,2,3) q;
  return jsonb_build_object('rows',rows,'total',jsonb_array_length(rows),'page',1,'page_size',50);
 else raise check_violation;end if;
 execute 'select count(*) from ('||source||') s where ($1='''' or s.search ilike ''%''||replace(replace(replace($1,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($2='''' or s.state=$2) and ($3 is null or s.id=$3)' into total using p_search,p_state,p_id;
 execute 'select coalesce(jsonb_agg(to_jsonb(q)),''[]'') from (select * from ('||source||') s where ($1='''' or s.search ilike ''%''||replace(replace(replace($1,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($2='''' or s.state=$2) and ($3 is null or s.id=$3) order by s.id desc limit 50 offset $4) q' into rows using p_search,p_state,p_id,(p_page-1)*50;
 if p_id is null then select coalesce(jsonb_agg(r-'snapshot'-'lines'-'events'-'allocations'-'search'),'[]') into rows from jsonb_array_elements(rows) r;end if;
 return jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',50);
end $$;

-- Context is applied BEFORE pagination; every collection uses its existing module guard.
create or replace function public.erp_choices(p_token text,p_entity text,p_search text default '',p_page integer default 1,p_scope jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;source text;result jsonb;rows jsonb;total bigint;pattern text;
begin
 u:=public.erp_actor(p_token);
 if p_page<1 or p_page>1000000 or length(p_search)>100 or jsonb_typeof(p_scope)<>'object' then raise check_violation;end if;
 if p_entity in ('fin_documents','fin_payments') then
  perform public.erp_assert(u.id,'finance','read');
  if p_entity='fin_documents' then source:=$s$select v.id::text,v.number,v.number||' · '||v.party label,v.party name,v.party_id::text party_id,v.party_type,v.currency,v.amount::text amount,v.outstanding::text outstanding,v.state,v.kind,v.order_id::text order_id,v.date,v.due_date from public.erp_fin_document_view v$s$;
  else source:=$s$select p.id::text,p.number,p.number||' · '||coalesce(case when p.party_type='customer' then (select name from public.erp_customers where id=p.party_id) else (select name from public.erp_suppliers where id=p.party_id) end,'') label,p.party_id::text party_id,p.party_type,p.currency,p.amount::text amount,(p.amount-coalesce((select sum(amount) from public.erp_fin_allocations where payment_id=p.id and state='active'),0))::text available,p.state,p.direction,p.bank_reference,p.date from public.erp_fin_payments p$s$;end if;
 elsif p_entity='posted_deliveries' then
  -- Reuse the existing collection's permission checks before enriching it.
  if public.erp_can(u.id,'finance','read') and exists(select from public.erp_modules where key='finance' and state<>'disabled') then perform public.erp_assert(u.id,'finance','read'); else perform public.erp_read(p_token,p_entity,'','',1,null);end if;
  source:=$s$select m.id::text,m.number,m.number||' · '||coalesce(o.snapshot->'customer'->>'name','') label,m.order_id::text order_id,m.state,m.date,m.lines,
    coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'product',l.snapshot->>'product','quantity',l.quantity::text,'delivered',l.delivered::text,'unbilled',
      greatest(0,least(
        shipped.quantity-coalesce((select sum((z->>'quantity')::numeric) from public.erp_fin_documents d cross join lateral jsonb_array_elements(d.lines) z where d.delivery_id=m.id and d.kind='invoice' and d.state<>'void' and z->>'line_id'=l.id::text),0),
        l.quantity-coalesce((select sum((z->>'quantity')::numeric) from public.erp_fin_documents d cross join lateral jsonb_array_elements(d.lines) z where d.order_id=m.order_id and d.kind='invoice' and d.state<>'void' and z->>'line_id'=l.id::text),0)
      ))::text)) from (select (x->>'order_line_id')::uuid line_id,sum((x->>'base_quantity')::numeric) quantity from jsonb_array_elements(m.lines) x group by 1) shipped join public.erp_order_lines l on l.id=shipped.line_id),'[]') billing_lines
    from public.erp_movements m join public.erp_orders o on o.id=m.order_id where m.kind='delivery' and m.state='posted'$s$;
 else
  return public.erp_read(p_token,p_entity,p_search,coalesce(p_scope->>'state',''),p_page,null);
 end if;
 pattern:='%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%';
 source:='select * from ('||source||$q$) s where ($1='' or to_jsonb(s)::text ilike $2) and not exists(select from jsonb_each_text($3-'positive') f where coalesce(to_jsonb(s)->>f.key,'')<>f.value) and (not coalesce(($3->>'positive')::boolean,false) or coalesce((to_jsonb(s)->>'available')::numeric,(to_jsonb(s)->>'outstanding')::numeric,0)>0)$q$;
 execute 'select count(*) from ('||source||') z' into total using p_search,pattern,p_scope;
 execute 'select coalesce(jsonb_agg(to_jsonb(z)),''[]'') from ('||source||' order by s.date desc,s.id limit 50 offset $4) z' into rows using p_search,pattern,p_scope,(p_page-1)*50;
 return jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',50);
end $$;

revoke all on function public.erp_billing_summary(uuid) from public,anon,authenticated,service_role;
revoke all on function public.erp_choices(text,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.erp_choices(text,text,text,integer,jsonb) to service_role;
revoke all on function public.erp_fin_read(text,text,text,text,integer,text) from public,anon,authenticated,service_role;
create or replace function public.erp_document_flow(p_token text,p_entity text,p_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;r jsonb;o uuid;p uuid;nodes jsonb;
begin
 u:=public.erp_actor(p_token);
 if p_entity not in ('orders','fulfillment','quotes','movements','production','purchases','fin_orders','fin_purchases','fin_documents','fin_payments') then raise check_violation;end if;
 r:=public.erp_read(p_token,p_entity,'','',1,p_id)->'rows'->0;
 if r is null then raise no_data_found;end if;
 if p_entity in ('orders','fulfillment','fin_orders') then o:=p_id::uuid;
 elsif p_entity='quotes' then select id into o from public.erp_orders where quote_id=p_id::uuid;
 elsif p_entity in ('purchases','fin_purchases') then p:=p_id::uuid;
 elsif p_entity='fin_documents' then o:=(r->>'order_id')::uuid;p:=(r->>'purchase_id')::uuid;
 elsif p_entity='fin_payments' then
  -- A receipt may span orders. Show its linked documents without inventing one parent.
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'number',d.number,'entity','fin_documents','module','finance','state',d.state,'amount',d.amount::text,'currency',d.currency,'date',d.date) order by d.created_at),'[]') into nodes from (select distinct d.id,d.number,d.state,d.amount,d.currency,d.date,d.created_at from public.erp_fin_allocations a join public.erp_fin_documents d on d.id=a.document_id where a.payment_id=p_id::uuid and a.state='active') d;
  return jsonb_build_object('rows',nodes,'total',jsonb_array_length(nodes),'page',1,'page_size',50);
 else o:=(r->>'order_id')::uuid;end if;
 select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at,n.number),'[]') into nodes from (
 select q.id,q.number,'quotes'::text entity,'sales'::text module,q.state,q.currency,q.totals->>'total' amount,q.date::text date,q.created_at from public.erp_quotes q join public.erp_orders z on z.quote_id=q.id where z.id=o
 union all select z.id,z.number,'orders','sales',z.state,z.snapshot->>'currency',z.snapshot->'totals'->>'total',z.created_at::date::text,z.created_at from public.erp_orders z where z.id=o
 union all select m.id,m.number,'movements','warehouse',m.state,null,null,m.date::text,m.created_at from public.erp_movements m where m.order_id=o and m.kind='delivery'
 union all select z.id,z.number,'purchases','purchase',z.state,z.currency,(select coalesce(sum(l.quantity*l.price),0)::text from public.erp_purchase_lines l where l.order_id=z.id),z.date::text,z.created_at from public.erp_purchase_orders z where z.id=p
 union all select d.id,d.number,'fin_documents','finance',d.state,d.currency,d.amount::text,d.date::text,d.created_at from public.erp_fin_documents d where d.order_id=o or d.purchase_id=p
 union all select pay.id,pay.number,'fin_payments','finance',pay.state,pay.currency,pay.amount::text,pay.date::text,pay.created_at from public.erp_fin_payments pay where exists(select from public.erp_fin_allocations a join public.erp_fin_documents d on d.id=a.document_id where a.payment_id=pay.id and a.state='active' and (d.order_id=o or d.purchase_id=p))
 ) n where public.erp_can(u.id,n.module,'read') and exists(select from public.erp_modules where key=n.module and state<>'disabled');
 return jsonb_build_object('rows',nodes,'total',jsonb_array_length(nodes),'page',1,'page_size',50);
end $$;
revoke all on function public.erp_document_flow(text,text,text) from public,anon,authenticated;
grant execute on function public.erp_document_flow(text,text,text) to service_role;

create or replace function public.erp_batch_preview(p_token text,p_product uuid,p_date date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;s text;n integer;item jsonb;
begin
 u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'production','read');
 select series into s from public.erp_product_series where product_id=p_product;
 if s is null then raise exception using errcode='P0001',message='Configure a unique product series in Master data before posting production.';end if;
 select coalesce((select batch from public.erp_batch_counters where product_id=p_product and year=extract(year from p_date)::integer),0)+1 into n;
 item:=jsonb_build_object('id',p_product,'series',s,'number',s||'.'||lpad(n::text,greatest(2,length(n::text)),'0')||'.'||to_char(p_date,'DDMMYYYY')||'.'||to_char(p_date+interval '1 year','YYYY'),'expiry_date',(p_date+interval '1 year')::date);
 return jsonb_build_object('rows',jsonb_build_array(item),'total',1,'page',1,'page_size',50);
end $$;
revoke all on function public.erp_batch_preview(text,uuid,date) from public,anon,authenticated;
grant execute on function public.erp_batch_preview(text,uuid,date) to service_role;

create or replace function public.erp_delivery_readiness(p_token text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;m public.erp_movements;f jsonb;checks jsonb;stock_ok boolean;release_ok boolean;expiry_ok boolean;coa_ok boolean;
begin
 u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'warehouse','read');
 select * into m from public.erp_movements where id=p_id and kind='delivery';if not found then raise no_data_found;end if;
 f:=public.erp_fin_dispatch_status(m.order_id);
 select not exists(select from (select (x->>'lot_id')::uuid lot_id,sum((x->>'base_quantity')::numeric) quantity from jsonb_array_elements(m.lines) x group by 1) need left join public.erp_balances b on b.lot_id=need.lot_id and b.location_id=m.from_location where coalesce(b.quantity,0)<need.quantity) into stock_ok;
 select not exists(select from jsonb_array_elements(m.lines) x join public.erp_lots l on l.id=(x->>'lot_id')::uuid where l.qc_status<>'released'),not exists(select from jsonb_array_elements(m.lines) x join public.erp_lots l on l.id=(x->>'lot_id')::uuid where l.expiry_date<public.erp_today()) into release_ok,expiry_ok;
 coa_ok:=not exists(select from public.erp_modules where key='quality' and state<>'disabled') or not exists(select from jsonb_array_elements(m.lines) x join public.erp_lots l on l.id=(x->>'lot_id')::uuid where not exists(select from public.coa c where c.id_hasil_uji=l.inspection_id and not c.withdrawn));
 checks:=jsonb_build_array(jsonb_build_object('id','stock','label','Stock available at source','ready',stock_ok),jsonb_build_object('id','release','label','Lots released','ready',release_ok),jsonb_build_object('id','expiry','label','Lots within expiry','ready',expiry_ok),jsonb_build_object('id','certificate','label','Current Quality certificates','ready',coa_ok),jsonb_build_object('id','finance','label','Payment and credit requirements','ready',(f->>'cleared')::boolean,'reason',f->>'reason'));
 return jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',m.id,'ready',stock_ok and release_ok and expiry_ok and coa_ok and (f->>'cleared')::boolean,'checks',checks,'finance',f)),'total',1,'page',1,'page_size',50);
end $$;
revoke all on function public.erp_delivery_readiness(text,uuid) from public,anon,authenticated;
grant execute on function public.erp_delivery_readiness(text,uuid) to service_role;

notify pgrst,'reload schema';
commit;
