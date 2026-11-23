export const CARD_RATES=[0,0,2300,2410,2615,2327,2550,2650,2970,2830,3700,3800,3900] as const;
export function cardPlan(baseAmount:number,installments:number,rateBps:number=CARD_RATES[installments]){
 if(!Number.isSafeInteger(baseAmount)||baseAmount<=0||!Number.isInteger(installments)||installments<1||installments>12||!Number.isInteger(rateBps)||rateBps<0||rateBps>10000)throw Error('Invalid card plan');
 const feeAmount=Math.floor((baseAmount*rateBps+5000)/10000),amount=baseAmount+feeAmount;
 return {baseAmount,feeAmount,amount,installments,rateBps,installmentAmount:Math.floor(amount/installments),higherCount:amount%installments};
}
export const cardPlans=(base:number)=>Array.from({length:12},(_,i)=>cardPlan(base,i+1));
export function cardPlanLabel(p:ReturnType<typeof cardPlan>){const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);return p.higherCount?`${p.installments-p.higherCount}x de ${money(p.installmentAmount)} + ${p.higherCount}x de ${money(p.installmentAmount+1)}`:`${p.installments}x de ${money(p.installmentAmount)}`;}
