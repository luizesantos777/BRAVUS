# BRAVUS

Sistema de gestão em português para pequenos negócios, com clientes, tarefas e controle financeiro. Interface responsiva feita com React, TypeScript e Vite.

## Executar

Requer Node.js 22.18 ou superior (validado com Node.js 24.19) e npm.

```sh
npm ci
npm run dev
```

O servidor de desenvolvimento usa a porta 5173. Para gerar e servir a versão de produção:

```sh
npm run build
npm run preview
```

O preview usa a porta 4173. Não há variáveis de ambiente ou credenciais obrigatórias nesta versão. Os scripts escutam em `0.0.0.0`; use `-- --host 127.0.0.1` para limitar à máquina local.

No ambiente Codex, use `npm --cache /workspace/.cache/npm ci` para instalar com cache em um diretório gravável. Use o checkout existente em `/workspace/BRAVUS`; cada tarefa já é isolada, sem necessidade de criar worktrees.

## Funcionalidades

- Clientes: cadastro, edição, busca e exclusão de contatos.
- Tarefas: prioridades, prazos, status, conclusão e vínculo com clientes.
- Financeiro: receitas e despesas, edição, exclusão, busca, filtros por tipo e período, saldo e gráfico dos últimos seis meses.
- Backup: exportação JSON e restauração com validação de formato, datas, valores e vínculos; exige confirmação antes de substituir os registros.
- Persistência no navegador, navegação por teclado, formulários com rótulos e layout para celular e computador.

Valores monetários são armazenados em centavos inteiros. Digite `1250,50` ou `1250.50`, sem separadores de milhares. Ao excluir um cliente, tarefas e movimentações são preservadas sem o vínculo.

## Dados e limites da primeira versão

Os dados ficam no `localStorage`, na chave `bravus.data.v1`, por navegador, dispositivo e origem do site. O aplicativo começa vazio. Limpar o armazenamento ou trocar de endereço pode fazer os dados parecerem ausentes. Exporte e proteja seus backups regularmente. Backups aceitos têm até 5 MB e 10 mil registros por coleção.

Esta versão é de uso individual: não inclui backend, login, controle de acesso, sincronização, emissão fiscal ou conciliação bancária. O saldo considera os lançamentos registrados e não representa integração com bancos. O site não envia os cadastros a serviços externos. Para uso compartilhado, o próximo passo é adicionar backend, banco de dados e autenticação.

## Verificação

```sh
npm test
npm run build
```

Os testes de domínio verificam precisão financeira, filtros mensais, integridade dos backups e preservação do histórico ao excluir clientes. Os testes de navegador cobrem os fluxos completos em desktop e celular, persistência após recarga e rejeição de entradas inválidas:

```sh
npx playwright install chromium
npm run test:e2e
```

Se o Chromium já estiver instalado na máquina, dispense o download e indique o executável:

```sh
BRAVUS_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

## Estrutura

```text
src/App.tsx            Interface e fluxos de gestão
src/domain.ts         Tipos, cálculos e validação dos dados
src/styles.css        Identidade visual e layout responsivo
tests/domain.test.ts  Testes das regras e integridade
tests/app.spec.ts     Testes funcionais em navegador
```

As dependências têm versões fixadas no `package-lock.json`. O build é estático (`dist/`) e pode ser hospedado em um servidor de arquivos; a navegação usa fragmentos de URL, dispensando regras de redirecionamento.

## Publicar no GitHub Pages

```sh
npm run build:pages
```

O comando gera `docs/index.html` com JavaScript, CSS e ícone incorporados, além de `docs/.nojekyll`. A página funciona no caminho do projeto sem depender de arquivos na raiz do domínio. Os arquivos de `docs/` são versionados para a publicação pelo GitHub Pages.

No repositório, em **Settings → Pages**, escolha **Deploy from a branch**, branch **main**, pasta **/docs**, e salve. Aguarde a publicação indicada pelo GitHub. Para atualizar o site depois de alterar o código, execute `npm run build:pages` e envie o código e os arquivos de `docs/` para `main`.

Publicar a interface não publica os registros locais: cada pessoa continua com os próprios dados no seu navegador. A disponibilidade do GitHub Pages depende das permissões e do plano do repositório.
