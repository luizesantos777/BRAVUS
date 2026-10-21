import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronRight, CircleCheck, ClipboardList, Download, Ellipsis, FileDown, FolderHeart, LayoutDashboard, Menu, Plus, Search, ShieldCheck, Trash2, TrendingUp, Upload, Users, Wallet, X } from 'lucide-react';
import { STORAGE_KEY, amountToCents, dateLabel, emptyData, money, parseData, priorityLabels, removeClient, statusLabels, today, totals } from './domain.ts';
import type { AppData, Client, Task, TaskStatus, Transaction } from './domain.ts';

type Page = 'inicio' | 'clientes' | 'tarefas' | 'financeiro' | 'backup';
type Collection = 'clients' | 'tasks' | 'transactions';
type ModalState = { kind: 'client'; item?: Client } | { kind: 'task'; item?: Task } | { kind: 'transaction'; item?: Transaction } | { kind: 'delete'; collection: Collection; id: string; name: string } | { kind: 'import'; data: AppData } | null;
const pages = [
  { id: 'inicio', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'tarefas', label: 'Tarefas', icon: ClipboardList },
  { id: 'financeiro', label: 'Financeiro', icon: Wallet },
  { id: 'backup', label: 'Dados e backup', icon: ShieldCheck },
] as const;
function currentPage(): Page {
  const hash = window.location.hash.slice(1);
  return pages.some(page => page.id === hash) ? hash as Page : 'inicio';
}
function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return { data: saved ? parseData(JSON.parse(saved)) : emptyData(), error: '' };
  } catch {
    return { data: emptyData(), error: 'Não foi possível ler os dados locais. O conteúdo original foi preservado. Restaure um backup válido antes de cadastrar novos registros.' };
  }
}
function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="modal-heading"><div><span className="eyebrow">BRAVUS · GESTÃO</span><h2 id="modal-title">{title}</h2></div><button className="icon-button" aria-label="Fechar janela" onClick={close}><X size={20} /></button></div>
    {children}
  </dialog>;
}
function EntityForm({ modal, data, save, close }: { modal: Exclude<ModalState, null | { kind: 'delete' } | { kind: 'import' }>; data: AppData; save: (data: AppData, message: string) => boolean; close: () => void }) {
  const [error, setError] = useState('');
  const { kind, item } = modal;
  const title = kind === 'client' ? 'cliente' : kind === 'task' ? 'tarefa' : 'lançamento';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    const base = { id: item?.id ?? crypto.randomUUID(), createdAt: item?.createdAt ?? new Date().toISOString() };
    try {
      const required = kind === 'client' ? field('name') : kind === 'task' ? field('title') : field('description');
      if (!required) throw new Error('Preencha o campo obrigatório com um texto válido.');
      if (kind === 'client' && field('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field('email'))) throw new Error('Informe um e-mail válido, como nome@empresa.com.');
      let next = data;
      if (kind === 'client') {
        const client = { ...base, name: field('name'), company: field('company'), email: field('email'), phone: field('phone') };
        next = { ...data, clients: item ? data.clients.map(value => value.id === item.id ? client : value) : [...data.clients, client] };
      } else if (kind === 'task') {
        const task = { ...base, title: field('title'), clientId: field('clientId') || null, status: field('status') as TaskStatus, priority: field('priority') as Task['priority'], dueDate: field('dueDate') };
        next = { ...data, tasks: item ? data.tasks.map(value => value.id === item.id ? task : value) : [...data.tasks, task] };
      } else {
        const transaction = { ...base, description: field('description'), clientId: field('clientId') || null, type: field('type') as Transaction['type'], amount: amountToCents(field('amount')), date: field('date') };
        next = { ...data, transactions: item ? data.transactions.map(value => value.id === item.id ? transaction : value) : [...data.transactions, transaction] };
      }
      if (save(parseData(next), `${kind === 'task' ? 'Tarefa salva' : kind === 'client' ? 'Cliente salvo' : 'Lançamento salvo'} com sucesso.`)) close();
      else setError('Não foi possível salvar. Verifique as permissões de armazenamento ou restaure um backup válido.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Confira os campos e tente novamente.'); }
  }
  return <Modal title={`${item ? 'Editar' : kind === 'task' ? 'Nova' : 'Novo'} ${title}`} close={close}>
    <form onSubmit={submit} className="entity-form">
      {kind === 'client' ? <>
        <label htmlFor="client-name">Nome do cliente <span aria-hidden="true">*</span></label><input autoFocus id="client-name" name="name" defaultValue={item?.name} required maxLength={120} placeholder="Ex.: Ana Oliveira" />
        <label htmlFor="client-company">Empresa</label><input id="client-company" name="company" defaultValue={item?.company} maxLength={120} placeholder="Nome da empresa" />
        <label htmlFor="client-email">E-mail</label><input id="client-email" name="email" type="email" defaultValue={item?.email} maxLength={160} placeholder="nome@empresa.com" />
        <label htmlFor="client-phone">Telefone</label><input id="client-phone" name="phone" type="tel" defaultValue={item?.phone} maxLength={40} placeholder="(11) 99999-9999" />
      </> : kind === 'task' ? <>
        <label htmlFor="task-title">Título da tarefa <span aria-hidden="true">*</span></label><input autoFocus id="task-title" name="title" defaultValue={item?.title} required maxLength={180} placeholder="O que precisa ser feito?" />
        <div className="form-grid"><div><label htmlFor="task-status">Status</label><select id="task-status" name="status" defaultValue={item?.status ?? 'todo'}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div><label htmlFor="task-priority">Prioridade</label><select id="task-priority" name="priority" defaultValue={item?.priority ?? 'medium'}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>
        <label htmlFor="task-date">Prazo</label><input id="task-date" name="dueDate" type="date" defaultValue={item?.dueDate} />
      </> : <>
        <label htmlFor="transaction-description">Descrição <span aria-hidden="true">*</span></label><input autoFocus id="transaction-description" name="description" defaultValue={item?.description} required maxLength={180} placeholder="Ex.: Pagamento de serviço" />
        <div className="form-grid"><div><label htmlFor="transaction-type">Tipo</label><select id="transaction-type" name="type" defaultValue={item?.type ?? 'income'}><option value="income">Receita</option><option value="expense">Despesa</option></select></div><div><label htmlFor="transaction-amount">Valor (R$) <span aria-hidden="true">*</span></label><input id="transaction-amount" name="amount" inputMode="decimal" defaultValue={item ? (item.amount / 100).toFixed(2).replace('.', ',') : ''} placeholder="1250,50" required aria-describedby="amount-hint" /><small id="amount-hint">Sem separador de milhares.</small></div></div>
        <label htmlFor="transaction-date">Data <span aria-hidden="true">*</span></label><input id="transaction-date" name="date" type="date" required defaultValue={item?.date ?? today()} />
      </>}
      {kind !== 'client' && <><label htmlFor="linked-client">Cliente vinculado</label><select id="linked-client" name="clientId" defaultValue={item?.clientId ?? ''}><option value="">Sem cliente vinculado</option>{data.clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancelar</button><button type="submit" className="button primary"><Check size={17} />{item ? 'Salvar alterações' : `Salvar ${title}`}</button></div>
    </form>
  </Modal>;
}

export default function App() {
  const [initial] = useState(load);
  const [data, setData] = useState(initial.data);
  const [storageError, setStorageError] = useState(initial.error);
  const [page, setPage] = useState<Page>(currentPage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [period, setPeriod] = useState('all');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const navigate = () => { setPage(currentPage()); setQuery(''); setFilter('all'); setMenuOpen(false); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  function save(next: AppData, message: string, restore = false) {
    if (storageError && !restore) { setNotice({ text: storageError, error: true }); return false; }
    try {
      const backup = JSON.stringify(next, null, 2);
      if (new Blob([backup]).size > 5_000_000) { setNotice({ text: 'O limite de 5 MB foi atingido. Exporte um backup e remova registros antes de continuar.', error: true }); return false; }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setData(next); setStorageError(''); setNotice({ text: message, error: false }); return true;
    } catch { setNotice({ text: 'Não foi possível salvar. Verifique o espaço e as permissões de armazenamento do navegador.', error: true }); return false; }
  }
  function exportData() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bravus-backup-${today()}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ text: 'Backup gerado. Guarde o arquivo em um local seguro.', error: false });
  }
  async function importData(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('O backup deve ter até 5 MB.');
      setModal({ kind: 'import', data: parseData(JSON.parse(await file.text())) });
    } catch (cause) { setNotice({ text: cause instanceof SyntaxError ? 'O arquivo não contém um JSON válido.' : cause instanceof Error ? cause.message : 'Não foi possível abrir o backup.', error: true }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }
  function deleteItem() {
    if (modal?.kind !== 'delete') return;
    const next = modal.collection === 'clients' ? removeClient(data, modal.id) : { ...data, [modal.collection]: data[modal.collection].filter(item => item.id !== modal.id) };
    if (save(next, 'Registro excluído.')) setModal(null);
  }
  const clientName = (id: string | null) => data.clients.find(client => client.id === id)?.name ?? 'Sem cliente';
  const matches = (...values: string[]) => values.join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR').trim());
  const month = today().slice(0, 7);
  const monthTotals = totals(data, month);
  const financeTotals = totals(data, period === 'month' ? month : undefined);
  const pending = data.tasks.filter(task => task.status !== 'done').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const clients = data.clients.filter(client => matches(client.name, client.company, client.email, client.phone));
  const tasks = data.tasks.filter(task => matches(task.title, clientName(task.clientId)) && (filter === 'all' || task.status === filter));
  const transactions = data.transactions.filter(item => matches(item.description, clientName(item.clientId)) && (filter === 'all' || item.type === filter) && (period !== 'month' || item.date.startsWith(month))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const navigation = pages.find(item => item.id === page)!;
  const addButton = (kind: 'client' | 'task' | 'transaction', label: string, secondary = false) => <button className={`button ${secondary ? 'secondary' : 'primary'}`} onClick={() => setModal({ kind })}><Plus size={18} />{label}</button>;
  const editDelete = (collection: Collection, item: Client | Task | Transaction, name: string) => <div className="row-actions"><button className="icon-button" aria-label={`Editar ${name}`} onClick={() => setModal(collection === 'clients' ? { kind: 'client', item: item as Client } : collection === 'tasks' ? { kind: 'task', item: item as Task } : { kind: 'transaction', item: item as Transaction })}><Ellipsis size={20} /></button><button className="icon-button danger" aria-label={`Excluir ${name}`} onClick={() => setModal({ kind: 'delete', collection, id: item.id, name })}><Trash2 size={16} /></button></div>;
  const stats = (values: ReturnType<typeof totals>, monthly = false) => <div className={`stats ${page === 'inicio' ? 'four' : ''}`}>
    {[{ label: monthly ? 'Receitas do mês' : 'Receitas', value: money(values.income), className: 'green', icon: ArrowDownLeft, sub: 'Entradas registradas' }, { label: monthly ? 'Despesas do mês' : 'Despesas', value: money(values.expense), className: 'orange', icon: ArrowUpRight, sub: 'Saídas registradas' }, { label: monthly ? 'Saldo do mês' : 'Saldo', value: money(values.balance), className: 'dark', icon: Wallet, sub: 'Receitas menos despesas' }, ...(page === 'inicio' ? [{ label: 'Clientes cadastrados', value: String(data.clients.length).padStart(2, '0'), className: 'purple', icon: Users, sub: 'Conexões que fazem crescer' }] : [])].map(item => <article className={`stat ${item.className}`} key={item.label}><div className="stat-top"><span>{item.label}</span><span className="stat-icon"><item.icon size={19} /></span></div><strong>{item.value}</strong><small>{item.sub}</small></article>)}
  </div>;
  function taskRows(items: Task[]) {
    return <div className="task-list">{items.map(task => <article key={task.id} className={`task-row ${task.status === 'done' ? 'completed' : ''}`}>
      <button className={`task-check ${task.status === 'done' ? 'checked' : ''}`} aria-label={`${task.status === 'done' ? 'Reabrir' : 'Concluir'} tarefa ${task.title}`} onClick={() => save({ ...data, tasks: data.tasks.map(item => item.id === task.id ? { ...item, status: task.status === 'done' ? 'todo' : 'done' } : item) }, task.status === 'done' ? 'Tarefa reaberta.' : 'Tarefa concluída.')}><Check size={14} /></button>
      <div className="task-body"><strong>{task.title}</strong><span>{clientName(task.clientId)}<i /> <span className={task.dueDate && task.dueDate < today() && task.status !== 'done' ? 'overdue' : ''}>{dateLabel(task.dueDate)}</span></span></div>
      <span className={`badge priority-${task.priority}`}>{priorityLabels[task.priority]}</span><span className={`badge status-${task.status}`}>{statusLabels[task.status]}</span>{editDelete('tasks', task, task.title)}
    </article>)}</div>;
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); document.getElementById('main-content')?.scrollIntoView(); }}>Pular para o conteúdo</a>
    {menuOpen && <button className="menu-backdrop" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href="#inicio" onClick={() => setMenuOpen(false)}><span className="brand-mark">B<span /></span><span>BRAVUS<small>SEU PRÓXIMO PASSO.</small></span></a>
      <div className="workspace"><span className="workspace-avatar">B.</span><div><strong>Meu negócio</strong><small>Seu espaço de gestão</small></div><ChevronRight size={15} /></div>
      <span className="nav-label">ESPAÇO DE TRABALHO</span>
      <nav aria-label="Menu principal">{pages.map(item => <a key={item.id} className={page === item.id ? 'active' : ''} href={`#${item.id}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => setMenuOpen(false)}><item.icon size={20} /><span>{item.label}</span>{item.id === 'tarefas' && pending.length > 0 && <small>{pending.length}</small>}</a>)}</nav>
      <div className="sidebar-note"><span className="note-decoration">↗</span><strong>Organize hoje.<br />Vá além amanhã.</strong><p>Pequenos passos.<br />Grandes possibilidades.</p></div>
      <div className="storage-note"><ShieldCheck size={18} /><div><strong>Dados neste navegador</strong><a href="#backup">Mantenha seu backup em dia <ArrowUpRight size={12} /></a></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Abrir menu" aria-expanded={menuOpen}><Menu size={22} /></button><span>Meu negócio</span><ChevronRight size={14} /><strong>{navigation.label}</strong></div><div className="topbar-right"><span className="today"><CalendarDays size={15} />{new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span><span className="profile-avatar" aria-label="Meu negócio">B</span></div></header>
      <main id="main-content" tabIndex={-1}>
        {storageError && <div className="storage-warning" role="alert">{storageError} <a href="#backup">Abrir backups</a></div>}
        <div className="page-heading"><div><span className="eyebrow">{page === 'inicio' ? 'CADA PASSO CONTA' : 'TUDO NO SEU LUGAR'}</span><h1>{page === 'inicio' ? 'Seu negócio, em movimento.' : navigation.label}</h1><p>{({ inicio: 'Uma visão clara para seguir em frente.', clientes: 'Cuide das conexões que movem seu negócio.', tarefas: 'Transforme planos em pequenas conquistas.', financeiro: 'Acompanhe cada entrada e cada saída.', backup: 'Seus dados, sob seu controle.' })[page]}</p></div>{page === 'inicio' || page === 'financeiro' ? addButton('transaction', 'Novo lançamento') : page === 'clientes' ? addButton('client', 'Novo cliente') : page === 'tarefas' ? addButton('task', 'Nova tarefa') : <button className="button primary" onClick={exportData}><Download size={18} />Exportar backup</button>}</div>
        {page === 'inicio' && <>
          <section className="welcome-card"><div><span className="welcome-label"><span /> MAIS FOCO. MAIS POSSIBILIDADES.</span><h2>Abra espaço para<br />o que vem a seguir.</h2><p>Clientes, tarefas e finanças. Tudo conectado<br className="desktop-break" /> para você cuidar do que importa.</p><a className="welcome-link" href="#tarefas">Organizar minhas tarefas <ArrowRight size={18} /></a></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="growth-bar bar-one" /><div className="growth-bar bar-two" /><div className="growth-bar bar-three" /><div className="growth-arrow"><ArrowUpRight strokeWidth={1.2} /></div><span className="art-star">✳</span><div className="art-pill"><Check size={15} /> Um passo de cada vez</div></div></section>
          {stats(monthTotals, true)}
          <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><h2>Fluxo de caixa</h2><p>Seu movimento nos últimos 6 meses</p></div><span className="chart-icon"><TrendingUp size={20} /></span></div><CashChart data={data} /></section><section className="panel"><div className="panel-heading"><div><h2>Próximos passos</h2><p>{pending.length ? `${pending.length} ${pending.length === 1 ? 'tarefa para acompanhar' : 'tarefas para acompanhar'}` : 'Uma coisa de cada vez'}</p></div><a className="text-link" href="#tarefas" aria-label="Ver todas as tarefas"><ArrowUpRight size={20} /></a></div>{pending.length ? <>{taskRows(pending.slice(0, 4))}<a className="panel-footer-link" href="#tarefas">Ver todas as tarefas <ArrowRight size={15} /></a></> : <Empty icon={<ClipboardList size={25} />} title="Qual é o próximo passo?" action={addButton('task', 'Criar primeira tarefa', true)}>Tire uma ideia do papel e comece por aqui.</Empty>}</section></div>
          <section className="panel"><div className="panel-heading"><div><h2>Movimentações recentes</h2><p>As últimas entradas e saídas do seu negócio</p></div><a className="text-link" href="#financeiro">Ver financeiro <ArrowRight size={16} /></a></div>{data.transactions.length ? <div className="recent-transactions">{[...data.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4).map(item => <div className="recent-row" key={item.id}><span className={`movement-icon ${item.type}`}>{item.type === 'income' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span><div><strong>{item.description}</strong><small>{clientName(item.clientId)} · {dateLabel(item.date)}</small></div><strong className={item.type === 'income' ? 'income-text' : 'expense-text'}>{item.type === 'income' ? '+' : '−'} {money(item.amount)}</strong></div>)}</div> : <Empty icon={<Wallet size={25} />} title="Cada movimento importa" action={addButton('transaction', 'Registrar movimentação', true)}>Registre uma receita ou despesa para começar a acompanhar suas finanças.</Empty>}</section>
        </>}
        {page === 'clientes' && <section className="panel"><div className="list-toolbar"><div><h2>Sua rede de clientes <span className="count">{data.clients.length}</span></h2><p>Pessoas e empresas que fazem parte da sua história.</p></div><SearchBox value={query} change={setQuery} label="Buscar clientes" /></div>{clients.length ? <div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Empresa</th><th>Contato</th><th className="align-right">Ações</th></tr></thead><tbody>{clients.map(client => <tr key={client.id}><td><div className="client-identity"><span className="client-avatar" aria-hidden="true">{client.name.split(' ').filter(Boolean).slice(0, 2).map(name => name[0]).join('').toUpperCase()}</span><strong>{client.name}</strong></div></td><td>{client.company || '—'}</td><td><div className="contact-cell">{client.email && <a href={`mailto:${client.email}`}>{client.email}</a>}{client.phone && <span>{client.phone}</span>}{!client.email && !client.phone && <span>Sem contato informado</span>}</div></td><td>{editDelete('clients', client, client.name)}</td></tr>)}</tbody></table></div> : <Empty icon={<Users size={28} />} title={query ? 'Nenhum cliente encontrado' : 'Boas conexões começam aqui'} action={!query && addButton('client', 'Cadastrar primeiro cliente', true)}>{query ? 'Tente buscar por outro nome, empresa ou contato.' : 'Cadastre seu primeiro cliente e mantenha os contatos por perto.'}</Empty>}</section>}
        {page === 'tarefas' && <><div className="task-summary">{Object.entries(statusLabels).map(([key, label]) => <button key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(filter === key ? 'all' : key)} aria-pressed={filter === key}><span className={`status-dot ${key}`} /><span>{label}</span><strong>{data.tasks.filter(task => task.status === key).length}</strong></button>)}</div><section className="panel"><div className="list-toolbar"><div><h2>{filter === 'all' ? 'Todas as tarefas' : statusLabels[filter as TaskStatus]} <span className="count">{tasks.length}</span></h2><p>Defina prioridades. Celebre cada conclusão.</p></div><SearchBox value={query} change={setQuery} label="Buscar tarefas" /></div>{tasks.length ? taskRows(tasks) : <Empty icon={<CircleCheck size={28} />} title={query || filter !== 'all' ? 'Nenhuma tarefa por aqui' : 'Dê o primeiro passo'} action={!query && filter === 'all' && addButton('task', 'Criar primeira tarefa', true)}>{query || filter !== 'all' ? 'Experimente outra busca ou selecione outro status.' : 'Organize seu dia com uma tarefa simples para começar.'}</Empty>}</section></>}
        {page === 'financeiro' && <><div className="period-bar"><span><span className="status-dot doing" /> Resumo financeiro</span><label className="sr-only" htmlFor="finance-period">Período financeiro</label><select id="finance-period" value={period} onChange={event => setPeriod(event.target.value)}><option value="all">Todos os períodos</option><option value="month">Este mês</option></select></div>{stats(financeTotals)}<section className="panel"><div className="list-toolbar"><div><h2>Movimentações <span className="count">{transactions.length}</span></h2><p>Clareza para decidir o próximo passo.</p></div><div className="toolbar-inputs"><label className="sr-only" htmlFor="transaction-filter">Tipo de movimentação</label><select id="transaction-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos os tipos</option><option value="income">Receitas</option><option value="expense">Despesas</option></select><SearchBox value={query} change={setQuery} label="Buscar movimentações" /></div></div>{transactions.length ? <div className="table-scroll"><table><thead><tr><th>Descrição</th><th>Cliente</th><th>Data</th><th>Tipo</th><th className="align-right">Valor</th><th className="align-right">Ações</th></tr></thead><tbody>{transactions.map(item => <tr key={item.id}><td><strong>{item.description}</strong></td><td>{clientName(item.clientId)}</td><td className="nowrap">{new Intl.DateTimeFormat('pt-BR').format(new Date(`${item.date}T12:00:00`))}</td><td><span className={`badge ${item.type}`}>{item.type === 'income' ? 'Receita' : 'Despesa'}</span></td><td className={`align-right nowrap ${item.type === 'income' ? 'income-text' : 'expense-text'}`}><strong>{item.type === 'income' ? '+' : '−'} {money(item.amount)}</strong></td><td>{editDelete('transactions', item, item.description)}</td></tr>)}</tbody></table></div> : <Empty icon={<Wallet size={28} />} title={query || filter !== 'all' || period !== 'all' ? 'Nenhuma movimentação encontrada' : 'Vamos colocar as contas em dia?'} action={!query && filter === 'all' && period === 'all' && addButton('transaction', 'Registrar primeira movimentação', true)}>{query || filter !== 'all' || period !== 'all' ? 'Tente outro filtro, período ou termo de busca.' : 'Registre as receitas e despesas para acompanhar o saldo do seu negócio.'}</Empty>}</section></>}
        {page === 'backup' && <><section className="backup-intro"><span className="empty-icon"><ShieldCheck size={30} /></span><div><h2>Seu negócio merece cuidado.</h2><p>Os registros ficam apenas neste navegador e neste dispositivo. Não há sincronização entre dispositivos, conta de usuário ou envio para um servidor. Exporte um backup regularmente, especialmente antes de limpar os dados do navegador.</p></div></section><div className="backup-grid"><section className="panel backup-card"><FileDown size={27} /><h2>Uma cópia para guardar</h2><p>Exporte clientes, tarefas e movimentações em um arquivo JSON. Guarde-o com segurança: ele contém os dados do seu negócio.</p><button className="button primary" onClick={exportData}><Download size={17} />Baixar backup</button></section><section className="panel backup-card"><Upload size={27} /><h2>Retome de onde parou</h2><p>Selecione um backup BRAVUS. Os dados serão validados antes da confirmação. A restauração substitui os registros atuais.</p><button className="button secondary" onClick={() => fileRef.current?.click()}><Upload size={17} />Selecionar backup</button></section></div><div className="data-summary"><FolderHeart size={19} /><span>{data.clients.length} clientes · {data.tasks.length} tarefas · {data.transactions.length} movimentações</span><small>Formato do backup: versão 1</small></div></>}
        <footer className="page-footer"><span>BRAVUS<span className="footer-dot">.</span> <span>Gestão para seguir em frente.</span></span><a href="#backup"><ShieldCheck size={13} /> Seus dados ficam com você</a></footer>
      </main>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Arquivo de backup" onChange={event => void importData(event.target.files?.[0])} />
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <X size={18} /> : <Check size={18} />}<span>{notice.text}</span><button className="icon-button" aria-label="Fechar aviso" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {modal && (modal.kind === 'delete' ? <Modal title="Excluir registro?" close={() => setModal(null)}><p className="modal-copy">Você está prestes a excluir <strong>{modal.name}</strong>. Esta ação não pode ser desfeita.{modal.collection === 'clients' && ' As tarefas e movimentações serão mantidas, sem vínculo com este cliente.'}</p><div className="modal-actions"><button className="button secondary" onClick={() => setModal(null)}>Cancelar</button><button className="button destructive" onClick={deleteItem}><Trash2 size={17} />Confirmar exclusão</button></div></Modal> : modal.kind === 'import' ? <Modal title="Restaurar este backup?" close={() => setModal(null)}><p className="modal-copy">O arquivo contém <strong>{modal.data.clients.length} clientes, {modal.data.tasks.length} tarefas e {modal.data.transactions.length} movimentações</strong>. Os registros atuais serão substituídos. Exporte uma cópia antes de continuar.</p><div className="modal-actions"><button className="button secondary" onClick={exportData}><Download size={17} />Exportar atuais</button><button className="button primary" onClick={() => { if (save(modal.data, 'Backup restaurado com sucesso.', true)) setModal(null); }}>Confirmar restauração</button></div></Modal> : <EntityForm key={`${modal.kind}-${modal.item?.id ?? 'new'}`} modal={modal} data={data} save={save} close={() => setModal(null)} />)}
  </div>;
}

function SearchBox({ value, change, label }: { value: string; change: (value: string) => void; label: string }) {
  return <div className="search-box"><Search size={17} /><input aria-label={label} placeholder={label} value={value} onChange={event => change(event.target.value)} />{value && <button className="icon-button" aria-label="Limpar busca" onClick={() => change('')}><X size={15} /></button>}</div>;
}
function CashChart({ data }: { data: AppData }) {
  const date = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(date.getFullYear(), date.getMonth() - 5 + index, 1);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    return { key, label: start.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), ...totals(data, key) };
  });
  const max = Math.max(1, ...months.flatMap(month => [month.income, month.expense]));
  const hasData = months.some(month => month.income || month.expense);
  return <div className="cash-chart"><div className="chart-legend"><span><i className="income" />Receitas</span><span><i className="expense" />Despesas</span></div><div className="chart-plot" role="img" aria-label={hasData ? months.map(month => `${month.label}: receitas ${money(month.income)}, despesas ${money(month.expense)}`).join('; ') : 'Nenhuma movimentação nos últimos seis meses'}><div className="chart-grid"><span /><span /><span /><span /></div>{!hasData && <div className="chart-empty"><TrendingUp size={23} /><strong>Seu próximo movimento começa aqui</strong><span>Registre uma movimentação para ver o gráfico.</span></div>}<div className="chart-months">{months.map(month => <div className="chart-month" key={month.key}><div className="bar-pair"><div className="chart-bar income" style={{ height: `${month.income ? Math.max(2, month.income / max * 100) : 0}%` }} /><div className="chart-bar expense" style={{ height: `${month.expense ? Math.max(2, month.expense / max * 100) : 0}%` }} /></div><small>{month.label}</small></div>)}</div></div></div>;
}
