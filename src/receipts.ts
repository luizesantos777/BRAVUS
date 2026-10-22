import { MAX_RECEIPT_BYTES } from './domain.ts';
import type { ReceiptInput } from './domain.ts';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const TARGET_BYTES = 1024 * 1024;
const MAX_EDGE = 3200;

async function imageType(file: File): Promise<string> {
  // Galleries and messaging apps may omit or mislabel the MIME type.
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const header = String.fromCharCode(...bytes);
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  if (header.slice(4, 8) === 'ftyp') {
    for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
      if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(header.slice(offset, offset + 4))) return 'image/heic';
    }
  }
  throw new Error('Escolha um print PNG, JPG ou WEBP. PDFs e outros arquivos não podem ser anexados como imagem.');
}

function openImage(blob: Blob, heic: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(), url = URL.createObjectURL(blob);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout); URL.revokeObjectURL(url);
      image.onload = image.onerror = null;
      if (error) { image.removeAttribute('src'); reject(error); } else resolve(image);
    };
    const timeout = window.setTimeout(() => finish(new Error('A imagem demorou para abrir. Tente novamente ou escolha outro print.')), 30_000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error(heic
      ? 'Este navegador não abre fotos HEIC. Faça uma captura de tela do comprovante e anexe o print em PNG ou JPG.'
      : 'Não foi possível abrir essa imagem. Escolha outro print em PNG, JPG ou WEBP.'));
    image.src = url;
  });
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a imagem.'));
    reader.onerror = reader.onabort = () => reject(new Error('Não foi possível ler a imagem. Selecione o print novamente.'));
    reader.readAsDataURL(blob);
  });
}

export async function readReceipt(file: File): Promise<ReceiptInput> {
  if (!file.size) throw new Error('A imagem está vazia. Selecione outro print.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Escolha uma imagem de até 20 MB ou faça uma captura de tela do comprovante.');
  const mime = await imageType(file), heic = mime === 'image/heic';
  const source = file.slice(0, file.size, mime);
  const image = await openImage(source, heic);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('A imagem está inválida. Selecione outro print.');

  // Keep small receipts byte-for-byte. Large photos are prepared on the device,
  // before base64 encoding and before the server's request-size limit applies.
  if (!heic && file.size <= MAX_RECEIPT_BYTES) {
    return { name: (file.name || 'comprovante').slice(0, 180), mime, base64: (await dataUrl(source)).split(',')[1] };
  }
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  try {
    let prepared: Blob | null = null;
    resize: for (const reduction of [1, .8, .64]) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale * reduction));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale * reduction));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível preparar essa imagem. Tente outro print.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [.9, .78, .65]) {
        prepared = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!prepared) throw new Error('Não foi possível reduzir essa imagem. Tente outro print.');
        if (prepared.size <= TARGET_BYTES) break resize;
      }
    }
    if (!prepared || prepared.size > MAX_RECEIPT_BYTES) throw new Error('A imagem continua muito grande. Recorte somente o comprovante e tente novamente.');
    const result = await dataUrl(prepared);
    const base64 = result.split(',')[1];
    if (!result.startsWith('data:image/jpeg;base64,') || Math.ceil(base64.length / 4) * 3 > MAX_RECEIPT_BYTES) throw new Error('A imagem continua muito grande. Recorte somente o comprovante e tente novamente.');
    return { name: `${(file.name || 'comprovante').replace(/\.[^.]*$/, '').slice(0, 176)}.jpg`, mime: 'image/jpeg', base64 };
  } finally { canvas.width = canvas.height = 0; }
}
