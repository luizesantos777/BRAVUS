const steps=[
  {
    "n": "01",
    "id": "etapa-1",
    "title": "Primeira resposta",
    "hint": "Escolha a abertura conforme a mensagem do cliente.",
    "messages": [
      {
        "label": "CLIENTE VEIO PELO ANÚNCIO",
        "text": "Olá! 👋 Seja bem-vindo(a) à Bravus Brasil! 🤠\n\nVi que você se interessou pelo nosso chapéu country premium! 🤠\n\n🔥 OFERTA: R$ 39,90 a unidade ou o kit com 4 chapéus por R$ 99,90. A partir de 5 chapéus, mantenho o valor promocional de R$ 24,98 por unidade.\n\nVocê prefere uma unidade ou quer aproveitar o kit com 4? 😊"
      },
      {
        "label": "CLIENTE JÁ ENVIOU O MODELO",
        "text": "Olá! 👋 Que bom falar com você! Aqui é da Bravus Brasil. 🤠\n\nGostei da sua escolha! Vou conferir esse modelo para você.\n\n🔥 OFERTA: R$ 39,90 a unidade ou o kit com 4 chapéus por R$ 99,90. A partir de 5 chapéus, mantenho o valor promocional de R$ 24,98 por unidade.\n\nQuantos chapéus você quer levar? 😊"
      }
    ]
  },
  {
    "n": "02",
    "id": "etapa-2",
    "title": "Oferta e quantidade",
    "hint": "Envie os valores separadamente quando necessário.",
    "text": "🔥 OFERTA: R$ 39,90 a unidade ou o kit com 4 chapéus por R$ 99,90. A partir de 5 chapéus, mantenho o valor promocional de R$ 24,98 por unidade.\n\nQual opção você prefere? 🤠"
  },
  {
    "n": "03",
    "id": "etapa-3",
    "title": "Chapéu country e cores",
    "hint": "Use a p. 10 do novo catálogo; substitui a antiga lista de australiano, tático, bucket etc.",
    "text": "Esse é o nosso chapéu country premium! 🤠\n\nO catálogo apresenta as opções preto, claro e marrom.\n\nhttps://pagamento.bravuspix.shop/catalogo/bravus-completo.pdf?v=76f3cdae87#page=10\n\nMe envie um print da opção que você gostou e a quantidade. Vou conferir a cor e a disponibilidade antes de fechar. 😊"
  },
  {
    "n": "04",
    "id": "etapa-4",
    "title": "Cores e quantidades",
    "hint": "Confira as opções do modelo no catálogo e o estoque antes de confirmar o pedido.",
    "text": "Agora me fala quais cores você quer em cada modelo. 🤠\n\nPode mandar assim:\nModelo — cor — quantidade\n\nSe for montar o kit, me envie as 4 escolhas para eu conferir a disponibilidade de cada uma. 😊"
  },
  {
    "n": "05",
    "id": "etapa-5",
    "title": "Medida e ajuste",
    "hint": "O catálogo não informa grade ou regulagem do chapéu. Confira com o atendimento; não prometa tamanho único.",
    "text": "Vamos conferir o tamanho para escolher direitinho? 🤠\n\nVocê sabe a medida da circunferência da sua cabeça? Pode medir com uma fita ao redor, passando um pouco acima das sobrancelhas e das orelhas, sem apertar.\n\nMe envie a medida em centímetros que eu confiro o tamanho e o ajuste dos modelos escolhidos. 😊"
  },
  {
    "n": "06",
    "id": "etapa-6",
    "title": "Confirmar as peças",
    "hint": "Envie o resumo real dos modelos, cores, medidas e quantidades antes desta mensagem.",
    "text": "Separei o resumo dos chapéus que você escolheu. 🤠✅\n\nConfere para mim se os modelos, as cores e as quantidades estão certinhos?\n\nAssim seguimos com o seu pedido. 😊"
  },
  {
    "n": "07",
    "id": "etapa-7",
    "title": "Dados para entrega",
    "hint": "Após a escolha das peças.",
    "text": "Perfeito! ✅📦\n\nVou registrar seu pedido em nosso sistema para darmos continuidade à sua compra.\n\n📋 Me envie os seguintes dados para o cadastro:\n\n👤 Nome completo:\n📱 Telefone:\n📍 CEP:\n🏠 Endereço:\n🔢 Número:\n📌 Bairro:\n🌆 Cidade/Estado:\n\nAssim que receber seus dados, seguimos para a confirmação do pedido e pagamento."
  },
  {
    "n": "08",
    "id": "etapa-8",
    "title": "Frete e total",
    "hint": "Consulte o frete e o prazo pelo CEP. Envie o total exato antes desta mensagem; não prometa frete grátis.",
    "text": "Vou conferir o frete e o prazo para o seu endereço e te passar o valor total com tudo certinho. 📦\n\nDepois que você confirmar, seguimos com o pagamento. Combinado? 😊"
  },
  {
    "n": "09",
    "id": "etapa-9",
    "title": "Pagamento",
    "hint": "Use Abrir checkout no acesso rápido. Informe o total confirmado e envie o link gerado ao cliente.",
    "text": "Seu pedido está conferido! ✅🤠\n\nVou te enviar o link para pagamento via PIX, com o valor que combinamos.\n\nDepois de pagar, me envie o comprovante por aqui para conferirmos o pagamento e seguirmos com o pedido. 📦"
  },
  {
    "n": "10",
    "id": "etapa-10",
    "title": "Confirmação do pagamento",
    "hint": "Envie somente depois de verificar que o pagamento foi recebido.",
    "text": "Pagamento confirmado! ✅\n\nObrigado pela sua compra na Bravus Brasil! 🤠\n\nVamos seguir com a preparação do seu pedido. Assim que for enviado, te encaminho as informações de rastreio por aqui. 📦"
  },
  {
    "n": "11",
    "id": "etapa-11",
    "title": "Sumiu na escolha",
    "hint": "Acompanhamento sem pressionar e sem prometer reserva.",
    "text": "Oi! 😊 Conseguiu olhar os modelos de chapéus?\n\nMe fala quais você mais gostou. Se ficou alguma dúvida sobre as cores, o tamanho ou o ajuste, eu te ajudo! 🤠"
  },
  {
    "n": "12",
    "id": "etapa-12",
    "title": "Sumiu após o orçamento",
    "hint": "Retome a conversa sem citar PIX.",
    "text": "Oi! 👋 Ficou alguma dúvida sobre seu pedido de chapéus?\n\n🔥 OFERTA: R$ 39,90 a unidade ou o kit com 4 chapéus por R$ 99,90. A partir de 5 chapéus, mantenho o valor promocional de R$ 24,98 por unidade.\n\nQuer que eu confira os modelos e as cores para você? 😊"
  },
  {
    "n": "13",
    "id": "etapa-13",
    "title": "Sumiu após o cadastro",
    "hint": "Retome após receber os dados, sem citar PIX.",
    "text": "Oi! 😊 Já recebi seus dados e queria saber se ficou alguma dúvida sobre os chapéus, o total ou a entrega.\n\nMe chama por aqui que te ajudo a concluir seu pedido. 🤠📦"
  },
  {
    "n": "📏",
    "id": "tabelas",
    "title": "Tabelas de medidas",
    "hint": "Copie os links ou abra as tabelas na seção de medidas abaixo. Use a modelagem do pedido. As tabelas adultas vão até G8; infantil cavada de 2 a 16.",
    "text": "📏 Confira nossas tabelas de medidas atualizadas!\n\nCamisa manga longa: https://pagamento.bravuspix.shop/catalogo/tabelas/camisa_longa.png\nCamisa manga curta: https://pagamento.bravuspix.shop/catalogo/tabelas/manga_curta.png\nCamisa cavada: https://pagamento.bravuspix.shop/catalogo/tabelas/cavada.png\nPolo manga longa: https://pagamento.bravuspix.shop/catalogo/tabelas/polo_longa.png\nMoletom: https://pagamento.bravuspix.shop/catalogo/tabelas/moletom.png\nBaby look feminina: https://pagamento.bravuspix.shop/catalogo/tabelas/baby_look.png\nInfantil cavada (2 a 16): https://pagamento.bravuspix.shop/catalogo/tabelas/infantil_cavada.png\n\nCompare com uma peça sua, estendida e sem esticar, e me diga os tamanhos de cada modelo. 😊"
  },
  {
    "n": "+",
    "id": "outras-linhas",
    "title": "Ofertas do catálogo",
    "hint": "Preços por produto. Confirme modelos, tamanhos e estoque. Frete expresso gratuito apenas para pedidos com 8 camisas ou mais; consulte frete dos demais pedidos.",
    "text": "Confira as ofertas do nosso catálogo Bravus! 🤠\n\n👕 Camisas: R$ 39,90 a unidade; kit com 4 por R$ 99,89. A partir de 5 camisas, R$ 24,97 por unidade.\n🚚 Comprando 8 camisas ou mais, você ganha frete expresso gratuito!\n\n👔 Polos: R$ 39,90 a unidade ou 4 por R$ 99,89.\n👖 Jeans flare: R$ 59,90 a unidade ou 3 por R$ 119,90.\n🧢 Bonés country e pesca: R$ 25,00 a unidade ou 4 por R$ 60,00.\n🤠 Chapéus country: R$ 39,90 a unidade ou 4 por R$ 99,90. A partir de 5 chapéus, R$ 24,98 por unidade.\n👢 Botas texanas e country: 1 par por R$ 99,89 ou 2 pares por R$ 179,89. A partir de 3 pares, R$ 59,93 por par (40% de desconto sobre o valor original de R$ 99,89 por par).\n✨ Fivela com canivete de brinde: R$ 189,99.\n🔪 Canivetes: R$ 39,90 a unidade ou 4 por R$ 99,89.\n\nhttps://pagamento.bravuspix.shop/catalogo/bravus-completo.pdf?v=76f3cdae87\n\nQuais modelos você gostou? Me envie as fotos para eu conferir os tamanhos e a disponibilidade. 😊"
  },
  {
    "n": "↗",
    "id": "acompanhamento",
    "title": "Acompanhamento",
    "hint": "Envie após o pedido estar registrado no sistema de acompanhamento.",
    "text": "Seu pedido já foi registrado! 📦\n\nVocê pode acompanhar as atualizações pelo link:\n🔗 https://rastreio-brasilraiz.netlify.app/\n\nAssim que o envio for confirmado, também te aviso por aqui. Qualquer dúvida, pode me chamar! 😊"
  }
];
let current=0,timer;const $=id=>document.getElementById(id);
const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>';
function notify(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>$('toast').classList.remove('visible'),2800)}
const instagramUrl='https://www.instagram.com/bravusvta_brasil?igsh=MWx0dW42OXBjMGhqOQ==&igsi=MWx0dW42OXBjMGhqOQ==';
document.querySelector('[data-copy-instagram]')?.addEventListener('click',async e=>{const button=e.currentTarget;try{await navigator.clipboard.writeText(instagramUrl);button.innerHTML='<span aria-hidden="true">✓</span> Instagram <b>copiado</b>';notify('Link do Instagram copiado. Agora é só colar no WhatsApp.');setTimeout(()=>{button.innerHTML='<span aria-hidden="true">◎</span> Instagram <b>copiar</b>'},2200)}catch{const area=document.createElement('textarea');area.value=instagramUrl;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove();notify('Link do Instagram copiado. Agora é só colar no WhatsApp.')}})
const companyDetails="N. Loja Comercio de Roupas LTDA\nCNPJ: 16.881.650/0001-23\nAv. Marechal Tito, nº 864, São Miguel Paulista, São Paulo - SP\nCEP: 08010-090";
const addressButton=document.createElement('button');addressButton.className='quick-address';addressButton.type='button';addressButton.dataset.copyAddress='';addressButton.setAttribute('aria-label','Copiar razão social, CNPJ e endereço da empresa');addressButton.innerHTML='<span aria-hidden="true">⌖</span> DADOS DA EMPRESA <b>copiar</b>';addressButton.title=companyDetails;document.querySelector('.quick-actions')?.append(addressButton);
addressButton.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(companyDetails)}catch{const area=document.createElement('textarea');area.value=companyDetails;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove()}addressButton.innerHTML='<span aria-hidden="true">✓</span> DADOS DA EMPRESA <b>copiado</b>';notify('Dados da empresa copiados. Agora é só colar no WhatsApp.');setTimeout(()=>{addressButton.innerHTML='<span aria-hidden="true">⌖</span> DADOS DA EMPRESA <b>copiar</b>'},2200)})
async function copyText(text,button,pre){try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text)}else{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)throw Error('copy failed')}button.textContent='✓ Copiado!';notify('Mensagem copiada. Agora é só colar no WhatsApp.');setTimeout(()=>button.innerHTML=icon+'Copiar mensagem',2000)}catch{const range=document.createRange();range.selectNodeContents(pre);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);notify('Selecionei a mensagem. Use a opção Copiar do seu dispositivo.')}}
function card(label,text){const article=document.createElement('article');article.className='card';const top=document.createElement('div');top.className='card-top';const name=document.createElement('span');name.textContent=label;const button=document.createElement('button');button.className='copy';button.innerHTML=icon+'Copiar mensagem';button.setAttribute('aria-label','Copiar mensagem: '+label);const pre=document.createElement('p');pre.className='message';pre.textContent=text;button.addEventListener('click',()=>copyText(pre.textContent,button,pre));top.append(name,button);article.append(top,pre);$('messages').append(article);return pre}
steps.forEach(s=>{const a=document.createElement('a');a.href='#'+s.id;a.className='step';const number=document.createElement('span');number.className='num';number.textContent=s.n;const label=document.createElement('span');label.textContent=s.title;a.append(number,label);$('steps').append(a)});
function render(){const index=steps.findIndex(s=>location.hash==='#'+s.id);current=index<0?0:index;const s=steps[current];document.querySelectorAll('.step').forEach((a,i)=>{if(i===current)a.setAttribute('aria-current','step');else a.removeAttribute('aria-current')});$('stage-label').textContent=s.n==='↗'?'PÓS-VENDA':'ETAPA '+s.n;$('stage-title').textContent=s.title;$('position').textContent=(current+1)+' / '+steps.length;$('stage-hint').textContent=s.hint;$('messages').replaceChildren();if(s.messages){s.messages.forEach(m=>card(m.label,m.text))}else card('MENSAGEM PARA O CLIENTE',s.text);$('prev').disabled=current===0;$('next').disabled=current===steps.length-1;}
$('prev').addEventListener('click',()=>{if(current>0)location.hash=steps[current-1].id});$('next').addEventListener('click',()=>{if(current<steps.length-1)location.hash=steps[current+1].id});window.addEventListener('hashchange',render);render();
document.addEventListener('click',e=>{const link=e.target instanceof Element?e.target.closest('a[href="/checkout"]'):null;if(link)link.href='https://pagamento.bravuspix.shop/checkout'},true);
document.querySelectorAll('a[href^="https://pagamento.bravuspix.shop/checkout"]').forEach(link=>{link.href='https://pagamento.bravuspix.shop/checkout'});
