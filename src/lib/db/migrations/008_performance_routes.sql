begin;
-- Apply after 007. No operational rows or account credentials are rewritten.
-- Request-local application caching uses this one authenticated session read.
create or replace function public.qc_session_user(p_token text) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',u.id,'username',u.username,'role',u.role,'nama_lengkap',u.nama_lengkap,'is_active',u.is_active,'must_change_password',u.must_change_password,'effective_actions',
 case when u.must_change_password then '[]'::jsonb else (select coalesce(jsonb_agg(a),'[]'::jsonb) from unnest(array['manage_users','read_audit','delete_produk','delete_uji','delete_coa','delete_doc','create_doc','create_produk','update_produk','create_uji','update_uji','issue_coa','update_coa','save_draft','delete_draft']) a where public.erp_qc_can(u.id,a)) end)
 from public.sessions s join public.users u on u.id=s.user_id
 where s.token=p_token and s.expires_at>now() and u.is_active
$$;
create or replace function public.qc_quality_summary(p_token text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare u public.users; counts jsonb; recent jsonb;
begin
 u:=public.erp_actor(p_token); perform public.erp_assert(u.id,'quality','read');
 select jsonb_build_object('total_lot',count(*),'lot_pass',count(*) filter(where status='PASS'),'lot_fail',count(*) filter(where status='FAIL')) into counts from public.hasil_uji;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]'::jsonb) into recent from (select h.id,h.no_lot,h.tgl_uji,h.status,h.created_at,jsonb_build_object('kode_produk',p.kode_produk,'nama_produk',p.nama_produk) master_produk from public.hasil_uji h join public.master_produk p on p.id=h.id_produk order by h.created_at desc,h.id limit 8) r;
 return counts||jsonb_build_object('total_produk',(select count(*) from public.master_produk),'total_coa',(select count(*) from public.coa),'recent_inspeksi',recent);
end $$;
create or replace function public.qc_quality_analytics(p_token text,p_period integer default 30) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare u public.users; today date:=public.erp_today(); firstday date; size integer; result jsonb;
begin
 u:=public.erp_actor(p_token); perform public.erp_assert(u.id,'quality','read');
 if p_period not in (30,90) or p_period is null then raise check_violation; end if;
 firstday:=today-(p_period-1); size:=p_period/6;
 with inspections as (
  select ((tgl_uji-firstday)/size)::int bucket,count(*) filter(where status='PASS') passed,count(*) filter(where status='FAIL') failed from public.hasil_uji where tgl_uji between firstday and today group by 1
 ), certificates as (
  select ((tanggal_rilis-firstday)/size)::int bucket,count(*) issued from public.coa where tanggal_rilis between firstday and today group by 1
 ) select jsonb_agg(jsonb_build_object('from',firstday+b*size,'to',firstday+(b+1)*size-1,'passed',coalesce(i.passed,0),'failed',coalesce(i.failed,0),'issued',coalesce(c.issued,0)) order by b) into result from generate_series(0,5) b left join inspections i on i.bucket=b left join certificates c on c.bucket=b;
 return jsonb_build_object('period',p_period,'from',firstday,'to',today,'buckets',result);
end $$;
revoke all on function public.qc_session_user(text),public.qc_quality_summary(text),public.qc_quality_analytics(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.qc_session_user(text),public.qc_quality_summary(text),public.qc_quality_analytics(text,integer) to service_role;

-- Match actual filter/order and traceability paths; avoid indexing large JSON payloads.
create index if not exists qc_inspection_test_date_status on public.hasil_uji(tgl_uji,status);
create index if not exists qc_inspection_recent on public.hasil_uji(created_at desc,id);
create index if not exists qc_coa_release_date on public.coa(tanggal_rilis);
create index if not exists qc_sessions_expiry on public.sessions(expires_at);
create index if not exists erp_material_ledger_transaction on public.erp_material_ledger(transaction_id,id);
create index if not exists erp_document_product_history on public.erp_product_documents(product_id,created_at desc,id);
create index if not exists erp_lots_expiry on public.erp_lots(expiry_date) where expiry_date is not null;
-- Support existing ILIKE '%term%' searches without changing matching semantics.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
do $$declare ns text; entry record; begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
 for entry in select * from (values ('master_produk','kode_produk'),('master_produk','nama_produk'),('master_produk','inci_name'),('hasil_uji','no_lot'),('coa','no_coa'),('coa','no_lot')) t(tab,col) loop
 execute format('create index if not exists %I on public.%I using gin (%I %I.gin_trgm_ops)','search_'||entry.tab||'_'||entry.col,entry.tab,entry.col,ns);
 end loop;
end $$;
-- Canonical URLs for database-generated inbox and insight links. Historical SQL stays immutable.
do $$declare source text; object record; old text; new text; begin
 for object in select 'view' kind,'public.erp_inbox' name union all select 'function',p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('erp_overview','erp_insights') loop
 if object.kind='view' then source:='create or replace view '||object.name||' as '||pg_get_viewdef(object.name::regclass,true); else source:=pg_get_functiondef(object.name::regprocedure); end if;
 for old,new in select * from (values ('/dashboard/inspeksi','/dashboard/quality/inspections'),('/dashboard/coa','/dashboard/quality/certificates'),('/dashboard/produk','/dashboard/master-data/products'),('/dashboard/materials','/dashboard/warehouse/materials'),('/dashboard/documents','/dashboard/product-documents')) t(a,b) loop source:=replace(source,old,new); end loop;
 execute source;
 end loop;
end $$;
create or replace function public.qc_global_search(p_token text,p_search text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare u public.users; pattern text; result jsonb;
begin
 u:=public.erp_actor(p_token);
 if length(btrim(p_search))<2 then return '[]'::jsonb; end if;
 if length(p_search)>100 then raise check_violation; end if;
 pattern:='%'||replace(replace(replace(p_search,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with allowed as materialized (select key from public.erp_modules where state<>'disabled' and public.erp_can(u.id,key,'read')),
 hits as (
 (select id,'Products' type,nama_produk title,kode_produk description,'/dashboard/master-data/products' path,null::text view,kode_produk query from public.master_produk where kode_produk ilike pattern or nama_produk ilike pattern or inci_name ilike pattern order by nama_produk,id limit 8)
 union all (select h.id,'Lot',h.no_lot,h.status,'/dashboard/quality/inspections',null,h.no_lot from public.hasil_uji h join public.master_produk p on p.id=h.id_produk where exists(select from allowed where key='quality') and (h.no_lot ilike pattern or p.nama_produk ilike pattern or p.kode_produk ilike pattern) order by h.created_at desc,h.id limit 8)
 union all (select c.id,'COA',c.no_coa,c.no_lot,'/dashboard/quality/certificates',null,c.no_coa from public.coa c join public.master_produk p on p.id=c.id_produk where exists(select from allowed where key='quality') and (c.no_coa ilike pattern or c.no_lot ilike pattern or p.nama_produk ilike pattern or p.kode_produk ilike pattern) order by c.created_at desc,c.id limit 8)
 union all (select p.id,'Purchase order',p.number,s.name,'/dashboard/purchase','purchases',p.number from public.erp_purchase_orders p join public.erp_suppliers s on s.id=p.supplier_id where exists(select from allowed where key='purchase') and (p.number ilike pattern or s.name ilike pattern) order by p.created_at desc,p.id limit 5)
 union all (select id,'Raw material',name,code,'/dashboard/purchase','materials',code from public.erp_materials where exists(select from allowed where key='purchase') and (name ilike pattern or code ilike pattern) order by name,id limit 5)
 union all (select id,'Supplier',name,contact,'/dashboard/purchase','suppliers',name from public.erp_suppliers where exists(select from allowed where key='purchase') and (name ilike pattern or contact ilike pattern) order by name,id limit 5)
 union all (select id,'Opportunity',number,title,'/dashboard/crm','opportunities',number from public.erp_opportunities where exists(select from allowed where key='crm') and (number ilike pattern or title ilike pattern or company ilike pattern or contact ilike pattern) order by created_at desc,id limit 5)
 union all (select d.id,'Product document',d.number,d.title,'/dashboard/product-documents','product_documents',d.number from public.erp_product_documents d join public.master_produk p on p.id=d.product_id where exists(select from allowed where key='documents') and (d.number ilike pattern or d.title ilike pattern or p.nama_produk ilike pattern or p.kode_produk ilike pattern) order by d.created_at desc,d.id limit 5)
 union all (select l.id,'Lots',l.number,p.nama_produk,'/dashboard/warehouse','lots',l.number from public.erp_lots l join public.master_produk p on p.id=l.product_id where exists(select from allowed where key='warehouse') and (l.number ilike pattern or p.nama_produk ilike pattern or p.kode_produk ilike pattern) order by l.created_at desc,l.id limit 5)
 union all (select q.id,'Quotation',q.number,c.name,'/dashboard/sales','quotes',q.number from public.erp_quotes q join public.erp_customers c on c.id=q.customer_id where exists(select from allowed where key='sales') and (q.number ilike pattern or c.name ilike pattern) order by q.created_at desc,q.id limit 5)
 union all (select o.id,'Order',o.number,o.state,'/dashboard/sales','orders',o.number from public.erp_orders o where exists(select from allowed where key='sales') and o.number ilike pattern order by o.created_at desc,o.id limit 5)
 union all (select m.id,'Production',m.number,m.state,'/dashboard/production','production',m.number from public.erp_movements m where m.kind='production' and exists(select from allowed where key='production') and m.number ilike pattern order by m.created_at desc,m.id limit 5)
 ) select coalesce(jsonb_agg(to_jsonb(hits)),'[]'::jsonb) into result from hits;
 return result;
end $$;
revoke all on function public.qc_global_search(text,text) from public,anon,authenticated,service_role;
grant execute on function public.qc_global_search(text,text) to service_role;
notify pgrst,'reload schema';
commit;
