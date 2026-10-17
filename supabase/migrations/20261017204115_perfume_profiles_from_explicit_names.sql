-- Preenche apenas perfis que já estão explícitos no nome cadastrado pelo lojista.
-- Não sobrepõe uma escolha manual nem deduz o perfil pela marca ou pelas notas.
with matches as (
  select id,name,
    name ~* '(^|[^[:alpha:]])(masculin[oa]|pour[[:space:]]+homme)([^[:alpha:]]|$)' as male,
    name ~* '(^|[^[:alpha:]])(fem[ei]nin[oa]|pour[[:space:]]+femme)([^[:alpha:]]|$)' as female,
    name ~* '(^|[^[:alpha:]])unis{1,2}ex([^[:alpha:]]|$)' as unisex
  from public.products
  where lower(btrim(category))='perfumes' and gender is null
), classified as (
  select id,name,case when male then 'masculino' when female then 'feminino' else 'unissex' end as profile
  from matches where male::integer+female::integer+unisex::integer=1
)
update public.products p set gender=c.profile,updated_at=now()
from classified c
where p.id=c.id and p.name=c.name and lower(btrim(p.category))='perfumes' and p.gender is null;
