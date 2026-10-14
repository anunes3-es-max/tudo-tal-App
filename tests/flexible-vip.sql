-- Administrative test runner; every test product, sale and receipt is rolled back.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.app_members where active and role='admin' limit 1),true);
select set_config('qa.vip_prefix','qa-vip-'||gen_random_uuid()::text,true);
insert into public.products(id,sku,name,category,mode,owner_name,price,qty)
select current_setting('qa.vip_prefix')||suffix,current_setting('qa.vip_prefix')||suffix,'QA VIP','Outros',mode,'QA',price,qty
from (values ('-a',500,'proprio',20),('-b',100,'proprio',10),('-c',400,'proprio',10),('-d',33.33,'proprio',10),('-e',500,'consignado',10),('-z',100,'proprio',0)) as x(suffix,price,mode,qty);
set local role authenticated;
do $test$
declare
  p text:=current_setting('qa.vip_prefix');
  due30 text:=((now() at time zone 'America/Sao_Paulo')::date+30)::text;
  due60 text:=((now() at time zone 'America/Sao_Paulo')::date+60)::text;
  items jsonb; plan jsonb; r jsonb; rid uuid; request uuid:=gen_random_uuid(); qty_before integer;
begin
  items:=jsonb_build_array(jsonb_build_object('product_id',p||'-a','qty',1));
  plan:=jsonb_build_object('down_payment',100,'down_payment_method','Pix','installments',jsonb_build_array(
    jsonb_build_object('amount',250,'due_date',due30),jsonb_build_object('amount',150,'due_date',due60)));
  r:=public.register_vip_sale_cart(p||'-cart',items,plan,'Cliente QA','11999990101');
  assert (r->>'total')::numeric=500 and (r->>'remaining')::numeric=400,'Total ou saldo incorreto';
  assert (select sum(received_amount)=100 from public.sales where cart_id=p||'-cart'),'Entrada não contabilizada';
  assert (select count(*)=3 and sum(amount)=500 and sum(amount-paid_amount)=400 from public.receivable_installments where cart_id=p||'-cart'),'Agenda 100/250/150 incorreta';
  assert (select count(*)=1 from public.receivable_payments where receivable_id in (select id from public.receivable_installments where cart_id=p||'-cart')),'Entrada duplicada';
  assert (select qty=19 from public.products where id=p||'-a'),'Estoque não baixou uma vez';
  r:=public.register_vip_sale_cart(p||'-cart',items,plan,'Cliente QA','11999990101');
  assert r->>'status'='already_registered','Reenvio da venda não é idempotente';
  assert (select qty=19 from public.products where id=p||'-a'),'Reenvio baixou estoque novamente';
  begin
    perform public.register_vip_sale_cart(p||'-cart',items,jsonb_set(plan,'{down_payment}','101'),'Cliente QA','11999990101');
    raise exception 'Reenvio com outro acordo foi aceito';
  exception when sqlstate '22023' then null; end;

  select id into rid from public.receivable_installments where cart_id=p||'-cart' and installment_number=1;
  perform public.record_vip_payment(rid,250,request,'Dinheiro');
  perform public.record_vip_payment(rid,250,request,'Dinheiro');
  assert (select received_amount=350 from public.sales where cart_id=p||'-cart'),'Pagamento duplicado ou saldo incorreto';
  select id into rid from public.receivable_installments where cart_id=p||'-cart' and installment_number=2;
  begin
    perform public.record_vip_payment(rid,151,gen_random_uuid(),'Pix');raise exception 'Pagamento acima do saldo aceito';
  exception when sqlstate '22023' then null; end;
  perform public.record_vip_payment(rid,50,gen_random_uuid(),'Pix');
  assert (select status='Pendente' and amount-paid_amount=100 from public.receivable_installments where id=rid),'Pagamento parcial quitou indevidamente';
  assert (select received_amount=400 and received_status='Parcial' from public.sales where cart_id=p||'-cart'),'Saldo recebido parcial incorreto';
  perform public.mark_receivable_paid(rid);
  perform public.mark_receivable_paid(rid);
  assert (select received_amount=500 and received_status='Recebido' from public.sales where cart_id=p||'-cart'),'Quitação incorreta';
  assert (select count(*)=4 from public.receivable_payments where receivable_id in (select id from public.receivable_installments where cart_id=p||'-cart')),'Histórico duplicado';

  -- Sum mismatch rolls back both the sale and inventory movements.
  select qty into qty_before from public.products where id=p||'-a';
  begin
    perform public.register_vip_sale_cart(p||'-invalid',items,jsonb_set(plan,'{down_payment}','99'),'Cliente QA');
    raise exception 'Acordo divergente foi aceito';
  exception when sqlstate '22023' then null; end;
  assert not exists(select 1 from public.sales where cart_id=p||'-invalid'),'Venda inválida persistiu';
  assert (select qty=qty_before from public.products where id=p||'-a'),'Acordo inválido alterou estoque';
  begin
    perform public.register_vip_sale_cart(p||'-invalid-date',items,jsonb_set(plan,'{installments,0,due_date}',to_jsonb('2020-01-01'::text)),'Cliente QA');
    raise exception 'Vencimento passado foi aceito';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.register_vip_sale_cart(p||'-no-stock',items||jsonb_build_array(jsonb_build_object('product_id',p||'-z','qty',1)),plan,'Cliente QA');
    raise exception 'Estoque insuficiente foi aceito';
  exception when sqlstate 'P0001' then
    if sqlerrm='Estoque insuficiente foi aceito' then raise; end if;
  end;
  assert (select qty=qty_before from public.products where id=p||'-a'),'Falha no segundo item baixou o primeiro';

  -- One agreement for a cart with several products, with exact cent allocation.
  items:=jsonb_build_array(jsonb_build_object('product_id',p||'-b','qty',1),jsonb_build_object('product_id',p||'-c','qty',1));
  perform public.register_vip_sale_cart(p||'-multi',items,plan,'Cliente QA');
  assert (select count(*)=3 from public.receivable_installments where cart_id=p||'-multi'),'Agenda multiplicada por produto';
  assert (select sum(received_amount)=100 and sum(total)=500 from public.sales where cart_id=p||'-multi'),'Rateio da entrada incorreto';
  assert (select received_amount=20 from public.sales where cart_id=p||'-multi' and product_id=p||'-b'),'Rateio proporcional incorreto';
  select id into rid from public.receivable_installments where cart_id=p||'-multi' and installment_number=1;
  perform public.record_vip_payment(rid,0.01,gen_random_uuid(),'Pix');
  assert (select sum(received_amount)=100.01 from public.sales where cart_id=p||'-multi'),'Recebimento perdeu centavos';

  -- Reverse amounts, no deposit, and fully paid deposit are all valid.
  items:=jsonb_build_array(jsonb_build_object('product_id',p||'-a','qty',1));
  plan:=jsonb_build_object('down_payment',0,'installments',jsonb_build_array(jsonb_build_object('amount',150,'due_date',due30),jsonb_build_object('amount',350,'due_date',due60)));
  perform public.register_vip_sale_cart(p||'-no-deposit',items,plan,'Cliente QA');
  assert (select sum(received_amount)=0 from public.sales where cart_id=p||'-no-deposit'),'Sem entrada aumentou caixa';
  perform public.register_vip_sale_cart(p||'-full-deposit',items,'{"down_payment":500,"down_payment_method":"Dinheiro","installments":[]}'::jsonb,'Cliente QA');
  assert (select received_amount=500 and received_status='Recebido' from public.sales where cart_id=p||'-full-deposit'),'Entrada integral incorreta';
  items:=jsonb_build_array(jsonb_build_object('product_id',p||'-d','qty',3));
  plan:=jsonb_build_object('down_payment',0,'installments',jsonb_build_array(jsonb_build_object('amount',33.33,'due_date',due30),jsonb_build_object('amount',66.66,'due_date',due60)));
  perform public.register_vip_sale_cart(p||'-cents',items,plan,'Cliente QA');
  assert (select sum(amount)=99.99 from public.receivable_installments where cart_id=p||'-cents'),'Soma decimal incorreta';

  -- Consignment still uses the full-price owner payout after discount.
  items:=jsonb_build_array(jsonb_build_object('product_id',p||'-e','qty',1));
  plan:=jsonb_build_object('down_payment',50,'installments',jsonb_build_array(jsonb_build_object('amount',100,'due_date',due30),jsonb_build_object('amount',100,'due_date',due60)));
  perform public.register_vip_sale_cart(p||'-discount',items,plan,'Cliente QA','',50);
  assert (select total=250 and repasse=325 and received_amount=50 from public.sales where cart_id=p||'-discount'),'Desconto ou repasse mudou';

  -- Existing clients can still create and settle equal monthly installments.
  perform public.register_sale_atomic(p||'-legacy',p||'-a',1,500,'Crediário VIP',p_installments=>2,p_first_due_date=>due30::date);
  select id into rid from public.receivable_installments where sale_id=p||'-legacy' and installment_number=1;
  perform public.mark_receivable_paid(rid);
  assert (select received_amount=250 and received_status='Parcial' from public.sales where id=p||'-legacy'),'Compatibilidade com venda antiga quebrada';
  begin
    insert into public.receivable_payments(id,receivable_id,amount,payment_method) values(gen_random_uuid(),rid,1,'Pix');
    raise exception 'Escrita direta no histórico foi liberada';
  exception when sqlstate '42501' then null; end;
end;
$test$;
set local role anon;
do $test$ begin
  begin
    perform * from public.receivable_payments;raise exception 'Histórico exposto a visitante';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.record_vip_payment(gen_random_uuid(),1,gen_random_uuid(),'Pix');raise exception 'Visitante registrou recebimento';
  exception when sqlstate '42501' then null; end;
end; $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $test$ begin
  assert not exists(select 1 from public.receivable_payments),'Usuário sem acesso leu recebimentos';
  begin
    perform public.register_vip_sale_cart('qa-denied','[]','{}','Cliente QA');raise exception 'Usuário sem acesso vendeu';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.record_vip_payment(gen_random_uuid(),1,gen_random_uuid(),'Pix');raise exception 'Usuário sem acesso recebeu';
  exception when sqlstate '42501' then null; end;
end; $test$;
rollback;
select 'PASS: flexible schedules, deposits, partial payments, idempotency, stock rollback, cents, discounts, legacy compatibility and permissions; all simulations rolled back.' as result;
