# Cadastro, exclusão e custos de gateways

Esta atualização pertence ao checkout/funil BRAVUS e Bio Camisas. A configuração continua compartilhada pelos dois domínios. Não altera comissões, custos ADS ou tarifas do portal dos atendentes/parceiros da Vercel.

## Integrar com facilidade

1. Abra `/admin/gateways` e desbloqueie com a senha atual.
2. Clique em **+ Adicionar gateway**.
3. Escolha Atlas Pags, BuckPay, Beehive Pay, Eleva Payments, Gestão Pay, Firebot ou Poseidon. O formulário mostra apenas os campos daquela integração.
4. Cole as credenciais. As chaves ficam protegidas no cofre do servidor e não são exibidas após salvar. Na edição, use uma chave da mesma conta para manter acesso às cobranças antigas.
5. Opcionalmente, marque **Informar custo agora** e preencha percentual, custo fixo por venda e arredondamento.
6. Escolha **Usar esta gateway como padrão ao concluir** para ativá-la imediatamente. Se já existe uma integração disponível, essa opção começa desmarcada. O cadastro preserva a seleção atual, inclusive instalações antigas em que a gateway era escolhida automaticamente pela ordem das credenciais. Na primeira integração disponível, a opção fica marcada.
7. Clique em **Salvar integração**. Também pode ativar depois em **Usar [gateway]**, ou incluí-la nas faixas de ticket e na ordem das reservas.

As validações existentes dos provedores são reutilizadas. O cadastro não cria uma cobrança de teste. BuckPay confere o formato do token/User-Agent; as demais plataformas fazem a consulta de validação já implementada. Isso não substitui a conferência privada das permissões de produção da conta.

**Editar integração** abre o mesmo formulário. Os links de configurações avançadas continuam disponíveis para dados de compradores e webhook. Uma chave pública Beehive omitida no cadastro guiado e um segredo de webhook Atlas vazio preservam o valor existente.

O catálogo oferece os sete conectores implementados. Um novo provedor com outra API ainda precisa de um conector específico; o formulário não presume endpoints nem compatibilidade por nome.

## Excluir uma gateway

Nos cartões de **Minhas gateways**, use **Excluir [nome]** e confirme. Se ela está em uso e há outra disponível, escolha qual receberá os novos pagamentos. Se for a única disponível, a confirmação informa que novos pagamentos ficarão desativados até uma integração ser ativada.

A exclusão:

- retira a gateway da lista principal, de novas cobranças, das faixas de ticket e da ordem do fallback;
- desativa o fallback se sobrarem menos de duas opções e desativa faixas vazias;
- preserva as chaves criptografadas, o custo informado e o histórico para consultar e recuperar as cobranças antigas;
- impede a criação de uma cobrança nova na gateway excluída inclusive se a exclusão coincidir com outra requisição;
- atualiza seleção, regras e estado da integração atomicamente, sem sobrescrever uma decisão mais recente de outro acesso ao painel.

Abra **Gateways excluídas** para restaurar uma integração. Restaurar não ativa a gateway nem recoloca suas antigas regras. Use **Usar [nome]** ou configure novas regras para voltar a receber. Se o checkout estava desativado pela exclusão da última gateway, ele permanece assim até essa ativação explícita.

## Informar o custo de cada gateway

Em cada cartão, abra **Informar meu custo** ou **Editar custo**:

- **Custo percentual (%)**: por exemplo `5,99`.
- **Custo fixo por venda (R$)**: por exemplo `1,99`.
- **Arredondamento do percentual**: centavo mais próximo ou sempre para cima, conforme o contrato da gateway.

O painel mostra o exemplo de uma venda de R$ 100,00. Com 5,99% + R$ 1,99, o custo é **R$ 7,98** e o líquido é **R$ 92,02**. Ambos os campos podem ser zero para uma tarifa explicitamente gratuita. Campo não informado é diferente de tarifa zero.

O custo é calculado **em cada transação**, em centavos. Em cinco vendas de R$ 100,00, o custo fixo é cobrado cinco vezes. Com 5,99% + R$ 1,99, são **R$ 39,90** de custo no total e **R$ 460,10** líquidos.

Uma foto da tarifa é registrada na mesma transação do banco que cria a cobrança, antes de enviá-la ao provedor. Alterar o custo depois vale para novas cobranças. Uma cobrança antiga mantém sua tarifa, inclusive após recarga, recuperação, troca/exclusão de gateway e alteração de credenciais. PIX e cartão Beehive usam o perfil de custo da Beehive.

## Relatório de custos

**Custos dos pagamentos confirmados** mostra pedidos criados nos últimos 30 dias que já estão pagos, com:

- quantidade de vendas e faturamento;
- custo por gateway;
- líquido após o custo, quando todas as vendas possuem custo conhecido;
- quantidade de vendas sem custo registrado;
- indicação de estimativas calculadas pela tarifa cadastrada.

A tarifa real `fee` retornada pela Atlas, quando disponível, tem prioridade sobre a estimativa. Nenhuma tarifa Atlas é inventada a partir do custo de outro gateway. Vendas antigas de outras plataformas, sem custo registrado, são indicadas como não informadas; a tarifa atual não é aplicada retroativamente. Pagamentos de teste, pendentes, falhos, estornados e contestados não entram no total de pagos.

Os custos ficam no painel privado. Eles não são somados ao PIX do cliente, não criam transferências e não modificam as tarifas dos vendedores/parceiros.

## Publicação e banco

Aplique o ZIP sobre o código atual do checkout, preservando banco D1, bindings, `PAYMENT_VAULT_KEY`, demais segredos e todas as mídias de produção. O pacote também inclui a integração Atlas Pags.

Não há migração manual obrigatória nem nova tabela. As configurações e snapshots usam `payment_settings`; ao salvar o primeiro custo ou excluir uma gateway, o servidor cria os respectivos triggers SQLite idempotentes no D1. Os triggers garantem que a tarifa seja capturada junto com a cobrança e que uma exclusão bloqueie novas criações antes de chamar uma API externa. O histórico não é apagado.

Este repositório contém uma entrega de código. O checkout do ChatGPT/Sites precisa ser atualizado e publicado no projeto original; enviar o ZIP ao GitHub não publica esse outro projeto.
