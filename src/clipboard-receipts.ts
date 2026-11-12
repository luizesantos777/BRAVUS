/** Only handles clipboard data supplied by a paste gesture or an explicit button click. */
export function clipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (!files.length) for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
  }
  return files;
}

export async function readClipboardImage(): Promise<File> {
  if (!navigator.clipboard?.read) throw new Error('Este navegador não permite colar pelo botão. Clique na área de colagem e use Ctrl+V (⌘V no Mac), ou Anexar Print.');
  let items: ClipboardItems;
  try { items = await navigator.clipboard.read(); }
  catch { throw new Error('O navegador não permitiu acessar a imagem copiada. Clique na área de colagem e use Ctrl+V (⌘V no Mac), ou Anexar Print.'); }
  const images = items.filter(item => item.types.some(type => type.startsWith('image/')));
  if (!images.length) throw new Error('Nenhuma imagem encontrada. Copie a imagem do comprovante, não apenas o link ou o texto. Você também pode usar Anexar Print.');
  if (images.length > 1) throw new Error('Cole apenas uma imagem de comprovante por venda.');
  const item = images[0], type = ['image/png', 'image/jpeg', 'image/webp'].find(type => item.types.includes(type)) ?? item.types.find(type => type.startsWith('image/'))!;
  let blob: Blob;
  try { blob = await item.getType(type); }
  catch { throw new Error('Não foi possível abrir a imagem copiada. Copie novamente ou use Anexar Print.'); }
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' } as Record<string, string>)[type] ?? 'imagem';
  return new File([blob], `comprovante-colado.${extension}`, { type });
}
