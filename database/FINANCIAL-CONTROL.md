# Operação do caixa

O Caixa distingue vendas, recebimentos confirmados e valores a receber/devolver. Pix e transferências não fazem parte do dinheiro físico da gaveta. Cartões ficam pendentes até a confirmação do líquido no extrato; o aplicativo não consulta nem movimenta a maquininha ou a conta bancária.

## Uso

- **Vender → Histórico de vendas**: corrigir preço, devolver quantidades, cancelar um item ou trocar por outro produto. Informe o motivo. Marque a reposição ao estoque apenas quando a peça estiver disponível para venda. Uma compra com vários itens mantém cada item identificado.
- **Caixa → Pendências**: confirmar cartão ou registrar a devolução/recebimento de uma diferença. Confirme dinheiro apenas quando a operação tiver ocorrido. A alternativa “Correção do registro” identifica um lançamento incorreto que está sendo regularizado.
- **Caixa → Registrar entrada ou saída**: despesas, compra de estoque, aportes e retiradas. Vendas, pagamentos VIP e repasses confirmados já geram os próprios movimentos.
- **Caixa → Conferir e fechar dia**: contar somente o dinheiro físico. A diferença fica na conferência e não altera automaticamente o saldo. O dia fechado bloqueia novas operações financeiras nessa data. Reabrir exige motivo e preserva o fechamento anterior.
- **Caixa → Diário / Semanal / Mensal → Baixar relatório PDF**: movimentos e ajustes por período, no horário de Brasília. Um dia fechado usa a fotografia salva no fechamento. Semana e mês consolidam os lançamentos sem duplicá-los.
- **Ajustes → Exportar backup**: exportação completa do servidor, inclusive histórico financeiro e parcelas. Recuperação por substituição foi desativada para não sobrescrever pagamentos e auditoria.

As operações sensíveis pedem a senha da própria conta administradora. O servidor exige autenticação por senha recente (até cinco minutos); não existe PIN compartilhado no código.

## Implantação e conferência inicial

Aplicar juntos, em uma transação: `financial_control.sql`, `financial_entrypoints.sql` e `financial_catalog_entrypoint.sql`. Aplicar `donation_one_hour.sql` em seguida. Publicar o aplicativo e o catálogo com suas novas versões de cache. Não executar a implantação duas vezes: o registro de migrações é a referência.

O histórico anterior é copiado com identificadores estáveis. Vendas em cartão não são presumidas recebidas. Repasses e lançamentos antigos sem forma registrada ficam como “Não informado”. Na primeira conferência, comparar o saldo registrado com o valor real por forma. Registrar apenas eventual diferença justificada, sem lançar novamente todas as vendas existentes.

Os ajustes usam a data atual, mantendo os fechamentos passados. O painel de análise de vendas mostra os valores atuais dos itens após as correções; os relatórios do Caixa mostram quando cada venda e ajuste foi registrado. Taxas nesse painel são estimativas; o Caixa registra a taxa efetiva informada na confirmação do cartão.

Reserva de doação dura no máximo uma hora desde sua criação, inclusive ao alterar o atendimento. Expiração libera disponibilidade. A retirada gratuita baixa estoque sem criar receita.

## Verificação reproduzível

Requer Node 20 ou superior. `npm ci --prefix tests` instala dependências fixadas. `node tests/financial-control.local.mjs` executa o PostgreSQL local descartável com esquema vazio e dados sintéticos. Nunca enviar os arquivos de `tests/fixtures` à produção.

`node tests/financial-ui.cjs` verifica o HTML e os fluxos com respostas sintéticas, incluindo senha inválida e válida. Os arquivos `tests/*.logic.cjs` cobrem catálogo, fotos, estoque, doação, lista de espera e crediário. A validação local não faz transações em contas reais.
