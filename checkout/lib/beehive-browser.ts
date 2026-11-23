// No card fields, token or authentication results are persisted by this module.
let loading:Promise<any>|undefined;
export function loadBeehive():Promise<any>{
 if(loading)return loading;
 loading=new Promise((resolve,reject)=>{
  const w=window as any;
  const ready=async()=>{
   for(let i=0;i<100;i++){
    if(w.BeehivePay&&w.HopyFingerprint){resolve(w.BeehivePay);return;}
    await new Promise(r=>setTimeout(r,100));
   }
   reject(Error('O serviço de cartão não carregou. Atualize a página.'));
  };
  if(w.BeehivePay){void ready();return;}
  const script=document.createElement('script');script.src='https://api.conta.paybeehive.com.br/v1/js';script.async=true;
  script.onload=()=>void ready();script.onerror=()=>reject(Error('Não foi possível carregar o serviço de cartão.'));document.head.appendChild(script);
 }).catch(e=>{loading=undefined;throw e;});
 return loading;
}
export async function tokenizeCard(sdk:any,key:string,amount:number,card:{number:string;holderName:string;expMonth:number;expYear:number;cvv:string},installments=1){
 if(!Number.isInteger(installments)||installments<1||installments>12)throw Error('Selecione de 1 a 12 parcelas.');
 await sdk.setPublicKey(key);
 sdk.setTestMode(false);
 // The SDK displays the bank challenge and rejects failed/cancelled authentication.
 const available=await sdk.is3DSAvailable();
 if(typeof available!=='boolean')throw Error('Não foi possível verificar a autenticação do cartão.');
 if(available)await sdk.authenticate3DS({amount,currency:'brl',installments,card});
 const result=await sdk.encrypt(card);
 // SDK deployments may return the hash directly or in the documented card hash field.
 const token=typeof result==='string'?result:result?.hash;
 if(typeof token!=='string'||token.length<10||token.length>2048)throw Error('Não foi possível proteger os dados do cartão.');
 return token;
}
