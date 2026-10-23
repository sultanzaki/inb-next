begin;
alter table public.erp_material_transactions drop constraint if exists erp_material_transactions_kind_check;
alter table public.erp_material_transactions add constraint erp_material_transactions_kind_check check(kind in ('receipt','issue','reversal','transfer'));
create or replace function public.work_warehouse_command(p_token text,p_user uuid,p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
declare target uuid:=nullif(p->>'id','')::uuid;expected_version integer:=nullif(p->>'version','')::integer;why text:=btrim(coalesce(p->>'reason',''));transfer public.erp_warehouse_transfers;pallet public.erp_pallets;content public.erp_pallet_contents;item jsonb;manifest jsonb;entry record;line public.erp_transfer_lines;qty numeric;lost_qty numeric;packed numeric;balance numeric;lotid uuid;tx uuid;move uuid;counter integer:=0;entity text;prior_location uuid;destination uuid;pid uuid;begin
 perform public.erp_assert(p_user,'warehouse',case when p_action='close_warehouse_transfer' then 'approve' else 'write' end);
 if p_action in ('save_warehouse','set_warehouse_access','save_warehouse_location') then
  if not exists(select from public.users where id=p_user and role in ('admin qc','administrator inbionusa')) then raise insufficient_privilege;end if;
  if p_action='save_warehouse' then
   if target is null then insert into public.erp_warehouses(code,name,address) values(p->>'code',p->>'name',coalesce(p->>'address','')) returning id into target;
   else
    if not (p->>'active')::boolean and (exists(select from public.erp_balances b join public.erp_locations l on l.id=b.location_id where l.warehouse_id=target and b.quantity>0) or exists(select from public.erp_material_balances b join public.erp_locations l on l.id=b.location_id where l.warehouse_id=target and b.quantity>0) or exists(select from public.erp_warehouse_transfers t join public.erp_locations l on l.id in(t.from_location,t.to_location) where l.warehouse_id=target and t.state in ('draft','in_transit','partial'))) then raise exception using errcode='P0001',message='Resolve stock and transfers before deactivating this warehouse.';end if;
    update public.erp_warehouses set code=p->>'code',name=p->>'name',address=coalesce(p->>'address',''),active=(p->>'active')::boolean,version=version+1 where id=target and version=expected_version;if not found then raise exception using errcode='P0001',message='Warehouse changed. Reload first.';end if;
    update public.erp_locations set warehouse=p->>'name' where warehouse_id=target;
   end if;entity:='warehouses';
  elsif p_action='set_warehouse_access' then
   target:=(p->>'user_id')::uuid;
   if not exists(select from public.users where id=target and is_active) then raise no_data_found;end if;
   insert into public.erp_warehouse_scopes values(target,(p->>'restricted')::boolean) on conflict(user_id) do update set restricted=excluded.restricted;
   delete from public.erp_warehouse_access where user_id=target;
   for item in select value from jsonb_array_elements(p->'warehouses') loop
    insert into public.erp_warehouse_access(user_id,warehouse_id,can_read,can_write,can_approve) values(target,(item->>'warehouse_id')::uuid,(item->>'read')::boolean,(item->>'write')::boolean,(item->>'approve')::boolean);
   end loop;
   insert into public.audit_log(user_name,aksi,referensi,after_data) select nama_lengkap,'WAREHOUSE_ACCESS',target::text,p from public.users where id=p_user;entity:='warehouse_access';
  else
   if target is null then insert into public.erp_locations(code,name,warehouse_id,bin) values(p->>'code',p->>'name',(p->>'warehouse_id')::uuid,coalesce(p->>'bin','')) returning id into target;
   else
    if not (p->>'active')::boolean and (exists(select from public.erp_balances where location_id=target and quantity>0) or exists(select from public.erp_material_balances where location_id=target and quantity>0) or exists(select from public.erp_counts where location_id=target and state in ('draft','counting','submitted'))) then raise exception using errcode='P0001',message='Resolve location stock and active counts before deactivating it.';end if;
    update public.erp_locations set name=p->>'name',bin=coalesce(p->>'bin',''),active=(p->>'active')::boolean where id=target;if not found then raise no_data_found;end if;
   end if;entity:='locations';
  end if;
 elsif p_action='create_warehouse_transfer' then
  perform public.work_assert_location(p_user,(p->>'from_location')::uuid,'write');if not exists(select from public.erp_locations l join public.erp_warehouses w on w.id=l.warehouse_id where l.id=(p->>'to_location')::uuid and l.active and w.active) then raise exception using errcode='P0001',message='Choose an active transfer destination.';end if;
  if length(why)<3 or (p->>'from_location')=(p->>'to_location') then raise check_violation;end if;
  insert into public.erp_warehouse_transfers(number,from_location,to_location,date,reason,created_by) values(public.erp_number('WHT'),(p->>'from_location')::uuid,(p->>'to_location')::uuid,public.erp_today(),why,p_user) returning id into target;
  for item in select value from jsonb_array_elements(coalesce(p->'lines','[]')) loop
   qty:=public.erp_qty(item->>'quantity');
   insert into public.erp_transfer_lines(transfer_id,kind,lot_id,material_lot_id,quantity) values(target,item->>'kind',case when item->>'kind'='finished' then (item->>'lot_id')::uuid end,case when item->>'kind'='material' then (item->>'lot_id')::uuid end,qty);
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p->'pallet_ids','[]')) loop
   select * into pallet from public.erp_pallets where id=trim(both '"' from item::text)::uuid and location_id=(p->>'from_location')::uuid and state='packed';if not found then raise exception using errcode='P0001',message='Choose packed pallets in the source location.';end if;
   if exists(select from public.erp_transfer_lines where transfer_id=target and pallet_id=pallet.id) then raise check_violation;end if;
   insert into public.erp_transfer_lines(transfer_id,kind,lot_id,material_lot_id,quantity,pallet_id) select target,kind,lot_id,material_lot_id,quantity,pallet.id from public.erp_pallet_contents where pallet_id=pallet.id;
  end loop;
  if (select count(*) from public.erp_transfer_lines where transfer_id=target) not between 1 and 100 then raise exception using errcode='P0001',message='Add between one and 100 transfer lines, including pallet contents.';end if;entity:='warehouse_transfers';
 elsif p_action in ('dispatch_warehouse_transfer','receive_warehouse_transfer','close_warehouse_transfer','cancel_warehouse_transfer') then
  select * into transfer from public.erp_warehouse_transfers where id=target for update;if not found or transfer.version is distinct from expected_version then raise exception using errcode='P0001',message='Transfer changed. Reload first.';end if;
  if p_action='cancel_warehouse_transfer' then
   perform public.work_assert_location(p_user,transfer.from_location,'write');if transfer.state<>'draft' or length(why)<3 then raise exception using errcode='P0001',message='Only an undispatched draft can be cancelled.';end if;
   update public.erp_warehouse_transfers set state='cancelled',version=version+1,reason=reason||E'\n'||why where id=target;
  elsif p_action='dispatch_warehouse_transfer' then
   perform public.work_assert_location(p_user,transfer.from_location,'write');if transfer.state<>'draft' then raise exception using errcode='P0001',message='This transfer has already been dispatched or cancelled.';end if;
   if not exists(select from public.erp_locations l join public.erp_warehouses w on w.id=l.warehouse_id where l.id=transfer.to_location and l.active and w.active) then raise exception using errcode='P0001',message='Transfer destination is inactive. Cancel this draft and select an active destination.';end if;
   perform set_config('work.stock_flow','transfer',true);
   -- Pallets become an immutable in-transit manifest, not stock at the destination.
   for entry in select distinct pallet_id from public.erp_transfer_lines where transfer_id=target and pallet_id is not null loop
    select * into pallet from public.erp_pallets where id=entry.pallet_id for update;
    if pallet.state<>'packed' or pallet.location_id<>transfer.from_location or exists((select kind,lot_id,material_lot_id,quantity from public.erp_pallet_contents where pallet_id=pallet.id) except (select kind,lot_id,material_lot_id,quantity from public.erp_transfer_lines where transfer_id=target and pallet_id=pallet.id)) or exists((select kind,lot_id,material_lot_id,quantity from public.erp_transfer_lines where transfer_id=target and pallet_id=pallet.id) except (select kind,lot_id,material_lot_id,quantity from public.erp_pallet_contents where pallet_id=pallet.id)) then raise exception using errcode='P0001',message='Pallet contents changed. Recreate the transfer draft with the current manifest.';end if;
    delete from public.erp_pallet_contents where pallet_id=pallet.id;
    update public.erp_pallets set state='in_transit',location_id=null,transfer_id=target,version=version+1 where id=pallet.id;
   end loop;
   insert into public.erp_material_transactions(request_key,number,kind,date,reason,created_by) values(gen_random_uuid(),public.erp_number('WHD'),'transfer',public.erp_today(),transfer.number||' · dispatch in transit',p_user) returning id into tx;
   insert into public.erp_movements(number,kind,state,date,from_location,to_location,reason,lines,snapshot,created_by,posted_by,posted_at) values(public.erp_number('WHD'),'transfer','posted',public.erp_today(),transfer.from_location,transfer.to_location,transfer.number||' · dispatch in transit','[]',jsonb_build_object('warehouse_transfer_id',target,'stage','dispatch'),p_user,p_user,now()) returning id into move;
   for line in select * from public.erp_transfer_lines where transfer_id=target order by id loop
    counter:=counter+1;
    if line.kind='material' then perform public.work_material_delta(tx,line.material_lot_id,transfer.from_location,-line.quantity);
    else perform public.erp_delta(move,counter,line.lot_id,transfer.from_location,-line.quantity);end if;
   end loop;
   update public.erp_warehouse_transfers set state='in_transit',version=version+1 where id=target;
  elsif p_action='receive_warehouse_transfer' then
   perform public.work_assert_location(p_user,transfer.to_location,'write');if transfer.state not in ('in_transit','partial') then raise exception using errcode='P0001',message='Only dispatched outstanding quantities can be received.';end if;
   if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 100 or (select count(distinct value->>'line_id') from jsonb_array_elements(p->'lines'))<>jsonb_array_length(p->'lines') then raise check_violation;end if;
   perform set_config('work.stock_flow','transfer',true);
   insert into public.erp_material_transactions(request_key,number,kind,date,reason,created_by) values(gen_random_uuid(),public.erp_number('WHR'),'transfer',public.erp_today(),transfer.number||' · destination receipt · '||why,p_user) returning id into tx;
   insert into public.erp_movements(number,kind,state,date,from_location,to_location,reason,lines,snapshot,created_by,posted_by,posted_at) values(public.erp_number('WHR'),'transfer','posted',public.erp_today(),transfer.from_location,transfer.to_location,transfer.number||' · destination receipt','[]',jsonb_build_object('warehouse_transfer_id',target,'stage','receive'),p_user,p_user,now()) returning id into move;
   for item in select value from jsonb_array_elements(p->'lines') loop
    select * into line from public.erp_transfer_lines where id=(item->>'line_id')::uuid and transfer_id=target for update;if not found then raise no_data_found;end if;
    qty:=public.erp_qty(coalesce(item->>'quantity','0'),false);lost_qty:=public.erp_qty(coalesce(item->>'lost_quantity','0'),false);
    if qty+lost_qty<=0 or qty+lost_qty>line.quantity-line.received-line.lost then raise exception using errcode='P0001',message='Check actual received and missing quantities against the outstanding transfer line.';end if;
    if lost_qty>0 then perform public.erp_assert(p_user,'warehouse','approve');perform public.work_assert_location(p_user,transfer.to_location,'approve');perform public.erp_approval(p_user,transfer.created_by,why);end if;
    if line.pallet_id is not null and (qty+lost_qty<>line.quantity-line.received-line.lost or exists(select from public.erp_transfer_lines other where other.transfer_id=target and other.pallet_id=line.pallet_id and not exists(select from jsonb_array_elements(p->'lines') x where x->>'line_id'=other.id::text))) then raise exception using errcode='P0001',message='Account for the complete pallet manifest in one receipt; record approved shortages explicitly.';end if;
    counter:=counter+1;
    if qty>0 then
     if line.kind='material' then perform public.work_material_delta(tx,line.material_lot_id,transfer.to_location,qty);else perform public.erp_delta(move,counter,line.lot_id,transfer.to_location,qty);end if;
     if line.pallet_id is not null then insert into public.erp_pallet_contents(pallet_id,kind,material_lot_id,lot_id,quantity) values(line.pallet_id,line.kind,line.material_lot_id,line.lot_id,qty);end if;
    end if;
    update public.erp_transfer_lines set received=received+qty,lost=lost+lost_qty where id=line.id;
   end loop;
   for entry in select distinct pallet_id from public.erp_transfer_lines where transfer_id=target and pallet_id is not null and received+lost=quantity loop
    if not exists(select from public.erp_transfer_lines where transfer_id=target and pallet_id=entry.pallet_id and received+lost<quantity) then update public.erp_pallets set state=case when exists(select from public.erp_pallet_contents where pallet_id=entry.pallet_id) then 'packed' else 'empty' end,location_id=transfer.to_location,transfer_id=null,version=version+1 where id=entry.pallet_id and state='in_transit';end if;
   end loop;
   update public.erp_warehouse_transfers set state=case when exists(select from public.erp_transfer_lines where transfer_id=target and received+lost<quantity) then 'partial' when exists(select from public.erp_transfer_lines where transfer_id=target and lost>0) then 'closed' else 'received' end,version=version+1 where id=target;
  else
   perform public.erp_assert(p_user,'warehouse','approve');perform public.work_assert_location(p_user,transfer.to_location,'approve');perform public.erp_approval(p_user,transfer.created_by,why);
   if transfer.state not in ('in_transit','partial') or exists(select from public.erp_transfer_lines where transfer_id=target and pallet_id is not null and received+lost<quantity) then raise exception using errcode='P0001',message='Receive and reconcile every pallet before closing remaining loose transfer shortages.';end if;
   update public.erp_transfer_lines set lost=quantity-received where transfer_id=target and received+lost<quantity;
   update public.erp_warehouse_transfers set state='closed',reason=reason||E'\n'||why,version=version+1 where id=target;
  end if;perform set_config('work.stock_flow','',true);entity:='warehouse_transfers';
 elsif p_action='create_pallet' then
  perform public.work_assert_location(p_user,(p->>'location_id')::uuid,'write');
  insert into public.erp_pallets(number,location_id,notes,created_by) values(public.erp_number('PAL'),(p->>'location_id')::uuid,coalesce(p->>'notes',''),p_user) returning id into target;entity:='pallets';
 elsif p_action in ('pack_pallet','unpack_pallet','repack_pallet','move_pallet','retire_pallet') then
  select * into pallet from public.erp_pallets where id=target for update;if not found or pallet.version is distinct from expected_version then raise exception using errcode='P0001',message='Pallet changed. Reload first.';end if;
  perform public.work_assert_location(p_user,pallet.location_id,'write');if pallet.state not in ('empty','packed') then raise exception using errcode='P0001',message='This pallet is in transit, dispatched or retired.';end if;
  if p_action='pack_pallet' then
   qty:=public.erp_qty(p->>'quantity');lotid:=(p->>'lot_id')::uuid;
   if p->>'kind'='material' then select quantity into balance from public.erp_material_balances where lot_id=lotid and location_id=pallet.location_id;
   elsif p->>'kind'='finished' then select quantity into balance from public.erp_balances where lot_id=lotid and location_id=pallet.location_id;else raise check_violation;end if;
   if qty>coalesce(balance,0)-public.work_packed(p->>'kind',lotid,pallet.location_id) then raise exception using errcode='P0001',message='Pallet quantity exceeds unpacked stock at this location.';end if;
   select * into content from public.erp_pallet_contents where pallet_id=target and kind=p->>'kind' and coalesce(material_lot_id,lot_id)=lotid;
   if found then update public.erp_pallet_contents set quantity=quantity+qty where id=content.id;
   else insert into public.erp_pallet_contents(pallet_id,kind,material_lot_id,lot_id,quantity) values(target,p->>'kind',case when p->>'kind'='material' then lotid end,case when p->>'kind'='finished' then lotid end,qty);end if;
   update public.erp_pallets set state='packed',version=version+1 where id=target;
  elsif p_action='unpack_pallet' then
   select * into content from public.erp_pallet_contents where id=(p->>'content_id')::uuid and pallet_id=target for update;if not found then raise no_data_found;end if;
   qty:=public.erp_qty(p->>'quantity');if qty>content.quantity or length(why)<3 then raise check_violation;end if;
   if qty=content.quantity then delete from public.erp_pallet_contents where id=content.id;else update public.erp_pallet_contents set quantity=quantity-qty where id=content.id;end if;
   update public.erp_pallets set state=case when exists(select from public.erp_pallet_contents where pallet_id=target) then 'packed' else 'empty' end,version=version+1 where id=target;
  elsif p_action='repack_pallet' then
   pid:=(p->>'destination_pallet')::uuid;
   if pid=target or length(why)<3 then raise check_violation;end if;
   if not exists(select from public.erp_pallets where id=pid and version=(p->>'destination_version')::integer and location_id=pallet.location_id and state in ('empty','packed')) then raise exception using errcode='P0001',message='Choose a current pallet in the same location. Reload if its contents changed.';end if;
   select * into content from public.erp_pallet_contents where id=(p->>'content_id')::uuid and pallet_id=target for update;if not found then raise no_data_found;end if;
   qty:=public.erp_qty(p->>'quantity');if qty>content.quantity then raise check_violation;end if;
   update public.erp_pallet_contents set quantity=quantity+qty where pallet_id=pid and kind=content.kind and coalesce(material_lot_id,lot_id)=coalesce(content.material_lot_id,content.lot_id);
   if not found then insert into public.erp_pallet_contents(pallet_id,kind,material_lot_id,lot_id,quantity) values(pid,content.kind,content.material_lot_id,content.lot_id,qty);end if;
   if qty=content.quantity then delete from public.erp_pallet_contents where id=content.id;else update public.erp_pallet_contents set quantity=quantity-qty where id=content.id;end if;
   update public.erp_pallets set state=case when exists(select from public.erp_pallet_contents where pallet_id=target) then 'packed' else 'empty' end,version=version+1 where id=target;
   update public.erp_pallets set state='packed',version=version+1 where id=pid;
  elsif p_action='retire_pallet' then
   if pallet.state<>'empty' or length(why)<3 then raise exception using errcode='P0001',message='Unpack this pallet before retiring it.';end if;
   update public.erp_pallets set state='retired',notes=notes||E'\n'||why,version=version+1 where id=target;
  else
   destination:=(p->>'location_id')::uuid;perform public.work_assert_location(p_user,destination,'write');
   if destination=pallet.location_id or (select warehouse_id from public.erp_locations where id=destination)<>(select warehouse_id from public.erp_locations where id=pallet.location_id) then raise exception using errcode='P0001',message='Use an in-transit warehouse transfer when moving a pallet to another warehouse.';end if;
   if length(why)<3 then raise check_violation;end if;
   select coalesce(jsonb_agg(to_jsonb(c)),'[]') into manifest from public.erp_pallet_contents c where pallet_id=target;
   delete from public.erp_pallet_contents where pallet_id=target;perform set_config('work.stock_flow','transfer',true);
   insert into public.erp_material_transactions(request_key,number,kind,date,reason,created_by) values(gen_random_uuid(),public.erp_number('PAL'),'transfer',public.erp_today(),pallet.number||' · '||why,p_user) returning id into tx;
   insert into public.erp_movements(number,kind,state,date,from_location,to_location,reason,lines,snapshot,created_by,posted_by,posted_at) values(public.erp_number('PAL'),'transfer','posted',public.erp_today(),pallet.location_id,destination,pallet.number||' · '||why,'[]',jsonb_build_object('pallet_id',target),p_user,p_user,now()) returning id into move;
   for item in select value from jsonb_array_elements(manifest) loop
    counter:=counter+1;qty:=(item->>'quantity')::numeric;
    if item->>'kind'='material' then perform public.work_material_delta(tx,(item->>'material_lot_id')::uuid,pallet.location_id,-qty);perform public.work_material_delta(tx,(item->>'material_lot_id')::uuid,destination,qty);
    else perform public.erp_delta(move,counter,(item->>'lot_id')::uuid,pallet.location_id,-qty);perform public.erp_delta(move,counter,(item->>'lot_id')::uuid,destination,qty);end if;
    insert into public.erp_pallet_contents(pallet_id,kind,material_lot_id,lot_id,quantity) values(target,item->>'kind',nullif(item->>'material_lot_id','')::uuid,nullif(item->>'lot_id','')::uuid,qty);
   end loop;
   update public.erp_pallets set location_id=destination,version=version+1 where id=target;perform set_config('work.stock_flow','',true);
  end if;entity:='pallets';
 elsif p_action='dispatch_pallet_delivery' then
  select * into pallet from public.erp_pallets where id=(p->>'pallet_id')::uuid for update;
  if not found or pallet.version is distinct from (p->>'pallet_version')::integer or pallet.state<>'packed' then raise exception using errcode='P0001',message='Choose a current packed pallet.';end if;
  perform public.work_assert_location(p_user,pallet.location_id,'write');
  if not exists(select from public.erp_movements where id=target and kind='delivery' and state='draft' and from_location=pallet.location_id and version=expected_version) then raise exception using errcode='P0001',message='Choose a current draft delivery from the pallet location.';end if;
  if jsonb_typeof(p->'contents')<>'array' or jsonb_array_length(p->'contents')<1 or (select count(distinct value->>'content_id') from jsonb_array_elements(p->'contents'))<>jsonb_array_length(p->'contents') then raise check_violation;end if;
  for item in select value from jsonb_array_elements(p->'contents') loop
   select * into content from public.erp_pallet_contents where id=(item->>'content_id')::uuid and pallet_id=pallet.id and kind='finished' for update;if not found then raise no_data_found;end if;
   qty:=public.erp_qty(item->>'quantity');
   if qty>content.quantity or qty>coalesce((select sum((x->>'base_quantity')::numeric) from public.erp_movements m cross join lateral jsonb_array_elements(m.lines) x where m.id=target and x->>'lot_id'=content.lot_id::text),0) then raise exception using errcode='P0001',message='Pallet selection exceeds the delivery or packed quantity.';end if;
   if qty=content.quantity then delete from public.erp_pallet_contents where id=content.id;else update public.erp_pallet_contents set quantity=quantity-qty where id=content.id;end if;
  end loop;
  perform public.erp_mutate(p_token,'post_move',jsonb_build_object('id',target,'version',expected_version));
  update public.erp_pallets set state=case when exists(select from public.erp_pallet_contents where pallet_id=pallet.id) then 'packed' else 'dispatched' end,version=version+1 where id=pallet.id;
  perform public.work_event('pallets',pallet.id,'dispatch_pallet_delivery',p_user,why,to_jsonb(pallet),jsonb_build_object('delivery_id',target,'contents',p->'contents'));entity:='movements';
 else raise exception using errcode='P0001',message='Unknown warehouse operation.';end if;
 return jsonb_build_object('id',target,'entity',entity);
end $$;
revoke all on function public.work_warehouse_command(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
