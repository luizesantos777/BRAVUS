# Bravus Brasil — continuação no Codex

Exportação do código-fonte atual em 07/11/2026.
Commit: aa5969611c5455c4c4365c00a7cedfa39c5ce509
Projeto Sites: appgprj_6a9cce50ae048191b0e4273b365e4cde
Site: https://bravus-atendimento-v2.luizlucrocerto.chatgpt.site
Domínio utilizado: https://pagamento.bravuspix.shop

## Conteúdo
Código completo do projeto atual: funis 1 a 4, checkout PIX e cartão, painel de gateways, loja, integrações, testes, migrações SQL, imagens, catálogo PDF e tabelas de medidas.
Não é uma exportação literal da conversa ou de todos os anexos históricos: contém os arquivos atuais incorporados ao projeto.

## Últimas alterações preservadas
- Cartão Beehive com 1 a 12 parcelas; taxas acrescidas ao valor original do pedido e pagas pelo cliente.
- Taxas em lib/card-pricing.ts: 1x 0%; 2x 23%; 3x 24,10%; 4x 26,15%; 5x 23,27%; 6x 25,50%; 7x 26,50%; 8x 29,70%; 9x 28,30%; 10x 37%; 11x 38%; 12x 39%.
- Cálculo validado no servidor, em centavos; total confirmado antes de cobrar; distribuição dos centavos exibida nas parcelas.
- Checkout adaptado a telas pequenas; removido o texto de processamento por Beehive do rodapé.
- Administração de gateways com senha; preservadas as demais proteções de acesso.
- Comparações de taxas PIX feitas no chat (5,99% + R$ 1,99 contra 10%) foram apenas simulações, não alterações de configuração.

## Como continuar
1. Extraia este ZIP e abra a pasta bravus-brasil no Codex.
2. Leia package.json, vite.config.ts, build/sites-vite-plugin.ts e .openai/hosting.json antes de mudar a infraestrutura.
3. Ambiente: Node >=22.13.0, Linux ou WSL recomendado (scripts usam bash e utilitários Linux). Instale dependências a partir do package-lock.json; examine scripts/install-ci.sh e scripts/sites-env.sh para o ambiente disponível.
4. Com dependências e ambiente configurados: npm run dev; npm run build; testes em tests/. Não gere cobranças reais para testar.
5. O backend depende de Cloudflare Workers/D1 (binding DB). Configure um banco local e aplique as migrações de drizzle/ antes de abrir páginas que consultam o banco. Banco vazio sem migrações causa erro de tabela inexistente.
6. Configure as variáveis necessárias de forma segura. .env.example contém somente nomes, sem valores. Credenciais de gateways e configurações ficam no backend; não estão neste ZIP.
7. Para continuar no mesmo Site, preserve o project_id. Uma hospedagem diferente exige adaptar os bindings, origem, autenticação e configuração de publicação; não basta abrir index.html.

## Cuidados e limitações
- Sem node_modules, .git, caches, builds ou dados do banco de produção.
- Sem exportação de segredos e credenciais do servidor. Para migrar dados criptografados, é necessário planejamento separado do banco e da chave PAYMENT_VAULT_KEY; não gere outra chave sobre dados existentes.
- README.md original é histórico e descreve apenas a integração inicial BuckPay. Este guia resume o estado mais recente; o código é a referência final.
- A compilação da última alteração foi validada na publicação. A revisão visual móvel completa ficou pendente porque a prévia local estava sem tabelas do banco.

## Pedido sugerido para o Codex
“Leia LEIA-ME-CODEX.md, inspecione este projeto Bravus e prepare o ambiente local preservando as funcionalidades atuais. Configure apenas dados sintéticos para testes. Não faça cobranças reais nem publique mudanças sem que eu peça. Depois continue as alterações que eu solicitar.”

## Esta edição contém somente código
Imagens e PDFs foram retirados para respeitar o limite de 32 MB. As referências a esses arquivos foram preservadas no código. Os recursos ausentes estão listados em ARQUIVOS-DE-MIDIA-OMITIDOS.txt. Restaure-os nos caminhos indicados quando forem enviados separadamente; até lá, imagens e links de PDFs podem não carregar.

## Ajuste local de 20/11/2026 — provedor escondido nas telas públicas
- Nas telas públicas (checkout de PIX e cartão, páginas de pagamento do cliente em /pagar e /cartao e loja) nenhum nome de provedor (Beehive, Atlas, Eleva, Gestão Pay, Poseidon, BuckPay ou Firebot) aparece mais: erros vindos da API passam por lib/gateway-mask.ts (função maskGateway) antes de ser exibidos, e a mensagem de recusa do checkout usa texto genérico ("O fornecedor recusou a geração do PIX sem criar cobrança.").
- Os painéis privados (/admin/*) continuam mostrando os nomes de cada gateway: é ali que o dono configura, ativa e diagnostica.
- A escolha real do gateway continua acontecendo normalmente no servidor; apenas o texto público muda.
