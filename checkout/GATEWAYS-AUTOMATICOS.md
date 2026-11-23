# Gateways por ticket e fallback

Implementado no código enviado do projeto do funil e checkout. Esta pasta não está vinculada a uma publicação automática; é necessário publicar uma nova versão no projeto original do site.

## Configurar no painel

1. Entre em `/admin/gateways` com a senha atual. Cadastre as credenciais das gateways que pretende usar.
2. Escolha a **gateway padrão** nos cartões existentes.
3. Em **Gateway por valor de ticket**, marque **Ativar regras por valor**, adicione uma faixa, informe o limite em reais e escolha a gateway. Pode cadastrar até 10 faixas.
4. Em **Fallback e ordem das reservas**, marque **Ativar fallback entre gateways**. Use as setas para ordenar e **Retirar** para excluir uma reserva. Inclua a gateway padrão e pelo menos uma reserva configurada.
5. Escolha se deseja **Desviar novos pedidos automaticamente quando uma gateway falhar** e clique em **Salvar regras automáticas**.

As duas funções são independentes e começam desativadas. Os valores usados abaixo são exemplos; nenhum limite de ticket é ativado automaticamente.

| Exemplo de configuração | Resultado |
| --- | --- |
| Padrão: BuckPay; acima de R$ 500,00: Firebot | R$ 500,00 usa BuckPay; R$ 500,01 usa Firebot |
| Adicionar acima de R$ 1.000,00: Eleva | R$ 1.000,00 continua na Firebot; R$ 1.000,01 usa Eleva |
| Reserva: Eleva, BuckPay, Firebot | A gateway da faixa é tentada primeiro; as reservas seguem a ordem salva, sem repetir a primeira |

O checkout continua aceitando de R$ 6,00 a R$ 3.000,00. Havendo várias regras correspondentes, vence a de maior limite ultrapassado. Valores são comparados em centavos inteiros. As regras não alteram preços ou taxas.

## Quando uma gateway falha

Uma recusa de autenticação HTTP 401/403, com resposta JSON de erro sem identificação de cobrança, permite tentar a próxima reserva no mesmo pedido. Cada tentativa tem uma identificação própria, registrada antes do envio. Reservas que exigem dados do comprador ausentes ou inválidos são puladas; o sistema não inventa dados cadastrais.

Timeouts, HTTP 5xx, respostas ilegíveis, PIX ausente ou qualquer resultado incerto mantêm o pedido na gateway original. **Recuperar o mesmo pedido** consulta ou recupera aquela tentativa. A Eleva mantém a mesma chave de idempotência no retry já existente. Uma tentativa anterior incerta nunca passa a autorizar outra gateway só porque a recuperação recebeu HTTP 401.

Com o desvio automático ativado, novas vendas evitam a gateway com falha por 5 minutos. Se não houver reserva disponível, novos pedidos aguardam; não são enviados repetidamente a gateways pausadas. É possível selecionar manualmente uma gateway para liberar novas tentativas. Uma seleção manual feita enquanto um pedido está em andamento tem prioridade sobre a troca automática.

Quando a falha é de uma faixa de ticket, o desvio afeta novos pedidos dessa faixa e mantém a gateway padrão. O painel informa pausas e o último desvio automático. Pedidos já iniciados mantêm sua cadeia de tentativas; desativar o fallback interrompe reservas que ainda não foram enviadas.

PIX já gerados continuam vinculados à gateway original. Links de cartão continuam na Beehive e não entram no fallback do PIX. A loja usa o mesmo roteamento e consulta a cobrança efetivamente gerada para mostrar o pagamento no pedido e no admin.

## Aplicar no site original

- Aplique os arquivos sobre o código do projeto original do funil/checkout e publique uma nova versão. O repositório do portal dos atendentes é outro projeto.
- **Preserve as imagens, vídeos, catálogo e demais arquivos existentes em `public/` e nos armazenamentos do site.** O ZIP recebido continha somente código e não incluía esses arquivos. O pacote atualizado segue esse formato.
- Preserve o banco D1, os bindings e os segredos existentes (`PAYMENT_VAULT_KEY`, credenciais e configurações de compradores). Não recrie o banco nem troque a chave do cofre. Esta atualização não exige novas variáveis ou migrações SQL.
- A política, as pausas e o controle de recuperação são persistidos na tabela `payment_settings`. Credenciais continuam criptografadas; os endpoints públicos retornam somente a gateway selecionada e a disponibilidade.
- `active_gateway` aceita o formato antigo e passa a guardar uma revisão para impedir que uma troca automática sobrescreva uma escolha manual. Para reverter a versão do código, antes da reversão use no banco apenas o identificador `provider` desse registro, em texto simples, mantendo a gateway escolhida.

## Verificação

Com Node 22.13 ou superior e as dependências do lockfile instaladas:

```sh
node_modules/.bin/vinext build
node --test tests/*.test.mjs
```

A suíte verifica acesso ao admin, origem das requisições, regras e limites, ordem das reservas, todas as sete gateways, falhas ambíguas, recuperação, concorrência, mudanças manuais, pausa e reativação, cartão e confirmação dos pedidos da loja. Há testes no runtime Workers com D1 local. Todos os provedores externos são simulados; nenhuma cobrança real foi criada.

Também foi conferido o painel compilado no Chromium, com Workers/D1 local: login, gravação e persistência das regras, ordenação, limite exato, preservação de edição ao atualizar, tela de 390 px sem rolagem horizontal e envio do checkout para a gateway correta. O envio da cobrança foi simulado.

`tsc --noEmit` isolado encontra os mesmos 7 erros de tipos dos bindings Cloudflare que já existem no ZIP original; a comparação com o original não mostrou novos erros. O build Vinext e os testes são as verificações executáveis deste pacote.

## Atlas Pags

A Atlas Pags pode ser cadastrada em `/admin/atlas` e selecionada como padrão, faixa de ticket ou reserva. A integração é exclusivamente PIX, com recuperação idempotente e webhook assinado. Veja [ATLASPAGS.md](ATLASPAGS.md) para configuração e publicação.

## Cadastro, exclusão e custos

Use **+ Adicionar gateway** para cadastrar as credenciais no próprio painel. A exclusão remove a plataforma das novas cobranças e das regras, preservando consultas antigas. O custo informado é capturado por venda para o relatório privado. Veja [GESTAO-DE-GATEWAYS.md](GESTAO-DE-GATEWAYS.md).
