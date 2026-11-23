# Operação e qualidade

O projeto usa Node 24.22.3 (arquivo `.node-version`) e não depende de Bash para a execução normal. Em Windows, PowerShell e WSL, a instalação e a validação são reproduzíveis com os mesmos comandos:

```powershell
npm ci
npm run quality
```

```sh
npm ci
npm run quality
```

O script `scripts/quality.mjs` executa build, lint, testes, inventário de mídia e a simulação de migrações D1. Em um CI Linux, `.github/workflows/quality.yml` executa build, lint, testes/acessibilidade e migrações em jobs independentes, portanto uma etapa lenta não esconde a falha de outra.

## Ambientes

- Desenvolvimento local usa `wrangler.local.json`, D1 local persistido em `.wrangler/` e valores de `.env.development` (não versionado).
- CI usa banco local descartável; nenhum segredo de gateway é necessário para os testes.
- Staging e produção devem usar projetos D1 separados. Copie `wrangler.staging.example.json` para `wrangler.staging.json` e substitua o ID pelo banco de staging real. Configure `ADMIN_EMAIL` e `PAYMENT_VAULT_KEY` como segredos do ambiente correspondente; nunca copie `.env*` para o artefato nem reutilize a chave do cofre entre ambientes.
- O deploy de produção continua usando o binding `DB` definido em `.openai/hosting.json`; migrações devem ser aplicadas antes de liberar código que dependa de uma nova coluna.

## Migrações D1

O procedimento local e idempotente é:

```powershell
npm run migration:check
```

Para um ambiente nomeado, faça uma revisão do banco alvo e aplique somente as migrações versionadas:

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.staging.json
```

Faça o mesmo em produção depois de confirmar o backup e a janela de mudança. Nunca execute `--local` esperando alterar produção e nunca apague a pasta `drizzle/meta`.

## Mídia e backup

`ARQUIVOS-DE-MIDIA-OMITIDOS.txt` é conferido por `scripts/check-media.mjs`. O comando abaixo valida referências em código, imagens, PDFs e catálogos, compara os hashes no `dist/client` e gera o inventário JSON:

```powershell
node scripts/check-media.mjs --dist --json > outputs/media-inventory.json
```

Os assets existentes são incluídos no pacote de deploy pelo build Vinext. Antes de publicar, a saída deve terminar com `problems: []`; referências externas são registradas como externas e não são tratadas como arquivos locais.

Para gerar o backup reproduzível com o inventário junto:

```powershell
npm run media:backup
```

## Observabilidade

O endpoint privado `GET /api/admin/health` retorna somente o estado operacional agregado. Alertas cobertos: banco sem pedidos, falhas repetidas de webhook em uma janela de 15 minutos e gateways desabilitadas ou pausadas. Logs de gateway, webhook e login são JSON com etapa, status e contador; não registram nome, e-mail, documento, payload ou credencial.
