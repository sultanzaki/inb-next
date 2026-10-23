begin;
create or replace function public.work_material_eligible(p_lot uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select from public.erp_material_lots l join public.erp_materials m on m.id=l.material_id join public.erp_suppliers s on s.id=l.supplier_id where l.id=p_lot and m.active and s.active and not l.held and l.quality_status not in ('rejected','disposed') and (l.expiry_date is null or l.expiry_date>=public.erp_today()) and (not m.requires_qc or l.quality_status='released') and (not m.requires_approved_supplier or exists(select from public.erp_approved_suppliers a where a.material_id=m.id and a.supplier_id=l.supplier_id and a.state='approved' and a.effective_date<=public.erp_today() and (a.expiry_date is null or a.expiry_date>=public.erp_today()))))
$$;
create or replace function public.work_disposition_command(p_user uuid,p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare lot public.erp_material_lots;qty numeric;tx uuid;why text:=btrim(coalesce(p->>'reason',''));begin
 perform public.erp_assert(p_user,'quality','approve');if length(why)<3 then raise check_violation;end if;
 select * into lot from public.erp_material_lots where id=(p->>'id')::uuid for update;if not found then raise no_data_found;end if;
 if not exists(select from public.erp_material_balances where lot_id=lot.id and public.work_location_allowed(p_user,location_id)) then raise insufficient_privilege;end if;
 if p_action='hold_material_quality' then
  if not (p->>'hold')::boolean then
   update public.erp_material_lots set held=false where id=lot.id;
   if not public.work_material_eligible(lot.id) then raise exception using errcode='P0001',message='A hold cannot be removed until material Quality, supplier and expiry requirements are met.';end if;
  end if;
  update public.erp_material_lots set held=(p->>'hold')::boolean,hold_reason=why where id=lot.id;
 else
  perform public.erp_assert(p_user,'warehouse','approve');perform public.work_assert_location(p_user,(p->>'location_id')::uuid,'approve');
  if not exists(select from public.erp_deviations d where id=(p->>'deviation_id')::uuid and state in ('approved','closed') and (d.material_lot_id=lot.id or exists(select from public.erp_incoming_inspections where id=d.inspection_id and lot_id=lot.id))) then raise exception using errcode='P0001',message='Approve a deviation for this material lot before disposal.';end if;
  qty:=public.erp_qty(p->>'quantity');perform set_config('work.stock_flow','disposal',true);
  insert into public.erp_material_transactions(request_key,number,kind,date,reason,created_by) values(gen_random_uuid(),public.erp_number('MDSP'),'issue',public.erp_today(),'Material disposition · '||why,p_user) returning id into tx;
  perform public.work_material_delta(tx,lot.id,(p->>'location_id')::uuid,-qty);
  update public.erp_material_lots set held=true,hold_reason=why,quality_status=case when not exists(select from public.erp_material_balances where lot_id=lot.id and quantity>0) then 'disposed' else 'rejected' end where id=lot.id;perform set_config('work.stock_flow','',true);
 end if;
 perform public.work_event('material_lots',lot.id,p_action,p_user,why,to_jsonb(lot),(select to_jsonb(l) from public.erp_material_lots l where id=lot.id));return jsonb_build_object('id',lot.id,'entity','material_lots');
end $$;
-- Controlled gateways retain request replay checks for the added disposition commands.
do $$declare definition text;begin
 select pg_get_functiondef('public.erp_work_mutate(text,text,jsonb)'::regprocedure) into definition;
 if position('work_disposition_command' in definition)=0 then
  definition:=replace(definition,' if p_action in (''save_material_spec''',E' if p_action in (''hold_material_quality'',''dispose_material_quality'') then result:=public.work_disposition_command(u.id,p_action,p_payload);\n elsif p_action in (''save_material_spec''');execute definition;
 end if;
end $$;
-- Inspection ownership and location checks also apply when modifying an existing draft.
create or replace function public.work_quality_location_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=nullif(current_setting('inb.actor',true),'')::uuid;begin
 if actor is not null and not exists(select from public.erp_material_balances where lot_id=new.lot_id and public.work_location_allowed(actor,location_id)) then raise insufficient_privilege using message='This material lot is outside your warehouse access.';end if;return new;
end $$;
drop trigger if exists work_quality_location_guard on public.erp_incoming_inspections;
create trigger work_quality_location_guard before insert or update on public.erp_incoming_inspections for each row execute function public.work_quality_location_guard();
-- Approved formula products must enter finished stock through their production order.
do $$declare definition text;begin
 select pg_get_functiondef('public.erp_mutate(text,text,jsonb)'::regprocedure) into definition;
 if position('work.production_order' in definition)=0 then
  definition:=replace(definition,' if p_action=''reverse_material_transaction'' and',E' if (p_action=''save_move'' and p_payload->>''kind''=''production'') or (p_action=''post_move'' and exists(select from public.erp_movements where id=target and kind=''production'')) then\n  if exists(select from jsonb_array_elements(case when p_action=''save_move'' then p_payload->''lines'' else (select lines from public.erp_movements where id=target) end) x join public.erp_formulas f on f.product_id=(x->>''product_id'')::uuid and f.state=''approved'' where not exists(select from public.erp_manufacturing_orders m where m.id=nullif(current_setting(''work.production_order'',true),'''')::uuid and m.product_id=f.product_id and m.state in (''released'',''in_progress''))) then raise exception using errcode=''P0001'',message=''This product has an approved formula. Record finished output from its production order so material usage stays traceable.'';end if;\n end if;\n if p_action=''reverse_material_transaction'' and');
  execute definition;
 end if;
 select pg_get_functiondef('public.work_manufacturing_command(text,uuid,text,jsonb)'::regprocedure) into definition;
 if position('work.production_order' in definition)=0 then
  definition:=replace(definition,'   result:=public.erp_mutate(p_token,''save_move''',E'   perform set_config(''work.production_order'',mo.id::text,true);\n   result:=public.erp_mutate(p_token,''save_move''');
  definition:=replace(definition,'   insert into public.erp_manufacturing_outputs',E'   perform set_config(''work.production_order'','''',true);\n   insert into public.erp_manufacturing_outputs');execute definition;
 end if;
end $$;
-- A small authorized read model powers the guided service-case checklist.
create or replace function public.erp_work_read(p_token text,p_entity text,p_query jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.users;c public.erp_cases;done numeric;physical boolean;financial boolean;approved boolean;steps jsonb;begin
 if p_entity<>'case_progress' then return public.work_read_base(p_token,p_entity,p_query);end if;
 u:=public.erp_actor(p_token);perform public.erp_assert(u.id,'service','read');select * into c from public.erp_cases where id=(p_query->>'id')::uuid;if not found then raise no_data_found;end if;if not public.work_row_allowed(u.id,'ops_cases',to_jsonb(c)) then raise insufficient_privilege;end if;
 approved:=c.state in ('approved','in_progress','resolved','closed');
 select coalesce(sum(e.quantity),0) into done from public.erp_case_executions e left join public.erp_movements m on m.id=e.movement_id where e.case_id=c.id and (e.movement_id is null or m.state='posted') and (e.material_transaction_id is null or not exists(select from public.erp_material_transactions where reverses=e.material_transaction_id));
 physical:=c.resolution not in ('replacement','return') or done>=coalesce(c.quantity,0);
 financial:=c.resolution not in ('credit','refund') or (exists(select from public.erp_case_executions where case_id=c.id and kind='financial') and (not exists(select from public.erp_modules where key='finance' and state<>'disabled') or public.erp_fin_case_settled(c.id,c.resolution)>=c.settlement_amount));
 steps:=jsonb_build_array(jsonb_build_object('title','Evidence and source','done',length(btrim(c.description))>0,'hint','Record the original document, quantities and evidence.'),jsonb_build_object('title','Approved resolution','done',approved,'hint','Decide the resolution, cost responsibility and settlement amount.'),jsonb_build_object('title','Physical execution','done',approved and physical,'hint',case when c.resolution in ('replacement','return') then 'Complete the actual shipment or received return. A draft request is not completion.' else 'No physical movement required by this resolution.' end),jsonb_build_object('title','Financial settlement','done',approved and financial,'hint',case when c.resolution in ('credit','refund') then 'Complete the approved credit or verified refund settlement.' else 'No financial settlement required by this resolution.' end),jsonb_build_object('title','Resolve and close','done',c.state in ('resolved','closed'),'hint','Record completion evidence after all required operations are complete.'));
 return jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id',c.id,'steps',steps,'can_resolve',approved and physical and financial)),'total',1,'page',1,'page_size',50);
end $$;
revoke all on function public.work_disposition_command(uuid,text,jsonb),public.work_quality_location_guard(),public.work_read_base(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.erp_work_read(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.erp_work_read(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
