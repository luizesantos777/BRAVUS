# Exportação do projeto BRAVUS

[**Baixar ZIP — código, histórico técnico e guia de migração**](./BRAVUS_Projeto_Codigo_Historico_Migracao_2026-11-12.zip)

O arquivo tem aproximadamente **4,1 MiB** e contém **334 arquivos**:

- Portal de gestão completo disponível, com atendentes, parceiros, admin, API e PDFs.
- Código disponível de checkout, loja e funis, com gateways, fallback, regras por ticket e Bio Camisas.
- Resumo técnico das decisões, sem transcrição literal da conversa ou links individuais.
- Guia para hospedar o checkout em conta própria e depois retirar a publicação do ChatGPT/Sites.
- Importador das mídias a partir do ZIP original e manifesto SHA-256 dos arquivos.

**Não é um backup do banco de produção nem uma exportação integral da conversa.** Não inclui senhas, tokens privados, relatórios financeiros reais, dependências ou caches.

A exportação de código original omitiu **101 mídias**, relacionadas em [MIDIAS_PENDENTES.txt](./MIDIAS_PENDENTES.txt). O ZIP grande enviado anteriormente excede o limite de transferência deste ambiente. O importador incluído permite recuperar as mídias no seu computador, usando o arquivo original que você já possui, sem substituir arquivos existentes.

Leia [o conteúdo e os limites do ZIP](./CONTEUDO_DO_ZIP.md) e [como sair do ChatGPT/Sites](./SAIR_DO_CHATGPT_SITES.md).

Para migrar, preserve o D1 e `PAYMENT_VAULT_KEY`, adapte a identificação do responsável que era fornecida pelo Sites e publique primeiro em sua própria hospedagem. Só então mude o DNS e despublique o site antigo. Nenhuma hospedagem, domínio ou banco foi migrado ou cancelado por esta exportação.

O [SHA256.txt](./SHA256.txt) identifica o ZIP entregue. O inventário interno foi conferido com os bytes de todos os arquivos. O importador de mídia foi validado com um arquivo sintético, incluindo preservação de arquivos existentes e indicação de mídias ausentes. Os códigos das aplicações não foram alterados para produzir esta entrega.
