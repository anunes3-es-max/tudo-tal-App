create table public.customers (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 120),
 phone text not null default '' check(phone='' or phone ~ '^[0-9]{10,15}$'), created_at timestamptz not null default now(),
 unique(name,phone)
);
alter table public.customers enable row level security;
revoke all on public.customers from public,anon,authenticated;
grant select on public.customers to authenticated;
create policy customers_admin_read on public.customers for select to authenticated using ((select private.is_admin()));
create function private.remember_sale_customer() returns trigger language plpgsql security definer set search_path='pg_catalog','public','private' as $$
declare n text:=trim(coalesce(new.customer_name,'')); p text:=regexp_replace(coalesce(new.customer_phone,''),'[^0-9]','','g');
begin
 if length(n) between 2 and 120 and (p='' or p ~ '^[0-9]{10,15}$') then
  insert into public.customers(name,phone) values(n,p) on conflict(name,phone) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.remember_sale_customer() from public,anon,authenticated;
create trigger remember_sale_customer after insert or update of customer_name,customer_phone on public.sales for each row execute function private.remember_sale_customer();
insert into public.customers(name,phone) select distinct trim(customer_name),regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g') from public.sales where length(trim(customer_name)) between 2 and 120 and (coalesce(customer_phone,'')='' or regexp_replace(customer_phone,'[^0-9]','','g') ~ '^[0-9]{10,15}$') on conflict do nothing;

create function private.finance_purchase_edit_impl(p_id uuid,p_sale_id text,p_revisions jsonb,p_action text,p_name text,p_phone text,p_reason text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
declare account_id text; s public.sales%rowtype; payload jsonb; before_rows jsonb; after_rows jsonb; n text:=trim(coalesce(p_name,'')); phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
 perform private.finance_admin(true);perform private.finance_day_open();
 if p_id is null or p_action not in ('customer','cancel_purchase') or p_action is null or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe a ação e o motivo da correção.' using errcode='22023';end if;
 payload:=jsonb_build_object('sale_id',p_sale_id,'revisions',p_revisions,'action',p_action,'name',n,'phone',phone,'reason',p_reason);
 select coalesce(cart_id,id) into account_id from public.sales where id=p_sale_id;
 if account_id is null then raise exception 'Venda não encontrada.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('vip-receipt:'||account_id,0));
 if exists(select 1 from public.finance_events where id='purchase:'||p_id) then
  if not exists(select 1 from public.finance_events where id='purchase:'||p_id and after_data->'request'=payload) then raise exception 'Solicitação já usada com outros dados.' using errcode='22023';end if;
  return jsonb_build_object('status','already_applied');
 end if;
 perform 1 from public.sales where coalesce(cart_id,id)=account_id order by id for update;
 if p_revisions is distinct from (select jsonb_object_agg(id,revision) from public.sales where coalesce(cart_id,id)=account_id) then raise exception 'A compra mudou. Sincronize e confira novamente.' using errcode='22023';end if;
 select jsonb_agg(to_jsonb(x) order by id) into before_rows from public.sales x where coalesce(cart_id,id)=account_id;
 if p_action='customer' then
  if length(n) not between 2 and 120 or (phone<>'' and phone !~ '^[0-9]{10,15}$') then raise exception 'Confira o nome e o WhatsApp do cliente.' using errcode='22023';end if;
  update public.sales set customer_name=n,customer_phone=phone,revision=revision+1,updated_at=now() where coalesce(cart_id,id)=account_id;
 else
  if not exists(select 1 from public.sales where coalesce(cart_id,id)=account_id and status<>'Cancelada') then raise exception 'Compra já cancelada.' using errcode='22023';end if;
  for s in select * from public.sales where coalesce(cart_id,id)=account_id and status<>'Cancelada' order by id loop
   perform private.finance_change_sale_impl(gen_random_uuid(),s.id,s.revision,'cancel','{"restock":true}'::jsonb,p_reason);
  end loop;
 end if;
 select jsonb_agg(to_jsonb(x) order by id) into after_rows from public.sales x where coalesce(cart_id,id)=account_id;
 insert into public.finance_events(id,action,reason,sale_id,before_data,after_data) values('purchase:'||p_id,case p_action when 'customer' then 'Correção de cliente' else 'Cancelamento da compra inteira' end,p_reason,p_sale_id,before_rows,jsonb_build_object('request',payload,'sales',after_rows));
 if p_action='customer' then
  for s in select * from public.sales where coalesce(cart_id,id)=account_id and id<>p_sale_id loop
   insert into public.finance_events(id,action,reason,sale_id,before_data,after_data)
   values('purchase:'||p_id||':'||s.id,'Correção de cliente',p_reason,s.id,before_rows,jsonb_build_object('request',payload,'sales',after_rows));
  end loop;
 end if;
 return jsonb_build_object('status','applied');
end $$;
create function public.finance_purchase_edit(p_id uuid,p_sale_id text,p_revisions jsonb,p_action text,p_name text,p_phone text,p_reason text) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$select private.finance_purchase_edit_impl(p_id,p_sale_id,p_revisions,p_action,p_name,p_phone,p_reason);$$;
revoke all on function private.finance_purchase_edit_impl(uuid,text,jsonb,text,text,text,text),public.finance_purchase_edit(uuid,text,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function private.finance_purchase_edit_impl(uuid,text,jsonb,text,text,text,text),public.finance_purchase_edit(uuid,text,jsonb,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
