-- Existing cover photos are preserved. Additional images are loaded on demand.
alter table public.products add column photo_urls jsonb not null default '[]'::jsonb
 check (jsonb_typeof(photo_urls)='array' and jsonb_array_length(photo_urls)<=6);

create function private.save_product_gallery_impl(p_product jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare r jsonb; photos jsonb:=p_product->'photo_urls'; item jsonb;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501';end if;
 if p_product ? 'photo_urls' then
  if jsonb_typeof(photos) is distinct from 'array' then raise exception 'Lista de fotos inválida.' using errcode='22023';end if;
  if jsonb_array_length(photos)>6 or octet_length(photos::text)>6000000 then raise exception 'Use até 6 fotos otimizadas.' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(photos) loop
   if jsonb_typeof(item)<>'string' or octet_length(item#>>'{}')>1500000 or
      (item#>>'{}') !~ '^(https://[^[:space:]]+|data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$' then
    raise exception 'Formato de imagem inválido. Use JPG, PNG ou WebP.' using errcode='22023';
   end if;
  end loop;
  -- A single canonical cover, including explicit removal of every image.
  p_product:=p_product||jsonb_build_object('photo_url',photos->>0);
 end if;
 r:=private.save_product_impl(p_product);
 if p_product ? 'photo_urls' then
  update public.products set photo_urls=photos where id=r->>'id' returning to_jsonb(products.*) into r;
 end if;
 return r;
end $$;
create or replace function public.save_product(p_product jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog,public,private as $$
 select private.save_product_gallery_impl(p_product);
$$;
revoke all on function private.save_product_gallery_impl(jsonb) from public,anon;
grant execute on function private.save_product_gallery_impl(jsonb) to authenticated,service_role;

create function private.get_catalog_product_photos_impl(p_product_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare p public.products%rowtype;
begin
 -- Reuse the exact public visibility rules (including sold unique pieces).
 if not exists(select 1 from private.get_catalog_products_v2_impl() where id=p_product_id) then return '[]'::jsonb;end if;
 select * into p from public.products where id=p_product_id;
 return coalesce((select jsonb_agg(url order by pos) from (
  select url,min(pos) pos from jsonb_array_elements_text(
   case when coalesce(p.photo_url,'')<>'' then jsonb_build_array(p.photo_url) else '[]'::jsonb end || p.photo_urls
  ) with ordinality as photos(url,pos) where url<>'' group by url order by min(pos) limit 6
 ) ordered),'[]'::jsonb);
end $$;
create function public.get_catalog_product_photos(p_product_id text) returns jsonb
language sql security invoker set search_path=pg_catalog,public,private as $$
 select private.get_catalog_product_photos_impl(p_product_id);
$$;
revoke all on function private.get_catalog_product_photos_impl(text),public.get_catalog_product_photos(text) from public;
grant execute on function private.get_catalog_product_photos_impl(text),public.get_catalog_product_photos(text) to anon,authenticated,service_role;
notify pgrst,'reload schema';
