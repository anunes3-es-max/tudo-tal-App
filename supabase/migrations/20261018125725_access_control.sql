-- Server-enforced access, separate seller data, individual attribution and approvals.
create table private.access_sessions(
 id uuid primary key, user_id uuid not null references auth.users(id),
 last_seen timestamptz not null default now(), locked_at timestamptz, revoked_at timestamptz,
 device text not null default '', created_at timestamptz not null default now());
create table private.seller_slots(
 slot smallint primary key check(slot between 1 and 2), user_id uuid unique references auth.users(id),
 name text not null default '', email text not null default '', phone text not null default '',
 enabled boolean not null default false, onboarded boolean not null default false);
insert into private.seller_slots(slot) values(1),(2);
create table private.access_events(
 id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default now(),
 actor uuid references auth.users(id), action text not null, details jsonb not null default '{}');
create table private.seller_requests(
 id uuid primary key, actor uuid not null references auth.users(id), kind text not null check(kind in ('checkout','change')),
 payload jsonb not null, status text not null default 'pending', approver uuid references auth.users(id),
 result jsonb, created_at timestamptz not null default now(), completed_at timestamptz);
alter table private.access_sessions enable row level security;
alter table private.seller_slots enable row level security;
alter table private.access_events enable row level security;
alter table private.seller_requests enable row level security;
revoke all on private.access_sessions,private.seller_slots,private.access_events,private.seller_requests from public,anon,authenticated;
alter table public.sales add column operator_id uuid references auth.users(id) default auth.uid();
alter table public.sales add column operator_name text;

create function private.access_role() returns text language sql stable security definer set search_path=pg_catalog,public,private as $$
 select m.role from public.app_members m where m.user_id=auth.uid() and m.active
 and (m.role='admin' or (m.role='staff' and exists(select 1 from private.seller_slots s where s.user_id=m.user_id and s.enabled and s.onboarded)))
$$;
create function private.access_valid() returns boolean language sql stable security definer set search_path=pg_catalog,public,private as $$
 select auth.uid() is not null and exists(select 1 from private.access_sessions s join auth.sessions a on a.id=s.id and a.user_id=s.user_id
 where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid() and s.revoked_at is null
 and s.locked_at is null and s.last_seen>now()-interval '30 minutes')
 and (coalesce(auth.jwt()->>'aal'='aal2',false) or not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified'))
$$;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog,public,private as $$
 select coalesce(private.access_role()='admin',false) and coalesce(private.access_valid(),false)
$$;
create function private.access_require() returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if private.access_role() is null or private.access_valid() is not true then raise exception 'Sessão bloqueada ou acesso suspenso. Entre novamente.' using errcode='42501'; end if;
end $$;

-- Isolated copies retain the existing atomic stock/cash machinery. No API role may
-- execute these workers. Only the checked dispatcher below can call them.
do $$ declare n text; d text; r record; begin
 foreach n in array array['refresh_vip_received','infinitypay_rate_impl','register_sale_atomic_impl','register_sale_cart_atomic_impl','record_vip_payment_impl','register_vip_sale_cart_impl'] loop
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='private' and p.proname=n;
 d:=replace(d,'private.'||n||'(', 'private.seller_worker_'||n||'(');
 d:=replace(d,'perform private.finance_admin();','perform private.access_require();');
 d:=replace(d,'if not private.is_admin() then','if private.access_role() is null then');
 d:=replace(d,'if auth.uid() is null or not private.is_admin() then','if private.access_role() is null then');
 d:=replace(d,'private.register_sale_atomic_impl(', 'private.seller_worker_register_sale_atomic_impl(');
 d:=replace(d,'private.register_sale_cart_atomic_impl(', 'private.seller_worker_register_sale_cart_atomic_impl(');
 d:=replace(d,'private.record_vip_payment_impl(', 'private.seller_worker_record_vip_payment_impl(');
 d:=replace(d,'private.refresh_vip_received(', 'private.seller_worker_refresh_vip_received(');
 d:=replace(d,'private.infinitypay_rate_impl(', 'private.seller_worker_infinitypay_rate_impl(');
 execute d;
 end loop;
 for r in select p.oid::regprocedure f from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='private' and p.proname like 'seller_worker_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.f);
 end loop;
end $$;

create function private.seller_checkout(p_id uuid,p_actor uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare r jsonb; cart text:='seller-'||p_id; total numeric; x record; begin
 perform private.access_require();
 if p_actor is distinct from auth.uid() and not private.is_admin() then raise exception 'Operador inválido.' using errcode='42501'; end if;
 if not exists(select 1 from public.app_members m join private.seller_slots s on s.user_id=m.user_id where m.user_id=p_actor and m.role='staff' and m.active and s.enabled and s.onboarded) then raise exception 'Vendedor inativo.' using errcode='42501'; end if;
 if coalesce((p->>'discount')::numeric,0)<>0 and not private.is_admin() then raise exception 'Desconto exige aprovação administrativa.' using errcode='42501'; end if;
 if p->>'payment' is null or p->>'payment' not in ('Pix','Dinheiro','Débito','Crédito à vista','Crédito parcelado','Crediário VIP') then raise exception 'Pagamento inválido.' using errcode='22023'; end if;
 perform private.finance_day_open();
 -- Lock in deterministic order, and reject an approval if prices changed meanwhile.
 for x in select a.product_id,a.price,a.promotion from jsonb_to_recordset(p->'items') a(product_id text,price numeric,promotion numeric) order by a.product_id loop
 perform 1 from public.products where id=x.product_id and price=x.price and discount_percent=x.promotion for update;
 if not found then raise exception 'Preços alterados. Atualize o estoque e solicite novamente.' using errcode='22023'; end if;
 end loop;
 if p->>'payment'='Crediário VIP' then
 r:=private.seller_worker_register_vip_sale_cart_impl(cart,p->'items',p->'plan',p->>'customer_name',coalesce(p->>'customer_phone',''),coalesce((p->>'discount')::numeric,0));
 else
 r:=private.seller_worker_register_sale_cart_atomic_impl(cart,p->'items',coalesce((p->>'discount')::numeric,0),p->>'payment','Loja física','nao_informado','nao_informado',coalesce((p->>'installments')::integer,1),null,p->>'brand','one_day','up_to_20');
 end if;
 update public.sales set operator_id=p_actor,operator_name=(select name from private.seller_slots where user_id=p_actor) where cart_id=cart;
 return jsonb_build_object('cart_id',cart,'total',r->'total','status','registered');
end $$;
revoke all on function private.seller_checkout(uuid,uuid,jsonb) from public,anon,authenticated;

create function private.access_control_impl(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
#variable_conflict use_column
declare u uuid:=auth.uid(); sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid; role_name text; s private.access_sessions; req private.seller_requests;
 slotrow private.seller_slots; r jsonb; fresh numeric; rid uuid; target uuid;
begin
 if u is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
 if not exists(select 1 from auth.sessions where id=sid and user_id=u) then raise exception 'Sessão encerrada. Entre novamente.' using errcode='42501'; end if;
 select max((x->>'timestamp')::numeric) into fresh from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) x where x->>'method'='password';
 if p_action='onboard' then
   if fresh is null or fresh<extract(epoch from now())-90 then raise exception 'Entre com sua nova senha para concluir o cadastro.' using errcode='42501'; end if;
   update private.seller_slots set onboarded=true where user_id=u and not onboarded;
   if found then insert into private.access_events(actor,action) values(u,'Primeiro acesso concluído'); end if;
   return '{}'::jsonb;
 end if;
 role_name:=private.access_role();
 if role_name is null then raise exception 'Conta pendente ou suspensa. Solicite a ativação ao administrador.' using errcode='42501'; end if;
 if p_action='unlock' then
   if exists(select 1 from auth.mfa_factors where user_id=u and status='verified') and auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'Confirme o código do autenticador.' using errcode='42501'; end if;
   select * into s from private.access_sessions where id=sid for update;
   if s.revoked_at is not null then raise exception 'Sessão revogada. Saia e entre novamente.' using errcode='42501'; end if;
   if fresh is null or fresh<extract(epoch from now())-90 or (s.locked_at is not null and fresh<floor(extract(epoch from s.locked_at))) then raise exception 'Confirme a senha para desbloquear.' using errcode='42501'; end if;
   insert into private.access_sessions(id,user_id,device) values(sid,u,left(coalesce(p_data->>'device',''),180))
   on conflict(id) do update set locked_at=null,last_seen=now();
   insert into private.access_events(actor,action) values(u,'Acesso desbloqueado');
 elsif p_action='lock' then
   update private.access_sessions set locked_at=now() where id=sid and user_id=u;
   return '{}'::jsonb;
 else perform private.access_require();
 end if;
 if p_action in ('unlock','profile','heartbeat') then
   if p_action='heartbeat' then update private.access_sessions set last_seen=now() where id=sid; end if;
   return jsonb_build_object('user_id',u,'role',role_name,'name',coalesce((select name from private.seller_slots where user_id=u),auth.jwt()->>'email'),'session_id',sid);
 end if;
 if p_action='sessions' then
   return coalesce((select jsonb_agg(jsonb_build_object('id',id,'device',device,'last_seen',last_seen,'locked',locked_at is not null,'current',id=sid)) from private.access_sessions where user_id=u and revoked_at is null),'[]');
 elsif p_action='revoke' then
   update private.access_sessions set revoked_at=now() where id=(p_data->>'id')::uuid and user_id=u;
   insert into private.access_events(actor,action,details) values(u,'Sessão encerrada',p_data);
   return '{}'::jsonb;
 elsif p_action='stock' then
   return coalesce((select jsonb_agg(jsonb_build_object('id',id,'sku',sku,'name',name,'price',price,'discount_percent',discount_percent,'qty',qty,'category',category,'size',size,'photo_url',photo_url,'is_donation',is_donation)) from public.products where active),'[]');
 elsif p_action='my_sales' then
   return coalesce((select jsonb_agg(t order by sale_date desc) from (select id,cart_id,product_name,qty,total,unit_price,status,revision,payment,sale_date from public.sales where operator_id=u order by sale_date desc limit 100)t),'[]');
 elsif p_action='my_requests' then
   return coalesce((select jsonb_agg(t order by created_at desc) from (select id,kind,status,result,created_at from private.seller_requests where actor=u order by created_at desc limit 30)t),'[]');
 elsif p_action in ('checkout','request_change') then
   if role_name<>'staff' then raise exception 'Use o PDV administrativo.' using errcode='42501'; end if;
   if octet_length(p_data::text)>60000 then raise exception 'Solicitação muito grande.' using errcode='22023'; end if;
   rid:=(p_data->>'id')::uuid;
   if rid is null then raise exception 'Identificador obrigatório.' using errcode='22023'; end if;
   perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
   select * into req from private.seller_requests where id=rid;
   if found then
     if req.actor<>u or req.payload is distinct from p_data-'id' then raise exception 'Identificador já utilizado para outra operação.' using errcode='22023'; end if;
     return jsonb_build_object('status',req.status,'result',req.result);
   end if;
   if p_action='checkout' then
     if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 50 then raise exception 'Carrinho inválido.' using errcode='22023'; end if;
     if coalesce((p_data->>'discount')::numeric,0) not between 0 and 50 then raise exception 'Desconto inválido.' using errcode='22023'; end if;
     if exists(select 1 from jsonb_to_recordset(p_data->'items') x(product_id text,name text,price numeric,promotion numeric,qty integer)
       left join public.products p on p.id=x.product_id where p.id is null or not p.active or p.is_donation or x.qty is null or x.qty not between 1 and 100
       or x.name is distinct from p.name or x.price is distinct from p.price or x.promotion is distinct from p.discount_percent) then
       raise exception 'Confira os itens e preços atuais do estoque.' using errcode='22023';
     end if;
   end if;
   if p_action='request_change' then
     if not exists(select 1 from public.sales where id=p_data->>'sale_id' and operator_id=u) then raise exception 'Venda não pertence ao vendedor.' using errcode='42501'; end if;
     if p_data->>'action' not in ('cancel','return','price','exchange') or length(trim(coalesce(p_data->>'reason','')))<5 then raise exception 'Informe a correção e o motivo.' using errcode='22023'; end if;
   end if;
   if (select count(*) from private.seller_requests where actor=u and status='pending')>=20 then raise exception 'Resolva as solicitações pendentes antes de criar outras.' using errcode='22023'; end if;
   insert into private.seller_requests(id,actor,kind,payload) values(rid,u,case when p_action='checkout' then 'checkout' else 'change' end,p_data-'id');
   if p_action='checkout' and coalesce((p_data->>'discount')::numeric,0)=0 then
     r:=private.seller_checkout(rid,u,p_data);
     update private.seller_requests set status='completed',result=r,completed_at=now() where id=rid;
   else r:=jsonb_build_object('status','pending'); end if;
   insert into private.access_events(actor,action,details) values(u,case when r->>'status'='pending' then 'Aprovação solicitada' else 'Venda concluída' end,jsonb_build_object('request_id',rid));
   return r;
 end if;
 perform private.finance_admin();
 if p_action='panel' then
   return jsonb_build_object('slots',(select jsonb_agg(to_jsonb(s) order by slot) from private.seller_slots s),
   'requests',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('seller',s.name) order by q.created_at) from private.seller_requests q left join private.seller_slots s on s.user_id=q.actor where q.status='pending'),'[]'),
   'events',coalesce((select jsonb_agg(t) from (select e.*,coalesce(s.name,a.email) actor_name from private.access_events e left join private.seller_slots s on s.user_id=e.actor left join auth.users a on a.id=e.actor order by occurred_at desc limit 100)t),'[]'));
 end if;
 perform private.finance_admin(true);
 if p_action='admin_check' then return jsonb_build_object('ok',true); end if;
 if p_action='save_slot' then
   select * into slotrow from private.seller_slots where slot=(p_data->>'slot')::integer for update;
   if not found then raise exception 'Vaga inválida.' using errcode='22023'; end if;
   if slotrow.user_id is not null and lower(trim(p_data->>'email')) is distinct from slotrow.email then raise exception 'Suspenda e libere a vaga para trocar de pessoa.' using errcode='22023'; end if;
   if length(trim(coalesce(p_data->>'name','')))<2 or coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Informe nome e e-mail válidos.' using errcode='22023'; end if;
   update private.seller_slots set name=left(trim(p_data->>'name'),120),email=lower(trim(p_data->>'email')),phone=left(coalesce(p_data->>'phone',''),25) where slot=slotrow.slot;
 elsif p_action in ('activate','suspend','release') then
   select * into slotrow from private.seller_slots where slot=(p_data->>'slot')::integer for update;
   if not found then raise exception 'Vaga inválida.' using errcode='22023'; end if;
   if p_action='activate' and (slotrow.user_id is null or not slotrow.onboarded) then raise exception 'O vendedor precisa concluir o primeiro acesso antes da ativação.' using errcode='22023'; end if;
   update public.app_members set active=(p_action='activate') where user_id=slotrow.user_id and role='staff';
   update private.seller_slots set enabled=(p_action='activate') where slot=slotrow.slot;
   if p_action<>'activate' then update private.access_sessions set revoked_at=now() where user_id=slotrow.user_id; end if;
   if p_action='release' then
     insert into private.access_events(actor,action,details) values(u,'Vendedor removido da vaga',to_jsonb(slotrow));
     update private.seller_slots set user_id=null,name='',email='',phone='',enabled=false,onboarded=false where slot=slotrow.slot;
   end if;
 elsif p_action in ('approve','reject') then
   select * into req from private.seller_requests where id=(p_data->>'id')::uuid for update;
   if not found then raise exception 'Solicitação não encontrada.' using errcode='22023'; end if;
   if req.status<>'pending' then return jsonb_build_object('status',req.status,'result',req.result); end if;
   if p_action='approve' then
     if req.kind='checkout' then r:=private.seller_checkout(req.id,req.actor,req.payload);
     else
       if not exists(select 1 from public.sales where id=req.payload->>'sale_id' and operator_id=req.actor) then raise exception 'Venda inválida.' using errcode='42501'; end if;
       perform public.finance_change_sale(req.id,req.payload->>'sale_id',(req.payload->>'revision')::integer,req.payload->>'action',req.payload->'data',req.payload->>'reason');
       r:=jsonb_build_object('status','corrected');
     end if;
   end if;
   update private.seller_requests set status=case when p_action='approve' then 'completed' else 'rejected' end,approver=u,result=r,completed_at=now() where id=req.id;
 else raise exception 'Ação desconhecida.' using errcode='22023';
 end if;
 insert into private.access_events(actor,action,details) values(u,p_action,p_data);
 return coalesce(r,'{}');
end $$;
create function public.access_control(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.access_control_impl(p_action,p_data) $$;
-- Service-only helper for invitation delivery; cannot grant an administrator role.
create function public.bind_seller_invitation(p_slot integer,p_user uuid,p_email text) returns void language plpgsql security invoker set search_path=pg_catalog,private as $$
begin
 perform private.bind_seller_invitation_impl(p_slot,p_user,p_email);
end $$;
create function private.bind_seller_invitation_impl(p_slot integer,p_user uuid,p_email text) returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 perform 1 from private.seller_slots where slot=p_slot and email=p_email and (user_id is null or user_id=p_user) for update;
 if not found then raise exception 'Cadastro alterado. Confira a vaga.'; end if;
 if exists(select 1 from public.app_members where user_id=p_user and role='admin') then raise exception 'Administrador não pode ocupar vaga de vendedor.'; end if;
 insert into public.app_members(user_id,role,active) values(p_user,'staff',false) on conflict(user_id) do nothing;
 update private.seller_slots set user_id=p_user where slot=p_slot;
end $$;
revoke all on function public.bind_seller_invitation(integer,uuid,text),private.bind_seller_invitation_impl(integer,uuid,text) from public,anon,authenticated;
grant execute on function public.bind_seller_invitation(integer,uuid,text),private.bind_seller_invitation_impl(integer,uuid,text) to service_role;
revoke all on function private.access_role(),private.access_valid(),private.access_require(),private.access_control_impl(text,jsonb),public.access_control(text,jsonb) from public,anon,authenticated;
grant execute on function private.access_control_impl(text,jsonb),public.access_control(text,jsonb) to authenticated;

grant usage on schema private to service_role;
create function private.find_seller_user_impl(p_email text) returns uuid language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid; begin
 select id into uid from auth.users where lower(email)=lower(p_email);
 if exists(select 1 from public.app_members where user_id=uid and role='admin') then raise exception 'Use outro e-mail: esta conta é de administrador.'; end if;
 return uid;
end $$;
create function public.find_seller_user(p_email text) returns uuid language sql security invoker set search_path=pg_catalog,private as $$ select private.find_seller_user_impl(p_email) $$;
revoke all on function public.find_seller_user(text),private.find_seller_user_impl(text) from public,anon,authenticated;
grant execute on function public.find_seller_user(text),private.find_seller_user_impl(text) to service_role;
