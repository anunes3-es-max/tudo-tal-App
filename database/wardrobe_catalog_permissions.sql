-- Only the two public catalog implementations are callable by anonymous clients.
-- Keep prior authenticated access when removing inherited PUBLIC grants.
grant execute on function private.active_reserved_qty(text,uuid),private.enforce_catalog_reservations(),
 private.expire_catalog_orders_impl(),private.protect_product_qty_from_direct_sync(),private.save_cash_impl(jsonb)
 to authenticated,service_role;
revoke execute on function private.active_reserved_qty(text,uuid),private.enforce_catalog_reservations(),
 private.expire_catalog_orders_impl(),private.protect_product_qty_from_direct_sync(),private.save_cash_impl(jsonb)
 from public,anon;
grant usage on schema private to anon;

