# Bio Camisas — código atualizado v103

Fonte publicada: 25f146c4f70891554c2c93500917022f3e5b2f2e

Inclui logo Bio Camisas, nome BIOTWO preenchido, cadastro empresarial no servidor, checkout PIX/cartão, painel e gateways.

## Atenção à Vercel
Este ZIP contém o código original completo. NÃO é um pacote já adaptado à Vercel.
O projeto usa Vinext/Vite, Cloudflare Workers, o binding D1 DB e módulos cloudflare:workers. Um deploy direto como Next.js na Vercel não funciona sem migração.

Para migrar: adaptar o runtime para Next.js/Node, substituir o acesso D1 por um banco compatível, adaptar o Worker e os bindings, configurar variáveis de ambiente e webhooks, migrar os dados necessários e testar recuperação de pedidos/idempotência antes de ativar pagamentos.
Não substituir esse backend por uma prévia estática: ela não gera pagamentos.

## Conteúdo e configuração
Sem node_modules, .git, builds, bancos de produção, senhas ou chaves privadas. As credenciais e pedidos atuais não são transferidos pelo ZIP; precisam ser configurados/migrados separadamente. Consulte .env.example e os arquivos README/BIOCAMISAS.
Os dados da BIOTWO estão em lib/biocamisas-customer.ts. A partir de 20/11/2026, apenas a constante de NOME (BIOCAMISAS_BUYER_NAME) é importada pelo componente client de checkout para pré-preencher o campo; CPF, e-mail, telefone e endereço continuam exclusivos do processamento no servidor.

Validação desta versão: build aprovado e 39 testes passaram. Nenhuma cobrança real foi feita na validação.

## Atualização 20/11/2026 — pacote "Checkout_Completo_Atlas_Corrigido" (v106 + Atlas)
Fonte: c:\Users\Administrator\Downloads\Checkout_Completo_Atlas_Corrigido (220 arquivos de código, root = raiz do projeto). Substituídos os arquivos de mesmo nome; preservados node_modules, .sites-runtime, toda a mídia de public/ (logo Bio Camisas incluído), tsconfig.tsbuildinfo e este arquivo.

Nova nesta versão (pacote): integração Atlas Pags (/admin/atlas, webhook /api/webhooks/atlas, lib atlas*), painel de gestão de gateways (cadastro/exclusão/custos, relatório), diagnóstico de recusas Atlas, fallback por ticket com snapshot criptografado do cliente Beehive, página /admin/gateways com connect + cost-editor, docs ATLASPAGS/BIOCAMISAS/GATEWAYS-AUTOMATICOS/GESTAO-DE-GATEWAYS/RECUSAS-ATLAS, 2 novos arquivos de teste.

Desvios locais em relação ao pacote (feitos neste computador, fora do pacote original):
1. Testes compatíveis com Windows: 4 arquivos em tests/ usam import(pathToFileURL(out).href), importando pathToFileURL de node:url (no Node local, node:path não expõe esse export em ESM).
2. Prefill de comprador por marca: lib/biocamisas-customer.ts agora exporta BIOCAMISAS_BUYER_NAME e app/checkout/ui.tsx usa brand.id para preencher "BIOTWO CONFECCOES E ACESSORIOS LTDA" no domínio biocamisas.shop e "BRAVUS BRASIL LTDA" em pagamento.bravuspix.shop (comportamento antigo, perdido na exportação, foi restaurado).
3. Ambiente: instalado VC++ x64 Redistributable (pré-requisito do workerd usado pelos testes Workers/D1).
4. Provedor escondido nas telas públicas: erros exibidos fora de /admin passam por lib/gateway-mask.ts (maskGateway); a mensagem de recusa do checkout usa texto genérico. Os painéis privados continuam mostrando os nomes dos gateways.

IMPORTANTE para o painel: a versão nova resolve o comprador pela base de clientes Beehive (hash do nome normalizado). O cadastro da BIOTWO precisa existir em /admin/beehive#clientes com o nome EXATO "BIOTWO CONFECCOES E ACESSORIOS LTDA", CPF 07.669.833/0001-99, e-mail biocamisas@suporte.com e telefone 89981172484, ou o checkout PIX Bio Camisas pedirá o cadastro.

Validação desta atualização (20/11/2026): node_modules reinstalados pelo package-lock.json do pacote (npm ci); vinext build aprovado; node --test tests/*.test.mjs: 11 arquivos de teste, 68 testes, todos passaram. Nenhuma cobrança real foi feita na validação.
