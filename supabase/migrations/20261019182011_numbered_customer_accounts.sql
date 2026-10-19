alter table public.customers add column customer_number bigint generated always as identity unique;
alter table public.customers add column revision integer not null default 0;
alter table public.customers drop constraint customers_name_phone_key;
alter table public.sales add column customer_id uuid references public.customers(id);
create index sales_customer_id_idx on public.sales(customer_id);
-- Old names alone are not sufficient evidence to join two people's debts.
drop trigger remember_sale_customer on public.sales;
create function private.sale_customer_identity() returns trigger language plpgsql security definer set search_path='pg_catalog','public','private' as $$
begin
 if new.customer_id is null and new.cart_id is not null then
  select customer_id into new.customer_id from public.sales where cart_id=new.cart_id and customer_id is not null and id<>new.id limit 1;
 end if;
 return new;
end $$;
create trigger sale_customer_identity before insert or update of cart_id on public.sales for each row execute function private.sale_customer_identity();
revoke all on function private.sale_customer_identity() from public,anon,authenticated;

create function private.customer_accounts_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='pg_catalog','public','private' as $$
declare cid uuid:=nullif(p_data->>'customer_id','')::uuid; req uuid:=nullif(p_data->>'request_id','')::uuid; c public.customers%rowtype; oldc jsonb; n text:=regexp_replace(trim(coalesce(p_data->>'name','')),'[[:space:]]+',' ','g'); ph text:=regexp_replace(coalesce(p_data->>'phone',''),'[^0-9]','','g'); r jsonb; a text; s record;
begin
 perform private.finance_admin(p_action in ('update','assign'));
 if p_action in ('create','update') then
  if req is null or length(n)>120 or n !~ '^[^[:space:]]+[[:space:]]+[^[:space:]].*$' or n ~ '[[:cntrl:]]' or (ph<>'' and ph !~ '^[0-9]{10,15}$') then raise exception 'Informe nome e sobrenome e confira o WhatsApp.' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-register',0));
  if p_action='create' then
   select * into c from public.customers where id=req;
   if found then
    if c.name<>n or c.phone<>ph then raise exception 'Cadastro já confirmado com outros dados.' using errcode='22023';end if;
    return to_jsonb(c);
   end if;
   if not coalesce((p_data->>'allow_duplicate')::boolean,false) and exists(select 1 from public.customers where lower(name)=lower(n) or (ph<>'' and phone=ph)) then raise exception 'Possível cadastro duplicado. Selecione o cliente existente ou confirme que é outra pessoa.' using errcode='22023';end if;
   insert into public.customers(id,name,phone) values(req,n,ph) returning * into c;
  else
   perform private.finance_day_open();
   select * into c from public.customers where id=cid for update;
   if not found then raise exception 'Cliente não encontrado.' using errcode='22023';end if;
   if exists(select 1 from public.finance_events where id='customer:'||req and after_data->'request'=p_data) then return to_jsonb(c);end if;
   if c.revision is distinct from (p_data->>'revision')::integer then raise exception 'Cadastro alterado. Atualize a ficha.' using errcode='22023';end if;
   if length(trim(coalesce(p_data->>'reason','')))<5 then raise exception 'Informe o motivo da alteração.' using errcode='22023';end if;
   oldc:=to_jsonb(c);
   update public.customers set name=n,phone=ph,revision=revision+1 where id=cid returning * into c;
   update public.sales set customer_name=n,customer_phone=ph,revision=revision+1,updated_at=now() where customer_id=cid;
   insert into public.finance_events(id,action,reason,before_data,after_data) values('customer:'||req,'Correção do cadastro do cliente',p_data->>'reason',oldc,jsonb_build_object('request',p_data,'customer',to_jsonb(c)));
  end if;
  return to_jsonb(c);
 end if;
 select * into c from public.customers where id=cid;
 if cid is not null and not found then raise exception 'Cliente não encontrado.' using errcode='22023';end if;
 if p_action='assign' then
  if cid is null or req is null then raise exception 'Selecione o cliente.' using errcode='22023';end if;
  perform private.finance_day_open();
  select coalesce(cart_id,id) into a from public.sales where id=p_data->>'sale_id';
  if a is null then raise exception 'Venda não encontrada.' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('vip-receipt:'||a,0));
  if exists(select 1 from public.finance_events where id='customer-link:'||req) then
   if not exists(select 1 from public.finance_events where id='customer-link:'||req and after_data=p_data) then raise exception 'Solicitação já usada com outros dados.' using errcode='22023';end if;
   return jsonb_build_object('status','already_applied');
  end if;
  perform private.finance_purchase_edit_impl(req,p_data->>'sale_id',p_data->'revisions','customer',c.name,c.phone,p_data->>'reason');
  select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id)) into oldc from public.sales where coalesce(cart_id,id)=a;
  update public.sales set customer_id=cid where coalesce(cart_id,id)=a;
  insert into public.finance_events(id,action,reason,sale_id,before_data,after_data) values('customer-link:'||req,'Vínculo ao cadastro do cliente',p_data->>'reason',p_data->>'sale_id',oldc,p_data);
  return jsonb_build_object('status','applied');
 elsif p_action='checkout' then
  a:=p_data->>'p_cart_id';
  perform private.finance_day_open();perform pg_advisory_xact_lock(hashtextextended('vip-receipt:'||a,0));
  if p_data->>'p_payment'='Crediário VIP' and cid is null then raise exception 'Selecione ou cadastre o cliente do crediário.' using errcode='22023';end if;
  if exists(select 1 from public.sales where cart_id=a and customer_id is distinct from cid) then raise exception 'Esta compra já foi registrada para outro cadastro. Atualize.' using errcode='22023';end if;
  if p_data->>'p_payment'='Crediário VIP' then
   r:=private.register_vip_sale_cart_impl(a,p_data->'p_items',p_data->'p_plan',c.name,c.phone,(p_data->>'p_discount_percent')::numeric,p_data->>'p_channel',p_data->>'p_customer_type',p_data->>'p_purchase_profile');
  else
   r:=private.register_sale_cart_atomic_impl(a,p_data->'p_items',(p_data->>'p_discount_percent')::numeric,p_data->>'p_payment',p_data->>'p_channel',p_data->>'p_customer_type',p_data->>'p_purchase_profile',(p_data->>'p_installments')::integer,(p_data->>'p_first_due_date')::date,p_data->>'p_card_brand',p_data->>'p_receiving_plan',p_data->>'p_rate_tier');
  end if;
  update public.sales set customer_id=cid,customer_name=c.name,customer_phone=c.phone where cart_id=a;
  return r;
 end if;
 raise exception 'Ação inválida.' using errcode='22023';
end $$;
create function public.customer_accounts(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$select private.customer_accounts_impl(p_action,p_data);$$;
revoke all on function private.customer_accounts_impl(text,jsonb),public.customer_accounts(text,jsonb) from public,anon,authenticated;
grant execute on function private.customer_accounts_impl(text,jsonb),public.customer_accounts(text,jsonb) to authenticated;
notify pgrst,'reload schema';
