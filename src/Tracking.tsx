import { useEffect } from 'react';
import { publicAssetUrl } from './pwa.ts';

export default function Tracking() {
  const url = publicAssetUrl('rastreio.html');
  useEffect(() => { window.location.replace(url); }, [url]);
  return <main><p>Abrindo rastreio… <a href={url}>Continuar</a></p></main>;
}
