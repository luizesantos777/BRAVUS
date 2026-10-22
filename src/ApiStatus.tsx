import { useEffect, useState } from 'react';
import { CheckCircle2, Database, ExternalLink, LoaderCircle } from 'lucide-react';

export default function ApiStatus() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'setup' | 'unavailable'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { setStatus('unavailable'); controller.abort(); }, 10000);
    const base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';
    fetch(`${base}/health`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
      if (!controller.signal.aborted) setStatus(response.ok && body?.status === 'ok' ? 'ready' : body?.status === 'configuration_required' ? 'setup' : 'unavailable');
    }).catch(() => { if (!controller.signal.aborted) setStatus('unavailable'); }).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, []);
  return <div className={`api-status ${status}`}>
    {status === 'loading' ? <><LoaderCircle size={16} className="spin" /><span>Conferindo API e banco de dados...</span></> : status === 'ready' ? <><CheckCircle2 size={16} /><span>API real online · Banco conectado</span></> : <><Database size={17} /><div><strong>{status === 'setup' ? 'Conexão do banco pendente' : 'API indisponível neste momento'}</strong><p>{status === 'setup' ? 'Conecte o banco e configure seu acesso administrativo na Vercel para cadastrar atendentes e trabalhar com vendas reais.' : 'Confira a conexão do banco e as configurações da hospedagem antes de entrar.'}</p><details><summary>Configurar minha API na Vercel</summary><ol><li>No projeto BRAVUS, abra <strong>Storage</strong> e conecte um banco <strong>Turso</strong>.</li><li>Em <strong>Settings → Environment Variables</strong>, confira <code>TURSO_DATABASE_URL</code> e <code>TURSO_AUTH_TOKEN</code>.</li><li>Crie <code>BRAVUS_ADMIN_KEY</code> com uma chave privada de 32 a 256 caracteres e faça um novo deploy.</li></ol><p>Guarde as chaves apenas nas variáveis privadas da hospedagem. A chave administrativa será usada neste formulário.</p><a href="https://vercel.com/bravus5/bravus/stores" target="_blank" rel="noopener noreferrer">Abrir configuração do banco <ExternalLink size={12} /></a></details></div></>}
  </div>;
}
