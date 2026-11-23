// Public screens must not reveal which provider generated the payment.
// maskGateway() replaces provider names in messages shown outside /admin
// (checkout, customer payment pages and store). Owner panels keep the
// original names because that is where each gateway is configured and
// diagnosed. The API contract itself never changes: providers are still
// selected and addressed internally by their real ids.
const NAMES='Gestão Pay|Atlas Pags|Beehive|BuckPay|Firebot|Poseidon|Eleva|Atlas';
export function maskGateway(text: unknown): string {
 let t=String(text??'');
 t=t.replace(new RegExp('\\b(?:A|a)\\s+('+NAMES+')\\b','gi'),'O fornecedor');
 t=t.replace(new RegExp('\\bWebhook\\s+('+NAMES+')\\b','gi'),'Webhook da plataforma');
 t=t.replace(new RegExp('\\bno painel\\s+('+NAMES+')\\b','gi'),'no painel');
 t=t.replace(new RegExp('\\bna\\s+('+NAMES+')\\b','gi'),'na plataforma');
 t=t.replace(new RegExp('\\bda\\s+('+NAMES+')\\b','gi'),'do fornecedor');
 t=t.replace(new RegExp('\\b('+NAMES+')\\s*:\\s*HTTP\\b','gi'),'Fornecedor: HTTP');
 t=t.replace(new RegExp('\\b(credenciais|chave|segredo)\\s+('+NAMES+')\\b','gi'),'$1 da plataforma');
 t=t.replace(new RegExp('\\b('+NAMES+')\\b','gi'),'fornecedor');
 return t;
}