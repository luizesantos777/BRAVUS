# Recusas Atlas: dados do comprador, motivo e recuperação

A mensagem antiga “A Atlas recusou os dados da cobrança (HTTP 400)” identificava o status da resposta, mas descartava o detalhe devolvido pelo provedor. O print dessa mensagem não permite concluir, sozinho, se a recusa veio de documento, e-mail, endereço do checkout ou condição da conta.

## Falhas corrigidas no código

1. No checkout simplificado da Beehive, o navegador informa apenas o nome do cliente cadastrado. Os dados completos são resolvidos no servidor. O fallback passava o corpo original do navegador às reservas, deixando a Atlas sem o mesmo cadastro completo. Agora o fallback captura o cliente cadastrado em um snapshot criptografado e usa essa identidade nas tentativas da cadeia, inclusive na recuperação. Não inventa dados nem dispensa o cadastro exigido pela Beehive.
2. A recusa conclusiva 400/422 deixava a tela presa em **Recuperar o mesmo pedido**. Agora o servidor conserva o motivo e, quando consegue confirmar que não houve criação de cobrança, oferece **Corrigir dados e criar outro pedido**. O valor e os campos preenchidos são preservados; a cobrança nova só é enviada quando o usuário confirma o formulário novamente.
3. A integração agora identifica causas comuns e preserva, privadamente, o detalhe sanitizado e a referência `X-Request-ID`/`error.request_id`. CPF, e-mail, telefone, nome e credenciais não são incluídos nos diagnósticos exibidos. O corpo bruto da resposta não é registrado nem mostrado.

Uma resposta incerta, timeout, HTTP 5xx, erro ilegível ou resposta que contenha identificador de cobrança continua exigindo **Recuperar o mesmo pedido**. Esses casos não recebem autorização automática para um novo pedido. Uma recusa posterior a uma tentativa incerta também não prova que nenhuma cobrança foi criada.

## Como conferir a recusa

Após publicar esta atualização no projeto original:

1. Abra **Admin Gateways → Atlas Pags → Configurações avançadas** (`/admin/atlas`).
2. Na seção **Recusas e erros da Atlas**, clique em **Atualizar diagnósticos**.
3. Confira valor, horário, motivo, detalhe sanitizado, código e referência Atlas. A seção também informa se nome, e-mail e documento estavam presentes no envio. A consulta não cria cobranças.
4. Se o checkout começou pela Beehive, confira o cliente em `/admin/beehive#clientes`. O nome informado precisa corresponder ao cadastro completo, com os dados do comprador. Na Atlas direta, o formulário exige nome, e-mail e CPF/CNPJ; telefone é opcional.
5. Corrija o cadastro ou a condição indicada pela Atlas. Use o botão de correção somente quando a tela informar que a recusa foi confirmada sem criação de cobrança. Nos demais casos, recupere o pedido original e confira o painel Atlas antes de iniciar outro.

Quando a Atlas é reserva de um checkout que não resolve um cadastro completo no servidor, o formulário passa a coletar os dados de identidade necessários. Se a configuração mudar durante o preenchimento, o checkout pede para conferir os campos antes de criar a cobrança. As chaves das gateways não são enviadas ao navegador.

Os diagnósticos começam a ser registrados com esta versão, limitados às últimas 20 tentativas com erro. O detalhe original de uma recusa anterior não pode ser reconstruído quando não foi guardado; consulte a tentativa correspondente na Atlas.

## Aplicar no site

O pacote cumulativo inclui Atlas Pags, gestão das gateways e esta correção. Integre os arquivos no código atual do checkout BRAVUS/Bio Camisas e publique no projeto ChatGPT/Sites original, preservando personalizações, banco D1, bindings, `PAYMENT_VAULT_KEY`, demais segredos e mídias de produção.

Não há nova migração SQL obrigatória. Os registros de erro e snapshots usam o cofre e a tabela `payment_settings` existentes. Não altere a chave do cofre nem recrie o banco.

Esta entrega não modifica taxas do portal dos vendedores/parceiros, custo configurado das gateways, saques ou pagamentos já registrados. O valor da cobrança continua sendo enviado em reais à Atlas: R$ 600,00 corresponde a `amount: 600`.

As validações e recusas legítimas da Atlas continuam valendo. A correção garante o envio consistente dos dados, torna o motivo consultável e trata a recuperação com segurança; não força aprovação do provedor.
