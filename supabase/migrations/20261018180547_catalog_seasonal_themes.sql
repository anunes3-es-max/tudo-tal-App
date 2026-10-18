-- Public presentation only. Operational data and prices remain unchanged.
create table public.catalog_appearance (
 id smallint primary key default 1 check(id=1),
 theme text not null default 'default' check(theme in ('default','natal','ano_novo')),
 title text not null default '' check(length(title)<=90),
 message text not null default '' check(length(message)<=180),
 starts_at timestamptz,
 ends_at timestamptz,
 version bigint not null default 0,
 check(theme='default' or (ends_at is not null and (starts_at is null or ends_at>starts_at)))
);
insert into public.catalog_appearance(id) values(1);
alter table public.catalog_appearance enable row level security;
revoke all on public.catalog_appearance from anon,authenticated;
grant select on public.catalog_appearance to anon,authenticated;
grant update on public.catalog_appearance to authenticated;
create policy catalog_appearance_read on public.catalog_appearance for select to anon,authenticated using(true);
create policy catalog_appearance_admin on public.catalog_appearance for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
create function public.get_catalog_appearance() returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 select to_jsonb(a)||jsonb_build_object('server_time',now(),'active_theme',case when a.theme<>'default' and (a.starts_at is null or a.starts_at<=now()) and a.ends_at>now() then a.theme else 'default' end) from public.catalog_appearance a where id=1
$$;
create function public.save_catalog_appearance(p_theme text,p_title text,p_message text,p_starts_at timestamptz,p_ends_at timestamptz,p_version bigint) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if not private.is_admin() then raise exception 'Acesso exclusivo de administrador.' using errcode='42501'; end if;
 if p_theme is null or p_theme not in ('default','natal','ano_novo') or length(coalesce(p_title,''))>90 or length(coalesce(p_message,''))>180 then raise exception 'Tema ou texto inválido.' using errcode='22023'; end if;
 if p_theme<>'default' and (p_ends_at is null or p_ends_at<=now() or (p_starts_at is not null and p_ends_at<=p_starts_at)) then raise exception 'Informe um encerramento futuro, posterior ao início.' using errcode='22023'; end if;
 update public.catalog_appearance set theme=p_theme,title=trim(coalesce(p_title,'')),message=trim(coalesce(p_message,'')),starts_at=case when p_theme='default' then null else p_starts_at end,ends_at=case when p_theme='default' then null else p_ends_at end,version=version+1 where id=1 and version=p_version;
 if not found then raise exception 'A configuração mudou em outra tela. Recarregue antes de salvar.' using errcode='40001'; end if;
 return public.get_catalog_appearance();
end $$;
revoke all on function public.get_catalog_appearance() from public;
grant execute on function public.get_catalog_appearance() to anon,authenticated;
revoke all on function public.save_catalog_appearance(text,text,text,timestamptz,timestamptz,bigint) from public;
grant execute on function public.save_catalog_appearance(text,text,text,timestamptz,timestamptz,bigint) to authenticated;
