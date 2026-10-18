-- Explicit deny policies document that only checked SECURITY DEFINER entrypoints access these tables.
create policy no_direct_client_access on private.access_sessions for all to anon,authenticated using (false) with check (false);
create policy no_direct_client_access on private.access_events for all to anon,authenticated using (false) with check (false);
create policy no_direct_client_access on private.seller_slots for all to anon,authenticated using (false) with check (false);
create policy no_direct_client_access on private.seller_requests for all to anon,authenticated using (false) with check (false);
