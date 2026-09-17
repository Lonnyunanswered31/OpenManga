/** The app mark: a comic page of four panels. Same file as `docs/images/logo.svg` and the favicon. */
export function Logo({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" role="img" aria-label="OpenManga">
      <rect x="2" y="2" width="28" height="28" rx="6.5" fill="currentColor" />
      <rect x="7" y="7" width="11" height="7.5" rx="1.6" fill="#fff" />
      <rect x="20.5" y="7" width="4.5" height="7.5" rx="1.6" fill="#fff" />
      <rect x="7" y="17.5" width="8" height="7.5" rx="1.6" fill="#fff" />
      <rect x="17.5" y="17.5" width="7.5" height="7.5" rx="1.6" fill="#fff" />
    </svg>
  );
}
