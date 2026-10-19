-- INBIONUSA learning examples. Synthetic transactions, NOT commercial records.
-- Apply 001–013 first. Run the complete file in Supabase SQL Editor as postgres.
-- Adds no users; changes no passwords, existing sessions, module settings or existing business rows.
-- Requires active Quality, Warehouse, Sales, Purchase, Service and Finance modules.
-- All current transactions use the real RPCs. Two historical opening balances are explicit fixtures.
-- Run once per database. Every customer/product/source is marked DEMO-LEARN.
begin;
set local lock_timeout='10s';
select pg_advisory_xact_lock(49281041);
create temporary table _learning_config(actor uuid,token text,product uuid,unit uuid,location uuid,lot uuid,run text) on commit drop;
drop table if exists pg_temp._learning_examples;
create temporary table _learning_examples(scenario text,customer text,sales_order text,billing_document text,case_number text,next_step text) on commit preserve rows;
do $$declare actor uuid;token text:=gen_random_uuid()::text;missing text;begin
 if to_regprocedure('public.erp_fin_case_settled(uuid,text)') is null then raise exception 'Apply migrations 001–013 before this learning seed.';end if;
 select string_agg(key,', ') into missing from public.erp_modules where key in ('quality','warehouse','sales','purchase','service','finance') and state<>'active';
 if missing is not null then raise exception 'Activate these modules first: %',missing;end if;
 if exists(select from public.master_produk where kode_produk like 'DEMO-LEARN-%') then raise exception 'DEMO-LEARN examples already exist. Search DEMO-LEARN in the application; this seed does not duplicate them.';end if;
 select id into actor from public.users where is_active and not must_change_password and role in ('administrator inbionusa','admin qc') order by created_at,id limit 1;
 if actor is null then raise exception 'An existing active Administrator account is required; this seed never creates a user.';end if;
 insert into public.sessions(user_id,token,expires_at) values(actor,token,now()+interval '30 minutes');
 insert into _learning_config(actor,token,run) values(actor,token,'DEMO-LEARN');
end $$;
create or replace function pg_temp.learning_rpc(action text,payload jsonb) returns jsonb language sql as $$
 select public.erp_mutate((select token from _learning_config),action,payload)
$$;
create or replace function pg_temp.learning_qc(action text,payload jsonb) returns jsonb language sql as $$
 select public.qc_mutate((select token from _learning_config),action,payload)
$$;
create or replace function pg_temp.learning_payment(party uuid,amount text,direction text default 'receipt',verify boolean default true,party_type text default 'customer') returns uuid language plpgsql as $$
declare id uuid;begin
 id:=(pg_temp.learning_rpc('fin_record_payment',jsonb_build_object('request_key',gen_random_uuid(),'direction',direction,'party_type',party_type,'party_id',party,'currency','IDR','amount',amount,'date',public.erp_today(),'bank_account','DEMO-LEARN TRAINING BANK','bank_reference','DEMO-LEARN-'||gen_random_uuid(),'evidence','DEMO-LEARN synthetic payment, no actual bank transfer','notes','Training only')))->>'id';
 if verify then perform pg_temp.learning_rpc('fin_verify_payment',jsonb_build_object('id',id,'version',1,'reason','DEMO-LEARN simulated statement verification'));end if;return id;
end $$;
create or replace function pg_temp.learning_bill(so uuid,kind text,amount text default null,delivery uuid default null,related uuid default null,claim uuid default null,issue boolean default true) returns uuid language plpgsql as $$
declare id uuid;line uuid;begin
 select l.id into line from public.erp_order_lines l where l.order_id=so order by position limit 1;
 id:=(pg_temp.learning_rpc('fin_create_document',jsonb_build_object('request_key',gen_random_uuid(),'kind',kind,'order_id',so,'delivery_id',delivery,'related_id',related,'case_id',claim,'amount',amount,'date',public.erp_today(),'due_date',public.erp_today()+30,'notes','DEMO-LEARN training document; not a commercial invoice','reason','DEMO-LEARN agreed shortage correction','lines',case when kind='invoice' then jsonb_build_array(jsonb_build_object('line_id',line,'quantity','100')) else '[]'::jsonb end)))->>'id';
 if issue then perform pg_temp.learning_rpc('fin_issue_document',jsonb_build_object('id',id,'version',1,'reason','DEMO-LEARN administrator reviewed this training example'));end if;return id;
end $$;
create or replace function pg_temp.learning_allocate(payment uuid,document uuid,amount text) returns void language sql as $$
 select pg_temp.learning_rpc('fin_allocate',jsonb_build_object('request_key',gen_random_uuid(),'payment_id',payment,'document_id',document,'amount',amount,'reason','DEMO-LEARN match synthetic funds'))
$$;
create or replace function pg_temp.learning_case(so uuid,delivery uuid,resolution text,amount text default null) returns uuid language plpgsql as $$
declare id uuid;c _learning_config;begin
 select * into c from _learning_config;
 id:=(pg_temp.learning_rpc('ops_create_case',jsonb_build_object('request_key',gen_random_uuid(),'kind','customer_claim','source_type',case when delivery is null then 'order' else 'delivery' end,'source_id',coalesce(delivery,so),'title','DEMO-LEARN '||resolution||' example','description','Training claim: customer reported a shortage. Not a real complaint.','quantity',case when delivery is null then null else '10' end,'lot_id',case when delivery is null then null else c.lot end,'due_date',public.erp_today()+3,'evidence','[]'::jsonb)))->>'id';
 perform pg_temp.learning_rpc('ops_case_transition',jsonb_build_object('id',id,'version',1,'state','awaiting_approval','reason','DEMO-LEARN evidence ready for review'));
 perform pg_temp.learning_rpc('ops_case_transition',jsonb_build_object('id',id,'version',2,'state','approved','resolution',resolution,'currency','IDR','settlement_amount',amount,'cost_payer','company','estimated_cost','0','reason','DEMO-LEARN approve synthetic claim'));
 perform pg_temp.learning_rpc('ops_case_transition',jsonb_build_object('id',id,'version',3,'state','in_progress','reason','DEMO-LEARN resolution in progress'));
 return id;
end $$;
-- One isolated stock location and one synthetic stearate product, with real QC release.
do $$declare p uuid;u uuid;l uuid;move uuid;seed_lot uuid;h uuid;spec uuid;batch text:='DEMO-LEARN-LOT-01';begin
 p:=(pg_temp.learning_qc('create_produk',jsonb_build_object('kode_produk','DEMO-LEARN-INDOSTER-99001','nama_produk','INDOSTER 99001','kategori','DEMO TRAINING — synthetic stearate','satuan','kg','status_halal','Non-Halal','tipe_kemasan','Training sample','spesifikasi',jsonb_build_array(jsonb_build_object('parameter_uji','Training appearance','tipe_batas','TEXT','nilai_min','','nilai_maks','','satuan','','keterangan','Synthetic training criterion; not a product specification')))))->>'id';
 select id into u from public.erp_units where code='kg';
 if u is null then u:=(pg_temp.learning_rpc('save_unit','{"code":"DEMO-KG","name":"Training kilogram"}'))->>'id';end if;
 perform pg_temp.learning_rpc('save_conversion',jsonb_build_object('product_id',p,'unit_id',u,'factor','1','is_base',true));
 l:=(pg_temp.learning_rpc('save_location','{"code":"DEMO-LEARN","name":"DEMO-LEARN training stock — not physical inventory"}'))->>'id';
 move:=(pg_temp.learning_rpc('save_move',jsonb_build_object('kind','receipt','date',public.erp_today(),'to_location',l,'reason','DEMO-LEARN synthetic opening stock; not real goods','lines',jsonb_build_array(jsonb_build_object('product_id',p,'unit_id',u,'quantity','5000','lot_number',batch,'mfg_date',public.erp_today())))))->>'id';
 perform pg_temp.learning_rpc('post_move',jsonb_build_object('id',move,'reason','DEMO-LEARN training receipt'));
 select id into seed_lot from public.erp_lots where product_id=p and number=batch;
 select id into spec from public.spesifikasi where id_produk=p limit 1;
 h:=(pg_temp.learning_qc('create_uji',jsonb_build_object('id_produk',p,'no_lot',batch,'tgl_sampling',public.erp_today(),'tgl_uji',public.erp_today(),'inspector','DEMO-LEARN training','catatan','Synthetic result. Do not use commercially.','failure_reason','','hasil_detail',jsonb_build_array(jsonb_build_object('spec_id',spec,'p','Training appearance','val','Synthetic training sample','st','PASS')))))->>'id';
 perform pg_temp.learning_qc('issue_coa',jsonb_build_object('id_hasil',h,'no_coa','DEMO-LEARN-COA-01','tanggal_rilis',public.erp_today(),'mfg_date',public.erp_today(),'tanggal_expired',(public.erp_today()+interval '1 year')::date,'tanda_tangan','DEMO-LEARN ONLY','language','en','compliance_statement','TRAINING ONLY. Synthetic results; not a commercial certificate.'));
 update _learning_config set product=p,unit=u,location=l,lot=seed_lot;
end $$;
-- Every SO is 100 kg × IDR 100,000 = IDR 10,000,000 (tax/freight zero for clarity).
do $$declare c _learning_config;s record;customer uuid;q uuid;so uuid;doc uuid;payment uuid;line uuid;reservation uuid;delivery uuid;claim uuid;credit uuid;mode text;trigger text;amount text;begin
 select * into c from _learning_config;
 for s in select * from (values
 (1,'PREPAID-TERMS-PENDING','prepaid','order'),
 (2,'PREPAID-NO-PAYMENT','prepaid','order'),
 (3,'PAYMENT-DRAFT','prepaid','order'),
 (4,'VERIFIED-NOT-ALLOCATED','prepaid','order'),
 (5,'PREPAID-CLEARED','prepaid','order'),
 (6,'DP-BALANCE-BEFORE-SHIP','deposit_before','dispatch'),
 (7,'DP-PLUS-CREDIT','deposit_credit','dispatch'),
 (8,'CREDIT-LIMIT-BLOCKED','credit','order'),
 (9,'CREDIT-READY','credit','order'),
 (10,'RECEIPT-BEFORE-INVOICE','credit','receipt'),
 (11,'REFUND-PARTIAL','credit','dispatch'),
 (12,'REFUND-COMPLETE','credit','dispatch'),
 (13,'CREDIT-NOT-APPLIED','credit','order'),
 (14,'CREDIT-APPLIED','credit','order'),
 (15,'CUSTOMER-RETURN','credit','dispatch'),
 (16,'REPLACEMENT','credit','dispatch')
 ) x(n,label,mode,trigger_event) loop
 customer:=(pg_temp.learning_rpc('save_customer',jsonb_build_object('name','DEMO-LEARN '||s.label,'contact','Training contact','billing_address','Fictional training address','shipping_address','Fictional training destination','payment_terms','DEMO-LEARN only')))->>'id';
 q:=(pg_temp.learning_rpc('save_quote',jsonb_build_object('customer_id',customer,'date',public.erp_today(),'valid_until',public.erp_today()+30,'currency','IDR','tax_rate','0','freight','0','terms','DEMO-LEARN synthetic agreement','lines',jsonb_build_array(jsonb_build_object('product_id',c.product,'unit_id',c.unit,'quantity','100','price','100000','discount','0')))))->>'id';
 perform pg_temp.learning_rpc('issue_quote',jsonb_build_object('id',q,'version',1,'reason','DEMO-LEARN approve training quote'));
 perform pg_temp.learning_rpc('accept_quote',jsonb_build_object('id',q));
 so:=(pg_temp.learning_rpc('convert_quote',jsonb_build_object('id',q,'customer_reference','DEMO-LEARN '||s.label)))->>'id';
 perform pg_temp.learning_rpc('fin_terms',jsonb_build_object('request_key',gen_random_uuid(),'order_id',so,'mode',s.mode,'deposit_percent',case when s.mode like 'deposit%' then '30' else '0' end,'due_days',30,'billing_event',s.trigger_event));
 doc:=null;claim:=null;payment:=null;delivery:=null;
 if s.n<>1 then perform pg_temp.learning_rpc('fin_approve_terms',jsonb_build_object('id',so,'version',1,'reason','DEMO-LEARN approve agreed training terms'));end if;
 if s.mode in ('credit','deposit_credit') then perform pg_temp.learning_rpc('fin_credit_policy',jsonb_build_object('customer_id',customer,'currency','IDR','credit_limit',case when s.n=8 then '5000000' else '50000000' end,'on_hold',false,'hold_overdue',true,'reason','DEMO-LEARN synthetic credit limit'));end if;
 if s.n between 2 and 7 then
  amount:=case when s.n in (6,7) then '3000000' else '10000000' end;
  doc:=pg_temp.learning_bill(so,'payment_request',amount);
  if s.n>=3 then payment:=pg_temp.learning_payment(customer,amount,'receipt',s.n<>3);end if;
  if s.n>=5 then perform pg_temp.learning_allocate(payment,doc,amount);end if;
 end if;
 if s.n in (10,11,12,15,16) then
  select id into line from public.erp_order_lines where order_id=so limit 1;
  reservation:=(pg_temp.learning_rpc('reserve',jsonb_build_object('order_line_id',line,'lot_id',c.lot,'location_id',c.location,'quantity','100')))->>'id';
  delivery:=(pg_temp.learning_rpc('create_delivery',jsonb_build_object('order_id',so,'reason','DEMO-LEARN training shipment','lines',jsonb_build_array(jsonb_build_object('reservation_id',reservation,'quantity','100')))))->>'id';
  perform pg_temp.learning_rpc('post_move',jsonb_build_object('id',delivery,'version',1,'reason','DEMO-LEARN training dispatch'));
 end if;
 if s.n in (8,9,11,12,13,14,15,16) then doc:=pg_temp.learning_bill(so,'invoice',null,delivery);end if;
 if s.n in (11,12) then
  -- Original invoice is fully paid. The refund is a separate outgoing transaction.
  payment:=pg_temp.learning_payment(customer,'10000000');perform pg_temp.learning_allocate(payment,doc,'10000000');
  claim:=pg_temp.learning_case(so,delivery,'refund','1000000');
  credit:=pg_temp.learning_bill(so,'credit_note','1000000',null,doc,claim);
  amount:=case when s.n=11 then '600000' else '1000000' end;
  payment:=pg_temp.learning_payment(customer,amount,'refund');perform pg_temp.learning_allocate(payment,credit,amount);
 elsif s.n in (13,14) then
  claim:=pg_temp.learning_case(so,null,'credit','1000000');
  credit:=pg_temp.learning_bill(so,'credit_note','1000000',null,doc,claim);
  if s.n=14 then perform pg_temp.learning_rpc('fin_apply_credit',jsonb_build_object('request_key',gen_random_uuid(),'credit_id',credit,'invoice_id',doc,'amount','1000000','reason','DEMO-LEARN apply agreed shortage credit'));end if;
 elsif s.n in (15,16) then
  claim:=pg_temp.learning_case(so,delivery,case when s.n=15 then 'return' else 'replacement' end);
  if s.n=15 then perform pg_temp.learning_rpc('ops_customer_return',jsonb_build_object('id',claim,'version',4,'location_id',c.location,'request_key',gen_random_uuid(),'reason','DEMO-LEARN return request; goods not yet received'));end if;
 end if;
 insert into _learning_examples values(s.label,'DEMO-LEARN '||s.label,(select number from public.erp_orders where id=so),(select number from public.erp_fin_documents where id=doc),(select number from public.erp_cases where id=claim),case s.n
 when 1 then 'Approve payment terms, then create billing.' when 2 then 'Record receipt, verify funds, then allocate to this request.' when 3 then 'Verify the draft receipt, then allocate it.' when 4 then 'Allocate the already verified receipt; do not record funds again.' when 5 then 'Financially cleared. Reserve stock and prepare delivery.' when 6 then 'DP paid, but remaining IDR 7m is required before dispatch.' when 7 then 'DP paid and credit policy approved. Dispatch can proceed.' when 8 then 'IDR 10m exposure exceeds IDR 5m credit limit.' when 9 then 'Credit allowed. Invoice remains unpaid; record actual receipt when received.' when 10 then 'Record customer receipt/POD, then create invoice from the posted delivery.' when 11 then 'Refund approved IDR 1m; only IDR 600k settled. Complete IDR 400k before resolving.' when 12 then 'Full refund settled. Review evidence and mark the case Resolved.' when 13 then 'Issued credit is not applied. Apply IDR 1m to its source invoice.' when 14 then 'Credit applied in full. Review evidence and resolve the case.' when 15 then 'Receive the requested return into quarantine in Warehouse > Returns.' when 16 then 'Ship an approved 10kg replacement from the DEMO-LEARN lot/location.' end);
 end loop;
end $$;
-- Historical AR/AP opening examples are isolated inserts, not edits to real posted documents.
-- They intentionally predate the current backdate window so all aging buckets can be studied.
do $$declare c _learning_config;customer uuid;supplier uuid;q uuid;so uuid;po uuid;root uuid;doc_id uuid;days integer;side text;label text;snap jsonb;begin
 select * into c from _learning_config;
 for side,days in select s,d from unnest(array['customer','supplier']) s cross join unnest(array[0,15,45,75,110]) d loop
  label:='DEMO-LEARN '||case when side='customer' then 'AR' else 'AP' end||'-AGING-'||days;
  root:=gen_random_uuid();so:=null;po:=null;customer:=null;supplier:=null;
  snap:=jsonb_build_object('customer',jsonb_build_object('name',label,'billing_address','Fictional historical training balance'),'currency','IDR','tax_rate','0','lines','[]'::jsonb,'terms','DEMO-LEARN historical opening balance only','totals',jsonb_build_object('subtotal','2000000','tax','0','freight','0','total','2000000'));
  if side='customer' then
   insert into public.erp_customers(name) values(label) returning id into customer;
   insert into public.erp_fin_credit_policy(customer_id,currency,credit_limit,on_hold,hold_overdue,reason) values(customer,'IDR',50000000,false,true,'DEMO-LEARN historical credit policy');
  else
   insert into public.erp_suppliers(name,address) values(label,'Fictional supplier opening balance') returning id into supplier;
  end if;
  insert into public.erp_fin_documents(number,kind,party_type,party_id,currency,order_id,purchase_id,date,due_date,amount,state,external_reference,notes,snapshot,created_by,issued_by)
  values(label,case when side='customer' then 'invoice' else 'supplier_bill' end,side,coalesce(customer,supplier),'IDR',so,po,public.erp_today()-days-30,case when days=0 then public.erp_today()+15 else public.erp_today()-days end,2000000,'issued',case when side='supplier' then label else '' end,'DEMO-LEARN historical opening balance only',snap||jsonb_build_object('number',label,'date',public.erp_today()-days-30,'due_date',case when days=0 then public.erp_today()+15 else public.erp_today()-days end,'issuer','DEMO-LEARN'),c.actor,c.actor) returning id into doc_id;
  insert into _learning_examples values(case when side='customer' then 'AR' else 'AP' end||' aging '||days||' days',label,coalesce((select number from public.erp_orders where id=so),(select number from public.erp_purchase_orders where id=po)),label,null,'Open Finance > AR / AP aging. IDR 2m in this aging bucket; training opening balance only.');
 end loop;
 -- Remove only the temporary seed session, keeping all pre-existing sessions unchanged.
 delete from public.sessions where token=c.token and user_id=c.actor;
end $$;
commit;
select * from _learning_examples order by scenario;
