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
  perform private.finance_admin();
  perform private.finance_day_open();
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

