# Acessos individuais — 18/10/2026

## Operação

Em Ajustes → Acessos e permissões, as duas vagas começam disponíveis e desativadas. Salve nome/e-mail (telefone opcional), envie o convite, aguarde o primeiro acesso com senha própria e então ative. Suspender bloqueia as sessões; liberar uma vaga preserva a conta antiga e o histórico. Não reutilize a conta de outra pessoa.

Vendedores recebem apenas produtos sem custos/contatos de consignantes e suas próprias vendas. Podem corrigir a sacola antes de finalizar. Descontos extras e alterações de vendas concluídas geram pedidos: o administrador revisa e confirma sua senha para aprovar e executar atomicamente. As vendas mantêm operador e nome, além da trilha de aprovação. Operações administrativas existentes continuam protegidas.

Sessões são verificadas no servidor contra auth.sessions, cadastro ativo, bloqueio, revogação e inatividade de 30 minutos. Eventos de interação renovam atividade; consultas em segundo plano não renovam a sessão. No celular, abrir/retornar exige senha. A troca de conta limpa o cache privado. MFA TOTP é opcional no painel e, uma vez ativado, é exigido também no servidor. Biometria/passkeys não fazem parte desta entrega.

## Implementação

- RPC pública invoker `access_control`, dispatcher privado com autorização por ação.
- Tabelas privadas com RLS e sem acesso direto dos clientes.
- Workers financeiros privados sem EXECUTE para anon/authenticated, derivados dos fluxos atômicos existentes. Nenhuma função is_admin concede direitos de administrador a vendedores.
- Vendas e aprovações idempotentes, conteúdo vinculado ao identificador e revisões de correção preservadas.
- Edge Function `seller-invite` valida usuário, sessão, administrador e senha recente antes de usar o cliente de serviço. Chave privilegiada permanece apenas no servidor.
- Envio de e-mail depende da configuração/limites do Supabase Auth. Não foram enviados convites a endereços reais durante os testes.

## Validação

`node tests/financial-control.local.mjs`: regressão completa de estoque, caixa, VIP, catálogo e doações; isolamento de vendedor, bloqueio dos RPCs antigos e workers, desconto aprovado, correção, duplicação, acesso cruzado, expiração, revogação, onboarding, ativação, suspensão, cartão, parcelas VIP variáveis e MFA. Dados sintéticos em PostgreSQL descartável.

`node tests/access-ui.cjs`: interfaces por perfil, escape de nomes, pesquisa/leitor, sacola, solicitação de venda, parcelas, vagas e bloqueio.

`node tests/financial-ui.cjs`: regressão da interface financeira e confirmação de senha.

Teste em iPhone físico e entrega efetiva de convite dependem do primeiro uso pelos responsáveis. Os testes não representam uma validação de biometria.

Baseline operacional antes da migração: 40 produtos, 41 vendas, 18 movimentos, saldo R$ 3.746,00. Nenhuma limpeza ou venda de teste em produção.
