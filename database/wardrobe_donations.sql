-- Vestuário, doações gratuitas e atualização explícita do estoque.
-- Novas colunas mantêm o comportamento dos produtos/pedidos existentes.
alter table public.products
  add column catalog_section text not null default 'loja' check (catalog_section in ('loja','vestuario')),
  add column age_group text check (age_group in ('adulto','infantil')),
  add column gender text check (gender in ('feminino','masculino','unissex')),
  add column is_donation boolean not null default false;
update public.products set catalog_section='vestuario',
 age_group=case category when 'Moda Adulto' then 'adulto' when 'Moda Infantil' then 'infantil' end
where category in ('Moda Adulto','Moda Infantil','Calçados','Bolsas');
alter table public.products drop constraint products_price_check;
alter table public.products add constraint products_offer_price_check check (
 (not is_donation and price>0) or
 (is_donation and price=0 and discount_percent=0 and catalog_section='vestuario' and mode='proprio')
);
alter table public.catalog_orders add column order_type text not null default 'sale'
 check (order_type in ('sale','donation'));
alter table public.catalog_orders add constraint catalog_donation_terms_check check (
 order_type<>'donation' or (subtotal=0 and fulfillment='Retirada na loja'
 and status not in ('Pago','Aguardando pagamento') and payment is null)
);
alter table public.catalog_order_items add column is_donation boolean not null default false;
alter table public.catalog_order_items drop constraint catalog_order_items_unit_price_check;
alter table public.catalog_order_items add constraint catalog_order_items_offer_price_check check (
 (not is_donation and unit_price>0) or
 (is_donation and unit_price=0 and original_unit_price=0 and total=0 and discount_percent=0 and discount_amount=0)
);

CREATE OR REPLACE FUNCTION private.save_product_impl(p_product jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_id text := nullif(trim(p_product->>'id'),'');
  v_sku text := nullif(trim(p_product->>'sku'),'');
  v_name text := nullif(trim(p_product->>'name'),'');
  v_category text := nullif(trim(p_product->>'category'),'');
  v_mode text := nullif(trim(p_product->>'mode'),'');
  v_owner text := nullif(trim(p_product->>'owner_name'),'');
  v_price numeric := coalesce((p_product->>'price')::numeric,0);
  v_qty integer := coalesce((p_product->>'qty')::integer,0);
  v_expected_qty integer := case
    when p_product ? 'expected_qty' and nullif(trim(p_product->>'expected_qty'),'') is not null
      then (p_product->>'expected_qty')::integer
    else null
  end;
  v_cost numeric := coalesce((p_product->>'cost')::numeric,0);
  v_discount numeric := coalesce((p_product->>'discount_percent')::numeric,0);
  v_existing public.products%rowtype;
  v_row public.products%rowtype;
  v_final_qty integer;
  v_found boolean;
  v_section text;
  v_age text;
  v_gender text;
  v_donation boolean;
  v_delta integer;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;

  if v_id is null or v_sku is null or v_name is null or v_category is null
     or v_mode is null or v_owner is null then
    raise exception 'Cadastro do produto incompleto.' using errcode='22023';
  end if;
  if v_price < 0 or v_qty < 0 or v_cost < 0 or v_discount < 0 or v_discount > 50 then
    raise exception 'Valores inválidos no cadastro do produto.' using errcode='22023';
  end if;

  select * into v_existing
  from public.products
  where id=v_id
  for update;

  v_found := found;
  v_section := coalesce(p_product->>'catalog_section',v_existing.catalog_section,
    case when v_category in ('Moda Adulto','Moda Infantil','Calçados','Bolsas') then 'vestuario' else 'loja' end);
  v_age := case when p_product ? 'age_group' then nullif(p_product->>'age_group','') else v_existing.age_group end;
  v_gender := case when p_product ? 'gender' then nullif(p_product->>'gender','') else v_existing.gender end;
  v_donation := coalesce((p_product->>'is_donation')::boolean,v_existing.is_donation,false);
  if (not v_donation and v_price<=0) or (v_donation and
      (v_price<>0 or v_discount<>0 or v_section<>'vestuario' or v_mode<>'proprio')) then
    raise exception 'Doações precisam estar no vestuário, com estoque próprio, preço e desconto zero.' using errcode='22023';
  end if;
  if v_found and v_donation is distinct from v_existing.is_donation
     and private.active_reserved_qty(v_id,null)>0 then
    raise exception 'Cancele ou conclua a reserva antes de mudar entre venda e doação.' using errcode='22023';
  end if;

  if v_found then
    v_final_qty := v_existing.qty;

    -- Só altera estoque quando a tela atual declara qual quantidade viu.
    -- Se houve venda/alteração em outro aparelho, rejeita o ajuste em vez
    -- de ressuscitar estoque antigo.
    if v_expected_qty is not null and v_qty <> v_expected_qty then
      if v_existing.qty <> v_expected_qty then
        raise exception 'O estoque mudou em outro aparelho. Atualize o app e tente o ajuste novamente.'
          using errcode='40001';
      end if;
      v_final_qty := v_qty;
    end if;

    update public.products
       set sku=v_sku,
           name=v_name,
           category=v_category,
           brand=nullif(p_product->>'brand',''),
           size=nullif(p_product->>'size',''),
           color=nullif(p_product->>'color',''),
           condition=nullif(p_product->>'condition',''),
           mode=v_mode,
           owner_name=v_owner,
           owner_phone=nullif(p_product->>'owner_phone',''),
           price=v_price,
           qty=v_final_qty,
           cost=v_cost,
           stock_type=nullif(p_product->>'stock_type',''),
           photo_url=nullif(p_product->>'photo_url',''),
           active=coalesce((p_product->>'active')::boolean,true),
           updated_at=now(),
           discount_percent=v_discount,
           catalog_section=v_section,age_group=v_age,gender=v_gender,is_donation=v_donation
     where id=v_id
     returning * into v_row;

    v_delta := v_final_qty - v_existing.qty;
    if v_delta <> 0 then
      insert into public.inventory_movements(
        product_id,sku,movement_type,qty_delta,reference_type,reference_id,note
      ) values(
        v_row.id,v_row.sku,'ajuste',v_delta,'manual_adjustment',null,'Ajuste manual de estoque'
      );
    end if;
  else
    insert into public.products(
      id,sku,name,category,brand,size,color,condition,mode,partner_id,
      owner_name,owner_phone,price,qty,cost,stock_type,photo_url,active,
      created_at,updated_at,discount_percent,catalog_section,age_group,gender,is_donation
    ) values(
      v_id,v_sku,v_name,v_category,
      nullif(p_product->>'brand',''),
      nullif(p_product->>'size',''),
      nullif(p_product->>'color',''),
      nullif(p_product->>'condition',''),
      v_mode,null,
      v_owner,
      nullif(p_product->>'owner_phone',''),
      v_price,v_qty,v_cost,
      nullif(p_product->>'stock_type',''),
      nullif(p_product->>'photo_url',''),
      coalesce((p_product->>'active')::boolean,true),
      coalesce((p_product->>'created_at')::timestamptz,now()),
      now(),
      v_discount,v_section,v_age,v_gender,v_donation
    )
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$function$;


-- O catálogo antigo continua exibindo somente produtos à venda.
CREATE OR REPLACE FUNCTION public.get_catalog_products()
 RETURNS TABLE(id text, sku text, name text, category text, brand text, size text, color text, condition text, price numeric, original_price numeric, discount_percent numeric, photo_url text, available_qty integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  perform private.expire_catalog_orders_impl();
  return query
  select
    p.id, p.sku, p.name, p.category, p.brand, p.size, p.color, p.condition,
    greatest(round((p.price * (1 - greatest(0, least(coalesce(p.discount_percent,0),50)) / 100))::numeric,2),0.01),
    p.price,
    greatest(0,least(coalesce(p.discount_percent,0),50)),
    p.photo_url,
    greatest(p.qty - private.active_reserved_qty(p.id,null),0)::integer
  from public.products p
  where p.active = true and not p.is_donation
  order by (p.qty - private.active_reserved_qty(p.id,null) > 0) desc,
           p.updated_at desc, p.name;
end;
$function$;


CREATE OR REPLACE FUNCTION private.get_catalog_products_v2_impl()
 RETURNS TABLE(id text, sku text, name text, category text, brand text, size text, color text, condition text, price numeric, original_price numeric, discount_percent numeric, photo_url text, available_qty integer, catalog_section text, age_group text, gender text, is_donation boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  perform private.expire_catalog_orders_impl();
  return query
  select
    p.id, p.sku, p.name, p.category, p.brand, p.size, p.color, p.condition,
    case when p.is_donation then 0::numeric else greatest(round((p.price * (1 - greatest(0, least(coalesce(p.discount_percent,0),50)) / 100))::numeric,2),0.01) end,
    p.price,
    greatest(0,least(coalesce(p.discount_percent,0),50)),
    p.photo_url,
    greatest(p.qty - private.active_reserved_qty(p.id,null),0)::integer,
    p.catalog_section,p.age_group,p.gender,p.is_donation
  from public.products p
  where p.active = true
  order by (p.qty - private.active_reserved_qty(p.id,null) > 0) desc,
           p.updated_at desc, p.name;
end;
$function$;

create function public.get_catalog_products_v2()
returns table(id text,sku text,name text,category text,brand text,size text,color text,condition text,
 price numeric,original_price numeric,discount_percent numeric,photo_url text,available_qty integer,
 catalog_section text,age_group text,gender text,is_donation boolean)
language sql security invoker set search_path=pg_catalog,public,private
as $$ select * from private.get_catalog_products_v2_impl(); $$;
revoke all on function private.get_catalog_products_v2_impl(),public.get_catalog_products_v2() from public;
grant execute on function private.get_catalog_products_v2_impl(),public.get_catalog_products_v2() to anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.create_catalog_order_v2_impl(p_customer_name text, p_customer_phone text, p_fulfillment text, p_notes text, p_items jsonb, p_order_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_order_id uuid:=gen_random_uuid();
  v_order_number text;
  v_expires timestamptz;
  v_minutes integer;
  v_total numeric(12,2):=0;
  v_item record;
  v_product public.products%rowtype;
  v_reserved integer;
  v_available integer;
  v_phone_digits text;
  v_discount numeric(5,2);
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_existing public.catalog_orders%rowtype;
begin
  perform private.expire_catalog_orders_impl();
  if p_order_type is null or p_order_type not in ('sale','donation') then raise exception 'Tipo de pedido inválido.' using errcode='22023'; end if;

  if length(trim(coalesce(p_customer_name,'')))<2 or length(trim(p_customer_name))>80 then
    raise exception 'Informe seu nome.' using errcode='22023';
  end if;
  v_phone_digits:=regexp_replace(coalesce(p_customer_phone,''),'[^0-9]','','g');
  if length(v_phone_digits)<10 or length(v_phone_digits)>13 then
    raise exception 'Informe um WhatsApp válido com DDD.' using errcode='22023';
  end if;
  if p_fulfillment is null or p_fulfillment not in ('Retirada na loja','Combinar entrega pelo WhatsApp','Combinar pelo WhatsApp') then
    raise exception 'Forma de recebimento inválida.' using errcode='22023';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>20 then
    raise exception 'Carrinho inválido.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_items) as x(product_id text,qty integer)
    where coalesce(x.product_id,'')='' or coalesce(x.qty,0)<1 or x.qty>20
  ) then
    raise exception 'Há item com quantidade inválida.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_items) as x(product_id text,qty integer)
    group by x.product_id having count(*)>1
  ) then
    raise exception 'Há produto repetido no carrinho.' using errcode='22023';
  end if;

  if p_order_type='donation' and (p_fulfillment<>'Retirada na loja' or jsonb_array_length(p_items)<>1
    or (p_items->0->>'qty')::integer<>1) then
    raise exception 'Escolha uma peça por solicitação para retirada grátis na loja.' using errcode='22023';
  end if;
  -- Mesma peça/telefone: uma repetição da solicitação retorna a reserva existente.
  if p_order_type='donation' then
    if length(v_phone_digits) in (10,11) then v_phone_digits:='55'||v_phone_digits; end if;
    if v_phone_digits !~ '^55[1-9][0-9]([2-9][0-9]{7}|9[0-9]{8})$' then raise exception 'Informe um WhatsApp válido com DDD.' using errcode='22023'; end if;
    perform 1 from public.products where id=p_items->0->>'product_id' for update;
    select o.* into v_existing from public.catalog_orders o
      join public.catalog_order_items i on i.order_id=o.id
     where o.order_type='donation' and o.customer_phone=v_phone_digits
       and i.product_id=p_items->0->>'product_id'
       and o.status in ('Novo','Em atendimento') and o.reservation_expires_at>now()
     order by o.created_at desc limit 1;
    if found then
      return jsonb_build_object('order_id',v_existing.id,'order_number',v_existing.order_number,
        'subtotal',0,'reservation_expires_at',v_existing.reservation_expires_at,
        'reservation_minutes',1440,'order_type','donation');
    end if;
  end if;

  select reservation_minutes into v_minutes from public.catalog_config where id=1;
  v_minutes:=case when p_order_type='donation' then 1440 else coalesce(v_minutes,60) end;
  v_expires:=now()+make_interval(mins=>v_minutes);
  v_order_number:='TDT-'||to_char(now(),'YYMMDD')||'-'||upper(substr(replace(v_order_id::text,'-',''),1,5));

  insert into public.catalog_orders(
    id,order_number,customer_name,customer_phone,fulfillment,notes,status,subtotal,reservation_expires_at,order_type
  ) values(
    v_order_id,v_order_number,trim(p_customer_name),v_phone_digits,p_fulfillment,
    nullif(left(trim(coalesce(p_notes,'')),500),''),
    'Novo',0,v_expires,p_order_type
  );

  for v_item in
    select x.product_id,x.qty
      from jsonb_to_recordset(p_items) as x(product_id text,qty integer)
     order by x.product_id
  loop
    select * into v_product
      from public.products
     where id=v_item.product_id and active=true
     for update;

    if not found then
      raise exception 'Um produto do carrinho não está mais disponível.' using errcode='P0002';
    end if;

    if v_product.is_donation is distinct from (p_order_type='donation') then
      raise exception 'Use a opção de retirada grátis para doações e a sacola para compras.' using errcode='22023';
    end if;
    v_reserved:=private.active_reserved_qty(v_product.id,v_order_id);
    v_available:=greatest(v_product.qty-v_reserved,0);
    if v_item.qty>v_available then
      raise exception 'Estoque insuficiente para %. Disponível: % unidade(s).',
        v_product.name,v_available using errcode='P0001';
    end if;

    v_discount:=greatest(0,least(coalesce(v_product.discount_percent,0),50));
    v_unit_price:=case when v_product.is_donation then 0 else greatest(round((v_product.price*(1-v_discount/100))::numeric,2),0.01) end;
    v_line_total:=round((v_unit_price*v_item.qty)::numeric,2);

    insert into public.catalog_order_items(
      order_id,product_id,sku,product_name,product_category,product_brand,product_size,photo_url,
      unit_price,original_unit_price,discount_percent,discount_amount,qty,total,is_donation
    ) values(
      v_order_id,v_product.id,v_product.sku,v_product.name,v_product.category,v_product.brand,v_product.size,
      v_product.photo_url,v_unit_price,v_product.price,v_discount,
      round(((v_product.price-v_unit_price)*v_item.qty)::numeric,2),v_item.qty,v_line_total,v_product.is_donation
    );

    v_total:=v_total+v_line_total;
  end loop;

  update public.catalog_orders
     set subtotal=v_total,updated_at=now()
   where id=v_order_id;

  return jsonb_build_object(
    'order_id',v_order_id,
    'order_number',v_order_number,
    'subtotal',v_total,
    'reservation_expires_at',v_expires,
    'reservation_minutes',v_minutes,
    'order_type',p_order_type
  );
end;
$function$;

create or replace function public.create_catalog_order(p_customer_name text,p_customer_phone text,p_fulfillment text,p_notes text,p_items jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog,public,private
as $$ select private.create_catalog_order_v2_impl(p_customer_name,p_customer_phone,p_fulfillment,p_notes,p_items,'sale'); $$;
create function public.create_catalog_donation(p_customer_name text,p_customer_phone text,p_product_id text,p_notes text default null)
returns jsonb language sql security invoker set search_path=pg_catalog,public,private
as $$ select private.create_catalog_order_v2_impl(p_customer_name,p_customer_phone,'Retirada na loja',p_notes,
 jsonb_build_array(jsonb_build_object('product_id',p_product_id,'qty',1)),'donation'); $$;
revoke all on function private.create_catalog_order_v2_impl(text,text,text,text,jsonb,text),public.create_catalog_donation(text,text,text,text) from public;
grant execute on function private.create_catalog_order_v2_impl(text,text,text,text,jsonb,text),public.create_catalog_donation(text,text,text,text) to anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.confirm_catalog_order(p_order_id uuid, p_payment text, p_installments integer DEFAULT 1, p_first_due_date date DEFAULT NULL::date, p_card_brand text DEFAULT NULL::text, p_receiving_plan text DEFAULT 'one_day'::text, p_rate_tier text DEFAULT 'up_to_20'::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_order public.catalog_orders%rowtype;
  v_item public.catalog_order_items%rowtype;
  v_sale_ids text[]:='{}'::text[];
  v_sale_id text;
  v_idx integer:=0;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;
  perform private.expire_catalog_orders_impl();

  select * into v_order from public.catalog_orders where id=p_order_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode='P0002'; end if;
  if v_order.order_type='donation' then raise exception 'Confirme a retirada gratuita deste pedido.' using errcode='22023'; end if;
  if v_order.status='Concluído' then
    return jsonb_build_object('status','already_completed','order',to_jsonb(v_order),'sale_ids',to_jsonb(v_order.sale_ids));
  end if;
  if v_order.status in ('Cancelado','Expirado') then
    raise exception 'Este pedido não possui reserva ativa.' using errcode='P0001';
  end if;
  if v_order.status<>'Pago' and v_order.reservation_expires_at<=now() then
    raise exception 'A reserva deste pedido expirou.' using errcode='P0001';
  end if;

  perform set_config('tdt.catalog_order_id',p_order_id::text,true);

  for v_item in
    select * from public.catalog_order_items where order_id=p_order_id order by product_id
  loop
    v_idx:=v_idx+1;
    v_sale_id:='ven-cat-'||replace(p_order_id::text,'-','')||'-'||lpad(v_idx::text,2,'0');
    v_result:=private.register_sale_atomic_impl(
      v_sale_id,
      v_item.product_id,
      v_item.qty,
      v_item.unit_price,
      p_payment,
      'Catálogo/WhatsApp',
      p_customer_type,
      p_purchase_profile,
      p_installments,
      p_first_due_date,
      p_card_brand,
      p_receiving_plan,
      p_rate_tier
    );
    v_sale_ids:=array_append(v_sale_ids,v_sale_id);
  end loop;

  update public.catalog_orders
     set status='Concluído',
         payment=p_payment,
         payment_details=jsonb_build_object(
           'installments',coalesce(p_installments,1),
           'first_due_date',p_first_due_date,
           'card_brand',p_card_brand,
           'receiving_plan',p_receiving_plan,
           'rate_tier',p_rate_tier,
           'customer_type',p_customer_type,
           'purchase_profile',p_purchase_profile
         ),
         sale_ids=v_sale_ids,
         completed_at=now(),
         updated_at=now()
   where id=p_order_id
   returning * into v_order;

  return jsonb_build_object('status','completed','order',to_jsonb(v_order),'sale_ids',to_jsonb(v_sale_ids));
end;
$function$;


CREATE OR REPLACE FUNCTION public.update_catalog_order_status(p_order_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_order public.catalog_orders%rowtype;
  v_minutes integer;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;

  perform private.expire_catalog_orders_impl();

  if p_status not in ('Novo','Em atendimento','Aguardando pagamento','Pago','Cancelado') then
    raise exception 'Status inválido.' using errcode='22023';
  end if;

  select * into v_order
    from public.catalog_orders
   where id=p_order_id
   for update;

  if not found then
    raise exception 'Pedido não encontrado.' using errcode='P0002';
  end if;

  if v_order.status='Concluído' then
    raise exception 'Pedido já concluído.' using errcode='P0001';
  end if;

  if p_status='Cancelado' then
    delete from public.catalog_orders where id=p_order_id;
    return jsonb_build_object(
      'status','deleted',
      'order_id',p_order_id,
      'order_number',v_order.order_number
    );
  end if;

  if v_order.status in ('Cancelado','Expirado') then
    raise exception 'Reserva encerrada. Peça ao cliente para selecionar novamente no catálogo.' using errcode='22023';
  end if;
  if v_order.order_type='donation' and p_status in ('Pago','Aguardando pagamento') then
    raise exception 'Doações não têm pagamento. Confirme a retirada quando entregar a peça.' using errcode='22023';
  end if;
  select reservation_minutes into v_minutes
    from public.catalog_config
   where id=1;

  update public.catalog_orders
     set status=p_status,
         reservation_expires_at=case
           when p_status in ('Novo','Em atendimento','Aguardando pagamento')
             then now()+make_interval(mins=>case when v_order.order_type='donation' then 1440 else coalesce(v_minutes,60) end)
           else reservation_expires_at
         end,
         updated_at=now()
   where id=p_order_id
   returning * into v_order;

  return to_jsonb(v_order);
end;
$function$;


CREATE OR REPLACE FUNCTION private.register_sale_atomic_impl(p_sale_id text, p_product_id text, p_qty integer, p_unit_price numeric, p_payment text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text, p_installments integer DEFAULT 1, p_first_due_date date DEFAULT NULL::date, p_card_brand text DEFAULT NULL::text, p_receiving_plan text DEFAULT 'one_day'::text, p_rate_tier text DEFAULT 'up_to_20'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_product public.products%rowtype;
  v_sale public.sales%rowtype;
  v_total numeric(12,2);
  v_list_unit_price numeric(12,2);
  v_list_total numeric(12,2);
  v_discount_percent numeric(5,2);
  v_discount_amount numeric(12,2);
  v_rate numeric;
  v_commission numeric(12,2);
  v_repasse numeric(12,2);
  v_cost_total numeric(12,2);
  v_result numeric(12,2);
  v_installments integer;
  v_base_installment numeric(12,2);
  v_amount numeric(12,2);
  v_fee_info jsonb;
  v_fee_rate numeric:=0;
  v_fee_amount numeric(12,2):=0;
  v_net numeric(12,2);
  v_brand_group text;
  i integer;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;

  if coalesce(trim(p_sale_id),'')='' then raise exception 'Identificador da venda inválido.' using errcode='22023'; end if;
  if p_qty is null or p_qty<1 then raise exception 'Quantidade inválida.' using errcode='22023'; end if;
  if p_unit_price is null or p_unit_price<=0 then raise exception 'Preço inválido.' using errcode='22023'; end if;
  if p_customer_type not in ('novo','recorrente','nao_informado') then raise exception 'Tipo de cliente inválido.' using errcode='22023'; end if;
  if p_purchase_profile not in ('uso_proprio','presente','revenda','outro','nao_informado') then raise exception 'Perfil da compra inválido.' using errcode='22023'; end if;

  v_installments:=greatest(1,least(coalesce(p_installments,1),24));
  if p_payment='Crédito parcelado' and (v_installments<2 or v_installments>12) then
    raise exception 'Crédito parcelado na InfinitePay deve estar entre 2x e 12x.' using errcode='22023';
  end if;
  if p_payment='Crediário VIP' and p_first_due_date is null then
    raise exception 'Informe a data da primeira parcela do Crediário VIP.' using errcode='22023';
  end if;
  if p_payment not in ('Crédito parcelado','Crediário VIP') then v_installments:=1; end if;

  select * into v_product
  from public.products
  where id=p_product_id and active=true
  for update;

  if not found then
    raise exception 'Produto não encontrado ou inativo.' using errcode='P0002';
  end if;

  select * into v_sale from public.sales where id=p_sale_id;
  if found then
    return jsonb_build_object('status','already_registered','sale',to_jsonb(v_sale),'product',to_jsonb(v_product));
  end if;

  if v_product.is_donation then raise exception 'Peça destinada à doação: confirme a retirada no pedido do catálogo.' using errcode='22023'; end if;

  if v_product.qty<p_qty then
    raise exception 'Estoque insuficiente. Disponível: % unidade(s).',v_product.qty using errcode='P0001';
  end if;

  v_list_unit_price:=round(v_product.price::numeric,2);
  v_list_total:=round((p_qty*v_list_unit_price)::numeric,2);
  v_total:=round((p_qty*p_unit_price)::numeric,2);
  v_discount_amount:=greatest(round((v_list_total-v_total)::numeric,2),0);
  v_discount_percent:=case
    when v_list_unit_price>0 and p_unit_price<v_list_unit_price
      then round(((1-(p_unit_price/v_list_unit_price))*100)::numeric,2)
    else 0
  end;

  if p_payment in ('Pix','Débito','Crédito à vista','Crédito parcelado') then
    v_brand_group:=case when p_card_brand='Elo/Amex' then 'elo_amex' else 'visa_master' end;
    v_fee_info:=private.infinitypay_rate_impl(
      p_payment,v_installments,p_receiving_plan,p_rate_tier,v_brand_group
    );
    v_fee_rate:=(v_fee_info->>'rate')::numeric;
    v_fee_amount:=round((v_total*v_fee_rate)::numeric,2);
  end if;
  v_net:=round((v_total-v_fee_amount)::numeric,2);

  if v_product.mode='consignado' then
    v_rate:=case
      when v_list_unit_price<=50 then 0.20
      when v_list_unit_price<=100 then 0.25
      when v_list_unit_price<=150 then 0.30
      else 0.35
    end;
    v_commission:=round((v_list_total*v_rate)::numeric,2);
    v_repasse:=round((v_list_total-v_commission)::numeric,2);
    v_cost_total:=0;
    -- Opção A: o consignante mantém o repasse calculado sobre o preço cheio.
    -- Todo desconto é absorvido pelo resultado da Tudo & Tal.
    v_result:=round((v_total-v_repasse-v_fee_amount)::numeric,2);
  else
    v_rate:=0;
    v_commission:=0;
    v_repasse:=0;
    v_cost_total:=round((p_qty*coalesce(v_product.cost,0))::numeric,2);
    v_result:=round((v_total-v_cost_total-v_fee_amount)::numeric,2);
  end if;

  update public.products
     set qty=qty-p_qty,updated_at=now()
   where id=v_product.id
   returning * into v_product;

  insert into public.sales(
    id,sale_date,product_id,sku,product_name,product_category,product_brand,qty,
    unit_price,list_unit_price,total,discount_percent,discount_amount,
    commission_rate,commission,repasse,mode,partner_id,owner_name,owner_phone,
    payment,payment_provider,card_brand,receiving_plan,rate_tier,processing_fee_rate,
    processing_fee_amount,net_amount,installments,first_due_date,channel,customer_type,purchase_profile,
    received_status,repasse_status,cost_total,result,created_at,updated_at
  ) values(
    p_sale_id,now(),v_product.id,v_product.sku,v_product.name,v_product.category,v_product.brand,p_qty,
    p_unit_price,v_list_unit_price,v_total,v_discount_percent,v_discount_amount,
    v_rate,v_commission,v_repasse,v_product.mode,v_product.partner_id,v_product.owner_name,v_product.owner_phone,
    p_payment,
    case when p_payment in ('Pix','Débito','Crédito à vista','Crédito parcelado') then 'InfinitePay' else null end,
    case when p_payment in ('Débito','Crédito à vista','Crédito parcelado') then p_card_brand else null end,
    case when p_payment in ('Pix','Débito','Crédito à vista','Crédito parcelado') then coalesce(p_receiving_plan,'one_day') else null end,
    case when p_payment in ('Pix','Débito','Crédito à vista','Crédito parcelado') then
      case when p_receiving_plan='instant' then 'all' else coalesce(p_rate_tier,'up_to_20') end
      else null end,
    v_fee_rate,v_fee_amount,v_net,v_installments,
    case when p_payment='Crediário VIP' then p_first_due_date else null end,
    p_channel,p_customer_type,p_purchase_profile,
    case when p_payment='Crediário VIP' then 'Pendente' else 'Recebido' end,
    case when v_product.mode='consignado' then 'Pendente' else 'Não aplicável' end,
    v_cost_total,v_result,now(),now()
  ) returning * into v_sale;

  if p_payment='Crediário VIP' then
    v_base_installment:=round(v_total/v_installments,2);
    for i in 1..v_installments loop
      v_amount:=case
        when i<v_installments then v_base_installment
        else v_total-(v_base_installment*(v_installments-1))
      end;
      insert into public.receivable_installments(
        sale_id,installment_number,installment_count,due_date,amount
      ) values(
        p_sale_id,i,v_installments,(p_first_due_date+make_interval(months=>i-1))::date,v_amount
      );
    end loop;
  end if;

  insert into public.inventory_movements(
    product_id,sku,movement_type,qty_delta,reference_type,reference_id,note
  ) values(
    v_product.id,v_product.sku,'venda',-p_qty,'sale',p_sale_id,'Venda registrada pelo PDV'
  );

  return jsonb_build_object('status','registered','sale',to_jsonb(v_sale),'product',to_jsonb(v_product));
end;
$function$;

-- Retirada idempotente: baixa física registrada como saída, sem venda/caixa/recebível.
create function private.complete_catalog_donation_impl(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare
 v_order public.catalog_orders%rowtype;
 v_item public.catalog_order_items%rowtype;
 v_product public.products%rowtype;
begin
 if (select auth.uid()) is null or not private.is_admin() then
   raise exception 'Acesso administrativo necessário.' using errcode='42501';
 end if;
 perform private.expire_catalog_orders_impl();
 select * into v_order from public.catalog_orders where id=p_order_id for update;
 if not found then raise exception 'Pedido não encontrado.' using errcode='P0002'; end if;
 if v_order.order_type<>'donation' then raise exception 'Este pedido não é uma doação.' using errcode='22023'; end if;
 if v_order.status='Concluído' then return jsonb_build_object('status','already_completed','order',to_jsonb(v_order)); end if;
 if v_order.status not in ('Novo','Em atendimento') or v_order.reservation_expires_at<=now() then
   raise exception 'Reserva encerrada. Selecione a peça novamente no catálogo.' using errcode='22023';
 end if;
 perform set_config('tdt.catalog_order_id',p_order_id::text,true);
 for v_item in select * from public.catalog_order_items where order_id=p_order_id order by product_id loop
   select * into v_product from public.products where id=v_item.product_id for update;
   if not found or not v_product.is_donation or not v_item.is_donation then
     raise exception 'Confira a peça destinada à doação.' using errcode='22023';
   end if;
   if v_product.qty<v_item.qty then raise exception 'Estoque insuficiente para a retirada.' using errcode='22023'; end if;
   update public.products set qty=qty-v_item.qty,updated_at=now() where id=v_item.product_id;
   insert into public.inventory_movements(product_id,sku,movement_type,qty_delta,reference_type,reference_id,note)
    values(v_item.product_id,v_item.sku,'saida',-v_item.qty,'catalog_donation',p_order_id::text,'Retirada gratuita de doação');
 end loop;
 update public.catalog_orders set status='Concluído',completed_at=now(),updated_at=now()
  where id=p_order_id returning * into v_order;
 perform set_config('tdt.catalog_order_id','',true);
 return jsonb_build_object('status','completed','order',to_jsonb(v_order));
end;
$$;
create function public.complete_catalog_donation(p_order_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog,public,private
as $$ select private.complete_catalog_donation_impl(p_order_id); $$;
revoke all on function private.complete_catalog_donation_impl(uuid),public.complete_catalog_donation(uuid) from public,anon;
grant execute on function private.complete_catalog_donation_impl(uuid),public.complete_catalog_donation(uuid) to authenticated,service_role;

