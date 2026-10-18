begin;
-- Forward-only release migration; apply after 004. Historical lot numbers are retained.
create table if not exists public.erp_product_series(product_id uuid primary key references public.master_produk(id) on delete cascade,series text unique not null check(series ~ '^[0-9]{1,20}$'));
create table if not exists public.erp_batch_counters(product_id uuid references public.master_produk(id),year integer not null,batch integer not null check(batch>0),primary key(product_id,year));
alter table public.erp_lots add column if not exists pending_identity boolean not null default false;
alter table public.erp_lots add column if not exists batch_year integer;
alter table public.erp_lots add column if not exists batch_number integer;
alter table public.erp_lots add column if not exists held boolean not null default false;
alter table public.erp_lots add column if not exists source_lot_id uuid references public.erp_lots(id);
create unique index if not exists erp_lot_batch_unique on public.erp_lots(product_id,batch_year,batch_number) where batch_number is not null;
-- Only unambiguous real-product names get an initial series. Seed products are not guessed.
insert into public.erp_product_series select id,series from (select id,substring(nama_produk from '^\S+ ([0-9]{1,20})$') series,count(*) over(partition by substring(nama_produk from '^\S+ ([0-9]{1,20})$')) n from public.master_produk) p where series is not null and n=1 on conflict do nothing;
-- Adopt the highest recognizable historical batch per year without changing historical identities.
create or replace function public.erp_seed_batch_counter(p_product uuid,p_series text) returns void language sql set search_path=pg_catalog,public as $$
 insert into public.erp_batch_counters(product_id,year,batch)
 select p_product,extract(year from d)::integer,max(parts[1]::integer) from (
  select parts,public.erp_safe_date(substr(parts[2],5,4)||'-'||substr(parts[2],3,2)||'-'||substr(parts[2],1,2)) d from (
   select regexp_match(number,'^[0-9]+\.([0-9]{1,9})\.([0-9]{8})\.[0-9]{4}$') parts from public.erp_lots where product_id=p_product and split_part(number,'.',1)=p_series
  ) matches where parts is not null
 ) dated where d is not null and parts[1]::integer>0 group by extract(year from d)
 on conflict(product_id,year) do update set batch=greatest(erp_batch_counters.batch,excluded.batch);
$$;
do $$declare r record;begin for r in select * from public.erp_product_series loop perform public.erp_seed_batch_counter(r.product_id,r.series);end loop;end $$;
create table if not exists public.erp_returns(id uuid primary key default gen_random_uuid(),number text unique not null,delivery_id uuid not null references public.erp_movements(id),source_lot_id uuid not null references public.erp_lots(id),lot_id uuid references public.erp_lots(id),location_id uuid not null references public.erp_locations(id),quantity numeric(24,6) not null check(quantity>0),state text not null default 'requested' check(state in ('requested','received','released','scrapped','cancelled')),reason text not null,decision_reason text,receipt_id uuid references public.erp_movements(id),disposal_id uuid references public.erp_movements(id),created_at timestamptz not null default now(),created_by uuid not null references public.users(id));
create index if not exists erp_returns_source on public.erp_returns(source_lot_id,created_at desc);
create index if not exists erp_returns_open on public.erp_returns(state,created_at desc) where state in ('requested','received');
create index if not exists erp_posted_dates on public.erp_movements(date,kind) where state='posted';
create table if not exists public.erp_task_assignments(task_id text primary key,assigned_to uuid references public.users(id),due_date date,updated_at timestamptz not null default now());
create or replace function public.erp_lot_identity_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
 if old.batch_number is not null and (new.number,new.product_id,new.mfg_date,new.expiry_date,new.batch_year,new.batch_number) is distinct from (old.number,old.product_id,old.mfg_date,old.expiry_date,old.batch_year,old.batch_number) then raise exception using errcode='P0001',message='Posted production lot identity is locked.'; end if;
 if new.held then new.qc_status:='quarantine'; end if;
 return new; end $$;
drop trigger if exists erp_lot_identity_guard on public.erp_lots;
create trigger erp_lot_identity_guard before update on public.erp_lots for each row execute function public.erp_lot_identity_guard();
do $$begin
 if to_regprocedure('public.erp_mutate_v4(text,text,jsonb)') is null then alter function public.erp_mutate(text,text,jsonb) rename to erp_mutate_v4; end if;
 if to_regprocedure('public.qc_mutate_v4(text,text,jsonb)') is null then alter function public.qc_mutate(text,text,jsonb) rename to qc_mutate_v4; end if;
end $$;
create or replace function public.erp_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
<<erp_mutate>>
declare u public.users; m public.erp_movements; l public.erp_lots; ret public.erp_returns; result jsonb; e jsonb; lines jsonb:='[]'; n integer; yr integer; serial text; lot_number_new text; why text:=btrim(coalesce(p_payload->>'reason','')); target uuid:=nullif(p_payload->>'id','')::uuid; qty numeric; unit uuid; newlot uuid; move uuid; rec record; task_module text;
begin
 perform pg_advisory_xact_lock(49281041); u:=public.erp_actor(p_token);
 if octet_length(p_payload::text)>262144 then raise check_violation; end if;
 if p_action='set_series' then
  if u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  target:=(p_payload->>'product_id')::uuid; serial:=p_payload->>'series';
  if exists(select from public.erp_lots where product_id=target and batch_number is not null) and not exists(select from public.erp_product_series where product_id=target and series=serial) then raise exception using errcode='P0001',message='Series is locked after the first production batch.'; end if;
  insert into public.erp_product_series values(target,serial) on conflict(product_id) do update set series=excluded.series;
  perform public.erp_seed_batch_counter(target,serial);
  return jsonb_build_object('id',target);
 elsif p_action='set_module' and p_payload->>'module'='warehouse' and p_payload->>'state'='disabled' and exists(select from public.erp_returns where state in ('requested','received')) then
  if u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  raise exception using errcode='P0001',message='Resolve open returns before disabling Warehouse; use read-only to pause.';
 elsif p_action='save_move' and p_payload->>'kind'='production' then
  -- Every saved line represents a new batch; only the posted record has an official identity.
  for e in select * from jsonb_array_elements(p_payload->'lines') loop
   lines:=lines||jsonb_build_array(e||jsonb_build_object('lot_number','DRAFT-'||gen_random_uuid()));
  end loop;
  result:=public.erp_mutate_v4(p_token,p_action,p_payload||jsonb_build_object('lines',lines));
  update public.erp_lots set pending_identity=true where id in (select (x->>'lot_id')::uuid from public.erp_movements m,jsonb_array_elements(m.lines) x where m.id=(result->>'id')::uuid);
  return result;
 elsif p_action='post_move' then
  select * into m from public.erp_movements where id=target for update;
  if m.state='draft' and m.from_location is not null and exists(select from jsonb_array_elements(m.lines) x join public.erp_returns r on r.lot_id=(x->>'lot_id')::uuid where r.state='received') then
   perform public.erp_assert(u.id,'warehouse','write');
   raise exception using errcode='P0001',message='Use approved return disposition for held returned goods.';
  end if;
  if m.kind='production' and m.state='draft' then
   perform public.erp_assert(u.id,'production','write');
   if p_payload ? 'version' and m.version<>(p_payload->>'version')::integer then raise exception using errcode='P0001',message='This draft changed after review. Reload before posting.'; end if;
   for e in select * from jsonb_array_elements(m.lines) loop
    select * into l from public.erp_lots where id=(e->>'lot_id')::uuid for update;
    -- A legacy draft could reference an already stocked manual lot; never rename that lot.
    if exists(select from public.erp_ledger where lot_id=l.id) then
     insert into public.erp_lots(product_id,number,mfg_date,expiry_date,pending_identity) values(l.product_id,'DRAFT-'||gen_random_uuid(),l.mfg_date,l.expiry_date,true) returning id into newlot;
     select * into l from public.erp_lots where id=newlot;
     e:=e||jsonb_build_object('lot_id',newlot);
    end if;
    select series into serial from public.erp_product_series where product_id=l.product_id;
    if serial is null then raise exception using errcode='P0001',message='Configure a unique product series in Master data before posting production.'; end if;
    yr:=extract(year from l.mfg_date); if yr is null then raise check_violation; end if;
    insert into public.erp_batch_counters values(l.product_id,yr,1) on conflict(product_id,year) do update set batch=erp_batch_counters.batch+1 returning batch into n;
    lot_number_new:=serial||'.'||case when n<10 then '0' else '' end||n||'.'||to_char(l.mfg_date,'DDMMYYYY')||'.'||extract(year from (l.mfg_date+interval '1 year'))::integer;
    while exists(select from public.erp_lots where product_id=l.product_id and number=lot_number_new) loop
     update public.erp_batch_counters set batch=batch+1 where product_id=l.product_id and year=yr returning batch into n;
     lot_number_new:=serial||'.'||case when n<10 then '0' else '' end||n||'.'||to_char(l.mfg_date,'DDMMYYYY')||'.'||extract(year from (l.mfg_date+interval '1 year'))::integer;
    end loop;
    update public.erp_lots set number=lot_number_new,batch_year=yr,batch_number=n,pending_identity=false,expiry_date=(mfg_date+interval '1 year')::date where id=l.id;
    lines:=lines||jsonb_build_array(e||jsonb_build_object('lot',lot_number_new));
   end loop;
   update public.erp_movements set lines=erp_mutate.lines where id=target;
  end if;
 elsif p_action='hold_lot' then
  perform public.erp_assert(u.id,'warehouse','approve'); if why='' then raise check_violation; end if;
  select * into l from public.erp_lots where id=target for update; if not found then raise no_data_found; end if;
  if not (p_payload->>'hold')::boolean and exists(select from public.erp_returns where lot_id=target and state='received') then raise exception using errcode='P0001',message='Use return disposition to release received returned goods.'; end if;
  update public.erp_lots set held=(p_payload->>'hold')::boolean,qc_status=case when (p_payload->>'hold')::boolean then 'quarantine' when exists(select from public.hasil_uji h where h.id=l.inspection_id and h.qc_version=1 and h.status='PASS' and h.tgl_uji<=public.erp_today()) then 'released' when exists(select from public.hasil_uji h where h.id=l.inspection_id and h.status='FAIL') then 'rejected' else 'quarantine' end where id=target;
  insert into public.audit_log(user_name,aksi,referensi) values(u.nama_lengkap,'LOT_HOLD',jsonb_build_object('lot_id',target,'hold',p_payload->'hold','reason',why)::text);
  return jsonb_build_object('id',target,'entity','lots');
 elsif p_action='create_return' then
  perform public.erp_assert(u.id,'warehouse','write');
  select * into m from public.erp_movements where id=(p_payload->>'delivery_id')::uuid and kind='delivery' and state='posted'; if not found then raise exception using errcode='P0001',message='Choose a posted delivery.'; end if;
  select * into l from public.erp_lots where id=(p_payload->>'lot_id')::uuid; if not found then raise no_data_found; end if;
  qty:=public.erp_qty(p_payload->>'quantity');
  if why='' then raise check_violation; end if;
  if qty+coalesce((select sum(quantity) from public.erp_returns where delivery_id=m.id and source_lot_id=l.id and state<>'cancelled'),0)>coalesce((select sum((x->>'base_quantity')::numeric) from jsonb_array_elements(m.lines) x where (x->>'lot_id')::uuid=l.id),0) then raise exception using errcode='P0001',message='Return quantity exceeds the unreturned shipment quantity.'; end if;
  insert into public.erp_returns(number,delivery_id,source_lot_id,location_id,quantity,reason,created_by) values(public.erp_number('RTN'),m.id,l.id,(p_payload->>'location_id')::uuid,qty,why,u.id) returning id into target;
  return jsonb_build_object('id',target,'entity','returns');
 elsif p_action in ('receive_return','dispose_return','cancel_return') then
  perform public.erp_assert(u.id,'warehouse',case when p_action='dispose_return' then 'approve' else 'write' end);
  select * into ret from public.erp_returns where id=target for update; if not found then raise no_data_found; end if;
  if why='' then raise check_violation; end if;
  select * into l from public.erp_lots where id=ret.source_lot_id;
  select unit_id into unit from public.erp_product_units where product_id=l.product_id and is_base;
  if p_action='cancel_return' then
   if ret.state<>'requested' then raise exception using errcode='P0001',message='Only an unreceived return can be cancelled.'; end if;
   update public.erp_returns set state='cancelled',decision_reason=why where id=target;
  elsif p_action='receive_return' then
   if ret.state='received' then return jsonb_build_object('id',target); end if;
   if ret.state<>'requested' or not exists(select from public.erp_movements where id=ret.delivery_id and state='posted') then raise exception using errcode='P0001',message='Return is not awaiting receipt or the original delivery was reversed.'; end if;
   result:=public.erp_mutate_v4(p_token,'save_move',jsonb_build_object('kind','receipt','date',public.erp_today(),'to_location',ret.location_id,'reason',why||' · '||ret.number,'lines',jsonb_build_array(jsonb_build_object('product_id',l.product_id,'lot_number',l.number||'/'||ret.number,'mfg_date',l.mfg_date,'unit_id',unit,'quantity',ret.quantity::text))));
   move:=(result->>'id')::uuid;
   select (lines->0->>'lot_id')::uuid into newlot from public.erp_movements where id=move;
   update public.erp_lots set source_lot_id=l.id,held=true where id=newlot;
   perform public.erp_mutate_v4(p_token,'post_move',jsonb_build_object('id',move));
   update public.erp_returns set state='received',lot_id=newlot,receipt_id=move,decision_reason=why where id=target;
  else
   if ret.state<>'received' then raise exception using errcode='P0001',message='Receive the return before disposition.'; end if;
   if p_payload->>'decision'='release' then
    if not exists(select from public.erp_lots rl join public.hasil_uji h on h.id=rl.inspection_id where rl.id=ret.lot_id and h.status='PASS' and h.qc_version=1 and h.tgl_uji<=public.erp_today() and rl.expiry_date>=public.erp_today()) then raise exception using errcode='P0001',message='A valid PASS inspection and unexpired lot are required before release.'; end if;
    update public.erp_lots set held=false,qc_status='released' where id=ret.lot_id;
    update public.erp_returns set state='released',decision_reason=why where id=target;
   elsif p_payload->>'decision'='scrap' then
    result:=public.erp_mutate_v4(p_token,'save_move',jsonb_build_object('kind','issue','date',public.erp_today(),'from_location',ret.location_id,'reason',why||' · '||ret.number,'lines',jsonb_build_array(jsonb_build_object('lot_id',ret.lot_id,'unit_id',unit,'quantity',ret.quantity::text))));
    move:=(result->>'id')::uuid; perform public.erp_mutate_v4(p_token,'post_move',jsonb_build_object('id',move));
    update public.erp_returns set state='scrapped',disposal_id=move,decision_reason=why where id=target;
   else raise check_violation; end if;
  end if;
  return jsonb_build_object('id',target,'entity','returns');
 elsif p_action='assign_task' then
  select module into task_module from public.erp_inbox where id=p_payload->>'task_id'; if not found then raise no_data_found; end if;
  perform public.erp_assert(u.id,task_module,'approve');
  target:=nullif(p_payload->>'user_id','')::uuid;
  if target is not null and not exists(select from public.users where id=target and is_active and public.erp_can(id,task_module,'write')) then raise insufficient_privilege; end if;
  insert into public.erp_task_assignments(task_id,assigned_to,due_date) values(p_payload->>'task_id',target,nullif(p_payload->>'due_date','')::date) on conflict(task_id) do update set assigned_to=excluded.assigned_to,due_date=excluded.due_date,updated_at=now();
  return '{}'::jsonb;
 elsif p_action='reverse_move' and exists(select from public.erp_returns where (delivery_id=target or receipt_id=target or disposal_id=target) and state<>'cancelled') then
  raise exception using errcode='P0001',message='Movements with return history cannot be reversed; retain the approved return history.';
 end if;
 return public.erp_mutate_v4(p_token,p_action,p_payload);
end $$;
create or replace function public.qc_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare l public.erp_lots; begin
 perform pg_advisory_xact_lock(49281041); perform public.erp_actor(p_token);
 if p_action in ('create_uji','update_uji') and exists(select from public.erp_modules where key='production' and state<>'disabled') then
  select * into l from public.erp_lots where product_id=(p_payload->>'id_produk')::uuid and number=p_payload->>'no_lot';
  if (not found or not exists(select from public.erp_ledger where lot_id=l.id)) and not (p_action='update_uji' and exists(select from public.hasil_uji where id=(p_payload->>'id')::uuid and id_produk=(p_payload->>'id_produk')::uuid and no_lot=p_payload->>'no_lot')) then raise exception using errcode='P0001',message='Select an existing received or produced lot. Manual lots require Production to be disabled.'; end if;
  if (p_payload->>'tgl_sampling')::date<l.mfg_date or (p_payload->>'tgl_uji')::date<l.mfg_date then raise exception using errcode='P0001',message='Inspection dates cannot precede manufacturing.'; end if;
 end if;
 return public.qc_mutate_v4(p_token,p_action,p_payload);
end $$;
create or replace view public.erp_inbox as
select 'qc:'||l.id id,'quality' module,'Inspection required' title,l.number description,'/dashboard/inspeksi?lot='||l.id href,l.created_at sort from public.erp_lots l where l.qc_status='quarantine' and l.inspection_id is null and exists(select from public.erp_ledger where lot_id=l.id)
union all select 'quote:'||q.id,'sales','Approve quotation',q.number,'/dashboard/sales?view=quotes&q='||q.number,q.created_at from public.erp_quotes q where q.state='pending'
union all select 'quote-expiry:'||q.id,'sales','Quotation expiring',q.number,'/dashboard/sales?view=quotes&q='||q.number,q.created_at from public.erp_quotes q where q.state='issued' and q.valid_until between public.erp_today() and public.erp_today()+7
union all select 'order:'||o.id,'warehouse','Prepare delivery',o.number,'/dashboard/warehouse?view=fulfillment&q='||o.number,o.created_at from public.erp_orders o where o.state='confirmed'
union all select 'count:'||c.id,'warehouse','Approve stock count',c.number,'/dashboard/warehouse?view=counts&q='||c.number,c.created_at from public.erp_counts c where c.state='submitted'
union all select 'return:'||r.id,'warehouse',case when r.state='requested' then 'Receive return' else 'Review return' end,r.number,'/dashboard/warehouse?view=returns&q='||r.number,r.created_at from public.erp_returns r where r.state in ('requested','received');

-- User-facing activity uses business events, never internal table/counter names.
create or replace view public.erp_activity as
select a.user_name,a.waktu,v.label action,case when v.code in ('erp_post_move','erp_save_move') and exists(select from public.erp_movements m where m.id::text=a.referensi and m.kind='production') then 'production' else v.module end module
from public.audit_log a join (values
 ('insert_hasil_uji','Inspection recorded','quality'),('update_hasil_uji','Inspection updated','quality'),('insert_coa','Certificate issued','quality'),
 ('erp_post_move','Stock movement posted','warehouse'),('erp_save_move','Movement draft saved','warehouse'),('erp_reverse_move','Movement reversed','warehouse'),
 ('erp_save_quote','Quotation draft saved','sales'),('erp_issue_quote','Quotation issued','sales'),('erp_accept_quote','Quotation accepted','sales'),('erp_convert_quote','Sales order created','sales'),
 ('erp_approve_count','Stock count approved','warehouse'),('erp_reserve','Stock reserved','sales'),('lot_hold','Lot hold updated','warehouse'),
 ('insert_erp_returns','Return requested','warehouse'),('update_erp_returns','Return updated','warehouse')
) v(code,label,module) on lower(a.aksi)=v.code;
create index if not exists erp_actor_activity on public.audit_log(user_name,waktu desc);
create or replace function public.erp_overview(p_token text,p_area text default 'overview',p_days text default '30') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; days integer; firstday date; series jsonb; metrics jsonb; activity jsonb; areas jsonb; begin
 u:=public.erp_actor(p_token); days:=case when p_days in ('7','30','90') then p_days::integer else 30 end; firstday:=public.erp_today()-days+1;
 if p_area not in ('overview','production','quality','warehouse','sales') then raise check_violation; end if;
 if p_area<>'overview' then perform public.erp_assert(u.id,p_area,'read'); end if;
 select coalesce(jsonb_agg(key order by key),'[]') into areas from public.erp_modules where state<>'disabled' and public.erp_can(u.id,key,'read');
 with events as (
 select date as event_day from public.erp_movements where p_area='production' and kind='production' and state='posted' and date between firstday and public.erp_today()
 union all select tgl_uji from public.hasil_uji where p_area='quality' and tgl_uji between firstday and public.erp_today()
 union all select date from public.erp_movements where p_area='warehouse' and kind<>'production' and state='posted' and date between firstday and public.erp_today()
 union all select date from public.erp_quotes where p_area='sales' and state in ('issued','accepted') and date between firstday and public.erp_today()
 union all select (waktu at time zone 'Asia/Jakarta')::date from public.erp_activity where p_area='overview' and module in (select jsonb_array_elements_text(areas)) and user_name=u.nama_lengkap and waktu>=firstday::timestamp at time zone 'Asia/Jakarta' and waktu<(public.erp_today()+1)::timestamp at time zone 'Asia/Jakarta'
 ), daily as (select event_day,count(*) n from events group by event_day)
 select coalesce(jsonb_agg(jsonb_build_object('date',d::date,'count',coalesce(n,0)) order by d),'[]') into series from generate_series(firstday::timestamp,public.erp_today()::timestamp,interval '1 day') d left join daily on daily.event_day=d::date;

 metrics:=case p_area
 when 'quality' then jsonb_build_array(jsonb_build_object('label','Inspections','value',(select count(*) from public.hasil_uji where tgl_uji>=firstday and tgl_uji<=public.erp_today())),jsonb_build_object('label','Failed inspections','value',(select count(*) from public.hasil_uji where status='FAIL' and tgl_uji between firstday and public.erp_today())))
 when 'production' then jsonb_build_array(jsonb_build_object('label','Posted production records','value',(select count(*) from public.erp_movements where kind='production' and state='posted' and date between firstday and public.erp_today())),jsonb_build_object('label','Draft production records','value',(select count(*) from public.erp_movements where kind='production' and state='draft')))
 when 'warehouse' then jsonb_build_array(jsonb_build_object('label','Posted movements','value',(select count(*) from public.erp_movements where state='posted' and kind<>'production' and date between firstday and public.erp_today())),jsonb_build_object('label','Held lots','value',(select count(*) from public.erp_lots where held)))
 when 'sales' then jsonb_build_array(jsonb_build_object('label','Quotations created','value',(select count(*) from public.erp_quotes where date between firstday and public.erp_today())),jsonb_build_object('label','Open sales orders','value',(select count(*) from public.erp_orders where state='confirmed')))
 else (select coalesce(jsonb_agg(m),'[]') from (values
 (case when areas ? 'production' then jsonb_build_object('label','Posted production records','value',(select count(*) from public.erp_movements where kind='production' and state='posted' and date between firstday and public.erp_today())) end),
 (case when areas ? 'quality' then jsonb_build_object('label','Inspections','value',(select count(*) from public.hasil_uji where tgl_uji between firstday and public.erp_today())) end),
 (case when areas ? 'warehouse' then jsonb_build_object('label','Posted deliveries','value',(select count(*) from public.erp_movements where kind='delivery' and state='posted' and date between firstday and public.erp_today())) end),
 (case when areas ? 'sales' then jsonb_build_object('label','Open sales orders','value',(select count(*) from public.erp_orders where state='confirmed')) end)) x(m) where m is not null) end;
 -- Only the signed-in actor's recent actions, no cross-module audit disclosure.
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into activity from (select action,waktu created_at from public.erp_activity where user_name=u.nama_lengkap and module in (select jsonb_array_elements_text(areas)) order by waktu desc limit 6) x;
 return jsonb_build_object('areas',areas,'metrics',metrics,'series',series,'activity',activity,'days',days,'chart_label',case p_area when 'production' then 'Posted production records' when 'quality' then 'Inspections completed' when 'warehouse' then 'Posted warehouse movements' when 'sales' then 'Issued or accepted quotations' else 'Your recorded actions' end);
end $$;

create or replace function public.erp_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; source text; rows jsonb; total bigint; result jsonb; target uuid; module text;
begin
 u:=public.erp_actor(p_token);
 if length(p_search)>100 or p_page<1 or p_page>1000000 or length(coalesce(p_id,''))>100 then raise check_violation; end if;
 if p_entity='overview' then return public.erp_overview(p_token,p_state,p_search); end if;
 if p_entity='context' then
  return jsonb_build_object('modules',(select jsonb_agg(jsonb_build_object('key',key,'state',state,'read',public.erp_can(u.id,key,'read'),'write',public.erp_can(u.id,key,'write'),'approve',public.erp_can(u.id,key,'approve')) order by key) from public.erp_modules),'admin',u.role in ('admin qc','administrator inbionusa'));
 end if;
 module:=case when p_entity in ('stock','availability','count_lines','counters','lots','movements','counts','ledger','fulfillment','returns','trace','posted_deliveries') then 'warehouse' when p_entity='production' then 'production' when p_entity in ('quotes','orders','customers') then 'sales' end;
 if module is not null then perform public.erp_assert(u.id,module,'read'); end if;
 if p_entity='trace_events' then perform public.erp_assert(u.id,'warehouse','read'); end if;
 if p_entity='counters' and not public.erp_can(u.id,'warehouse','approve') then raise insufficient_privilege; end if;
 if p_entity in ('access','users') and u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
 if p_entity='task_owners' and not exists(select from public.erp_modules where state='active' and public.erp_can(u.id,key,'approve')) then raise insufficient_privilege; end if;
 if p_entity='inspection_lots' then perform public.erp_assert(u.id,'quality','read'); end if;
 source:=case p_entity

 when 'task_owners' then 'select id,nama_lengkap name,username label,username search,username sort,'''' state from public.users where is_active'
 when 'posted_deliveries' then 'select id,number,number label,number search,state,created_at::text sort from public.erp_movements where kind=''delivery'' and state=''posted'''
 when 'series' then $s$select p.id,p.nama_produk name,p.kode_produk code,s.series,p.nama_produk||' '||p.kode_produk search,p.nama_produk sort,'' state from public.master_produk p left join public.erp_product_series s on s.product_id=p.id$s$
 when 'inspection_lots' then $s$select l.*,p.nama_produk product,l.number||' · '||p.nama_produk label,l.number||' '||p.nama_produk search,l.qc_status state,l.created_at::text sort from public.erp_lots l join public.master_produk p on p.id=l.product_id where exists(select from public.erp_ledger where lot_id=l.id)$s$
 when 'inbox' then 'select i.*,a.assigned_to,a.due_date,u.nama_lengkap assignee,i.title||'' ''||i.description search,i.module state from public.erp_inbox i left join public.erp_task_assignments a on a.task_id=i.id left join public.users u on u.id=a.assigned_to where public.erp_can('||quote_literal(u.id)||'::uuid,i.module,''read'') and exists(select from public.erp_modules where key=i.module and state<>''disabled'')'
 when 'returns' then $s$select r.*,(select u.code from public.erp_product_units pu join public.erp_units u on u.id=pu.unit_id where pu.product_id=l.product_id and pu.is_base) unit,p.nama_produk product,l.number lot_number,m.number delivery,r.number||' '||l.number||' '||p.nama_produk search,r.created_at::text sort from public.erp_returns r join public.erp_lots l on l.id=r.source_lot_id join public.master_produk p on p.id=l.product_id join public.erp_movements m on m.id=r.delivery_id$s$
 when 'trace_events' then 'select g.id::text id,m.id movement_id,m.number,m.kind,m.state,m.date,m.reason,l.number lot_number,jsonb_build_object(''customer'',case when public.erp_can('||quote_literal(u.id)||'::uuid,''sales'',''read'') and exists(select from public.erp_modules where key=''sales'' and state<>''disabled'') then m.snapshot->''customer'' else null end) snapshot,g.delta::text delta,loc.name location,m.created_at::text sort,m.number search from public.erp_ledger g join public.erp_movements m on m.id=g.movement_id join public.erp_lots l on l.id=g.lot_id join public.erp_locations loc on loc.id=g.location_id where g.lot_id='||quote_literal(p_id::uuid)||'::uuid'
 when 'trace' then $s$select l.*,l.qc_status state,p.nama_produk product,l.number||' '||p.nama_produk search,l.created_at::text sort from public.erp_lots l join public.master_produk p on p.id=l.product_id where not l.pending_identity$s$
 when 'catalog' then $s$select p.id,p.kode_produk code,p.nama_produk name,p.kode_produk||' · '||p.nama_produk label,p.kode_produk||' '||p.nama_produk search,'' state,p.nama_produk sort,
 coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'code',u.code,'factor',pu.factor::text,'is_base',pu.is_base) order by pu.is_base desc,u.code) from public.erp_product_units pu join public.erp_units u on u.id=pu.unit_id where pu.product_id=p.id),'[]') units from public.master_produk p$s$
 when 'units' then 'select id,code,name,code||'' · ''||name label,code||'' ''||name search,'''' state,code sort from public.erp_units'
 when 'locations' then 'select id,code,name,warehouse,code||'' · ''||name label,code||'' ''||name search,'''' state,code sort from public.erp_locations'
 when 'customers' then 'select *,name label,name||'' ''||contact||'' ''||email search,'''' state,name sort from public.erp_customers'
 when 'counters' then 'select id,username,nama_lengkap name,username||'' · ''||nama_lengkap label,username||'' ''||nama_lengkap search,'''' state,username sort from public.users where is_active and public.erp_can(id,''warehouse'',''write'')'
 when 'users' then 'select id,username,nama_lengkap name,username||'' · ''||nama_lengkap label,username||'' ''||nama_lengkap search,'''' state,username sort from public.users where is_active'
 when 'access' then $s$select a.user_id::text||':'||a.module id,a.*,u.username,u.nama_lengkap name,u.username||' '||u.nama_lengkap search,'' state,u.username sort from public.erp_access a join public.users u on u.id=a.user_id$s$
 when 'availability' then 'select *,product||'' · ''||lot_number||'' · ''||location||'' · ''||available||'' ''||unit label from public.erp_stock_view where available::numeric>0 and product_id='||quote_literal(p_id::uuid)||'::uuid'
 when 'stock' then 'select *,product||'' · ''||lot_number||'' · ''||location||'' · ''||available||'' ''||unit label from public.erp_stock_view'
 when 'lots' then $s$select l.*,p.kode_produk code,p.nama_produk product,u.code unit,l.qc_status state,l.number||' '||p.nama_produk||' '||p.kode_produk search,l.created_at::text sort from public.erp_lots l join public.master_produk p on p.id=l.product_id left join public.erp_product_units pu on pu.product_id=p.id and pu.is_base left join public.erp_units u on u.id=pu.unit_id where not l.pending_identity$s$
 when 'movements' then $s$select m.*,coalesce(f.name,'—') source,coalesce(t.name,'—') destination,m.number||' '||m.reason||' '||m.lines::text search,m.created_at::text sort from public.erp_movements m left join public.erp_locations f on f.id=m.from_location left join public.erp_locations t on t.id=m.to_location$s$
 when 'production' then $s$select m.*,coalesce(t.name,'—') destination,m.number||' '||m.reason||' '||m.lines::text search,m.created_at::text sort from public.erp_movements m left join public.erp_locations t on t.id=m.to_location where kind='production'$s$
 when 'count_lines' then 'select cl.lot_id id,cl.lot_id,cl.count_id,l.product_id,p.nama_produk product,l.number lot,um.code unit,cl.counted::text counted,case when c.blind and c.state=''counting'' and not public.erp_can('||quote_literal(u.id)||'::uuid,''warehouse'',''approve'') then null else cl.baseline::text end baseline,case when c.blind and c.state=''counting'' and not public.erp_can('||quote_literal(u.id)||'::uuid,''warehouse'',''approve'') then null else (cl.counted-cl.baseline)::text end difference,case when cl.counted is null then ''uncounted'' else ''counted'' end state,p.nama_produk||'' ''||l.number search,p.nama_produk||'' ''||l.number sort from public.erp_count_lines cl join public.erp_counts c on c.id=cl.count_id join public.erp_lots l on l.id=cl.lot_id join public.master_produk p on p.id=l.product_id join public.erp_product_units pu on pu.product_id=p.id and pu.is_base join public.erp_units um on um.id=pu.unit_id where cl.count_id='||quote_literal(p_id::uuid)||'::uuid'
 when 'counts' then $s$select c.*,l.name location,u.nama_lengkap assigned,c.number||' '||l.name search,c.created_at::text sort from public.erp_counts c join public.erp_locations l on l.id=c.location_id join public.users u on u.id=c.assigned_to$s$
 when 'ledger' then $s$select g.id::text id,g.movement_id,m.number,m.kind,g.lot_id,l.number lot_number,p.nama_produk product,loc.name location,um.code unit,g.delta::text delta,g.created_at,g.created_at::text sort,m.state,m.number||' '||l.number||' '||p.nama_produk search from public.erp_ledger g join public.erp_movements m on m.id=g.movement_id join public.erp_lots l on l.id=g.lot_id join public.master_produk p on p.id=l.product_id join public.erp_locations loc on loc.id=g.location_id join public.erp_product_units pu on pu.product_id=p.id and pu.is_base join public.erp_units um on um.id=pu.unit_id$s$
 when 'quotes' then $s$select q.*,coalesce(q.snapshot->'customer'->>'name',c.name) customer,to_jsonb(c) customer_data,q.number||' '||c.name||' '||q.lines::text search,q.created_at::text sort,case when q.state='issued' and q.valid_until<public.erp_today() then 'expired' else q.state end display_state from public.erp_quotes q join public.erp_customers c on c.id=q.customer_id$s$
 when 'orders' then $s$select o.*,o.snapshot->'customer'->>'name' customer,o.number||' '||(o.snapshot->'customer'->>'name')||' '||o.customer_reference search,o.created_at::text sort from public.erp_orders o$s$
 when 'fulfillment' then $s$select o.id,o.number,o.state,o.customer_reference,jsonb_build_object('customer',o.snapshot->'customer') snapshot,o.snapshot->'customer'->>'name' customer,o.number||' '||(o.snapshot->'customer'->>'name') search,o.created_at::text sort from public.erp_orders o$s$
 else null end;
 if p_entity='inspection_lots' and p_id is null then source:='select * from ('||source||') eligible where inspection_id is null'; end if;
 if p_entity in ('availability','count_lines','trace_events') then p_id:=null; end if;
 if p_id is null and p_entity in ('movements','production') then source:='select id,number,kind,state,date,reason,version,destination,search,sort from ('||source||') summary'; end if;
 if p_id is null and p_entity='quotes' then source:='select id,number,customer_id,customer,date,valid_until,revision,currency,state,display_state,totals,version,search,sort from ('||source||') summary'; end if;
 if p_id is null and p_entity in ('orders','fulfillment') then source:='select id,number,state,customer,customer_reference,search,sort from ('||source||') summary'; end if;
 if source is null then raise exception using errcode='P0001',message='Unknown collection.'; end if;
 execute 'select count(*) from ('||source||') x where ($1='''' or x.search ilike ''%''||replace(replace(replace($1,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($2='''' or x.state=$2) and ($3 is null or x.id::text=$3)' into total using p_search,p_state,p_id;
 execute 'select coalesce(jsonb_agg(to_jsonb(y)-''search''-''sort''),''[]'') from (select * from ('||source||') x where ($1='''' or x.search ilike ''%''||replace(replace(replace($1,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($2='''' or x.state=$2) and ($3 is null or x.id::text=$3) order by x.sort '||case when p_entity in ('stock','availability','count_lines','catalog','units','locations','customers','users','access') then 'asc' else 'desc' end||',x.id limit 50 offset $4) y' into rows using p_search,p_state,p_id,(p_page-1)*50;
 if p_entity='trace' and p_id is not null and jsonb_array_length(rows)>0 then
  select jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',50,'stock',coalesce((select jsonb_agg(to_jsonb(s)) from public.erp_stock_view s where s.lot_id=p_id::uuid),'[]'),'returns',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'number',r.number,'state',r.state,'lot_id',r.lot_id,'lot',(select number from public.erp_lots where id=r.lot_id),'quantity',r.quantity::text)) from public.erp_returns r where r.source_lot_id=p_id::uuid),'[]'),'inspection',case when public.erp_can(u.id,'quality','read') and exists(select from public.erp_modules where key='quality' and state<>'disabled') then (select jsonb_build_object('status',h.status,'date',h.tgl_uji,'inspector',h.inspector,'failure_reason',h.failure_reason,'coa',(select no_coa from public.coa where id_hasil_uji=h.id)) from public.erp_lots l join public.hasil_uji h on h.id=l.inspection_id where l.id=p_id::uuid) else null end) into result;
  return result;
 end if;
 if p_id is not null and jsonb_array_length(rows)>0 then
  target:=case when p_entity not in ('stock','access','ledger','inbox') then p_id::uuid end;
  if p_entity='counts' then
   select rows->0||jsonb_build_object('total_lines',(select count(*) from public.erp_count_lines where count_id=target),'counted_lines',(select count(*) from public.erp_count_lines where count_id=target and counted is not null)) into result;
   rows:=jsonb_build_array(result);
  elsif p_entity in ('orders','fulfillment') then
   select rows->0||jsonb_build_object('lines',coalesce((select jsonb_agg(jsonb_build_object('id',ol.id,'position',ol.position,'product_id',ol.product_id,'product',ol.snapshot->>'product','code',ol.snapshot->>'code','unit',ol.snapshot->>'base_unit','quantity',ol.quantity::text,'delivered',ol.delivered::text,'outstanding',(ol.quantity-ol.delivered)::text,'unreserved',(ol.quantity-ol.delivered-coalesce((select sum(remaining) from public.erp_reservations where order_line_id=ol.id and state='active'),0))::text,'reserved',coalesce((select sum(remaining) from public.erp_reservations where order_line_id=ol.id and state='active'),0)::text) order by ol.position) from public.erp_order_lines ol where ol.order_id=target),'[]'),'reservations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'order_line_id',r.order_line_id,'lot_id',r.lot_id,'location_id',r.location_id,'lot',l.number,'location',loc.name,'remaining',r.remaining::text,'quantity',r.quantity::text,'state',r.state,'unit',ol.snapshot->>'base_unit','product',ol.snapshot->>'product') order by r.created_at) from public.erp_reservations r join public.erp_order_lines ol on ol.id=r.order_line_id join public.erp_lots l on l.id=r.lot_id join public.erp_locations loc on loc.id=r.location_id where ol.order_id=target),'[]'),'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',id,'number',number,'state',state) order by created_at desc) from public.erp_movements where order_id=target and kind='delivery'),'[]')) into result;
   rows:=jsonb_build_array(result);
  end if;
 end if;
 return jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',50);
end $$;


-- RLS and RPC-only privileges for every new operational table/view/helper.
do $$declare t text; f regprocedure; begin
 foreach t in array array['erp_product_series','erp_batch_counters','erp_returns','erp_task_assignments'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('drop trigger if exists erp_audit on public.%I',t);
  execute format('create trigger erp_audit after insert or update or delete on public.%I for each row execute function public.erp_audit()',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'erp_%' or p.proname='qc_mutate_v4') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop;
end $$;
revoke all on public.erp_activity from public,anon,authenticated,service_role;
revoke all on public.erp_inbox from public,anon,authenticated,service_role;
grant execute on function public.erp_read(text,text,text,text,integer,text),public.erp_mutate(text,text,jsonb),public.erp_module_guard(text,text,text),public.qc_mutate(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
