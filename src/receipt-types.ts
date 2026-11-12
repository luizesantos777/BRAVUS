export const RECEIPT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;

/** Signature and trailer checks are shared by the browser and the API. */
export function isPdfReceipt(bytes: Uint8Array): boolean {
  const header = String.fromCharCode(...bytes.subarray(0, 9));
  const trailer = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 2048)));
  return /^%PDF-(?:1\.[0-7]|2\.0)[\r\n\s]/.test(header) && trailer.includes('%%EOF');
}

export function receiptExtension(mime: string): string {
  return mime === 'application/pdf' ? 'pdf' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
}
