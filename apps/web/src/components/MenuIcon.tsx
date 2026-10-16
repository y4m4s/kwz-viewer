export default function MenuIcon({ kind }: { kind: 'exchange' | 'settings' }) {
  return <svg viewBox="0 0 40 40" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    {kind === 'exchange' && <>
      <path fillRule="evenodd" d="M5 8h23v14H5Zm2 2v10h19V10Z" />
      <path d="M7 10h3v2h3v2h7v-2h3v-2h3v3h-3v2h-3v2h-7v-2h-3v-2H7Z" />
      <path d="M30 8h2v16h-2zm-2 14h6v2h-2v2h-2v-2h-2zM8 26h2v4h18v2H8zm-2 0h2v-2h2v2h2v2H6Z" />
    </>}
    {kind === 'settings' && <>
      <path d="M5 10h30v2H5zm0 9h30v2H5zm0 9h30v2H5Z" />
      <path d="M11 7h6v8h-6zm12 9h6v8h-6zm-9 9h6v8h-6Z" />
      <path d="M13 9h2v4h-2zm12 9h2v4h-2zm-9 9h2v4h-2Z" fill="var(--orange)" />
    </>}
  </svg>;
}
