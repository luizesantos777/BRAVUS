# Atlas Pags — atualização do checkout

A Atlas foi integrada ao código do checkout BRAVUS/Bio Camisas: gateway padrão, roteamento por ticket, fallback, recuperação idempotente e confirmação PIX por consulta e webhook assinado.

- **[Baixar atualização](AtlasPags_Atualizacao.zip)**: somente os 20 arquivos novos/alterados, para aplicar sobre o projeto existente.
- **[Baixar código completo](Bravus_Checkout_Completo_AtlasPags.zip)**: todo o código disponível do checkout atualizado. As mídias omitidas no envio original continuam ausentes; preserve os arquivos de produção.
- [Como configurar a Atlas](ATLASPAGS.md): cadastro da chave privada, webhook, teste/produção e recuperação.
- [Validação realizada](VALIDACAO.md).
- [Patch da atualização](AtlasPags_Atualizacao.patch) e [hashes dos arquivos](manifesto.json).

## Aplicar no ChatGPT/Sites

Envie **AtlasPags_Atualizacao.zip** à conversa original que mantém o checkout e use este pedido:

> Aplique os arquivos deste ZIP ao código atual do checkout BRAVUS/Bio Camisas e publique uma nova versão. Preserve o banco D1, todos os bindings e segredos existentes, especialmente PAYMENT_VAULT_KEY, além das imagens, vídeos, catálogo e arquivos atuais de public/. Não recrie o banco nem troque o domínio. Não há migração SQL nova. Execute o build Vinext e os testes antes de publicar. A integração Atlas Pags deve aparecer em /admin/gateways, com formulário privado em /admin/atlas e webhook /api/webhooks/atlas. Não altere o portal dos atendentes da Vercel nem suas tarifas.

Este repositório guarda a entrega. Enviar estes ZIPs ao GitHub **não publica o checkout no ChatGPT/Sites**. Nenhuma credencial de produção foi fornecida nem incluída; a publicação deve ocorrer no projeto original.

Após publicar, entre em `/admin/gateways`, abra **Atlas Pags → Cadastrar credenciais**, salve sua chave `atlas_sk_live_…` no formulário privado e selecione **Usar Atlas Pags** ou configure uma faixa de ticket. Cadastre o webhook seguindo o guia para confirmação automática.

Os valores existentes de comissões, ADS e tarifas de parceiros/atendentes não foram alterados.
