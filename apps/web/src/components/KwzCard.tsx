import { useState } from 'react';
import type { KwzNote } from '../../../../packages/shared/src/types';
export default function KwzCard({ note, open, reorderable = false, className = '' }: { note: KwzNote; open: () => void; reorderable?: boolean; className?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <button className={`note-card ${className}`} onClick={open} draggable={reorderable} aria-label={`${note.fileName}を開く`} data-note-id={note.id} data-relative-path={note.relativePath}>
    <div className="thumbnail">
      {note.thumbnailUrl && !imageFailed ? <img src={`${note.thumbnailUrl}?v=frame2-${encodeURIComponent(note.fileModifiedAt)}`} loading="lazy" alt="" draggable={false} onError={() => setImageFailed(true)} /> :
        <div className="placeholder"><span aria-hidden="true">{note.status === 'error' ? '!' : '▧'}</span><small>{note.status === 'error' ? '解析できません' : 'サムネイルなし'}</small></div>}
    </div>
  </button>;
}
