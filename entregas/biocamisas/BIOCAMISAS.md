# Bio Camisas no mesmo sistema BRAVUS

O checkout adicional é `https://biocamisas.shop/checkout`. A raiz do novo domínio abre esse checkout. `www.biocamisas.shop` também é reconhecido, com links de pagamento canônicos sem `www`.

BRAVUS e Bio Camisas compartilham **o mesmo projeto, banco D1, chave do cofre, senha administrativa, credenciais de gateways, regras por ticket e fallback**. Nenhuma tabela nova, credencial de produção ou segunda conta é criada por esta atualização. O checkout não altera tarifas, limites ou condições contratadas com os provedores.

## O que muda

- O domínio determina o nome, a identificação BC, o título e os textos das páginas de checkout, PIX e cartão.
- O painel de gateways apresenta os links dos dois checkouts.
- Uma resposta de criação ou recuperação do Bio Camisas aponta para `biocamisas.shop/pagar/:id` ou `biocamisas.shop/cartao/:id`, preservando o identificador e a gateway da cobrança. O domínio de destino sai de uma lista explícita; cabeçalhos de redirecionamento arbitrários não são utilizados.
- As respostas do checkout BRAVUS continuam usando o endereço atual. Os links existentes continuam válidos em ambos os domínios, com a apresentação correspondente ao endereço acessado.
- As credenciais, o recebedor contratado, os callbacks do provedor e os dados jurídicos existentes são preservados. O nome visual Bio Camisas não altera a identidade do recebedor apresentada pelo banco ou pelo provedor.
- A senha do painel é a mesma, com sessão de navegador própria por domínio. O checkout público não recebe autorização administrativa.

## Publicação no domínio

1. Aplique os arquivos desta atualização **ao projeto original do checkout**, identificado em `.openai/hosting.json`. Preserve os arquivos de mídia já publicados: o código exportado não contém todas as mídias da BRAVUS.
2. Compile e publique no mesmo projeto Workers/Sites, mantendo o binding `DB`, a chave `PAYMENT_VAULT_KEY`, as demais variáveis privadas e todas as migrações existentes. **Não crie outro banco nem gere uma nova chave do cofre.**
3. No serviço que hospeda esse projeto, adicione `biocamisas.shop` como domínio personalizado do mesmo aplicativo. Se quiser usar `www`, associe também `www.biocamisas.shop` ao aplicativo.
4. O domínio foi comprado na **Hostinger** e ainda não está vinculado. No hPanel, abra **Domínios → biocamisas.shop → DNS / Nameservers → Gerenciar registros DNS** (o nome do menu pode variar). Configure exatamente os registros indicados pela hospedagem do checkout e conclua a verificação e o HTTPS. Não há um IP ou CNAME universal que possa ser preenchido sem essa informação. Não basta redirecionar o navegador para o endereço BRAVUS: o domínio Bio Camisas deve servir o mesmo aplicativo. Preserve registros de e-mail e de outros serviços existentes.
5. Abra `https://biocamisas.shop/checkout` e confira o nome Bio Camisas. No painel de gateways existente, mantenha suas configurações atuais; o mesmo painel atende aos dois acessos.

Esta pasta contém o código e os testes. Alterar arquivos localmente ou baixar o ZIP **não publica o projeto nem configura DNS/HTTPS**. Esses passos exigem acesso à hospedagem e ao DNS do domínio.

## Validação

Os testes usam banco e credenciais sintéticos. Nenhuma cobrança real é necessária para verificar a atualização.

```sh
node_modules/.bin/vinext build
node --test tests/*.test.mjs
```

`tests/checkout-domains.test.mjs` cobre origens permitidas, recuperação de PIX e cartão entre domínios, credenciais e senha compartilhadas e recusa de origens externas. O teste de roteamento em Workers/D1 também recupera pelo domínio Bio Camisas uma cobrança criada com fallback, sem novo envio ao provedor.
