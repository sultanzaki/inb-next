begin;
alter table public.users add column if not exists is_active boolean not null default true;
alter table public.users add column if not exists must_change_password boolean not null default false;
alter table public.master_produk add column if not exists spec_version integer not null default 1;
alter table public.master_produk add column if not exists inci_name text not null default '';
alter table public.master_produk add column if not exists nama_produk_en text not null default '';
alter table public.spesifikasi add column if not exists parameter_en text not null default '';
alter table public.spesifikasi add column if not exists keterangan_en text not null default '';
alter table public.hasil_uji add column if not exists failure_reason text not null default '';
alter table public.hasil_uji add column if not exists spec_version integer;
alter table public.coa add column if not exists language text not null default 'en' check(language in ('id','en'));
alter table public.coa add column if not exists inci_name text not null default '';
alter table public.coa add column if not exists compliance_statement text not null default '';
alter table public.coa add column if not exists delivery_date date;
alter table public.coa add column if not exists template_version text not null default 'inb-reference-v1';
alter table public.audit_log add column if not exists before_data jsonb;
alter table public.audit_log add column if not exists after_data jsonb;

create table if not exists public.inspection_drafts(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.users(id),
 product_id uuid references public.master_produk(id) on delete restrict,
 no_lot text not null default '',payload jsonb not null default '{}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists qc_drafts_owner on public.inspection_drafts(owner_id,updated_at desc);
create table if not exists public.product_spec_versions(
 id uuid primary key default gen_random_uuid(),id_produk uuid not null references public.master_produk(id) on delete cascade,
 version integer not null,product_snapshot jsonb not null,specifications jsonb not null,
 actor text not null,revision_note text not null default '',created_at timestamptz not null default now(),unique(id_produk,version)
);
insert into public.product_spec_versions(id_produk,version,product_snapshot,specifications,actor,revision_note)
 select p.id,p.spec_version,to_jsonb(p),coalesce((select jsonb_agg(to_jsonb(s) order by s.urutan,s.id) from public.spesifikasi s where s.id_produk=p.id),'[]'),
 'Migrasi','Baseline dari data sebelum fitur riwayat versi tersedia; bukan rekonstruksi perubahan lama.' from public.master_produk p on conflict do nothing;

alter table public.inspection_drafts enable row level security;
alter table public.product_spec_versions enable row level security;
revoke all on public.inspection_drafts,public.product_spec_versions from public,anon,authenticated;
grant select,insert,update,delete on public.inspection_drafts to service_role;
revoke update,delete on public.product_spec_versions from service_role;
grant select,insert on public.product_spec_versions to service_role;

create or replace function public.qc_audit_change() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.audit_log(user_name,aksi,referensi,before_data,after_data) values(
 coalesce(nullif(current_setting('app.actor',true),''),'database:'||session_user),lower(tg_op)||'_'||tg_table_name,
 case when tg_op='DELETE' then old.id::text else new.id::text end,
 case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
 return null;
end $$;
drop trigger if exists qc_updated_at on public.inspection_drafts;
create trigger qc_updated_at before update on public.inspection_drafts for each row execute function public.qc_updated_at();
drop trigger if exists qc_audit_change on public.inspection_drafts;
create trigger qc_audit_change after insert or update or delete on public.inspection_drafts for each row execute function public.qc_audit_change();

-- Keep the tested evaluator/allocator as a private implementation detail.
do $$ begin
 if to_regprocedure('public.qc_mutate_core(text,text,jsonb)') is null then
  alter function public.qc_mutate(text,text,jsonb) rename to qc_mutate_core;
 end if;
end $$;
revoke all on function public.qc_mutate_core(text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.qc_mutate(p_token text,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users; result jsonb; target uuid; product uuid; draft public.inspection_drafts;
 h public.hasil_uji; p public.master_produk; v integer; e jsonb; s public.spesifikasi; enriched jsonb:='[]';
begin
 select us.* into u from public.users us join public.sessions ss on ss.user_id=us.id
 where ss.token=p_token and ss.expires_at>now() and us.is_active and not us.must_change_password;
 if not found then raise insufficient_privilege using message='Sesi tidak valid'; end if;
 perform set_config('app.actor',u.nama_lengkap,true);
 if p_action in ('save_draft','delete_draft') then
  if u.role='viewer' then raise insufficient_privilege; end if;
  target:=nullif(p_payload->>'id','')::uuid;
  if target is not null then
   select * into draft from public.inspection_drafts where id=target for update;
   if not found then raise no_data_found; end if;
   if draft.owner_id<>u.id and u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
  end if;
  if p_action='delete_draft' then
   if target is null then raise no_data_found; end if;
   delete from public.inspection_drafts where id=target;
  else
   if jsonb_typeof(p_payload->'data') is distinct from 'object' or octet_length((p_payload->'data')::text)>262144 then raise check_violation; end if;
   product:=nullif(p_payload->'data'->>'id_produk','')::uuid;
   if length(coalesce(p_payload->'data'->>'no_lot',''))>1000 then raise check_violation; end if;
   if target is null then
    insert into public.inspection_drafts(owner_id,product_id,no_lot,payload)
    values(u.id,product,coalesce(p_payload->'data'->>'no_lot',''),p_payload->'data') returning id into target;
   else update public.inspection_drafts set product_id=product,no_lot=coalesce(p_payload->'data'->>'no_lot',''),payload=p_payload->'data' where id=target;
   end if;
  end if;
  return jsonb_build_object('id',target);
 end if;
 -- Publishing a draft and removing it are one transaction.
 if p_action='create_uji' and nullif(p_payload->>'draft_id','') is not null then
  select * into draft from public.inspection_drafts where id=(p_payload->>'draft_id')::uuid for update;
  if not found then raise no_data_found; end if;
  if draft.owner_id<>u.id and u.role not in ('admin qc','administrator inbionusa') then raise insufficient_privilege; end if;
 end if;
 if p_action='issue_coa' and p_payload ? 'preview_source_updated_at' then
  select * into h from public.hasil_uji where id=(p_payload->>'id_hasil')::uuid for update;
  if not found then raise no_data_found; end if;
  select * into p from public.master_produk where id=h.id_produk for share;
  if h.updated_at is distinct from (p_payload->>'preview_source_updated_at')::timestamptz
   or p.updated_at is distinct from (p_payload->>'preview_product_updated_at')::timestamptz then
   raise sqlstate '55000' using message='Data berubah setelah pratinjau'; end if;
 end if;
 result:=public.qc_mutate_core(p_token,p_action,p_payload);
 target:=(result->>'id')::uuid;
 if p_action in ('create_produk','update_produk') then
  update public.master_produk set inci_name=coalesce(p_payload->>'inci_name',''),nama_produk_en=coalesce(p_payload->>'nama_produk_en',''),
   spec_version=spec_version+case when p_action='update_produk' then 1 else 0 end where id=target returning * into p;
  for s in select * from public.spesifikasi where id_produk=target loop
   e:=p_payload->'spesifikasi'->s.urutan;
   update public.spesifikasi set parameter_en=coalesce(e->>'parameter_en',''),keterangan_en=coalesce(e->>'keterangan_en','') where id=s.id;
  end loop;
  insert into public.product_spec_versions(id_produk,version,product_snapshot,specifications,actor,revision_note)
   select p.id,p.spec_version,to_jsonb(p),coalesce(jsonb_agg(to_jsonb(sp) order by sp.urutan,sp.id) filter(where sp.id is not null),'[]'),
   u.nama_lengkap,coalesce(p_payload->>'revision_note','') from public.spesifikasi sp where sp.id_produk=p.id;
 elsif p_action in ('create_uji','update_uji') then
  select * into h from public.hasil_uji where id=target;
  if h.status='FAIL' and nullif(btrim(p_payload->>'failure_reason'),'') is null then
   raise check_violation using message='Penjelasan hasil FAIL wajib diisi'; end if;
  if length(coalesce(p_payload->>'failure_reason',''))>5000 then raise check_violation; end if;
  select spec_version into v from public.master_produk where id=h.id_produk;
  -- Preserve translated labels in the same validated parameter snapshot.
  for e in select value from jsonb_array_elements(h.hasil_detail) loop
   select * into s from public.spesifikasi where id=(e->>'spec_id')::uuid;
   if length(coalesce((select value->>'val_en' from jsonb_array_elements(p_payload->'hasil_detail') where value->>'p'=s.parameter_uji),''))>1000 then raise check_violation; end if;
   enriched:=enriched||jsonb_build_array(e||jsonb_build_object('p_en',s.parameter_en,'k_en',s.keterangan_en,'val_en',case when s.tipe_batas='TEXT' then coalesce((select value->>'val_en' from jsonb_array_elements(p_payload->'hasil_detail') where value->>'p'=s.parameter_uji),'') else '' end));
  end loop;
  update public.hasil_uji set failure_reason=case when status='FAIL' then btrim(p_payload->>'failure_reason') else '' end,
   spec_version=v,hasil_detail=enriched where id=target;
  if draft.id is not null then delete from public.inspection_drafts where id=draft.id; end if;
 elsif p_action in ('issue_coa','update_coa') then
  if coalesce(p_payload->>'language','en') not in ('id','en') or length(coalesce(p_payload->>'inci_name',''))>1000
   or length(coalesce(p_payload->>'compliance_statement',''))>3000 then raise check_violation; end if;
  if p_action='issue_coa' then
   select mp.* into p from public.master_produk mp join public.coa c on c.id_produk=mp.id where c.id=target;
   -- Only enrich the freshly inserted snapshot, never mutate an issued one.
   perform set_config('app.coa_creation',target::text,true);
   update public.coa set hasil_uji_snapshot=hasil_uji_snapshot||jsonb_build_object('inci_name',p.inci_name,'produk_en',p.nama_produk_en,
    'spec_version',(select spec_version from public.hasil_uji where id=public.coa.id_hasil_uji)) where id=target;
   perform set_config('app.coa_creation','',true);
  end if;
  update public.coa set language=coalesce(p_payload->>'language','en'),inci_name=coalesce(p_payload->>'inci_name',''),
   compliance_statement=coalesce(p_payload->>'compliance_statement',''),delivery_date=nullif(p_payload->>'delivery_date','')::date where id=target;
 end if;
 return result;
end $$;

create or replace function public.qc_snapshot_guard() returns trigger language plpgsql as $$
begin
 if current_setting('app.coa_creation',true)=old.id::text then return new; end if;
 if new.hasil_uji_snapshot is distinct from old.hasil_uji_snapshot or new.id_produk is distinct from old.id_produk
 or new.no_lot is distinct from old.no_lot or new.id_hasil_uji is distinct from old.id_hasil_uji then
 raise sqlstate '55000' using message='Identitas dan snapshot COA tidak boleh diubah'; end if;
 return new;
end $$;

create or replace function public.qc_manage_user(p_token text,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor public.users; target public.users; target_id uuid; safe_before jsonb; safe_after jsonb; managers integer; hash text;
begin
 perform pg_advisory_xact_lock(18622,1);
 select us.* into actor from public.users us join public.sessions ss on ss.user_id=us.id
 where ss.token=p_token and ss.expires_at>now() and us.is_active;
 if not found then raise insufficient_privilege; end if;
 if p_action<>'change_password' and (actor.must_change_password or actor.role not in ('admin qc','administrator inbionusa')) then raise insufficient_privilege; end if;
 target_id:=case when p_action='change_password' then actor.id else nullif(p_payload->>'id','')::uuid end;
 if p_action not in ('create_user','update_user','reset_password','change_password') then raise insufficient_privilege; end if;
 if target_id is not null then
  select * into target from public.users where id=target_id for update;
  if not found then raise no_data_found; end if;
  safe_before:=to_jsonb(target)-'password_hash';
 end if;
 if p_action in ('create_user','reset_password','change_password') then
  hash:=p_payload->>'password_hash';
  if hash is null or hash !~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$' then raise check_violation; end if;
 end if;
 if p_action='create_user' then
  if nullif(btrim(p_payload->>'username'),'') is null or length(p_payload->>'username')>100 or
   exists(select from public.users where lower(username)=lower(btrim(p_payload->>'username'))) then raise unique_violation; end if;
  insert into public.users(username,password_hash,nama_lengkap,role,must_change_password)
   values(btrim(p_payload->>'username'),hash,p_payload->>'nama_lengkap',p_payload->>'role',true) returning * into target;
 elsif p_action='update_user' then
  if target.id=actor.id and ((p_payload->>'role') is distinct from actor.role or (p_payload->>'is_active')::boolean is not true) then raise check_violation using message='Tidak boleh menonaktifkan atau mengganti peran sendiri'; end if;
  select count(*) into managers from public.users where is_active and role in ('admin qc','administrator inbionusa') and id<>target.id;
  if target.is_active and target.role in ('admin qc','administrator inbionusa') and managers=0 and
   ((p_payload->>'is_active')::boolean is not true or p_payload->>'role' not in ('admin qc','administrator inbionusa')) then raise check_violation; end if;
  update public.users set nama_lengkap=p_payload->>'nama_lengkap',role=p_payload->>'role',is_active=(p_payload->>'is_active')::boolean where id=target.id returning * into target;
  if target.role is distinct from safe_before->>'role' or not target.is_active then delete from public.sessions where user_id=target.id; end if;
 elsif p_action='reset_password' then
  if target.id=actor.id then raise check_violation using message='Gunakan ganti password untuk akun sendiri'; end if;
  update public.users set password_hash=hash,must_change_password=true where id=target.id returning * into target;
  delete from public.sessions where user_id=target.id;
 elsif p_action='change_password' then
  if actor.password_hash is distinct from p_payload->>'expected_hash' then raise sqlstate '55000'; end if;
  update public.users set password_hash=hash,must_change_password=false where id=actor.id returning * into target;
  delete from public.sessions where user_id=actor.id;
 end if;
 if nullif(btrim(target.nama_lengkap),'') is null or length(target.nama_lengkap)>200 then raise check_violation; end if;
 safe_after:=to_jsonb(target)-'password_hash';
 insert into public.audit_log(user_name,aksi,referensi,before_data,after_data) values(actor.nama_lengkap,p_action,target.id::text,safe_before,safe_after);
 return jsonb_build_object('id',target.id);
end $$;
revoke all on function public.qc_mutate(text,text,jsonb),public.qc_manage_user(text,text,jsonb),public.qc_snapshot_guard() from public,anon,authenticated;
grant execute on function public.qc_mutate(text,text,jsonb),public.qc_manage_user(text,text,jsonb) to service_role;
-- Serialize session creation with account resets. A password checked before a
-- reset must never create a replacement session after that reset commits.
create or replace function public.qc_create_login_session(p_user_id uuid,p_expected_hash text,p_token text,p_expires timestamptz) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform pg_advisory_xact_lock(18622,1);
 if not exists(select from public.users where id=p_user_id and is_active and password_hash=p_expected_hash) then return false; end if;
 if p_expires<=now() or p_expires>now()+interval '6 hours 1 minute' or p_token !~ '^[0-9a-f-]{36}$' then raise check_violation; end if;
 insert into public.sessions(user_id,token,expires_at) values(p_user_id,p_token,p_expires);
 return true;
end $$;
revoke all on function public.qc_create_login_session(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.qc_create_login_session(uuid,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
