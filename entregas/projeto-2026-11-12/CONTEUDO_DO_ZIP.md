# BRAVUS — código, histórico técnico e saída do ChatGPT/Sites

Exportação preparada em **12/11/2026**, a partir dos arquivos disponíveis neste ambiente.

## O que está incluído

| Pasta | Conteúdo | Ambiente atual |
|---|---|---|
| `portal-gestao/` | Portal de atendentes e parceiros, administração GESTÃO, API, banco, comprovantes, notificações, relatórios e testes | Vercel + Turso/libSQL em produção; SQLite como alternativa local |
| `checkout-loja-funis/` | Checkout PIX/cartão, loja, funis 1–4, gateways, fallback, regras por ticket, Bio Camisas e testes | Código Cloudflare Workers/Vinext + D1, originalmente publicado pelo ChatGPT/Sites |
| `historico/` | Resumo dos pedidos, decisões e estado atual do trabalho | Documento técnico, sem senhas e links individuais |
| `migracao/` | Guia para levar o checkout a uma conta própria e retirar a publicação do Sites | Planejamento; nenhuma hospedagem foi cancelada ou migrada por esta exportação |
| `ferramentas/` | Importador de mídias do ZIP original que você já possui | Python 3, sem dependências extras |

O portal inclui a atualização de **PDFs de até 2 MB** e a tarifa dos parceiros de **12% + R$ 2 por venda**. O checkout inclui Bio Camisas preparado para usar o mesmo painel, banco e gateways da BRAVUS.

## Limites desta exportação

**Este arquivo contém todo o código disponível, mas não é uma cópia integral da conversa nem um backup de produção.**

- `historico/HISTORICO_DO_PROJETO.md` é um resumo técnico. Não é uma transcrição literal de todas as mensagens, imagens e propostas antigas.
- Bancos reais de produção, pedidos, vendas, comprovantes privados, senhas, chaves e tokens não estão neste ZIP. Copie-os das plataformas por um meio privado antes de uma migração.
- Há **101 mídias ausentes** na exportação de código recebida: imagens, catálogos e tabelas estão relacionados em `MIDIAS_PENDENTES.txt`. O ZIP original `Bravus_Brasil_Atualizado_Codex.zip` excede o limite de transferência de 32 MiB deste ambiente. O arquivo não pôde ser lido aqui; as mídias não foram inventadas nem substituídas.
- Para recuperar as mídias no seu computador, use `ferramentas/restaurar_midias.py` com o ZIP original. O importador não substitui arquivos existentes.
- O `EXPORT-MANIFEST.json` dentro do checkout é o manifesto histórico da exportação original. O inventário desta entrega é **`MANIFESTO_SHA256.json` na raiz**.

Os relatórios financeiros reais recebidos e os links privados de atendentes foram excluídos desta cópia de código para download. Eles continuam sendo dados privados da sua operação.

## Começar

1. Para sair do Sites, leia **`migracao/SAIR_DO_CHATGPT_SITES.md`**. O caminho recomendado mantém Workers/D1 em uma conta própria da Cloudflare; a Hostinger pode continuar sendo a registradora do domínio.
2. Para recuperar imagens e PDFs do catálogo, leia **`ferramentas/LEIA-ME.md`**.
3. Para continuar o desenvolvimento em outro chat ou com outro desenvolvedor, leia **`historico/CONTINUAR_O_PROJETO.md`** e o README do projeto escolhido.
4. Para exportar as mensagens literais da sua conta, consulte **`historico/EXPORTAR_CONVERSA_LITERAL.md`**.

Não é necessário migrar o portal da Vercel para retirar o checkout do Sites: são aplicações separadas.
