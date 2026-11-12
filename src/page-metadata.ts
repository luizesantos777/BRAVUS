export const pageMetadata = {
  loading: { title: 'Lucro Certo — Portal BRAVUS', description: 'Acesse seu portal BRAVUS. Acompanhe suas vendas e pagamentos.' },
  attendant: { title: 'Lucro Certo — Portal do Atendente BRAVUS', description: 'Portal individual do atendente BRAVUS. Lance suas vendas, acompanhe comissões, ranking e repasses.' },
  partner: { title: 'Lucro Certo — Portal do Parceiro BRAVUS', description: 'Portal do Parceiro BRAVUS. Acompanhe suas vendas e pagamentos.' },
  admin: { title: 'GESTÃO', description: 'Administração BRAVUS. Acompanhe vendas, pagamentos e custos.' },
  tracking: { title: 'Rastreio — Acompanhe seu pedido', description: 'Acompanhe as etapas da entrega do seu pedido.' },
} as const;
export type PageKind = keyof typeof pageMetadata;

export function applyPageMetadata(kind: PageKind) {
  const { title, description } = pageMetadata[kind];
  document.title = title;
  document.documentElement.dataset.portal = kind;
  for (const [attribute, name, content] of [
    ['name', 'description', description], ['property', 'og:title', title],
    ['property', 'og:description', description], ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
  ]) {
    let meta = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute(attribute, name); document.head.append(meta); }
    meta.content = content;
  }
}

/** Used by the build; private account links never enter public HTML. */
export function renderPageMetadata(html: string, kind: PageKind): string {
  const { title, description } = pageMetadata[kind];
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`);
  for (const [attribute, name, content] of [
    ['name', 'description', description], ['property', 'og:title', title],
    ['property', 'og:description', description], ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
  ]) {
    const pattern = new RegExp(`(<meta ${attribute}="${name}" content=")[^"]*("\\s*/?>)`);
    html = html.replace(pattern, (_match, prefix, suffix) => prefix + escape(content) + suffix);
  }
  return html;
}
