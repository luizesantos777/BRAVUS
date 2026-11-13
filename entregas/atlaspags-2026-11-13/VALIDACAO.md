# Validação da integração Atlas Pags

Concluída em 13/11/2026 sobre o código desta entrega.

- **Build Vinext de produção:** aprovado.
- **Suíte completa `node --test tests/*.test.mjs`:** 50 testes aprovados, sem falhas. São 12 novos cenários Atlas com múltiplas verificações, além das verificações existentes de outros gateways, roteamento, autenticação, loja e domínios.
- **Runtime real Workers/D1:** handlers das APIs executados com cofre AES-GCM, SQL transacional, locks, idempotência e recuperação. HTTP externo dos gateways simulado; nenhuma cobrança real.
- **Chromium desktop (1440 px) e celular (390 px):** cadastro privado da chave e segredo, validação sem criar cobrança, campos limpos após salvar, seleção da Atlas, regras por ticket, checkout com dados reais exigidos pela API, telefone opcional, PIX/QR local, preservação da cobrança após recarga, consulta de pagamento e confirmação. Sem erros JavaScript ou rolagem horizontal. BRAVUS e Bio Camisas usam a mesma configuração.
- **Casos de falha:** recusa explícita com fallback; HTTP 503, JSON inválido e valor/ID/ambiente divergentes sem liberar pedido; recuperação após resposta incerta sem duplicar cobrança; corpo e chave de idempotência preservados; rotação de chave sem autorizar outra criação; pedidos concorrentes.
- **Webhooks:** assinatura válida/inválida, timestamp vencido, ID divergente, duplicidade, evento atrasado, confirmação autenticada na API, falha com reenvio, teste sem cobrança e limite de tamanho. Estorno e chargeback removem o estado de pagamento confirmado.
- **Sandbox:** pagamento simulado fica separado de pagamento real e não libera pedido real da loja.
- **Tipos:** `tsc --noEmit` isolado permanece com os sete erros preexistentes de declarações/bindings Cloudflare; nenhum erro novo nos arquivos da integração. O build Vinext e os testes executáveis passam.

A ativação com chave real, a publicação do projeto original e a entrega de webhooks na hospedagem de produção não foram executadas neste ambiente. A documentação usada foi enviada pelo proprietário; a rede deste ambiente bloqueia acesso direto ao domínio Atlas.
