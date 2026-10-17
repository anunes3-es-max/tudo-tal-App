-- Revisão dos sete avisos de execução de SECURITY DEFINER no esquema exposto.
-- Nenhuma venda, produto, contato ou lançamento existente é modificado.

-- Apenas os campos que já são públicos no catálogo podem ser lidos por visitantes.
create policy catalog_config_public_read on public.catalog_config
  for select to anon, authenticated using (id=1);
grant select (id,store_name,whatsapp_number,reservation_minutes)
  on public.catalog_config to anon, authenticated;
alter function public.get_catalog_config() security invoker;

-- Estas operações já possuem verificação de administrador e RLS administrativo.
-- Executam com os privilégios do usuário, sem elevação desnecessária.
alter function public.update_catalog_config(text,integer) security invoker;
alter function public.update_catalog_order_status(uuid,text) security invoker;
revoke execute on function public.update_catalog_config(text,integer),
  public.update_catalog_order_status(uuid,text) from public, anon;
grant execute on function public.update_catalog_config(text,integer),
  public.update_catalog_order_status(uuid,text) to authenticated, service_role;

-- Projeção pública controlada: sem custo, consignante, contatos ou dados financeiros.
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
    -- Peças únicas saem da vitrine quando vendidas ou totalmente reservadas.
    -- O cadastro e o histórico administrativos permanecem intactos.
    and (
      not (
        p.catalog_section='vestuario' or p.is_donation
        or translate(lower(regexp_replace(btrim(coalesce(p.category,'')), '\s+', ' ', 'g')),
          'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')
          in ('vestuario & brecho','vestuario e brecho','moda adulto','moda infantil','bolsas','calcados')
      )
      or p.qty-private.active_reserved_qty(p.id,null)>0
    )
  order by (p.qty - private.active_reserved_qty(p.id,null) > 0) desc,
           p.updated_at desc, p.name;
end;
$function$;

-- A API antiga usa a mesma disponibilidade da API atual e continua excluindo doações.
-- A política de INSERT da lista de espera também consulta esta projeção.
create or replace function public.get_catalog_products()
returns table(id text,sku text,name text,category text,brand text,size text,color text,
  condition text,price numeric,original_price numeric,discount_percent numeric,
  photo_url text,available_qty integer)
language sql security invoker
set search_path = pg_catalog, public, private
as $function$
  select p.id,p.sku,p.name,p.category,p.brand,p.size,p.color,p.condition,p.price,
    p.original_price,p.discount_percent,p.photo_url,p.available_qty
  from private.get_catalog_products_v2_impl() p where not p.is_donation;
$function$;
revoke execute on function public.get_catalog_config(),public.get_catalog_products()
  from public;
grant execute on function public.get_catalog_config(),public.get_catalog_products()
  to anon,authenticated,service_role;

-- A confirmação precisa da transação privilegiada para estoque + venda + caixa.
-- A implementação fica no esquema privado, com os mesmos controles de administrador
-- e dia aberto. A API pública só encaminha parâmetros e não eleva privilégios.
CREATE OR REPLACE FUNCTION private.confirm_catalog_order_impl(p_order_id uuid, p_payment text, p_installments integer DEFAULT 1, p_first_due_date date DEFAULT NULL::date, p_card_brand text DEFAULT NULL::text, p_receiving_plan text DEFAULT 'one_day'::text, p_rate_tier text DEFAULT 'up_to_20'::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text)
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

CREATE OR REPLACE FUNCTION public.confirm_catalog_order(p_order_id uuid, p_payment text, p_installments integer DEFAULT 1, p_first_due_date date DEFAULT NULL::date, p_card_brand text DEFAULT NULL::text, p_receiving_plan text DEFAULT 'one_day'::text, p_rate_tier text DEFAULT 'up_to_20'::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text)
 RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.confirm_catalog_order_impl(
    p_order_id,p_payment,p_installments,p_first_due_date,p_card_brand,
    p_receiving_plan,p_rate_tier,p_customer_type,p_purchase_profile
  );
$function$;

revoke all on function private.confirm_catalog_order_impl(uuid,text,integer,date,text,text,text,text,text) from public,anon;
revoke all on function public.confirm_catalog_order(uuid,text,integer,date,text,text,text,text,text) from public,anon;
grant execute on function private.confirm_catalog_order_impl(uuid,text,integer,date,text,text,text,text,text),
  public.confirm_catalog_order(uuid,text,integer,date,text,text,text,text,text) to authenticated,service_role;
notify pgrst, 'reload schema';
