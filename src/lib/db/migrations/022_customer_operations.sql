begin;
alter table public.erp_sample_requests add column if not exists base_quantity numeric(24,6);
-- Prepared samples reserve physical stock using the same availability invariant as Sales.
create or replace function public.erp_reserved(lot uuid,loc uuid) returns numeric language sql stable set search_path=pg_catalog,public as $$
 select coalesce((select sum(remaining) from public.erp_reservations where lot_id=lot and location_id=loc and state='active'),0)+coalesce((select sum(base_quantity) from public.erp_sample_requests where lot_id=lot and location_id=loc and state='prepared'),0)
$$;
create or replace function public.work_customer_command(p_token text,p_user uuid,p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_column
declare target uuid:=nullif(p->>'id','')::uuid;expected_version integer:=nullif(p->>'version','')::integer;why text:=btrim(coalesce(p->>'reason',''));sample public.erp_sample_requests;distribution public.erp_document_distributions;document public.erp_product_documents;lot public.erp_lots;factor numeric;qty numeric;move uuid;result jsonb;entity text;begin
 perform public.erp_assert(p_user,'crm',case when p_action='approve_sample' then 'approve' else 'write' end);
 if p_action='create_sample_request' then
  perform public.erp_assert(p_user,'sales','read');
  if not exists(select from public.erp_product_units where product_id=(p->>'product_id')::uuid and unit_id=(p->>'unit_id')::uuid) then raise exception using errcode='P0001',message='Choose a configured product unit for this sample.';end if;
  if nullif(p->>'opportunity_id','') is not null and not exists(select from public.erp_opportunities where id=(p->>'opportunity_id')::uuid and customer_id=(p->>'customer_id')::uuid) then raise exception using errcode='P0001',message='The opportunity must belong to the selected customer.';end if;
  insert into public.erp_sample_requests(number,customer_id,opportunity_id,product_id,quantity,unit_id,purpose,due_date,assignee,created_by) values(public.erp_number('SMP'),(p->>'customer_id')::uuid,nullif(p->>'opportunity_id','')::uuid,(p->>'product_id')::uuid,public.erp_qty(p->>'quantity'),(p->>'unit_id')::uuid,p->>'purpose',(p->>'due_date')::date,nullif(p->>'assignee','')::uuid,p_user) returning id into target;entity:='sample_requests';
 elsif p_action in ('approve_sample','prepare_sample','ship_sample','record_sample_feedback','create_sample_quotation','cancel_sample') then
  select * into sample from public.erp_sample_requests where id=target for update;
  if not found or sample.version is distinct from expected_version then raise exception using errcode='P0001',message='Sample request changed. Reload first.';end if;
  if p_action='approve_sample' then
   perform public.erp_assert(p_user,'crm','approve');perform public.erp_approval(p_user,sample.created_by,why);if sample.state<>'requested' then raise check_violation;end if;
   update public.erp_sample_requests set state='approved',version=version+1 where id=target;
  elsif p_action='prepare_sample' then
   perform public.erp_assert(p_user,'warehouse','write');perform public.work_assert_location(p_user,(p->>'location_id')::uuid,'write');
   select * into lot from public.erp_lots where id=(p->>'lot_id')::uuid and product_id=sample.product_id and qc_status='released' and not held and expiry_date>=public.erp_today();
   if not found or sample.state<>'approved' then raise exception using errcode='P0001',message='Prepare an approved sample using a released, unexpired product lot.';end if;
   select pu.factor into factor from public.erp_product_units pu where pu.product_id=sample.product_id and pu.unit_id=sample.unit_id;qty:=round(sample.quantity*factor,6);
   if qty<=0 or qty>coalesce((select quantity from public.erp_balances where lot_id=lot.id and location_id=(p->>'location_id')::uuid),0)-public.erp_reserved(lot.id,(p->>'location_id')::uuid) then raise exception using errcode='P0001',message='Insufficient available stock for this sample.';end if;
   update public.erp_sample_requests set state='prepared',lot_id=lot.id,location_id=(p->>'location_id')::uuid,base_quantity=qty,version=version+1 where id=target;
  elsif p_action='ship_sample' then
   perform public.erp_assert(p_user,'warehouse','write');perform public.work_assert_location(p_user,sample.location_id,'write');
   if sample.state<>'prepared' or length(btrim(coalesce(p->>'tracking_reference','')))<1 then raise exception using errcode='P0001',message='Prepare the sample and record its shipping reference first.';end if;
   if not exists(select from public.erp_lots where id=sample.lot_id and qc_status='released' and not held and expiry_date>=public.erp_today()) then raise exception using errcode='P0001',message='The sample lot is no longer released or has expired.';end if;
   -- Release this sample's reservation only inside the atomic posting transaction.
   update public.erp_sample_requests set state='shipped' where id=target;
   result:=public.erp_mutate(p_token,'save_move',jsonb_build_object('kind','issue','date',public.erp_today(),'from_location',sample.location_id,'reason','Customer sample '||sample.number||' · '||why,'lines',jsonb_build_array(jsonb_build_object('lot_id',sample.lot_id,'unit_id',(select unit_id from public.erp_product_units where product_id=sample.product_id and is_base),'quantity',sample.base_quantity::text))));move:=(result->>'id')::uuid;
   perform public.erp_mutate(p_token,'post_move',jsonb_build_object('id',move,'version',(select version from public.erp_movements where id=move)));
   update public.erp_sample_requests set movement_id=move,tracking_reference=p->>'tracking_reference',version=version+1 where id=target;
  elsif p_action='record_sample_feedback' then
   if sample.state not in ('shipped','feedback') or length(btrim(coalesce(p->>'feedback','')))<3 then raise exception using errcode='P0001',message='Record customer feedback for a shipped sample.';end if;
   update public.erp_sample_requests set state='feedback',feedback=p->>'feedback',version=version+1 where id=target;
  elsif p_action='create_sample_quotation' then
   perform public.erp_assert(p_user,'sales','write');if sample.state<>'feedback' or sample.quote_id is not null then raise exception using errcode='P0001',message='Record sample feedback before creating its linked quotation.';end if;
   result:=public.erp_mutate(p_token,'save_quote',jsonb_build_object('customer_id',sample.customer_id,'opportunity_id',sample.opportunity_id,'date',public.erp_today(),'valid_until',p->>'valid_until','currency',p->>'currency','terms',coalesce(p->>'terms',''),'delivery_terms','','lead_time','','tax_rate',coalesce(p->>'tax_rate','0'),'freight','0','lines',jsonb_build_array(jsonb_build_object('product_id',sample.product_id,'unit_id',sample.unit_id,'quantity',public.erp_qty(p->>'quantity')::text,'price',public.erp_qty(p->>'price',false)::text,'discount','0'))));
   update public.erp_sample_requests set state='converted',quote_id=(result->>'id')::uuid,version=version+1 where id=target;
  else
   if sample.state not in ('requested','approved','prepared') or length(why)<3 then raise exception using errcode='P0001',message='Shipped samples cannot be cancelled. Record a linked service case instead.';end if;
   update public.erp_sample_requests set state='cancelled',purpose=purpose||E'\nCancelled: '||why,version=version+1 where id=target;
  end if;entity:='sample_requests';
 elsif p_action='log_customer_interaction' then
  perform public.erp_assert(p_user,'sales','read');
  if nullif(p->>'opportunity_id','') is not null and not exists(select from public.erp_opportunities where id=(p->>'opportunity_id')::uuid and customer_id=(p->>'customer_id')::uuid) then raise check_violation;end if;
  if nullif(p->>'sample_id','') is not null and not exists(select from public.erp_sample_requests where id=(p->>'sample_id')::uuid and customer_id=(p->>'customer_id')::uuid) then raise check_violation;end if;
  if nullif(p->>'assignee','') is not null and not exists(select from public.users where id=(p->>'assignee')::uuid and is_active and public.erp_can(id,'crm','write')) then raise exception using errcode='P0001',message='Assign this interaction to an active CRM operator.';end if;
  insert into public.erp_customer_interactions(customer_id,opportunity_id,sample_id,kind,subject,notes,due_date,assignee,state,created_by) values((p->>'customer_id')::uuid,nullif(p->>'opportunity_id','')::uuid,nullif(p->>'sample_id','')::uuid,p->>'kind',p->>'subject',p->>'notes',nullif(p->>'due_date','')::date,nullif(p->>'assignee','')::uuid,case when nullif(p->>'due_date','') is null then 'done' else 'open' end,p_user) returning id into target;entity:='customer_interactions';
 elsif p_action='complete_customer_interaction' then
  if length(why)<3 then raise check_violation;end if;
  update public.erp_customer_interactions set state='done',notes=notes||E'\nOutcome: '||why,version=version+1 where id=target and version=expected_version and state='open';if not found then raise exception using errcode='P0001',message='This follow-up changed or is already completed.';end if;entity:='customer_interactions';
 elsif p_action='distribute_product_document' then
  perform public.erp_assert(p_user,'documents','read');perform public.erp_assert(p_user,'sales','read');
  select * into document from public.erp_product_documents where id=(p->>'document_id')::uuid and state='published' and effective_date<=public.erp_today() and (expiry_date is null or expiry_date>=public.erp_today());if not found then raise exception using errcode='P0001',message='Share only a current published product document.';end if;
  perform public.erp_check_date((p->>'sent_date')::date);
  insert into public.erp_document_distributions(customer_id,document_id,document_snapshot,recipient,channel,sent_date,evidence,created_by) values((p->>'customer_id')::uuid,document.id,to_jsonb(document),p->>'recipient',p->>'channel',(p->>'sent_date')::date,p->>'evidence',p_user) returning id into target;entity:='document_distributions';
 elsif p_action in ('acknowledge_document_distribution','retract_document_distribution') then
  select * into distribution from public.erp_document_distributions where id=target for update;if not found or distribution.version is distinct from expected_version or distribution.state<>'sent' then raise check_violation;end if;
  if p_action='acknowledge_document_distribution' then
   perform public.erp_check_date((p->>'acknowledged_date')::date);if (p->>'acknowledged_date')::date<distribution.sent_date then raise check_violation;end if;
   update public.erp_document_distributions set state='acknowledged',acknowledged_date=(p->>'acknowledged_date')::date,evidence=evidence||E'\nAcknowledgment: '||coalesce(p->>'evidence',''),version=version+1 where id=target;
  else if length(why)<3 then raise check_violation;end if;update public.erp_document_distributions set state='retracted',evidence=evidence||E'\nRetracted: '||why,version=version+1 where id=target;end if;entity:='document_distributions';
 else raise exception using errcode='P0001',message='Unknown customer operation.';end if;
 return jsonb_build_object('id',target,'entity',entity);
end $$;
revoke all on function public.work_customer_command(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
