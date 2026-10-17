-- Financial journal: append-only money movements, reversible operations and frozen daily closes.
-- Existing operational records are retained. Historical payment methods that were not
-- recorded remain 'Não informado'; card settlement is never assumed from a sale.
-- Block concurrent writes while the existing history is copied into the journal.
lock table public.sales,public.cash,public.receivable_installments,public.receivable_payments in access exclusive mode;
alter table public.sales add column status text not null default 'Ativa' check(status in ('Ativa','Cancelada')),
  add column revision integer not null default 0,
  add column original_data jsonb,
  add column repasse_paid_amount numeric(12,2) not null default 0 check(repasse_paid_amount>=0);
update public.sales s set original_data=to_jsonb(s)-'original_data',
  repasse_paid_amount=case when repasse_status='Pago' then repasse else 0 end;
alter table public.sales drop constraint sales_qty_check;
alter table public.sales add constraint sales_qty_check check((qty>0 and status='Ativa') or (qty=0 and status='Cancelada'));
alter table public.receivable_installments drop constraint receivable_installments_amount_check,
  drop constraint receivable_installments_status_check;
alter table public.receivable_installments add constraint receivable_installments_amount_check check(amount>=0),
  add constraint receivable_installments_status_check check(status in ('Pendente','Pago','Cancelado'));

create table public.finance_movements(
  id text primary key, occurred_at timestamptz not null default now(),
  amount numeric(14,2) not null check(amount<>0), method text not null,
  category text not null, description text not null, sale_id text references public.sales(id),
  principal boolean not null default false, created_by uuid default auth.uid(),
  reversal_of text unique references public.finance_movements(id), metadata jsonb not null default '{}'
);
create index finance_movements_date_idx on public.finance_movements(occurred_at);
create index finance_movements_sale_idx on public.finance_movements(sale_id);
create table public.finance_events(
  id text primary key, occurred_at timestamptz not null default now(), action text not null,
  reason text not null, sale_id text references public.sales(id), created_by uuid default auth.uid(),
  actor text default (auth.jwt()->>'email'), before_data jsonb, after_data jsonb,
  sales_delta numeric(14,2) not null default 0, cost_delta numeric(14,2) not null default 0,
  repasse_delta numeric(14,2) not null default 0, qty_delta integer not null default 0
);
create index finance_events_date_idx on public.finance_events(occurred_at);
create index finance_events_sale_idx on public.finance_events(sale_id);
create table public.finance_pending(
  id uuid primary key default gen_random_uuid(), sale_id text not null references public.sales(id),
  kind text not null check(kind in ('card','customer','owner')),
  amount numeric(14,2) not null check(amount<>0), expected_fee numeric(14,2) not null default 0,
  description text not null, status text not null default 'Pendente' check(status in ('Pendente','Resolvido','Substituído')),
  created_at timestamptz not null default now(), resolved_at timestamptz, resolution jsonb
);
create index finance_pending_open_idx on public.finance_pending(sale_id) where status='Pendente';
create table public.cash_closures(
  id uuid primary key, day date not null, revision integer not null, snapshot jsonb not null,
  counted_cash numeric(14,2) not null check(counted_cash>=0), difference numeric(14,2) not null,
  note text not null, created_by uuid not null default auth.uid(), actor text default (auth.jwt()->>'email'),
  closed_at timestamptz not null default now(), reopened_at timestamptz, reopened_by uuid, reopen_reason text,
  unique(day,revision)
);
create unique index cash_closures_active_idx on public.cash_closures(day) where reopened_at is null;

do $$ declare t text; begin
  foreach t in array array['finance_movements','finance_events','finance_pending','cash_closures'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select private.is_admin()))',t);
  end loop;
end $$;

create function private.finance_admin(p_fresh boolean default false) returns void
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
  if p_fresh and not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) x
    where x->>'method'='password' and (x->>'timestamp')::numeric between extract(epoch from now())-300 and extract(epoch from now())+30) then
    raise exception 'Confirme novamente a senha da sua conta para esta operação.' using errcode='42501';
  end if;
end $$;
create function private.finance_day_open(p_at timestamptz default now()) returns void
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare d date:=(p_at at time zone 'America/Sao_Paulo')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended('finance-day:'||d,0));
  if exists(select 1 from public.cash_closures where day=d and reopened_at is null) then
    raise exception 'O caixa de % está fechado. Reabra esse dia com justificativa antes de registrar novas operações.',to_char(d,'DD/MM/YYYY') using errcode='22023';
  end if;
end $$;
create function private.finance_write_guard() returns trigger language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
begin
  if TG_OP<>'INSERT' then raise exception 'Histórico financeiro preservado: registre um estorno.' using errcode='42501'; end if;
  perform private.finance_day_open(new.occurred_at); return new;
end $$;

-- Backfill once, with stable source IDs to make reconciliation reproducible.
insert into public.finance_events(id,occurred_at,action,reason,sale_id,created_by,actor,after_data,sales_delta,cost_delta,repasse_delta,qty_delta)
select 'sale:'||id,sale_date,'Venda','Histórico anterior à implantação do caixa',id,null,null,to_jsonb(s),total,cost_total,repasse,qty from public.sales s;
insert into public.finance_movements(id,occurred_at,amount,method,category,description,sale_id,principal,created_by)
select 'sale:'||id,sale_date,total,coalesce(payment,'Não informado'),'Venda','Recebimento da venda: '||product_name,id,true,null
from public.sales where payment is distinct from 'Crediário VIP' and coalesce(payment,'') not in ('Débito','Crédito à vista','Crédito parcelado') and total>0;
insert into public.finance_pending(sale_id,kind,amount,expected_fee,description)
select id,'card',total,processing_fee_amount,'Confirmar recebimento do cartão: '||product_name from public.sales
where payment in ('Débito','Crédito à vista','Crédito parcelado') and total>0;
insert into public.finance_movements(id,occurred_at,amount,method,category,description,sale_id,principal,created_by)
select 'vip:'||p.id,p.received_at,p.amount,p.payment_method,'Crediário VIP','Recebimento de entrada/parcela VIP',r.sale_id,true,p.created_by
from public.receivable_payments p join public.receivable_installments r on r.id=p.receivable_id;
insert into public.finance_movements(id,occurred_at,amount,method,category,description,sale_id,created_by)
select 'repasse:'||id,coalesce(repasse_paid_at,sale_date),-repasse,'Não informado','Repasse','Repasse anterior: '||coalesce(owner_name,''),id,null
from public.sales where repasse_status='Pago' and repasse>0;
insert into public.finance_movements(id,occurred_at,amount,method,category,description,created_by)
select 'cash:'||id,movement_date,case when type='entrada' then value else -value end,'Não informado','Lançamento anterior',description,null from public.cash;

create trigger finance_movements_guard before insert or update or delete on public.finance_movements for each row execute function private.finance_write_guard();
create trigger finance_events_guard before insert or update or delete on public.finance_events for each row execute function private.finance_write_guard();

create function private.finance_sale_insert() returns trigger language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
begin
  perform private.finance_day_open();
  new.original_data:=to_jsonb(new)-'original_data';
  return new;
end $$;
create trigger finance_sale_original before insert on public.sales for each row execute function private.finance_sale_insert();
create function private.finance_sale_journal() returns trigger language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
begin
  insert into public.finance_events(id,occurred_at,action,reason,sale_id,after_data,sales_delta,cost_delta,repasse_delta,qty_delta)
    values('sale:'||new.id,new.sale_date,case when current_setting('tdt.exchange',true)='yes' then 'Produto da troca' else 'Venda' end,
      coalesce(nullif(current_setting('tdt.change_reason',true),''),'Venda registrada'),new.id,to_jsonb(new),new.total,new.cost_total,new.repasse,new.qty);
  if current_setting('tdt.exchange',true)='yes' then return new; end if;
  if new.payment in ('Débito','Crédito à vista','Crédito parcelado') then
    insert into public.finance_pending(sale_id,kind,amount,expected_fee,description) values(new.id,'card',new.total,new.processing_fee_amount,'Confirmar recebimento do cartão: '||new.product_name);
  elsif new.payment is distinct from 'Crediário VIP' and new.total>0 then
    insert into public.finance_movements(id,amount,method,category,description,sale_id,principal)
      values('sale:'||new.id,new.total,coalesce(new.payment,'Não informado'),'Venda','Recebimento da venda: '||new.product_name,new.id,true);
  end if;
  return new;
end $$;
create trigger finance_sale_journal after insert on public.sales for each row execute function private.finance_sale_journal();
create function private.finance_vip_journal() returns trigger language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare s text;
begin
  select sale_id into s from public.receivable_installments where id=new.receivable_id;
  insert into public.finance_movements(id,amount,method,category,description,sale_id,principal)
    values('vip:'||new.id,new.amount,new.payment_method,'Crediário VIP','Recebimento de entrada/parcela VIP',s,true);
  return new;
end $$;
create trigger finance_vip_journal after insert on public.receivable_payments for each row execute function private.finance_vip_journal();

-- Payments remain historical. Displayed received totals are allocated from the
-- actual receipt/refund journal, capped to the remaining sale after a return.
create or replace function private.refresh_vip_received(p_sale_id text,p_cart_id text) returns void
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare a text; paid numeric; total numeric; running numeric:=0; allocated numeric:=0; next_amount numeric; v_sale record;
begin
  perform private.finance_admin();
  select coalesce(cart_id,id) into a from public.sales where id=p_sale_id;
  select coalesce(sum(m.amount),0) into paid from public.finance_movements m join public.sales s on s.id=m.sale_id
    where coalesce(s.cart_id,s.id)=a and m.principal;
  select coalesce(sum(s.total),0) into total from public.sales s where coalesce(s.cart_id,s.id)=a;
  paid:=least(greatest(paid,0),total);
  for v_sale in select * from public.sales where coalesce(cart_id,id)=a order by id loop
    running:=running+v_sale.total; next_amount:=case when total>0 then round(paid*running/total,2) else 0 end;
    update public.sales set received_amount=next_amount-allocated,
      received_status=case when status='Cancelada' then 'Cancelada' when next_amount-allocated>=v_sale.total then 'Recebido' when next_amount-allocated>0 then 'Parcial' else 'Pendente' end where id=v_sale.id;
    allocated:=next_amount;
  end loop;
end $$;

-- Reconcile one customer account after an audited correction. Decreases reduce
-- the latest unpaid installments first; paid history is never rewritten.
create function private.finance_reconcile(p_account text,p_due date default null) returns void
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare total numeric; paid numeric; outstanding numeric; scheduled numeric; reduction numeric; take numeric;
  first_id text; payment text; fee numeric; v_installment record; seq integer; cart text; v_sale record;
begin
  select min(id),sum(s.total),min(s.payment),sum(processing_fee_amount) into first_id,total,payment,fee from public.sales s where coalesce(cart_id,id)=p_account;
  select coalesce(sum(m.amount),0) into paid from public.finance_movements m join public.sales s on s.id=m.sale_id where coalesce(s.cart_id,s.id)=p_account and m.principal;
  outstanding:=round(total-paid,2);
  update public.finance_pending f set status='Substituído',resolved_at=now() where status='Pendente' and kind in ('card','customer') and sale_id in (select id from public.sales where coalesce(cart_id,id)=p_account);
  if payment='Crediário VIP' then
    select coalesce(sum(r.amount-r.paid_amount),0) into scheduled from public.receivable_installments r join public.sales s on s.id=r.sale_id where coalesce(s.cart_id,s.id)=p_account;
    reduction:=scheduled-greatest(outstanding,0);
    if reduction>0 then
      for v_installment in select r.* from public.receivable_installments r join public.sales s on s.id=r.sale_id where coalesce(s.cart_id,s.id)=p_account and r.amount>r.paid_amount order by r.due_date desc,r.installment_number desc for update of r loop
        take:=least(reduction,v_installment.amount-v_installment.paid_amount);
        update public.receivable_installments set amount=amount-take,status=case when amount-take=0 then 'Cancelado' when amount-take=paid_amount then 'Pago' else 'Pendente' end where id=v_installment.id;
        reduction:=reduction-take; exit when reduction<=0;
      end loop;
    elsif reduction<0 then
      if p_due is null or p_due<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe o vencimento da diferença do crediário.' using errcode='22023'; end if;
      select max(r.installment_number)+1 into seq from public.receivable_installments r join public.sales s on s.id=r.sale_id where coalesce(s.cart_id,s.id)=p_account;
      select cart_id into cart from public.sales where id=first_id;
      insert into public.receivable_installments(sale_id,cart_id,installment_number,installment_count,due_date,amount)
        values(first_id,cart,coalesce(seq,1),coalesce(seq,1),p_due,-reduction);
    end if;
  end if;
  if outstanding<0 or (outstanding>0 and payment<>'Crediário VIP') then
    insert into public.finance_pending(sale_id,kind,amount,expected_fee,description)
    values(first_id,case when outstanding>0 and payment in ('Débito','Crédito à vista','Crédito parcelado') and paid=0 then 'card' else 'customer' end,
      outstanding,case when outstanding>0 and paid=0 then fee else 0 end,
      case when outstanding<0 then 'Devolver ao cliente após ajuste' when payment in ('Débito','Crédito à vista','Crédito parcelado') and paid=0 then 'Confirmar recebimento do cartão' else 'Receber diferença do cliente' end);
  end if;
  for v_sale in select * from public.sales where coalesce(cart_id,id)=p_account loop
    update public.finance_pending set status='Substituído',resolved_at=now() where sale_id=v_sale.id and kind='owner' and status='Pendente';
    if v_sale.repasse_paid_amount>v_sale.repasse then
      insert into public.finance_pending(sale_id,kind,amount,description) values(v_sale.id,'owner',v_sale.repasse_paid_amount-v_sale.repasse,'Recuperar repasse: '||coalesce(v_sale.owner_name,''));
    end if;
    update public.sales set repasse_status=case when mode<>'consignado' then 'Não aplicável' when repasse<=repasse_paid_amount then 'Pago' else 'Pendente' end where id=v_sale.id;
  end loop;
  perform private.refresh_vip_received(first_id,null);
end $$;

create function private.finance_change_sale_impl(p_id uuid,p_sale_id text,p_revision integer,p_action text,p_data jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare s public.sales%rowtype; n public.sales%rowtype; p public.products%rowtype; a text;
  returned integer:=0; remaining integer; unit numeric; new_total numeric; snapshot jsonb; new_id text;
begin
  perform private.finance_admin(true); perform private.finance_day_open();
  if p_id is null or length(trim(coalesce(p_reason,'')))<5 or p_action is null or p_action not in ('price','return','cancel','exchange') then raise exception 'Informe uma ação e um motivo com pelo menos 5 caracteres.' using errcode='22023'; end if;
  select coalesce(cart_id,id) into a from public.sales where id=p_sale_id;
  if a is null then raise exception 'Venda não encontrada.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vip-receipt:'||a,0));
  if exists(select 1 from public.finance_events where id='change:'||p_id) then
    if not exists(select 1 from public.finance_events where id='change:'||p_id and sale_id=p_sale_id and after_data->'request'=jsonb_build_object('action',p_action,'data',p_data,'reason',p_reason)) then raise exception 'Esta solicitação já foi aplicada com outros dados. Atualize a venda.' using errcode='22023'; end if;
    return jsonb_build_object('status','already_applied');
  end if;
  select * into s from public.sales where id=p_sale_id for update;
  if s.revision is distinct from p_revision or s.status='Cancelada' then raise exception 'A venda mudou. Sincronize e confira novamente.' using errcode='22023'; end if;
  select jsonb_build_object('sale',to_jsonb(s),'schedule',coalesce(jsonb_agg(r) filter(where r.id is not null),'[]')) into snapshot
    from public.receivable_installments r where r.sale_id in (select id from public.sales where coalesce(cart_id,id)=a);
  remaining:=s.qty; unit:=s.unit_price;
  if p_action='price' then
    unit:=(p_data->>'unit_price')::numeric;
    if unit is null or unit<=0 or unit<>round(unit,2) or unit::text in ('NaN','Infinity','-Infinity') then raise exception 'Preço unitário inválido.' using errcode='22023'; end if;
  else
    returned:=case when p_action='cancel' then s.qty else (p_data->>'qty')::integer end;
    if returned is null or returned<1 or returned>s.qty then raise exception 'Quantidade devolvida inválida.' using errcode='22023'; end if;
    remaining:=s.qty-returned;
    if coalesce((p_data->>'restock')::boolean,false) then
      if s.product_id is null then raise exception 'Produto original não existe mais para reposição.' using errcode='22023'; end if;
      update public.products set qty=qty+returned where id=s.product_id;
      insert into public.inventory_movements(product_id,sku,movement_type,qty_delta,reference_type,reference_id,note)
        values(s.product_id,s.sku,'ajuste',returned,'correcao_venda',p_id::text,p_reason);
    end if;
  end if;
  new_total:=round(remaining*unit,2);
  update public.sales set qty=remaining,unit_price=unit,total=new_total,received_amount=least(received_amount,new_total),
    repasse=round(s.repasse*remaining/s.qty,2),commission=round(s.commission*remaining/s.qty,2),cost_total=round(s.cost_total*remaining/s.qty,2),
    processing_fee_amount=round(new_total*s.processing_fee_rate,2),net_amount=new_total-round(new_total*s.processing_fee_rate,2),
    result=new_total-round(s.repasse*remaining/s.qty,2)-round(s.cost_total*remaining/s.qty,2)-round(new_total*s.processing_fee_rate,2),
    discount_amount=greatest(0,round(coalesce(list_unit_price,unit_price)*remaining-new_total,2)),
    discount_percent=case when coalesce(list_unit_price,unit_price)>0 then greatest(0,round((1-unit/coalesce(list_unit_price,unit_price))*100,2)) else 0 end,
    status=case when remaining=0 then 'Cancelada' else 'Ativa' end,revision=revision+1 where id=s.id returning * into n;
  if p_action='exchange' then
    select * into p from public.products where id=p_data->>'product_id' and active and not is_donation for update;
    if not found or coalesce((p_data->>'new_qty')::integer,0)<1 or p.qty<(p_data->>'new_qty')::integer then raise exception 'Confira o produto da troca e o estoque disponível.' using errcode='22023'; end if;
    new_id:='exchange:'||p_id; unit:=(p_data->>'new_unit_price')::numeric;
    if unit is null or unit<=0 or unit<>round(unit,2) or unit::text in ('NaN','Infinity','-Infinity') then raise exception 'Preço da troca inválido.' using errcode='22023'; end if;
    perform set_config('tdt.exchange','yes',true); perform set_config('tdt.change_reason',p_reason,true);
    -- Existing registration enforces reservations, stock locks, fees and consignor rules.
    perform private.register_sale_atomic_impl(new_id,p.id,(p_data->>'new_qty')::integer,unit,s.payment,s.channel,s.customer_type,s.purchase_profile,
      s.installments,coalesce((p_data->>'due_date')::date,(now() at time zone 'America/Sao_Paulo')::date),s.card_brand,coalesce(s.receiving_plan,'one_day'),coalesce(s.rate_tier,'up_to_20'));
    update public.sales set cart_id=a,customer_name=s.customer_name,customer_phone=s.customer_phone where id=new_id;
    if s.payment='Crediário VIP' then delete from public.receivable_installments where sale_id=new_id; end if;
    perform set_config('tdt.exchange','',true); perform set_config('tdt.change_reason','',true);
  end if;
  perform private.finance_reconcile(a,(p_data->>'due_date')::date);
  insert into public.finance_events(id,action,reason,sale_id,before_data,after_data,sales_delta,cost_delta,repasse_delta,qty_delta)
    values('change:'||p_id,case p_action when 'price' then 'Correção de preço' when 'return' then 'Devolução' when 'cancel' then 'Cancelamento' else 'Troca' end,p_reason,s.id,snapshot,
      jsonb_build_object('request',jsonb_build_object('action',p_action,'data',p_data,'reason',p_reason),'sale',(select to_jsonb(x) from public.sales x where id=s.id),'replacement_id',new_id,'restock',coalesce((p_data->>'restock')::boolean,false),
      'schedule',(select coalesce(jsonb_agg(r),'[]') from public.receivable_installments r join public.sales x on x.id=r.sale_id where coalesce(x.cart_id,x.id)=a)),
      n.total-s.total,n.cost_total-s.cost_total,n.repasse-s.repasse,n.qty-s.qty);
  return jsonb_build_object('status','applied','replacement_id',new_id);
end $$;

create function private.finance_settle_impl(p_id uuid,p_pending uuid,p_method text,p_net numeric,p_reason text,p_record_only boolean default false) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare f public.finance_pending%rowtype; a text; fee numeric:=0;
begin
  perform private.finance_admin(true); perform private.finance_day_open();
  if p_id is null or p_method is null or p_method not in ('Pix','Dinheiro','Transferência','Outro','Não informado') or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Confira a forma e o motivo da regularização.' using errcode='22023'; end if;
  select coalesce(s.cart_id,s.id) into a from public.finance_pending f join public.sales s on s.id=f.sale_id where f.id=p_pending;
  perform pg_advisory_xact_lock(hashtextextended('vip-receipt:'||a,0));
  if exists(select 1 from public.finance_movements where id='settle:'||p_id) then
    if not exists(select 1 from public.finance_movements where id='settle:'||p_id and metadata->>'pending_id'=p_pending::text and method=p_method and description=p_reason and nullif(metadata->'request_net','null'::jsonb) is not distinct from to_jsonb(p_net) and (metadata->>'record_only')::boolean is not distinct from p_record_only) then raise exception 'Solicitação já usada com outros dados.' using errcode='22023'; end if;
    return jsonb_build_object('status','already_settled');
  end if;
  select * into f from public.finance_pending where id=p_pending for update;
  if not found or f.status<>'Pendente' then raise exception 'Pendência já resolvida ou alterada. Atualize a tela.' using errcode='22023'; end if;
  if f.kind='card' then
    if p_record_only or p_net is null or p_net<0 or p_net>f.amount or p_net<>round(p_net,2) or p_net::text in ('NaN','Infinity','-Infinity') then raise exception 'Informe o valor líquido que realmente entrou no banco.' using errcode='22023'; end if;
    fee:=f.amount-p_net;
  end if;
  insert into public.finance_movements(id,amount,method,category,description,sale_id,principal,metadata)
  values('settle:'||p_id,f.amount,p_method,case when p_record_only then 'Correção de registro' when f.kind='owner' then 'Recuperação de repasse' when f.kind='card' then 'Recebimento de cartão' when f.amount<0 then 'Devolução ao cliente' else 'Diferença recebida' end,
    p_reason,f.sale_id,f.kind<>'owner',jsonb_build_object('pending_id',p_pending,'record_only',p_record_only,'request_net',p_net));
  if fee>0 then insert into public.finance_movements(id,amount,method,category,description,sale_id)
    values('fee:'||p_id,-fee,p_method,'Taxa de cartão','Taxa efetiva informada na confirmação do recebimento',f.sale_id); end if;
  update public.finance_pending set status='Resolvido',resolved_at=now(),resolution=jsonb_build_object('request_id',p_id,'method',p_method,'net',p_net,'reason',p_reason,'record_only',p_record_only) where id=f.id;
  if f.kind='owner' then update public.sales set repasse_paid_amount=greatest(0,repasse_paid_amount-f.amount) where id=f.sale_id; end if;
  perform private.refresh_vip_received(f.sale_id,null);
  return jsonb_build_object('status','settled');
end $$;

create or replace function private.save_cash_impl(p_cash jsonb) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare r public.cash%rowtype; v_id text:=p_cash->>'id'; v numeric:=(p_cash->>'value')::numeric; method text:=p_cash->>'method'; category text:=p_cash->>'category';
begin
  perform private.finance_admin(true); perform private.finance_day_open();
  if coalesce(v_id,'')='' or p_cash->>'type' is null or p_cash->>'type' not in ('entrada','saida') or v is null or v<=0 or v<>round(v,2) or v::text in ('NaN','Infinity','-Infinity') or length(trim(coalesce(p_cash->>'description','')))<3
    or method is null or method not in ('Pix','Dinheiro','Transferência','Outro','Não informado') or coalesce(category,'')='' then raise exception 'Confira o valor, a categoria, a forma e a descrição.' using errcode='22023'; end if;
  select * into r from public.cash where id=v_id;
  if found then
    if r.value<>v or r.type<>p_cash->>'type' or r.description<>p_cash->>'description' or not exists(select 1 from public.finance_movements m where m.id='cash:'||v_id and m.method=p_cash->>'method' and m.category=p_cash->>'category') then raise exception 'Identificador já usado para outro lançamento.' using errcode='22023'; end if;
    return to_jsonb(r);
  end if;
  insert into public.cash(id,movement_date,type,value,description) values(v_id,now(),p_cash->>'type',v,p_cash->>'description') returning * into r;
  insert into public.finance_movements(id,amount,method,category,description,metadata)
    values('cash:'||v_id,case when r.type='entrada' then v else -v end,method,category,r.description,jsonb_build_object('manual',true));
  return to_jsonb(r);
end $$;
create function private.finance_reverse_impl(p_id uuid,p_movement text,p_reason text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare m public.finance_movements%rowtype;
begin
  perform private.finance_admin(true); perform private.finance_day_open();
  if p_id is null or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo do estorno.' using errcode='22023'; end if;
  select * into m from public.finance_movements where id=p_movement;
  if not found or m.sale_id is not null or m.id not like 'cash:%' then raise exception 'Para movimentos de venda, use a correção no histórico de vendas.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cash-reverse:'||m.id,0));
  if exists(select 1 from public.finance_movements where reversal_of=m.id) then return jsonb_build_object('status','already_reversed'); end if;
  insert into public.finance_movements(id,amount,method,category,description,reversal_of)
    values('reverse:'||p_id,-m.amount,m.method,'Estorno de lançamento',p_reason,m.id);
  return jsonb_build_object('status','reversed');
end $$;

create function private.finance_pay_owner_impl(p_id uuid,p_owner text,p_expected numeric,p_method text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare s record; amount numeric; total numeric;
begin
  perform private.finance_admin(true); perform private.finance_day_open();
  if p_id is null or p_method is null or p_method not in ('Pix','Dinheiro','Transferência','Outro') then raise exception 'Informe a forma do repasse.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('owner:'||p_owner,0));
  if exists(select 1 from public.finance_movements where id like 'owner:'||p_id||':%') then return jsonb_build_object('status','already_paid'); end if;
  perform 1 from public.sales where owner_name=p_owner and mode='consignado' order by id for update;
  select coalesce(sum(greatest(0,repasse-repasse_paid_amount)),0) into total from public.sales where owner_name=p_owner and mode='consignado';
  if total<=0 or total is distinct from p_expected then raise exception 'O valor do repasse mudou. Atualize e confira novamente.' using errcode='22023'; end if;
  for s in select * from public.sales where owner_name=p_owner and mode='consignado' and repasse>repasse_paid_amount order by id loop
    amount:=s.repasse-s.repasse_paid_amount;
    insert into public.finance_movements(id,amount,method,category,description,sale_id) values('owner:'||p_id||':'||s.id,-amount,p_method,'Repasse','Pagamento ao consignante: '||p_owner,s.id);
    update public.sales set repasse_paid_amount=repasse,repasse_status='Pago',repasse_paid_at=now() where id=s.id;
  end loop;
  return jsonb_build_object('status','paid','total',total);
end $$;

create function private.finance_report_impl(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare start_at timestamptz; end_at timestamptz; report jsonb;
begin
  perform private.finance_admin();
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>366 then raise exception 'Selecione um período de até 366 dias.' using errcode='22023'; end if;
  start_at:=p_from::timestamp at time zone 'America/Sao_Paulo'; end_at:=(p_to+1)::timestamp at time zone 'America/Sao_Paulo';
  select jsonb_build_object('from',p_from,'to',p_to,'generated_at',now(),'timezone','America/Sao_Paulo',
    'opening',coalesce(sum(amount) filter(where occurred_at<start_at),0),
    'inflow',coalesce(sum(amount) filter(where occurred_at>=start_at and amount>0),0),
    'outflow',coalesce(-sum(amount) filter(where occurred_at>=start_at and amount<0),0),
    'balance',coalesce(sum(amount),0),
    'cash_opening',coalesce(sum(amount) filter(where occurred_at<start_at and method='Dinheiro'),0),
    'cash_balance',coalesce(sum(amount) filter(where method='Dinheiro'),0),
    'unknown_balance',coalesce(sum(amount) filter(where method in ('Outro','Não informado')),0),
    'movements',coalesce(jsonb_agg(to_jsonb(m) order by occurred_at,id) filter(where occurred_at>=start_at),'[]')) into report
    from public.finance_movements m where occurred_at<end_at;
  select report||jsonb_build_object('sold',coalesce(sum(sales_delta),0),'cost',coalesce(sum(cost_delta),0),'repasse_accrued',coalesce(sum(repasse_delta),0),
    'events',coalesce(jsonb_agg(to_jsonb(e) order by occurred_at,id),'[]')) into report from public.finance_events e where occurred_at>=start_at and occurred_at<end_at;
  select report||jsonb_build_object('methods',coalesce(jsonb_agg(x),'[]')) into report from (
    select method,sum(amount) filter(where amount>0) as inflow,-sum(amount) filter(where amount<0) as outflow,sum(amount) as net
      from public.finance_movements where occurred_at>=start_at and occurred_at<end_at group by method order by method)x;
  select report||jsonb_build_object('pending',coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('product_name',s.product_name,'customer_name',s.customer_name,'payment',s.payment) order by f.created_at,f.id),'[]')) into report
    from public.finance_pending f join public.sales s on s.id=f.sale_id where f.status='Pendente';
  select report||jsonb_build_object('vip_pending',coalesce(sum(amount-paid_amount),0),'vip_installments',coalesce(jsonb_agg(to_jsonb(r) order by due_date,id) filter(where amount>paid_amount),'[]')) into report from public.receivable_installments r;
  select report||jsonb_build_object('owner_pending',coalesce(sum(greatest(0,repasse-repasse_paid_amount)),0)) into report from public.sales;
  select report||jsonb_build_object('closures',coalesce(jsonb_agg(to_jsonb(c)-'snapshot' order by day,revision),'[]')) into report from public.cash_closures c where day between p_from and p_to;
  -- The token excludes the clock but includes obligations and events, detecting
  -- a sale/payment that arrives while the administrator is counting the drawer.
  return report||jsonb_build_object('token',md5((report-'generated_at')::text));
end $$;

create function private.finance_close_impl(p_id uuid,p_day date,p_counted numeric,p_note text,p_token text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare report jsonb; row public.cash_closures%rowtype; diff numeric; rev integer;
begin
  perform private.finance_admin(true);
  if p_id is null or p_day is null or p_day>(now() at time zone 'America/Sao_Paulo')::date or p_counted is null or p_counted<0 or p_counted<>round(p_counted,2) or p_counted::text in ('NaN','Infinity','-Infinity') then raise exception 'Confira a data e o dinheiro contado.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finance-day:'||p_day,0));
  select * into row from public.cash_closures where id=p_id;
  if found then return to_jsonb(row); end if;
  if exists(select 1 from public.cash_closures where day=p_day and reopened_at is null) then raise exception 'Este dia já está fechado.' using errcode='22023'; end if;
  report:=private.finance_report_impl(p_day,p_day);
  if report->>'token' is distinct from p_token then raise exception 'Houve movimentação enquanto você conferia. Atualize o caixa e confira novamente.' using errcode='22023'; end if;
  diff:=p_counted-(report->>'cash_balance')::numeric;
  if diff<>0 and length(trim(coalesce(p_note,'')))<5 then raise exception 'Explique a diferença entre o dinheiro contado e o esperado.' using errcode='22023'; end if;
  select coalesce(max(revision),0)+1 into rev from public.cash_closures where day=p_day;
  insert into public.cash_closures(id,day,revision,snapshot,counted_cash,difference,note)
    values(p_id,p_day,rev,report,p_counted,diff,coalesce(p_note,'')) returning * into row;
  return to_jsonb(row);
end $$;
create function private.finance_reopen_impl(p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare row public.cash_closures%rowtype;
begin
  perform private.finance_admin(true);
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo da reabertura.' using errcode='22023'; end if;
  select * into row from public.cash_closures where id=p_id;
  if not found then raise exception 'Fechamento não encontrado.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finance-day:'||row.day,0));
  update public.cash_closures set reopened_at=now(),reopened_by=auth.uid(),reopen_reason=p_reason where id=p_id and reopened_at is null returning * into row;
  return jsonb_build_object('status','reopened');
end $$;

create function private.operational_snapshot_impl() returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','private' as $$
#variable_conflict use_column
declare result jsonb;
begin
  perform private.finance_admin();
  select jsonb_build_object('products',(select coalesce(jsonb_agg(p),'[]') from public.products p),
    'sales',(select coalesce(jsonb_agg(s),'[]') from public.sales s),
    'cash',(select coalesce(jsonb_agg(c),'[]') from public.cash c),
    'finance',jsonb_build_object('balance',(select coalesce(sum(amount),0) from public.finance_movements),
      'physical',(select coalesce(sum(amount),0) from public.finance_movements where method='Dinheiro'),
      'vip_pending',(select coalesce(sum(amount-paid_amount),0) from public.receivable_installments),
      'card_pending',(select coalesce(sum(amount-expected_fee),0) from public.finance_pending where kind='card' and status='Pendente'),
      'refund_pending',(select coalesce(-sum(amount),0) from public.finance_pending where kind='customer' and amount<0 and status='Pendente'),
      'recorded_at',now())) into result;
  return result;
end $$;

-- Consistent administrative export; contains no authentication secrets.
create function private.finance_export_impl() returns jsonb language plpgsql stable security definer
set search_path='pg_catalog','public','private' as $$
begin
  perform private.finance_admin();
  return jsonb_build_object('version',2,'exported_at',now(),'source','Tudo & Tal servidor',
    'products',(select coalesce(jsonb_agg(t),'[]') from public.products t),
    'sales',(select coalesce(jsonb_agg(t),'[]') from public.sales t),
    'cash',(select coalesce(jsonb_agg(t),'[]') from public.cash t),
    'inventory_movements',(select coalesce(jsonb_agg(t),'[]') from public.inventory_movements t),
    'receivable_installments',(select coalesce(jsonb_agg(t),'[]') from public.receivable_installments t),
    'receivable_payments',(select coalesce(jsonb_agg(t),'[]') from public.receivable_payments t),
    'finance_movements',(select coalesce(jsonb_agg(t),'[]') from public.finance_movements t),
    'finance_events',(select coalesce(jsonb_agg(t),'[]') from public.finance_events t),
    'finance_pending',(select coalesce(jsonb_agg(t),'[]') from public.finance_pending t),
    'cash_closures',(select coalesce(jsonb_agg(t),'[]') from public.cash_closures t),
    'partners',(select coalesce(jsonb_agg(t),'[]') from public.partners t),
    'catalog_orders',(select coalesce(jsonb_agg(t),'[]') from public.catalog_orders t),
    'catalog_order_items',(select coalesce(jsonb_agg(t),'[]') from public.catalog_order_items t),
    'catalog_waitlist',(select coalesce(jsonb_agg(t),'[]') from public.catalog_waitlist t),
    'catalog_config',(select coalesce(jsonb_agg(t),'[]') from public.catalog_config t));
end $$;

-- Direct client edits/deletes and the old overwrite-style backup route would
-- bypass the journal. Existing server-side sale and receipt routines still work.
revoke insert,update,delete on public.sales,public.cash,public.receivable_installments,public.receivable_payments from authenticated,anon;
revoke execute on function public.restore_sale_backup(jsonb) from authenticated,anon,public;

create function public.finance_export() returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.finance_export_impl(); $$;
create function public.finance_report(p_from date,p_to date) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.finance_report_impl(p_from,p_to); $$;
create function public.finance_change_sale(p_id uuid,p_sale_id text,p_revision integer,p_action text,p_data jsonb,p_reason text) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.finance_change_sale_impl(p_id,p_sale_id,p_revision,p_action,p_data,p_reason); $$;
create function public.finance_settle(p_id uuid,p_pending uuid,p_method text,p_net numeric,p_reason text,p_record_only boolean default false) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.finance_settle_impl(p_id,p_pending,p_method,p_net,p_reason,p_record_only); $$;
create function public.finance_reverse(p_id uuid,p_movement text,p_reason text) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.finance_reverse_impl(p_id,p_movement,p_reason); $$;
create function public.finance_pay_owner(p_id uuid,p_owner text,p_expected numeric,p_method text) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.finance_pay_owner_impl(p_id,p_owner,p_expected,p_method); $$;
create function public.finance_close(p_id uuid,p_day date,p_counted numeric,p_note text,p_token text) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.finance_close_impl(p_id,p_day,p_counted,p_note,p_token); $$;
create function public.finance_reopen(p_id uuid,p_reason text) returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.finance_reopen_impl(p_id,p_reason); $$;
create function public.operational_snapshot() returns jsonb language sql security invoker set search_path='pg_catalog','public','private' as $$ select private.operational_snapshot_impl(); $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and (p.proname like 'finance_%' or p.proname in ('operational_snapshot','operational_snapshot_impl')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.nspname='public' or f.proname like '%_impl' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end $$;
notify pgrst,'reload schema';
