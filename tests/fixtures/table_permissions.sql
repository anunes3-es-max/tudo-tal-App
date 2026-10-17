-- Test-only table permissions for the pre-migration schema.
revoke all on table public.app_members from public,anon,authenticated;
grant select on table public.app_members to authenticated;
revoke all on table public.cash from public,anon,authenticated;
grant delete,select on table public.cash to authenticated;
revoke all on table public.catalog_config from public,anon,authenticated;
grant delete,insert,select,update on table public.catalog_config to authenticated;
revoke all on table public.catalog_order_items from public,anon,authenticated;
grant delete,insert,select,update on table public.catalog_order_items to authenticated;
revoke all on table public.catalog_orders from public,anon,authenticated;
grant delete,insert,select,update on table public.catalog_orders to authenticated;
revoke all on table public.catalog_waitlist from public,anon,authenticated;
grant select on table public.catalog_waitlist to authenticated;
revoke all on table public.infinitypay_rates from public,anon,authenticated;
grant delete,insert,select,update on table public.infinitypay_rates to authenticated;
revoke all on table public.inventory_movements from public,anon,authenticated;
grant delete,insert,select,update on table public.inventory_movements to authenticated;
revoke all on table public.partners from public,anon,authenticated;
grant delete,insert,select,update on table public.partners to authenticated;
revoke all on table public.products from public,anon,authenticated;
grant delete,select on table public.products to authenticated;
revoke all on table public.receivable_installments from public,anon,authenticated;
grant delete,insert,select,update on table public.receivable_installments to authenticated;
revoke all on table public.receivable_payments from public,anon,authenticated;
grant select on table public.receivable_payments to authenticated;
revoke all on table public.sales from public,anon,authenticated;
grant delete,select,update on table public.sales to authenticated;
revoke all on table public.settings from public,anon,authenticated;
grant delete,insert,select,update on table public.settings to authenticated;

-- Column grants are intentionally narrower than table INSERT/UPDATE.
grant insert(product_id,customer_name,customer_phone) on public.catalog_waitlist to anon,authenticated;
grant update(status,updated_at,notified_at) on public.catalog_waitlist to authenticated;
