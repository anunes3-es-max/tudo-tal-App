-- Run only in the disposable local database. All records are synthetic and rolled back.
begin;
select set_config('qa.security_prefix','qa-security-'||gen_random_uuid()::text,true);
select set_config('qa.security_admin',(select user_id::text from public.app_members where active and role='admin' limit 1),true);
insert into public.products(id,sku,name,category,mode,owner_name,owner_phone,cost,price,qty,catalog_section,is_donation)
select current_setting('qa.security_prefix')||'-'||x.id,current_setting('qa.security_prefix')||'-'||x.id,
  'QA '||x.id,x.category,'proprio','Consignante privado QA','5511999990111',5,
  case when x.donation then 0 else 80 end,x.qty,x.section,x.donation
from (values
  ('clothing','Outros','vestuario',0,false),
  ('legacy-1','Vestuário & Brechó','loja',0,false),
  ('legacy-2','Vestuário e Brechó','loja',0,false),
  ('legacy-3','Moda Adulto','loja',0,false),
  ('legacy-4','  MODA   INFANTIL  ','loja',0,false),
  ('legacy-5','Bolsas','loja',0,false),
  ('legacy-6','Calçados','loja',0,false),
  ('donation','Moda Adulto','vestuario',0,true),
  ('beauty','Skincare','loja',0,false),
  ('available','Moda Adulto','vestuario',1,false)
) x(id,category,section,qty,donation);

do $test$
begin
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and p.proname in
      ('get_catalog_config','get_catalog_products','update_catalog_config','update_catalog_order_status','confirm_catalog_order')),
    'RPC revisada ainda eleva privilégios no esquema público';
  assert not has_function_privilege('anon','private.confirm_catalog_order_impl(uuid,text,integer,date,text,text,text,text,text)','EXECUTE'),
    'Visitante recebeu privilégio de confirmar pedido';
end $test$;

set local role anon;
do $test$
declare p text:=current_setting('qa.security_prefix'); q text; result jsonb; n integer;
begin
  result:=public.get_catalog_config();
  assert result ?& array['store_name','whatsapp_number','reservation_minutes'],'Configuração pública inacessível';
  assert (select count(*) from jsonb_object_keys(result))=3,'Configuração pública expõe campos extras';
  begin
    perform updated_at from public.catalog_config;
    assert false,'Visitante leu coluna interna da configuração';
  exception when insufficient_privilege then null; end;
  begin
    update public.catalog_config set whatsapp_number='5511999990999' where id=1;
    assert false,'Visitante alterou configuração';
  exception when insufficient_privilege then null; end;

  assert (select count(*) from public.get_catalog_products_v2() where id like p||'%')=2,
    'Peça esgotada escapou do filtro da API atual';
  assert (select count(*) from public.get_catalog_products() where id like p||'%')=2,
    'Peça esgotada escapou do filtro da API antiga';
  select to_jsonb(x) into result from public.get_catalog_products_v2() x where id=p||'-available';
  assert not result ?| array['cost','owner_name','owner_phone','partner_id'],'Catálogo revelou dados internos';
  assert (select available_qty=0 from public.get_catalog_products_v2() where id=p||'-beauty'),
    'Produto de reposição esgotado desapareceu';
  perform public.create_catalog_interest(p||'-beauty','Interesse QA','11999990110');

  foreach q in array array['clothing','legacy-1','legacy-2','legacy-3','legacy-4','legacy-5','legacy-6','donation'] loop
    begin
      perform public.create_catalog_interest(p||'-'||q,'Interesse QA','11999990110');
      assert false,'Lista de espera aceitou peça única';
    exception when sqlstate '22023' then null; end;
    begin
      insert into public.catalog_waitlist(product_id,customer_name,customer_phone)
      values(p||'-'||q,'Interesse QA','5511999990110');
      assert false,'INSERT direto burlou bloqueio da lista de espera';
    exception when insufficient_privilege then null; end;
  end loop;

  foreach q in array array[
    'select public.update_catalog_config(''11999990101'',60)',
    'select public.update_catalog_order_status(gen_random_uuid(),''Pago'')',
    'select public.confirm_catalog_order(gen_random_uuid(),''Pix'')',
    'select private.confirm_catalog_order_impl(gen_random_uuid(),''Pix'')'
  ] loop
    begin execute q; assert false,'Visitante executou função administrativa';
    exception when insufficient_privilege then null; end;
  end loop;
  foreach q in array array['products','sales','catalog_orders','catalog_order_items','catalog_waitlist','finance_movements','finance_events','finance_pending','cash_closures'] loop
    begin
      execute format('select count(*) from public.%I',q) into n;
      assert n=0,'Visitante leu registros internos';
    exception when insufficient_privilege then null; end;
  end loop;

  result:=public.create_catalog_order('Cliente QA','11999990120','Retirada na loja',null,
    jsonb_build_array(jsonb_build_object('product_id',p||'-available','qty',1)));
  perform set_config('qa.security_order',result->>'order_id',true);
  assert not exists(select 1 from public.get_catalog_products_v2() where id=p||'-available'),
    'Última peça reservada continuou disponível';
end $test$;
reset role;

-- Being signed in, including forged user_metadata, does not make someone an admin.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
select set_config('request.jwt.claims','{"user_metadata":{"role":"admin","is_admin":true}}',true);
set local role authenticated;
do $test$
declare q text; n integer;
begin
  assert not private.is_admin(),'user_metadata concedeu administração';
  assert public.get_catalog_config() is not null,'Configuração pública indisponível para usuário autenticado';
  foreach q in array array[
    'select public.update_catalog_config(''11999990101'',60)',
    'select public.update_catalog_order_status(current_setting(''qa.security_order'')::uuid,''Pago'')',
    'select public.confirm_catalog_order(current_setting(''qa.security_order'')::uuid,''Pix'')',
    'select private.confirm_catalog_order_impl(current_setting(''qa.security_order'')::uuid,''Pix'')'
  ] loop
    begin execute q; assert false,'Usuário sem vínculo executou operação administrativa';
    exception when insufficient_privilege then null; end;
  end loop;
  foreach q in array array['products','sales','catalog_orders','catalog_order_items','catalog_waitlist','finance_movements','finance_events','finance_pending','cash_closures'] loop
    execute format('select count(*) from public.%I',q) into n;
    assert n=0,'Usuário sem vínculo leu dados internos';
  end loop;
  update public.catalog_config set whatsapp_number='5511999990999' where id=1;
  get diagnostics n=row_count; assert n=0,'Usuário sem vínculo alterou configuração via tabela';
  update public.catalog_orders set status='Pago' where id=current_setting('qa.security_order')::uuid;
  get diagnostics n=row_count; assert n=0,'Usuário sem vínculo alterou pedido via tabela';
end $test$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('qa.security_admin'),true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $test$
declare p text:=current_setting('qa.security_prefix'); oid uuid:=current_setting('qa.security_order')::uuid;
  result jsonb; sid text;
begin
  result:=public.update_catalog_config('11999990100',75);
  assert result->>'whatsapp_number'='5511999990100' and (result->>'reservation_minutes')::int=75,
    'Admin não conseguiu atualizar configuração com RLS';
  result:=public.update_catalog_order_status(oid,'Em atendimento');
  assert result->>'status'='Em atendimento','Admin não conseguiu atualizar pedido com RLS';
  result:=public.confirm_catalog_order(oid,'Pix');
  assert result->>'status'='completed','Confirmação autorizada falhou';
  sid:=result->'sale_ids'->>0;
  assert (select qty=0 from public.products where id=p||'-available'),'Venda não baixou estoque interno';
  assert (select total=80 from public.sales where id=sid),'Venda não foi registrada';
  assert (select sum(amount)=80 and count(*)=1 from public.finance_movements where sale_id=sid and principal),
    'Venda e caixa não foram sincronizados';
  result:=public.confirm_catalog_order(oid,'Pix');
  assert result->>'status'='already_completed','Confirmação repetida perdeu idempotência';
  assert (select count(*)=1 from public.finance_movements where sale_id=sid and principal),'Reenvio duplicou receita';
  assert not exists(select 1 from public.get_catalog_products_v2() where id=p||'-available'),
    'Peça vendida reapareceu na vitrine';
  assert (select count(*)=10 from public.products where id like p||'%'),'Filtro apagou cadastro interno';
  assert (select count(*)=1 from public.catalog_waitlist where product_id like p||'%'),
    'Bloqueio de peças únicas alterou a lista de reposição';
end $test$;
reset role;
rollback;
select 'PASS: sete permissões revisadas; configuração pública limitada; anon e não-admin bloqueados; metadados sem privilégio; peças únicas ocultas nas duas APIs; lista de espera bloqueada via RPC e INSERT; estoque/venda/caixa atômicos e idempotentes.' as result;
