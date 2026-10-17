begin;
create sequence if not exists public.erp_document_seq;
create table if not exists public.erp_modules(key text primary key check(key in ('quality','warehouse','production','sales')),state text not null default 'active' check(state in ('active','read_only','disabled')));
insert into public.erp_modules(key) values('quality'),('warehouse'),('production'),('sales') on conflict do nothing;
create table if not exists public.erp_access(user_id uuid references public.users(id) on delete cascade,module text references public.erp_modules(key),can_read boolean not null default true,can_write boolean not null default false,can_approve boolean not null default false,primary key(user_id,module),check(can_read or not(can_write or can_approve)));
create table if not exists public.erp_units(id uuid primary key default gen_random_uuid(),code text not null check(length(code) between 1 and 20),name text not null check(length(name) between 1 and 80));
create unique index if not exists erp_unit_code on public.erp_units(lower(code));
insert into public.erp_units(code,name) select x,x from unnest(array['kg','t','bag','drum','unit']) x where not exists(select from public.erp_units where lower(code)=x);
create table if not exists public.erp_product_units(product_id uuid references public.master_produk(id) on delete restrict,unit_id uuid references public.erp_units(id),factor numeric(24,6) not null check(factor>0 and factor<=1000000000),is_base boolean not null default false,primary key(product_id,unit_id),check(not is_base or factor=1));
alter table public.erp_product_units drop constraint if exists erp_product_units_product_id_fkey;
alter table public.erp_product_units add constraint erp_product_units_product_id_fkey foreign key(product_id) references public.master_produk(id) on delete cascade;
create unique index if not exists erp_one_base on public.erp_product_units(product_id) where is_base;
insert into public.erp_product_units select p.id,u.id,1,true from public.master_produk p join public.erp_units u on lower(btrim(p.satuan))=lower(u.code) where not exists(select from public.erp_product_units pu where pu.product_id=p.id and pu.is_base) on conflict do nothing;
create table if not exists public.erp_locations(id uuid primary key default gen_random_uuid(),code text unique not null check(length(code) between 1 and 30),name text not null check(length(name) between 1 and 100),warehouse text not null default 'Main warehouse');
insert into public.erp_locations(code,name) values('MAIN','Main storage') on conflict do nothing;
create table if not exists public.erp_customers(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 200),contact text not null default '',email text not null default '',phone text not null default '',tax_id text not null default '',billing_address text not null default '',shipping_address text not null default '',payment_terms text not null default '',updated_at timestamptz not null default now());
create table if not exists public.erp_lots(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.master_produk(id) on delete restrict,number text not null check(length(number) between 1 and 1000),mfg_date date,expiry_date date,qc_status text not null default 'quarantine' check(qc_status in ('quarantine','released','rejected')),inspection_id uuid references public.hasil_uji(id) on delete set null,created_at timestamptz not null default now(),unique(product_id,number),check(expiry_date is null or mfg_date is null or expiry_date>=mfg_date));
create or replace function public.erp_safe_date(v text) returns date language plpgsql immutable as $$begin if v ~ '^\d{4}-\d{2}-\d{2}$' then return v::date; end if; return null; exception when others then return null; end $$;
insert into public.erp_lots(product_id,number,mfg_date,expiry_date,qc_status,inspection_id)
select h.id_produk,h.no_lot,public.erp_safe_date(c.mfg_date),c.tanggal_expired,case when h.qc_version=1 and h.status='PASS' and h.tgl_uji<=(now() at time zone 'Asia/Jakarta')::date then 'released' when h.status='FAIL' then 'rejected' else 'quarantine' end,h.id
from public.hasil_uji h left join public.coa c on c.id_hasil_uji=h.id on conflict(product_id,number) do nothing;
create table if not exists public.erp_balances(lot_id uuid references public.erp_lots(id),location_id uuid references public.erp_locations(id),quantity numeric(24,6) not null default 0 check(quantity>=0 and quantity<=1000000000000),primary key(lot_id,location_id));
create table if not exists public.erp_movements(id uuid primary key default gen_random_uuid(),number text unique not null,kind text not null check(kind in ('receipt','production','transfer','issue','adjustment','delivery','reversal')),state text not null default 'draft' check(state in ('draft','posted','cancelled','reversed')),date date not null,from_location uuid references public.erp_locations(id),to_location uuid references public.erp_locations(id),reason text not null default '',lines jsonb not null check(jsonb_typeof(lines)='array'),snapshot jsonb,order_id uuid,reverses uuid unique references public.erp_movements(id),version integer not null default 1,created_by uuid not null references public.users(id),posted_by uuid references public.users(id),created_at timestamptz not null default now(),posted_at timestamptz);
create table if not exists public.erp_ledger(id bigint generated always as identity primary key,movement_id uuid not null references public.erp_movements(id),line integer not null,lot_id uuid not null references public.erp_lots(id),location_id uuid not null references public.erp_locations(id),delta numeric(24,6) not null check(delta<>0),created_at timestamptz not null default now(),unique(movement_id,line,location_id));
create index if not exists erp_ledger_lot on public.erp_ledger(lot_id,location_id,id desc);
create index if not exists erp_moves_recent on public.erp_movements(created_at desc,id);
create table if not exists public.erp_counts(id uuid primary key default gen_random_uuid(),number text unique not null,location_id uuid not null references public.erp_locations(id),state text not null default 'draft' check(state in ('draft','counting','submitted','posted','cancelled')),blind boolean not null default true,scheduled_date date not null,assigned_to uuid not null references public.users(id),reason text not null default '',movement_id uuid references public.erp_movements(id),created_at timestamptz not null default now(),started_at timestamptz);
create unique index if not exists erp_location_count on public.erp_counts(location_id) where state in ('counting','submitted');
create table if not exists public.erp_count_lines(count_id uuid references public.erp_counts(id),lot_id uuid references public.erp_lots(id),baseline numeric(24,6) not null check(baseline>=0),counted numeric(24,6) check(counted>=0 and counted<=1000000000000),primary key(count_id,lot_id));
create table if not exists public.erp_quotes(id uuid primary key default gen_random_uuid(),number text unique not null,root_id uuid not null,revision integer not null default 1,previous_id uuid references public.erp_quotes(id),customer_id uuid not null references public.erp_customers(id),date date not null,valid_until date not null,currency text not null default 'IDR' check(currency ~ '^[A-Z]{3}$'),state text not null default 'draft' check(state in ('draft','pending','issued','accepted','rejected','cancelled','superseded')),lines jsonb not null,terms text not null default '',delivery_terms text not null default '',lead_time text not null default '',tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),freight numeric(20,2) not null default 0 check(freight>=0),totals jsonb not null,snapshot jsonb,version integer not null default 1,created_by uuid not null references public.users(id),created_at timestamptz not null default now(),issued_at timestamptz,unique(root_id,revision),check(valid_until>=date));
create unique index if not exists erp_quote_draft_revision on public.erp_quotes(root_id) where state in ('draft','pending');
create table if not exists public.erp_orders(id uuid primary key default gen_random_uuid(),number text unique not null,quote_id uuid unique not null references public.erp_quotes(id),root_id uuid unique not null,state text not null default 'confirmed' check(state in ('confirmed','fulfilled','closed')),customer_reference text not null default '',snapshot jsonb not null,created_at timestamptz not null default now());
create table if not exists public.erp_order_lines(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.erp_orders(id),position integer not null,product_id uuid not null references public.master_produk(id),quantity numeric(24,6) not null,delivered numeric(24,6) not null default 0 check(delivered>=0 and delivered<=quantity),snapshot jsonb not null,unique(order_id,position));
create table if not exists public.erp_reservations(id uuid primary key default gen_random_uuid(),order_line_id uuid not null references public.erp_order_lines(id),lot_id uuid not null references public.erp_lots(id),location_id uuid not null references public.erp_locations(id),quantity numeric(24,6) not null check(quantity>0),remaining numeric(24,6) not null check(remaining>=0 and remaining<=quantity),state text not null default 'active' check(state in ('active','fulfilled','cancelled')),created_at timestamptz not null default now());
create index if not exists erp_reserved_lot on public.erp_reservations(lot_id,location_id) where state='active';
create index if not exists erp_reserved_order on public.erp_reservations(order_line_id);
create index if not exists erp_quotes_recent on public.erp_quotes(created_at desc,id);
create index if not exists erp_orders_recent on public.erp_orders(created_at desc,id);

create or replace function public.erp_actor(p_token text) returns public.users language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; begin
 select us.* into u from public.users us join public.sessions s on s.user_id=us.id where s.token=p_token and s.expires_at>now() and us.is_active and not us.must_change_password;
 if not found then raise insufficient_privilege using message='Session expired.'; end if;
 perform set_config('app.actor',u.nama_lengkap,true); return u;
end $$;
create or replace function public.erp_can(p_user uuid,p_module text,p_verb text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select case when exists(select from public.users where id=p_user and is_active and role in ('admin qc','administrator inbionusa')) then p_verb in ('read','write','approve')
 when exists(select from public.erp_access where user_id=p_user and module=p_module) then coalesce((select case p_verb when 'read' then can_read when 'write' then can_write when 'approve' then can_approve else false end from public.erp_access where user_id=p_user and module=p_module),false)
 else p_module='quality' and exists(select from public.users where id=p_user and is_active and (p_verb='read' or (role='qc supervisor' and p_verb in ('write','approve')))) end
$$;
create or replace function public.erp_assert(p_user uuid,p_module text,p_verb text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare mode text; begin
 select state into mode from public.erp_modules where key=p_module;
 if mode is null or mode='disabled' or not public.erp_can(p_user,p_module,p_verb) then raise insufficient_privilege using message='Module unavailable or access denied.'; end if;
 if p_verb<>'read' and mode<>'active' then raise exception using errcode='P0001',message='This module is read-only.'; end if;
end $$;
create or replace function public.erp_today() returns date language sql stable as $$select (now() at time zone 'Asia/Jakarta')::date$$;
create or replace function public.erp_number(prefix text) returns text language sql volatile set search_path=pg_catalog,public as $$select prefix||'-'||to_char(public.erp_today(),'YYYY')||'-'||lpad(nextval('public.erp_document_seq')::text,7,'0')$$;
create or replace function public.erp_qty(v text,positive boolean default true) returns numeric language plpgsql immutable as $$
declare n numeric; begin
 v:=replace(v,',','.');
 if v is null or v !~ '^\d{1,12}(\.\d{1,6})?$' then raise exception using errcode='P0001',message='Use a valid quantity with at most six decimals.'; end if;
 n:=v::numeric; if n>1000000000 or (positive and n<=0) then raise exception using errcode='P0001',message='Quantity is outside the supported range.'; end if; return n;
end $$;
create or replace function public.erp_reserved(lot uuid,loc uuid) returns numeric language sql stable set search_path=pg_catalog,public as $$select coalesce(sum(remaining),0) from public.erp_reservations where lot_id=lot and location_id=loc and state='active'$$;
create or replace function public.erp_delta(doc uuid,pos integer,lot uuid,loc uuid,qty numeric,count_exempt uuid default null) returns void language plpgsql set search_path=pg_catalog,public as $$
declare balance numeric; begin
 if qty=0 then return; end if;
 if exists(select from public.erp_counts where location_id=loc and state in ('counting','submitted') and id is distinct from count_exempt) then raise exception using errcode='P0001',message='This location is frozen by an active stock count.'; end if;
 insert into public.erp_balances values(lot,loc,0) on conflict do nothing;
 select quantity into balance from public.erp_balances where lot_id=lot and location_id=loc for update;
 if balance+qty<public.erp_reserved(lot,loc) then raise exception using errcode='P0001',message='Insufficient unreserved stock. Release reservations before adjusting or moving it.'; end if;
 update public.erp_balances set quantity=quantity+qty where lot_id=lot and location_id=loc;
 insert into public.erp_ledger(movement_id,line,lot_id,location_id,delta) values(doc,pos,lot,loc,qty);
end $$;
create or replace function public.erp_guard_immutable() returns trigger language plpgsql as $$begin raise exception using errcode='P0001',message='Posted ledger entries are immutable. Use a reversal.'; end $$;
drop trigger if exists erp_immutable on public.erp_ledger;
create trigger erp_immutable before update or delete on public.erp_ledger for each row execute function public.erp_guard_immutable();
create or replace function public.erp_get_lot(e jsonb) returns uuid language plpgsql set search_path=pg_catalog,public as $$
declare l public.erp_lots; product uuid:=(e->>'product_id')::uuid; m date:=nullif(e->>'mfg_date','')::date; begin
 if length(btrim(coalesce(e->>'lot_number',''))) not between 1 and 1000 then raise exception using errcode='P0001',message='Enter a lot number (up to 1000 characters).'; end if;
 if not exists(select from public.erp_product_units where product_id=product and is_base) then raise exception using errcode='P0001',message='Configure the product base unit first.'; end if;
 select * into l from public.erp_lots where product_id=product and number=btrim(e->>'lot_number') for update;
 if found then
  if m is not null and l.mfg_date is not null and m<>l.mfg_date then raise exception using errcode='P0001',message='Manufacturing date conflicts with the existing lot.'; end if;
  if m is not null and l.mfg_date is null then update public.erp_lots set mfg_date=m,expiry_date=coalesce(expiry_date,(m+interval '1 year')::date) where id=l.id; end if;
  return l.id;
 end if;
 insert into public.erp_lots(product_id,number,mfg_date,expiry_date) values(product,btrim(e->>'lot_number'),m,(m+interval '1 year')::date) returning id into l.id; return l.id;
end $$;
create or replace function public.erp_normalize_lines(items jsonb) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare e jsonb; p public.master_produk; unit public.erp_units; base public.erp_units; factor numeric; qty numeric; price numeric; discount numeric; amount numeric; result jsonb:='[]'; begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 100 then raise exception using errcode='P0001',message='Add between 1 and 100 product lines.'; end if;
 for e in select * from jsonb_array_elements(items) loop
  select * into p from public.master_produk where id=(e->>'product_id')::uuid;
  if not found then raise no_data_found; end if;
  select u.*,pu.factor into unit.id,unit.code,unit.name,factor from public.erp_units u join public.erp_product_units pu on pu.unit_id=u.id where pu.product_id=p.id and u.id=(e->>'unit_id')::uuid;
  if not found then raise exception using errcode='P0001',message='Configure this product unit conversion first.'; end if;
  select u.* into base from public.erp_units u join public.erp_product_units pu on pu.unit_id=u.id where pu.product_id=p.id and pu.is_base;
  if not found then raise exception using errcode='P0001',message='Configure the product base unit first.'; end if;
  qty:=public.erp_qty(e->>'quantity'); price:=public.erp_qty(coalesce(e->>'price','0'),false); discount:=public.erp_qty(coalesce(e->>'discount','0'),false);
  if discount>100 or round(qty*factor,6)<=0 or qty*factor>1000000000000 then raise exception using errcode='P0001',message='Invalid discount or converted quantity.'; end if;
  amount:=round(qty*price*(1-discount/100),2); if amount>1000000000000 then raise exception using errcode='P0001',message='Line amount exceeds the supported limit.'; end if;
  result:=result||jsonb_build_array(jsonb_build_object('product_id',p.id,'product',p.nama_produk,'code',p.kode_produk,'unit_id',unit.id,'unit',unit.code,'base_unit',base.code,'factor',factor::text,'quantity',qty::text,'base_quantity',(round(qty*factor,6))::text,'price',price::text,'discount',discount::text,'amount',amount::text));
 end loop; return result;
end $$;

create or replace function public.erp_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
<<v>>
declare u public.users; target uuid; result uuid; module text; e jsonb; line jsonb; lines jsonb:='[]'; snap jsonb; qty numeric; factor numeric; amount numeric; subtotal numeric; tax numeric; freight numeric;
 m public.erp_movements; original public.erp_movements; lot public.erp_lots; c public.erp_counts; q public.erp_quotes; oldq public.erp_quotes; o public.erp_orders; ol public.erp_order_lines; r public.erp_reservations; customer public.erp_customers; unit public.erp_units; p public.master_produk; loc uuid; pos integer; rec record; why text; state text; base uuid; root uuid; count_qty numeric;
begin
 if octet_length(p_payload::text)>262144 then raise exception using errcode='P0001',message='Request too large.'; end if;
 -- One short transaction lock serializes stock, reservation, QC release and configuration changes.
 -- This is intentional for a single warehouse; all checks run again after acquiring it.
 perform pg_advisory_xact_lock(49281041);
 u:=public.erp_actor(p_token); target:=nullif(p_payload->>'id','')::uuid; why:=btrim(coalesce(p_payload->>'reason',''));
 if p_action in ('set_module','set_access','save_unit','save_location','save_conversion') then
  if u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  if p_action='set_module' then
   module:=p_payload->>'module'; state:=p_payload->>'state';
   if state not in ('active','read_only','disabled') or not exists(select from public.erp_modules where key=module) then raise check_violation; end if;
   if module='production' and state='active' and not exists(select from public.erp_modules where key='warehouse' and state='active') then raise exception using errcode='P0001',message='Activate Warehouse before Production.'; end if;
   if state='disabled' then
    if module='warehouse' and (exists(select from public.erp_modules where key='production' and state='active') or exists(select from public.erp_counts where state in ('draft','counting','submitted')) or exists(select from public.erp_movements where state='draft') or exists(select from public.erp_reservations where state='active' and remaining>0)) then raise exception using errcode='P0001',message='Resolve open movements, counts and reservations; deactivate Production first. Use read-only to pause work.'; end if;
    if module='production' and exists(select from public.erp_movements where kind='production' and state='draft') then raise exception using errcode='P0001',message='Resolve draft production records or use read-only.'; end if;
    if module='sales' and (exists(select from public.erp_orders where state='confirmed') or exists(select from public.erp_quotes z where state in ('issued','pending') or (state='accepted' and not exists(select from public.erp_orders where quote_id=z.id)))) then raise exception using errcode='P0001',message='Resolve open quotations and orders or use read-only.'; end if;
    if module='quality' and exists(select from public.inspection_drafts) then raise exception using errcode='P0001',message='Resolve inspection drafts or use read-only.'; end if;
   end if;
   if module='quality' and state='active' and exists(select from public.erp_modules where key='quality' and state='disabled') then update public.erp_lots set qc_status='quarantine' where qc_status='released' and not exists(select from public.hasil_uji h where h.id=erp_lots.inspection_id and h.qc_version=1 and h.status='PASS' and h.tgl_uji<=public.erp_today()); end if;
   update public.erp_modules set state=p_payload->>'state' where key=module;
  elsif p_action='set_access' then
   insert into public.erp_access(user_id,module,can_read,can_write,can_approve) values((p_payload->>'user_id')::uuid,p_payload->>'module',(p_payload->>'read')::boolean,(p_payload->>'write')::boolean,(p_payload->>'approve')::boolean) on conflict(user_id,module) do update set can_read=excluded.can_read,can_write=excluded.can_write,can_approve=excluded.can_approve;
  elsif p_action='save_unit' then
   insert into public.erp_units(code,name) values(btrim(p_payload->>'code'),btrim(p_payload->>'name')) returning id into result;
  elsif p_action='save_location' then
   insert into public.erp_locations(code,name) values(btrim(p_payload->>'code'),btrim(p_payload->>'name')) returning id into result;
  else
   base:=(p_payload->>'unit_id')::uuid; target:=(p_payload->>'product_id')::uuid; factor:=public.erp_qty(p_payload->>'factor');
   if coalesce((p_payload->>'is_base')::boolean,false) then
    if factor<>1 then raise exception using errcode='P0001',message='The base unit factor must be one.'; end if;
    if exists(select from public.erp_product_units where product_id=target and is_base and unit_id<>base) then
     if exists(select from public.erp_lots l join public.erp_ledger g on g.lot_id=l.id where l.product_id=target) or exists(select from public.erp_quotes z,jsonb_array_elements(z.lines) x where (x->>'product_id')::uuid=target) or exists(select from public.erp_movements z,jsonb_array_elements(z.lines) x where (x->>'product_id')::uuid=target) then raise exception using errcode='P0001',message='The base unit cannot change after a transaction references this product.'; end if;
     delete from public.erp_product_units where product_id=target;
    end if;
   elsif not exists(select from public.erp_product_units where product_id=target and is_base) then raise exception using errcode='P0001',message='Set a base unit first.';
   end if;
   if exists(select from public.erp_product_units where product_id=target and unit_id=base and is_base and v.factor<>1) then raise check_violation; end if;
   insert into public.erp_product_units values(target,base,factor,coalesce((p_payload->>'is_base')::boolean,false)) on conflict(product_id,unit_id) do update set factor=excluded.factor,is_base=public.erp_product_units.is_base or excluded.is_base;
  end if;
 elsif p_action='save_customer' then
  perform public.erp_assert(u.id,'sales','write');
  if target is null then insert into public.erp_customers(name) values(btrim(p_payload->>'name')) returning id into target; end if;
  update public.erp_customers set name=btrim(p_payload->>'name'),contact=coalesce(p_payload->>'contact',''),email=coalesce(p_payload->>'email',''),phone=coalesce(p_payload->>'phone',''),tax_id=coalesce(p_payload->>'tax_id',''),billing_address=coalesce(p_payload->>'billing_address',''),shipping_address=coalesce(p_payload->>'shipping_address',''),payment_terms=coalesce(p_payload->>'payment_terms',''),updated_at=now() where id=target;
  if not found then raise no_data_found; end if; result:=target;
 elsif p_action in ('save_move','post_move','cancel_move','reverse_move') then
  if p_action='save_move' then
   module:=case when p_payload->>'kind'='production' then 'production' else 'warehouse' end;
   perform public.erp_assert(u.id,module,'write'); if module<>'production' then perform public.erp_assert(u.id,'warehouse','write'); elsif not exists(select from public.erp_modules where key='warehouse' and state='active') then raise exception using errcode='P0001',message='Warehouse must be active.'; end if;
   if p_payload->>'kind' not in ('production','receipt','transfer','issue') then raise check_violation; end if;
   if target is not null then
    select * into m from public.erp_movements where id=target for update;
    if not found then raise no_data_found; end if;
    if m.state<>'draft' or m.kind<>p_payload->>'kind' or m.version<>(p_payload->>'version')::integer then raise exception using errcode='P0001',message='This movement changed. Reload before editing.'; end if;
   end if;
   if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise check_violation; end if;
   for e in select * from jsonb_array_elements(p_payload->'lines') loop
    if p_payload->>'kind' in ('receipt','production') then
     if nullif(e->>'mfg_date','') is null or (e->>'mfg_date')::date>public.erp_today() then raise exception using errcode='P0001',message='Enter a manufacturing date no later than today.'; end if;
     loc:=public.erp_get_lot(e);
    else loc:=(e->>'lot_id')::uuid;
    end if;
    select * into lot from public.erp_lots where id=loc; if not found then raise no_data_found; end if;
    select pu.factor,uom.* into factor,unit.id,unit.code,unit.name from public.erp_product_units pu join public.erp_units uom on uom.id=pu.unit_id where pu.product_id=lot.product_id and pu.unit_id=(e->>'unit_id')::uuid;
    if not found then raise exception using errcode='P0001',message='Configure this product unit conversion first.'; end if;
    qty:=round(public.erp_qty(e->>'quantity')*factor,6); if qty<=0 then raise exception using errcode='P0001',message='Converted quantity is below stock precision.'; end if; if qty>1000000000000 then raise check_violation; end if;
    select * into p from public.master_produk where id=lot.product_id;
    lines:=lines||jsonb_build_array(jsonb_build_object('product_id',p.id,'lot_id',lot.id,'product',p.nama_produk,'code',p.kode_produk,'lot',lot.number,'mfg_date',lot.mfg_date,'unit',unit.code,'unit_id',unit.id,'quantity',public.erp_qty(e->>'quantity')::text,'factor',factor::text,'base_quantity',qty::text,'base_unit',(select um.code from public.erp_product_units pu join public.erp_units um on um.id=pu.unit_id where pu.product_id=p.id and pu.is_base)));
   end loop;
   if p_payload->>'kind' in ('transfer','issue') and nullif(p_payload->>'from_location','') is null then raise check_violation; end if;
   if p_payload->>'kind' in ('production','receipt','transfer') and nullif(p_payload->>'to_location','') is null then raise check_violation; end if;
   if p_payload->>'kind'='transfer' and p_payload->>'from_location'=p_payload->>'to_location' then raise exception using errcode='P0001',message='Choose two different locations.'; end if;
   if why='' then raise exception using errcode='P0001',message='Enter a reference or reason.'; end if;
   if target is null then
    insert into public.erp_movements(number,kind,date,from_location,to_location,reason,lines,created_by) values(public.erp_number(case when module='production' then 'PRD' else 'MOV' end),p_payload->>'kind',(p_payload->>'date')::date,case when p_payload->>'kind' in ('transfer','issue') then (p_payload->>'from_location')::uuid end,case when p_payload->>'kind' in ('production','receipt','transfer') then (p_payload->>'to_location')::uuid end,why,lines,u.id) returning id into result;
   else update public.erp_movements set date=(p_payload->>'date')::date,from_location=case when m.kind in ('transfer','issue') then nullif(p_payload->>'from_location','')::uuid end,to_location=case when m.kind in ('production','receipt','transfer') then nullif(p_payload->>'to_location','')::uuid end,reason=why,lines=v.lines,version=version+1 where id=target returning id into result;
   end if;
  else
   select * into m from public.erp_movements where id=target for update; if not found then raise no_data_found; end if;
   module:=case when m.kind='production' then 'production' else 'warehouse' end;
   perform public.erp_assert(u.id,module,case when p_action='reverse_move' then 'approve' else 'write' end);
   if module<>'production' then perform public.erp_assert(u.id,'warehouse',case when p_action='reverse_move' then 'approve' else 'write' end); elsif not exists(select from public.erp_modules where key='warehouse' and state='active') then raise exception using errcode='P0001',message='Warehouse must be active.'; end if;
   if p_action='cancel_move' then
    if m.state<>'draft' or why='' then raise exception using errcode='P0001',message='Only a draft can be cancelled. Enter a reason.'; end if;
    update public.erp_movements set state='cancelled',reason=reason||E'\nCancelled: '||why,version=version+1 where id=target;
   elsif p_action='reverse_move' then
    if m.state<>'posted' or why='' then raise exception using errcode='P0001',message='Only a posted movement can be reversed. Enter a reason.'; end if;
    if m.kind='reversal' then raise exception using errcode='P0001',message='A reversal cannot be reversed. Create a new documented movement.'; end if;
    if m.kind='delivery' then perform public.erp_assert(u.id,'sales','approve'); end if;
    insert into public.erp_movements(number,kind,state,date,reason,lines,reverses,created_by,posted_by,posted_at,order_id,snapshot) values(public.erp_number('REV'),'reversal','posted',public.erp_today(),why,m.lines,m.id,u.id,u.id,now(),m.order_id,m.snapshot) returning id into result;
    update public.erp_movements rev set from_location=m.to_location,to_location=m.from_location,snapshot=jsonb_build_object('number',rev.number,'kind','reversal','date',public.erp_today(),'reason',why||' (Reverses '||m.number||')','lines',m.lines,'from_location',(select name from public.erp_locations where id=m.to_location),'to_location',(select name from public.erp_locations where id=m.from_location),'posted_by',u.nama_lengkap) where rev.id=result;
    for rec in select * from public.erp_ledger where movement_id=m.id order by id desc loop perform public.erp_delta(result,rec.line,rec.lot_id,rec.location_id,-rec.delta); end loop;
    if m.kind='delivery' then
     for e in select * from jsonb_array_elements(m.lines) loop update public.erp_order_lines set delivered=delivered-(e->>'base_quantity')::numeric where id=(e->>'order_line_id')::uuid; end loop;
     update public.erp_orders set state='confirmed' where id=m.order_id;
    end if;
    update public.erp_movements set state='reversed',version=version+1 where id=m.id;
   else
    if m.state='posted' then return jsonb_build_object('id',m.id); end if;
    if m.state<>'draft' then raise exception using errcode='P0001',message='Only draft movements can be posted.'; end if;
    if p_payload ? 'version' and m.version<>(p_payload->>'version')::integer then raise exception using errcode='P0001',message='This draft changed after review. Reload before posting.'; end if;
    if m.date>public.erp_today() then raise exception using errcode='P0001',message='Future movements cannot be posted.'; end if;
    if m.kind='delivery' then
     if not exists(select from public.erp_modules where key='sales' and state='active') then raise exception using errcode='P0001',message='Sales must be active to post deliveries.'; end if;
     select * into o from public.erp_orders where id=m.order_id for update;
     if o.state<>'confirmed' then raise exception using errcode='P0001',message='The order is no longer open.'; end if;
    end if;
    pos:=0; lines:='[]';
    for e in select * from jsonb_array_elements(m.lines) loop
     pos:=pos+1; qty:=(e->>'base_quantity')::numeric;
     select * into lot from public.erp_lots where id=(e->>'lot_id')::uuid for update;
     if lot.mfg_date is not null and m.date<lot.mfg_date then raise exception using errcode='P0001',message='Movement date cannot be before manufacturing.'; end if;
     if m.kind='delivery' then
      if lot.qc_status<>'released' or lot.expiry_date is null or lot.expiry_date<public.erp_today() then raise exception using errcode='P0001',message='Only released, unexpired lots can be shipped.'; end if;
      select * into r from public.erp_reservations where id=(e->>'reservation_id')::uuid for update;
      if r.state<>'active' or r.remaining<qty then raise exception using errcode='P0001',message='The reservation changed. Recreate this delivery.'; end if;
      if not exists(select from public.erp_order_lines where id=r.order_line_id and order_id=o.id and delivered+qty<=quantity) then raise check_violation; end if;
      update public.erp_reservations set remaining=remaining-qty,state=case when remaining=qty then 'fulfilled' else 'active' end where id=r.id;
      update public.erp_order_lines set delivered=delivered+qty where id=r.order_line_id;
      snap:=null;
      if exists(select from public.erp_modules where key='quality' and state<>'disabled') then
       select to_jsonb(coa) into snap from public.coa where id_hasil_uji=lot.inspection_id;
       if snap is null or (snap->>'tanggal_expired')::date<>lot.expiry_date or nullif(snap->>'mfg_date','')::date is distinct from lot.mfg_date then raise exception using errcode='P0001',message='Issue a COA with matching lot dates before shipping.'; end if;
      end if;
      if snap is not null and (snap->>'tanggal_rilis')::date>m.date then raise exception using errcode='P0001',message='The COA release date is after the delivery date.'; end if;
      e:=e||jsonb_build_object('coa',snap);
     end if;
     if m.from_location is not null then perform public.erp_delta(m.id,pos,lot.id,m.from_location,-qty); end if;
     if m.to_location is not null then perform public.erp_delta(m.id,pos,lot.id,m.to_location,qty); end if;
     lines:=lines||jsonb_build_array(e);
    end loop;
    snap:=jsonb_build_object('number',m.number,'date',m.date,'kind',m.kind,'reason',m.reason,'lines',lines,'from_location',(select name from public.erp_locations where id=m.from_location),'to_location',(select name from public.erp_locations where id=m.to_location),'customer',o.snapshot->'customer','order_number',o.number,'posted_by',u.nama_lengkap);
    update public.erp_movements set state='posted',posted_by=u.id,posted_at=now(),version=version+1,lines=v.lines,snapshot=snap where id=m.id;
    if m.kind='delivery' then update public.erp_orders set state=case when not exists(select from public.erp_order_lines where order_id=o.id and delivered<quantity) then 'fulfilled' else 'confirmed' end where id=o.id; end if;
   end if; result:=coalesce(result,target);
  end if;
 elsif p_action='release_lot' then
  perform public.erp_assert(u.id,'warehouse','approve');
  if exists(select from public.erp_modules where key='quality' and state<>'disabled') then raise exception using errcode='P0001',message='Use a validated QC inspection to release this lot.'; end if;
  if why='' then raise exception using errcode='P0001',message='A manual release reason is required.'; end if;
  update public.erp_lots set qc_status=case when (p_payload->>'release')::boolean then 'released' else 'quarantine' end where id=target; if not found then raise no_data_found; end if; result:=target;
 elsif p_action in ('create_count','assign_count','start_count','count_line','count_add_lot','submit_count','approve_count','cancel_count') then
  perform public.erp_assert(u.id,'warehouse',case when p_action in ('approve_count','assign_count') then 'approve' else 'write' end);
  if p_action='create_count' then
   insert into public.erp_counts(number,location_id,blind,scheduled_date,assigned_to,reason) values(public.erp_number('CNT'),(p_payload->>'location_id')::uuid,coalesce((p_payload->>'blind')::boolean,true),(p_payload->>'scheduled_date')::date,u.id,why) returning id into result;
  else
   select * into c from public.erp_counts where id=target for update; if not found then raise no_data_found; end if;
   if c.assigned_to<>u.id and not public.erp_can(u.id,'warehouse','approve') then raise insufficient_privilege; end if;
   if p_action='assign_count' then
    if c.state<>'draft' or not exists(select from public.users where id=(p_payload->>'user_id')::uuid and is_active) or not public.erp_can((p_payload->>'user_id')::uuid,'warehouse','write') then raise exception using errcode='P0001',message='Assign an active warehouse operator before starting the count.'; end if;
    update public.erp_counts set assigned_to=(p_payload->>'user_id')::uuid where id=c.id;
   elsif p_action='start_count' then
    if c.state<>'draft' then raise exception using errcode='P0001',message='Only a planned count can be started.'; end if;
    if exists(select from public.erp_counts where location_id=c.location_id and state in ('counting','submitted')) then raise exception using errcode='P0001',message='This location already has an active stock count.'; end if;
    insert into public.erp_count_lines select c.id,b.lot_id,b.quantity,null from public.erp_balances b where b.location_id=c.location_id;
    update public.erp_counts set state='counting',started_at=now() where id=c.id;
   elsif p_action='count_line' then
    if c.state<>'counting' then raise exception using errcode='P0001',message='This count is not open for entry.'; end if;
    update public.erp_count_lines set counted=public.erp_qty(p_payload->>'quantity',false) where count_id=c.id and lot_id=(p_payload->>'lot_id')::uuid; if not found then raise no_data_found; end if;
   elsif p_action='count_add_lot' then
    if c.state<>'counting' then raise exception using errcode='P0001',message='This count is not open for entry.'; end if;
    loc:=public.erp_get_lot(p_payload);
    insert into public.erp_count_lines values(c.id,loc,coalesce((select quantity from public.erp_balances where lot_id=loc and location_id=c.location_id),0),null);
   elsif p_action='submit_count' then
    if c.state<>'counting' or not exists(select from public.erp_count_lines where count_id=c.id) or exists(select from public.erp_count_lines where count_id=c.id and counted is null) then raise exception using errcode='P0001',message='Enter every count, including zero, before submitting.'; end if;
    update public.erp_counts set state='submitted' where id=c.id;
   elsif p_action='approve_count' then
    if c.state<>'submitted' or why='' then raise exception using errcode='P0001',message='Submit the count and enter an approval reason.'; end if;
    insert into public.erp_movements(number,kind,state,date,reason,lines,created_by,posted_by,posted_at) values(public.erp_number('ADJ'),'adjustment','posted',public.erp_today(),why,'[]',c.assigned_to,u.id,now()) returning id into result;
    pos:=0;
    for rec in select cl.*,l.product_id,l.number,p.nama_produk,um.code from public.erp_count_lines cl join public.erp_lots l on l.id=cl.lot_id join public.master_produk p on p.id=l.product_id join public.erp_product_units pu on pu.product_id=p.id and pu.is_base join public.erp_units um on um.id=pu.unit_id where cl.count_id=c.id order by cl.lot_id loop
     if coalesce((select quantity from public.erp_balances where lot_id=rec.lot_id and location_id=c.location_id),0)<>rec.baseline then raise exception using errcode='P0001',message='Stock changed since the count started. Cancel and recount.'; end if;
     pos:=pos+1; qty:=rec.counted-rec.baseline; perform public.erp_delta(result,pos,rec.lot_id,c.location_id,qty,c.id);
     lines:=lines||jsonb_build_array(jsonb_build_object('lot_id',rec.lot_id,'lot',rec.number,'product',rec.nama_produk,'base_quantity',qty::text,'base_unit',rec.code));
    end loop;
    update public.erp_movements set lines=v.lines,snapshot=jsonb_build_object('number',number,'date',date,'kind','adjustment','reason',why,'lines',v.lines,'count',c.number,'posted_by',u.nama_lengkap) where id=result;
    update public.erp_counts set state='posted',movement_id=result,reason=reason||E'\nApproved: '||why where id=c.id;
   else
    if c.state not in ('draft','counting','submitted') or why='' then raise exception using errcode='P0001',message='Only an open count can be cancelled. Enter a reason.'; end if;
    update public.erp_counts set state='cancelled',reason=reason||E'\nCancelled: '||why where id=c.id;
   end if; result:=coalesce(result,target);
  end if;
 elsif p_action in ('save_quote','issue_quote','approve_quote','return_quote','accept_quote','reject_quote','cancel_quote','revise_quote','convert_quote') then
  perform public.erp_assert(u.id,'sales',case when p_action in ('approve_quote','return_quote') then 'approve' else 'write' end);
  if p_action='save_quote' then
   if target is not null then
    select * into q from public.erp_quotes where id=target for update;
    if not found then raise no_data_found; end if;
    if q.state<>'draft' or q.version<>(p_payload->>'version')::integer then raise exception using errcode='P0001',message='This quotation changed. Reload before editing.'; end if;
   end if;
   lines:=public.erp_normalize_lines(p_payload->'lines');
   select sum((x->>'amount')::numeric) into subtotal from jsonb_array_elements(lines) x;
   tax:=round(public.erp_qty(coalesce(p_payload->>'tax_rate','0'),false),4); freight:=round(public.erp_qty(coalesce(p_payload->>'freight','0'),false),2);
   if tax>100 or subtotal+round(subtotal*tax/100,2)+freight>1000000000000 then raise check_violation; end if;
   snap:=jsonb_build_object('subtotal',subtotal::text,'tax',round(subtotal*tax/100,2)::text,'freight',freight::text,'total',(subtotal+round(subtotal*tax/100,2)+freight)::text);
   if target is null then
    target:=gen_random_uuid();
    insert into public.erp_quotes(id,root_id,number,customer_id,date,valid_until,currency,lines,terms,delivery_terms,lead_time,tax_rate,freight,totals,created_by) values(target,target,public.erp_number('QUO'),(p_payload->>'customer_id')::uuid,(p_payload->>'date')::date,(p_payload->>'valid_until')::date,p_payload->>'currency',lines,coalesce(p_payload->>'terms',''),coalesce(p_payload->>'delivery_terms',''),coalesce(p_payload->>'lead_time',''),tax,freight,snap,u.id);
   else update public.erp_quotes set customer_id=(p_payload->>'customer_id')::uuid,date=(p_payload->>'date')::date,valid_until=(p_payload->>'valid_until')::date,currency=p_payload->>'currency',lines=v.lines,terms=coalesce(p_payload->>'terms',''),delivery_terms=coalesce(p_payload->>'delivery_terms',''),lead_time=coalesce(p_payload->>'lead_time',''),tax_rate=tax,freight=v.freight,totals=snap,snapshot=null,version=version+1 where id=target;
   end if; result:=target;
  else
   select * into q from public.erp_quotes where id=target for update; if not found then raise no_data_found; end if;
   if p_action in ('issue_quote','approve_quote') then
    if p_payload ? 'version' and q.version<>(p_payload->>'version')::integer then raise exception using errcode='P0001',message='This quotation changed after review. Reload before issuance.'; end if;
    if (p_action='issue_quote' and q.state<>'draft') or (p_action='approve_quote' and q.state<>'pending') then raise exception using errcode='P0001',message='This quotation is not ready for this action.'; end if;
    if q.valid_until<public.erp_today() then raise exception using errcode='P0001',message='Revise the quotation validity date before issuance.'; end if;
    if exists(select from public.erp_orders where root_id=q.root_id) or exists(select from public.erp_quotes where root_id=q.root_id and state='accepted') then raise exception using errcode='P0001',message='This quotation family already has an accepted order.'; end if;
    select * into customer from public.erp_customers where id=q.customer_id;
    snap:=jsonb_build_object('number',q.number,'revision',q.revision,'customer',to_jsonb(customer),'date',q.date,'valid_until',q.valid_until,'currency',q.currency,'lines',q.lines,'terms',q.terms,'delivery_terms',q.delivery_terms,'lead_time',q.lead_time,'tax_rate',q.tax_rate::text,'totals',q.totals,'issuer',u.nama_lengkap);
    if p_action='issue_quote' and exists(select from jsonb_array_elements(q.lines) x where (x->>'discount')::numeric>10) then
     update public.erp_quotes set state='pending',snapshot=snap,version=version+1 where id=q.id;
    else
     if p_action='approve_quote' and why='' then raise exception using errcode='P0001',message='Enter an approval reason for this discount.'; end if;
     update public.erp_quotes set state='superseded',version=version+1 where root_id=q.root_id and state='issued';
     update public.erp_quotes set state='issued',snapshot=snap,issued_at=now(),version=version+1 where id=q.id;
    end if;
   elsif p_action='return_quote' then
    if q.state<>'pending' or why='' then raise exception using errcode='P0001',message='Enter a reason to return this pending quotation.'; end if;
    update public.erp_quotes set state='draft',snapshot=null,version=version+1 where id=q.id;
   elsif p_action in ('accept_quote','reject_quote') then
    if q.state<>'issued' or q.valid_until<public.erp_today() then raise exception using errcode='P0001',message='Only a current issued quotation can be accepted or rejected.'; end if;
    update public.erp_quotes set state=case when p_action='accept_quote' then 'accepted' else 'rejected' end,version=version+1 where id=q.id;
   elsif p_action='cancel_quote' then
    if q.state not in ('draft','pending','issued') or why='' then raise exception using errcode='P0001',message='Only an unaccepted quotation can be cancelled. Enter a reason.'; end if;
    update public.erp_quotes set state='cancelled',version=version+1 where id=q.id;
   elsif p_action='revise_quote' then
    if q.state not in ('issued','rejected','superseded') or exists(select from public.erp_orders where root_id=q.root_id) or exists(select from public.erp_quotes where root_id=q.root_id and state='accepted') then raise exception using errcode='P0001',message='This quotation cannot be revised after acceptance.'; end if;
    pos:=(select max(revision)+1 from public.erp_quotes where root_id=q.root_id);
    insert into public.erp_quotes(number,root_id,revision,previous_id,customer_id,date,valid_until,currency,lines,terms,delivery_terms,lead_time,tax_rate,freight,totals,created_by)
     values(public.erp_number('QUO'),q.root_id,pos,q.id,q.customer_id,public.erp_today(),public.erp_today()+30,q.currency,q.lines,q.terms,q.delivery_terms,q.lead_time,q.tax_rate,q.freight,q.totals,u.id) returning id into result;
   else
    if q.state<>'accepted' then raise exception using errcode='P0001',message='Accept the quotation before creating a sales order.'; end if;
    if exists(select from public.erp_orders where quote_id=q.id) then select id into result from public.erp_orders where quote_id=q.id; return jsonb_build_object('id',result,'entity','orders'); end if;
    insert into public.erp_orders(number,quote_id,root_id,snapshot,customer_reference) values(public.erp_number('SO'),q.id,q.root_id,q.snapshot,coalesce(p_payload->>'customer_reference','')) returning id into result;
    pos:=0; for e in select * from jsonb_array_elements(q.lines) loop pos:=pos+1; insert into public.erp_order_lines(order_id,position,product_id,quantity,snapshot) values(result,pos,(e->>'product_id')::uuid,(e->>'base_quantity')::numeric,e); end loop;
   end if; result:=coalesce(result,target);
  end if;
 elsif p_action in ('reserve','unreserve','close_order','create_delivery') then
  if p_action<>'create_delivery' then perform public.erp_assert(u.id,'sales','write'); elsif not exists(select from public.erp_modules where key='sales' and state='active') then raise exception using errcode='P0001',message='Sales must be active to create deliveries.'; end if;
  if p_action='reserve' then
   perform public.erp_assert(u.id,'warehouse','read');
   select * into ol from public.erp_order_lines where id=(p_payload->>'order_line_id')::uuid for update;
   select * into o from public.erp_orders where id=ol.order_id for update;
   if o.state is distinct from 'confirmed' then raise exception using errcode='P0001',message='This sales order is not open.'; end if;
   if not exists(select from public.erp_modules where key='warehouse' and state='active') then raise exception using errcode='P0001',message='Warehouse must be active to reserve stock.'; end if;
   select * into lot from public.erp_lots where id=(p_payload->>'lot_id')::uuid;
   if lot.product_id is distinct from ol.product_id or lot.qc_status<>'released' or lot.expiry_date is null or lot.expiry_date<public.erp_today() then raise exception using errcode='P0001',message='Choose a released, unexpired lot of this product.'; end if;
   qty:=public.erp_qty(p_payload->>'quantity'); loc:=(p_payload->>'location_id')::uuid;
   if qty>ol.quantity-ol.delivered-coalesce((select sum(remaining) from public.erp_reservations where order_line_id=ol.id and state='active'),0) then raise exception using errcode='P0001',message='Reservation exceeds the outstanding order quantity.'; end if;
   if qty>coalesce((select quantity from public.erp_balances where lot_id=lot.id and location_id=loc),0)-public.erp_reserved(lot.id,loc) then raise exception using errcode='P0001',message='Insufficient available stock.'; end if;
   insert into public.erp_reservations(order_line_id,lot_id,location_id,quantity,remaining) values(ol.id,lot.id,loc,qty,qty) returning id into result;
  elsif p_action='unreserve' then
   select * into r from public.erp_reservations where id=target for update;
   if r.state is distinct from 'active' or why='' then raise exception using errcode='P0001',message='Choose an active reservation and enter a reason.'; end if;
   update public.erp_reservations set remaining=0,state='cancelled' where id=target; result:=target;
  elsif p_action='close_order' then
   select * into o from public.erp_orders where id=target for update;
   if o.state is distinct from 'confirmed' or why='' then raise exception using errcode='P0001',message='Choose an open order and enter a closing reason.'; end if;
   update public.erp_reservations set remaining=0,state='cancelled' where order_line_id in(select id from public.erp_order_lines where order_id=o.id) and state='active';
   update public.erp_orders set state='closed' where id=o.id; result:=target;
  else
   perform public.erp_assert(u.id,'warehouse','write');
   select * into o from public.erp_orders where id=(p_payload->>'order_id')::uuid for update;
   if o.state is distinct from 'confirmed' then raise exception using errcode='P0001',message='Choose an open sales order.'; end if;
   if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise check_violation; end if;
   for e in select * from jsonb_array_elements(p_payload->'lines') loop
    select * into r from public.erp_reservations where id=(e->>'reservation_id')::uuid;
    select * into ol from public.erp_order_lines where id=r.order_line_id;
    if ol.order_id is distinct from o.id or r.state<>'active' then raise check_violation; end if;
    qty:=public.erp_qty(e->>'quantity');
    if qty>r.remaining then raise exception using errcode='P0001',message='Delivery exceeds the reservation.'; end if;
    if loc is not null and loc<>r.location_id then raise exception using errcode='P0001',message='Create a separate delivery for each source location.'; end if; loc:=r.location_id;
    select * into lot from public.erp_lots where id=r.lot_id;
    lines:=lines||jsonb_build_array(jsonb_build_object('reservation_id',r.id,'order_line_id',ol.id,'product_id',lot.product_id,'product',ol.snapshot->>'product','code',ol.snapshot->>'code','lot_id',lot.id,'lot',lot.number,'base_quantity',qty::text,'base_unit',ol.snapshot->>'base_unit','quantity',qty::text,'unit',ol.snapshot->>'base_unit'));
   end loop;
   if (select count(distinct x->>'reservation_id') from jsonb_array_elements(lines) x)<>jsonb_array_length(lines) then raise exception using errcode='P0001',message='A reservation can appear only once in a delivery.'; end if;
   insert into public.erp_movements(number,kind,date,from_location,reason,lines,order_id,created_by) values(public.erp_number('DO'),'delivery',public.erp_today(),loc,why,lines,o.id,u.id) returning id into result;
  end if;
 else raise exception using errcode='P0001',message='Unknown operation.';
 end if;
 insert into public.audit_log(user_name,aksi,referensi,after_data) values(u.nama_lengkap,'erp_'||p_action,coalesce(result::text,target::text,p_payload->>'module','configuration'),jsonb_build_object('request',p_payload,'result',result));
 return jsonb_build_object('id',result,'entity',case when p_action='convert_quote' then 'orders' when p_action='create_delivery' then 'movements' when p_action='revise_quote' then 'quotes' else null end);
end $$;

create or replace view public.erp_stock_view as
select b.lot_id::text||':'||b.location_id::text id,l.product_id,l.number lot_number,l.id lot_id,l.mfg_date,l.expiry_date,l.qc_status,b.location_id,loc.name location,p.kode_produk code,p.nama_produk product,u.code unit,b.quantity::text on_hand,public.erp_reserved(l.id,b.location_id)::text reserved,
 (case when l.qc_status='released' and l.expiry_date>=public.erp_today() then greatest(0,b.quantity-public.erp_reserved(l.id,b.location_id)) else 0 end)::text available,
 p.kode_produk||' '||p.nama_produk||' '||l.number||' '||loc.name search,l.qc_status state,coalesce(l.expiry_date::text,'9999-12-31') sort
from public.erp_balances b join public.erp_lots l on l.id=b.lot_id join public.erp_locations loc on loc.id=b.location_id join public.master_produk p on p.id=l.product_id join public.erp_product_units pu on pu.product_id=p.id and pu.is_base join public.erp_units u on u.id=pu.unit_id;

create or replace function public.erp_read(p_token text,p_entity text,p_search text default '',p_state text default '',p_page integer default 1,p_id text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; source text; rows jsonb; total bigint; result jsonb; target uuid; module text;
begin
 u:=public.erp_actor(p_token);
 if length(p_search)>100 or p_page<1 or p_page>1000000 or length(coalesce(p_id,''))>100 then raise check_violation; end if;
 if p_entity='context' then
  return jsonb_build_object('modules',(select jsonb_agg(jsonb_build_object('key',key,'state',state,'read',public.erp_can(u.id,key,'read'),'write',public.erp_can(u.id,key,'write'),'approve',public.erp_can(u.id,key,'approve')) order by key) from public.erp_modules),'admin',u.role in ('admin qc','administrator inbionusa'));
 end if;
 module:=case when p_entity in ('stock','availability','count_lines','counters','lots','movements','counts','ledger','fulfillment') then 'warehouse' when p_entity='production' then 'production' when p_entity in ('quotes','orders','customers') then 'sales' end;
 if module is not null then perform public.erp_assert(u.id,module,'read'); end if;
 if p_entity='counters' and not public.erp_can(u.id,'warehouse','approve') then raise insufficient_privilege; end if;
 if p_entity in ('access','users') and u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
 source:=case p_entity
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
 when 'lots' then $s$select l.*,p.kode_produk code,p.nama_produk product,u.code unit,l.qc_status state,l.number||' '||p.nama_produk||' '||p.kode_produk search,l.created_at::text sort from public.erp_lots l join public.master_produk p on p.id=l.product_id left join public.erp_product_units pu on pu.product_id=p.id and pu.is_base left join public.erp_units u on u.id=pu.unit_id$s$
 when 'movements' then $s$select m.*,coalesce(f.name,'—') source,coalesce(t.name,'—') destination,m.number||' '||m.reason||' '||m.lines::text search,m.created_at::text sort from public.erp_movements m left join public.erp_locations f on f.id=m.from_location left join public.erp_locations t on t.id=m.to_location$s$
 when 'production' then $s$select m.*,coalesce(t.name,'—') destination,m.number||' '||m.reason||' '||m.lines::text search,m.created_at::text sort from public.erp_movements m left join public.erp_locations t on t.id=m.to_location where kind='production'$s$
 when 'count_lines' then 'select cl.lot_id id,cl.lot_id,cl.count_id,l.product_id,p.nama_produk product,l.number lot,um.code unit,cl.counted::text counted,case when c.blind and c.state=''counting'' and not public.erp_can('||quote_literal(u.id)||'::uuid,''warehouse'',''approve'') then null else cl.baseline::text end baseline,case when c.blind and c.state=''counting'' and not public.erp_can('||quote_literal(u.id)||'::uuid,''warehouse'',''approve'') then null else (cl.counted-cl.baseline)::text end difference,case when cl.counted is null then ''uncounted'' else ''counted'' end state,p.nama_produk||'' ''||l.number search,p.nama_produk||'' ''||l.number sort from public.erp_count_lines cl join public.erp_counts c on c.id=cl.count_id join public.erp_lots l on l.id=cl.lot_id join public.master_produk p on p.id=l.product_id join public.erp_product_units pu on pu.product_id=p.id and pu.is_base join public.erp_units um on um.id=pu.unit_id where cl.count_id='||quote_literal(p_id::uuid)||'::uuid'
 when 'counts' then $s$select c.*,l.name location,u.nama_lengkap assigned,c.number||' '||l.name search,c.created_at::text sort from public.erp_counts c join public.erp_locations l on l.id=c.location_id join public.users u on u.id=c.assigned_to$s$
 when 'ledger' then $s$select g.id::text id,g.movement_id,m.number,m.kind,g.lot_id,l.number lot_number,p.nama_produk product,loc.name location,um.code unit,g.delta::text delta,g.created_at,g.created_at::text sort,m.state,m.number||' '||l.number||' '||p.nama_produk search from public.erp_ledger g join public.erp_movements m on m.id=g.movement_id join public.erp_lots l on l.id=g.lot_id join public.master_produk p on p.id=l.product_id join public.erp_locations loc on loc.id=g.location_id join public.erp_product_units pu on pu.product_id=p.id and pu.is_base join public.erp_units um on um.id=pu.unit_id$s$
 when 'quotes' then $s$select q.*,coalesce(q.snapshot->'customer'->>'name',c.name) customer,to_jsonb(c) customer_data,q.number||' '||c.name||' '||q.lines::text search,q.created_at::text sort,case when q.state='issued' and q.valid_until<public.erp_today() then 'expired' else q.state end display_state from public.erp_quotes q join public.erp_customers c on c.id=q.customer_id$s$
 when 'orders' then $s$select o.*,o.snapshot->'customer'->>'name' customer,o.number||' '||(o.snapshot->'customer'->>'name')||' '||o.customer_reference search,o.created_at::text sort from public.erp_orders o$s$
 when 'fulfillment' then $s$select o.id,o.number,o.state,o.customer_reference,jsonb_build_object('customer',o.snapshot->'customer') snapshot,o.snapshot->'customer'->>'name' customer,o.number||' '||(o.snapshot->'customer'->>'name') search,o.created_at::text sort from public.erp_orders o$s$
 else null end;
 if p_entity in ('availability','count_lines') then p_id:=null; end if;
 if p_id is null and p_entity in ('movements','production') then source:='select id,number,kind,state,date,reason,version,destination,search,sort from ('||source||') summary'; end if;
 if p_id is null and p_entity='quotes' then source:='select id,number,customer_id,customer,date,valid_until,revision,currency,state,display_state,totals,version,search,sort from ('||source||') summary'; end if;
 if p_id is null and p_entity in ('orders','fulfillment') then source:='select id,number,state,customer,customer_reference,search,sort from ('||source||') summary'; end if;
 if source is null then raise exception using errcode='P0001',message='Unknown collection.'; end if;
 execute 'select count(*) from ('||source||') x where ($1='''' or x.search ilike ''%''||replace(replace(replace($1,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($2='''' or x.state=$2) and ($3 is null or x.id::text=$3)' into total using p_search,p_state,p_id;
 execute 'select coalesce(jsonb_agg(to_jsonb(y)-''search''-''sort''),''[]'') from (select * from ('||source||') x where ($1='''' or x.search ilike ''%''||replace(replace(replace($1,''\'',''\\''),''%'',''\%''),''_'',''\_'')||''%'') and ($2='''' or x.state=$2) and ($3 is null or x.id::text=$3) order by x.sort '||case when p_entity in ('stock','availability','count_lines','catalog','units','locations','customers','users','access') then 'asc' else 'desc' end||',x.id limit 50 offset $4) y' into rows using p_search,p_state,p_id,(p_page-1)*50;
 if p_id is not null and jsonb_array_length(rows)>0 then
  target:=case when p_entity not in ('stock','access','ledger') then p_id::uuid end;
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

-- Bridge the existing, validated QC evaluator into shared lot status.
do $$begin if to_regprocedure('public.qc_mutate_v3(text,text,jsonb)') is null then alter function public.qc_mutate(text,text,jsonb) rename to qc_mutate_v3; end if; end $$;
create or replace function public.qc_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; result jsonb; h public.hasil_uji; c public.coa; l public.erp_lots; begin
 perform pg_advisory_xact_lock(49281041); u:=public.erp_actor(p_token);
 if p_action not in ('create_produk','update_produk','delete_produk') then perform public.erp_assert(u.id,'quality','write'); end if;
 if p_action='update_uji' then
  select * into l from public.erp_lots where inspection_id=(p_payload->>'id')::uuid;
  if found and (l.number<>p_payload->>'no_lot' or l.product_id<>(p_payload->>'id_produk')::uuid) and (exists(select from public.erp_ledger where lot_id=l.id) or exists(select from public.erp_reservations where lot_id=l.id)) then raise exception using errcode='P0001',message='A lot with warehouse history cannot be renamed or moved to another product.'; end if;
 end if;
 if p_action='delete_uji' then update public.erp_lots set qc_status='quarantine',inspection_id=null where inspection_id=(p_payload->>'id')::uuid; end if;
 result:=public.qc_mutate_v3(p_token,p_action,p_payload);
 if p_action in ('create_uji','update_uji') then
  select * into h from public.hasil_uji where id=(result->>'id')::uuid;
  update public.erp_lots set qc_status='quarantine',inspection_id=null where inspection_id=h.id and (number<>h.no_lot or product_id<>h.id_produk);
  insert into public.erp_lots(product_id,number,qc_status,inspection_id) values(h.id_produk,h.no_lot,case when h.status='FAIL' then 'rejected' when h.qc_version=1 and h.status='PASS' and h.tgl_uji<=public.erp_today() then 'released' else 'quarantine' end,h.id)
  on conflict(product_id,number) do update set qc_status=excluded.qc_status,inspection_id=excluded.inspection_id;
 elsif p_action in ('issue_coa','update_coa') then
  select * into c from public.coa where id=(result->>'id')::uuid;
  select * into l from public.erp_lots where product_id=c.id_produk and number=c.no_lot;
  if found then
   if ((l.mfg_date is not null and l.mfg_date is distinct from nullif(c.mfg_date,'')::date) or (l.expiry_date is not null and l.expiry_date<>c.tanggal_expired)) and exists(select from public.erp_ledger where lot_id=l.id) then raise exception using errcode='P0001',message='COA dates must match the manufacturing and expiry dates of the stocked lot.'; end if;
   update public.erp_lots set mfg_date=nullif(c.mfg_date,'')::date,expiry_date=c.tanggal_expired where id=l.id;
  end if;
 elsif p_action in ('create_produk','update_produk') then
  insert into public.erp_product_units select p.id,um.id,1,true from public.master_produk p join public.erp_units um on lower(btrim(p.satuan))=lower(um.code) where p.id=(result->>'id')::uuid and not exists(select from public.erp_product_units where product_id=p.id and is_base) on conflict do nothing;
 end if; return result;
end $$;
create or replace function public.erp_module_guard(p_token text,p_module text,p_verb text default 'read') returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$declare u public.users; begin u:=public.erp_actor(p_token); perform public.erp_assert(u.id,p_module,p_verb); return true; end $$;
create or replace function public.erp_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare before_row jsonb; after_row jsonb; begin
 if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if; if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
 insert into public.audit_log(user_name,aksi,referensi,before_data,after_data) values(coalesce(nullif(current_setting('app.actor',true),''),'database:'||session_user),lower(tg_op)||'_'||tg_table_name,coalesce(after_row->>'id',before_row->>'id',after_row->>'key',after_row->>'user_id',after_row->>'count_id',after_row->>'product_id'),before_row,after_row); return null;
end $$;
do $$declare t text; f regprocedure; begin
 foreach t in array array['erp_modules','erp_access','erp_units','erp_product_units','erp_locations','erp_customers','erp_lots','erp_balances','erp_movements','erp_ledger','erp_counts','erp_count_lines','erp_quotes','erp_orders','erp_order_lines','erp_reservations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  -- Reads also go through session-authorized RPCs. No browser gets direct table access.
  execute format('drop trigger if exists erp_audit on public.%I',t);
  if t not in ('erp_balances','erp_ledger') then execute format('create trigger erp_audit after insert or update or delete on public.%I for each row execute function public.erp_audit()',t); end if;
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'erp_%' or p.proname='qc_mutate_v3') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop;
end $$;
revoke all on public.erp_stock_view from public,anon,authenticated,service_role;
revoke all on sequence public.erp_document_seq from public,anon,authenticated,service_role;
grant execute on function public.erp_read(text,text,text,text,integer,text),public.erp_mutate(text,text,jsonb),public.erp_module_guard(text,text,text),public.qc_mutate(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
