begin;
-- No production identities or sales: run only in disposable PGlite.
select set_config('qa.admin',(select user_id::text from public.app_members where role='admin' limit 1),true);
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000001','seller1@example.invalid'),('00000000-0000-0000-0000-000000000002','seller2@example.invalid');
insert into auth.sessions select id,id from auth.users where email like 'seller%';
insert into public.app_members(user_id,role,active) values('00000000-0000-0000-0000-000000000001','staff',true),('00000000-0000-0000-0000-000000000002','staff',true);
update private.seller_slots set user_id=('00000000-0000-0000-0000-00000000000'||slot)::uuid,name='Vendedor QA '||slot,enabled=true,onboarded=true;
insert into public.products(id,sku,name,category,mode,owner_name,price,qty,cost,discount_percent) values('qa-access','QA-ACCESS','Produto QA','Achadinhos','proprio','Loja QA',100,20,30,10);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()))))::text,true);
set local role authenticated;
do $$ declare r jsonb; p jsonb; rid uuid:='00000000-0000-0000-0001-000000000001'; begin
 begin perform public.access_control('stock');raise exception 'Unopened session passed';exception when insufficient_privilege then null;end;
 perform public.access_control('unlock');
 r:=public.access_control('stock');assert not ((r->0)?'cost'),'Cost leaked';assert not ((r->0)?'owner_phone'),'Owner phone leaked';
 assert (select count(*)=0 from public.products),'Raw products leaked';
 assert (select count(*)=0 from public.sales),'Raw sales leaked';
 begin perform public.access_control('panel');raise exception 'Seller opened admin panel';exception when insufficient_privilege then null;end;
 begin perform public.save_product('{"id":"qa-access","qty":0}');raise exception 'Seller altered stock';exception when insufficient_privilege then null;end;
 begin perform public.register_sale_atomic('qa-illegal','qa-access',1,1,'Dinheiro');raise exception 'Legacy sale bypass';exception when insufficient_privilege then null;end;
 begin perform private.seller_worker_register_sale_atomic_impl('qa-illegal','qa-access',1,1,'Dinheiro');raise exception 'Worker callable';exception when insufficient_privilege then null;end;
 begin perform public.bind_seller_invitation(1,auth.uid(),'hacker@example.invalid');raise exception 'Invitation escalation';exception when insufficient_privilege then null;end;
 p:=jsonb_build_object('id',rid,'items',jsonb_build_array(jsonb_build_object('product_id','qa-access','qty',2,'price',100,'promotion',10,'name','Produto QA')),'payment','Dinheiro','discount',0);
 r:=public.access_control('checkout',p);assert r->>'total'='180.00','Promotion price incorrect';
 r:=public.access_control('checkout',p);assert r->>'status'='completed','Retry not idempotent';
 begin perform public.access_control('checkout',p||'{"payment":"Pix"}');raise exception 'Retry accepted different payload';exception when sqlstate '22023' then null;end;
 r:=public.access_control('my_sales');assert jsonb_array_length(r)=1,'Own sales missing';assert not ((r->0)?'cost_total'),'Sale cost leaked';
 perform public.access_control('checkout',p||'{"id":"00000000-0000-0000-0001-000000000002","discount":5}');
 perform public.access_control('request_change',jsonb_build_object('id','00000000-0000-0000-0001-000000000003','sale_id','seller-'||rid||'-01','revision',0,'action','return','data',jsonb_build_object('qty',1,'restock',true),'reason','Devolução QA'));
 perform public.access_control('lock');
 begin perform public.access_control('stock');raise exception 'Locked data accessible';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 assert (select qty=18 from public.products where id='qa-access'),'Pending approval mutated stock';
 assert (select sum(amount)=180 from public.finance_movements where sale_id like 'seller-%'),'Cash not synchronized';
end $$;
select set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);
set local role authenticated;
select public.access_control('approve','{"id":"00000000-0000-0000-0001-000000000002"}');
select public.access_control('approve','{"id":"00000000-0000-0000-0001-000000000002"}');
select public.access_control('approve','{"id":"00000000-0000-0000-0001-000000000003"}');
reset role;
do $$ begin
 assert (select qty=17 from public.products where id='qa-access'),'Approval stock wrong or doubled';
 assert (select count(*)=2 from public.sales where product_id='qa-access'),'Approval sale duplicated';
 assert (select count(*)=2 from private.seller_requests where approver=current_setting('qa.admin')::uuid),'Approver missing';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.access_control('unlock');
do $$ begin
 assert public.access_control('my_sales')='[]'::jsonb,'Another seller sees sales';
 begin perform public.access_control('request_change','{"id":"00000000-0000-0000-0001-000000000004","sale_id":"seller-00000000-0000-0000-0001-000000000001-01","revision":1,"action":"cancel","data":{},"reason":"Another seller"}');raise exception 'Other seller correction allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
update private.access_sessions set last_seen=now()-interval '31 minutes' where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 begin perform public.access_control('heartbeat');raise exception 'Expired session renewed';exception when insufficient_privilege then null;end;
end $$;
reset role;
update private.access_sessions set last_seen=now(),revoked_at=now() where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 begin perform public.access_control('unlock');raise exception 'Revoked session reopened';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: seller isolation, privilege escalation, atomic sale, approvals, ownership, retry, lock, expiration and revocation' result;
