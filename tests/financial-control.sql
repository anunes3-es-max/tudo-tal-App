-- Run in a transaction, optionally after the migration for a dry run. Never commit QA rows.
select set_config('request.jwt.claim.sub',(select user_id::text from public.app_members where active and role='admin' limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated','email','qa@example.invalid','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
select set_config('qa.fin_prefix','qa-fin-'||gen_random_uuid()::text,true);
insert into public.products(id,sku,name,category,mode,owner_name,price,qty,cost)
select current_setting('qa.fin_prefix')||suffix,current_setting('qa.fin_prefix')||suffix,'QA financeiro','Achadinhos',mode,'QA-financeiro',price,20,cost
from (values ('-a',100,'proprio',30),('-b',150,'proprio',50),('-c',100,'consignado',0)) x(suffix,price,mode,cost);
set local role authenticated;
do $test$
declare p text:=current_setting('qa.fin_prefix'); request_id uuid; pending uuid; r jsonb; plan jsonb; rid uuid; day date:=(now() at time zone 'America/Sao_Paulo')::date; close_id uuid:=gen_random_uuid(); old_cash numeric;
begin
  perform public.register_sale_atomic(p||'-cash',p||'-a',2,100,'Dinheiro');
  assert (select amount=200 and method='Dinheiro' from public.finance_movements where id='sale:'||p||'-cash'),'Venda não entrou no caixa';
  perform public.register_sale_atomic(p||'-cash',p||'-a',2,100,'Dinheiro');
  assert (select count(*)=1 from public.finance_movements where id='sale:'||p||'-cash'),'Venda duplicou caixa';
  request_id:=gen_random_uuid();
  perform public.finance_change_sale(request_id,p||'-cash',0,'return','{"qty":1,"restock":true}','Devolução QA');
  perform public.finance_change_sale(request_id,p||'-cash',0,'return','{"qty":1,"restock":true}','Devolução QA');
  assert (select qty=19 from public.products where id=p||'-a'),'Devolução duplicou estoque';
  assert (select total=100 and qty=1 and original_data->>'total'='200.00' from public.sales where id=p||'-cash'),'Original ou total incorreto';
  select id into pending from public.finance_pending where sale_id=p||'-cash' and status='Pendente';
  assert (select amount=-100 from public.finance_pending where id=pending),'Reembolso incorreto';
  request_id:=gen_random_uuid(); perform public.finance_settle(request_id,pending,'Dinheiro',null,'Devolução paga QA'); perform public.finance_settle(request_id,pending,'Dinheiro',null,'Devolução paga QA');
  assert (select sum(amount)=100 from public.finance_movements where sale_id=p||'-cash' and principal),'Reembolso duplicado';
  begin perform public.finance_change_sale(gen_random_uuid(),p||'-cash',0,'price','{"unit_price":80}','Preço QA'); raise exception 'Revisão antiga aceita'; exception when sqlstate '22023' then null; end;
  perform public.finance_change_sale(gen_random_uuid(),p||'-cash',1,'exchange',jsonb_build_object('qty',1,'restock',true,'product_id',p||'-b','new_qty',1,'new_unit_price',150),'Troca QA');
  assert (select sum(total)=150 from public.sales where coalesce(cart_id,id)=p||'-cash'),'Troca total incorreto';
  assert (select sum(amount)=50 from public.finance_pending where status='Pendente' and kind='customer' and sale_id in (select id from public.sales where coalesce(cart_id,id)=p||'-cash')),'Troca cobrou preço completo';
  assert (select qty=20 from public.products where id=p||'-a') and (select qty=19 from public.products where id=p||'-b'),'Troca alterou estoque errado';
  begin perform public.finance_change_sale(gen_random_uuid(),(select id from public.sales where cart_id=p||'-cash'),0,'exchange',jsonb_build_object('qty',1,'restock',true,'product_id',p||'-a','new_qty',999,'new_unit_price',100),'Troca sem estoque'); raise exception 'Aceitou troca sem estoque'; exception when sqlstate '22023' then null; end;
  assert (select qty=19 from public.products where id=p||'-b'),'Falha da troca não reverteu estoque';

  begin
    perform public.finance_change_sale(request_id,p||'-cash',0,'price','{"unit_price":80}','Outro conteúdo QA');
    raise exception 'Pedido reutilizado com outro conteúdo';
  exception when sqlstate '22023' then null; end;

  plan:=jsonb_build_object('down_payment',50,'down_payment_method','Pix','installments',jsonb_build_array(jsonb_build_object('amount',100,'due_date',day+30),jsonb_build_object('amount',100,'due_date',day+60)));
  perform public.register_vip_sale_cart(p||'-multi',jsonb_build_array(jsonb_build_object('product_id',p||'-a','qty',1),jsonb_build_object('product_id',p||'-b','qty',1)),plan,'Cliente QA');
  perform public.finance_change_sale(gen_random_uuid(),p||'-multi-01',0,'price',jsonb_build_object('unit_price',150,'due_date',day+60),'Aumento VIP QA');
  assert (select sum(amount-paid_amount)=250 from public.receivable_installments where cart_id=p||'-multi'),'Aumento não criou a diferença VIP';
  perform public.finance_change_sale(gen_random_uuid(),p||'-multi-02',0,'cancel','{"restock":true}','Cancelamento parcial do carrinho');
  assert (select sum(amount-paid_amount)=100 from public.receivable_installments where cart_id=p||'-multi'),'Cancelamento parcial cobrou valor errado';
  assert (select sum(received_amount)=50 from public.sales where cart_id=p||'-multi'),'Entrada dividida se perdeu';
  perform public.finance_change_sale(gen_random_uuid(),p||'-multi-01',1,'exchange',jsonb_build_object('qty',1,'restock',true,'product_id',p||'-b','new_qty',1,'new_unit_price',170,'due_date',day+60),'Troca VIP com diferença');
  assert (select sum(total)=170 from public.sales where coalesce(cart_id,id)=p||'-multi'),'Troca VIP total incorreto';
  assert (select sum(amount-paid_amount)=120 from public.receivable_installments where cart_id=p||'-multi'),'Troca VIP não reconciliou parcelas';
  assert (select sum(m.amount)=50 from public.finance_movements m join public.sales s on s.id=m.sale_id where coalesce(s.cart_id,s.id)=p||'-multi' and m.principal),'Troca VIP lançou receita inexistente';

  plan:=jsonb_build_object('down_payment',40,'down_payment_method','Pix','installments',jsonb_build_array(jsonb_build_object('amount',60,'due_date',day+30)));
  perform public.register_vip_sale_cart(p||'-vip',jsonb_build_array(jsonb_build_object('product_id',p||'-a','qty',1)),plan,'Cliente QA');
  assert (select sum(m.amount)=40 from public.finance_movements m join public.sales s on s.id=m.sale_id where s.cart_id=p||'-vip'),'VIP integral entrou no caixa';
  perform public.finance_change_sale(gen_random_uuid(),p||'-vip-01',0,'price','{"unit_price":70}','Preço VIP QA');
  assert (select sum(amount-paid_amount)=30 from public.receivable_installments where cart_id=p||'-vip'),'VIP redução não atualizou parcelas';
  select id into rid from public.receivable_installments where cart_id=p||'-vip' and status='Pendente';
  perform public.record_vip_payment(rid,10,gen_random_uuid(),'Dinheiro');
  perform public.finance_change_sale(gen_random_uuid(),p||'-vip-01',1,'cancel','{"restock":true}','Cancelamento VIP QA');
  assert (select sum(amount-paid_amount)=0 from public.receivable_installments where cart_id=p||'-vip'),'Cancelamento deixou dívida VIP';
  assert (select sum(amount)=-50 from public.finance_pending where sale_id=p||'-vip-01' and status='Pendente'),'VIP não devolveu só o recebido';
  assert (select count(*)=2 from public.receivable_payments where receivable_id in(select id from public.receivable_installments where cart_id=p||'-vip')),'Histórico VIP apagado';
  begin perform public.record_vip_payment(rid,1,gen_random_uuid(),'Pix'); raise exception 'Recebeu parcela cancelada'; exception when sqlstate '22023' then null; end;

  perform public.register_sale_atomic(p||'-card',p||'-a',1,100,'Débito',p_card_brand=>'Visa/Mastercard');
  assert not exists(select 1 from public.finance_movements where sale_id=p||'-card'),'Cartão ainda não recebido aumentou saldo';
  select id into pending from public.finance_pending where sale_id=p||'-card' and status='Pendente';
  perform public.finance_settle(gen_random_uuid(),pending,'Transferência',97,'Cartão confirmado QA');
  assert (select sum(amount)=97 from public.finance_movements where sale_id=p||'-card'),'Taxa efetiva não descontada';
  perform public.finance_change_sale(gen_random_uuid(),p||'-card',0,'cancel','{"restock":false}','Cancelamento cartão QA');
  assert (select amount=-100 from public.finance_pending where sale_id=p||'-card' and status='Pendente'),'Reembolso cartão errado';

  perform public.register_sale_atomic(p||'-owner',p||'-c',1,100,'Pix');
  perform public.finance_pay_owner(gen_random_uuid(),'QA-financeiro',75,'Pix');
  perform public.finance_change_sale(gen_random_uuid(),p||'-owner',0,'cancel','{"restock":true}','Consignado devolvido QA');
  assert (select amount=75 from public.finance_pending where sale_id=p||'-owner' and kind='owner' and status='Pendente'),'Repasse já pago se perdeu';

  perform public.save_cash(jsonb_build_object('id',p||'-manual','type','saida','value',25,'description','Embalagens QA','method','Dinheiro','category','Despesas'));
  perform public.finance_reverse(gen_random_uuid(),'cash:'||p||'-manual','Lançamento duplicado QA');
  assert (select sum(amount)=0 from public.finance_movements where id='cash:'||p||'-manual' or reversal_of='cash:'||p||'-manual'),'Estorno manual errado';
  begin update public.sales set total=1 where id=p||'-cash'; raise exception 'Edição direta liberada'; exception when sqlstate '42501' then null; end;
  begin delete from public.finance_movements where id='sale:'||p||'-cash'; raise exception 'Histórico apagável'; exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}','[]')::text,true);
  begin perform public.finance_change_sale(gen_random_uuid(),p||'-card',1,'price','{"unit_price":50}','Sem senha QA'); raise exception 'Sem reautenticação aceita'; exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
  assert public.finance_export()->>'version'='2','Backup incompleto';
  assert jsonb_array_length(public.finance_export()->'finance_movements')>0,'Backup sem caixa';
  r:=public.finance_report(day,day); old_cash:=(r->>'cash_balance')::numeric;
  perform public.save_cash(jsonb_build_object('id',p||'-new','type','entrada','value',1,'description','Aporte QA','method','Pix','category','Aporte'));
  begin perform public.finance_close(close_id,day,greatest(old_cash,0),'Contagem QA',r->>'token'); raise exception 'Fechamento desatualizado aceito'; exception when sqlstate '22023' then null; end;
  r:=public.finance_report(day,day);
  perform public.finance_close(close_id,day,greatest((r->>'cash_balance')::numeric,0),'Contagem QA',r->>'token');
  begin perform public.register_sale_atomic(p||'-closed',p||'-a',1,100,'Pix'); raise exception 'Vendeu com dia fechado'; exception when sqlstate '22023' then null; end;
  assert not exists(select 1 from public.sales where id=p||'-closed'),'Fechamento deixou venda parcial';
  perform public.finance_reopen(close_id,'Reabrir para teste QA');
  assert (select snapshot->>'token'=r->>'token' from public.cash_closures where id=close_id),'Reabertura mudou snapshot';
end $test$;
set local role anon;
do $$ begin
  begin perform public.finance_export(); raise exception 'Backup público'; exception when sqlstate '42501' then null; end;
  begin perform public.finance_report(current_date,current_date); raise exception 'Financeiro público'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select 'PASS: cash, card, VIP, returns, exchanges, paid consignor payouts, fresh auth, closures, concurrency tokens, rollback and permissions.' as result;
