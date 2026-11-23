# Bravus Brasil

Projeto do funil, loja e checkout. O checkout gera PIX nas gateways configuradas; `/pagar/:id` mantém cada cobrança vinculada à gateway que a criou. Links de cartão são gerados pela Beehive em `/cartao/:id`.

O mesmo aplicativo também atende **Bio Camisas**, em `https://biocamisas.shop/checkout`, com identificação e links próprios e o mesmo painel e gateways da BRAVUS. Veja [como publicar o domínio adicional](BIOCAMISAS.md).

O painel privado `/admin/gateways` permite escolher a gateway padrão, configurar o roteamento por valor de ticket e ordenar as reservas do fallback. As regras automáticas começam desativadas.

Veja [como configurar e publicar a atualização](GATEWAYS-AUTOMATICOS.md).

## Configuração existente

O projeto usa Cloudflare Workers/Vinext e D1, com os bindings de `.openai/hosting.json`. `ADMIN_EMAIL` identifica o responsável por meio dos cabeçalhos de identidade autenticada do Sites; a configuração inicial da senha do painel exige esse acesso. Depois de configurado, o painel usa sua senha e um cookie assinado. A administração da loja também mantém a exigência de acesso do responsável.

`PAYMENT_VAULT_KEY` é uma chave AES-GCM de 32 bytes, em base64, mantida como segredo do servidor. O banco guarda as credenciais criptografadas, os pedidos e as regras. Preserve a chave e o banco existentes ao atualizar. As credenciais das gateways são cadastradas nos respectivos painéis privados; nenhuma credencial é enviada nos links dos compradores.

O ZIP contém somente código. Preserve as imagens, os vídeos e os demais arquivos publicados no projeto original.

## Verificação

Com Node 22.13 ou superior e as dependências de `package-lock.json` instaladas:

```sh
npm run quality
```

Os testes simulam os provedores de pagamento e não criam cobranças reais. Há cobertura das gateways, autenticação, validação de valores, regras por ticket, fallback, recuperação, concorrência, cartão e loja, inclusive no runtime Workers com D1 local.

O pipeline executa build, lint, testes, acessibilidade, recuperação após timeout, expiração de PIX, deduplicação, inventário de mídia e migrações D1. Os testes simulam os provedores e não criam cobranças reais. Para o procedimento completo de ambientes, migrações e backup, consulte [OPERACAO-QUALIDADE.md](OPERACAO-QUALIDADE.md).

## Atlas Pags

Gateway PIX disponível em `/admin/gateways`, com cadastro privado da chave em `/admin/atlas`, regras por ticket e fallback. Exige os dados reais do comprador. Consulte [ATLASPAGS.md](ATLASPAGS.md) para publicar, ativar e configurar os webhooks.

## Gestão das integrações e custos

O painel `/admin/gateways` oferece cadastro guiado, edição das credenciais, exclusão/restauração e custos percentuais/fixos por transação, com relatório privado dos pagamentos confirmados. Consulte [GESTAO-DE-GATEWAYS.md](GESTAO-DE-GATEWAYS.md).

## Diagnóstico de recusas Atlas

A seção privada de erros em `/admin/atlas` mostra causas e referências sem expor os dados do comprador. A troca Beehive → Atlas preserva o cadastro completo criptografado. Veja [RECUSAS-ATLAS.md](RECUSAS-ATLAS.md).
