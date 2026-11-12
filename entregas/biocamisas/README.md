# Bio Camisas — atualização do checkout compartilhado

O checkout está preparado para `https://biocamisas.shop/checkout`, com a marca Bio Camisas, PIX, cartão e os mesmos gateways, regras por ticket, fallback, banco e painel da BRAVUS.

**Estado: código pronto e testado localmente. A publicação no ChatGPT/Sites e o vínculo do domínio comprado na Hostinger ainda precisam ser concluídos.** Esta pasta não muda o portal de atendentes hospedado na Vercel.

## Arquivos

- [Baixar atualização para o projeto existente](./BioCamisas_Atualizacao.zip): somente os arquivos alterados e novos, nos seus caminhos originais.
- [Baixar código completo](./BioCamisas_Checkout_Completo.zip): base completa do checkout, funis e loja, com a atualização incorporada. A exportação original não contém todas as imagens e PDFs; preserve os recursos já publicados.
- [Ver alterações em texto](./BioCamisas_Atualizacao.patch).
- [Guia de publicação e domínio](./BIOCAMISAS.md).
- [Prévia local no celular](./checkout-mobile.png) e [no computador](./checkout-desktop.png), com dados sintéticos.

## Aplicar no ChatGPT/Sites

Abra o projeto original `bravus-atendimento-v2.luizlucrocerto.chatgpt.site`, anexe o ZIP de atualização e solicite:

> Aplique os arquivos deste ZIP ao projeto existente do checkout BRAVUS, preservando o banco D1, os bindings, as credenciais, a chave PAYMENT_VAULT_KEY e os arquivos de mídia atuais. Bio Camisas deve compartilhar o mesmo painel e gateways. Compile e publique a atualização neste mesmo projeto. Depois, adicione biocamisas.shop como domínio personalizado do projeto e mostre os registros DNS necessários para configurar na Hostinger. Não crie outro banco nem gere uma nova chave do cofre.

Depois de adicionar o domínio no Sites, copie os registros indicados para **Hostinger → Domínios → biocamisas.shop → DNS / Nameservers** e conclua a verificação e o HTTPS. Use os valores fornecidos pelo Sites: nenhum IP ou destino DNS foi presumido nesta entrega.

## Verificação realizada

- Compilação Vinext/Workers concluída.
- 38 testes do sistema aprovados, incluindo gateways, regras por ticket, fallback, autenticação e idempotência.
- Chromium local em 1440 × 1000 e 390 × 844: identidade Bio Camisas, criação e abertura de PIX, recuperação após recarga, URLs próprias e checkout BRAVUS preservado.
- Página de cartão Bio Camisas e painel compartilhado verificados. Uma troca de gateway pelo painel Bio Camisas foi observada também pela API BRAVUS no mesmo banco de teste.
- Todos os provedores foram simulados. Nenhuma cobrança real, credencial de produção ou alteração no DNS foi realizada.

Os arquivos de código não incluem dependências, builds, bancos locais ou segredos. `manifesto.json` contém o inventário e os hashes dos arquivos entregues.
