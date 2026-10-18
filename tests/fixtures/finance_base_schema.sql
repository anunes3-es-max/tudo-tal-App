-- Test-only schema: empty tables and synthetic authentication, never deploy this fixture.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private;
create table auth.users(id uuid primary key,email text);
create table auth.sessions(id uuid primary key,user_id uuid);
create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
grant usage on schema public,private,auth to anon,authenticated;
set check_function_bodies=false;
create table public."app_members"(
"user_id" uuid not null,
"role" text default 'admin'::text not null,
"active" bool default true not null,
"created_at" timestamptz default now() not null
);
create table public."cash"(
"id" text not null,
"movement_date" timestamptz default now() not null,
"type" text not null,
"value" numeric not null,
"description" text not null,
"created_at" timestamptz default now() not null
);
create table public."catalog_config"(
"id" int2 default 1 not null,
"store_name" text default 'Tudo & Tal'::text not null,
"whatsapp_number" text default ''::text not null,
"reservation_minutes" int4 default 60 not null,
"updated_at" timestamptz default now() not null
);
create table public."catalog_order_items"(
"id" uuid default gen_random_uuid() not null,
"order_id" uuid not null,
"product_id" text not null,
"sku" text not null,
"product_name" text not null,
"product_category" text,
"product_brand" text,
"product_size" text,
"photo_url" text,
"unit_price" numeric not null,
"qty" int4 not null,
"total" numeric not null,
"created_at" timestamptz default now() not null,
"original_unit_price" numeric not null,
"discount_percent" numeric default 0 not null,
"discount_amount" numeric default 0 not null,
"is_donation" bool default false not null
);
create table public."catalog_orders"(
"id" uuid default gen_random_uuid() not null,
"order_number" text not null,
"customer_name" text not null,
"customer_phone" text not null,
"fulfillment" text default 'Combinar pelo WhatsApp'::text not null,
"notes" text,
"status" text default 'Novo'::text not null,
"subtotal" numeric default 0 not null,
"reservation_expires_at" timestamptz not null,
"payment" text,
"payment_details" jsonb default '{}'::jsonb not null,
"sale_ids" text[] default '{}'::text[] not null,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null,
"completed_at" timestamptz,
"cancelled_at" timestamptz,
"order_type" text default 'sale'::text not null
);
create table public."catalog_waitlist"(
"id" uuid default gen_random_uuid() not null,
"product_id" text not null,
"customer_name" text not null,
"customer_phone" text not null,
"status" text default 'Aguardando reposição'::text not null,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null,
"notified_at" timestamptz
);
create table public."infinitypay_rates"(
"receiving_plan" text not null,
"rate_tier" text not null,
"brand_group" text not null,
"payment_kind" text not null,
"installments" int4 default 1 not null,
"fee_rate" numeric not null,
"checked_at" date not null
);
create table public."inventory_movements"(
"id" uuid default gen_random_uuid() not null,
"product_id" text,
"sku" text not null,
"movement_type" text not null,
"qty_delta" int4 not null,
"reference_type" text,
"reference_id" text,
"note" text,
"created_at" timestamptz default now() not null
);
create table public."partners"(
"id" uuid default gen_random_uuid() not null,
"name" text not null,
"phone" text,
"partner_type" text default 'consignante'::text not null,
"notes" text,
"active" bool default true not null,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null
);
create table public."products"(
"id" text not null,
"sku" text not null,
"name" text not null,
"category" text not null,
"brand" text,
"size" text,
"color" text,
"condition" text,
"mode" text not null,
"partner_id" uuid,
"owner_name" text not null,
"owner_phone" text,
"price" numeric not null,
"qty" int4 default 0 not null,
"cost" numeric default 0 not null,
"stock_type" text,
"photo_url" text,
"active" bool default true not null,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null,
"discount_percent" numeric default 0 not null,
"catalog_section" text default 'loja'::text not null,
"age_group" text,
"gender" text,
"is_donation" bool default false not null
);
create table public."receivable_installments"(
"id" uuid default gen_random_uuid() not null,
"sale_id" text not null,
"installment_number" int4 not null,
"installment_count" int4 not null,
"due_date" date not null,
"amount" numeric not null,
"status" text default 'Pendente'::text not null,
"paid_at" timestamptz,
"created_at" timestamptz default now() not null,
"cart_id" text,
"is_down_payment" bool default false not null,
"paid_amount" numeric default 0 not null
);
create table public."receivable_payments"(
"id" uuid not null,
"receivable_id" uuid not null,
"amount" numeric not null,
"payment_method" text not null,
"received_at" timestamptz default now() not null,
"created_by" uuid default auth.uid()
);
create table public."sales"(
"id" text not null,
"sale_date" timestamptz default now() not null,
"product_id" text,
"sku" text not null,
"product_name" text not null,
"qty" int4 not null,
"unit_price" numeric not null,
"total" numeric not null,
"commission_rate" numeric default 0 not null,
"commission" numeric default 0 not null,
"repasse" numeric default 0 not null,
"mode" text not null,
"partner_id" uuid,
"owner_name" text not null,
"owner_phone" text,
"payment" text,
"channel" text,
"received_status" text default 'Recebido'::text not null,
"repasse_status" text default 'Não aplicável'::text not null,
"repasse_paid_at" timestamptz,
"cost_total" numeric default 0 not null,
"result" numeric default 0 not null,
"created_at" timestamptz default now() not null,
"updated_at" timestamptz default now() not null,
"product_category" text,
"product_brand" text,
"customer_type" text default 'nao_informado'::text not null,
"purchase_profile" text default 'nao_informado'::text not null,
"installments" int4 default 1 not null,
"first_due_date" date,
"payment_provider" text,
"card_brand" text,
"receiving_plan" text,
"rate_tier" text,
"processing_fee_rate" numeric default 0 not null,
"processing_fee_amount" numeric default 0 not null,
"net_amount" numeric,
"list_unit_price" numeric not null,
"discount_percent" numeric default 0 not null,
"discount_amount" numeric default 0 not null,
"promotion_discount_percent" numeric default 0 not null,
"checkout_discount_percent" numeric default 0 not null,
"cart_id" text,
"customer_name" text,
"customer_phone" text,
"vip_plan" jsonb,
"received_amount" numeric default 0 not null
);
create table public."settings"(
"key" text not null,
"value" jsonb default '{}'::jsonb not null,
"updated_at" timestamptz default now() not null
);
alter table public."sales" add constraint "sales_total_check" CHECK ((total >= (0)::numeric));
alter table public."sales" add constraint "sales_commission_rate_check" CHECK (((commission_rate >= (0)::numeric) AND (commission_rate <= (1)::numeric)));
alter table public."sales" add constraint "sales_commission_check" CHECK ((commission >= (0)::numeric));
alter table public."partners" add constraint "partners_partner_type_check" CHECK ((partner_type = ANY (ARRAY['consignante'::text, 'fornecedor'::text, 'proprio'::text, 'outro'::text])));
alter table public."partners" add constraint "partners_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_mode_check" CHECK ((mode = ANY (ARRAY['consignado'::text, 'proprio'::text])));
alter table public."products" add constraint "products_qty_check" CHECK ((qty >= 0));
alter table public."products" add constraint "products_cost_check" CHECK ((cost >= (0)::numeric));
alter table public."products" add constraint "products_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_sku_key" UNIQUE (sku);
alter table public."sales" add constraint "sales_qty_check" CHECK ((qty > 0));
alter table public."sales" add constraint "sales_unit_price_check" CHECK ((unit_price > (0)::numeric));
alter table public."sales" add constraint "sales_repasse_check" CHECK ((repasse >= (0)::numeric));
alter table public."sales" add constraint "sales_mode_check" CHECK ((mode = ANY (ARRAY['consignado'::text, 'proprio'::text])));
alter table public."sales" add constraint "sales_cost_total_check" CHECK ((cost_total >= (0)::numeric));
alter table public."sales" add constraint "sales_pkey" PRIMARY KEY (id);
alter table public."cash" add constraint "cash_type_check" CHECK ((type = ANY (ARRAY['entrada'::text, 'saida'::text])));
alter table public."cash" add constraint "cash_value_check" CHECK ((value > (0)::numeric));
alter table public."cash" add constraint "cash_pkey" PRIMARY KEY (id);
alter table public."settings" add constraint "settings_pkey" PRIMARY KEY (key);
alter table public."inventory_movements" add constraint "inventory_movements_movement_type_check" CHECK ((movement_type = ANY (ARRAY['entrada'::text, 'saida'::text, 'venda'::text, 'devolucao'::text, 'ajuste'::text])));
alter table public."inventory_movements" add constraint "inventory_movements_qty_delta_check" CHECK ((qty_delta <> 0));
alter table public."inventory_movements" add constraint "inventory_movements_pkey" PRIMARY KEY (id);
alter table public."app_members" add constraint "app_members_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'staff'::text])));
alter table public."app_members" add constraint "app_members_pkey" PRIMARY KEY (user_id);
alter table public."sales" add constraint "sales_customer_type_check" CHECK ((customer_type = ANY (ARRAY['novo'::text, 'recorrente'::text, 'nao_informado'::text])));
alter table public."sales" add constraint "sales_purchase_profile_check" CHECK ((purchase_profile = ANY (ARRAY['uso_proprio'::text, 'presente'::text, 'revenda'::text, 'outro'::text, 'nao_informado'::text])));
alter table public."sales" add constraint "sales_installments_check" CHECK (((installments >= 1) AND (installments <= 24)));
alter table public."receivable_installments" add constraint "receivable_installments_amount_check" CHECK ((amount > (0)::numeric));
alter table public."receivable_installments" add constraint "receivable_installments_status_check" CHECK ((status = ANY (ARRAY['Pendente'::text, 'Pago'::text])));
alter table public."receivable_installments" add constraint "receivable_installments_pkey" PRIMARY KEY (id);
alter table public."receivable_installments" add constraint "receivable_installments_sale_id_installment_number_key" UNIQUE (sale_id, installment_number);
alter table public."sales" add constraint "sales_processing_fee_rate_check" CHECK (((processing_fee_rate >= (0)::numeric) AND (processing_fee_rate <= (1)::numeric)));
alter table public."sales" add constraint "sales_processing_fee_amount_check" CHECK ((processing_fee_amount >= (0)::numeric));
alter table public."infinitypay_rates" add constraint "infinitypay_rates_fee_rate_check" CHECK (((fee_rate >= (0)::numeric) AND (fee_rate <= (1)::numeric)));
alter table public."infinitypay_rates" add constraint "infinitypay_rates_pkey" PRIMARY KEY (receiving_plan, rate_tier, brand_group, payment_kind, installments);
alter table public."catalog_config" add constraint "catalog_config_id_check" CHECK ((id = 1));
alter table public."catalog_config" add constraint "catalog_config_reservation_minutes_check" CHECK (((reservation_minutes >= 15) AND (reservation_minutes <= 240)));
alter table public."catalog_config" add constraint "catalog_config_pkey" PRIMARY KEY (id);
alter table public."catalog_orders" add constraint "catalog_orders_fulfillment_check" CHECK ((fulfillment = ANY (ARRAY['Retirada na loja'::text, 'Combinar entrega pelo WhatsApp'::text, 'Combinar pelo WhatsApp'::text])));
alter table public."products" add constraint "products_discount_percent_range" CHECK (((discount_percent >= (0)::numeric) AND (discount_percent <= (50)::numeric)));
alter table public."catalog_orders" add constraint "catalog_orders_status_check" CHECK ((status = ANY (ARRAY['Novo'::text, 'Em atendimento'::text, 'Aguardando pagamento'::text, 'Pago'::text, 'Concluído'::text, 'Cancelado'::text, 'Expirado'::text])));
alter table public."catalog_orders" add constraint "catalog_orders_subtotal_check" CHECK ((subtotal >= (0)::numeric));
alter table public."catalog_orders" add constraint "catalog_orders_pkey" PRIMARY KEY (id);
alter table public."catalog_orders" add constraint "catalog_orders_order_number_key" UNIQUE (order_number);
alter table public."catalog_order_items" add constraint "catalog_order_items_qty_check" CHECK ((qty > 0));
alter table public."catalog_order_items" add constraint "catalog_order_items_total_check" CHECK ((total >= (0)::numeric));
alter table public."catalog_order_items" add constraint "catalog_order_items_pkey" PRIMARY KEY (id);
alter table public."catalog_order_items" add constraint "catalog_order_items_order_id_product_id_key" UNIQUE (order_id, product_id);
alter table public."sales" add constraint "sales_discount_percent_range" CHECK (((discount_percent >= (0)::numeric) AND (discount_percent <= (100)::numeric)));
alter table public."sales" add constraint "sales_discount_amount_nonnegative" CHECK ((discount_amount >= (0)::numeric));
alter table public."sales" add constraint "sales_promotion_discount_range" CHECK (((promotion_discount_percent >= (0)::numeric) AND (promotion_discount_percent <= (50)::numeric)));
alter table public."sales" add constraint "sales_checkout_discount_range" CHECK (((checkout_discount_percent >= (0)::numeric) AND (checkout_discount_percent <= (50)::numeric)));
alter table public."catalog_waitlist" add constraint "catalog_waitlist_customer_name_check" CHECK ((((length(customer_name) >= 2) AND (length(customer_name) <= 80)) AND (customer_name = btrim(customer_name)) AND (customer_name !~ '[[:cntrl:]]'::text)));
alter table public."catalog_waitlist" add constraint "catalog_waitlist_customer_phone_check" CHECK ((customer_phone ~ '^55[1-9][0-9]([2-9][0-9]{7}|9[0-9]{8})$'::text));
alter table public."catalog_waitlist" add constraint "catalog_waitlist_status_check" CHECK ((status = ANY (ARRAY['Aguardando reposição'::text, 'Avisado'::text, 'Atendido'::text])));
alter table public."catalog_waitlist" add constraint "catalog_waitlist_pkey" PRIMARY KEY (id);
alter table public."sales" add constraint "sales_check" CHECK (((received_amount >= (0)::numeric) AND (received_amount <= total)));
alter table public."receivable_installments" add constraint "receivable_installments_check" CHECK (((paid_amount >= (0)::numeric) AND (paid_amount <= amount)));
alter table public."receivable_payments" add constraint "receivable_payments_amount_check" CHECK ((amount > (0)::numeric));
alter table public."receivable_payments" add constraint "receivable_payments_payment_method_check" CHECK ((payment_method = ANY (ARRAY['Pix'::text, 'Dinheiro'::text, 'Transferência'::text, 'Outro'::text, 'Não informado'::text])));
alter table public."receivable_payments" add constraint "receivable_payments_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_catalog_section_check" CHECK ((catalog_section = ANY (ARRAY['loja'::text, 'vestuario'::text])));
alter table public."products" add constraint "products_age_group_check" CHECK ((age_group = ANY (ARRAY['adulto'::text, 'infantil'::text])));
alter table public."products" add constraint "products_gender_check" CHECK ((gender = ANY (ARRAY['feminino'::text, 'masculino'::text, 'unissex'::text])));
alter table public."products" add constraint "products_offer_price_check" CHECK ((((NOT is_donation) AND (price > (0)::numeric)) OR (is_donation AND (price = (0)::numeric) AND (discount_percent = (0)::numeric) AND (catalog_section = 'vestuario'::text) AND (mode = 'proprio'::text))));
alter table public."catalog_orders" add constraint "catalog_orders_order_type_check" CHECK ((order_type = ANY (ARRAY['sale'::text, 'donation'::text])));
alter table public."catalog_orders" add constraint "catalog_donation_terms_check" CHECK (((order_type <> 'donation'::text) OR ((subtotal = (0)::numeric) AND (fulfillment = 'Retirada na loja'::text) AND (status <> ALL (ARRAY['Pago'::text, 'Aguardando pagamento'::text])) AND (payment IS NULL))));
alter table public."catalog_order_items" add constraint "catalog_order_items_offer_price_check" CHECK ((((NOT is_donation) AND (unit_price > (0)::numeric)) OR (is_donation AND (unit_price = (0)::numeric) AND (original_unit_price = (0)::numeric) AND (total = (0)::numeric) AND (discount_percent = (0)::numeric) AND (discount_amount = (0)::numeric))));
alter table public."products" add constraint "products_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL;
alter table public."sales" add constraint "sales_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public."sales" add constraint "sales_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL;
alter table public."inventory_movements" add constraint "inventory_movements_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public."app_members" add constraint "app_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."receivable_installments" add constraint "receivable_installments_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
alter table public."catalog_order_items" add constraint "catalog_order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES catalog_orders(id) ON DELETE CASCADE;
alter table public."catalog_order_items" add constraint "catalog_order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
alter table public."catalog_waitlist" add constraint "catalog_waitlist_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."receivable_payments" add constraint "receivable_payments_receivable_id_fkey" FOREIGN KEY (receivable_id) REFERENCES receivable_installments(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION private.infinitypay_rate_impl(p_payment text, p_installments integer, p_receiving_plan text, p_rate_tier text, p_brand_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_kind text;
  v_plan text;
  v_tier text;
  v_brand text;
  v_inst integer;
  v_rate numeric;
  v_checked date;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;

  if p_payment in ('Dinheiro','Crediário VIP') then
    return jsonb_build_object('rate',0,'checked_at','2026-10-08','provider',null);
  end if;

  if p_payment='Pix' then v_kind:='pix'; v_inst:=1;
  elsif p_payment='Débito' then v_kind:='debit'; v_inst:=1;
  elsif p_payment in ('Crédito à vista','Crédito parcelado') then
    v_kind:='credit';
    v_inst:=case when p_payment='Crédito à vista' then 1 else greatest(2,least(coalesce(p_installments,2),12)) end;
  else
    return jsonb_build_object('rate',0,'checked_at','2026-10-08','provider',null);
  end if;

  v_plan:=case when p_receiving_plan='instant' then 'instant' else 'one_day' end;
  if v_plan='instant' then
    v_tier:='all'; v_brand:='all';
  else
    v_tier:=case when p_rate_tier in ('up_to_20','above_20','above_40','above_80') then p_rate_tier else 'up_to_20' end;
    v_brand:=case when p_brand_group='elo_amex' then 'elo_amex' else 'visa_master' end;
  end if;

  select fee_rate,checked_at into v_rate,v_checked
  from public.infinitypay_rates
  where receiving_plan=v_plan
    and rate_tier=v_tier
    and brand_group=v_brand
    and payment_kind=v_kind
    and installments=v_inst;

  if v_rate is null then
    raise exception 'Taxa InfinitePay não encontrada para esta combinação.' using errcode='P0002';
  end if;

  return jsonb_build_object(
    'rate',v_rate,
    'checked_at',v_checked,
    'provider','InfinitePay',
    'receiving_plan',v_plan,
    'rate_tier',v_tier,
    'brand_group',v_brand,
    'installments',v_inst
  );
end;
$function$;
CREATE OR REPLACE FUNCTION private.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (
    select 1
    from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active = true
      and m.role = 'admin'
  );
$function$;
CREATE OR REPLACE FUNCTION private.mark_receivable_paid_impl(p_receivable_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v_row public.receivable_installments%rowtype; v_account text;
begin
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
CREATE OR REPLACE FUNCTION public.mark_receivable_paid(p_receivable_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.mark_receivable_paid_impl(p_receivable_id);
$function$;
CREATE OR REPLACE FUNCTION public.get_infinitypay_rate(p_payment text, p_installments integer DEFAULT 1, p_receiving_plan text DEFAULT 'one_day'::text, p_rate_tier text DEFAULT 'up_to_20'::text, p_brand_group text DEFAULT 'visa_master'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.infinitypay_rate_impl(
    p_payment,p_installments,p_receiving_plan,p_rate_tier,p_brand_group
  );
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
CREATE OR REPLACE FUNCTION public.register_sale_atomic(p_sale_id text, p_product_id text, p_qty integer, p_unit_price numeric, p_payment text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text, p_installments integer DEFAULT 1, p_first_due_date date DEFAULT NULL::date, p_card_brand text DEFAULT NULL::text, p_receiving_plan text DEFAULT 'one_day'::text, p_rate_tier text DEFAULT 'up_to_20'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.register_sale_atomic_impl(
    p_sale_id,p_product_id,p_qty,p_unit_price,p_payment,p_channel,p_customer_type,p_purchase_profile,
    p_installments,p_first_due_date,p_card_brand,p_receiving_plan,p_rate_tier
  );
$function$;
CREATE OR REPLACE FUNCTION public.register_sale_cart_atomic(p_cart_id text, p_items jsonb, p_discount_percent numeric DEFAULT 0, p_payment text DEFAULT NULL::text, p_channel text DEFAULT 'Loja física'::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text, p_installments integer DEFAULT 1, p_first_due_date date DEFAULT NULL::date, p_card_brand text DEFAULT NULL::text, p_receiving_plan text DEFAULT 'one_day'::text, p_rate_tier text DEFAULT 'up_to_20'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.register_sale_cart_atomic_impl(
    p_cart_id,p_items,p_discount_percent,p_payment,p_channel,p_customer_type,p_purchase_profile,
    p_installments,p_first_due_date,p_card_brand,p_receiving_plan,p_rate_tier
  );
$function$;
CREATE OR REPLACE FUNCTION private.active_reserved_qty(p_product_id text, p_exclude_order_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select coalesce(sum(i.qty),0)::integer
    from public.catalog_order_items i
    join public.catalog_orders o on o.id=i.order_id
   where i.product_id=p_product_id
     and (p_exclude_order_id is null or o.id<>p_exclude_order_id)
     and (
       (o.status in ('Novo','Em atendimento','Aguardando pagamento') and o.reservation_expires_at>now())
       or o.status='Pago'
     );
$function$;
CREATE OR REPLACE FUNCTION public.create_catalog_order(p_customer_name text, p_customer_phone text, p_fulfillment text, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$ select private.create_catalog_order_v2_impl(p_customer_name,p_customer_phone,p_fulfillment,p_notes,p_items,'sale'); $function$;
CREATE OR REPLACE FUNCTION public.get_catalog_config()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'store_name',store_name,
    'whatsapp_number',whatsapp_number,
    'reservation_minutes',reservation_minutes
  )
  from public.catalog_config where id=1;
$function$;
CREATE OR REPLACE FUNCTION public.save_product(p_product jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.save_product_impl(p_product);
$function$;
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
CREATE OR REPLACE FUNCTION public.restore_sale_backup(p_sale jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_sale public.sales%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;

  if p_sale is null or jsonb_typeof(p_sale) <> 'object' then
    raise exception 'Venda de backup inválida.' using errcode='22023';
  end if;

  select *
    into v_sale
    from jsonb_populate_record(null::public.sales,p_sale);

  if coalesce(trim(v_sale.id),'')='' then
    raise exception 'Venda de backup sem identificador.' using errcode='22023';
  end if;

  delete from public.sales where id=v_sale.id;
  insert into public.sales select v_sale.*;

  return to_jsonb(v_sale);
end;
$function$;
CREATE OR REPLACE FUNCTION public.update_catalog_config(p_whatsapp_number text, p_reservation_minutes integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v_digits text; v_minutes integer;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;
  v_digits:=regexp_replace(coalesce(p_whatsapp_number,''),'[^0-9]','','g');
  if v_digits<>'' then
    if length(v_digits) in (10,11) then v_digits:='55'||v_digits; end if;
    if length(v_digits)<12 or length(v_digits)>13 then
      raise exception 'WhatsApp inválido. Informe DDD + número.' using errcode='22023';
    end if;
  end if;
  v_minutes:=greatest(15,least(coalesce(p_reservation_minutes,60),240));
  update public.catalog_config
     set whatsapp_number=v_digits,reservation_minutes=v_minutes,updated_at=now()
   where id=1;
  return public.get_catalog_config();
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
CREATE OR REPLACE FUNCTION private.protect_product_qty_from_direct_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  -- Alterações normais vindas diretamente do navegador não podem mexer no saldo.
  -- Funções SECURITY DEFINER da loja executam como postgres e continuam podendo
  -- registrar venda/ajuste de quantidade de forma controlada.
  if old.qty is distinct from new.qty
     and current_user not in ('postgres','service_role') then
    new.qty := old.qty;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.save_cash(p_cash jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.save_cash_impl(p_cash);
$function$;
CREATE OR REPLACE FUNCTION private.save_cash_impl(p_cash jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_id text := nullif(trim(p_cash->>'id'),'');
  v_type text := nullif(trim(p_cash->>'type'),'');
  v_value numeric := coalesce((p_cash->>'value')::numeric,0);
  v_description text := nullif(trim(p_cash->>'description'),'');
  v_date timestamptz := coalesce((p_cash->>'movement_date')::timestamptz,now());
  v_row public.cash%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;
  if v_id is null or v_type not in ('entrada','saida') or v_value <= 0 or v_description is null then
    raise exception 'Movimento de caixa inválido.' using errcode='22023';
  end if;

  insert into public.cash(id,movement_date,type,value,description,created_at)
  values(v_id,v_date,v_type,v_value,v_description,coalesce((p_cash->>'created_at')::timestamptz,v_date))
  on conflict(id) do update set
    movement_date=excluded.movement_date,
    type=excluded.type,
    value=excluded.value,
    description=excluded.description
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;
CREATE OR REPLACE FUNCTION public.create_catalog_interest(p_product_id text, p_customer_name text, p_customer_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_name text := btrim(coalesce(p_customer_name,''));
  v_phone text := regexp_replace(coalesce(p_customer_phone,''),'[^0-9]','','g');
begin
  if length(v_name) < 2 or length(v_name) > 80 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Informe seu nome, com 2 a 80 caracteres.' using errcode = '22023';
  end if;
  if length(v_phone) in (10,11) then v_phone := '55' || v_phone; end if;
  if v_phone !~ '^55[1-9][0-9]([2-9][0-9]{7}|9[0-9]{8})$' then
    raise exception 'Informe um WhatsApp válido com DDD.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.get_catalog_products() p
    where p.id = p_product_id and p.available_qty = 0
  ) then
    raise exception 'Este produto não está esgotado. Atualize o catálogo para conferir a disponibilidade.'
      using errcode = '22023';
  end if;
  insert into public.catalog_waitlist (product_id,customer_name,customer_phone)
  values (p_product_id,v_name,v_phone)
  on conflict do nothing;
  -- Resposta idêntica para inscrição nova ou repetida: não revela nenhum contato.
  return jsonb_build_object('status','received');
end;
$function$;
CREATE OR REPLACE FUNCTION public.update_catalog_interest_status(p_interest_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('Aguardando reposição','Avisado','Atendido') then
    raise exception 'Status inválido.' using errcode = '22023';
  end if;
  update public.catalog_waitlist
  set status = p_status,
      updated_at = now(),
      notified_at = case when p_status = 'Avisado' then coalesce(notified_at,now())
                         when p_status = 'Aguardando reposição' then null else notified_at end
  where id = p_interest_id returning id into v_id;
  if not found then
    raise exception 'Interesse não encontrado.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id',v_id,'status',p_status);
end;
$function$;
CREATE OR REPLACE FUNCTION private.refresh_vip_received(p_sale_id text, p_cart_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_paid numeric; v_total numeric; v_running numeric:=0; v_allocated numeric:=0;
  v_next numeric; v_sale record;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode='42501';
  end if;
  if p_cart_id is null then
    select coalesce(sum(paid_amount),0) into v_paid
      from public.receivable_installments where sale_id=p_sale_id;
    update public.sales set received_amount=v_paid,
      received_status=case when v_paid>=total then 'Recebido' when v_paid>0 then 'Parcial' else 'Pendente' end
      where id=p_sale_id and payment='Crediário VIP';
  else
    select coalesce(sum(paid_amount),0) into v_paid
      from public.receivable_installments where cart_id=p_cart_id;
    select sum(total) into v_total from public.sales where cart_id=p_cart_id;
    for v_sale in select id,total from public.sales where cart_id=p_cart_id order by id loop
      v_running:=v_running+v_sale.total;
      v_next:=round(v_paid*v_running/v_total,2);
      update public.sales set received_amount=v_next-v_allocated,
        received_status=case when v_next-v_allocated>=total then 'Recebido'
          when v_next-v_allocated>0 then 'Parcial' else 'Pendente' end
        where id=v_sale.id;
      v_allocated:=v_next;
    end loop;
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_catalog_products_v2()
 RETURNS TABLE(id text, sku text, name text, category text, brand text, size text, color text, condition text, price numeric, original_price numeric, discount_percent numeric, photo_url text, available_qty integer, catalog_section text, age_group text, gender text, is_donation boolean)
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$ select * from private.get_catalog_products_v2_impl(); $function$;
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
CREATE OR REPLACE FUNCTION public.create_catalog_donation(p_customer_name text, p_customer_phone text, p_product_id text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$ select private.create_catalog_order_v2_impl(p_customer_name,p_customer_phone,'Retirada na loja',p_notes,
 jsonb_build_array(jsonb_build_object('product_id',p_product_id,'qty',1)),'donation'); $function$;
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
CREATE OR REPLACE FUNCTION public.record_vip_payment(p_receivable_id uuid, p_amount numeric, p_request_id uuid, p_payment_method text DEFAULT 'Pix'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.record_vip_payment_impl(p_receivable_id,p_amount,p_request_id,p_payment_method);
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
CREATE OR REPLACE FUNCTION public.register_vip_sale_cart(p_cart_id text, p_items jsonb, p_plan jsonb, p_customer_name text, p_customer_phone text DEFAULT ''::text, p_discount_percent numeric DEFAULT 0, p_channel text DEFAULT 'Loja física'::text, p_customer_type text DEFAULT 'nao_informado'::text, p_purchase_profile text DEFAULT 'nao_informado'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.register_vip_sale_cart_impl(p_cart_id,p_items,p_plan,p_customer_name,p_customer_phone,
    p_discount_percent,p_channel,p_customer_type,p_purchase_profile);
$function$;
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
CREATE OR REPLACE FUNCTION private.complete_catalog_donation_impl(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.complete_catalog_donation(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$ select private.complete_catalog_donation_impl(p_order_id); $function$;
CREATE OR REPLACE FUNCTION private.enforce_catalog_reservations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_exclude uuid;
  v_reserved integer;
begin
  if new.qty < old.qty then
    begin
      v_exclude := nullif(current_setting('tdt.catalog_order_id',true),'')::uuid;
    exception when others then
      v_exclude := null;
    end;
    v_reserved := private.active_reserved_qty(old.id,v_exclude);
    if new.qty < v_reserved then
      raise exception 'Estoque reservado pelo catálogo. Disponível fora das reservas: % unidade(s).',
        greatest(old.qty-v_reserved,0) using errcode='P0001';
    end if;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION private.expire_catalog_orders_impl()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v_count integer;
begin
  update public.catalog_orders
     set status='Expirado',updated_at=now()
   where status in ('Novo','Em atendimento','Aguardando pagamento')
     and reservation_expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
set check_function_bodies=true;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema private to authenticated;
alter table public."app_members" enable row level security;
create policy "members can read own membership" on public."app_members" for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id));
alter table public."partners" enable row level security;
create policy "admin full access partners" on public."partners" for ALL to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."products" enable row level security;
create policy "admin full access products" on public."products" for ALL to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."sales" enable row level security;
create policy "admin full access sales" on public."sales" for ALL to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."cash" enable row level security;
create policy "admin full access cash" on public."cash" for ALL to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."settings" enable row level security;
create policy "admin full access settings" on public."settings" for ALL to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."inventory_movements" enable row level security;
create policy "admin full access inventory movements" on public."inventory_movements" for ALL to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."receivable_installments" enable row level security;
create policy "admin_all_receivable_installments" on public."receivable_installments" for ALL to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."infinitypay_rates" enable row level security;
create policy "admin_all_infinitypay_rates" on public."infinitypay_rates" for ALL to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."catalog_config" enable row level security;
create policy "catalog_config_admin_all" on public."catalog_config" for ALL to authenticated using (private.is_admin()) with check (private.is_admin());
alter table public."catalog_orders" enable row level security;
create policy "catalog_orders_admin_all" on public."catalog_orders" for ALL to authenticated using (private.is_admin()) with check (private.is_admin());
alter table public."catalog_order_items" enable row level security;
create policy "catalog_order_items_admin_all" on public."catalog_order_items" for ALL to authenticated using (private.is_admin()) with check (private.is_admin());
alter table public."catalog_waitlist" enable row level security;
create policy "catalog_waitlist_admin_read" on public."catalog_waitlist" for SELECT to authenticated using (( SELECT private.is_admin() AS is_admin));
alter table public."catalog_waitlist" enable row level security;
create policy "catalog_waitlist_admin_update" on public."catalog_waitlist" for UPDATE to authenticated using (( SELECT private.is_admin() AS is_admin)) with check (( SELECT private.is_admin() AS is_admin));
alter table public."catalog_waitlist" enable row level security;
create policy "catalog_waitlist_public_insert" on public."catalog_waitlist" for INSERT to anon,authenticated with check (((status = 'Aguardando reposição'::text) AND (notified_at IS NULL) AND (EXISTS ( SELECT 1
   FROM get_catalog_products() p(id, sku, name, category, brand, size, color, condition, price, original_price, discount_percent, photo_url, available_qty)
  WHERE ((p.id = catalog_waitlist.product_id) AND (p.available_qty = 0))))));
alter table public."receivable_payments" enable row level security;
create policy "admin_read_receivable_payments" on public."receivable_payments" for SELECT to authenticated using (( SELECT private.is_admin() AS is_admin));
create trigger "partners_set_updated_at" before update on public."partners" for each row EXECUTE FUNCTION set_updated_at();
create trigger "products_set_updated_at" before update on public."products" for each row EXECUTE FUNCTION set_updated_at();
create trigger "sales_set_updated_at" before update on public."sales" for each row EXECUTE FUNCTION set_updated_at();
create trigger "settings_set_updated_at" before update on public."settings" for each row EXECUTE FUNCTION set_updated_at();
create trigger "trg_products_catalog_reservations" before update on public."products" for each row EXECUTE FUNCTION private.enforce_catalog_reservations();
create trigger "trg_products_protect_qty" before update on public."products" for each row EXECUTE FUNCTION private.protect_product_qty_from_direct_sync();
create unique index receivable_installments_cart_number_key on public.receivable_installments(cart_id,installment_number) where cart_id is not null;
insert into auth.users(id) values(gen_random_uuid());
insert into public.app_members(user_id,role,active) select id,'admin',true from auth.users;
insert into public.catalog_config(id) values(1);
insert into public.infinitypay_rates(receiving_plan,rate_tier,brand_group,payment_kind,installments,fee_rate,checked_at) values('one_day','up_to_20','visa_master','debit',1,0.02,current_date);


insert into public.infinitypay_rates(receiving_plan,rate_tier,brand_group,payment_kind,installments,fee_rate,checked_at) values('one_day','up_to_20','visa_master','pix',1,0,current_date);

create unique index catalog_waitlist_open_phone_product on public.catalog_waitlist(product_id,customer_phone) where status<>'Atendido';
