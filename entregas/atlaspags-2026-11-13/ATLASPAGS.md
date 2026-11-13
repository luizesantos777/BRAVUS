# Atlas Pags no checkout BRAVUS / Bio Camisas

Integração PIX baseada na documentação pública enviada pelo proprietário em 13/11/2026 (`https://atlaspags.com/docs/`). Esta entrega altera o projeto do checkout/funil, não o portal dos atendentes da Vercel. É necessário aplicar os arquivos no projeto do checkout e publicar uma nova versão antes de aparecer no site.

## Ativar após publicar

1. Acesse `https://pagamento.bravuspix.shop/admin/gateways` com sua senha atual.
2. No cartão **Atlas Pags**, abra **Cadastrar credenciais** (`/admin/atlas`).
3. No painel Atlas, vá a **Integrações → API e Webhooks** e gere/copie a chave secreta `atlas_sk_live_…` para produção, ou `atlas_sk_test_…` para simulação. Cole-a somente no formulário privado do checkout. A chave pública `atlas_pk_…` não serve para criar cobranças.
4. Clique em **Validar e salvar credenciais**. A validação faz apenas `GET /api/v1/charges?limit=1`; não cria cobrança. Se a validação falhar, a chave anterior é preservada.
5. Volte ao painel e escolha **Usar Atlas Pags**, ou inclua a Atlas em uma faixa de ticket e/ou na ordem das reservas. Cadastrar a chave não sobrescreve uma seleção manual existente. As regras já salvas continuam valendo; a Atlas não é inserida automaticamente em um fallback antigo.

A configuração é compartilhada pelos checkouts BRAVUS e Bio Camisas. Quando a Atlas estiver selecionada, o checkout pede **nome completo, e-mail e CPF/CNPJ do comprador**; telefone é opcional. Não usa documento fictício nem o cadastro automático de outra gateway. Uma reserva Atlas sem esses dados válidos é pulada pelo fallback, como as demais reservas que exigem cadastro.

A API Atlas é exclusivamente PIX. Cartão permanece na Beehive. O intervalo atual do checkout continua em **R$ 6,00 a R$ 3.000,00**, embora o mínimo da API Atlas seja R$ 5,00.

## Webhook de confirmação

O pagamento também pode ser consultado pelo botão **Já paguei — verificar pagamento**, sem webhook. Para atualização automática:

1. Em **Integrações → API e Webhooks** na Atlas, cadastre um endpoint HTTPS:
   `https://pagamento.bravuspix.shop/api/webhooks/atlas`
2. Selecione `transaction.pending`, `transaction.paid`, `transaction.failed`, `transaction.expired`, `transaction.refunded` e `transaction.chargeback`.
3. Copie o segredo **desse endpoint**, `whsec_…`, para o campo **Segredo do webhook** em `/admin/atlas`. Digite novamente a chave da API para validar e salvar. Deixar o segredo vazio preserva o existente.
4. Use **Enviar teste** no endpoint Atlas. Um evento `webhook.test` com assinatura válida recebe HTTP 200; isso testa a entrega, sem simular uma venda real.

Não é necessário preencher `postback_url`: o endpoint da conta já recebe os eventos das cobranças. Se usar um endpoint próprio, use o segredo dele; não misture com o segredo do webhook principal da conta.

A assinatura HMAC-SHA256 é verificada sobre os bytes UTF-8 originais e o timestamp, com tolerância de 5 minutos. Eventos repetidos são deduplicados por ID. Um aviso nunca libera pedido por conta própria: o servidor consulta a cobrança autenticada na Atlas, confere seu ID, valor, `external_id` e ambiente, e usa o status atual da API. Eventos atrasados, estornos e chargebacks não mantêm um pagamento falsamente confirmado. Falha de consulta responde 503 para a Atlas reenviar; o evento não é marcado como concluído nesse caso. Webhooks de outras lojas da mesma conta são ignorados.

## Segurança e recuperação

- A chave da API e o segredo do webhook usam o cofre AES-GCM existente e ficam no D1. Não aparecem nos endpoints públicos, HTML, logs ou respostas do admin. Após salvar, os campos são limpos.
- As requisições usam exclusivamente `https://atlaspags.com/api/v1`, autenticação Bearer no servidor e redirecionamentos desativados.
- O valor interno em centavos é convertido para número em reais, com no máximo duas casas decimais.
- Cada pedido mantém o mesmo `Idempotency-Key` e `external_id`. O corpo original, incluindo IP/origem, é preservado **criptografado** para uma recuperação idêntica em outro dispositivo ou domínio.
- Após timeout ou resposta incerta, **Recuperar o mesmo pedido** consulta primeiro a cobrança por ID ou `external_id`. Uma nova chamada de criação só ocorre se a consulta confirmar lista vazia e a credencial original não tiver mudado, sempre com a mesma chave de idempotência e corpo. Trocar de conta/chave não autoriza um POST potencialmente duplicado.
- Falhas ambíguas, HTTP 5xx ou PIX inválido não autorizam enviar aquele pedido a outra gateway. O fallback só avança em uma recusa de autenticação/permissão 401/403 confirmada, sem identificador de cobrança.
- O código PIX precisa corresponder ao pedido; seu QR Code é gerado localmente. Nenhuma imagem/HTML remoto de resposta da API é inserido na página.
- O status público não expõe nome do vendedor, e-mail, documento ou tarifas do provedor. PIX vencido, falho, estornado ou contestado fica indisponível para pagamento.
- O modo de teste fica explícito no admin e na página PIX. Pagamento simulado tem estado interno `test_paid`, e **não** vira `paid` para liberar um pedido real na loja.

As tarifas dos vendedores/parceiros e os cálculos do portal não foram alterados. O custo `fee` efetivamente retornado pela Atlas é guardado como metadado privado da cobrança; não se presume a tarifa de outro gateway nem um perfil de conta Atlas.

## Aplicar / publicar

Aplique esta atualização sobre o código atual do checkout, preservando:

- banco D1 e seus bindings;
- `PAYMENT_VAULT_KEY` e demais segredos existentes;
- imagens, vídeos, catálogo e demais arquivos de `public/` e armazenamentos externos;
- credenciais, regras e histórico de cobranças já existentes.

Não há nova migração SQL nem nova variável obrigatória. Os dados da Atlas usam as tabelas já existentes. O ZIP completo contém somente o código disponível neste ambiente; as mídias omitidas no arquivo original continuam listadas em `ARQUIVOS-DE-MIDIA-OMITIDOS.txt`. Não substitua seu projeto por uma pasta vazia de mídias.

Este código não está ligado ao deploy automático do portal `bravus-omega.vercel.app`. A publicação deve ocorrer no projeto original ChatGPT/Sites do checkout, ou na hospedagem própria para a qual ele for migrado. As chaves de produção e a entrega real dos webhooks precisam ser validadas privadamente nessa hospedagem.

## Verificar localmente

```sh
node_modules/.bin/vinext build
node --test tests/*.test.mjs
```

Os testes Atlas executam os handlers reais de API, cofre e transações no runtime Workers com D1 local. Somente o HTTP da Atlas/outros gateways é simulado. Incluem validação, origem/admin, proteção das chaves, cobrança PIX, recuperação/idempotência/concorrência, rotação de credenciais, ticket, fallback seguro, valor/identidade/ambiente, expiração, estorno, teste e assinatura/deduplicação dos webhooks. Nenhum teste movimenta dinheiro real.
