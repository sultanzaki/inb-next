begin;
-- Abort safely if historical duplicates exist. Resolve manually; never delete
-- inspection/COA history to force a migration through.
create unique index if not exists qc_unique_parameter on public.spesifikasi(id_produk, lower(btrim(parameter_uji)));
create unique index if not exists qc_unique_coa_lot on public.coa(id_produk, no_lot);
alter table public.hasil_uji add column if not exists qc_version integer not null default 0;
alter table public.coa add column if not exists id_hasil_uji uuid references public.hasil_uji(id) on delete restrict;
update public.coa c set id_hasil_uji=h.id from public.hasil_uji h
 where c.id_hasil_uji is null and h.id_produk=c.id_produk and h.no_lot=c.no_lot;
create unique index if not exists qc_unique_coa_source on public.coa(id_hasil_uji);
-- Preserve saved names. A legacy certificate without a saved code cannot have
-- its historical code reconstructed; capture the current code once, explicitly.
update public.coa c set hasil_uji_snapshot=c.hasil_uji_snapshot || jsonb_build_object(
 'kode_produk',p.kode_produk,'legacy_identity_backfill',true)
 from public.master_produk p where p.id=c.id_produk and not (c.hasil_uji_snapshot ? 'kode_produk');

create or replace function public.qc_number(v text) returns numeric language plpgsql immutable as $$
declare n numeric;
begin
 if v is null or length(v)>1000 or btrim(v) !~ '^[+-]?([0-9]+([.,][0-9]+)?|[.,][0-9]+)([eE][+-]?[0-9]+)?$' then return null; end if;
 begin n:=replace(btrim(v),',','.')::numeric; exception when others then return null; end;
 if abs(n)>1.7976931348623157e308 then return null; end if;
 return n;
end $$;

create or replace function public.qc_spec_guard() returns trigger language plpgsql as $$
declare lo numeric; hi numeric;
begin
 if length(btrim(new.parameter_uji))=0 then raise check_violation using message='Parameter wajib diisi'; end if;
 lo:=public.qc_number(new.nilai_min); hi:=public.qc_number(new.nilai_maks);
 if (new.tipe_batas in ('MIN','RANGE') and lo is null)
 or (new.tipe_batas in ('MAX','RANGE') and hi is null)
 or (new.tipe_batas='RANGE' and lo>hi) then raise check_violation using message='Batas spesifikasi tidak valid'; end if;
 return new;
end $$;
drop trigger if exists qc_spec_guard on public.spesifikasi;
create trigger qc_spec_guard before insert or update on public.spesifikasi for each row execute function public.qc_spec_guard();

-- NOT VALID retains historical data; new/updated rows are still checked.
do $$ begin
 if not exists(select from pg_constraint where conname='qc_inspection_dates' and conrelid='public.hasil_uji'::regclass) then
  alter table public.hasil_uji add constraint qc_inspection_dates check(tgl_uji>=tgl_sampling) not valid; end if;
 if not exists(select from pg_constraint where conname='qc_coa_dates' and conrelid='public.coa'::regclass) then
  alter table public.coa add constraint qc_coa_dates check(tanggal_expired>=tanggal_rilis and (coalesce(mfg_date,'')='' or mfg_date::date<=tanggal_rilis)) not valid; end if;
 if not exists(select from pg_constraint where conname='qc_document_dates' and conrelid='public.dokumen_arsip'::regclass) then
  alter table public.dokumen_arsip add constraint qc_document_dates check(masa_kadaluarsa>=tanggal_berlaku) not valid; end if;
end $$;

create or replace function public.qc_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create or replace function public.qc_audit_change() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.audit_log(user_name,aksi,referensi) values(
  coalesce(nullif(current_setting('app.actor',true),''),'database:'||session_user), lower(tg_op)||'_'||tg_table_name,
  case when tg_op='DELETE' then old.id::text else new.id::text end);
 return null;
end $$;
create or replace function public.qc_certified_guard() returns trigger language plpgsql as $$
begin
 if exists(select from public.coa where id_hasil_uji=old.id or (id_produk=old.id_produk and no_lot=old.no_lot)) then
  raise sqlstate '55000' using message='Hasil uji sudah disertifikasi';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create or replace function public.qc_snapshot_guard() returns trigger language plpgsql as $$
begin
 if new.hasil_uji_snapshot is distinct from old.hasil_uji_snapshot or new.id_produk is distinct from old.id_produk
 or new.no_lot is distinct from old.no_lot or new.id_hasil_uji is distinct from old.id_hasil_uji then
  raise sqlstate '55000' using message='Identitas dan snapshot COA tidak boleh diubah'; end if;
 return new;
end $$;
drop trigger if exists qc_certified_guard on public.hasil_uji;
create trigger qc_certified_guard before update or delete on public.hasil_uji for each row execute function public.qc_certified_guard();
drop trigger if exists qc_snapshot_guard on public.coa;
create trigger qc_snapshot_guard before update on public.coa for each row execute function public.qc_snapshot_guard();
do $$ declare t text; begin
 foreach t in array array['users','master_produk','hasil_uji','coa','dokumen_arsip'] loop
  execute format('drop trigger if exists qc_updated_at on public.%I',t);
  execute format('create trigger qc_updated_at before update on public.%I for each row execute function public.qc_updated_at()',t);
 end loop;
 foreach t in array array['master_produk','spesifikasi','hasil_uji','coa','dokumen_arsip'] loop
  execute format('drop trigger if exists qc_audit_change on public.%I',t);
  execute format('create trigger qc_audit_change after insert or update or delete on public.%I for each row execute function public.qc_audit_change()',t);
 end loop;
end $$;

create table if not exists public.qc_coa_counter(year integer primary key, value bigint not null check(value>0));
create table if not exists public.qc_login_attempts(key text primary key, count integer not null, reset_at timestamptz not null);
create index if not exists qc_login_reset_at on public.qc_login_attempts(reset_at);
alter table public.qc_coa_counter enable row level security;
alter table public.qc_login_attempts enable row level security;
revoke all on public.qc_coa_counter,public.qc_login_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.qc_coa_counter,public.qc_login_attempts to service_role;

create or replace function public.qc_reserve_login(p_key text) returns boolean language plpgsql as $$
declare attempts integer;
begin
 if p_key !~ '^[0-9a-f]{64}$' then return false; end if;
 delete from public.sessions where expires_at<now() and id in (select id from public.sessions where expires_at<now() limit 100);
 delete from public.qc_login_attempts where reset_at<now() and key<>p_key and key in (select key from public.qc_login_attempts where reset_at<now() limit 100);
 insert into public.qc_login_attempts as a(key,count,reset_at) values(p_key,1,now()+interval '15 minutes')
 on conflict(key) do update set count=case when a.reset_at<=now() then 1 else a.count+1 end,
 reset_at=case when a.reset_at<=now() then now()+interval '15 minutes' else a.reset_at end returning count into attempts;
 return attempts<=5;
end $$;

-- Search on a scalar computed field avoids unsupported cross-table OR syntax.
create or replace function public.product_name(public.hasil_uji) returns text language sql stable set search_path=pg_catalog,public as $$
 select nama_produk from public.master_produk where id=$1.id_produk
$$;
create or replace function public.product_name(public.coa) returns text language sql stable set search_path=pg_catalog,public as $$
 select coalesce($1.hasil_uji_snapshot->>'produk',nama_produk) from public.master_produk where id=$1.id_produk
$$;
create or replace view public.available_hasil_uji with(security_invoker=true) as
 select h.* from public.hasil_uji h where h.status='PASS'
 and not exists(select from public.coa c where c.id_produk=h.id_produk and c.no_lot=h.no_lot);
revoke all on public.available_hasil_uji from public,anon,authenticated;
grant select on public.available_hasil_uji to service_role;

create or replace function public.qc_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare u public.users; target uuid; product uuid; h public.hasil_uji; c public.coa; s public.spesifikasi;
 entry jsonb; item jsonb; items jsonb:='[]'; overall text:='PASS'; st text; n numeric; lo numeric; hi numeric;
 number text; yr integer; seq bigint; snap jsonb; expected integer; r record;
begin
 select us.* into u from public.users us join public.sessions ss on ss.user_id=us.id
  where ss.token=p_token and ss.expires_at>now();
 if not found then raise insufficient_privilege using message='Sesi tidak valid'; end if;
 if p_action is null or p_action not in ('create_produk','update_produk','delete_produk','create_uji','update_uji','delete_uji','issue_coa','update_coa','delete_coa','create_doc','delete_doc')
 or u.role not in ('admin qc','administrator inbionusa','qc supervisor')
 or (p_action in ('delete_produk','delete_uji','delete_coa','create_doc','delete_doc') and u.role='qc supervisor') then
  raise insufficient_privilege using message='Aksi tidak diizinkan'; end if;
 perform set_config('app.actor',u.nama_lengkap,true);
 target:=nullif(p_payload->>'id','')::uuid;
 if p_action in ('create_produk','update_produk') then
  if p_action='create_produk' then
   insert into public.master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan)
   values(p_payload->>'kode_produk',p_payload->>'nama_produk',p_payload->>'kategori',p_payload->>'satuan',p_payload->>'status_halal',p_payload->>'tipe_kemasan') returning id into target;
  else
   perform 1 from public.master_produk where id=target for update;
   if not found then raise no_data_found; end if;
   update public.master_produk set kode_produk=p_payload->>'kode_produk',nama_produk=p_payload->>'nama_produk',kategori=p_payload->>'kategori',
    satuan=p_payload->>'satuan',status_halal=p_payload->>'status_halal',tipe_kemasan=p_payload->>'tipe_kemasan' where id=target;
   delete from public.spesifikasi where id_produk=target;
  end if;
  for entry in select value from jsonb_array_elements(p_payload->'spesifikasi') loop
   insert into public.spesifikasi(id_produk,parameter_uji,tipe_batas,nilai_min,nilai_maks,satuan,keterangan,urutan)
   values(target,entry->>'parameter_uji',entry->>'tipe_batas',entry->>'nilai_min',entry->>'nilai_maks',entry->>'satuan',entry->>'keterangan',jsonb_array_length(items));
   items:=items||jsonb_build_array(entry);
  end loop;
 elsif p_action in ('create_uji','update_uji') then
  if p_action='update_uji' then
   select * into h from public.hasil_uji where id=target for update;
   if not found then raise no_data_found; end if;
  end if;
  product:=(p_payload->>'id_produk')::uuid;
  -- Serialize with spec edits so evaluation cannot see half a replacement.
  perform 1 from public.master_produk where id=product for update;
  if not found then raise no_data_found; end if;
  if p_action='update_uji' and h.qc_version=1 and exists(
   select from jsonb_array_elements(h.hasil_detail) old_item where not exists(
    select from public.spesifikasi sp where sp.id::text=old_item->>'spec_id' and sp.id_produk=product
   )
  ) then raise sqlstate '55000' using message='Spesifikasi historis berubah; buat revisi inspeksi terpisah'; end if;
  select count(*) into expected from public.spesifikasi where id_produk=product;
  if expected=0 or expected<>jsonb_array_length(p_payload->'hasil_detail') then raise check_violation using message='Parameter tidak lengkap'; end if;
  for s in select * from public.spesifikasi where id_produk=product order by urutan,id loop
   if (select count(*) from jsonb_array_elements(p_payload->'hasil_detail') v where v->>'p'=s.parameter_uji)<>1 then
    raise check_violation using message='Parameter tidak sesuai'; end if;
   select value into entry from jsonb_array_elements(p_payload->'hasil_detail') where value->>'p'=s.parameter_uji;
   if (entry->>'spec_id') is distinct from s.id::text then raise sqlstate '55000' using message='Spesifikasi berubah'; end if;
   if jsonb_typeof(entry->'val')<>'string' or length(entry->>'val')>1000 then raise check_violation; end if;
   n:=public.qc_number(entry->>'val'); lo:=public.qc_number(s.nilai_min); hi:=public.qc_number(s.nilai_maks);
   if nullif(btrim(entry->>'val'),'') is null then st:='FAIL';
   elsif s.tipe_batas='TEXT' then st:='PASS';
   elsif n is null then raise check_violation using message='Angka hasil uji tidak valid';
   elsif (s.tipe_batas='MIN' and n>=lo) or (s.tipe_batas='MAX' and n<=hi) or (s.tipe_batas='RANGE' and n>=lo and n<=hi) then st:='PASS';
   else st:='FAIL'; end if;
   if st='FAIL' then overall:='FAIL'; end if;
   item:=jsonb_build_object('spec_id',s.id,'p',s.parameter_uji,'t',s.tipe_batas,'mn',s.nilai_min,'mx',s.nilai_maks,'u',s.satuan,'k',s.keterangan,'val',entry->>'val','st',st);
   items:=items||jsonb_build_array(item);
  end loop;
  if p_action='create_uji' then
   insert into public.hasil_uji(id_produk,no_lot,tgl_sampling,tgl_uji,inspector,catatan,hasil_detail,status,qc_version)
   values(product,p_payload->>'no_lot',(p_payload->>'tgl_sampling')::date,(p_payload->>'tgl_uji')::date,p_payload->>'inspector',p_payload->>'catatan',items,overall,1) returning id into target;
  else
   update public.hasil_uji set id_produk=product,no_lot=p_payload->>'no_lot',tgl_sampling=(p_payload->>'tgl_sampling')::date,
    tgl_uji=(p_payload->>'tgl_uji')::date,inspector=p_payload->>'inspector',catatan=p_payload->>'catatan',hasil_detail=items,status=overall,qc_version=1 where id=target;
  end if;
 elsif p_action='issue_coa' then
  select * into h from public.hasil_uji where id=(p_payload->>'id_hasil')::uuid for update;
  if not found then raise no_data_found; end if;
  if h.qc_version<>1 then raise sqlstate '55000' using message='Inspeksi lama harus diverifikasi ulang sebelum penerbitan'; end if;
  if h.status<>'PASS' or jsonb_array_length(h.hasil_detail)=0 then raise check_violation using message='Hasil uji belum PASS'; end if;
  -- Verify saved parameter snapshots, including legacy rows; never trust st alone.
  for entry in select value from jsonb_array_elements(h.hasil_detail) loop
   n:=public.qc_number(entry->>'val'); lo:=public.qc_number(entry->>'mn'); hi:=public.qc_number(entry->>'mx');
   if entry->>'st' is distinct from 'PASS' or nullif(btrim(entry->>'val'),'') is null or (
    entry->>'t'='TEXT' or (n is not null and ((entry->>'t'='MIN' and n>=lo) or (entry->>'t'='MAX' and n<=hi) or (entry->>'t'='RANGE' and n>=lo and n<=hi)))
   ) is not true then raise check_violation using message='Snapshot hasil uji tidak valid'; end if;
  end loop;
  if exists(select from public.coa where id_produk=h.id_produk and no_lot=h.no_lot) then raise unique_violation; end if;
  select jsonb_build_object('produk',nama_produk,'kode_produk',kode_produk,'ts',h.tgl_sampling,'tu',h.tgl_uji,'items',h.hasil_detail)
   into snap from public.master_produk where id=h.id_produk for share;
  yr:=extract(year from (now() at time zone 'Asia/Jakarta'))::int;
  perform pg_advisory_xact_lock(18621,yr);
  number:=nullif(btrim(p_payload->>'no_coa'),'');
  if number is null then
   -- Serialize the allocator, including collisions with manually supplied numbers.
   select coalesce(max(substring(no_coa from ('^COA/IBN/'||yr||'/([0-9]{1,18})$'))::bigint),0) into seq
    from public.coa where no_coa ~ ('^COA/IBN/'||yr||'/[0-9]{1,18}$');
   insert into public.qc_coa_counter as q(year,value) values(yr,seq+1)
    on conflict(year) do update set value=greatest(q.value,seq)+1 returning value into seq;
   number:='COA/IBN/'||yr||'/'||case when seq<10000 then lpad(seq::text,4,'0') else seq::text end;
  end if;
  insert into public.coa(no_coa,id_hasil_uji,id_produk,no_lot,tanggal_rilis,tanggal_expired,mfg_date,tanda_tangan_digital,hasil_uji_snapshot)
  values(number,h.id,h.id_produk,h.no_lot,(p_payload->>'tanggal_rilis')::date,(p_payload->>'tanggal_expired')::date,p_payload->>'mfg_date',p_payload->>'tanda_tangan',snap) returning id into target;
 elsif p_action='update_coa' then
  update public.coa set no_coa=p_payload->>'no_coa',tanggal_rilis=(p_payload->>'tanggal_rilis')::date,
   tanggal_expired=(p_payload->>'tanggal_expired')::date,mfg_date=p_payload->>'mfg_date',tanda_tangan_digital=p_payload->>'tanda_tangan' where id=target;
  if not found then raise no_data_found; end if;
 elsif p_action='create_doc' then
  insert into public.dokumen_arsip(judul_dokumen,kategori,tanggal_berlaku,masa_kadaluarsa,link_drive,file_url)
   values(p_payload->>'judul_dokumen',p_payload->>'kategori',(p_payload->>'tanggal_berlaku')::date,(p_payload->>'masa_kadaluarsa')::date,p_payload->>'link_drive','') returning id into target;
 else
  case p_action
   when 'delete_produk' then delete from public.master_produk where id=target;
   when 'delete_uji' then delete from public.hasil_uji where id=target;
   when 'delete_coa' then delete from public.coa where id=target;
   when 'delete_doc' then delete from public.dokumen_arsip where id=target;
  end case;
  if not found then raise no_data_found; end if;
 end if;
 return jsonb_build_object('id',target,'no_coa',number);
end $$;

-- PostgreSQL functions default to PUBLIC execute. Explicitly revoke every new
-- helper; trigger functions keep running through the installed triggers.
revoke all on function public.qc_number(text),public.qc_spec_guard(),public.qc_updated_at(),public.qc_audit_change(),public.qc_certified_guard(),public.qc_snapshot_guard(),
 public.qc_reserve_login(text),public.qc_mutate(text,text,jsonb),public.product_name(public.hasil_uji),public.product_name(public.coa) from public,anon,authenticated;
grant execute on function public.qc_number(text),public.qc_reserve_login(text),public.qc_mutate(text,text,jsonb),public.product_name(public.hasil_uji),public.product_name(public.coa) to service_role;
notify pgrst, 'reload schema';
commit;
