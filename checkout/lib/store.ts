import {newShirts} from './catalog-shirts';
export type Shirt={id:string;name:string;category:string;image:string;color:string;detail:string;variants?:Record<string,string>;gallery?:{src:string;label:string}[];availableSizes?:string[];availableColors?:string[]};
export const colors=[
{name:'Branco',hex:'#f3f3f3'},{name:'Preto',hex:'#141414'},{name:'Cinza claro',hex:'#bbbdbf'},{name:'Cinza chumbo',hex:'#45494d'},
{name:'Azul celeste',hex:'#45b8ef'},{name:'Azul royal',hex:'#1254cb'},{name:'Azul marinho',hex:'#0a2848'},{name:'Turquesa',hex:'#08c6cd'},
{name:'Verde limão',hex:'#a7ed15'},{name:'Verde bandeira',hex:'#058545'},{name:'Verde militar',hex:'#465232'},{name:'Amarelo',hex:'#ffda20'},
{name:'Laranja',hex:'#ff7917'},{name:'Vermelho',hex:'#d51026'},{name:'Vinho',hex:'#770d32'},{name:'Rosa pink',hex:'#f52a8b'}];
export const catalog:Shirt[]=[
{id:'texas',name:'Texas • Country',category:'Agro & Country',image:'/assets/texas.webp',color:'Preto',detail:'Espírito country. Escolha entre as 16 cores da Bravus.'},
{id:'tucunare-raiz',name:'Tucunaré • Brasil Raiz',category:'Pesca',image:'/assets/tucunare.webp',color:'Verde militar',detail:'A força da pesca em uma estampa que impressiona.'},
{id:'tambaqui',name:'Tambaqui • Gigante da Amazônia',category:'Pesca',image:'/assets/tambaqui.webp',color:'Cinza chumbo',detail:'Para quem carrega a pescaria no peito.'},
{id:'dourado',name:'Dourado • O rei do rio',category:'Pesca',image:'/assets/dourado.webp',color:'Amarelo',detail:'Uma homenagem ao dourado e às grandes pescarias.'},
{id:'pirarara',name:'Pirarara • Pesca Raiz',category:'Pesca',image:'/assets/pirarara.webp',color:'Laranja',detail:'Cores marcantes para uma paixão gigante.'},
{id:'nossa-senhora',name:'Nossa Senhora • Caminho da Fé',category:'Fé',image:'/assets/nossa-senhora.webp',color:'Preto',detail:'Sua devoção e sua história em cada detalhe.'},
{id:'pesca',name:'Tucunaré • Turma da Pesca',category:'Pesca',image:'/assets/loja-0.webp',color:'Azul marinho',detail:'Sua turma, seu nome e a paixão pela pescaria.'},
{id:'country',name:'Country • Haras',category:'Agro & Country',image:'/assets/loja-1.webp',color:'Azul marinho',detail:'A identidade do seu haras em cada detalhe.'},
{id:'personalizada',name:'UV • Do seu jeito',category:'Personalizadas',image:'/assets/loja-2-telefone-oculto.webp',color:'Preto',detail:'Nome, equipe, profissão ou a sua própria ideia.'}];
catalog.push(...newShirts);
export const sizes=['PP','P','M','G','GG','XG','2GG','G1','G2','G3','G4','G5','G6','G7','G8'];
export function shirtColors(p:Shirt){const all=[...colors,{name:'Bege',hex:'#d4bd91'},{name:'Roxo',hex:'#773d99'}];return p.availableColors?all.filter(c=>p.availableColors!.includes(c.name)):all.filter(c=>colors.some(base=>base.name===c.name)||c.name===p.color);}
export const shippingCents=1990;
export const brazilStates=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
export const sizeRows=[['PP',46,64,58],['P',48,66,60],['M',50,68,62],['G',53,71,64],['GG',56,74,66],['XG',59,77,68],['G1',62,80,69],['G2',65,83,70],['G3',68,86,71],['G4',71,89,72],['G5',null,null,null],['G6',null,null,null],['G7',null,null,null],['G8',null,null,null]];

export function totalFor(q:number){return q>=5?q*2497:q===4?9989:q*3990;}
export function validateCart(items:any){if(!Array.isArray(items)||!items.length||items.length>30)throw Error('Adicione de 1 a 30 modelos ao carrinho.');let quantity=0;const cart=items.map((i:any)=>{const p=catalog.find(p=>p.id===i.id);if(!p||!(p.availableSizes||sizes).includes(i.size)||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>50||typeof i.custom!=='string'||i.custom.length>350)throw Error('Confira os modelos, tamanhos e quantidades.');if(i.color!==undefined&&!shirtColors(p).some(c=>c.name===i.color))throw Error('Escolha uma cor da tabela Bravus.');quantity+=i.quantity;return {id:p.id,name:p.name,size:i.size,color:i.color||p.color,quantity:i.quantity,custom:i.custom.trim()};});if(quantity>100)throw Error('Para mais de 100 camisas, solicite atendimento.');return {cart,quantity,subtotal:totalFor(quantity)};}
