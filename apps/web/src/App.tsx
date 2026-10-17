import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { KwzNote, LibraryFolder, LibraryStatus, NoteList } from '../../../packages/shared/src/types';
import { api, ApiRequestError } from './lib/api';
import GalleryGrid from './components/GalleryGrid';
import EmptyState from './components/EmptyState';
import KwzPlayer from './components/KwzPlayer';
import HomeMenu, { PageArrow } from './components/HomeMenu';
export default function App() {
  const [screen, setScreen] = useState<'home' | 'view'>('home');
  const [homePage, setHomePage] = useState(0);
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [list, setList] = useState<NoteList | null>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [folder, setFolder] = useState('000');
  const [page, setPage] = useState(1); const [selected, setSelected] = useState<KwzNote | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [folderError, setFolderError] = useState('');
  const [listError, setListError] = useState('');
  const [choosingDirectory, setChoosingDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const libraryVersion = useRef(0);
  const pageDots = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pageDots.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [list]);
  const chooseDirectory = async () => {
    setChoosingDirectory(true); setDirectoryError('');
    try {
      const result = await api<{ cancelled: boolean; status?: LibraryStatus }>('/api/library/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!result.cancelled && result.status) {
        libraryVersion.current++;
        setOrderMessage('');
        setFolderError(''); setListError('');
        setSelected(null); setList(null); setLoading(true); setFolders([]); setFolder(''); setPage(1); setError(''); setStatus(result.status);
      }
    } catch (e) { setDirectoryError(e instanceof Error ? e.message : 'フォルダを開けませんでした。'); }
    finally { setChoosingDirectory(false); }
  };
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderMessage, setOrderMessage] = useState('');
  const [orderFading, setOrderFading] = useState(false);
  const [orderRevision, setOrderRevision] = useState(0);
  const pageDragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopPageDrag = () => { if (pageDragTimer.current) clearTimeout(pageDragTimer.current); pageDragTimer.current = null; };
  useEffect(() => { setDraggedId(null); setOrderMessage(''); stopPageDrag(); }, [folder, screen]);
  useEffect(() => { if (!draggedId) stopPageDrag(); return stopPageDrag; }, [draggedId]);
  useEffect(() => {
    setOrderFading(false);
    if (orderMessage !== '並び順を保存しました') return;
    const fade = setTimeout(() => setOrderFading(true), 1800);
    const clear = setTimeout(() => { setOrderMessage(''); setOrderFading(false); }, 2200);
    return () => { clearTimeout(fade); clearTimeout(clear); };
  }, [orderMessage, orderRevision]);
  const moveNote = async (sourceId: string, targetId: string, placement: 'before' | 'after') => {
    if (savingOrder) return;
    setSavingOrder(true); setOrderMessage('並び順を保存中…');
    try {
      await api('/api/notes/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, sourceId, targetId, placement }) });
      setOrderRevision(v => v + 1); setOrderMessage('並び順を保存しました');
    } catch (e) { setOrderMessage('保存できませんでした'); setError(e instanceof Error ? e.message : '並び順を保存できません。'); }
    finally { setSavingOrder(false); }
  };
  const hoverPage = (delta: number) => (event: DragEvent<HTMLButtonElement>) => {
    if (!draggedId || loading || savingOrder) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    if (!pageDragTimer.current) pageDragTimer.current = setTimeout(() => { pageDragTimer.current = null; setPage(p => Math.max(1, Math.min(p + delta, pages))); }, 650);
  };
  const leavePage = (event: DragEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const style = getComputedStyle(event.currentTarget);
    const x = parseFloat(style.getPropertyValue('--drag-hit-x')) || 0;
    const y = parseFloat(style.getPropertyValue('--drag-hit-y')) || 0;
    // DragLeave bubbles from SVG children even when the pointer remains over the arrow.
    if (event.clientX < box.left - x || event.clientX > box.right + x || event.clientY < box.top - y || event.clientY > box.bottom + y) stopPageDrag();
  };
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const desktopStatus = (event: Event) => {
      libraryVersion.current++;
      setStatus((event as CustomEvent<LibraryStatus>).detail); setConnectionError('');
    };
    window.addEventListener('kwz-library-status', desktopStatus);
    const poll = async () => {
      const version = libraryVersion.current;
      try { const data = await api<LibraryStatus>('/api/health', { signal: abort.signal }); if (!stopped && version === libraryVersion.current) { setStatus(data); setConnectionError(''); } }
      catch (e) { if (!stopped && version === libraryVersion.current) setConnectionError(e instanceof Error ? e.message : '接続できません。'); }
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    void poll(); return () => { stopped = true; window.removeEventListener('kwz-library-status', desktopStatus); abort.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (screen !== 'view') return;
    if (!status?.directoryConfigured || status.scanStatus === 'error') { setFolders([]); return; }
    if (status.scanStatus !== 'ready') return;
    const abort = new AbortController();
    api<LibraryFolder[]>('/api/folders', { signal: abort.signal }).then(data => {
      // Root-level works otherwise become unreachable when a subfolder is selected.
      const nestedCount = data.filter(f => !f.path.includes('/')).reduce((sum, f) => sum + f.count, 0);
      if (status.total > nestedCount) data = [{ path: '', count: status.total }, ...data];
      setFolders(data);
      setFolderError('');
      if (!data.length) setFolder('');
      if (data.length && !data.some(f => f.path === folder)) {
        setFolder(data.some(f => f.path === '000') ? '000' : data[0].path); setPage(1);
      }
    }).catch(e => { if (!abort.signal.aborted) setFolderError(e instanceof Error ? e.message : 'フォルダーを取得できません。'); });
    return () => abort.abort();
  }, [screen, status?.directory, status?.directoryConfigured, status?.scanStatus, status?.lastScannedAt, folder]);
  useEffect(() => {
    if (screen !== 'view') return;
    if (!status) return;
    if (!status.directoryConfigured || status.scanStatus === 'error') { setList(null); setLoading(false); return; }
    if (status.scanStatus !== 'ready') { setLoading(true); return; }
    const abort = new AbortController(); setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '6', folder });
    api<NoteList>(`/api/notes?${params}`, { signal: abort.signal }).then(data => {
      setList(data);
      setListError('');
      if (!data.items.length && page > 1) setPage(Math.max(1, Math.ceil(data.total / 6)));
    }).catch(e => { if (!abort.signal.aborted) setListError(e instanceof Error ? e.message : '一覧を取得できません。'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [screen, folder, page, orderRevision, status?.directory, status?.directoryConfigured, status?.lastScannedAt, status?.scanStatus]);
  useEffect(() => {
    if (!selected || status?.scanStatus !== 'ready') return;
    const abort = new AbortController();
    api<KwzNote>(`/api/notes/${selected.id}`, { signal: abort.signal }).then(note => {
      if (!abort.signal.aborted) setSelected(current => current?.id === note.id ? note : current);
    }).catch(e => {
      if (!abort.signal.aborted && e instanceof ApiRequestError && e.status === 404) { setSelected(null); setError('開いていた作品が削除されました。'); }
    });
    return () => abort.abort();
  }, [selected?.id, status?.lastScannedAt, status?.scanStatus]);
  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / (list?.pageSize ?? 6)));
  const displayedPage = Math.min(list?.page ?? 1, pages);
  const folderLabel = (path: string) => path === '' ? 'すべて' : path === '000' ? 'ホーム' : path;
  const appHeader = <header className="app-header"><button className="brand" onClick={() => setScreen('home')} aria-label="kwz viewer ホーム">kwz viewer</button><span className={`header-note ${orderFading ? 'is-fading' : ''}`} role="status">{screen === 'home' ? '' : orderMessage}</span></header>;
  return <main className={`paper-app ${screen === 'view' ? 'is-view' : ''}`}>
    {screen === 'home' ? <>{appHeader}<HomeMenu page={homePage} setPage={setHomePage} view={() => setScreen('view')} /></> : <section className="view-screen" aria-label="作品一覧">
      <div className="view-top">{appHeader}<nav className="folder-strip" aria-label="フォルダー">
        {folders.map(f => <button key={f.path} className={`folder-button ${folder === f.path ? 'active' : ''}`} aria-label={`${folderLabel(f.path)}フォルダー`} aria-pressed={folder === f.path} onClick={() => { setFolder(f.path); setPage(1); }}><span className="folder-shape"><svg className="folder-outline" viewBox="0 0 70 56" preserveAspectRatio="none" aria-hidden="true"><path vectorEffect="non-scaling-stroke" d="M2 12V6Q2 2 6 2H26Q30 2 32 6L36 12H62Q68 12 68 18V50Q68 54 62 54H8Q2 54 2 48Z" /></svg><span className="folder-reflection" aria-hidden="true"><svg viewBox="0 0 70 56" preserveAspectRatio="none" aria-hidden="true"><path vectorEffect="non-scaling-stroke" d="M2 12V6Q2 2 6 2H26Q30 2 32 6L36 12H62Q68 12 68 18V50Q68 54 62 54H8Q2 54 2 48Z" /></svg></span>{f.path === '000' ? <img className="folder-mascot" src="/images/kawazu.svg" alt="" /> : f.path === '' ? 'すべて' : f.path.split('/').at(-1)?.slice(0, 3)}</span></button>)}</nav></div>
      {status?.message && status.scanStatus !== 'error' && <p className="error" role="status">{status.message}</p>}
      <div className="gallery-pager">
        <div className="gallery-sheet">
          {status && (!status.directoryConfigured || status.scanStatus === 'error') ? <EmptyState title={status.directoryConfigured ? 'フォルダを確認してください' : 'フォルダが選択されていません'} message={status.directoryConfigured ? 'フォルダを選び直すか、アクセス権を確認してください。' : 'KWZを保存したフォルダを選択してください。'}>
            <button className="primary folder-open" disabled={choosingDirectory} onClick={() => { void chooseDirectory(); }}>{choosingDirectory ? 'フォルダを選択中…' : 'フォルダを開く'}</button>
          </EmptyState> :
          (loading && !list?.items.length) || (!list?.items.length && status?.scanStatus === 'scanning') ? <EmptyState loading title="読み込み中……" message="作品の情報を読み込んでいます。しばらくお待ちください。" /> :
          list?.items.length ? <GalleryGrid notes={list.items} open={setSelected} reorderable={!savingOrder && !loading && status?.scanStatus === 'ready'} draggedId={draggedId} setDraggedId={setDraggedId} move={(source, target, placement) => { void moveNote(source, target, placement); }} /> :
          <EmptyState title="作品がありません" message=".kwz を対象フォルダに追加してください。変更は自動反映されます。" />}
        </div>
        <PageArrow direction="left" disabled={page <= 1 || loading || savingOrder} onClick={() => setPage(page - 1)} label="前の作品ページ" onDragOver={hoverPage(-1)} onDragLeave={leavePage} dragActive={!!draggedId} />
        <PageArrow direction="right" disabled={page >= pages || loading || savingOrder} onClick={() => setPage(page + 1)} label="次の作品ページ" onDragOver={hoverPage(1)} onDragLeave={leavePage} dragActive={!!draggedId} />
      </div>
      <div className="gallery-page-status" data-page={displayedPage} aria-label={`${displayedPage} / ${pages} ページ`} aria-busy={loading}><div ref={pageDots} className="page-dots" aria-hidden="true">{Array.from({ length: pages }, (_, i) => <i key={i} className={i === displayedPage - 1 ? 'current' : ''} />)}</div></div>
      <div className="view-bottom"><button onClick={() => setScreen('home')} aria-label="トップに戻る">↶</button><button className="folder-select" aria-label="フォルダ選択" title={status?.directory ? `選択中：${status.directory}` : 'フォルダ選択'} disabled={choosingDirectory} onClick={() => { void chooseDirectory(); }}><span>{choosingDirectory ? 'フォルダを選択中…' : status?.directory ? `選択中：${status.directory}` : 'フォルダ選択'}</span></button></div>
      {directoryError && <p className="error" role="alert">{directoryError}</p>}
    </section>}
    {(error || folderError || listError || connectionError) && <p className="error" role="alert">{error || folderError || listError || connectionError}</p>}
    {selected && <KwzPlayer key={`${selected.id}:${selected.fileModifiedAt}`} note={selected} close={() => setSelected(null)} />}
  </main>;
}
