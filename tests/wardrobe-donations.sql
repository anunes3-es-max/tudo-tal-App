-- Run as the administrative test connection. All fixtures and changes roll back.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.app_members where active and role='admin' limit 1),true);
select set_config('qa.wardrobe_prefix','qa-wardrobe-'||gen_random_uuid()::text,true);
set local role authenticated;
do $test$
declare p text:=current_setting('qa.wardrobe_prefix'); r jsonb; doc jsonb;
begin
 doc:=jsonb_build_object('id',p||'-sale','sku',p||'-sale','name','QA peça à venda','category','Moda Adulto',
  'mode','proprio','owner_name','QA','price',80,'qty',1,'catalog_section','vestuario','age_group','adulto',
  'gender','feminino','size','M','photo_url','https://example.invalid/qa.jpg');
 r:=public.save_product(doc);
 assert r->>'gender'='feminino' and r->>'catalog_section'='vestuario','Metadados não persistiram';
 r:=public.save_product(doc||'{"qty":0,"expected_qty":1}'::jsonb);
 assert (r->>'qty')::integer=0,'Estoque zero não foi salvo';
 assert r->>'photo_url'='https://example.invalid/qa.jpg','Foto mudou ao editar estoque';
 assert (select available_qty=0 from public.get_catalog_products_v2() where id=p||'-sale'),'Esgotado desapareceu';
 begin
  perform public.save_product(doc||'{"qty":3,"expected_qty":1}'::jsonb);
  raise exception 'Ajuste desatualizado aceito';
 exception when sqlstate '40001' then null; end;
 perform public.save_product(doc||'{"qty":1,"expected_qty":0}'::jsonb);
 begin
  perform public.save_product(doc||'{"qty":-1,"expected_qty":1}'::jsonb);
  raise exception 'Estoque negativo aceito';
 exception when sqlstate '22023' then null; end;
 doc:=doc||jsonb_build_object('id',p||'-gift','sku',p||'-gift','name','QA doação','price',0,'qty',2,'is_donation',true);
 perform public.save_product(doc);
 assert (select price=0 and is_donation and available_qty=2 from public.get_catalog_products_v2() where id=p||'-gift'),'Doação não é grátis';
 assert not exists(select 1 from public.get_catalog_products() where id=p||'-gift'),'Cliente antigo vê doação como compra';
 begin
  perform public.save_product(doc||'{"mode":"consignado"}'::jsonb);raise exception 'Doação consignada aceita';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.save_product(doc||'{"price":10}'::jsonb);raise exception 'Doação com cobrança aceita';
 exception when sqlstate '22023' then null; end;
end $test$;
set local role anon;
do $test$
declare p text:=current_setting('qa.wardrobe_prefix'); r jsonb; again jsonb;
begin
 r:=public.create_catalog_donation('Cliente QA','(11) 99999-0101',p||'-gift','Retirada QA');
 perform set_config('qa.donation_order',r->>'order_id',true);
 assert (r->>'subtotal')::numeric=0 and (r->>'reservation_minutes')::int=1440,'Prazo ou total incorreto';
 assert (select available_qty=1 from public.get_catalog_products_v2() where id=p||'-gift'),'Reserva não reduziu disponibilidade';
 again:=public.create_catalog_donation('Cliente QA','5511999990101',p||'-gift',null);
 assert again->>'order_id'=r->>'order_id','Reenvio duplicou reserva';
 assert (select available_qty=1 from public.get_catalog_products_v2() where id=p||'-gift'),'Reenvio bloqueou outra peça';
 r:=public.create_catalog_donation('Outra pessoa QA','11999990102',p||'-gift',null);
 perform set_config('qa.donation_order_two',r->>'order_id',true);
 assert (select available_qty=0 from public.get_catalog_products_v2() where id=p||'-gift'),'Segunda unidade não reservada';
 begin
  perform public.create_catalog_donation('Sem estoque QA','11999990103',p||'-gift',null);
  raise exception 'Reserva acima do estoque aceita' using errcode='22000';
 exception when sqlstate 'P0001' then null; end;
 begin
  perform public.create_catalog_order('Compra QA','11999990103','Retirada na loja',null,
    jsonb_build_array(jsonb_build_object('product_id',p||'-gift','qty',1)));
  raise exception 'Doação entrou em compra';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.create_catalog_donation('Cliente QA','11999990103',p||'-sale',null);
  raise exception 'Produto pago doado';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.complete_catalog_donation(current_setting('qa.donation_order')::uuid);
  raise exception 'Anônimo concluiu retirada';
 exception when insufficient_privilege then null; end;
 begin
  assert not exists(select 1 from public.catalog_orders),'Anônimo leu contatos de pedidos';
 exception when insufficient_privilege then null; end;
end $test$;
set local role authenticated;
do $test$
declare p text:=current_setting('qa.wardrobe_prefix'); oid uuid:=current_setting('qa.donation_order')::uuid;
 r jsonb; count_sales integer; count_cash integer; count_receivables integer; doc jsonb;
begin
 select count(*) into count_sales from public.sales;
 select count(*) into count_cash from public.cash;
 select count(*) into count_receivables from public.receivable_installments;
 select to_jsonb(x) into doc from public.products x where id=p||'-gift';
 begin
  perform public.save_product(doc||'{"is_donation":false,"price":80,"expected_qty":2}'::jsonb);
  raise exception 'Conversão com reserva aceita';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.confirm_catalog_order(oid,'Pix');raise exception 'Doação registrada como venda';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.update_catalog_order_status(oid,'Pago');raise exception 'Doação cobrada';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.register_sale_atomic(p||'-bad-sale',p||'-gift',1,0.01,'Pix');
  raise exception 'Doação vendida pelo PDV';
 exception when sqlstate '22023' then null; end;
 perform public.update_catalog_order_status(oid,'Em atendimento');
 r:=public.complete_catalog_donation(oid);
 assert r->>'status'='completed','Retirada não concluída';
 assert (select qty=1 from public.products where id=p||'-gift'),'Estoque físico incorreto';
 r:=public.complete_catalog_donation(oid);
 assert r->>'status'='already_completed','Retirada repetida não foi idempotente';
 assert (select qty=1 from public.products where id=p||'-gift'),'Baixa duplicada';
 assert (select count(*)=1 from public.inventory_movements where reference_type='catalog_donation' and reference_id=oid::text),'Histórico de saída incorreto';
 assert (select count(*)=count_sales from public.sales),'Doação criou venda';
 assert (select count(*)=count_cash from public.cash),'Doação alterou caixa';
 assert (select count(*)=count_receivables from public.receivable_installments),'Doação criou cobrança';
 perform public.update_catalog_order_status(current_setting('qa.donation_order_two')::uuid,'Cancelado');
 assert (select available_qty=1 from public.get_catalog_products_v2() where id=p||'-gift'),'Cancelamento não liberou peça';
 -- Ordinary paid checkout still works.
 r:=public.create_catalog_order('Compra normal QA','11999990104','Retirada na loja',null,
  jsonb_build_array(jsonb_build_object('product_id',p||'-sale','qty',1)));
 assert (r->>'subtotal')::numeric=80,'Compra paga afetada';
 perform public.confirm_catalog_order((r->>'order_id')::uuid,'Pix');
 assert (select qty=0 from public.products where id=p||'-sale'),'Venda paga não baixou estoque';
 r:=public.create_catalog_donation('Reserva expirada QA','11999990105',p||'-gift',null);
 perform set_config('qa.expired_donation_order',r->>'order_id',true);
end $test$;
reset role;
update public.catalog_orders set reservation_expires_at=now()-interval '1 minute' where id=current_setting('qa.expired_donation_order')::uuid;
set local role anon;
do $test$
begin
 assert (select available_qty=1 from public.get_catalog_products_v2() where id=current_setting('qa.wardrobe_prefix')||'-gift'),'Expiração não liberou peça';
end $test$;
set local role authenticated;
do $test$
begin
 begin
  perform public.update_catalog_order_status(current_setting('qa.expired_donation_order')::uuid,'Novo');
  raise exception 'Reserva expirada ressuscitou';
 exception when sqlstate '22023' then null; end;
end $test$;
reset role;
rollback;
select 'PASS: estoque zero, filtros persistidos, doação gratuita, reservas, reenvio, permissões, retirada sem receita, cancelamento, expiração e venda normal.' as result;

