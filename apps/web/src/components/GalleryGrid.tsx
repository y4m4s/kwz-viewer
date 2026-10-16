import { useRef, useState, type DragEvent } from 'react';
import type { KwzNote } from '../../../../packages/shared/src/types';
import KwzCard from './KwzCard';
type Placement = 'before' | 'after';
export default function GalleryGrid({ notes, open, reorderable, draggedId, setDraggedId, move }: {
  notes: KwzNote[]; open: (note: KwzNote) => void; reorderable: boolean;
  draggedId: string | null; setDraggedId: (id: string | null) => void;
  move: (source: string, target: string, placement: Placement) => void;
}) {
  const [source, setSource] = useState<KwzNote | null>(null);
  const [over, setOver] = useState<{ id: string; placement: Placement } | null>(null);
  const lastDragEnd = useRef(0);
  const target = (event: DragEvent<HTMLDivElement>) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>('.note-card');
    if (!card || !notes.some(n => n.id === card.dataset.noteId)) return null;
    return { id: card.dataset.noteId!, placement: event.clientX < card.getBoundingClientRect().left + card.clientWidth / 2 ? 'before' as const : 'after' as const };
  };
  // Keep a drag source mounted when hovering an arrow switches to another page.
  const carrier = draggedId && source?.id === draggedId && !notes.some(n => n.id === draggedId) ? source : null;
  return <div className="gallery" onDragStart={event => {
    if (!reorderable) { event.preventDefault(); return; }
    const id = (event.target as HTMLElement).closest<HTMLElement>('.note-card')?.dataset.noteId;
    const note = notes.find(n => n.id === id); if (!note) return;
    setSource(note); setDraggedId(note.id);
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-kwz-note', note.id);
  }} onDragOver={event => {
    if (!reorderable || !draggedId) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(target(event));
  }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null); }} onDrop={event => {
    event.preventDefault(); const anchor = target(event);
    if (reorderable && draggedId && anchor && anchor.id !== draggedId) move(draggedId, anchor.id, anchor.placement);
    setOver(null); setDraggedId(null); setSource(null); lastDragEnd.current = Date.now();
  }} onDragEnd={() => { setDraggedId(null); setSource(null); setOver(null); lastDragEnd.current = Date.now(); }}
    onKeyDown={event => {
      if (!reorderable || !event.altKey) return;
      const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
      const offset = offsets[event.key]; if (!offset) return;
      const id = (event.target as HTMLElement).closest<HTMLElement>('.note-card')?.dataset.noteId;
      const i = notes.findIndex(n => n.id === id); const anchor = notes[i + offset];
      event.preventDefault(); if (i >= 0 && anchor) move(notes[i].id, anchor.id, offset < 0 ? 'before' : 'after');
    }}>
    {[...notes, ...(carrier ? [carrier] : [])].map(note => <KwzCard key={`${note.id}:${note.fileModifiedAt}`} note={note}
      reorderable={reorderable || draggedId === note.id}
      className={`${draggedId === note.id ? 'is-dragging' : ''} ${over?.id === note.id && over.id !== draggedId ? `drop-${over.placement}` : ''} ${carrier?.id === note.id ? 'drag-carrier' : ''}`}
      open={() => { if (!draggedId && Date.now() - lastDragEnd.current > 300) open(note); }} />)}
  </div>;
}
