-- Lock order is day, account, product; all existing entry points participate.
CREATE OR REPLACE FUNCTION private.mark_receivable_paid_impl(p_receivable_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v_row public.receivable_installments%rowtype; v_account text;
begin
  perform private.finance_admin();
  perform private.finance_day_open();
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;
  select coalesce(cart_id,sale_id) into v_account from public.receivable_installments where id=p_receivable_id;
  if not found then raise exception 'Parcela não encontrada.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vip-receipt:'||v_account,0));
  select * into v_row from public.receivable_installments where id=p_receivable_id for update;
  if v_row.status='Pago' then return jsonb_build_object('status','already_paid','receivable',to_jsonb(v_row)); end if;
  return private.record_vip_payment_impl(p_receivable_id,v_row.amount-v_row.paid_amount,gen_random_uuid(),'Não informado');
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
  perform private.finance_admin();
  perform private.finance_day_open();
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

CREATE OR REPLACE FUNCTION private.register_sale_cart_atomic_impl(p_cart_id text, p_items jsonb, p_discount_percent numeric DEFAULT 0, p_payment text DEFAULT NULL::text, p_channel text DEFAULT 'Loja física'::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text, p_installments integer DEFAULT 1, p_first_due_date date DEFAULT NULL::date, p_card_brand text DEFAULT NULL::text, p_receiving_plan text DEFAULT 'one_day'::text, p_rate_tier text DEFAULT 'up_to_20'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_item record;
  v_product public.products%rowtype;
  v_sale_id text;
  v_result jsonb;
  v_sales jsonb:='[]'::jsonb;
  v_idx integer:=0;
  v_checkout numeric(5,2);
  v_promo numeric(5,2);
  v_effective numeric(5,2);
  v_unit numeric(12,2);
  v_original_total numeric(12,2):=0;
  v_final_total numeric(12,2):=0;
begin
  perform private.finance_admin();
  perform private.finance_day_open();
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;

  if coalesce(trim(p_cart_id),'')='' then
    raise exception 'Identificador da compra inválido.' using errcode='22023';
  end if;

  v_checkout:=coalesce(p_discount_percent,0);
  if v_checkout<0 or v_checkout>50 then
    raise exception 'O desconto da compra deve ficar entre 0%% e 50%%.' using errcode='22023';
  end if;

  if p_items is null or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then
    raise exception 'Carrinho inválido.' using errcode='22023';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(p_items) as x(product_id text,qty integer)
    where coalesce(x.product_id,'')='' or coalesce(x.qty,0)<1 or x.qty>100
  ) then
    raise exception 'Há item com quantidade inválida.' using errcode='22023';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(p_items) as x(product_id text,qty integer)
    group by x.product_id
    having count(*)>1
  ) then
    raise exception 'Há produto repetido no carrinho.' using errcode='22023';
  end if;

  for v_item in
    select x.product_id,x.qty
    from jsonb_to_recordset(p_items) as x(product_id text,qty integer)
    order by x.product_id
  loop
    v_idx:=v_idx+1;

    select * into v_product
      from public.products
     where id=v_item.product_id and active=true
     for update;

    if not found then
      raise exception 'Um produto do carrinho não está mais disponível.' using errcode='P0002';
    end if;

    v_promo:=greatest(0,least(coalesce(v_product.discount_percent,0),50));
    v_effective:=least(50,v_promo+v_checkout);
    v_unit:=round((v_product.price*(1-v_effective/100))::numeric,2);
    v_unit:=greatest(v_unit,0.01);

    v_sale_id:=p_cart_id||'-'||lpad(v_idx::text,2,'0');

    v_result:=private.register_sale_atomic_impl(
      v_sale_id,
      v_product.id,
      v_item.qty,
      v_unit,
      p_payment,
      p_channel,
      p_customer_type,
      p_purchase_profile,
      p_installments,
      p_first_due_date,
      p_card_brand,
      p_receiving_plan,
      p_rate_tier
    );

    update public.sales
       set cart_id=p_cart_id,
           promotion_discount_percent=v_promo,
           checkout_discount_percent=v_checkout,
           updated_at=now()
     where id=v_sale_id;

    select to_jsonb(s) into v_result
      from public.sales s
     where s.id=v_sale_id;

    v_sales:=v_sales||jsonb_build_array(v_result);
    v_original_total:=v_original_total+round((v_product.price*v_item.qty)::numeric,2);
    v_final_total:=v_final_total+round((v_unit*v_item.qty)::numeric,2);
  end loop;

  return jsonb_build_object(
    'status','registered',
    'cart_id',p_cart_id,
    'discount_percent',v_checkout,
    'original_total',round(v_original_total,2),
    'total',round(v_final_total,2),
    'discount_amount',round(v_original_total-v_final_total,2),
    'sales',v_sales
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.record_vip_payment_impl(p_receivable_id uuid, p_amount numeric, p_request_id uuid, p_payment_method text DEFAULT 'Pix'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_row public.receivable_installments%rowtype;
  v_existing public.receivable_payments%rowtype;
  v_account text;
begin
  perform private.finance_admin();
  perform private.finance_day_open();
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2)
    or p_amount::text in ('NaN','Infinity','-Infinity') or p_request_id is null then
    raise exception 'Informe um valor de recebimento válido, com até duas casas decimais.' using errcode='22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('Pix','Dinheiro','Transferência','Outro','Não informado') then
    raise exception 'Forma de recebimento inválida.' using errcode='22023';
  end if;
  select coalesce(cart_id,sale_id) into v_account from public.receivable_installments where id=p_receivable_id;
  if not found then raise exception 'Parcela não encontrada.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vip-receipt:'||v_account,0));
  select * into v_row from public.receivable_installments where id=p_receivable_id for update;
  select * into v_existing from public.receivable_payments where id=p_request_id;
  if found then
    if v_existing.receivable_id<>p_receivable_id or v_existing.amount<>p_amount or v_existing.payment_method<>p_payment_method then
      raise exception 'Este identificador já foi usado para outro recebimento.' using errcode='22023';
    end if;
    return jsonb_build_object('status','already_recorded','receivable',to_jsonb(v_row));
  end if;
  if p_amount>v_row.amount-v_row.paid_amount then
    raise exception 'O valor supera o saldo desta parcela: R$ %.',v_row.amount-v_row.paid_amount using errcode='22023';
  end if;
  insert into public.receivable_payments(id,receivable_id,amount,payment_method)
    values(p_request_id,p_receivable_id,p_amount,p_payment_method);
  update public.receivable_installments set paid_amount=paid_amount+p_amount,
    status=case when paid_amount+p_amount=amount then 'Pago' else 'Pendente' end,
    paid_at=case when paid_amount+p_amount=amount then now() else null end
    where id=p_receivable_id returning * into v_row;
  perform private.refresh_vip_received(v_row.sale_id,v_row.cart_id);
  return jsonb_build_object('status',case when v_row.status='Pago' then 'paid' else 'partial' end,
    'receivable',to_jsonb(v_row));
end;
$function$;

CREATE OR REPLACE FUNCTION private.register_vip_sale_cart_impl(p_cart_id text, p_items jsonb, p_plan jsonb, p_customer_name text, p_customer_phone text DEFAULT ''::text, p_discount_percent numeric DEFAULT 0, p_channel text DEFAULT 'Loja física'::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_down numeric; v_schedule jsonb; v_method text; v_name text; v_phone text;
  v_total numeric; v_sum numeric:=0; v_date date; v_amount numeric; v_count integer;
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
  v_entry jsonb; v_fingerprint jsonb; v_existing jsonb; v_result jsonb;
  v_sale_id text; v_receivable uuid; v_number integer:=0;
begin
  perform private.finance_admin();
  perform private.finance_day_open();
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;
  if coalesce(trim(p_cart_id),'')='' or length(p_cart_id)>150 then
    raise exception 'Identificador da compra inválido.' using errcode='22023';
  end if;
  v_name:=trim(coalesce(p_customer_name,''));
  v_phone:=regexp_replace(coalesce(p_customer_phone,''),'[^0-9]','','g');
  if length(v_name)<2 or length(v_name)>120 or (v_phone<>'' and length(v_phone) not between 10 and 15) then
    raise exception 'Informe o nome do cliente e um WhatsApp válido, se preenchido.' using errcode='22023';
  end if;
  if p_plan is null or jsonb_typeof(p_plan)<>'object' then
    raise exception 'Acordo de pagamento inválido.' using errcode='22023';
  end if;
  v_down:=coalesce((p_plan->>'down_payment')::numeric,0);
  v_method:=coalesce(p_plan->>'down_payment_method','Pix');
  v_schedule:=p_plan->'installments';
  if v_down<0 or v_down<>round(v_down,2) or v_down::text in ('NaN','Infinity','-Infinity')
    or v_method not in ('Pix','Dinheiro','Transferência','Outro')
    or v_schedule is null or jsonb_typeof(v_schedule)<>'array' then
    raise exception 'Confira a entrada e as parcelas do acordo.' using errcode='22023';
  end if;
  v_count:=jsonb_array_length(v_schedule);
  if v_count>24 or (v_count=0 and v_down=0) then
    raise exception 'Informe uma entrada ou até 24 parcelas.' using errcode='22023';
  end if;
  v_fingerprint:=jsonb_build_object('items',p_items,'plan',p_plan,'customer_name',v_name,'customer_phone',v_phone,
    'discount_percent',coalesce(p_discount_percent,0),'channel',p_channel,
    'customer_type',p_customer_type,'purchase_profile',p_purchase_profile);
  perform pg_advisory_xact_lock(hashtextextended('vip-sale:'||p_cart_id,0));
  select vip_plan into v_existing from public.sales where cart_id=p_cart_id order by id limit 1;
  if found then
    if v_existing is distinct from v_fingerprint then
      raise exception 'Esta compra já foi registrada com outro acordo. Sincronize antes de continuar.' using errcode='22023';
    end if;
    select jsonb_build_object('status','already_registered','cart_id',p_cart_id,'total',sum(total),
      'discount_amount',sum(discount_amount),'down_payment',v_down) into v_result
      from public.sales where cart_id=p_cart_id;
    return v_result;
  end if;
  for v_entry in select value from jsonb_array_elements(v_schedule) loop
    v_amount:=(v_entry->>'amount')::numeric;
    v_date:=(v_entry->>'due_date')::date;
    if v_amount is null or v_amount<=0 or v_amount<>round(v_amount,2)
      or v_amount::text in ('NaN','Infinity','-Infinity') or v_date is null or not isfinite(v_date) or v_date<v_today then
      raise exception 'Cada parcela precisa de valor positivo e vencimento a partir de hoje.' using errcode='22023';
    end if;
    v_sum:=v_sum+v_amount;
  end loop;
  -- The existing stock lock, prices, discounts and commission rules remain atomic.
  v_result:=private.register_sale_cart_atomic_impl(p_cart_id,p_items,p_discount_percent,'Crediário VIP',
    p_channel,p_customer_type,p_purchase_profile,1,v_today,null,'one_day','up_to_20');
  select sum(total),min(id) into v_total,v_sale_id from public.sales where cart_id=p_cart_id;
  if v_down+v_sum<>v_total then
    raise exception 'Entrada + parcelas devem somar R$ %. Confira o acordo e os preços atuais.',v_total using errcode='22023';
  end if;
  delete from public.receivable_installments where sale_id in (select id from public.sales where cart_id=p_cart_id);
  update public.sales set customer_name=v_name,customer_phone=nullif(v_phone,''),vip_plan=v_fingerprint,
    installments=greatest(v_count,1),first_due_date=(select min((x->>'due_date')::date) from jsonb_array_elements(v_schedule) x)
    where cart_id=p_cart_id;
  if v_down>0 then
    insert into public.receivable_installments(sale_id,cart_id,installment_number,installment_count,due_date,amount,is_down_payment)
      values(v_sale_id,p_cart_id,0,v_count,v_today,v_down,true) returning id into v_receivable;
    perform private.record_vip_payment_impl(v_receivable,v_down,gen_random_uuid(),v_method);
  end if;
  for v_entry in select value from jsonb_array_elements(v_schedule) loop
    v_number:=v_number+1;
    insert into public.receivable_installments(sale_id,cart_id,installment_number,installment_count,due_date,amount)
      values(v_sale_id,p_cart_id,v_number,v_count,(v_entry->>'due_date')::date,(v_entry->>'amount')::numeric);
  end loop;
  return v_result||jsonb_build_object('down_payment',v_down,'remaining',v_total-v_down);
end;
$function$;


