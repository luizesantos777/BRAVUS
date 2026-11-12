# Como sair da hospedagem ChatGPT/Sites

## O que você está migrando

O **portal de gestão já está separado**, na Vercel com Turso. O código que veio do Sites é o **checkout, loja e funis**, na pasta `checkout-loja-funis`.

Para retirar essa segunda aplicação do Sites, o caminho com menos mudanças é hospedá-la em **uma conta própria da Cloudflare**, mantendo Workers e D1. A Hostinger pode continuar sendo a empresa onde o domínio está registrado. Não é necessário transferir a propriedade do domínio para migrar a hospedagem.

O código atual usa bindings Cloudflare e uma parte da autenticação do responsável fornecida pelo Sites. **Copiar os arquivos para uma pasta de hospedagem comum ou enviar apenas o HTML não mantém API, pagamentos e banco.** Vercel ou hospedagem Node na Hostinger são alternativas, mas exigem adaptar o acesso a D1/Workers e a autenticação.

## Passo a passo da mudança

### 1. Guardar código, mídias e dados

Você já tem neste ZIP o código disponível e os testes. Restaure as mídias com o importador, usando o ZIP original no seu computador.

No projeto atual do Sites, obtenha, por um meio privado permitido pela plataforma:

- Exportação do banco **D1 usado pelo checkout**, com pedidos, estados de pagamento e configurações. Se existir acesso à conta Cloudflare que possui esse banco, o export pode ser feito pelas ferramentas D1 dessa conta. A cópia local desta entrega não contém os pedidos reais.
- O valor atual de **`PAYMENT_VAULT_KEY`**, que permite ler as credenciais criptografadas já salvas no banco.
- As demais configurações do servidor: **`ADMIN_EMAIL`** e **`FUNNEL_AUTH`**, quando usadas no projeto. `FUNNEL_AUTH` contém o hash/salt da senha do funil e sua chave de sessão; não é a senha em texto.
- Arquivos de mídia e catálogo, além dos registros DNS e configurações de domínio atuais.

Não envie os valores privados ao chat nem os coloque em GitHub. Se a plataforma não fornecer acesso ao banco ou às variáveis, resolva essa exportação antes de cancelar a publicação. Sem o banco não se recupera o histórico; sem a chave original não se leem as credenciais criptografadas desse banco.

### 2. Preparar a conta própria da Cloudflare

Crie um Worker e um D1 na sua conta, ou use o mesmo D1 se ele já estiver sob seu controle e puder ser vinculado ao novo Worker. Mantenha o nome do binding **`DB`**. Caso o banco tenha mudado, importe o export SQL e confira pedidos e configurações.

A estrutura esperada pelo código está em `drizzle/` e nos inicializadores da aplicação. Não substitua um banco com histórico por um banco vazio apenas aplicando migrações.

O arquivo `wrangler.deploy.example.json` desta pasta é **um modelo**, com um ID D1 pendente. Ele não é uma implantação pronta. O `dist/server/wrangler.json` gerado pelo ambiente local original também contém um ID de banco fictício; não use esse ID em produção.

Exemplo de preparação, depois de autenticar a CLI na **sua** conta e instalar as dependências do checkout:

```sh
npx wrangler login
npx wrangler d1 create bravus-checkout
```

Copie o ID real retornado para uma cópia privada do modelo de configuração e vincule/importe os dados reais conforme a origem do banco. As variáveis privadas devem ser cadastradas como secrets do Worker, sem valores no código. Preserve `PAYMENT_VAULT_KEY` ao restaurar credenciais existentes.

### 3. Adaptar a autenticação que era do Sites

Este é um passo necessário de código, **ainda não realizado nesta exportação**:

- `lib/payments.ts:isOwner()` depende dos cabeçalhos autenticados `oai-authenticated-user-*`, fornecidos pelo Sites. Fora dele, substitua essa identificação por autenticação própria validada no servidor — por exemplo, Cloudflare Access com verificação do token/identidade. Não confie em um cabeçalho de e-mail enviado livremente pelo navegador.
- O login por senha já existente do **painel de gateways** fica no banco e pode ser preservado com o D1 e a chave do cofre. Ele não substitui automaticamente a exigência adicional de responsável nas APIs administrativas da **loja**, nem resolve o cadastro inicial de senha em um banco novo.
- Confira `lib/gateway-access.ts`, `app/chatgpt-auth.ts` e as rotas que usam `guard()`/`ownerPanelGuard()`. Os testes de autorização precisam passar depois dessa adaptação.
- Os funis usam `FUNNEL_AUTH`, independentemente da senha das gateways. Preserve ou configure esse segredo para não bloquear o acesso da equipe.

Também ajuste a configuração de publicação/build para usar os recursos da sua conta, em vez de depender dos bindings injetados pelo controle de hospedagem do Sites. O código Bio Camisas e a lógica das gateways já estão incluídos e devem ser preservados.

### 4. Testar a nova publicação antes de trocar o domínio

Compile e rode os testes em `checkout-loja-funis`:

```sh
node_modules/.bin/vinext build
node --test tests/*.test.mjs
```

Os testes existentes simulam provedores e D1; não cobram clientes. Na nova hospedagem, valide o login administrativo, os funis, o cadastro/configuração de gateways, a consulta de pedidos existentes, a loja e os callbacks. A criação/recuperação de pedidos deve manter a idempotência.

Use dados e provedores de teste para a validação. Confira também que imagens, catálogos e tabelas restaurados carregam.

### 5. Apontar os domínios para a sua conta

Mantenha o endereço público **`pagamento.bravuspix.shop`** para preservar os links e callbacks configurados no sistema. Vincule também **`biocamisas.shop`** ao mesmo aplicativo, se quiser os dois checkouts compartilhados.

Como Bio Camisas foi informado como um domínio novo, ainda não vinculado, você pode associá-lo diretamente à nova hospedagem. Não é necessário publicá-lo primeiro no Sites apenas para depois migrar.

Para usar Custom Domains de Workers, coloque a zona DNS necessária na sua conta Cloudflare. Quando isso exigir trocar nameservers, copie antes os registros atuais, inclusive os de e-mail. Na Hostinger, vá ao gerenciamento do domínio Bio Camisas e informe **os nameservers específicos fornecidos pela sua conta Cloudflare**. Não existe um par fixo de nameservers ou um IP universal para informar aqui.

Depois de a zona ficar ativa, adicione os domínios no Worker, conclua o HTTPS e confira os registros criados pela plataforma. Para outro provedor de hospedagem, use os registros A/CNAME/TXT que aquele provedor fornecer; os valores dependem do destino real.

O endereço nativo `*.chatgpt.site` pertence à plataforma e não pode ser levado para a sua conta por uma mudança no DNS do seu domínio. Compartilhe seus domínios próprios.

### 6. Só então retirar a publicação antiga

Após confirmar que o domínio próprio já atende pela nova hospedagem e que o banco, as configurações e os pagamentos existentes estão disponíveis:

1. Abra o projeto original no ChatGPT/Sites.
2. Nas opções de publicação/domínio, remova a associação antiga do domínio próprio e despublique a versão antiga, conforme os controles disponíveis na sua conta. Os nomes dos botões podem variar.
3. Preserve o backup privado e o código exportado. Despublicar não exige apagar a conversa ou excluir sua conta ChatGPT.

Não remova a única publicação funcional antes de migrar banco e domínios. Este guia não executou nenhum desses passos na sua conta.

## Se você só quer tirar o site do ar

Faça primeiro as cópias que precisa guardar e use o controle de **despublicar** no projeto Sites, quando disponível. Se desejar, retire o apontamento DNS desse site no provedor do domínio. Isso interrompe o atendimento do checkout e não é uma migração. A compra e a renovação do domínio na Hostinger continuam sendo serviços separados.
