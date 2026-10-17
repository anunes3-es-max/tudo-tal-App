-- Donations expire after one hour. A status change cannot extend that deadline.
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
             then case when v_order.order_type='donation' then least(reservation_expires_at,created_at+interval '1 hour') else now()+make_interval(mins=>coalesce(v_minutes,60)) end
           else reservation_expires_at
         end,
         updated_at=now()
   where id=p_order_id
   returning * into v_order;

  return to_jsonb(v_order);
end;
$function$;

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
        'reservation_minutes',60,'order_type','donation');
    end if;
  end if;

  select reservation_minutes into v_minutes from public.catalog_config where id=1;
  v_minutes:=case when p_order_type='donation' then 60 else coalesce(v_minutes,60) end;
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


update public.catalog_orders set reservation_expires_at=least(reservation_expires_at,created_at+interval '1 hour') where order_type='donation' and status in ('Novo','Em atendimento');
select private.expire_catalog_orders_impl();

