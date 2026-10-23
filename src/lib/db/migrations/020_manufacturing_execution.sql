begin;
create or replace function public.work_material_used(p_order uuid,p_material uuid) returns numeric language sql stable set search_path=pg_catalog,public as $$
 select coalesce(sum(case i.kind when 'consume' then i.quantity else -i.quantity end),0) from public.erp_manufacturing_inputs i join public.erp_material_lots l on l.id=i.lot_id where i.manufacturing_order_id=p_order and l.material_id=p_material
$$;
create or replace function public.work_manufacturing_command(p_token text,p_user uuid,p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
declare target uuid:=nullif(p->>'id','')::uuid;expected_version integer:=nullif(p->>'version','')::integer;why text:=btrim(coalesce(p->>'reason',''));formula public.erp_formulas;mo public.erp_manufacturing_orders;reservation public.erp_material_reservations;input public.erp_manufacturing_inputs;lot public.erp_material_lots;line jsonb;normalized_lines jsonb:='[]';required numeric;allocated numeric;qty numeric;actual numeric;total numeric;tx uuid;output uuid;result jsonb;root uuid;revision_no integer;entity text;begin
 perform public.erp_assert(p_user,'production',case when p_action in ('approve_formula','withdraw_formula','release_manufacturing_order','complete_manufacturing_order','close_manufacturing_order','cancel_manufacturing_order') then 'approve' else 'write' end);
 if p_action in ('save_formula','revise_formula') then
  if target is not null then
   select * into formula from public.erp_formulas where id=target for update;if not found or formula.version is distinct from expected_version then raise exception using errcode='P0001',message='Formula changed. Reload first.';end if;
   if p_action='revise_formula' then
    if formula.state not in ('approved','superseded') then raise check_violation;end if;
    select max(revision)+1 into revision_no from public.erp_formulas where root_id=formula.root_id;
    insert into public.erp_formulas(number,root_id,product_id,revision,title,output_quantity,unit_id,lines,effective_date,notes,created_by) values(public.erp_number('BOM'),formula.root_id,formula.product_id,revision_no,formula.title,formula.output_quantity,formula.unit_id,formula.lines,public.erp_today(),formula.notes,p_user) returning id into target;
    return jsonb_build_object('id',target,'entity','formulas');
   end if;
   if formula.state<>'draft' then raise exception using errcode='P0001',message='Approved formulas are immutable. Create a new revision.';end if;
  end if;
  if not exists(select from public.erp_product_units where product_id=(p->>'product_id')::uuid and unit_id=(p->>'unit_id')::uuid and is_base) then raise exception using errcode='P0001',message='Use the finished product base stock unit for the formula output.';end if;
  qty:=public.erp_qty(p->>'output_quantity');
  if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 100 then raise check_violation;end if;
  for line in select value from jsonb_array_elements(p->'lines') loop
   if not exists(select from public.erp_materials where id=(line->>'material_id')::uuid and active) then raise exception using errcode='P0001',message='Choose an active material for each formula line.';end if;
   required:=public.erp_qty(line->>'quantity');
   if coalesce((line->>'tolerance_percent')::numeric,0) not between 0 and 100 or coalesce(line->>'role','ingredient') not in ('ingredient','packaging') then raise check_violation;end if;
   normalized_lines:=normalized_lines||jsonb_build_array(jsonb_build_object('material_id',line->>'material_id','quantity',required::text,'role',coalesce(line->>'role','ingredient'),'tolerance_percent',coalesce(line->>'tolerance_percent','0'),'material',(select name from public.erp_materials where id=(line->>'material_id')::uuid),'unit',(select u.code from public.erp_materials m join public.erp_units u on u.id=m.unit_id where m.id=(line->>'material_id')::uuid)));
  end loop;
  if (select count(distinct value->>'material_id') from jsonb_array_elements(normalized_lines))<>jsonb_array_length(normalized_lines) then raise exception using errcode='P0001',message='Combine duplicate materials into one formula line.';end if;
  if target is null then insert into public.erp_formulas(number,root_id,product_id,revision,title,output_quantity,unit_id,lines,effective_date,notes,created_by) values(public.erp_number('BOM'),gen_random_uuid(),(p->>'product_id')::uuid,1,p->>'title',qty,(p->>'unit_id')::uuid,normalized_lines,(p->>'effective_date')::date,coalesce(p->>'notes',''),p_user) returning id into target;
  else update public.erp_formulas set title=p->>'title',output_quantity=qty,lines=normalized_lines,effective_date=(p->>'effective_date')::date,notes=coalesce(p->>'notes',''),version=version+1 where id=target and product_id=(p->>'product_id')::uuid and unit_id=(p->>'unit_id')::uuid;if not found then raise check_violation;end if;end if;entity:='formulas';
 elsif p_action in ('approve_formula','withdraw_formula') then
  perform public.erp_assert(p_user,'production','approve');select * into formula from public.erp_formulas where id=target for update;
  if not found or formula.version is distinct from expected_version then raise exception using errcode='P0001',message='Formula changed. Reload first.';end if;perform public.erp_approval(p_user,formula.created_by,why);
  if p_action='approve_formula' then
   if formula.state<>'draft' or formula.effective_date>public.erp_today() or exists(select from public.erp_formulas where root_id=formula.root_id and revision>formula.revision and state='approved') then raise exception using errcode='P0001',message='Approve the current effective formula revision.';end if;
   update public.erp_formulas set state='superseded',version=version+1 where root_id=formula.root_id and state='approved';
   update public.erp_formulas set state='approved',approved_by=p_user,version=version+1 where id=target;
  else update public.erp_formulas set state='withdrawn',version=version+1 where id=target and state in ('draft','approved');if not found then raise check_violation;end if;end if;entity:='formulas';
 elsif p_action='create_manufacturing_order' then
  select * into formula from public.erp_formulas where id=(p->>'formula_id')::uuid and state='approved' and effective_date<=public.erp_today();if not found then raise exception using errcode='P0001',message='Choose an approved, effective formula.';end if;
  perform public.work_assert_location(p_user,(p->>'location_id')::uuid,'write');qty:=public.erp_qty(p->>'target_quantity');
  for line in select value from jsonb_array_elements(formula.lines) loop
   required:=round((line->>'quantity')::numeric*qty/formula.output_quantity,6);if required<=0 then raise exception using errcode='P0001',message='A scaled material requirement is below stock precision. Increase the batch quantity.';end if;
   normalized_lines:=normalized_lines||jsonb_build_array(line||jsonb_build_object('required_quantity',required::text));
  end loop;
  if nullif(p->>'sales_order_id','') is not null then perform public.erp_assert(p_user,'sales','read');if not exists(select from public.erp_orders where id=(p->>'sales_order_id')::uuid and state='confirmed') then raise check_violation;end if;end if;
  insert into public.erp_manufacturing_orders(number,formula_id,formula_snapshot,product_id,target_quantity,unit_id,planned_date,location_id,sales_order_id,notes,created_by) values(public.erp_number('MO'),formula.id,to_jsonb(formula)||jsonb_build_object('requirements',normalized_lines),formula.product_id,qty,formula.unit_id,(p->>'planned_date')::date,(p->>'location_id')::uuid,nullif(p->>'sales_order_id','')::uuid,coalesce(p->>'notes',''),p_user) returning id into target;entity:='manufacturing_orders';
 else
  if p_action in ('consume_material','release_material_reservation') then
   select * into reservation from public.erp_material_reservations where id=target for update;if not found then raise no_data_found;end if;
   select * into mo from public.erp_manufacturing_orders where id=reservation.manufacturing_order_id for update;
  elsif p_action='return_manufacturing_material' then
   select * into input from public.erp_manufacturing_inputs where id=target and kind='consume';if not found then raise no_data_found;end if;
   select * into mo from public.erp_manufacturing_orders where id=input.manufacturing_order_id for update;
  else select * into mo from public.erp_manufacturing_orders where id=target for update;end if;
  if mo.id is null then raise no_data_found;end if;
  perform public.work_assert_location(p_user,mo.location_id,case when p_action in ('release_manufacturing_order','complete_manufacturing_order','close_manufacturing_order','cancel_manufacturing_order') then 'approve' else 'write' end);
  if mo.version is distinct from expected_version then raise exception using errcode='P0001',message='Production order changed. Reload before continuing.';end if;
  if mo.state in ('closed','cancelled') then raise exception using errcode='P0001',message='This production order is closed. Use a controlled linked correction.';end if;
  if p_action='release_manufacturing_order' then
   perform public.erp_assert(p_user,'production','approve');perform public.erp_approval(p_user,mo.created_by,why);
   if mo.state<>'draft' or not exists(select from public.erp_formulas where id=mo.formula_id and state='approved') then raise exception using errcode='P0001',message='Release a draft that uses a currently approved formula.';end if;
   update public.erp_manufacturing_orders set state='released',approved_by=p_user,version=version+1 where id=mo.id;
  elsif p_action='reserve_manufacturing_material' then
   perform public.erp_assert(p_user,'warehouse','write');if mo.state not in ('released','in_progress') then raise check_violation;end if;
   select * into lot from public.erp_material_lots where id=(p->>'lot_id')::uuid;
   if not found or not public.work_material_eligible(lot.id) then raise exception using errcode='P0001',message='Choose a released, eligible material lot from an approved supplier where required.';end if;
   perform public.work_assert_location(p_user,(p->>'location_id')::uuid,'write');qty:=public.erp_qty(p->>'quantity');
   select value into line from jsonb_array_elements(mo.formula_snapshot->'requirements') where value->>'material_id'=lot.material_id::text;if line is null then raise exception using errcode='P0001',message='This material is not included in the approved formula.';end if;
   required:=(line->>'required_quantity')::numeric;
   select coalesce(sum(remaining),0)+public.work_material_used(mo.id,lot.material_id) into allocated from public.erp_material_reservations where manufacturing_order_id=mo.id and material_id=lot.material_id and state='active';
   if allocated+qty>required*(1+coalesce((line->>'tolerance_percent')::numeric,0)/100) then perform public.erp_assert(p_user,'production','approve');if length(why)<3 then raise exception using errcode='P0001',message='Explain the additional material allocation above formula tolerance.';end if;end if;
   if qty>coalesce((select quantity from public.erp_material_balances where lot_id=lot.id and location_id=(p->>'location_id')::uuid),0)-public.work_material_reserved(lot.id,(p->>'location_id')::uuid) then raise exception using errcode='P0001',message='Insufficient unreserved material stock in this location.';end if;
   insert into public.erp_material_reservations(manufacturing_order_id,material_id,lot_id,location_id,quantity,remaining) values(mo.id,lot.material_id,lot.id,(p->>'location_id')::uuid,qty,qty);
   update public.erp_manufacturing_orders set version=version+1 where id=mo.id;
  elsif p_action='release_material_reservation' then
   perform public.erp_assert(p_user,'warehouse','write');if reservation.state<>'active' or length(why)<3 then raise check_violation;end if;
   update public.erp_material_reservations set state='released',remaining=0 where id=reservation.id;
   update public.erp_manufacturing_orders set version=version+1 where id=mo.id;
  elsif p_action='consume_material' then
   perform public.erp_assert(p_user,'warehouse','write');if mo.state not in ('released','in_progress') or reservation.state<>'active' then raise check_violation;end if;
   qty:=public.erp_qty(p->>'quantity');if qty>reservation.remaining or length(why)<3 or not public.work_material_eligible(reservation.lot_id) then raise exception using errcode='P0001',message='Check the eligible lot, actual quantity, remaining reservation and consumption reason.';end if;
   update public.erp_material_reservations set remaining=remaining-qty,state=case when remaining=qty then 'consumed' else 'active' end where id=reservation.id;
   insert into public.erp_material_transactions(request_key,number,kind,date,reason,created_by) values(gen_random_uuid(),public.erp_number('MUSE'),'issue',public.erp_today(),mo.number||' · actual consumption · '||why,p_user) returning id into tx;
   perform public.work_material_delta(tx,reservation.lot_id,reservation.location_id,-qty);
   insert into public.erp_manufacturing_inputs(manufacturing_order_id,reservation_id,transaction_id,lot_id,location_id,quantity,kind,measured_by,reason) values(mo.id,reservation.id,tx,reservation.lot_id,reservation.location_id,qty,'consume',p_user,why);
   update public.erp_manufacturing_orders set state='in_progress',version=version+1 where id=mo.id;
  elsif p_action='return_manufacturing_material' then
   perform public.erp_assert(p_user,'warehouse','write');if mo.state not in ('released','in_progress','completed') then raise check_violation;end if;
   qty:=public.erp_qty(p->>'quantity');if length(why)<3 or qty+coalesce((select sum(quantity) from public.erp_manufacturing_inputs where returns_id=input.id),0)>input.quantity then raise exception using errcode='P0001',message='Return only the unreturned quantity of the selected actual consumption.';end if;
   insert into public.erp_material_transactions(request_key,number,kind,date,reason,created_by) values(gen_random_uuid(),public.erp_number('MRET'),'receipt',public.erp_today(),mo.number||' · unused material return · '||why,p_user) returning id into tx;
   perform public.work_material_delta(tx,input.lot_id,input.location_id,qty);
   insert into public.erp_manufacturing_inputs(manufacturing_order_id,transaction_id,lot_id,location_id,quantity,kind,returns_id,measured_by,reason) values(mo.id,tx,input.lot_id,input.location_id,qty,'return',input.id,p_user,why);
   update public.erp_manufacturing_orders set version=version+1 where id=mo.id;
  elsif p_action='record_manufacturing_output' then
   if mo.state not in ('released','in_progress') or not exists(select from public.erp_manufacturing_inputs where manufacturing_order_id=mo.id and kind='consume') then raise exception using errcode='P0001',message='Post actual material consumption before recording finished output.';end if;
   qty:=public.erp_qty(p->>'quantity');perform public.erp_check_date((p->>'mfg_date')::date);
   if qty+coalesce((select sum(quantity) from public.erp_manufacturing_outputs where manufacturing_order_id=mo.id),0)>mo.target_quantity and not exists(select from public.erp_deviations where manufacturing_order_id=mo.id and state in ('approved','closed')) then raise exception using errcode='P0001',message='Approve a production deviation before posting output above the planned quantity.';end if;
   if length(why)<3 then raise check_violation;end if;
   result:=public.erp_mutate(p_token,'save_move',jsonb_build_object('kind','production','date',p->>'mfg_date','to_location',mo.location_id,'reason',mo.number||' · '||why,'lines',jsonb_build_array(jsonb_build_object('product_id',mo.product_id,'unit_id',mo.unit_id,'quantity',qty::text,'mfg_date',p->>'mfg_date'))));output:=(result->>'id')::uuid;
   perform public.erp_mutate(p_token,'post_move',jsonb_build_object('id',output,'version',(select version from public.erp_movements where id=output),'reason',why));
   insert into public.erp_manufacturing_outputs(manufacturing_order_id,movement_id,lot_id,quantity) select mo.id,output,(lines->0->>'lot_id')::uuid,qty from public.erp_movements where id=output;
   update public.erp_manufacturing_orders set state='in_progress',version=version+1 where id=mo.id;
  elsif p_action in ('complete_manufacturing_order','close_manufacturing_order') then
   perform public.erp_assert(p_user,'production','approve');perform public.erp_approval(p_user,mo.created_by,why);
   if exists(select from public.erp_material_reservations where manufacturing_order_id=mo.id and state='active' and remaining>0) then raise exception using errcode='P0001',message='Consume or release the remaining material reservations before reconciliation.';end if;
   select coalesce(sum(quantity),0) into actual from public.erp_manufacturing_outputs where manufacturing_order_id=mo.id;
   if actual<=0 then raise exception using errcode='P0001',message='Record actual finished output before completing production.';end if;
   for line in select value from jsonb_array_elements(mo.formula_snapshot->'requirements') loop
    required:=(line->>'required_quantity')::numeric;total:=public.work_material_used(mo.id,(line->>'material_id')::uuid);
    if abs(total-required)>required*coalesce((line->>'tolerance_percent')::numeric,0)/100 and not exists(select from public.erp_deviations where manufacturing_order_id=mo.id and state in ('approved','closed')) then raise exception using errcode='P0001',message='Approve a production deviation for material usage outside formula tolerance before completing this order.';end if;
   end loop;
   if p_action='complete_manufacturing_order' then
    if mo.state not in ('released','in_progress') then raise check_violation;end if;
    qty:=public.erp_qty(coalesce(p->>'scrap_quantity','0'),false);
    if abs(actual+qty-mo.target_quantity)>0.000001 and not exists(select from public.erp_deviations where manufacturing_order_id=mo.id and state in ('approved','closed')) then raise exception using errcode='P0001',message='Reconcile finished yield and scrap, or approve the production deviation.';end if;
    update public.erp_manufacturing_orders set state='completed',scrap_quantity=qty,closure_reason=why,version=version+1 where id=mo.id;
   else
    if mo.state<>'completed' or exists(select from public.erp_deviations where manufacturing_order_id=mo.id and state not in ('approved','closed','rejected')) then raise exception using errcode='P0001',message='Complete reconciliation and resolve open production deviations before closing.';end if;
    update public.erp_manufacturing_orders set state='closed',closure_reason=why,version=version+1 where id=mo.id;
   end if;
  elsif p_action='cancel_manufacturing_order' then
   if length(why)<3 or exists(select from public.erp_manufacturing_outputs where manufacturing_order_id=mo.id) or exists(select from public.erp_manufacturing_inputs where manufacturing_order_id=mo.id and kind='consume' and quantity>coalesce((select sum(r.quantity) from public.erp_manufacturing_inputs r where r.returns_id=erp_manufacturing_inputs.id),0)) then raise exception using errcode='P0001',message='Return all consumed materials and resolve output before cancelling a production order.';end if;
   update public.erp_material_reservations set state='released',remaining=0 where manufacturing_order_id=mo.id and state='active';
   update public.erp_manufacturing_orders set state='cancelled',closure_reason=why,version=version+1 where id=mo.id;
  else raise exception using errcode='P0001',message='Unknown manufacturing operation.';end if;
  target:=mo.id;entity:='manufacturing_orders';
 end if;return jsonb_build_object('id',target,'entity',entity);
end $$;
revoke all on function public.work_material_used(uuid,uuid),public.work_manufacturing_command(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
