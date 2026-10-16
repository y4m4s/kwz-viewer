export default function PlaybackIcon({ playing }: { playing: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {playing ? <rect x="5" y="5" width="14" height="14" /> : <path d="M7 4L21 12L7 20Z" />}
  </svg>;
}
