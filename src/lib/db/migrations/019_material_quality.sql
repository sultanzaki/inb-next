begin;
create or replace function public.work_capture_event() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=nullif(current_setting('inb.actor',true),'')::uuid;r jsonb;begin
 if actor is null then return new;end if;
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 perform public.work_event(substr(tg_table_name,5),(r->>'id')::uuid,coalesce(nullif(current_setting('inb.action',true),''),lower(tg_op)),actor,current_setting('inb.reason',true),case when tg_op='INSERT' then '{}' else to_jsonb(old) end,case when tg_op='DELETE' then '{}' else to_jsonb(new) end);
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$declare t text;begin
 foreach t in array array['erp_warehouses','erp_approved_suppliers','erp_material_specs','erp_incoming_inspections','erp_controlled_documents','erp_formulas','erp_manufacturing_orders','erp_material_reservations','erp_manufacturing_inputs','erp_manufacturing_outputs','erp_deviations','erp_capas','erp_warehouse_transfers','erp_transfer_lines','erp_pallets','erp_pallet_contents','erp_sample_requests','erp_customer_interactions','erp_document_distributions'] loop
 execute format('drop trigger if exists work_capture_event on public.%I',t);
 execute format('create trigger work_capture_event after insert or update or delete on public.%I for each row execute function public.work_capture_event()',t);
 end loop;
end $$;
create or replace function public.work_quality_command(p_user uuid,p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
declare target uuid:=nullif(p->>'id','')::uuid;expected_version integer:=nullif(p->>'version','')::integer;why text:=btrim(coalesce(p->>'reason',''));spec public.erp_material_specs;inspection public.erp_incoming_inspections;lot public.erp_material_lots;qualification public.erp_approved_suppliers;deviation public.erp_deviations;capa public.erp_capas;document public.erp_controlled_documents;root uuid;rev integer;item jsonb;result jsonb;measured text;pass boolean:=true;tx uuid;qty numeric;entity text;begin
 perform public.erp_assert(p_user,case when p_action like '%controlled_document' then 'documents' else 'quality' end,case when p_action in ('approve_material_spec','withdraw_material_spec','approve_supplier','withdraw_supplier','retest_incoming_inspection','finalize_incoming_inspection','approve_deviation','close_deviation','verify_capa','publish_controlled_document','withdraw_controlled_document','set_material_quality_policy') then 'approve' else 'write' end);
 if p_action in ('save_material_spec','revise_material_spec') then
  if target is not null then
   select * into spec from public.erp_material_specs where id=target for update;
   if not found or spec.version is distinct from expected_version then raise exception using errcode='P0001',message='Specification changed. Reload before editing.';end if;
   if p_action='revise_material_spec' then
    if spec.state not in ('approved','superseded') then raise check_violation;end if;
    root:=spec.root_id;select coalesce(max(revision),0)+1 into rev from public.erp_material_specs where material_id=spec.material_id;
    insert into public.erp_material_specs(root_id,material_id,revision,title,parameters,effective_date,created_by) values(root,spec.material_id,rev,spec.title,spec.parameters,public.erp_today(),p_user) returning id into target;
    return jsonb_build_object('id',target,'entity','material_specs');
   end if;
   if spec.state<>'draft' then raise exception using errcode='P0001',message='Published specifications are immutable. Create a new revision.';end if;
  end if;
  if jsonb_typeof(p->'parameters')<>'array' or jsonb_array_length(p->'parameters') not between 1 and 100 then raise check_violation;end if;
  for item in select value from jsonb_array_elements(p->'parameters') loop
   if length(btrim(item->>'name'))<1 or item->>'kind' not in ('range','text') then raise check_violation;end if;
   if item->>'kind'='range' then
    if nullif(item->>'minimum','') is null and nullif(item->>'maximum','') is null then raise exception using errcode='P0001',message='Set a minimum or maximum for every numeric parameter.';end if;
    if nullif(item->>'minimum','')::numeric>nullif(item->>'maximum','')::numeric then raise check_violation;end if;
   elsif length(btrim(coalesce(item->>'expected','')))=0 then raise check_violation;end if;
  end loop;
  if (select count(distinct lower(value->>'name')) from jsonb_array_elements(p->'parameters'))<>jsonb_array_length(p->'parameters') then raise exception using errcode='P0001',message='Parameter names must be unique.';end if;
  if target is null then
   root:=gen_random_uuid();select coalesce(max(revision),0)+1 into rev from public.erp_material_specs where material_id=(p->>'material_id')::uuid;
   insert into public.erp_material_specs(root_id,material_id,revision,title,parameters,effective_date,created_by) values(root,(p->>'material_id')::uuid,rev,p->>'title',p->'parameters',(p->>'effective_date')::date,p_user) returning id into target;
  else update public.erp_material_specs set title=p->>'title',parameters=p->'parameters',effective_date=(p->>'effective_date')::date,version=version+1 where id=target;end if;entity:='material_specs';
 elsif p_action in ('approve_material_spec','withdraw_material_spec') then
  perform public.erp_assert(p_user,'quality','approve');select * into spec from public.erp_material_specs where id=target for update;
  if not found or spec.version is distinct from expected_version then raise exception using errcode='P0001',message='Specification changed. Reload first.';end if;
  perform public.erp_approval(p_user,spec.created_by,why);
  if p_action='approve_material_spec' then
   if spec.state<>'draft' or spec.effective_date>public.erp_today() or exists(select from public.erp_material_specs where material_id=spec.material_id and state='approved' and revision>spec.revision) then raise check_violation;end if;
   update public.erp_material_specs set state='superseded',version=version+1 where material_id=spec.material_id and state='approved';
   update public.erp_material_specs set state='approved',approved_by=p_user,version=version+1 where id=target;
  else update public.erp_material_specs set state='withdrawn',version=version+1 where id=target and state in ('draft','approved');if not found then raise check_violation;end if;end if;entity:='material_specs';
 elsif p_action='save_approved_supplier' then
  if target is not null then select * into qualification from public.erp_approved_suppliers where id=target for update;if not found or qualification.state<>'draft' or qualification.version is distinct from expected_version then raise check_violation;end if;
   update public.erp_approved_suppliers set effective_date=(p->>'effective_date')::date,expiry_date=nullif(p->>'expiry_date','')::date,reason=why,version=version+1 where id=target;
  else insert into public.erp_approved_suppliers(material_id,supplier_id,effective_date,expiry_date,reason,created_by) values((p->>'material_id')::uuid,(p->>'supplier_id')::uuid,(p->>'effective_date')::date,nullif(p->>'expiry_date','')::date,why,p_user) returning id into target;end if;entity:='approved_suppliers';
 elsif p_action in ('approve_supplier','withdraw_supplier') then
  perform public.erp_assert(p_user,'quality','approve');select * into qualification from public.erp_approved_suppliers where id=target for update;
  if not found or qualification.version is distinct from expected_version then raise exception using errcode='P0001',message='Supplier qualification changed. Reload first.';end if;
  perform public.erp_approval(p_user,qualification.created_by,why);
  if p_action='approve_supplier' then
   if qualification.state<>'draft' or qualification.effective_date>public.erp_today() or qualification.expiry_date<public.erp_today() then raise check_violation;end if;
   update public.erp_approved_suppliers set state='withdrawn',version=version+1 where material_id=qualification.material_id and supplier_id=qualification.supplier_id and state='approved';
   update public.erp_approved_suppliers set state='approved',approved_by=p_user,reason=why,version=version+1 where id=target;
  else update public.erp_approved_suppliers set state='withdrawn',reason=why,version=version+1 where id=target and state='approved';if not found then raise check_violation;end if;end if;entity:='approved_suppliers';
 elsif p_action in ('create_incoming_inspection','retest_incoming_inspection') then
  if p_action='retest_incoming_inspection' then
   perform public.erp_assert(p_user,'quality','approve');select * into inspection from public.erp_incoming_inspections where id=target;
   if not found or inspection.version is distinct from expected_version or inspection.state not in ('pass','fail') then raise check_violation;end if;
   if not exists(select from public.erp_deviations where id=(p->>'deviation_id')::uuid and state='approved' and (inspection_id=inspection.id or material_lot_id=inspection.lot_id)) then raise exception using errcode='P0001',message='Approve a deviation for this lot or inspection before retesting.';end if;
   select * into lot from public.erp_material_lots where id=inspection.lot_id;
  else select * into lot from public.erp_material_lots where id=(p->>'lot_id')::uuid;end if;
  if lot.id is null or not exists(select from public.erp_material_balances b where b.lot_id=lot.id and b.quantity>0 and public.work_location_allowed(p_user,b.location_id,'read')) then raise insufficient_privilege;end if;
  if p_action='create_incoming_inspection' and exists(select from public.erp_incoming_inspections where lot_id=lot.id and state in ('pass','fail')) then raise exception using errcode='P0001',message='This lot already has a finalized inspection. Use a deviation-approved retest.';end if;
  select * into spec from public.erp_material_specs where material_id=lot.material_id and state='approved' and effective_date<=public.erp_today();if not found then raise exception using errcode='P0001',message='Approve an effective specification for this material before inspection.';end if;
  if exists(select from public.erp_incoming_inspections where lot_id=lot.id and state='draft') then raise exception using errcode='P0001',message='Complete the existing inspection draft for this lot first.';end if;
  if p_action='create_incoming_inspection' and nullif(p->>'receipt_id','') is not null and not exists(select from public.erp_material_ledger where transaction_id=(p->>'receipt_id')::uuid and lot_id=lot.id and delta>0) then raise exception using errcode='P0001',message='The selected receipt does not contain this material lot.';end if;
  insert into public.erp_incoming_inspections(number,lot_id,receipt_id,spec_id,spec_snapshot,date,previous_id,created_by) values(public.erp_number('IQC'),lot.id,case when p_action='retest_incoming_inspection' then inspection.receipt_id else nullif(p->>'receipt_id','')::uuid end,spec.id,to_jsonb(spec),public.erp_today(),case when p_action='retest_incoming_inspection' then inspection.id end,p_user) returning id into target;
  update public.erp_material_lots set quality_status='quarantine' where id=lot.id;entity:='incoming_inspections';
 elsif p_action in ('save_incoming_results','finalize_incoming_inspection') then
  select * into inspection from public.erp_incoming_inspections where id=target for update;
  if not found or inspection.version is distinct from expected_version or inspection.state<>'draft' then raise exception using errcode='P0001',message='Inspection changed or was finalized. Reload first.';end if;
  if jsonb_typeof(p->'results')<>'array' then raise check_violation;end if;
  if p_action='finalize_incoming_inspection' then
   perform public.erp_assert(p_user,'quality','approve');perform public.erp_approval(p_user,inspection.created_by,why);
   if jsonb_array_length(p->'results')<>jsonb_array_length(inspection.spec_snapshot->'parameters') then raise exception using errcode='P0001',message='Complete every inspection parameter before finalizing.';end if;
   for item in select value from jsonb_array_elements(inspection.spec_snapshot->'parameters') loop
    if (select count(*) from jsonb_array_elements(p->'results') r where r->>'name'=item->>'name')<>1 then raise exception using errcode='P0001',message='Each specification parameter needs exactly one result.';end if;
    select value->>'value' into measured from jsonb_array_elements(p->'results') where value->>'name'=item->>'name';
    if measured is null or btrim(measured)='' then raise check_violation;end if;
    if item->>'kind'='range' then
     if measured !~ '^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' then raise exception using errcode='P0001',message='Enter a numeric result for each numeric parameter.';end if;
     if measured::numeric<nullif(item->>'minimum','')::numeric or measured::numeric>nullif(item->>'maximum','')::numeric then pass:=false;end if;
    elsif lower(btrim(measured))<>lower(btrim(item->>'expected')) then pass:=false;end if;
   end loop;
   if not pass and length(btrim(coalesce(p->>'failure_reason','')))<3 then raise exception using errcode='P0001',message='Explain the failed inspection before finalizing.';end if;
   select * into lot from public.erp_material_lots where id=inspection.lot_id;
   if pass and exists(select from public.erp_materials m where id=lot.material_id and requires_approved_supplier) and not exists(select from public.erp_approved_suppliers where material_id=lot.material_id and supplier_id=lot.supplier_id and state='approved' and effective_date<=public.erp_today() and (expiry_date is null or expiry_date>=public.erp_today())) then raise exception using errcode='P0001',message='Approve this supplier for the material before releasing its lot.';end if;
   update public.erp_material_lots set quality_status=case when pass then 'released' else 'rejected' end,inspection_id=inspection.id where id=inspection.lot_id;
  end if;
  update public.erp_incoming_inspections set results=p->'results',failure_reason=coalesce(p->>'failure_reason',''),state=case when p_action='save_incoming_results' then 'draft' when pass then 'pass' else 'fail' end,approved_by=case when p_action='finalize_incoming_inspection' then p_user end,version=version+1 where id=target;entity:='incoming_inspections';
 elsif p_action='save_deviation' then
  if target is null then insert into public.erp_deviations(number,title,description,material_lot_id,manufacturing_order_id,inspection_id,assignee,due_date,created_by,investigation,disposition) values(public.erp_number('DEV'),p->>'title',p->>'description',nullif(p->>'material_lot_id','')::uuid,nullif(p->>'manufacturing_order_id','')::uuid,nullif(p->>'inspection_id','')::uuid,nullif(p->>'assignee','')::uuid,(p->>'due_date')::date,p_user,coalesce(p->>'investigation',''),coalesce(p->>'disposition','')) returning id into target;
  else update public.erp_deviations set investigation=p->>'investigation',disposition=p->>'disposition',assignee=nullif(p->>'assignee','')::uuid,due_date=(p->>'due_date')::date,state='investigating',version=version+1 where id=target and version=expected_version and state in ('open','investigating');if not found then raise check_violation;end if;end if;entity:='deviations';
 elsif p_action in ('submit_deviation','approve_deviation','close_deviation') then
  select * into deviation from public.erp_deviations where id=target for update;if not found or deviation.version is distinct from expected_version then raise exception using errcode='P0001',message='Deviation changed. Reload first.';end if;
  if p_action='submit_deviation' then
   if deviation.state not in ('open','investigating') or length(btrim(deviation.investigation))<3 or length(btrim(deviation.disposition))<3 then raise exception using errcode='P0001',message='Record the investigation and proposed disposition before review.';end if;
   update public.erp_deviations set state='awaiting_approval',version=version+1 where id=target;
  else
   perform public.erp_assert(p_user,'quality','approve');perform public.erp_approval(p_user,deviation.created_by,why);
   if p_action='approve_deviation' then if deviation.state<>'awaiting_approval' then raise check_violation;end if;update public.erp_deviations set state='approved',approved_by=p_user,version=version+1 where id=target;
   else if deviation.state<>'approved' or exists(select from public.erp_capas where deviation_id=target and state not in ('verified','cancelled')) then raise exception using errcode='P0001',message='Verify the linked CAPA actions before closing this approved deviation.';end if;update public.erp_deviations set state='closed',version=version+1 where id=target;end if;
  end if;entity:='deviations';
 elsif p_action='save_capa' then
  if not exists(select from public.erp_deviations where id=(p->>'deviation_id')::uuid and state<>'closed') then raise check_violation;end if;
  if target is null then insert into public.erp_capas(number,deviation_id,title,kind,action,assignee,due_date,created_by,evidence,effectiveness) values(public.erp_number('CAPA'),(p->>'deviation_id')::uuid,p->>'title',p->>'kind',p->>'action',(p->>'assignee')::uuid,(p->>'due_date')::date,p_user,coalesce(p->>'evidence',''),coalesce(p->>'effectiveness','')) returning id into target;
  else update public.erp_capas set action=p->>'action',evidence=coalesce(p->>'evidence',''),effectiveness=coalesce(p->>'effectiveness',''),state='in_progress',version=version+1 where id=target and version=expected_version and state in ('open','in_progress');if not found then raise check_violation;end if;end if;entity:='capas';
 elsif p_action in ('submit_capa','verify_capa') then
  select * into capa from public.erp_capas where id=target for update;if not found or capa.version is distinct from expected_version then raise check_violation;end if;
  if p_action='submit_capa' then
   if capa.state not in ('open','in_progress') or length(btrim(capa.evidence))<3 then raise exception using errcode='P0001',message='Attach completion evidence before submitting the CAPA.';end if;
   update public.erp_capas set state='awaiting_review',version=version+1 where id=target;
  else perform public.erp_assert(p_user,'quality','approve');perform public.erp_approval(p_user,capa.created_by,why);
   if capa.state<>'awaiting_review' or length(btrim(coalesce(p->>'effectiveness','')))<3 then raise exception using errcode='P0001',message='Review effectiveness before verifying this CAPA.';end if;
   update public.erp_capas set state='verified',approved_by=p_user,effectiveness=p->>'effectiveness',version=version+1 where id=target;
  end if;entity:='capas';
 elsif p_action in ('save_controlled_document','revise_controlled_document') then
  if target is not null then select * into document from public.erp_controlled_documents where id=target for update;if not found or document.version is distinct from expected_version then raise check_violation;end if;
   if p_action='revise_controlled_document' then
    if document.state not in ('published','superseded') then raise check_violation;end if;
    select max(revision)+1 into rev from public.erp_controlled_documents where root_id=document.root_id;
    insert into public.erp_controlled_documents(number,root_id,material_id,supplier_id,title,kind,language,revision,file_url,effective_date,expiry_date,created_by) values(public.erp_number('QDOC'),document.root_id,document.material_id,document.supplier_id,document.title,document.kind,document.language,rev,document.file_url,public.erp_today(),null,p_user) returning id into target;
    return jsonb_build_object('id',target,'entity','controlled_documents');
   end if;
   if document.state<>'draft' then raise exception using errcode='P0001',message='Published documents require a new revision.';end if;
   update public.erp_controlled_documents set title=p->>'title',file_url=p->>'file_url',effective_date=(p->>'effective_date')::date,expiry_date=nullif(p->>'expiry_date','')::date,version=version+1 where id=target;
  else insert into public.erp_controlled_documents(number,root_id,material_id,supplier_id,title,kind,language,revision,file_url,effective_date,expiry_date,created_by) values(public.erp_number('QDOC'),gen_random_uuid(),nullif(p->>'material_id','')::uuid,nullif(p->>'supplier_id','')::uuid,p->>'title',p->>'kind',p->>'language',1,p->>'file_url',(p->>'effective_date')::date,nullif(p->>'expiry_date','')::date,p_user) returning id into target;end if;entity:='controlled_documents';
 elsif p_action in ('publish_controlled_document','withdraw_controlled_document') then
  perform public.erp_assert(p_user,'documents','approve');select * into document from public.erp_controlled_documents where id=target for update;
  if not found or document.version is distinct from expected_version then raise check_violation;end if;perform public.erp_approval(p_user,document.created_by,why);
  if p_action='publish_controlled_document' then
   if document.state<>'draft' or document.effective_date>public.erp_today() or document.expiry_date<public.erp_today() or exists(select from public.erp_controlled_documents where root_id=document.root_id and revision>document.revision and state='published') then raise exception using errcode='P0001',message='Publish an effective, non-expired latest draft.';end if;
   update public.erp_controlled_documents set state='superseded',version=version+1 where root_id=document.root_id and state='published';
   update public.erp_controlled_documents set state='published',approved_by=p_user,version=version+1 where id=target;
  else update public.erp_controlled_documents set state='withdrawn',version=version+1 where id=target and state in ('draft','published');if not found then raise check_violation;end if;end if;entity:='controlled_documents';
 elsif p_action='set_material_quality_policy' then
  perform public.erp_assert(p_user,'quality','approve');if length(why)<3 then raise check_violation;end if;
  update public.erp_materials set requires_qc=(p->>'requires_qc')::boolean,requires_approved_supplier=(p->>'requires_approved_supplier')::boolean,version=version+1 where id=target and version=expected_version;
  if not found then raise exception using errcode='P0001',message='Material policy changed. Reload before saving.';end if;entity:='materials';
 else raise exception using errcode='P0001',message='Unknown material Quality operation.';end if;
 return jsonb_build_object('id',target,'entity',entity);
end $$;
revoke all on function public.work_capture_event(),public.work_quality_command(uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
