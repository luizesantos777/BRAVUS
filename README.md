# BRAVUS — Portal do Atendente

Os portais do atendente e do parceiro não exibem percentuais, tarifas fixas, valores de taxas de venda ou a parte BRAVUS. Extratos, cartões de checkout/PIX, prévia do lançamento e histórico apresentam os valores da conta sem detalhar essas taxas. Faturamento, ADS, lucro, ROI, saldo e limites de venda continuam disponíveis. A alteração é de apresentação: cálculos, API, banco, regras de aprovação e repasses permanecem iguais. A administração continua consultando taxas, custos reais e lucro BRAVUS. Informações de saque e ajustes financeiros continuam separadas das taxas das vendas.

## Transações e lucro dos parceiros na administração

A aprovação de vendas identifica o tipo da conta e mostra, para parceiros, o valor bruto, a taxa da venda de 12%, o valor do parceiro e, somente no admin, o custo real do gateway e o lucro BRAVUS nas taxas. Não há um segundo desconto de “taxa do atendente”. Uma venda de R$ 219 tem R$ 26,28 de taxa da venda, R$ 192,72 para o parceiro, R$ 15,11 de custo do gateway e R$ 11,17 de lucro BRAVUS nas taxas.

O dashboard mostra o lucro dos parceiros e, separadamente, o custo do gateway pago pela BRAVUS e sua margem nas taxas dos parceiros. Os saldos individuais, o fechamento por período e o CSV detalham esses valores. O lucro do parceiro é o valor das vendas aprovadas após os 12%, menos os ADS registrados pela administração e pelo próprio parceiro. **Nenhum ADS de parceiro é descontado do repasse**, inclusive registros antigos. ADS servem somente para controle financeiro, lucro e ROI. Repasses são retiradas do saldo; não são abatidos outra vez do lucro. Ajustes financeiros explícitos e taxas históricas de repasse permanecem identificados separadamente. Atendentes comuns conservam a regra anterior de desconto de ADS.

O custo real do gateway dos parceiros é **5,99% + R$ 1,99 por transação**, arredondado em centavos por venda. **Lucro BRAVUS nas taxas = taxa da venda de 12% − custo real do gateway**. Não se cobra esse custo novamente do parceiro. Em R$ 100: parceiro R$ 88; taxa R$ 12; gateway R$ 7,98; lucro BRAVUS R$ 4,02. Cinco vendas de R$ 100 custam R$ 39,90 de gateway e rendem R$ 20,10 de margem; uma venda de R$ 500 custa R$ 31,94 e rende R$ 28,06. Margens negativas de tickets pequenos são exibidas, sem zerá-las artificialmente. O lucro nas taxas é anterior a outros custos; o fechamento também considera a parte BRAVUS em saques históricos.

Os totais usam todos os registros, sem truncamento pelos limites das listas. O custo real fica salvo em `sales.gateway_cost_cents` no lançamento; parâmetros enviados pelo navegador são ignorados. A migração transacional `partner-provider-cost-599-199-2026-11-11-v1` preenche somente custos ausentes nas vendas antigas dos parceiros, usando a tarifa informada de 5,99% + R$ 1,99, e audita cada registro (`partner.gateway_cost_recorded`). Preserva custos já salvos, valores de venda, taxas de 12%, decisões, comprovantes e pagamentos. Falha desfaz custo, auditoria e marcador juntos; reinícios não repetem a alteração. Esses custos e a margem BRAVUS são exclusivos das APIs administrativas; o portal do parceiro mostra apenas seus próprios valores. Backups incluem o custo salvo e aceitam arquivos antigos sem a coluna; após restaurar um arquivo antigo, reinicie a API para aplicar o preenchimento auditado.

## Regra atual dos parceiros — 11/11/2026

- Todas as contas de parceiro usam **12% por venda**, sem taxa fixa. O parceiro recebe o valor bruto menos essa taxa, arredondada em centavos por venda; uma venda de R$ 100 libera R$ 88 após aprovação.
- A atualização também recalcula **todas as vendas antigas dos parceiros**, preservando comprovantes, valores brutos, datas, checkout original, decisões de aprovação/recusa e cancelamentos. Os saldos, relatórios e ROI passam a usar a regra corrigida. Todos os ADS ficam fora do saldo de repasse.
- O lançamento usa uma gateway automática: o parceiro não escolhe checkout. Rascunhos antigos e pedidos já enviados conservam a chave de idempotência para não duplicar vendas.
- **Novos repasses de parceiros não cobram taxa de saque**, inclusive registros manuais e quitação de pedidos pendentes antigos. O valor debitado é o valor integral do PIX. Repasses já pagos conservam o que foi realmente transferido e as taxas históricas já cobradas.
- A migração `partners-twelve-percent-history-2026-11-11-v1` é executada automaticamente na inicialização da API, dentro de uma transação. Cada venda recalculada registra os valores anteriores e posteriores no histórico (`partner.sale_repriced`). Falha reverte dados e auditoria; reabrir a API não repete a atualização. Após restaurar um backup anterior à regra, reinicie a API para aplicar a migração aos registros recuperados.
- Contas de atendente conservam sua regra de comissão e suas tarifas. Acessos revogados continuam revogados; a atualização não renova tokens nem efetua transferências bancárias.


Portal em português baseado nas capturas fornecidas: tema escuro, lançamento manual de vendas com comprovante, extrato de comissões, ranking, repasses e dados de PIX. Cada atendente tem um token próprio, validado no servidor.

## Simulação de rastreio em HTML

A página está em `public/rastreio.html`: um único arquivo com HTML, CSS e JavaScript incorporados, sem dependências, APIs ou dados de clientes. Pode ser publicado sozinho em qualquer hospedagem estática. No projeto, acesse `/rastreio.html`, `/rastreio` ou `/#/rastreio`.

A primeira abertura cria um código fictício e salva a data/hora real do navegador no cookie `bravus_tracking_demo_v1`, com duração de 365 dias. Reabrir no mesmo navegador e domínio preserva o início. O cronograma usa dias exatos de 24 horas: **recebido por 1 dia**, **em preparação pelos próximos 3 dias**, **em trânsito pelos próximos 5 dias** e **entregue após 9 dias no total**. Datas das etapas são calculadas a partir desse início; a página atualiza mesmo sem recarregar.

Publique o HTML e abra por HTTP/HTTPS para persistir cookies; abrir pelo sistema de arquivos (`file://`) não oferece esse suporte de forma confiável. A página avisa quando os cookies não estão disponíveis. Outro navegador, cookies apagados ou cookie expirado iniciam uma nova simulação. O relógio é o do aparelho; não existe sincronização com servidor.

O layout adapta o rodapé, as quebras de texto e o espaçamento a telas estreitas e em paisagem, respeita fonte ampliada e as áreas seguras do iPhone. As atualizações ocorrem por minuto ou na próxima mudança de etapa, com timers suspensos quando a aba está oculta. A validação no Chromium cobre larguras de 280 a 1024 px, retrato/paisagem, fonte de 100% a 200% e as quatro etapas; não substitui testes em aparelhos físicos.

Para publicar como um site independente, copie `public/rastreio.html` como `index.html` em uma pasta exclusiva. Com a CLI Vercel autenticada, execute nessa pasta `vercel deploy --prod --project rastreiobrasil --create-if-missing --yes`. O projeto usa hospedagem estática, sem API, dependências de instalação ou banco de dados. O nome público depende da disponibilidade na Vercel.

## Vercel: interface e API real

O endereço do site é **https://bravus-omega.vercel.app/**. O repositório inclui uma função Node.js 24 em `api/index.mjs`, gerada a partir de `server/vercel.ts`, e o roteamento `/api/*` em `vercel.json`. A função usa **Turso/libSQL como banco persistente externo**. Não grava dados em `/tmp` nem usa o disco efêmero da Vercel.

**A API só fica operacional depois que as credenciais forem configuradas na conta Vercel.** Sem conexão do banco ou chave administrativa, responde 503 com JSON e não cria um banco temporário. Não há credenciais de Turso ou de administração da Vercel neste ambiente de desenvolvimento; publicar código não cria, por si só, um banco na conta do responsável.

### Ativar o banco e a API na sua conta

1. No [projeto BRAVUS na Vercel](https://vercel.com/bravus5/bravus/stores), abra **Storage**, crie ou conecte um banco **Turso** dedicado ao BRAVUS. Se não aparecer na lista, use a [integração Turso](https://vercel.com/marketplace/turso) ou o [painel Turso](https://app.turso.tech/) e conecte o banco ao projeto.
2. Em **Settings → Environment Variables**, configure para **Production**:

   | Variável privada | Origem |
   | --- | --- |
   | `TURSO_DATABASE_URL` | Endereço `libsql://...` fornecido pelo banco |
   | `TURSO_AUTH_TOKEN` | Token privado do banco, fornecido pela integração |
   | `BRAVUS_ADMIN_KEY` | Sua chave administrativa privada, de 32 a 256 caracteres, sem espaços no começo ou no fim |

3. Faça **Redeploy**. O banco e as tabelas são inicializados automaticamente na primeira conexão, com migrações transacionais. Não é criado nenhum atendente nem venda de exemplo no banco real.
4. Abra **https://bravus-omega.vercel.app/api/health**. A resposta com `"status":"ok"` confirma que a API consultou o banco; `"push":"enabled"` indica que o serviço de notificações foi inicializado. Se responder `configuration_required`, faltam variáveis; se responder `unavailable`, confira a conexão e as credenciais no painel da hospedagem. Nenhum erro público revela chaves.
5. Abra **https://bravus-omega.vercel.app/#/admin**, entre com `BRAVUS_ADMIN_KEY` e cadastre seus atendentes. O painel mostra a situação da API e instruções de conexão antes do login. Entregue a cada atendente apenas seu link individual.

As variáveis ficam somente no servidor; nunca use prefixo `VITE_` para segredos, não as envie no chat e não as publique no Git. Para este modelo, deixe `VITE_API_URL` sem configurar: o site acessa sua API no mesmo endereço. Preview precisa de suas próprias variáveis e de um banco separado para não alterar dados de produção.

A API conserva atendentes, hashes dos tokens, vendas, fotos, comprovantes, ADS, aprovação e repasses entre execuções e deploys. As regras de dinheiro são as mesmas do portal: 50% de participação por padrão, taxas do gateway divididas em 50%, limite de R$ 1.000 no checkout e taxa de saque dividida somente quando o administrador confirma o pagamento. Solicitar repasse não executa PIX; a administração registra um pagamento feito no banco.

Na Vercel, cada envio tem limite de **4 MB de JSON**, respeitando o limite da plataforma. O portal informa esse limite e pede menos vendas ou prints menores quando necessário; cada print continua limitado a 2 MB. O servidor Node local aceita 12 MB. O Web Push é ativado automaticamente na Vercel: o servidor gera um par de chaves e o guarda no banco privado, compartilhado por todas as instâncias e preservado entre publicações. O navegador ainda precisa da permissão e da inscrição do aparelho, concluídas pelo botão de ativação no perfil. É possível fornecer um par próprio estável com `BRAVUS_PUSH_PUBLIC_KEY` / `BRAVUS_PUSH_PRIVATE_KEY`, sempre juntas, e personalizar `BRAVUS_PUSH_SUBJECT`.

O GitHub Pages continua sendo uma interface estática de demonstração, em `docs/`. Tokens reais dependem de uma API: não são autenticados por listas públicas nem por localStorage.

## Alternativa preparada anteriormente: Render

[Abrir implantação do BRAVUS no Render](https://render.com/deploy?repo=https://github.com/luizesantos777/BRAVUS)

O arquivo `render.yaml` prepara interface, API e SQLite no mesmo servidor, com disco persistente de 1 GB e chave administrativa gerada pela hospedagem. **Essa configuração utiliza plano Starter e disco pagos.** Confira o preço apresentado pelo Render antes de confirmar; preparar esse arquivo não contrata nem publica o serviço.

1. Acesse o link, entre ou crie sua conta no Render e conecte o repositório `luizesantos777/BRAVUS`.
2. Revise o serviço e o custo. Confirme a implantação somente se concordar com a contratação.
3. Quando o serviço estiver disponível, abra o endereço HTTPS informado pelo Render e acrescente `/#/admin`.
4. Na seção **Environment** do serviço no Render, obtenha a variável privada `BRAVUS_ADMIN_KEY`. Cole-a apenas no formulário de administração desse servidor. Não a envie no chat nem a publique no GitHub.
5. Cadastre os atendentes, definindo o nome e o token de cada um. A parte do atendente começa em 50% do bruto, menos metade da taxa do gateway. O token pode ser escolhido por você ou gerado pelo sistema. Copie e entregue cada link individual ao atendente correspondente; ele apenas abre esse link para entrar.

O endereço do Render serve o sistema completo; não depende de recompilar o GitHub Pages. Novas versões no Render são implantadas manualmente, pois o blueprint deixa `autoDeploy: false`. O SQLite usa uma única instância com disco persistente, sem escalonamento horizontal. Faça backups privados regulares e mantenha uma cópia fora do disco da aplicação. A recuperação de um backup deve ser planejada antes de usar dados reais.

## Parceiros com taxa de 12%

Na administração, abra **Atendentes → Novo parceiro**, informe o nome e gere o token individual (ou defina um token próprio). A conta aparece como **Parceiro**, abre o **Portal do Parceiro** e acessa somente seus próprios dados, sem permissões administrativas. Renovação de token e revogação funcionam como nos acessos existentes; parceiros ficam fora do ranking de atendentes.

Todas as vendas do parceiro, inclusive as antigas, usam **12% sobre o bruto, sem valor fixo adicional**, e destinam o restante ao parceiro: uma venda de R$ 100 resulta em R$ 12 de taxa e R$ 88 para ele após aprovação. Essa regra substitui o rateio de 50% somente nos parceiros. O gateway é automático, com limite de R$ 3.000 por venda. ADS servem apenas para lucro e ROI, e novos repasses não cobram saque. A BRAVUS registra separadamente seu custo de 5,99% + R$ 1,99 por venda; esse custo não reduz novamente o valor do parceiro.

Essa configuração calcula as taxas e os saldos no BRAVUS; não altera a contratação nem as tarifas cobradas pelo provedor do checkout externo. O tipo da conta é definido pela administração no cadastro e não pode ser alterado pelo perfil do parceiro.

## Executar o sistema completo

Requer Node.js **24 ou superior**. Não há dependências externas de banco ou credenciais obrigatórias para executar localmente.

```sh
npm ci
npm run build
npm start
```

O servidor escuta na porta 3001 por padrão e serve tanto a API quanto a interface. O banco privado é criado em `.bravus/portal.sqlite`; banco, comprovantes e convites ficam fora do Git. Configure `PORT` e `BRAVUS_DB_PATH` conforme a hospedagem. Os comandos carregam `.env` quando esse arquivo existe.

O servidor também gera `.bravus/admin.key`, com permissão de leitura restrita ao usuário do processo, caso `BRAVUS_ADMIN_KEY` não esteja configurada. Reiniciar o servidor preserva essa chave. A chave abre a administração em `/#/admin`; ela permanece apenas na memória do navegador durante a sessão e é removida ao sair ou recarregar. Em produção, use a variável privada da hospedagem e HTTPS.

## Administrar pelo navegador

Em **Atendentes**, a linha de um cadastro revogado oferece **Excluir** quando não há vendas, custos, repasses, lotes enviados ou comprovantes vinculados. A API administrativa revalida essa condição dentro da transação, independentemente do que o navegador mostra. A exclusão usa o ID da conta e preserva contas de mesmo nome. Remove o cadastro vazio, eventuais inscrições antigas de push e o gateway exclusivo sem uso. Não apaga histórico financeiro. O evento `attendant.deleted` permanece na auditoria, com responsável e nome da conta, sem tokens. Ativos precisam ser revogados primeiro; cadastros com histórico continuam revogados ou podem ser reativados. Não há exclusão automática por nome ou apenas por estar revogado.

Somente a administração cadastra atendentes e define seus tokens. O painel permite criar atendentes com token escolhido pelo responsável ou gerado pelo sistema, gerar um novo token para o mesmo atendente, revogar ou reativar acessos, aprovar ou recusar vendas com comprovantes, lançar custos de ADS por atendente e dia, configurar taxas e registrar pagamentos ou cancelamentos de repasses. O novo link individual aparece após a criação ou rotação; a lista de atendentes não revela tokens. A rotação invalida imediatamente o link anterior e preserva o histórico. Revogar bloqueia o acesso sem apagar vendas ou PIX; reativar volta a permitir o token mais recente.

O portal do atendente não tem cadastro nem formulário para digitar tokens. O acesso é feito pelo link individual entregue pela administração. O atendente pode atualizar seus dados pessoais e PIX e registrar vendas, mas não criar contas ou alterar tokens.

Para um pagamento, use **Repasses → Registrar repasse manual** no painel administrativo: selecione o atendente, confira seu PIX, informe o total a debitar do saldo e a observação. O formulário mostra o PIX líquido (total menos R$ 2,50), a taxa do atendente e a parte BRAVUS. Faça a transferência pelo banco e só depois confirme **PIX já realizado**. Abrir ou cancelar a confirmação não movimenta o saldo. O atendente vê os pagamentos no histórico e não solicita repasses.

A atualização `admin-manual-payouts-v1` cancela automaticamente as solicitações ainda em análise, zera suas taxas e libera as reservas. Preserva IDs, histórico e todos os pagamentos já realizados, com auditoria na mesma transação. A rotina é idempotente entre reinícios e instâncias. Assim, um saldo de R$ 19,47 com uma antiga reserva de R$ 65,79 volta a R$ 19,47, sem criar crédito ou alterar vendas e ADS.

## Aprovar vendas e lançar ADS

Abra `/#/admin` e entre com sua chave administrativa. A aba **Aprovar vendas** abre a fila de lançamentos pendentes, com filtros por atendente e situação, paginação de 50 itens e visualização privada dos prints. Cada venda mostra bruto, taxa, parte BRAVUS e o valor do atendente. **Aprovar venda** libera a comissão; **Recusar venda** exige um motivo, exibido no histórico do atendente. A decisão registra data e observação e só pode ser aplicada uma vez. Um token de atendente não autoriza decisões ou leitura administrativa de comprovantes.

A visão administrativa mostra **Faturamento aprovado** e **Saldo disponível para repasse** de todo o histórico. Em **Atendentes → Ver faturamento e repasses**, ou **Repasses → Atendente dos saldos**, consulte faturamento, comissão, ADS/ajustes, PIX pagos, taxas de saque e saldo individual, incluindo acessos revogados. O cálculo usa todos os registros; o limite de 100 itens do histórico de custos não reduz o saldo. Pendentes, recusadas e canceladas ficam fora do faturamento aprovado. A atualização do painel renova saldos e fechamento, preservando os filtros do relatório. O filtro do atendente também se aplica ao histórico de pagamentos.

Novas vendas entram **Em análise**. Apenas as aprovadas entram no faturamento consolidado, nas taxas financeiras, no ranking e na comissão disponível para repasse. Pendentes e recusadas continuam visíveis no histórico do atendente, com seu estado e motivo. As vendas existentes antes dessa funcionalidade são mantidas como aprovadas para preservar o histórico e os saldos; a migração não apaga nem recalcula suas taxas. Não há meta diária para liberar comissões.

Para corrigir uma aprovação feita por engano, abra **Aprovar vendas → Situação da venda: Aprovadas → Cancelar venda aprovada**, informe o motivo obrigatório e confirme. A venda passa a **Cancelada** no painel e no histórico do atendente e sai do faturamento, do ranking e da comissão liberada. O registro, o comprovante e as taxas originais ficam preservados; o histórico registra a aprovação anterior, o motivo, o responsável e a comissão retirada em uma transação. Não há reaprovação direta nem cancelamento repetido. No banco, uma venda cancelada usa `status = 'rejected'`, com identificação pelo evento imutável `sale.cancelled`; a API devolve `cancelledAt`, e o filtro **Recusadas / canceladas** permite encontrá-la sem mudar o esquema dos backups antigos. ADS, ajustes e repasses pagos continuam registrados; o cancelamento pode deixar saldo negativo. Um novo repasse manual é recusado quando ultrapassa o saldo disponível. Cancelar a venda não executa devolução de PIX nem apaga pagamentos realizados.

Na aba **Custos ADS**, selecione a conta e a data, confira os valores carregados e salve os anúncios e eventuais ajustes adicionais de taxas. Salvar substitui o total anterior da data. Para parceiros, ADS são apenas controle financeiro de lucro e ROI, sem desconto do repasse; ajustes explícitos continuam debitados. Para atendentes comuns, ADS entram no saldo e podem gerar saldo negativo, e o saque cobra R$ 2,50 de cada parte somente no pagamento. Não lance novamente essa tarifa automática nos ajustes. Parceiros não cobram saque nos novos repasses. O histórico mostra os últimos 100 registros; selecione a conta e a data para consultar outros dias.

O link público `https://luizesantos777.github.io/BRAVUS/#/admin` oferece **Ver painel de demonstração**, sem pedir a chave real. Essa prévia usa somente dados de exemplo do navegador e não autentica usuários reais nem faz chamadas administrativas à API. Ao abri-la pela primeira vez sem vendas de demonstração, são criados exemplos identificados e comprovantes marcados **SEM TRANSAÇÃO REAL**. Aprovações e ADS da prévia refletem no portal de demonstração do mesmo navegador. Cadastro de contas, tokens, configuração de tarifas e pagamentos reais continuam exclusivos do painel autenticado na API hospedada. Na Vercel, a API real usa Turso após a configuração das variáveis acima; a prévia continua separada dos dados reais.

## Meus Dados e PIX

A aba segue a referência fornecida com a identidade BRAVUS em preto, verde e dourado: notificações no aparelho, foto, nome/apelido, alerta de venda com prévia, chave PIX e titular. Para abrir diretamente, acrescente `?aba=perfil` antes do fragmento do link individual; na demonstração, use `https://luizesantos777.github.io/BRAVUS/?aba=perfil`.

O atendente pode alterar seu apelido, foto e PIX sem modificar seu ID, comissão ou token. A foto aceita PNG, JPEG ou WEBP de até 4 MB e é recortada ao centro e reduzida para 256 × 256 antes do envio. O servidor valida formato e limite de 256 KB; SVG e endereços externos são recusados. A foto aparece no perfil e no ranking para os demais atendentes. PIX e titular permanecem privados.

O texto do alerta admite `{valor}`, `{qtd}` e `{nome}`; a prévia se atualiza enquanto você escreve. O envio de um lote usa o total e a quantidade de vendas efetivamente salvas. O campo de PIX identifica o tipo e permite confirmá-lo, inclusive quando CPF e telefone têm o mesmo número de dígitos. **Salvar Alterações** persiste os dados na API; na demonstração, salva somente naquele navegador.

### Notificações de venda

O botão pede permissão ao navegador e ativa os alertas apenas naquele aparelho. O uso real exige HTTPS, navegador com suporte a Web Push e API hospedada. No iPhone e iPad, requer **iOS/iPadOS 16.4 ou superior** e o BRAVUS instalado na Tela de Início: abra o link no **Safari**, toque em **Compartilhar → Adicionar à Tela de Início**, abra pelo novo ícone e então ative os alertas. O navegador interno do WhatsApp e uma aba normal do Safari não oferecem esse modo de notificações. O cartão identifica essa situação e apresenta **Como ativar no iPhone** com os passos, em vez de pedir uma permissão indisponível naquela aba. Na demonstração, somente os lançamentos de teste feitos naquele navegador exibem notificações locais; não há recebimento de vendas de terceiros.

O projeto inclui manifestos com `display: standalone`, ícones PNG 192/512 e ícone Apple de 180 pixels. Todos os acessos usam a mesma raposa Lucro Certo: favicon, atalhos Android/iPhone, administração, links individuais dos atendentes e notificações. Os antigos endereços de ícones também servem a nova imagem. O HTML inclui Open Graph e Twitter Card com uma imagem pública absoluta para prévias de compartilhamento, sem informações pessoais ou tokens. Navegadores, apps instalados e serviços de compartilhamento podem manter uma imagem anterior em cache; no iPhone, um atalho antigo pode precisar ser adicionado novamente usando o mesmo link individual.

A administração usa `admin.webmanifest`, com abertura em `/#/admin`, sem credenciais. Ao abrir o app instalado, entre com a chave administrativa para ativar ou consultar seus alertas; essa chave continua apenas na memória da sessão. O manifesto geral omite `start_url` para usar o endereço de instalação como fallback, preservando o link individual do atendente em vez de direcionar ao modo público. Não coloque tokens de atendentes em arquivos públicos de manifesto. O service worker continua dedicado às notificações, sem armazenar páginas privadas ou respostas da API em cache.

Se um iPhone atualizado e já instalado continuar indicando indisponibilidade, use **Verificar notificações** no próprio cartão. A verificação mostra se o acesso está em modo app ou navegador, quais recursos o aparelho disponibilizou, a permissão e a conexão autenticada com o servidor. Ela apenas consulta: não solicita permissão, não registra aparelhos e não exibe chaves, tokens ou endereços de inscrições. O estado também é consultado novamente ao retornar dos Ajustes ou retomar o app. A ativação reutiliza uma permissão já concedida. Os testes dessas condições simulam os recursos do iPhone no Chromium; a entrega precisa ser confirmada no aparelho físico.

Na API, as inscrições pertencem ao atendente autenticado, com limite de cinco aparelhos. Cada lote novo salvo envia o alerta personalizado aos seus aparelhos com título **Lucro Certo · Nova venda aprovada** e ícone Lucro Certo, mesmo com a página fechada, conforme suporte e permissões do dispositivo. O corpo continua usando o texto escolhido em Meus Dados e PIX; o título solicitado não altera a situação da venda, que aguarda análise. Uma repetição idempotente não dispara novamente. Erros de entrega não desfazem a venda; inscrições expiradas são removidas. Trocar o token ou revogar o acesso remove as inscrições, exigindo nova ativação pelos aparelhos autorizados.

O responsável também pode receber novas vendas no celular: abra `/#/admin`, entre com sua chave e toque em **Ativar alertas de vendas no meu celular**. O alerta chega quando qualquer atendente registra um lote novo, com título **Lucro Certo · Nova venda aprovada**, mensagem **Você recebeu R$ 149,90** (substituída pelo valor bruto real do lote) e ícone PNG da raposa Lucro Certo enviada pelo responsável. A instalação administrativa usa o nome **GESTÃO**; o app do atendente usa **Lucro Certo**, nos manifestos Android e nos nomes dos atalhos Apple. O portal conserva a identidade visual BRAVUS. Esse é o texto solicitado para o alerta: as vendas continuam em análise até a decisão manual, sem alterar comissões. Aprovar ou recusar depois não gera outro alerta administrativo. Ao tocar na notificação, abre a administração e pede login quando necessário. O formato, a posição do nome do app e a exibição do ícone seguem o sistema do celular; Web Push não permite controlar o subtítulo nativo do iOS. Ao abrir ou retomar o portal, recuperar a conexão e a cada hora em primeiro plano, uma inscrição já existente busca a nova versão do serviço de notificações. O mesmo endereço do serviço, os IDs dos apps, os links individuais e as inscrições são preservados. Os manifestos e o script de notificações exigem revalidação de cache no servidor Node e na Vercel; a ativação usa `updateViaCache: none`. A atualização não recarrega formulários, pede permissão novamente ou cria outra inscrição. O nome Lucro Certo também aparece no título do aviso, inclusive quando o celular ainda mostra um nome antigo como remetente. O sistema do aparelho controla a atualização do nome de apps instalados: alguns navegadores pedem confirmação, e atalhos antigos do iPhone podem precisar ser adicionados novamente. Não é possível forçar a renomeação do ícone da Tela de Início pelo site. Novas instalações recebem o nome correspondente ao painel pelo manifesto e pela metatag Apple.

Os aparelhos administrativos ficam em `admin_push_subscriptions`, separados dos atendentes e vinculados ao hash da chave administrativa atual, com limite de cinco aparelhos por acesso. Somente a chave administrativa autoriza cadastrar, consultar ou remover essas inscrições. Trocar a chave exige ativar novamente os alertas administrativos. A chave administrativa não é guardada no navegador nem enviada nas notificações. As inscrições permanecem até desativar no aparelho, inclusive com o painel fechado. Desativar os alertas pessoais do atendente no mesmo navegador preserva os alertas administrativos, e vice-versa.

No modo SQLite local, o servidor cria `push-keys.json` ao lado do banco, com permissão `600`, e reutiliza esse par de chaves VAPID ao reiniciar; preserve esse arquivo em backup privado separado do SQLite. Com Turso, inclusive na Vercel, as chaves automáticas ficam na tabela privada `push_server_keys`: a criação é transacional para evitar pares diferentes em instâncias simultâneas. Os backups desse banco passam a conter também a chave privada de notificações e devem permanecer privados. Também é possível configurar `BRAVUS_PUSH_PUBLIC_KEY` e `BRAVUS_PUSH_PRIVATE_KEY` nas variáveis privadas da hospedagem, sempre juntas e sem prefixo `VITE_`; esse par explícito tem prioridade. Somente a chave pública é fornecida à interface. `BRAVUS_PUSH_SUBJECT` aceita o endereço HTTPS do responsável ou um contato `mailto:`; por padrão usa a URL deste repositório. As assinaturas e o conteúdo são enviados pelo protocolo Web Push criptografado aos provedores dos navegadores; a hospedagem precisa permitir essas conexões de saída. O proxy HTTPS do ambiente é respeitado quando configurado.

Para desenvolvimento com recarga da interface, use dois terminais:

```sh
npm run dev:api
```

```sh
npm run dev
```

O Vite usa a porta 5173 e encaminha `/api` para a API na porta 3001. No ambiente Codex, use `npm --cache /workspace/.cache/npm ci` para manter o cache em um diretório gravável. Use o checkout existente em `/workspace/BRAVUS`; cada tarefa já é isolada, sem necessidade de worktrees.

## Criar os tokens dos atendentes

Crie cada atendente no servidor que hospeda o banco. A parte padrão do atendente é **50% do valor bruto, menos metade da taxa do gateway**. A administração pode definir outro percentual explicitamente. Sem `--commission`, o cadastro usa 50%.

```sh
npm run manage -- create-attendant --name "Nome do atendente" --commission 50 --base-url https://seu-portal.example
```

O comando gera 32 bytes aleatórios para o token, salva somente o hash no banco e grava o link do atendente em um arquivo privado em `.bravus/invites/`. O token não aparece nos logs. O operador deve obter esse arquivo por um canal privado da hospedagem e entregar o link apenas ao atendente. Não publique os convites, o banco ou backups no GitHub. A API de criação de atendentes exige a chave administrativa.

O portal aceita links no formato `/#/atendente/<TOKEN_PRIVADO>` e `/atendente/<TOKEN_PRIVADO>`. No GitHub Pages, use o formato com `#`, preservando o caminho `/BRAVUS/`. O rodapé permite copiar o link do próprio atendente.

Listar IDs e nomes, sem revelar os tokens:

```sh
npm run manage -- list-attendants
```

Revogar um acesso, preservando seu histórico:

```sh
npm run manage -- revoke-attendant --id ID_DO_ATENDENTE
```

Para substituir um token preservando o mesmo atendente e histórico, use **Novo token** no painel administrativo.

## Configurar taxas, custos e repasses

### Gateway exclusivo por parceiro

Um checkout com ID `exclusive_` seguido do ID do atendente pertence somente àquela conta. Atendentes com gateway exclusivo não acessam os demais checkouts. Para parceiros, a regra atual padroniza todas as vendas em 12%, com gateway automático, e oculta o cartão de PIX manual.

A configuração solicitada em 06/11/2026 identifica o parceiro pelo hash do token fornecido, sem gravar seu link privado no código. A migração cria o gateway com **12% por venda, R$ 0,00 de taxa fixa e limite de R$ 3.000,00 por venda**. A associação permanece ligada ao ID da conta após renovação do token. As migrações posteriores de 11/11/2026 padronizam a tarifa dos parceiros, inclusive vendas antigas, e registram separadamente o custo real pago pela BRAVUS, conforme as regras no início deste documento. Tarifas globais dos atendentes são preservadas.

Esse acesso apresenta **Portal do Parceiro** e **Acompanhe suas vendas e pagamentos.** no cabeçalho. A migração mantém o ID e token e converte esse cadastro para parceiro. Todos os parceiros recebem **100% do bruto menos a taxa da venda de 12%, sem rateio de 50%** (R$ 88 em R$ 100), incluindo as vendas antigas. O extrato mostra faturamento aprovado, taxas das vendas, ADS, lucro após ADS, ROI e saldo para repasse. Os demais atendentes mantêm suas comissões e tarifas.

**Novos repasses dos parceiros não têm taxa de saque.** O extrato e **Meus Repasses** preservam taxas históricas já pagas, sem aplicá-las novamente. Somente os atendentes comuns continuam com o rateio de saque de R$ 2,50 para cada parte.

O build gera **`parceiro.html`**, com título, descrição, Open Graph e Twitter de **Portal do Parceiro** já no HTML público, sem incluir nenhum token. Os convites de parceiros usam essa entrada; links antigos continuam funcionando e, após autenticar, passam a usar a página do parceiro conservando o token no fragmento `#`. A URL canônica permanece dentro da mesma origem e preserva o ID do app e o armazenamento dos rascunhos. Sem token, essa página mostra apenas uma orientação para usar o acesso individual. O HTML principal começa com uma identificação neutra; depois da autenticação, os metadados acompanham o tipo da conta. O roteador não sobrescreve o título escolhido pelo portal ao voltar da administração. Prévias de links antigos em serviços externos podem manter cache e não recebem o fragmento privado; para novas prévias de parceiro, use o link copiado após abrir o portal ou gerado pela administração.

Na aba **ADS e ROI**, o parceiro informa e edita o total de anúncios pago por ele em cada dia. Esse valor é guardado separadamente em `costs.partner_ads_cents` e **não é descontado do saldo de repasse**. Salvar substitui o total próprio da data; informar zero limpa esse gasto. O parceiro não pode alterar os ADS ou ajustes registrados pela administração, nem ler ou editar os custos de outra conta. Atendentes comuns não têm acesso a essa função. Os endpoints autenticados `GET /api/partner/ads?date=...` e `POST /api/partner/ads` usam sempre a conta do token; alterações geram auditoria com o ator do parceiro.

O ROI considera a participação real do parceiro nas **vendas aprovadas após as taxas**, menos os ADS próprios e os ADS registrados pela administração no mesmo período: **ROI = (valor após taxas − ADS total) / ADS total × 100**. Nenhum desses ADS reduz o saldo de repasse. O indicador não usa o faturamento bruto como se fosse lucro, nem desconta repasses e ajustes. Sem investimento em ADS, mostra “—”; um investimento sem vendas aprovadas mostra −100%. O seletor do extrato controla também o período do ROI. O histórico exibe até 100 dias, mas os totais usam todos os registros. Os backups incluem o novo campo; arquivos anteriores restauram ADS próprio com zero.

Rascunhos ainda não enviados passam a selecionar o gateway permitido preservando os campos e prints. Uma tentativa já enviada e aguardando confirmação conserva o conteúdo e o identificador originais até a resposta do servidor, para confirmar um recebimento anterior sem criar outra venda.

### Rascunhos de vendas e comprovantes repetidos

O formulário guarda automaticamente data, valores, checkout, horários, observações e prints em **IndexedDB neste aparelho**, separado por link individual e endereço da API. O token não é gravado nesse armazenamento: o namespace usa SHA-256. Os prints ficam separados dos campos para que digitar não regrave imagens grandes. A mensagem **Rascunho salvo neste aparelho** aparece somente após a confirmação da gravação. Ao recarregar ou voltar à aba de vendas, o preenchimento é recuperado; **Descartar rascunho** remove apenas os dados locais desse acesso. Rascunhos não são enviados ao administrador, não fazem parte dos backups do servidor e não acompanham o vendedor em outro aparelho. Limpar os dados do navegador remove esses rascunhos.

Antes de enviar, o app guarda o identificador e os dados da tentativa. Se a resposta se perder, conserva os campos e prints, apresenta **Confirmar envio** e repete a mesma tentativa, sem criar outra venda. Dados aguardando confirmação ficam preservados para a retomada. O rascunho só é limpo após a API confirmar o recebimento; a repetição também funciona caso as tarifas tenham sido alteradas nesse intervalo. Duas abas não podem sobrescrever silenciosamente a mesma versão do rascunho. Falhas de armazenamento são exibidas, e o envio aguarda a gravação do rascunho para manter essa proteção. A demonstração tem identificação de envios própria, separada dos dados reais.

Na **Aprovação de vendas**, o administrador recebe um aviso de **Possível venda duplicada** quando os bytes completos do print coincidem com outro comprovante. Pode consultar os vendedores, datas, valores e situações relacionados antes de decidir, inclusive em outras páginas, períodos e contas. O aviso também aparece na confirmação da aprovação. As situações das vendas e seus valores não são alterados automaticamente. O alerta é exclusivo do administrador; o portal individual não recebe dados de outros vendedores.

A comparação confere arquivos idênticos, mesmo com nomes diferentes; não faz OCR nem garante reconhecer recortes ou imagens alteradas. Índices compactos por tamanho e trechos do arquivo limitam os candidatos, mas somente a igualdade do conteúdo completo gera o aviso. A consulta reúne os resultados da página em lote e inclui até cinco referências por venda. Não foram adicionadas colunas ou tabelas ao banco, preservando a compatibilidade dos backups e das vendas anteriores.

A aba **Lançar Vendas** apresenta o checkout oficial `https://pagamento.bravuspix.shop/checkout`, com **Abrir checkout** em uma nova aba e **Copiar link** para enviar ao cliente. O endereço é aberto como fornecido, sem anexar tokens do atendente. O lançamento das vendas e dos comprovantes continua manual no portal.

O **Checkout Buckpay** tem configuração própria em **Administração → Taxas**, com **6,99% + R$ 1,69 por venda**, separado do checkout principal e do PIX manual. Como já está integrado ao checkout existente, não há novo link ou cartão de pagamento. O atendente seleciona **Checkout Buckpay** ao lançar a venda; o servidor calcula a taxa por transação e mantém a divisão de 50% entre atendente e BRAVUS. Exemplo: R$ 100,00 gera R$ 8,68 de taxa total, R$ 4,34 para cada parte e R$ 45,66 para o atendente antes de ADS e repasse. Mantém o limite atual do checkout, de R$ 1.000,00 por venda. A migração `checkout-buckpay-v1` cadastra a opção uma única vez, preserva os demais checkouts e não altera vendas anteriores ou ajustes posteriores de tarifas.

A aba **Lançar Vendas** exibe a chave de recebimento do PIX manual fornecida pelo responsável, com botão **Copiar chave PIX**. O campo é somente leitura e também permite selecionar e copiar manualmente caso o navegador bloqueie a área de transferência. Essa chave se destina ao recebimento das vendas; o PIX do perfil do atendente continua sendo o destino dos seus repasses.

O PIX manual aplica automaticamente **6,99% + R$ 1,69 por venda**, conforme a tabela fornecida, para vendas a partir de R$ 5,00. Todas as faixas informadas usam essa mesma tarifa. O percentual é arredondado para centavos em cada venda e a taxa fixa é adicionada a cada transação, inclusive em lotes. Exemplo: R$ 100,00 gera R$ 8,68 de taxa; dividindo a taxa em R$ 4,34 para cada parte, o atendente fica com **R$ 45,66**, antes de ADS e saque.

A prévia mostra o valor previsto para a conta antes de ADS, sem detalhar taxas. O histórico apresenta bruto, valor da conta, situação e comprovante. O servidor continua recalculando pela configuração do checkout e guardando a taxa na venda; valores de taxa enviados pelo navegador não são usados. Os detalhes das tarifas e do rateio continuam visíveis na administração.

O **Checkout principal** recebe vendas de **até R$ 1.000,00**, inclusive, com a tarifa informada pelo responsável:

| Valor de cada venda | Taxa variável | Taxa fixa por transação |
| --- | --- | --- |
| Até R$ 1.000,00, inclusive | 15% | R$ 1,99 |
| Acima de R$ 1.000,00 | Não disponível neste checkout | — |

Uma venda de R$ 1.000,00 gera taxa de R$ 151,99; a metade da taxa atribuída ao atendente é R$ 76,00, então ele fica com **R$ 424,00**, antes de ADS e saque. Valores maiores são recusados tanto na interface quanto na API. A validação se aplica a cada venda e rejeita todo o lote se algum item ultrapassar o limite; o navegador não pode remover esse limite enviando dados manipulados. O percentual é arredondado em centavos e a taxa fixa é adicionada por transação. Reserva financeira informada: 0%.

O cartão do checkout mostra o limite e o cartão do PIX manual informa o valor mínimo, sem apresentar tarifas de venda. Antes de enviar, cada lançamento mostra o valor previsto para a conta; o servidor recalcula usando sua configuração. A administração permite ajustar tarifas sem alterar o limite de recebimento do checkout. Faixas opcionais devem começar abaixo desse limite. As migrações preservam taxas e decisões já registradas; o limite e a retirada da antiga faixa acima de R$ 1.000 são aplicados uma única vez.

```sh
npm run manage -- set-checkout --id main --name "Checkout principal" --fee 15 --fixed-fee 1.99 --minimum 0.01 --above ""
npm run manage -- set-costs --attendant ID_DO_ATENDENTE --date 2026-10-21 --ads 20 --withdrawal-fee 2
npm run manage -- mark-payout --id ID_DO_REPASSE --status paid --note "Pagamento conferido pela administração"
```

O comando `mark-payout` permanece apenas para compatibilidade com registros históricos. Novos pagamentos são registrados no painel administrativo. O BRAVUS não executa PIX ou integração bancária.

### Regras implementadas

- Valores são armazenados em centavos inteiros. São aceitos `197,00`, `197.00` e `1.250,50`.
- Novas vendas: **valor do atendente = sua parte do bruto (50% por padrão) − metade da taxa total do gateway**. A BRAVUS assume a outra metade da taxa, inclusive o componente fixo. Primeiro calcula-se a taxa completa por venda, depois a metade do atendente é arredondada para centavos e a BRAVUS fica com o restante. Exemplo do checkout: taxa total R$ 16,99, parcela do atendente R$ 8,50, BRAVUS R$ 8,49. Atendente: R$ 50,00 − R$ 8,50 = **R$ 41,50**. BRAVUS após taxas: R$ 41,51. Percentual, tarifa, fórmula e parcela da taxa ficam registrados na venda; o navegador não pode alterá-los. Vendas antigas conservam sua fórmula e seu percentual originais, incluindo as ainda em análise, para preservar o histórico. A migração anterior ajustou os perfis existentes para 50% uma única vez; alterações posteriores da administração são preservadas. Registros anteriores ao rateio mantêm o desconto integral da taxa e são identificados como regra anterior.
- Todas as vendas aprovadas geram comissão, sem meta diária ou faturamento mínimo. Novos lançamentos aguardam análise; o histórico anterior à aprovação manual permanece aprovado. Os dias seguem o fuso America/Sao_Paulo.
- Custos ADS e ajustes adicionais de taxas são descontados do saldo e podem gerar saldo negativo. A taxa automática de saque não deve ser lançada novamente nos custos diários.
- A taxa de **R$ 5,00 do gateway é dividida em R$ 2,50 para cada parte**, somente ao registrar um pagamento manual já realizado. Do total informado pelo administrador, R$ 2,50 são a parcela do atendente: um débito de R$ 41,50 corresponde a **R$ 39,00 enviados no PIX**. A BRAVUS assume os outros R$ 2,50. O atendente não cria pedidos nem define taxas. O registro é atômico, exige saldo e PIX cadastrados, e usa idempotência para que repetição ou reconexão não debite duas vezes. Repasses pagos mantêm suas tarifas históricas.
- O extrato tem filtros de período; o saldo disponível permanece acumulado. O ranking mostra nome, foto e volume de vendas aprovadas de atendentes ativos, sem tokens ou PIX.
- Cada venda exige um print. O seletor aceita imagens de até 20 MB e reconhece PNG, JPEG e WEBP pelo conteúdo, mesmo quando a galeria não informa o tipo. Imagens acima de 2 MB são reduzidas no aparelho para JPEG (lado maior de até 3.200 pixels, com redução adicional quando necessária); o atendente pode conferir a prévia antes do envio. HEIC é convertido quando o navegador consegue abri-lo; caso contrário, a orientação é anexar uma captura de tela em PNG/JPG. Enquanto prepara o anexo, o portal bloqueia o envio e mostra o progresso; falhas aparecem junto à venda, sem reutilizar um anexo anterior. O servidor continua validando formato e limite de 2 MB por comprovante. Cada envio aceita até 10 vendas de forma atômica, com até 12 MB de JSON no servidor local ou 4 MB na Vercel.
- Um identificador de envio evita duplicar vendas em tentativas repetidas com o mesmo conteúdo.

## Hospedar para uso real

Use uma hospedagem que execute Node.js 24 como processo contínuo e disponha de **volume persistente** para o SQLite. Configure o caminho do banco nesse volume. Hospedagens que apagam o disco em cada deploy ou funções serverless sem banco externo não são adequadas para este armazenamento.

Fluxo de implantação em uma hospedagem compatível:

```sh
npm ci
npm run build
npm start
```

Publique o servidor com HTTPS. Faça backups regulares do banco e dos arquivos de convite por um canal privado; para backup com o servidor em execução, use a API de backup do SQLite ou uma ferramenta compatível com WAL. Não copie somente o arquivo principal enquanto houver gravações.

O comando abaixo usa a API de backup online do SQLite e pode rodar com o servidor ligado. Inclui atendentes, hashes dos tokens, vendas, comprovantes, PIX e repasses em um arquivo privado; preserva o banco original e recusa sobrescrever um backup existente.

```sh
npm run manage -- backup
```

Para definir o destino, use `--output /caminho/privado/backup.sqlite`. Esse backup contém dados pessoais, fotos e inscrições de notificações: mantenha-o fora dos diretórios públicos. A chave administrativa, as variáveis privadas da hospedagem, os arquivos de convites e, no modo Node local, `push-keys.json` devem ser preservados separadamente. No Turso/Vercel, as chaves VAPID automáticas ficam no banco e são incluídas na cópia.

A opção mais simples é servir interface e API no mesmo servidor, usando o endereço da hospedagem nos convites. Para manter a interface no GitHub Pages e hospedar apenas a API em outro domínio:

1. Configure `VITE_API_URL=https://seu-servidor.example/api` ao compilar a interface.
2. No servidor, configure `BRAVUS_ALLOWED_ORIGINS=https://luizesantos777.github.io` (origem sem `/BRAVUS/`).
3. Gere novamente a interface com `npm run build:pages`, envie `docs/` e aguarde a publicação.

Consulte `.env.example`. `VITE_API_URL` é um endereço público e não pode conter senhas ou tokens.

## Fechamento financeiro e histórico administrativo

A fila de vendas e os indicadores administrativos consultam o servidor automaticamente a cada dez segundos enquanto o painel está visível e ao retornar à janela ou recuperar a conexão. As consultas frequentes usam `dashboard?refresh=1` sem executar backups. Na virada do dia, a primeira atualização usa a rotina diária uma vez, preservando o backup ao acessar o painel mesmo sem novo login. A atualização preserva a análise e observações em andamento. Quando filtros ou paginação podem esconder pendentes, **Ver todas em análise** limpa a seleção; o indicador superior também abre todas as pendentes. **Ver todas as vendas recebidas** consulta novamente todos os atendentes e situações. Falhas de consulta são apresentadas como erro com nova tentativa, sem uma mensagem enganosa de lista vazia. A demonstração informa expressamente que suas vendas ficam somente no navegador, e links individuais malformados falham na autenticação em vez de abrir uma demonstração.

As abas **Fechamento**, **Histórico** e **Backups** exigem a chave administrativa existente. O acesso do atendente não permite consultar relatórios, eventos ou cópias. O fechamento aceita datas inicial/final e filtro por atendente, inclui somente vendas aprovadas e mantém a fórmula e o rateio originais de cada venda. ADS e ajustes entram pela data do custo; repasses e suas taxas entram pelo dia do pagamento em `America/Sao_Paulo`. Vendas pendentes e recusadas aparecem somente na contagem informativa.

O lucro BRAVUS é faturamento menos o custo real do gateway, o valor após taxas destinado à conta e a parte BRAVUS dos saques pagos. Para parceiros, o custo real é 5,99% + R$ 1,99 por transação; a diferença dos 12% é a margem BRAVUS, antes de outros custos. Para atendentes, o custo mantém as taxas registradas originalmente. ADS dos parceiros são somente controle de lucro e ROI, sem desconto do saldo ou do caixa de repasses; ADS dos atendentes conservam seu desconto. A movimentação de caixa desconta os custos reais do gateway, os ajustes, os PIX pagos, saques históricos e os ADS aplicáveis aos atendentes. Repasses liquidam valores já reconhecidos e não são descontados novamente do lucro. O CSV usa centavos inteiros na origem, ponto e vírgula, BOM UTF-8 e proteção contra fórmulas em nomes; não contém PIX, tokens ou credenciais.

O histórico é paginado e filtrável por período/ação. Registra responsável, alvo, data, valores anteriores e novos para aprovação/recusa, ADS/ajustes, taxas, confirmação/cancelamento de repasse e gestão de atendentes. A mudança e o evento são gravados na mesma transação: uma falha no registro desfaz a alteração. Eventos não podem ser editados ou apagados pelas operações normais do banco. Tentativas inválidas e decisões repetidas não criam registros de sucesso. Tokens, hashes dos tokens, fotos, comprovantes e chaves não são gravados no histórico. O recurso começa a registrar após esta atualização; não inventa autoria de alterações antigas. O responsável autenticado pela chave atual aparece como **Administrador**; o terminal é identificado separadamente.

## Backups automáticos e recuperação

Na **Vercel**, conecte ao projeto BRAVUS um armazenamento **Blob com acesso Private** em **Storage**. A integração configura `BLOB_READ_WRITE_TOKEN` no servidor; confirme o ambiente **Production** e faça o redeploy da implantação mais recente. Nunca use um Blob público nem coloque o token no código ou no chat. Sem armazenamento configurado, o painel informa a pendência e não apresenta cópias fictícias. Também não usa o disco temporário da Vercel como destino.

Com o armazenamento conectado, o primeiro acesso administrativo de cada dia cria uma cópia automaticamente. Para executar todos os dias mesmo sem acesso ao painel, configure também `CRON_SECRET` com um segredo aleatório de pelo menos 32 caracteres nas variáveis privadas de Production e faça o redeploy. `vercel.json` agenda `/api/cron/backups` às **06:00 UTC / 03:00 de Brasília**. A Vercel envia o segredo no cabeçalho; chamadas sem ele são recusadas. Não coloque o segredo na URL. A aba Backups mostra a modalidade efetivamente configurada. O agendamento é diário, compatível com a frequência do plano Hobby; a disponibilidade e o consumo do Blob seguem o plano da conta.

No servidor Node com SQLite persistente, as cópias ficam por padrão em `.bravus/automatic-backups/`, com diretório `700` e arquivos `600`, criadas na inicialização e verificadas a cada hora para completar a cópia diária. Esse destino é independente do arquivo principal, mas continua no mesmo servidor; configure Blob privado para proteção fora dele. **Criar cópia agora** permite uma cópia adicional manual. As cópias usam JSON comprimido com Gzip, incluindo comprovantes, dados financeiros, hashes dos tokens, inscrições, histórico e as chaves push armazenadas no banco. Não incluem a chave administrativa ou variáveis de conexão.

Cada execução captura uma visão consistente em transação de leitura, grava no armazenamento privado, baixa a cópia, compara SHA-256 e a restaura em um banco separado em memória. A verificação confere estrutura, número de registros, integridade SQLite e referências. Somente depois disso marca **Verificada** e permite remover cópias com mais de 30 dias. Falhas preservam as cópias válidas anteriores. Um bloqueio persistente impede execuções concorrentes; o mesmo backup diário não é duplicado entre instâncias. Os arquivos recebem identificadores únicos e não são sobrescritos, inclusive após recuperar um catálogo antigo. A cópia inclui o catálogo disponível e reconhece sua própria recuperação. O limite atual é de 128 MB de conteúdo antes da compressão; se o volume crescer além dele, amplie o processo de backup antes de depender da rotina. Downloads exigem autenticação administrativa e não usam URLs públicas permanentes.

Para recuperar uma cópia baixada, use um **arquivo novo** fora de pastas públicas:

```sh
npm run manage -- restore-backup --input /caminho/privado/backup.json.gz --output /caminho/privado/recuperado.sqlite
```

O comando valida a cópia antes de criar o destino, recusa sobrescrever arquivos e testa as relações e integridade do banco. Nunca restaura sobre o banco ativo. Confira os saldos e o histórico no banco recuperado antes de escolher uma troca em produção. Para recuperar a operação em Turso, use o banco SQLite recuperado como origem na importação para um **novo** banco Turso e depois revise a conexão da implantação. Preserve também a configuração privada da hospedagem e, no modo Node local, o arquivo VAPID separado. A recuperação da cópia tem cobertura automática com dados fictícios; o Blob da conta precisa estar conectado para a primeira verificação real na nuvem.

Para arquivos maiores, o download em Blob usa uma autorização temporária de **dois minutos**, restrita a **GET daquela cópia exata**, criada somente após autenticar o administrador e conferir o status Verificada. O navegador baixa diretamente do Blob privado, evitando transportar todo o arquivo pela resposta da função da Vercel. O token de escrita do armazenamento não sai do servidor. As URLs temporárias e os dados da cópia não são incluídos no histórico nem em respostas públicas.

## API

As respostas privadas usam `Cache-Control: no-store`. A autenticação usa o cabeçalho `Authorization: Bearer <credencial>`, nunca uma lista pública de tokens. O servidor aceita a própria origem e as origens explicitamente configuradas em `BRAVUS_ALLOWED_ORIGINS`.

| Método e rota | Credencial | Função |
| --- | --- | --- |
| `GET /api/health` | Nenhuma | Verificar servidor e conexão SQLite |
| `GET /api/portal?period=today` | Token do atendente | Perfil, vendas, custos, extrato e repasses próprios |
| `PATCH /api/profile` | Token do atendente | Atualizar nome, foto, alerta de venda e PIX |
| `GET /api/push/config` | Token do atendente | Chave VAPID pública e IDs de inscrições próprias |
| `GET /api/admin/push/config` | Chave administrativa | Chave VAPID pública e IDs dos aparelhos administrativos do acesso atual |
| `GET /api/admin/reports/financial?start=AAAA-MM-DD&end=AAAA-MM-DD&attendantId=` | Chave administrativa | Fechamento por período e atendente |
| `GET /api/admin/reports/financial.csv` | Chave administrativa | Mesmo fechamento em CSV, com os mesmos filtros |
| `GET /api/admin/audit?start=&end=&action=&page=1` | Chave administrativa | Histórico imutável e paginado |
| `GET /api/admin/backups` | Chave administrativa | Configuração e cópias recentes |
| `POST /api/admin/backups` | Chave administrativa | Criar e testar uma cópia manual |
| `GET /api/admin/backups/:id` | Chave administrativa | Baixar uma cópia verificada |
| `GET /api/cron/backups` | `CRON_SECRET` | Executar a cópia diária idempotente |
| `POST /api/admin/push/subscriptions` | Chave administrativa | Ativa alertas de novas vendas no aparelho do responsável |
| `DELETE /api/admin/push/subscriptions` | Chave administrativa | Desativa a inscrição administrativa informada |
| `POST /api/push/subscriptions` | Token do atendente | Cadastrar inscrição Web Push do aparelho |
| `DELETE /api/push/subscriptions` | Token do atendente | Remover inscrição própria pelo ID |
| `POST /api/sales` | Token do atendente | Gravar lote atômico; requer `Idempotency-Key` |
| `GET /api/receipts/:id` | Token do proprietário | Obter comprovante privado |
| `GET /api/ranking?period=today` | Token do atendente | Ranking sem dados privados |
| `POST /api/payouts` | Token do atendente | Desativado (410); repasses são registrados pela administração |
| `POST /api/admin/payouts` | Chave administrativa | Registrar pagamento manual já realizado; requer `Idempotency-Key` |
| `GET /api/admin/sales?status=pending&attendantId=&page=1` | Chave administrativa | Fila de vendas paginada; status `pending`, `approved`, `rejected` ou `all` |
| `PATCH /api/admin/sales/:id` | Chave administrativa | Aprovar ou recusar venda pendente; registra data e observação |
| `POST /api/admin/sales/:id/cancel` | Chave administrativa | Cancelar aprovação com motivo; retira comissão e registra auditoria sem apagar a venda |
| `GET /api/admin/receipts/:id` | Chave administrativa | Obter print privado de qualquer venda para análise |
| `GET /api/admin/dashboard` | Chave administrativa | Atendentes, checkouts e repasses com destino PIX |
| `POST /api/admin/attendants` | Chave administrativa | Criar atendente; retorna token uma vez |
| `POST /api/admin/attendants/:id/token` | Chave administrativa | Trocar token preservando histórico |
| `PATCH /api/admin/attendants/:id` | Chave administrativa | Revogar ou reativar acesso |
| `GET /api/admin/attendants/:id/costs?date=AAAA-MM-DD` | Chave administrativa | Consultar custos do dia |
| `POST /api/admin/attendants/:id/costs` | Chave administrativa | Atualizar custos do dia |
| `PATCH /api/admin/checkouts/:id` | Chave administrativa | Definir nome e taxa do checkout |
| `PATCH /api/admin/payouts/:id` | Chave administrativa | Compatibilidade com estados de solicitações históricas |

A criação recebe `{ "name": "Nome", "commission": "50" }` (sem `commission`, usa 50%), opcionalmente com o campo `token` escolhido pela administração. Tokens escolhidos devem ter de 32 a 160 letras, números, hífen ou sublinhado; valores já usados são recusados. Sem esse campo, o servidor gera um token aleatório. Custos recebem `{ "date": "AAAA-MM-DD", "ads": "20", "withdrawalFee": "2" }`. Taxas recebem `{ "name": "Checkout", "fee": "15", "fixedFee": "1.99", "minimum": "0.01", "higherTier": null }`; omitir `fixedFee`, `minimum` ou `higherTier` preserva a configuração existente. `higherTier: null` remove a faixa superior e aplica a tarifa principal às vendas aceitas pelo limite do checkout. Decisões recebem `{ "status": "approved", "note": "Print conferido" }` ou `{ "status": "rejected", "note": "Motivo obrigatório" }`; tentativas de alterar uma decisão concluída por esse endpoint retornam 409. O cancelamento de aprovação usa `POST /api/admin/sales/:id/cancel` com `{ "note": "Motivo obrigatório" }`; aceita somente uma venda aprovada e retorna 409 para uma situação incompatível ou repetição. Ativação recebe `{ "active": false }`. O registro manual recebe `{ "attendantId": "ID", "amount": "19.47", "note": "PIX conferido" }` e o cabeçalho `Idempotency-Key`. `amount` é o débito total, incluindo R$ 2,50 da taxa do atendente; neste exemplo, o PIX líquido é R$ 16,97. A resposta informa `id` e `duplicate`; reutilizar o identificador com dados diferentes retorna 409. Valores monetários e percentuais entram como texto para validação decimal. Períodos aceitos: `today`, `yesterday`, `week`, `month` e `all`.

## GitHub Pages: atualizar a demonstração

```sh
npm run build:pages
```

O comando gera `docs/index.html` com JavaScript, CSS e ícone incorporados, além de `.nojekyll`, `notifications-worker.js`, `favicon.svg`, manifestos de instalação e ícones PNG. O Pages usa a branch `main`, pasta `/docs`. Envie os arquivos gerados junto com o código. A geração estática não inclui SQLite, convites, comprovantes reais, inscrições ou dados do navegador. O service worker é registrado somente ao ativar notificações e não armazena tokens, PIX ou páginas privadas em cache.

## Testar

```sh
npm test
npm run build
BRAVUS_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Os testes cobrem comissões sem faturamento mínimo, compatibilidade com registros antigos, regras financeiras, dias no fuso brasileiro, validação de PIX, isolamento entre tokens, comprovantes privados, idempotência, saldo de repasses e persistência após reiniciar o banco. O Playwright testa desktop e celular contra a API real com um banco temporário e tokens sintéticos, removidos ao encerrar o teste. Não são utilizados dados de atendentes reais.

Também são verificados os limites de R$ 1.000,00 e R$ 1.000,01 do checkout, recusa atômica de lotes acima do limite, preservação de taxas históricas e faixas administrativas após migração e reinício, todas as faixas de tarifa PIX, arredondamento, taxa fixa por transação em lotes, recusa de taxas manipuladas pelo cliente, atualização de bancos antigos sem alterar vendas registradas, autorização administrativa, a criação/rotação/revogação de tokens, a persistência da chave privada, as taxas sem efeito retroativo, a confirmação/cancelamento de repasses e a leitura de um backup com vendas e comprovantes.

Também há testes de autorização de decisões e comprovantes, aprovação única sob tentativas concorrentes, saldo bloqueado enquanto pendente, recusa com motivo, paginação e compatibilidade de vendas antigas. O fluxo completo de aprovação, recusa e lançamento de ADS é exercitado no desktop e no celular, incluindo seu efeito no saldo do atendente e a prévia pública.

O perfil tem cobertura de upload, prévia, persistência após recarregar, PIX, foto no ranking e mensagem personalizada. Os testes de navegador ativam/desativam notificações de demonstração e consultam os alertas locais do service worker, com permissão concedida no Chromium. O fluxo autenticado verifica recuperação após indisponibilidade do servidor, cadastro da inscrição na API e estado ativo após recarregar; apenas a inscrição no provedor do navegador é simulada. Os testes da API validam inscrições por atendente, rejeição de endpoints externos arbitrários, criptografia real do payload e limpeza de inscrições expiradas; o transporte externo é substituído por uma função de teste. A integração libSQL verifica chaves persistentes compartilhadas entre instâncias simultâneas e proteção da chave privada nas respostas. Isso não valida a entrega em aparelhos físicos pelos provedores.

Para outro Chromium instalado, ajuste `BRAVUS_CHROMIUM_PATH`; para usar o navegador distribuído pelo Playwright, instale com `npx playwright install chromium` e execute sem essa variável.

## Estrutura

- `src/Brand.tsx`, `src/brand.css`, `src/assets/bravus-brasil.webp`: marca BRAVUS Brasil e identidade visual em preto, dourado, verde e branco, seguindo a referência enviada pelo responsável. A imagem é incorporada ao build para funcionar também no GitHub Pages.
- `src/App.tsx`, `src/styles.css`: interface do portal.
- `src/Profile.tsx`, `src/profile.css`, `src/notifications.ts`: perfil BRAVUS, foto, PIX, alerta e ativação de notificações.
- `src/domain.ts`: tipos e regras financeiras compartilhados.
- `src/client.ts`: acesso à API e demonstração isolada.
- `src/Admin.tsx`, `src/AdminSales.tsx`, `src/admin.css`, `src/admin-client.ts`: painel administrativo, fila de aprovação, custos de ADS e cliente autenticado.
- `src/demo-admin.ts`, `src/demo-store.ts`: prévia administrativa com dados locais de demonstração, isolada da API real.
- `server/store.ts`: SQLite e regras de autorização por atendente.
- `server/http.ts`, `server/index.ts`: API e servidor da interface.
- `server/manage.ts`: administração dos atendentes, taxas, custos e repasses pelo operador.
- `server/admin-key.ts`: criação e carregamento seguro da chave administrativa.
- `server/push.ts`, `public/notifications-worker.js`: inscrições privadas e envio/recebimento de notificações Web Push.
- `render.yaml`: implantação de interface e API com SQLite em disco persistente.
- `tests/`: testes de domínio, API e navegador.

Os dados da antiga demonstração de gestão (`bravus.data.v1`) não são apagados nem migrados automaticamente. A nova demonstração usa uma chave separada; atendentes reais usam o banco no servidor.

A coluna `sales.commission_mode` identifica a fórmula histórica (`net-share`) ou a nova (`gross-share-less-fees`). `sales.attendant_fee_cents` guarda a metade da taxa atribuída ao atendente; nulo preserva a regra histórica. `payouts.gateway_fee_cents` guarda a taxa total efetiva do saque; `payouts.withdrawal_fee_cents` guarda somente a parcela do atendente: zero em pedidos pendentes ou cancelados e R$ 2,50 ao confirmar novos pagamentos. Repasses anteriores conservam o desconto histórico, inclusive R$ 5 integrais. A migração `payout-fee-on-payment-v1` zera tarifas antecipadas dos pedidos ainda não pagos e preserva os repasses já pagos. Migrações são transacionais e idempotentes.

As colunas antigas de meta permanecem no SQLite para preservar a compatibilidade dos bancos existentes, mas não são lidas, expostas pela API ou usadas nos cálculos. Dados antigos da demonstração continuam na mesma chave do navegador e suas vendas antigas permanecem aprovadas e geram comissão sem mínimo de faturamento; novos lançamentos aguardam a aprovação administrativa.

## Implementação da conexão persistente

- `server/database.ts`: contrato assíncrono de SQL para os dois ambientes.
- `server/sqlite-database.ts`: SQLite local, com fila para isolar transações durante operações assíncronas.
- `server/turso-database.ts`: cliente libSQL HTTP com transações de escrita e conversão de BLOBs.
- `server/store.ts`: uma única implementação das regras de autorização, vendas e saldos para ambos os bancos.
- `server/vercel.ts`: handler serverless, cache de conexão por instância, configuração por variáveis privadas e ausência de fallback para armazenamento efêmero.
- `scripts/build-api.mjs`: gera o artefato JavaScript da função; nenhum segredo é incluído no build.

Os pagamentos manuais, a conferência de saldo, o registro da auditoria e a idempotência são gravados na mesma transação. Repetir um pagamento com a mesma chave não cria outro débito nem outra tarifa; instâncias distintas compartilham a mesma proteção no banco.

Os testes em `tests/cloud.test.ts` usam libSQL com um banco temporário para verificar a mesma API da Vercel, persistência entre instâncias, comprovantes binários, inicialização concorrente, idempotência e proteção contra reserva/pagamento duplicado. Também verificam 503 sem configuração e o artefato JavaScript implantado. Não usam credenciais reais nem bancos de produção.
