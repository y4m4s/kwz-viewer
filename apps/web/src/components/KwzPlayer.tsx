import { useEffect, useRef, useState } from 'react';
import { Player, PlayerEvent } from 'flipnote.js';
import type { KwzNote } from '../../../../packages/shared/src/types';
import { date, noteBytes, playbackPriority } from '../lib/api';
import PlaybackIcon from './PlaybackIcon';

export default function KwzPlayer({ note, close }: { note: KwzNote; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageCount, setPageCount] = useState(note.frameCount ?? 0);
  const [volume, setVolume] = useState(0.8);
  const [loop, setLoop] = useState(note.loop ?? false);
  const [error, setError] = useState('');
  useEffect(() => {
    playbackPriority(true);
    dialog.current?.showModal();
    let disposed = false;
    const abort = new AbortController();
    let instance: Player | null = null;
    const sync = () => { if (!disposed && instance) { setPlaying(instance.isPlaying); setCurrentPage(instance.showThumbnail ? 0 : instance.currentFrame + 1); } };
    const onError = () => { if (!disposed) setError('再生に失敗しました。別の作品をお試しください。'); };
    const events = [PlayerEvent.Play, PlayerEvent.Pause, PlayerEvent.Ended, PlayerEvent.FrameUpdate];
    const loading = (async () => {
      // Fetch can be aborted before creating the library's renderer or audio context.
      const bytes = await noteBytes(note.id, abort.signal);
      if (disposed || !container.current) return;
      instance = new Player(container.current, 320, 240);
      instance.on(events, sync); instance.on(PlayerEvent.Error, onError);
      await instance.load(bytes);
      if (disposed) return;
      instance.volume = 0.8; instance.loop = note.loop ?? false;
      player.current = instance; setPageCount(instance.frameCount); sync(); setReady(true);
    })().catch(e => { if (!disposed) setError(e instanceof Error ? e.message : '作品を読み込めません。'); });
    return () => {
      playbackPriority(false);
      disposed = true; abort.abort(); player.current = null;
      if (instance) {
        instance.pause(); instance.off(events, sync); instance.off(PlayerEvent.Error, onError);
      }
      // A pending load may create audio resources; destroy after it settles.
      void loading.finally(() => { if (instance) { instance.pause(); void instance.destroy().catch(() => {}); } });
    };
  }, [note.id, note.loop]);
  const togglePlayback = () => {
    const p = player.current; if (!p || !ready || error) return;
    try { if (p.isPlaying) p.pause(); else void Promise.resolve(p.play()).catch(() => setError('音声・映像を再生できません。')); }
    catch { setError('音声・映像を再生できません。'); }
  };
  return <dialog ref={dialog} className="player-dialog" aria-label="作品詳細" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="player-panel"><header><button aria-label="閉じる" className="close" onClick={close}>×</button></header>
      <div className="player-stage"><div ref={container} className="canvas-container" />{!ready && !error && <p role="status">作品を読み込み中…</p>}
        {ready && !error && <button className="stage-play" aria-label={playing ? '映像上で停止' : '映像上で再生'} onClick={togglePlayback}><span className="primary playback-toggle stage-play-icon"><PlaybackIcon playing={playing} /></span></button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="playback"><button className="primary playback-toggle" aria-label={playing ? '一時停止' : '再生'} disabled={!ready || !!error} onClick={togglePlayback}><PlaybackIcon playing={playing} /></button>
        <input type="range" aria-label="シーク" aria-valuetext={`${currentPage} / ${pageCount} ページ`} min={currentPage === 0 ? 0 : 1} max={pageCount || 1} step={1} value={currentPage} disabled={!ready} onChange={e => {
          const p = player.current; if (!p) return;
          p.startSeek();
          p.currentFrame = Number(e.target.value) - 1;
          setCurrentPage(p.currentFrame + 1);
          p.endSeek();
        }} /><span>{ready ? currentPage : '—'} / {pageCount || '—'}</span></div>
      <div className="audio-controls"><label>音量<input type="range" aria-label="音量" min={0} max={1} step={0.05} value={volume} disabled={!ready} onChange={e => {
        const value = Number(e.target.value); setVolume(value); if (player.current) player.current.volume = value;
      }} /></label><button className="loop-toggle" aria-label="ループ" aria-pressed={loop} disabled={!ready} onClick={() => {
        const next = !loop; setLoop(next); if (player.current) player.current.loop = next;
      }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-3v2a3 3 0 0 1-3 3H3" /></svg></button></div>
      <dl className="details"><div><dt>作者</dt><dd>{note.author ?? '不明'}</dd></div><div><dt>フレーム数</dt><dd>{note.frameCount ?? '不明'}</dd></div><div><dt>作品作成日時</dt><dd>{date(note.createdAt)}</dd></div><div><dt>作品編集日時</dt><dd>{date(note.editedAt)}</dd></div><div><dt>ファイル更新日時</dt><dd>{date(note.fileModifiedAt)}</dd></div><div><dt>ファイルサイズ</dt><dd>{(note.byteSize / 1024).toFixed(1)} KB</dd></div><div className="full"><dt>相対パス</dt><dd>{note.relativePath}</dd></div></dl>
    </div></dialog>;
}
