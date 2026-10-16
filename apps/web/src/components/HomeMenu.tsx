import MenuIcon from './MenuIcon';
import type { DragEventHandler } from 'react';
export function PageArrow({ direction, disabled, onClick, label, onDragOver, onDragLeave, dragActive = false }: { direction: 'left' | 'right'; disabled: boolean; onClick: () => void; label: string; onDragOver?: DragEventHandler<HTMLButtonElement>; onDragLeave?: DragEventHandler<HTMLButtonElement>; dragActive?: boolean }) {
  return <button className={`page-arrow ${direction} ${dragActive ? 'drag-zone-active' : ''}`} aria-label={label} disabled={disabled} onClick={onClick} onDragOver={onDragOver} onDragLeave={onDragLeave}><svg viewBox="0 0 60 90" aria-hidden="true"><path d="M12 8 Q7 4 7 15V75Q7 86 15 80L51 48Q56 44 50 39Z" /></svg></button>;
}
export default function HomeMenu({ page, setPage, view }: { page: number; setPage: (page: number) => void; view: () => void }) {
  return <section className="home-menu" aria-label={`トップ画面 ${page + 1}`}>
    <div className="menu-carousel"><div className="menu-track" style={{ transform: `translateX(-${page * 100}%)` }}>
      <div className="menu-slide" inert={page !== 0}><button className="menu-option" onClick={view}><span className="menu-tile reference-tile"><img src="/images/miru.svg" alt="" /></span><span>みる</span></button><button className="menu-option" aria-disabled="true"><span className="menu-tile reference-tile"><img src="/images/kaku.svg" alt="" /></span><span>かく</span></button></div>
      <div className="menu-slide" inert={page !== 1}><button className="menu-option community" aria-disabled="true"><span className="menu-tile"><span className="world-globe" aria-hidden="true">◎</span><strong>ワールド<br />kwzギャラリー</strong></span><span>インターネットコミュニティ</span></button></div>
      <div className="menu-slide" inert={page !== 2}><button className="menu-option" aria-disabled="true"><span className="menu-tile"><MenuIcon kind="exchange" /></span><span>こうかん</span></button><button className="menu-option" aria-disabled="true"><span className="menu-tile"><MenuIcon kind="settings" /></span><span>設定</span></button></div>
    </div><PageArrow direction="left" disabled={page === 0} onClick={() => setPage(page - 1)} label="前のトップ画面" /><PageArrow direction="right" disabled={page === 2} onClick={() => setPage(page + 1)} label="次のトップ画面" /></div>
    <div className="page-dots" aria-label={`${page + 1} / 3`}>{[0, 1, 2].map(i => <button key={i} aria-label={`トップ画面 ${i + 1}へ`} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)} />)}</div>
  </section>;
}
