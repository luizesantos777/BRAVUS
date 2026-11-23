// Preset data for the Bio Camisas brand. The CPF/e-mail/phone/address below
// are used only by server-side processing; the BUYER NAME constant is also
// imported by the checkout client component solely to pre-fill the buyer field.
export const BIOCAMISAS_BUYER_NAME='BIOTWO CONFECCOES E ACESSORIOS LTDA';
export function biocamisasCustomer(brand: unknown, name: string) {
 if(brand!=='biocamisas'||name.trim().replace(/\s+/g,' ').toUpperCase()!==BIOCAMISAS_BUYER_NAME)return null;
 return {name:BIOCAMISAS_BUYER_NAME,cpf:'07669833000199',email:'biocamisas@suporte.com',phone:'89981172484',address:{street:'Rua Barão Ledario',streetNumber:'670',zipCode:'03010000'}};
}
