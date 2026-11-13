# Recusas Atlas — correção do checkout e diagnóstico

O retorno HTTP 400 genérico não mostrava o motivo da recusa. Também havia uma falha no compartilhamento do cadastro completo no fallback Beehive → Atlas e uma recusa definitiva deixava a tela presa em recuperação.

A correção:

- usa o mesmo cliente completo, resolvido pelo cadastro Beehive, nas reservas, em snapshot criptografado;
- identifica os principais motivos e registra o detalhe sanitizado e a referência da Atlas em `/admin/atlas` → **Recusas e erros da Atlas**;
- permite corrigir os dados e criar outro pedido somente após uma recusa conclusiva sem criação de cobrança;
- preserva a recuperação do mesmo pedido nos resultados incertos, com o mesmo corpo e chave de idempotência;
- coleta os dados reais exigidos pela Atlas quando ela é direta ou reserva de um fluxo que não resolve o cadastro completo no servidor.

**O print antigo não informa a causa exata da cobrança recusada.** Esta entrega corrige as falhas encontradas no código e permite consultar o retorno das novas tentativas. Recusas legítimas de dados ou condições da conta continuam dependendo de correção na integração/Atlas.

- [Baixar a atualização](Checkout_Correcao_Recusas_Atlas.zip).
- [Baixar o código completo disponível](Checkout_Completo_Atlas_Corrigido.zip).
- [Como consultar o motivo e recuperar a cobrança](RECUSAS-ATLAS.md).
- [Validação realizada](VALIDACAO.md), [patch](Correcao_Atlas.patch) e [hashes](manifesto.json).

A atualização é cumulativa: inclui Atlas Pags e o painel com gestão das gateways. Não é necessário aplicar os dois ZIPs anteriores separadamente.

## Aplicar no projeto ChatGPT/Sites

Envie **Checkout_Correcao_Recusas_Atlas.zip** à conversa original do checkout e use:

> Integre esta correção ao código atual do checkout BRAVUS/Bio Camisas e publique uma nova versão, preservando as demais personalizações, banco D1, bindings, PAYMENT_VAULT_KEY, demais segredos e todas as mídias de produção. O pacote inclui os conectores e o painel anteriores. Confira o envio do cliente cadastrado no fallback Beehive → Atlas, o diagnóstico privado em /admin/atlas e a recuperação sem duplicar cobranças. Execute o build Vinext e os testes. Não altere as tarifas do portal dos vendedores/parceiros da Vercel. Não recrie o banco nem faça cobranças reais para testar.

A publicação no projeto original não foi executada neste ambiente. O envio ao GitHub disponibiliza os arquivos; não publica o checkout do ChatGPT/Sites.
