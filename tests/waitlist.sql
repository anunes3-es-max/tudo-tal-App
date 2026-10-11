-- Executar com acesso administrativo ao banco. Todos os dados de teste são revertidos.
begin;
create temp table qa_waitlist_products as
select 'qa-zero-' || gen_random_uuid()::text as zero_id,
       'qa-stock-' || gen_random_uuid()::text as stock_id;
insert into public.products(id,sku,name,category,mode,owner_name,price,qty)
select zero_id,zero_id,'QA Esgotado','Outros','proprio','QA',10,0 from qa_waitlist_products
union all
select stock_id,stock_id,'QA Disponível','Outros','proprio','QA',10,2 from qa_waitlist_products;
select set_config('qa.waitlist_zero',(select zero_id from qa_waitlist_products),true);
select set_config('qa.waitlist_stock',(select stock_id from qa_waitlist_products),true);

set local role anon;
do $test$
begin
  assert exists(select 1 from public.get_catalog_products() where id=current_setting('qa.waitlist_zero') and available_qty=0),'Esgotado sumiu';
  perform public.create_catalog_interest(current_setting('qa.waitlist_zero'),'Teste Lista','(11) 99999-0101');
  perform public.create_catalog_interest(current_setting('qa.waitlist_zero'),'Não sobrescrever','5511999990101');
  begin
    perform public.create_catalog_interest(current_setting('qa.waitlist_zero'),'Teste','123');
    raise exception 'Telefone inválido foi aceito';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.create_catalog_interest(current_setting('qa.waitlist_zero'),'A','(11) 99999-0101');
    raise exception 'Nome inválido foi aceito';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.create_catalog_interest(current_setting('qa.waitlist_stock'),'Teste','(11) 99999-0102');
    raise exception 'Inscrição de produto disponível foi aceita';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.create_catalog_interest('qa-inexistente','Teste','(11) 99999-0102');
    raise exception 'Inscrição de produto inexistente foi aceita';
  exception when sqlstate '22023' then null; end;
  begin
    perform customer_name from public.catalog_waitlist;
    raise exception 'Contatos expostos a visitante';
  exception when sqlstate '42501' then null; end;
  begin
    insert into public.catalog_waitlist(product_id,customer_name,customer_phone,status)
    values(current_setting('qa.waitlist_zero'),'Teste','5511999990102','Atendido');
    raise exception 'Visitante modificou o status inicial';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.update_catalog_interest_status(gen_random_uuid(),'Atendido');
    raise exception 'Visitante alterou um status';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.create_catalog_order('QA Teste','11999990101','Combinar pelo WhatsApp',null,
      jsonb_build_array(jsonb_build_object('product_id',current_setting('qa.waitlist_zero'),'qty',1)));
    raise exception 'Compra sem estoque foi aceita';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Estoque insuficiente%' then raise; end if;
  end;
end;
$test$;
reset role;
do $test$
begin
  assert (select count(*) from public.catalog_waitlist where product_id=current_setting('qa.waitlist_zero'))=1,'Interesse duplicado';
  assert (select customer_name from public.catalog_waitlist where product_id=current_setting('qa.waitlist_zero'))='Teste Lista','Nome sobrescrito';
  assert not exists(select 1 from public.catalog_orders where customer_name='QA Teste'),'Interesse criou pedido';
  assert not exists(select 1 from public.sales where product_id=current_setting('qa.waitlist_zero')),'Interesse criou venda';
  assert not exists(select 1 from public.inventory_movements where product_id=current_setting('qa.waitlist_zero')),'Interesse movimentou estoque';
  assert (select qty from public.products where id=current_setting('qa.waitlist_zero'))=0,'Interesse alterou estoque';
end;
$test$;

-- Uma sessão autenticada sem vínculo de administrador não pode ler ou gerenciar contatos.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $test$
begin
  assert not exists(select 1 from public.catalog_waitlist),'Usuário sem permissão leu contatos';
  begin
    perform public.update_catalog_interest_status(gen_random_uuid(),'Atendido');
    raise exception 'Usuário sem permissão gerenciou contatos';
  exception when sqlstate '42501' then null; end;
end;
$test$;
reset role;

-- Validação da política do administrador sem criar sessão nem conta de teste.
select set_config('request.jwt.claim.sub',(select user_id::text from public.app_members where role='admin' and active limit 1),true);
set local role authenticated;
do $test$
declare v_id uuid;
begin
  select id into strict v_id from public.catalog_waitlist where product_id=current_setting('qa.waitlist_zero');
  perform public.update_catalog_interest_status(v_id,'Avisado');
  assert exists(select 1 from public.catalog_waitlist where id=v_id and status='Avisado' and notified_at is not null),'Aviso não gravado';
  begin
    perform public.update_catalog_interest_status(v_id,'Inválido');
    raise exception 'Status inválido foi aceito';
  exception when sqlstate '22023' then null; end;
end;
$test$;
reset role;
set local role anon;
select public.create_catalog_interest(current_setting('qa.waitlist_zero'),'Não sobrescrever','11999990101');
reset role;
do $test$ begin
  assert (select count(*) from public.catalog_waitlist where product_id=current_setting('qa.waitlist_zero'))=1,'Repetição após aviso criou outra linha';
end; $test$;
set local role authenticated;
select public.update_catalog_interest_status((select id from public.catalog_waitlist where product_id=current_setting('qa.waitlist_zero')),'Atendido');
reset role;
set local role anon;
select public.create_catalog_interest(current_setting('qa.waitlist_zero'),'Novo interesse','11999990101');
reset role;
do $test$ begin
  assert (select count(*) from public.catalog_waitlist where product_id=current_setting('qa.waitlist_zero') and status<>'Atendido')=1,'Duplicou interesse em aberto';
  assert (select count(*) from public.catalog_waitlist where product_id=current_setting('qa.waitlist_zero'))=2,'Histórico do atendido perdido';
end; $test$;

-- Reposição e reservas do catálogo continuam refletindo a disponibilidade correta.
update public.products set qty=2 where id=current_setting('qa.waitlist_zero');
set local role anon;
do $test$
begin
  assert exists(select 1 from public.get_catalog_products() where id=current_setting('qa.waitlist_zero') and available_qty=2),'Reposição não refletiu';
  begin
    perform public.create_catalog_interest(current_setting('qa.waitlist_zero'),'Teste','11999990102');
    raise exception 'Aceitou interesse após reposição';
  exception when sqlstate '22023' then null; end;
  perform public.create_catalog_order('QA Reserva','11999990103','Combinar pelo WhatsApp',null,
    jsonb_build_array(jsonb_build_object('product_id',current_setting('qa.waitlist_stock'),'qty',2)));
  assert exists(select 1 from public.get_catalog_products() where id=current_setting('qa.waitlist_stock') and available_qty=0),'Produto reservado sumiu';
  perform public.create_catalog_interest(current_setting('qa.waitlist_stock'),'QA Espera','11999990104');
end;
$test$;
reset role;
update public.catalog_orders set reservation_expires_at=now()-interval '1 minute' where customer_name='QA Reserva';
set local role anon;
do $test$ begin
  assert exists(select 1 from public.get_catalog_products() where id=current_setting('qa.waitlist_stock') and available_qty=2),'Reserva expirada não liberou unidades';
end; $test$;
reset role;
rollback;
select 'PASS: esgotado, cadastro anônimo, duplicados, validação, privacidade, gestão administrativa, reposição e reservas; simulações revertidas.' as verification;
