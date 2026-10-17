# Revisão de segurança e catálogo — 17/10/2026

O Security Advisor foi consultado antes e depois da migração. Resultado: **7 ocorrências resolvidas; 1 pendente por limitação do plano Free**. Não foram apagados produtos, vendas, contatos ou lançamentos financeiros.

## Revisão de cada ocorrência

| Ocorrência | Análise e correção | Resultado |
|---|---|---|
| `anon`: `get_catalog_config()` como SECURITY DEFINER | Leitura pública necessária, sem necessidade de elevação. Convertida para INVOKER, com RLS e permissão de leitura apenas de ID, nome da loja, WhatsApp comercial e prazo de reserva. | Resolvida |
| `anon`: `get_catalog_products()` como SECURITY DEFINER | A API antiga agora usa a mesma projeção controlada do catálogo atual. A implementação privilegiada fica no esquema privado; não retorna custo, consignante ou contatos. A tabela de produtos continua inacessível ao visitante. | Resolvida |
| `authenticated`: `get_catalog_config()` como SECURITY DEFINER | Mesma correção de leitura pública limitada. Autenticar não dá direito de editar a configuração. | Resolvida |
| `authenticated`: `get_catalog_products()` como SECURITY DEFINER | Mesma projeção limitada, mantendo as permissões administrativas separadas. | Resolvida |
| `authenticated`: `update_catalog_config(text,integer)` como SECURITY DEFINER | Convertida para INVOKER. Mantidas a validação de administrador ativo e a RLS administrativa. Visitantes não podem executar. | Resolvida |
| `authenticated`: `update_catalog_order_status(uuid,text)` como SECURITY DEFINER | Convertida para INVOKER. Mantidas a validação de administrador ativo, a RLS, as regras de cancelamento e a reserva de doação de uma hora. | Resolvida |
| `authenticated`: `confirm_catalog_order(...)` como SECURITY DEFINER | Entrada pública INVOKER; transação privilegiada movida para função privada, mantendo administrador ativo, verificação de caixa aberto, atomicidade e idempotência. Execução negada a visitantes; usuário autenticado sem vínculo administrativo também é rejeitado. | Resolvida |
| `auth_leaked_password_protection` | Proteção contra senhas conhecidas em vazamentos desativada. A organização está no Free e o Supabase disponibiliza o recurso a partir do Pro. Não houve alteração de plano ou contratação. | Pendente: recurso pago |

Referências de correção do Supabase:

- [Funções SECURITY DEFINER acessíveis a visitantes](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Funções SECURITY DEFINER acessíveis a usuários autenticados](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Proteção contra senhas vazadas e disponibilidade por plano](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## Regra de vestuário e brechó

- Peças sem unidades disponíveis deixam de aparecer no catálogo, inclusive em Todos, busca, filtros e API antiga.
- A regra também cobre as categorias antigas de vestuário, bolsas e calçados e as doações.
- Reservar a última unidade oculta a peça temporariamente. Cancelamento ou expiração libera a disponibilidade. A reserva de doação permanece em uma hora.
- Uma peça efetivamente vendida permanece oculta enquanto o estoque for zero. Cadastro, estoque interno e histórico são preservados.
- Não existe lista de reposição para essas peças: tentativa pelo formulário, RPC ou INSERT direto é bloqueada.
- Os demais grupos mantêm produtos esgotados e a lista de interesse.

## Validação

Testes com dados sintéticos em PostgreSQL descartável (PGlite), sem inserir vendas de teste na loja:

- Visitante, usuário autenticado sem vínculo administrativo e administrador ativo.
- Tentativa de obter administração por `user_metadata`, rejeitada.
- Leitura pública limitada, bloqueio de contatos e dados internos, bloqueio de alterações administrativas sem autorização.
- Bloqueio da lista de espera de peças únicas via RPC e INSERT direto, mantendo a lista dos outros grupos.
- Cadastro com estoque zero, reserva da última unidade, cancelamento, expiração, retirada gratuita, venda e reenvio idempotente.
- Venda, estoque e caixa sincronizados, sem duplicar receita na confirmação repetida.
- Regressões de crediário flexível, entrada e pagamentos parciais, estornos, trocas, cartões, consignação, reautenticação, fechamento e permissões financeiras.
- Interface: filtros, busca, Todos, interesse, doação, fotos, edição do estoque, caixa e seleção de relatórios/PDF.

Comandos executados com sucesso:

```sh
node tests/financial-control.local.mjs
node tests/wardrobe-donations.logic.cjs
node tests/waitlist.logic.cjs
node tests/financial-ui.cjs
node tests/flexible-vip.logic.cjs
node tests/product-photos.logic.cjs
```

Após aplicar a migração em produção: nenhuma tabela pública sem RLS; nenhuma das cinco RPCs revisadas com SECURITY DEFINER; visitantes sem acesso às tabelas de produtos e pedidos ou às funções de confirmação. Os totais de cadastros, vendas e movimentos financeiros permaneceram iguais aos anteriores à migração. O Security Advisor retornou somente o aviso de senhas vazadas.

Esta revisão cobre os avisos listados e os fluxos testados; não equivale a uma auditoria integral de todos os componentes do serviço.
