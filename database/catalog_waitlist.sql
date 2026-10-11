-- Lista de interesse: nenhum pedido, venda ou reserva é criado por este fluxo.
create table public.catalog_waitlist (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  customer_name text not null check (
    length(customer_name) between 2 and 80
    and customer_name = btrim(customer_name)
    and customer_name !~ '[[:cntrl:]]'
  ),
  customer_phone text not null check (
    customer_phone ~ '^55[1-9][0-9]([2-9][0-9]{7}|9[0-9]{8})$'
  ),
  status text not null default 'Aguardando reposição'
    check (status in ('Aguardando reposição', 'Avisado', 'Atendido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notified_at timestamptz
);

-- Uma única inscrição em aberto por produto e telefone, inclusive em requisições concorrentes.
create unique index catalog_waitlist_open_phone_product
  on public.catalog_waitlist (product_id, customer_phone)
  where status <> 'Atendido';
create index catalog_waitlist_created_at_idx
  on public.catalog_waitlist (created_at desc);
create index catalog_waitlist_product_id_idx
  on public.catalog_waitlist (product_id);

alter table public.catalog_waitlist enable row level security;
revoke all on public.catalog_waitlist from anon, authenticated;
grant insert (product_id, customer_name, customer_phone)
  on public.catalog_waitlist to anon, authenticated;
grant select on public.catalog_waitlist to authenticated;
grant update (status, updated_at, notified_at)
  on public.catalog_waitlist to authenticated;

create policy catalog_waitlist_admin_read
  on public.catalog_waitlist for select to authenticated
  using ((select private.is_admin()));
create policy catalog_waitlist_admin_update
  on public.catalog_waitlist for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Mantém a assinatura atual: clientes antigos continuam compatíveis.
create or replace function public.get_catalog_products()
returns table (
  id text, sku text, name text, category text, brand text, size text,
  color text, condition text, price numeric, original_price numeric,
  discount_percent numeric, photo_url text, available_qty integer
)
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
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
  where p.active = true
  order by (p.qty - private.active_reserved_qty(p.id,null) > 0) desc,
           p.updated_at desc, p.name;
end;
$function$;

-- INSERT público, sem SELECT público e sem permitir atualização de dados alheios.
create policy catalog_waitlist_public_insert
  on public.catalog_waitlist for insert to anon, authenticated
  with check (
    status = 'Aguardando reposição'
    and notified_at is null
    and exists (
      select 1 from public.get_catalog_products() p
      where p.id = catalog_waitlist.product_id and p.available_qty = 0
    )
  );

create or replace function public.create_catalog_interest(
  p_product_id text, p_customer_name text, p_customer_phone text
)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public
as $function$
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
revoke all on function public.create_catalog_interest(text,text,text) from public, anon, authenticated;
grant execute on function public.create_catalog_interest(text,text,text) to anon, authenticated;

create or replace function public.update_catalog_interest_status(p_interest_id uuid,p_status text)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, private
as $function$
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
revoke all on function public.update_catalog_interest_status(uuid,text) from public, anon, authenticated;
grant execute on function public.update_catalog_interest_status(uuid,text) to authenticated;

-- O administrador recebe atualizações em tempo real; as permissões de leitura continuam valendo.
do $block$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='catalog_waitlist'
     ) then
    alter publication supabase_realtime add table public.catalog_waitlist;
  end if;
end;
$block$;
notify pgrst, 'reload schema';
