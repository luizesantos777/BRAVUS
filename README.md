# BRAVUS — Portal do Atendente

Portal em português baseado nas capturas fornecidas: tema escuro, lançamento manual de vendas com comprovante, extrato de comissões, ranking, repasses e dados de PIX. Cada atendente tem um token próprio, validado no servidor.

## O que está publicado

O GitHub Pages serve a interface estática, na pasta `docs/`. Sem uma API hospedada, a página inicial funciona como **demonstração identificada**, com dados de exemplo no navegador. Os tokens reais dependem do servidor e do banco de dados; não são autenticados por uma lista pública de tokens ou pelo localStorage.

A API Node.js + SQLite está implementada, com painel administrativo protegido e backup consistente. Ainda é necessário hospedá-la com armazenamento persistente e HTTPS para usar atendentes reais pela internet. GitHub Pages não executa essa API. Solicitar repasse registra uma solicitação para pagamento pela administração; confirmar o pagamento registra uma operação já feita no banco.

## Publicar o sistema completo no Render

[Abrir implantação do BRAVUS no Render](https://render.com/deploy?repo=https://github.com/luizesantos777/BRAVUS)

O arquivo `render.yaml` prepara interface, API e SQLite no mesmo servidor, com disco persistente de 1 GB e chave administrativa gerada pela hospedagem. **Essa configuração utiliza plano Starter e disco pagos.** Confira o preço apresentado pelo Render antes de confirmar; preparar esse arquivo não contrata nem publica o serviço.

1. Acesse o link, entre ou crie sua conta no Render e conecte o repositório `luizesantos777/BRAVUS`.
2. Revise o serviço e o custo. Confirme a implantação somente se concordar com a contratação.
3. Quando o serviço estiver disponível, abra o endereço HTTPS informado pelo Render e acrescente `/#/admin`.
4. Na seção **Environment** do serviço no Render, obtenha a variável privada `BRAVUS_ADMIN_KEY`. Cole-a apenas no formulário de administração desse servidor. Não a envie no chat nem a publique no GitHub.
5. Cadastre os atendentes, definindo o nome, a comissão e o token de cada um. O token pode ser escolhido por você ou gerado pelo sistema. Copie e entregue cada link individual ao atendente correspondente; ele apenas abre esse link para entrar.

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

Somente a administração cadastra atendentes e define seus tokens. O painel permite criar atendentes com token escolhido pelo responsável ou gerado pelo sistema, gerar um novo token para o mesmo atendente, revogar ou reativar acessos, configurar taxas e custos diários e registrar pagamentos ou cancelamentos de repasses. O novo link individual aparece após a criação ou rotação; a lista de atendentes não revela tokens. A rotação invalida imediatamente o link anterior e preserva o histórico. Revogar bloqueia o acesso sem apagar vendas ou PIX; reativar volta a permitir o token mais recente.

O portal do atendente não tem cadastro nem formulário para digitar tokens. O acesso é feito pelo link individual entregue pela administração. O atendente pode atualizar seus dados pessoais e PIX e registrar vendas, mas não criar contas ou alterar tokens.

Para um pagamento, confira o PIX apresentado, efetue a transferência no seu banco e só então registre a confirmação no BRAVUS. Cancelar uma solicitação pendente libera o saldo reservado. Essas operações exigem a chave administrativa; um token de atendente não tem permissão de administração.

Para desenvolvimento com recarga da interface, use dois terminais:

```sh
npm run dev:api
```

```sh
npm run dev
```

O Vite usa a porta 5173 e encaminha `/api` para a API na porta 3001. No ambiente Codex, use `npm --cache /workspace/.cache/npm ci` para manter o cache em um diretório gravável. Use o checkout existente em `/workspace/BRAVUS`; cada tarefa já é isolada, sem necessidade de worktrees.

## Criar os tokens dos atendentes

Crie cada atendente no servidor que hospeda o banco. O percentual de comissão é obrigatório; os valores abaixo são **exemplos**, não a definição comercial do negócio.

```sh
npm run manage -- create-attendant --name "Nome do atendente" --commission 10 --base-url https://seu-portal.example
```

O comando gera 32 bytes aleatórios para o token, salva somente o hash no banco e grava o link do atendente em um arquivo privado em `.bravus/invites/`. O token não aparece nos logs. O operador deve obter esse arquivo por um canal privado da hospedagem e entregar o link apenas ao atendente. Não publique os convites, o banco ou backups no GitHub. A API de criação de atendentes exige a chave administrativa.

O portal aceita links no formato `/#/atendente/<TOKEN_PRIVADO>` e `/atendente/<TOKEN_PRIVADO>`. No GitHub Pages, use o formato com `#`, preservando o caminho `/BRAVUS/`. A aba Meus Dados e PIX permite copiar o link do próprio atendente.

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

Os checkouts iniciais são Checkout principal e PIX manual, ambos sem taxa configurada. Configure a taxa efetiva antes do uso real. Mudanças na taxa não alteram vendas antigas.

```sh
npm run manage -- set-checkout --id main --name "Checkout principal" --fee 3.5
npm run manage -- set-costs --attendant ID_DO_ATENDENTE --date 2026-10-21 --ads 20 --withdrawal-fee 2
npm run manage -- mark-payout --id ID_DO_REPASSE --status paid --note "Pagamento conferido pela administração"
```

Para cancelar uma solicitação pendente, use `--status cancelled`. Marcar um repasse como pago registra uma confirmação; o BRAVUS não executa PIX ou integração bancária.

### Regras implementadas

- Valores são armazenados em centavos inteiros. São aceitos `197,00`, `197.00` e `1.250,50`.
- A comissão configurada por atendente incide sobre o bruto menos a taxa do checkout. O percentual fica registrado nas vendas.
- Todas as vendas geram comissão, sem meta diária ou faturamento mínimo. O cálculo se aplica também às vendas já registradas. Os dias seguem o fuso America/Sao_Paulo.
- Custos ADS e a taxa diária de saque são descontados normalmente e podem gerar saldo negativo.
- Solicitações pendentes reservam o saldo; confirmar o pagamento não desconta o valor novamente. O saldo não permite solicitar um repasse maior que o disponível.
- O extrato tem filtros de período; o saldo disponível permanece acumulado. O ranking mostra apenas nome e volume de vendas de atendentes ativos, sem tokens ou PIX.
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

Para definir o destino, use `--output /caminho/privado/backup.sqlite`. Esse backup contém dados pessoais: mantenha-o fora dos diretórios públicos. A chave administrativa e os arquivos de convites devem ser preservados separadamente em um local privado. A chave administrativa não faz parte do banco.

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
| `PATCH /api/profile` | Token do atendente | Atualizar dados pessoais e PIX |
| `POST /api/sales` | Token do atendente | Gravar lote atômico; requer `Idempotency-Key` |
| `GET /api/receipts/:id` | Token do proprietário | Obter comprovante privado |
| `GET /api/ranking?period=today` | Token do atendente | Ranking sem dados privados |
| `POST /api/payouts` | Token do atendente | Solicitar e reservar valor disponível |
| `GET /api/admin/dashboard` | Chave administrativa | Atendentes, checkouts e repasses com destino PIX |
| `POST /api/admin/attendants` | Chave administrativa | Criar atendente; retorna token uma vez |
| `POST /api/admin/attendants/:id/token` | Chave administrativa | Trocar token preservando histórico |
| `PATCH /api/admin/attendants/:id` | Chave administrativa | Revogar ou reativar acesso |
| `GET /api/admin/attendants/:id/costs?date=AAAA-MM-DD` | Chave administrativa | Consultar custos do dia |
| `POST /api/admin/attendants/:id/costs` | Chave administrativa | Atualizar custos do dia |
| `PATCH /api/admin/checkouts/:id` | Chave administrativa | Definir nome e taxa do checkout |
| `PATCH /api/admin/payouts/:id` | Chave administrativa | Confirmar pagamento ou cancelar solicitação |

A criação recebe `{ "name": "Nome", "commission": "10" }`, opcionalmente com o campo `token` escolhido pela administração. Tokens escolhidos devem ter de 32 a 160 letras, números, hífen ou sublinhado; valores já usados são recusados. Sem esse campo, o servidor gera um token aleatório. Custos recebem `{ "date": "AAAA-MM-DD", "ads": "20", "withdrawalFee": "2" }`. Taxas recebem `{ "name": "Checkout", "fee": "3.5" }`. Ativação recebe `{ "active": false }`. Repasse recebe `{ "status": "paid", "note": "Pagamento conferido" }` ou status `cancelled`. Valores monetários e percentuais entram como texto para validação decimal. Períodos aceitos: `today`, `yesterday`, `week`, `month` e `all`.

## GitHub Pages: atualizar a demonstração

```sh
npm run build:pages
```

O comando gera `docs/index.html` com JavaScript, CSS e ícone incorporados, além de `.nojekyll`. O Pages usa a branch `main`, pasta `/docs`. Envie os arquivos gerados junto com o código. A geração estática não inclui SQLite, convites, comprovantes reais ou dados do navegador.

## Testar

```sh
npm test
npm run build
BRAVUS_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Os testes cobrem comissões sem faturamento mínimo, compatibilidade com registros antigos, regras financeiras, dias no fuso brasileiro, validação de PIX, isolamento entre tokens, comprovantes privados, idempotência, saldo de repasses e persistência após reiniciar o banco. O Playwright testa desktop e celular contra a API real com um banco temporário e tokens sintéticos, removidos ao encerrar o teste. Não são utilizados dados de atendentes reais.

Também são verificados a autorização administrativa, a criação/rotação/revogação de tokens, a persistência da chave privada, as taxas sem efeito retroativo, a confirmação/cancelamento de repasses e a leitura de um backup com vendas e comprovantes.

Para outro Chromium instalado, ajuste `BRAVUS_CHROMIUM_PATH`; para usar o navegador distribuído pelo Playwright, instale com `npx playwright install chromium` e execute sem essa variável.

## Estrutura

- `src/Brand.tsx`, `src/brand.css`, `src/assets/bravus-brasil.webp`: marca BRAVUS Brasil e identidade visual em preto, dourado, verde e branco, seguindo a referência enviada pelo responsável. A imagem é incorporada ao build para funcionar também no GitHub Pages.
- `src/App.tsx`, `src/styles.css`: interface do portal.
- `src/domain.ts`: tipos e regras financeiras compartilhados.
- `src/client.ts`: acesso à API e demonstração isolada.
- `src/Admin.tsx`, `src/admin-client.ts`: painel administrativo e cliente autenticado.
- `server/store.ts`: SQLite e regras de autorização por atendente.
- `server/http.ts`, `server/index.ts`: API e servidor da interface.
- `server/manage.ts`: administração dos atendentes, taxas, custos e repasses pelo operador.
- `server/admin-key.ts`: criação e carregamento seguro da chave administrativa.
- `render.yaml`: implantação de interface e API com SQLite em disco persistente.
- `tests/`: testes de domínio, API e navegador.

Os dados da antiga demonstração de gestão (`bravus.data.v1`) não são apagados nem migrados automaticamente. A nova demonstração usa uma chave separada; atendentes reais usam o banco no servidor.

As colunas antigas de meta permanecem no SQLite para preservar a compatibilidade dos bancos existentes, mas não são lidas, expostas pela API ou usadas nos cálculos. Dados antigos da demonstração continuam na mesma chave do navegador e suas vendas passam a gerar comissão sem mínimo de faturamento.
