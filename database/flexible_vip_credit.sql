-- Flexible VIP agreements. The cart sale and its schedule commit together.
-- Existing monthly installments keep their dates, amounts and payment status.
alter table public.sales
  add column customer_name text,
  add column customer_phone text,
  add column vip_plan jsonb,
  add column received_amount numeric(12,2) not null default 0
    check (received_amount >= 0 and received_amount <= total);

alter table public.receivable_installments
  add column cart_id text,
  add column is_down_payment boolean not null default false,
  add column paid_amount numeric(12,2) not null default 0
    check (paid_amount >= 0 and paid_amount <= amount);

update public.receivable_installments
set paid_amount=amount where status='Pago';
update public.sales s set received_amount=coalesce(
  (select sum(r.paid_amount) from public.receivable_installments r where r.sale_id=s.id),
  case when s.received_status='Recebido' then s.total else 0 end
) where s.payment='Crediário VIP';

create index sales_cart_id_idx on public.sales(cart_id) where cart_id is not null;
create index receivable_installments_cart_idx on public.receivable_installments(cart_id) where cart_id is not null;
create unique index receivable_installments_cart_number_key
  on public.receivable_installments(cart_id,installment_number) where cart_id is not null;

create table public.receivable_payments(
  id uuid primary key,
  receivable_id uuid not null references public.receivable_installments(id) on delete cascade,
  amount numeric(12,2) not null check(amount>0),
  payment_method text not null check(payment_method in ('Pix','Dinheiro','Transferência','Outro','Não informado')),
  received_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index receivable_payments_receivable_idx on public.receivable_payments(receivable_id);
alter table public.receivable_payments enable row level security;
create policy admin_read_receivable_payments on public.receivable_payments
  for select to authenticated using ((select private.is_admin()));
revoke all on public.receivable_payments from public,anon,authenticated;
grant select on public.receivable_payments to authenticated;
insert into public.receivable_payments(id,receivable_id,amount,payment_method,received_at,created_by)
select id,id,amount,'Não informado',coalesce(paid_at,created_at),null
from public.receivable_installments where status='Pago';

-- Internal helper: assign the amount actually received across cart lines without
-- losing cents. Revenue and consignor commissions stay based on the sale itself.
create function private.refresh_vip_received(p_sale_id text,p_cart_id text)
returns void language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
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
$$;
revoke all on function private.refresh_vip_received(text,text) from public,anon,authenticated;

create function private.record_vip_payment_impl(
  p_receivable_id uuid,p_amount numeric,p_request_id uuid,p_payment_method text default 'Pix'
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
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
$$;
revoke all on function private.record_vip_payment_impl(uuid,numeric,uuid,text) from public,anon;
grant execute on function private.record_vip_payment_impl(uuid,numeric,uuid,text) to authenticated;
create function public.record_vip_payment(
  p_receivable_id uuid,p_amount numeric,p_request_id uuid,p_payment_method text default 'Pix'
) returns jsonb language sql security invoker
set search_path='pg_catalog','public','private' as $$
  select private.record_vip_payment_impl(p_receivable_id,p_amount,p_request_id,p_payment_method);
$$;
revoke all on function public.record_vip_payment(uuid,numeric,uuid,text) from public,anon;
grant execute on function public.record_vip_payment(uuid,numeric,uuid,text) to authenticated;

-- Compatibility for the older "receive full installment" button.
create or replace function private.mark_receivable_paid_impl(p_receivable_id uuid)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
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
$$;

create function private.register_vip_sale_cart_impl(
  p_cart_id text,p_items jsonb,p_plan jsonb,p_customer_name text,p_customer_phone text default '',
  p_discount_percent numeric default 0,p_channel text default 'Loja física',
  p_customer_type text default 'nao_informado',p_purchase_profile text default 'nao_informado'
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
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
$$;
revoke all on function private.register_vip_sale_cart_impl(text,jsonb,jsonb,text,text,numeric,text,text,text) from public,anon;
grant execute on function private.register_vip_sale_cart_impl(text,jsonb,jsonb,text,text,numeric,text,text,text) to authenticated;
create function public.register_vip_sale_cart(
  p_cart_id text,p_items jsonb,p_plan jsonb,p_customer_name text,p_customer_phone text default '',
  p_discount_percent numeric default 0,p_channel text default 'Loja física',
  p_customer_type text default 'nao_informado',p_purchase_profile text default 'nao_informado'
) returns jsonb language sql security invoker
set search_path='pg_catalog','public','private' as $$
  select private.register_vip_sale_cart_impl(p_cart_id,p_items,p_plan,p_customer_name,p_customer_phone,
    p_discount_percent,p_channel,p_customer_type,p_purchase_profile);
$$;
revoke all on function public.register_vip_sale_cart(text,jsonb,jsonb,text,text,numeric,text,text,text) from public,anon;
grant execute on function public.register_vip_sale_cart(text,jsonb,jsonb,text,text,numeric,text,text,text) to authenticated;

notify pgrst,'reload schema';
