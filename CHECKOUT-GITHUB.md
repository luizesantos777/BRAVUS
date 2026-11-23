# Checkout Poseidon separado

Este repositório mantém dois projetos independentes:

- a raiz é o portal BRAVUS (painel, atendentes e parceiros), publicado na Vercel;
- `checkout/` é o checkout BRAVUS/Bio Camisas, com Poseidon, demais gateways, Workers/Vinext e D1.

A branch foi criada sem alterar o `main`. O checkout não deve substituir os arquivos da raiz.

## Publicação

1. Faça o merge desta branch em `main` depois de revisar os arquivos adicionados.
2. Crie um projeto separado na hospedagem do checkout usando este mesmo repositório.
3. Defina o diretório raiz do projeto como `checkout`.
4. Preserve o banco D1 e as migrações de `checkout/drizzle/`; não crie um banco de produção novo sobre o banco existente.
5. Configure no ambiente privado apenas `ADMIN_EMAIL` e `PAYMENT_VAULT_KEY`, além das credenciais já mantidas no banco. Nunca publique esses valores no GitHub.
6. O endpoint de aprovação automática do portal continua sendo `https://bravus-omega.vercel.app/api/integrations/checkout-sales`.

Este checkout usa Cloudflare Workers/Vinext e D1. Não o publique como um projeto Vercel/Next.js comum sem uma migração de runtime. Para a integração Git, use a pasta `checkout` como diretório raiz do projeto Cloudflare.

## Verificação

Dentro de `checkout/`:

```sh
npm ci
npm run quality
```

Os testes não criam cobranças reais. O pacote não contém credenciais, bancos de produção, `node_modules`, builds ou caches.
