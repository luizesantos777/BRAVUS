# BRAVUS — Portal do Atendente

Portal em português baseado nas capturas fornecidas: tema escuro, lançamento manual de vendas com comprovante, meta diária, extrato de comissões, ranking, repasses e dados de PIX. Cada atendente tem um token próprio, validado no servidor.

## O que está publicado

O GitHub Pages serve a interface estática, na pasta `docs/`. Sem uma API hospedada, a página inicial funciona como **demonstração identificada**, com dados de exemplo no navegador. Os tokens reais dependem do servidor e do banco de dados; não são autenticados por uma lista pública de tokens ou pelo localStorage.

A API Node.js + SQLite foi implementada e testada no ambiente. Ainda é necessário hospedá-la com armazenamento persistente e HTTPS para usar atendentes reais pela internet. GitHub Pages não executa essa API. Não há transferência bancária automática: solicitar repasse registra uma solicitação para pagamento pela administração.

## Executar o sistema completo

Requer Node.js **24 ou superior**. Não há dependências externas de banco ou credenciais obrigatórias para executar localmente.

```sh
npm ci
npm run build
npm start
```

O servidor escuta na porta 3001 por padrão e serve tanto a API quanto a interface. O banco privado é criado em `.bravus/portal.sqlite`; banco, comprovantes e convites ficam fora do Git. Configure `PORT` e `BRAVUS_DB_PATH` conforme a hospedagem. Os comandos carregam `.env` quando esse arquivo existe.

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
npm run manage -- create-attendant --name "Nome do atendente" --commission 10 --daily-goal 200 --base-url https://seu-portal.example
```

O comando gera 32 bytes aleatórios para o token, salva somente o hash no banco e grava o link do atendente em um arquivo privado em `.bravus/invites/`. O token não aparece nos logs. O operador deve obter esse arquivo por um canal privado da hospedagem e entregar o link apenas ao atendente. Não publique os convites, o banco ou backups no GitHub. A API não oferece um endpoint público para criar atendentes.

O portal aceita links no formato `/#/atendente/<TOKEN_PRIVADO>` e `/atendente/<TOKEN_PRIVADO>`. No GitHub Pages, use o formato com `#`, preservando o caminho `/BRAVUS/`. A aba Meus Dados e PIX permite copiar o link do próprio atendente.

Listar IDs e nomes, sem revelar os tokens:

```sh
npm run manage -- list-attendants
```

Revogar um acesso, preservando seu histórico:

```sh
npm run manage -- revoke-attendant --id ID_DO_ATENDENTE
```

Para substituir um acesso, crie um novo atendente conforme a política do negócio. A rotação preservando o mesmo ID ainda não possui comando dedicado.

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
- A comissão configurada por atendente incide sobre o bruto menos a taxa do checkout. O percentual e a meta ficam registrados nas vendas.
- A meta é somada por dia, no fuso America/Sao_Paulo. O padrão de R$ 200 segue as capturas e pode ser definido ao criar o atendente.
- Abaixo da meta, a comissão desse dia não entra no saldo. Custos ADS e a taxa diária de saque são descontados mesmo sem atingir a meta e podem gerar saldo negativo.
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

A opção mais simples é servir interface e API no mesmo servidor, usando o endereço da hospedagem nos convites. Para manter a interface no GitHub Pages e hospedar apenas a API em outro domínio:

1. Configure `VITE_API_URL=https://seu-servidor.example/api` ao compilar a interface.
2. No servidor, configure `BRAVUS_ALLOWED_ORIGINS=https://luizesantos777.github.io` (origem sem `/BRAVUS/`).
3. Gere novamente a interface com `npm run build:pages`, envie `docs/` e aguarde a publicação.

Consulte `.env.example`. `VITE_API_URL` é um endereço público e não pode conter senhas ou tokens.

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

Os testes cobrem regras financeiras, dias no fuso brasileiro, validação de PIX, isolamento entre tokens, comprovantes privados, idempotência, saldo de repasses e persistência após reiniciar o banco. O Playwright testa desktop e celular contra a API real com um banco temporário e tokens sintéticos, removidos ao encerrar o teste. Não são utilizados dados de atendentes reais.

Para outro Chromium instalado, ajuste `BRAVUS_CHROMIUM_PATH`; para usar o navegador distribuído pelo Playwright, instale com `npx playwright install chromium` e execute sem essa variável.

## Estrutura

- `src/App.tsx`, `src/styles.css`: interface do portal.
- `src/domain.ts`: tipos e regras financeiras compartilhados.
- `src/client.ts`: acesso à API e demonstração isolada.
- `server/store.ts`: SQLite e regras de autorização por atendente.
- `server/http.ts`, `server/index.ts`: API e servidor da interface.
- `server/manage.ts`: administração dos atendentes, taxas, custos e repasses pelo operador.
- `tests/`: testes de domínio, API e navegador.

Os dados da antiga demonstração de gestão (`bravus.data.v1`) não são apagados nem migrados automaticamente. A nova demonstração usa uma chave separada; atendentes reais usam o banco no servidor.
