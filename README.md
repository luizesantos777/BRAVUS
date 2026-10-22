# BRAVUS — Portal do Atendente

Portal em português baseado nas capturas fornecidas: tema escuro, lançamento manual de vendas com comprovante, extrato de comissões, ranking, repasses e dados de PIX. Cada atendente tem um token próprio, validado no servidor.

## O que está publicado

O GitHub Pages serve a interface estática, na pasta `docs/`. Sem uma API hospedada, a página inicial funciona como **demonstração identificada**, com dados de exemplo no navegador. Os tokens reais dependem do servidor e do banco de dados; não são autenticados por uma lista pública de tokens ou pelo localStorage.

A API Node.js + SQLite está implementada, com painel administrativo protegido e backup consistente. Ainda é necessário hospedá-la com armazenamento persistente e HTTPS para usar atendentes reais pela internet. GitHub Pages não executa essa API. Solicitar repasse registra uma solicitação para pagamento pela administração; confirmar o pagamento registra uma operação já feita no banco.

O frontend foi hospedado pelo responsável em **https://bravus-omega.vercel.app/** na Vercel. A disponibilidade da API e do banco nesse endereço precisa ser verificada separadamente. Nessa etapa, a API deve ser adaptada ao ambiente e conectada a um banco persistente externo; o SQLite em disco local da implementação atual não é adequado a funções efêmeras.

## Alternativa preparada anteriormente: Render

[Abrir implantação do BRAVUS no Render](https://render.com/deploy?repo=https://github.com/luizesantos777/BRAVUS)

O arquivo `render.yaml` prepara interface, API e SQLite no mesmo servidor, com disco persistente de 1 GB e chave administrativa gerada pela hospedagem. **Essa configuração utiliza plano Starter e disco pagos.** Confira o preço apresentado pelo Render antes de confirmar; preparar esse arquivo não contrata nem publica o serviço.

1. Acesse o link, entre ou crie sua conta no Render e conecte o repositório `luizesantos777/BRAVUS`.
2. Revise o serviço e o custo. Confirme a implantação somente se concordar com a contratação.
3. Quando o serviço estiver disponível, abra o endereço HTTPS informado pelo Render e acrescente `/#/admin`.
4. Na seção **Environment** do serviço no Render, obtenha a variável privada `BRAVUS_ADMIN_KEY`. Cole-a apenas no formulário de administração desse servidor. Não a envie no chat nem a publique no GitHub.
5. Cadastre os atendentes, definindo o nome e o token de cada um. A parte do atendente começa em 50% do bruto, menos todas as taxas da transação. O token pode ser escolhido por você ou gerado pelo sistema. Copie e entregue cada link individual ao atendente correspondente; ele apenas abre esse link para entrar.

O endereço do Render serve o sistema completo; não depende de recompilar o GitHub Pages. Novas versões no Render são implantadas manualmente, pois o blueprint deixa `autoDeploy: false`. O SQLite usa uma única instância com disco persistente, sem escalonamento horizontal. Faça backups privados regulares e mantenha uma cópia fora do disco da aplicação. A recuperação de um backup deve ser planejada antes de usar dados reais.

## Executar o sistema completo

Requer Node.js **24 ou superior**. Não há dependências externas de banco ou credenciais obrigatórias para executar localmente.

```sh
npm ci
npm run build
npm start
```

O servidor escuta na porta 3001 por padrão e serve tanto a API quanto a interface. O banco privado é criado em `.bravus/portal.sqlite`; banco, comprovantes e convites ficam fora do Git. Configure `PORT` e `BRAVUS_DB_PATH` conforme a hospedagem. Os comandos carregam `.env` quando esse arquivo existe.

O servidor também gera `.bravus/admin.key`, com permissão de leitura restrita ao usuário do processo, caso `BRAVUS_ADMIN_KEY` não esteja configurada. Reiniciar o servidor preserva essa chave. A chave abre a administração em `/#/admin`; ela permanece apenas na memória do navegador durante a sessão e é removida ao sair ou recarregar. Em produção, use a variável privada da hospedagem e HTTPS.

## Administrar pelo navegador

Somente a administração cadastra atendentes e define seus tokens. O painel permite criar atendentes com token escolhido pelo responsável ou gerado pelo sistema, gerar um novo token para o mesmo atendente, revogar ou reativar acessos, aprovar ou recusar vendas com comprovantes, lançar custos de ADS por atendente e dia, configurar taxas e registrar pagamentos ou cancelamentos de repasses. O novo link individual aparece após a criação ou rotação; a lista de atendentes não revela tokens. A rotação invalida imediatamente o link anterior e preserva o histórico. Revogar bloqueia o acesso sem apagar vendas ou PIX; reativar volta a permitir o token mais recente.

O portal do atendente não tem cadastro nem formulário para digitar tokens. O acesso é feito pelo link individual entregue pela administração. O atendente pode atualizar seus dados pessoais e PIX e registrar vendas, mas não criar contas ou alterar tokens.

Para um pagamento, confira o PIX apresentado, efetue a transferência no seu banco e só então registre a confirmação no BRAVUS. Cancelar uma solicitação pendente libera o saldo reservado. Essas operações exigem a chave administrativa; um token de atendente não tem permissão de administração.

## Aprovar vendas e lançar ADS

Abra `/#/admin` e entre com sua chave administrativa. A aba **Aprovar vendas** abre a fila de lançamentos pendentes, com filtros por atendente e situação, paginação de 50 itens e visualização privada dos prints. Cada venda mostra bruto, taxa, parte BRAVUS e o valor do atendente. **Aprovar venda** libera a comissão; **Recusar venda** exige um motivo, exibido no histórico do atendente. A decisão registra data e observação e só pode ser aplicada uma vez. Um token de atendente não autoriza decisões ou leitura administrativa de comprovantes.

Novas vendas entram **Em análise**. Apenas as aprovadas entram no faturamento consolidado, nas taxas financeiras, no ranking e na comissão disponível para repasse. Pendentes e recusadas continuam visíveis no histórico do atendente, com seu estado e motivo. As vendas existentes antes dessa funcionalidade são mantidas como aprovadas para preservar o histórico e os saldos; a migração não apaga nem recalcula suas taxas. Não há meta diária para liberar comissões.

Na aba **Custos ADS**, selecione o atendente e a data, confira os valores carregados e salve o custo de anúncios e eventuais ajustes adicionais de taxas. O saque de R$ 5 é calculado automaticamente em cada nova solicitação e não deve ser lançado novamente aqui. O lançamento substitui o valor anterior para esse atendente e data, sem somá-lo novamente. O histórico mostra os últimos 100 registros e permite carregar um dia para edição; outros dias podem ser consultados pelos filtros. O custo entra no saldo desse atendente e pode gerar saldo negativo mesmo com vendas aguardando aprovação.

O link público `https://luizesantos777.github.io/BRAVUS/#/admin` oferece **Ver painel de demonstração**, sem pedir a chave real. Essa prévia usa somente dados de exemplo do navegador e não autentica usuários reais nem faz chamadas administrativas à API. Ao abri-la pela primeira vez sem vendas de demonstração, são criados exemplos identificados e comprovantes marcados **SEM TRANSAÇÃO REAL**. Aprovações e ADS da prévia refletem no portal de demonstração do mesmo navegador. Cadastro de contas, tokens, configuração de tarifas e pagamentos reais continuam exclusivos do painel autenticado na API hospedada. O frontend também está na Vercel; a prévia não substitui uma API conectada ao banco persistente.

## Meus Dados e PIX

A aba segue a referência fornecida com a identidade BRAVUS em preto, verde e dourado: notificações no aparelho, foto, nome/apelido, alerta de venda com prévia, chave PIX e titular. Para abrir diretamente, acrescente `?aba=perfil` antes do fragmento do link individual; na demonstração, use `https://luizesantos777.github.io/BRAVUS/?aba=perfil`.

O atendente pode alterar seu apelido, foto e PIX sem modificar seu ID, comissão ou token. A foto aceita PNG, JPEG ou WEBP de até 4 MB e é recortada ao centro e reduzida para 256 × 256 antes do envio. O servidor valida formato e limite de 256 KB; SVG e endereços externos são recusados. A foto aparece no perfil e no ranking para os demais atendentes. PIX e titular permanecem privados.

O texto do alerta admite `{valor}`, `{qtd}` e `{nome}`; a prévia se atualiza enquanto você escreve. O envio de um lote usa o total e a quantidade de vendas efetivamente salvas. O campo de PIX identifica o tipo e permite confirmá-lo, inclusive quando CPF e telefone têm o mesmo número de dígitos. **Salvar Alterações** persiste os dados na API; na demonstração, salva somente naquele navegador.

### Notificações de venda

O botão pede permissão ao navegador e ativa os alertas apenas naquele aparelho. O uso real exige HTTPS, navegador com suporte a Web Push e API hospedada. No iPhone, Web Push depende de um aplicativo web instalado na Tela de Início; esta versão não inclui um manifesto de instalação. O sistema mostra quando o modo atual não oferece notificações ou a permissão foi bloqueada. Na demonstração, somente os lançamentos de teste feitos naquele navegador exibem notificações locais; não há recebimento de vendas de terceiros.

Na API, as inscrições pertencem ao atendente autenticado, com limite de cinco aparelhos. Cada lote novo salvo envia o alerta personalizado aos seus aparelhos, mesmo com a página fechada, conforme suporte e permissões do dispositivo. Uma repetição idempotente não dispara novamente. Erros de entrega não desfazem a venda; inscrições expiradas são removidas. Trocar o token ou revogar o acesso remove as inscrições, exigindo nova ativação pelos aparelhos autorizados.

O servidor cria `push-keys.json` ao lado do banco, com permissão `600`, e reutiliza esse par de chaves VAPID ao reiniciar. Preserve esse arquivo em backup privado separado do SQLite. Também é possível configurar `BRAVUS_PUSH_PUBLIC_KEY` e `BRAVUS_PUSH_PRIVATE_KEY` nas variáveis privadas da hospedagem, sempre juntas e sem prefixo `VITE_`. Somente a chave pública é fornecida à interface. `BRAVUS_PUSH_SUBJECT` aceita o endereço HTTPS do responsável ou um contato `mailto:`; por padrão usa a URL deste repositório. As assinaturas e o conteúdo são enviados pelo protocolo Web Push criptografado aos provedores dos navegadores; a hospedagem precisa permitir essas conexões de saída. O proxy HTTPS do ambiente é respeitado quando configurado.

Para desenvolvimento com recarga da interface, use dois terminais:

```sh
npm run dev:api
```

```sh
npm run dev
```

O Vite usa a porta 5173 e encaminha `/api` para a API na porta 3001. No ambiente Codex, use `npm --cache /workspace/.cache/npm ci` para manter o cache em um diretório gravável. Use o checkout existente em `/workspace/BRAVUS`; cada tarefa já é isolada, sem necessidade de worktrees.

## Criar os tokens dos atendentes

Crie cada atendente no servidor que hospeda o banco. A parte padrão do atendente é **50% do valor bruto, menos todas as taxas da transação**. A administração pode definir outro percentual explicitamente. Sem `--commission`, o cadastro usa 50%.

```sh
npm run manage -- create-attendant --name "Nome do atendente" --commission 50 --base-url https://seu-portal.example
```

O comando gera 32 bytes aleatórios para o token, salva somente o hash no banco e grava o link do atendente em um arquivo privado em `.bravus/invites/`. O token não aparece nos logs. O operador deve obter esse arquivo por um canal privado da hospedagem e entregar o link apenas ao atendente. Não publique os convites, o banco ou backups no GitHub. A API de criação de atendentes exige a chave administrativa.

O portal aceita links no formato `/#/atendente/<TOKEN_PRIVADO>` e `/atendente/<TOKEN_PRIVADO>`. No GitHub Pages, use o formato com `#`, preservando o caminho `/BRAVUS/`. O rodapé permite copiar o link do próprio atendente.

Listar IDs e nomes, sem revelar os tokens:

```sh
npm run manage -- list-attendants
```

Revogar um acesso, preservando seu histórico:

```sh
npm run manage -- revoke-attendant --id ID_DO_ATENDENTE
```

Para substituir um token preservando o mesmo atendente e histórico, use **Novo token** no painel administrativo.

## Configurar taxas, custos e repasses

A aba **Lançar Vendas** apresenta o checkout oficial `https://pagamento.bravuspix.shop/checkout`, com **Abrir checkout** em uma nova aba e **Copiar link** para enviar ao cliente. O endereço é aberto como fornecido, sem anexar tokens do atendente. O lançamento das vendas e dos comprovantes continua manual no portal.

A aba **Lançar Vendas** exibe a chave de recebimento do PIX manual fornecida pelo responsável, com botão **Copiar chave PIX**. O campo é somente leitura e também permite selecionar e copiar manualmente caso o navegador bloqueie a área de transferência. Essa chave se destina ao recebimento das vendas; o PIX do perfil do atendente continua sendo o destino dos seus repasses.

O PIX manual aplica automaticamente **6,99% + R$ 1,69 por venda**, conforme a tabela fornecida, para vendas a partir de R$ 5,00. Todas as faixas informadas usam essa mesma tarifa. O percentual é arredondado para centavos em cada venda e a taxa fixa é adicionada a cada transação, inclusive em lotes. Exemplo: R$ 100,00 gera R$ 8,68 de taxa; descontando a parte BRAVUS de R$ 50,00, o atendente fica com **R$ 41,32**, antes de ADS e saque.

A tela mostra a tarifa, a parte BRAVUS, a taxa calculada e o valor do atendente antes de enviar. O servidor recalcula usando a configuração do checkout e grava a taxa na venda; valores de taxa enviados pelo navegador não são usados. O extrato soma as taxas gravadas e o histórico mostra bruto, parte BRAVUS, taxas e o valor do atendente.

O **Checkout principal** recebe vendas de **até R$ 1.000,00**, inclusive, com a tarifa informada pelo responsável:

| Valor de cada venda | Taxa variável | Taxa fixa por transação |
| --- | --- | --- |
| Até R$ 1.000,00, inclusive | 15% | R$ 1,99 |
| Acima de R$ 1.000,00 | Não disponível neste checkout | — |

Uma venda de R$ 1.000,00 gera taxa de R$ 151,99; com a parte BRAVUS de R$ 500,00, o atendente fica com **R$ 348,01**, antes de ADS e saque. Valores maiores são recusados tanto na interface quanto na API. A validação se aplica a cada venda e rejeita todo o lote se algum item ultrapassar o limite; o navegador não pode remover esse limite enviando dados manipulados. O percentual é arredondado em centavos e a taxa fixa é adicionada por transação. Reserva financeira informada: 0%.

O cartão do checkout mostra a tarifa e o limite. O cartão do PIX manual também informa **6,99% + R$ 1,69 por venda**. Antes de enviar, cada lançamento exibe a parte BRAVUS, as taxas e o valor do atendente; o servidor recalcula usando sua configuração. O painel permite ajustar tarifas sem alterar o limite de recebimento do checkout. Faixas opcionais devem começar abaixo desse limite. As migrações preservam taxas e decisões já registradas; o limite e a retirada da antiga faixa acima de R$ 1.000 são aplicados uma única vez.

```sh
npm run manage -- set-checkout --id main --name "Checkout principal" --fee 15 --fixed-fee 1.99 --minimum 0.01 --above ""
npm run manage -- set-costs --attendant ID_DO_ATENDENTE --date 2026-10-21 --ads 20 --withdrawal-fee 2
npm run manage -- mark-payout --id ID_DO_REPASSE --status paid --note "Pagamento conferido pela administração"
```

Para cancelar uma solicitação pendente, use `--status cancelled`. Marcar um repasse como pago registra uma confirmação; o BRAVUS não executa PIX ou integração bancária.

### Regras implementadas

- Valores são armazenados em centavos inteiros. São aceitos `197,00`, `197.00` e `1.250,50`.
- Novas vendas: **valor do atendente = bruto − parte BRAVUS (50% por padrão) − taxa completa da transação**. A parte BRAVUS é arredondada para centavos por venda. Exemplo de checkout: R$ 100,00 − R$ 50,00 − R$ 16,99 = **R$ 33,01**. Percentual, tarifa e fórmula ficam registrados na venda; o navegador não pode alterá-los. Vendas antigas conservam sua fórmula e seu percentual originais, incluindo as ainda em análise, para preservar o histórico. A migração ajusta os perfis existentes para 50% uma única vez; alterações posteriores feitas pela administração são preservadas.
- Todas as vendas aprovadas geram comissão, sem meta diária ou faturamento mínimo. Novos lançamentos aguardam análise; o histórico anterior à aprovação manual permanece aprovado. Os dias seguem o fuso America/Sao_Paulo.
- Custos ADS e ajustes adicionais de taxas são descontados do saldo e podem gerar saldo negativo. A taxa automática de saque não deve ser lançada novamente nos custos diários.
- Cada **novo saque desconta R$ 5,00 do valor solicitado**. Se solicitar R$ 33,01, o saldo reserva R$ 33,01 e o PIX previsto é **R$ 28,01**. O formulário, o histórico e a administração mostram desconto do saldo, taxa e PIX líquido. Não é possível solicitar até R$ 5,00 ou mais que o disponível. Pedidos pendentes reservam o total uma vez; pagar mantém a reserva e cancelar devolve o total, incluindo a taxa. Saques antigos mantêm taxa zero e seus valores originais. A tarifa fica gravada no pedido; o atendente não pode forjá-la.
- O extrato tem filtros de período; o saldo disponível permanece acumulado. O ranking mostra nome, foto e volume de vendas aprovadas de atendentes ativos, sem tokens ou PIX.
- Cada venda exige um print PNG, JPEG ou WEBP de até 2 MB. Cada envio aceita até 10 vendas e 12 MB no total, de forma atômica.
- Um identificador de envio evita duplicar vendas em tentativas repetidas com o mesmo conteúdo.

## Hospedar para uso real

Use uma hospedagem que execute Node.js 24 como processo contínuo e disponha de **volume persistente** para o SQLite. Configure o caminho do banco nesse volume. Hospedagens que apagam o disco em cada deploy ou funções serverless sem banco externo não são adequadas para este armazenamento.

Fluxo de implantação em uma hospedagem compatível:

```sh
npm ci
npm run build
npm start
```

Publique o servidor com HTTPS. Faça backups regulares do banco e dos arquivos de convite por um canal privado; para backup com o servidor em execução, use a API de backup do SQLite ou uma ferramenta compatível com WAL. Não copie somente o arquivo principal enquanto houver gravações.

O comando abaixo usa a API de backup online do SQLite e pode rodar com o servidor ligado. Inclui atendentes, hashes dos tokens, vendas, comprovantes, PIX e repasses em um arquivo privado; preserva o banco original e recusa sobrescrever um backup existente.

```sh
npm run manage -- backup
```

Para definir o destino, use `--output /caminho/privado/backup.sqlite`. Esse backup contém dados pessoais, fotos e inscrições de notificações: mantenha-o fora dos diretórios públicos. A chave administrativa, as chaves VAPID de notificações e os arquivos de convites devem ser preservados separadamente em um local privado. Essas chaves não fazem parte do banco.

A opção mais simples é servir interface e API no mesmo servidor, usando o endereço da hospedagem nos convites. Para manter a interface no GitHub Pages e hospedar apenas a API em outro domínio:

1. Configure `VITE_API_URL=https://seu-servidor.example/api` ao compilar a interface.
2. No servidor, configure `BRAVUS_ALLOWED_ORIGINS=https://luizesantos777.github.io` (origem sem `/BRAVUS/`).
3. Gere novamente a interface com `npm run build:pages`, envie `docs/` e aguarde a publicação.

Consulte `.env.example`. `VITE_API_URL` é um endereço público e não pode conter senhas ou tokens.

## API

As respostas privadas usam `Cache-Control: no-store`. A autenticação usa o cabeçalho `Authorization: Bearer <credencial>`, nunca uma lista pública de tokens. O servidor aceita a própria origem e as origens explicitamente configuradas em `BRAVUS_ALLOWED_ORIGINS`.

| Método e rota | Credencial | Função |
| --- | --- | --- |
| `GET /api/health` | Nenhuma | Verificar servidor e conexão SQLite |
| `GET /api/portal?period=today` | Token do atendente | Perfil, vendas, custos, extrato e repasses próprios |
| `PATCH /api/profile` | Token do atendente | Atualizar nome, foto, alerta de venda e PIX |
| `GET /api/push/config` | Token do atendente | Chave VAPID pública e IDs de inscrições próprias |
| `POST /api/push/subscriptions` | Token do atendente | Cadastrar inscrição Web Push do aparelho |
| `DELETE /api/push/subscriptions` | Token do atendente | Remover inscrição própria pelo ID |
| `POST /api/sales` | Token do atendente | Gravar lote atômico; requer `Idempotency-Key` |
| `GET /api/receipts/:id` | Token do proprietário | Obter comprovante privado |
| `GET /api/ranking?period=today` | Token do atendente | Ranking sem dados privados |
| `POST /api/payouts` | Token do atendente | Solicitar valor disponível, com R$ 5 de taxa inclusa e PIX líquido |
| `GET /api/admin/sales?status=pending&attendantId=&page=1` | Chave administrativa | Fila de vendas paginada; status `pending`, `approved`, `rejected` ou `all` |
| `PATCH /api/admin/sales/:id` | Chave administrativa | Aprovar ou recusar venda pendente; registra data e observação |
| `GET /api/admin/receipts/:id` | Chave administrativa | Obter print privado de qualquer venda para análise |
| `GET /api/admin/dashboard` | Chave administrativa | Atendentes, checkouts e repasses com destino PIX |
| `POST /api/admin/attendants` | Chave administrativa | Criar atendente; retorna token uma vez |
| `POST /api/admin/attendants/:id/token` | Chave administrativa | Trocar token preservando histórico |
| `PATCH /api/admin/attendants/:id` | Chave administrativa | Revogar ou reativar acesso |
| `GET /api/admin/attendants/:id/costs?date=AAAA-MM-DD` | Chave administrativa | Consultar custos do dia |
| `POST /api/admin/attendants/:id/costs` | Chave administrativa | Atualizar custos do dia |
| `PATCH /api/admin/checkouts/:id` | Chave administrativa | Definir nome e taxa do checkout |
| `PATCH /api/admin/payouts/:id` | Chave administrativa | Confirmar pagamento ou cancelar solicitação |

A criação recebe `{ "name": "Nome", "commission": "50" }` (sem `commission`, usa 50%), opcionalmente com o campo `token` escolhido pela administração. Tokens escolhidos devem ter de 32 a 160 letras, números, hífen ou sublinhado; valores já usados são recusados. Sem esse campo, o servidor gera um token aleatório. Custos recebem `{ "date": "AAAA-MM-DD", "ads": "20", "withdrawalFee": "2" }`. Taxas recebem `{ "name": "Checkout", "fee": "15", "fixedFee": "1.99", "minimum": "0.01", "higherTier": null }`; omitir `fixedFee`, `minimum` ou `higherTier` preserva a configuração existente. `higherTier: null` remove a faixa superior e aplica a tarifa principal às vendas aceitas pelo limite do checkout. Decisões recebem `{ "status": "approved", "note": "Print conferido" }` ou `{ "status": "rejected", "note": "Motivo obrigatório" }`; tentativas de alterar uma decisão concluída retornam 409. Ativação recebe `{ "active": false }`. Repasse recebe `{ "status": "paid", "note": "Pagamento conferido" }` ou status `cancelled`. Valores monetários e percentuais entram como texto para validação decimal. Períodos aceitos: `today`, `yesterday`, `week`, `month` e `all`.

## GitHub Pages: atualizar a demonstração

```sh
npm run build:pages
```

O comando gera `docs/index.html` com JavaScript, CSS e ícone incorporados, além de `.nojekyll`, `notifications-worker.js` e `favicon.svg` para as notificações. O Pages usa a branch `main`, pasta `/docs`. Envie os arquivos gerados junto com o código. A geração estática não inclui SQLite, convites, comprovantes reais, inscrições ou dados do navegador. O service worker é registrado somente ao ativar notificações e não armazena tokens, PIX ou páginas privadas em cache.

## Testar

```sh
npm test
npm run build
BRAVUS_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Os testes cobrem comissões sem faturamento mínimo, compatibilidade com registros antigos, regras financeiras, dias no fuso brasileiro, validação de PIX, isolamento entre tokens, comprovantes privados, idempotência, saldo de repasses e persistência após reiniciar o banco. O Playwright testa desktop e celular contra a API real com um banco temporário e tokens sintéticos, removidos ao encerrar o teste. Não são utilizados dados de atendentes reais.

Também são verificados os limites de R$ 1.000,00 e R$ 1.000,01 do checkout, recusa atômica de lotes acima do limite, preservação de taxas históricas e faixas administrativas após migração e reinício, todas as faixas de tarifa PIX, arredondamento, taxa fixa por transação em lotes, recusa de taxas manipuladas pelo cliente, atualização de bancos antigos sem alterar vendas registradas, autorização administrativa, a criação/rotação/revogação de tokens, a persistência da chave privada, as taxas sem efeito retroativo, a confirmação/cancelamento de repasses e a leitura de um backup com vendas e comprovantes.

Também há testes de autorização de decisões e comprovantes, aprovação única sob tentativas concorrentes, saldo bloqueado enquanto pendente, recusa com motivo, paginação e compatibilidade de vendas antigas. O fluxo completo de aprovação, recusa e lançamento de ADS é exercitado no desktop e no celular, incluindo seu efeito no saldo do atendente e a prévia pública.

O perfil tem cobertura de upload, prévia, persistência após recarregar, PIX, foto no ranking e mensagem personalizada. Os testes de navegador ativam/desativam notificações de demonstração e consultam os alertas locais do service worker, com permissão concedida no Chromium. Os testes da API validam inscrições por atendente, rejeição de endpoints externos arbitrários, criptografia real do payload e limpeza de inscrições expiradas; o transporte externo é substituído por uma função de teste. Isso não valida a entrega em aparelhos físicos pelos provedores.

Para outro Chromium instalado, ajuste `BRAVUS_CHROMIUM_PATH`; para usar o navegador distribuído pelo Playwright, instale com `npx playwright install chromium` e execute sem essa variável.

## Estrutura

- `src/Brand.tsx`, `src/brand.css`, `src/assets/bravus-brasil.webp`: marca BRAVUS Brasil e identidade visual em preto, dourado, verde e branco, seguindo a referência enviada pelo responsável. A imagem é incorporada ao build para funcionar também no GitHub Pages.
- `src/App.tsx`, `src/styles.css`: interface do portal.
- `src/Profile.tsx`, `src/profile.css`, `src/notifications.ts`: perfil BRAVUS, foto, PIX, alerta e ativação de notificações.
- `src/domain.ts`: tipos e regras financeiras compartilhados.
- `src/client.ts`: acesso à API e demonstração isolada.
- `src/Admin.tsx`, `src/AdminSales.tsx`, `src/admin.css`, `src/admin-client.ts`: painel administrativo, fila de aprovação, custos de ADS e cliente autenticado.
- `src/demo-admin.ts`, `src/demo-store.ts`: prévia administrativa com dados locais de demonstração, isolada da API real.
- `server/store.ts`: SQLite e regras de autorização por atendente.
- `server/http.ts`, `server/index.ts`: API e servidor da interface.
- `server/manage.ts`: administração dos atendentes, taxas, custos e repasses pelo operador.
- `server/admin-key.ts`: criação e carregamento seguro da chave administrativa.
- `server/push.ts`, `public/notifications-worker.js`: inscrições privadas e envio/recebimento de notificações Web Push.
- `render.yaml`: implantação de interface e API com SQLite em disco persistente.
- `tests/`: testes de domínio, API e navegador.

Os dados da antiga demonstração de gestão (`bravus.data.v1`) não são apagados nem migrados automaticamente. A nova demonstração usa uma chave separada; atendentes reais usam o banco no servidor.

A coluna `sales.commission_mode` identifica a fórmula histórica (`net-share`) ou a nova (`gross-share-less-fees`). `payouts.withdrawal_fee_cents` preserva a tarifa por saque, com zero para o histórico e R$ 5 para novos pedidos. Migrações são transacionais e idempotentes.

As colunas antigas de meta permanecem no SQLite para preservar a compatibilidade dos bancos existentes, mas não são lidas, expostas pela API ou usadas nos cálculos. Dados antigos da demonstração continuam na mesma chave do navegador e suas vendas antigas permanecem aprovadas e geram comissão sem mínimo de faturamento; novos lançamentos aguardam a aprovação administrativa.
