begin;
-- Reuse the existing authorized read sources, with predicate/order pushdown before LIMIT.
create or replace function public.erp_table_match(body jsonb, query jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public as $$
declare f jsonb; v text; expected text; cmp integer;
begin
 for f in select value from jsonb_array_elements(coalesce(query->'filters','[]')) loop
  v:=body #>> string_to_array(f->>'field','.'); expected:=f->>'value';
  if f->>'op'='empty' then if v is not null then return false; end if; continue; end if;
  if f->>'op'='not_empty' then if v is null then return false; end if; continue; end if;
  if v is null then return false; end if;
  if f->>'type'='date' then v:=case when position('T' in v)>0 then (v::timestamptz at time zone 'Asia/Jakarta')::date::text else left(v,10) end; end if;
  if f->>'type'='number' then
   if v !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
   cmp:=case when v::numeric<expected::numeric then -1 when v::numeric>expected::numeric then 1 else 0 end;
  else cmp:=case when v<expected then -1 when v>expected then 1 else 0 end; end if;
  if not (case f->>'op' when 'contains' then position(lower(expected) in lower(v))>0 when 'starts' then starts_with(lower(v),lower(expected)) when 'in' then exists(select from unnest(string_to_array(expected,',')) item where btrim(item)=v) when 'eq' then cmp=0 when 'neq' then cmp<>0 when 'gt' then cmp>0 when 'gte' then cmp>=0 when 'lt' then cmp<0 when 'lte' then cmp<=0 else false end) then return false; end if;
 end loop; return true;
end $$;
create or replace function public.erp_table_source(source text,p_entity text,p_search text,p_state text,p_page integer,p_id text, alias_name text default 'x') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare query jsonb:=current_setting('app.table_query',true)::jsonb; predicate text; ordering text:=''; s jsonb; expression text; total bigint; rows jsonb; source_sql text; summary jsonb; summaries text[];
begin
 -- source is executable SQL supplied only by private read functions, never by the client.
 source_sql:=case when alias_name='body' then source else 'select to_jsonb(t) body from ('||source||') t' end;
 predicate:='public.erp_table_match(body,$1) and ($2='''' or coalesce(body->>''search'',body->>''label'',body->>''number'',body->>''name'','''') ilike ''%''||replace(replace(replace($2,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($3='''' or coalesce(body->>''display_state'',body->>''state'',body->>''status'')=$3 or ($3=''overdue'' and body->>''due_date''<public.erp_today()::text and body->>''state'' not in (''closed'',''resolved'',''rejected''))) and ($4 is null or body->>''id''=$4)';
 for s in select value from jsonb_array_elements(coalesce(query->'sorts','[]')) loop
  if s->>'field' !~ '^[a-z_]+(\.[a-z_]+)*$' or s->>'direction' not in ('asc','desc') then raise check_violation; end if;
  expression:=format('(body #>> %L::text[])',string_to_array(s->>'field','.')::text);
  if s->>'type'='number' then expression:='case when '||expression||' ~ ''^-?[0-9]+(\.[0-9]+)?$'' then '||expression||'::numeric end'; else expression:='lower('||expression||')'; end if;
  ordering:=ordering||expression||' '||(s->>'direction')||' nulls last,';
 end loop;
 ordering:=ordering||'coalesce(body->>''sort'',body->>''created_at'',body->>''id'') '||case when p_entity in ('stock','catalog','units','locations','customers','access','suppliers','materials','material_stock','crm_activities') then 'asc' else 'desc' end||',body->>''id'' asc';
 execute 'select count(*) from ('||source_sql||') records where '||predicate into total using query,p_search,p_state,p_id;
 execute 'select coalesce(jsonb_agg(body-''search''-''sort''),''[]'') from (select body from ('||source_sql||') records where '||predicate||' order by '||ordering||' limit 50 offset $5) page' into rows using query,p_search,p_state,p_id,(p_page-1)*50;
 select coalesce(array_agg(value),'{}') into summaries from jsonb_array_elements_text(coalesce(query->'summary','[]'));
 if cardinality(summaries)>12 then raise check_violation; end if;
 execute 'select coalesce(jsonb_agg(to_jsonb(t)),''[]'') from (select field,coalesce(body->>''currency'',body->>''unit'') unit,sum((body #>> string_to_array(field,''.''))::numeric)::text total from ('||source_sql||') records cross join unnest($5::text[]) field where '||predicate||' and (body #>> string_to_array(field,''.'')) ~ ''^-?[0-9]+(\.[0-9]+)?$'' and coalesce(body->>''currency'',body->>''unit'','''')<>'''' group by field,coalesce(body->>''currency'',body->>''unit'') order by field,unit) t' into summary using query,p_search,p_state,p_id,summaries;
 return jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',50,'summary',summary);
end $$;
-- Insert the advanced path after the original access checks and source shaping.
-- Fail closed on unexpected deployed definitions; this migration is transactional/idempotent.
do $$declare f regprocedure; definition text; marker text; patched integer:=0;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('erp_read_v5','erp_fin_read') loop
  definition:=pg_get_functiondef(f);
  if position('public.erp_table_source(source,' in definition)>0 then continue; end if;
  marker:=' execute ''select count(*) from (''||source||'')';
  if position(marker in definition)=0 then raise exception 'Unexpected read definition: %',f; end if;
  definition:=replace(definition,marker,E' if p_id is null and nullif(current_setting(''app.table_query'',true),'''') is not null then return public.erp_table_source(source,p_entity,p_search,p_state,p_page,p_id); end if;\n'||marker);
  execute definition; patched:=patched+1;
 end loop;
 if to_regprocedure('public.qc_coa_lot_dates(uuid)') is null then raise exception 'Migration 017 requires migration 016_coa_production_dates.sql.'; end if;
 if to_regprocedure('public.erp_read_v5(text,text,text,text,integer,text)') is null then raise exception 'Apply migrations 001–016 first.'; end if;
end $$;
create or replace function public.erp_table_read(p_token text,p_entity text,p_query jsonb default '{}',p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; result jsonb; scope text; source text;
begin
 u:=public.erp_actor(p_token);
 if p_page<1 or p_page>1000000 or length(p_search)>100 or length(p_state)>30 or length(p_query::text)>8000 or jsonb_typeof(p_query)<>'object' or jsonb_array_length(coalesce(p_query->'filters','[]'))>12 or jsonb_array_length(coalesce(p_query->'sorts','[]'))>4 then raise check_violation; end if;
 perform set_config('app.table_query',p_query::text,true);
 if p_id is not null and not (p_entity='product_documents' and left(p_id,8)='product:') then result:=public.erp_read(p_token,p_entity,p_search,p_state,p_page,p_id);
 elsif p_entity in ('suppliers','materials','purchases','material_stock','material_ledger','opportunities','crm_activities','product_documents') then
  scope:=case when p_entity in ('suppliers','materials','purchases') then 'purchase' when p_entity in ('material_stock','material_ledger') then 'warehouse' when p_entity in ('opportunities','crm_activities') then 'crm' else 'documents' end;
  perform public.erp_assert(u.id,scope,'read');
  source:=format('select (r.body %s)||jsonb_build_object(''search'',r.search,''sort'',r.sort) body from public.erp_growth_records r where r.entity=%L',case when p_entity='opportunities' and not (public.erp_can(u.id,'sales','read') and exists(select from public.erp_modules where key='sales' and state<>'disabled')) then ' - ''quotes''' else '' end,p_entity);
  if p_id is not null then source:=source||format(' and r.body->>''product_id''=%L',substr(p_id,9)); end if;
  result:=public.erp_table_source(source,p_entity,p_search,p_state,p_page,null,'body');
 elsif p_entity='fin_aging' then
  perform public.erp_assert(u.id,'finance','read');
  source:=$s$select party_type||':'||currency||':'||case when days_overdue=0 then 'Current' when days_overdue<=30 then '1–30 days' when days_overdue<=60 then '31–60 days' when days_overdue<=90 then '61–90 days' else '90+ days' end id,party_type,currency,case when days_overdue=0 then 'Current' when days_overdue<=30 then '1–30 days' when days_overdue<=60 then '31–60 days' when days_overdue<=90 then '61–90 days' else '90+ days' end bucket,sum(outstanding)::text amount,count(*) count from public.erp_fin_document_view where state='issued' and kind in ('invoice','supplier_bill') and outstanding>0 group by 1,2,3,4$s$;
  result:=public.erp_table_source(source,p_entity,p_search,p_state,p_page,null);
 elsif p_entity='ops_receipts' then
  perform public.erp_assert(u.id,'service','read'); perform public.erp_assert(u.id,'warehouse','read');
  source:=$s$select r.*,r.delivery_id id,m.number,m.number label,r.created_at::text sort from public.erp_delivery_receipts r join public.erp_movements m on m.id=r.delivery_id$s$;
  result:=public.erp_table_source(source,p_entity,p_search,p_state,p_page,null);
 elsif p_entity='ops_cases' then
  perform public.erp_assert(u.id,'service','read');
  source:=$s$select c.id,c.number,c.title,c.kind,c.state,c.due_date,c.estimated_cost::text,c.actual_cost::text,c.created_at,a.nama_lengkap assignee,coalesce(c.source_snapshot->>'number',c.source_snapshot->>'nama_produk',c.source_snapshot->>'title') source_number,c.number||' '||c.title search,c.created_at::text sort from public.erp_cases c left join public.users a on a.id=c.assigned_to$s$;
  result:=public.erp_table_source(source,p_entity,p_search,p_state,p_page,null);
 else result:=public.erp_read(p_token,p_entity,p_search,p_state,p_page,p_id); end if;
 if p_entity='material_stock' then
  select jsonb_set(result,'{rows}',coalesce((select jsonb_agg(r||jsonb_build_object('held',coalesce((select held from public.erp_material_lots where id=(r->>'lot_id')::uuid),false))) from jsonb_array_elements(result->'rows') r),'[]')) into result;
 end if;
 perform set_config('app.table_query','',true); return result;
end $$;
revoke all on function public.erp_table_match(jsonb,jsonb),public.erp_table_source(text,text,text,text,integer,text,text),public.erp_table_read(text,text,jsonb,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.erp_table_read(text,text,jsonb,text,text,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
