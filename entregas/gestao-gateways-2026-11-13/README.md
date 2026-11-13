# Novo painel de gateways — BRAVUS / Bio Camisas

Entrega do código com:

- **+ Adicionar gateway:** cadastro guiado no próprio painel para as sete integrações disponíveis, com edição das credenciais e ativação opcional;
- **Excluir / restaurar:** retirada das novas cobranças e das regras, preservando consultas e histórico; escolha de substituta ou desativação dos novos pagamentos ao excluir a última disponível;
- **Meu custo:** percentual, custo fixo por venda, arredondamento, exemplo de cálculo e registro da tarifa na criação de cada cobrança;
- **Relatório privado:** faturamento, custos e líquido dos pagamentos confirmados; custo real da Atlas quando retornado, estimativas identificadas e indicação de vendas sem custo conhecido.

**O ZIP já inclui a Atlas Pags. Você pode aplicar somente esta atualização, sem precisar aplicar o ZIP anterior da Atlas.**

- [Baixar atualização cumulativa](Gateways_Painel_Atualizacao_Com_Atlas.zip).
- [Baixar o código completo disponível do checkout](Bravus_Checkout_Completo_Gestao_Gateways.zip).
- [Como usar o novo painel](GESTAO-DE-GATEWAYS.md).
- [Verificações realizadas](VALIDACAO.md).
- [Patch](Gateways_Atualizacao_Com_Atlas.patch) e [manifesto de integridade](manifesto.json).

## Aplicar no projeto ChatGPT/Sites

Envie **Gateways_Painel_Atualizacao_Com_Atlas.zip** à conversa original do checkout e use este pedido:

> Aplique os arquivos desta atualização sobre o código atual do checkout BRAVUS/Bio Camisas e publique uma nova versão. O ZIP já inclui Atlas Pags e o novo painel /admin/gateways com cadastro guiado, exclusão/restauração e custos. Preserve o banco D1, os bindings, PAYMENT_VAULT_KEY e demais segredos, as credenciais existentes e todas as imagens, vídeos e catálogos. Não recrie o banco e não mude o domínio. Execute o build Vinext e os testes. Não altere o portal dos atendentes/parceiros da Vercel nem suas tarifas. As estruturas de rastreamento de custo e exclusão são inicializadas pelo servidor ao salvar um custo ou excluir a primeira integração, sem migração manual obrigatória.

Depois de publicar, abra `/admin/gateways`, use **+ Adicionar gateway** para cadastrar a plataforma ou **Informar meu custo** no cartão já existente.

O código completo contém as fontes disponíveis neste ambiente. As mídias que estavam omitidas no ZIP original continuam ausentes; mantenha os arquivos de produção de `public/` e dos armazenamentos existentes. Nenhuma credencial de produção está incluída.

Este repositório guarda os arquivos da entrega. O envio ao GitHub não publica o checkout do ChatGPT/Sites. A publicação no projeto original não foi executada neste ambiente.
