import type { ReactNode } from 'react';
export default function EmptyState({ title, message, children, loading = false }: { title: string; message: string; children?: ReactNode; loading?: boolean }) {
  return <div className="empty" role="status" aria-busy={loading}>
    {loading ? <svg className="loading-arrow" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M39 23a15 15 0 1 0-5 12M39 12v11H28" /></svg> : <img className="empty-kawazu" src="/images/kawazu.svg" alt="" aria-hidden="true" />}
    <h2>{title}</h2><p>{message}</p>{children}
  </div>;
}
