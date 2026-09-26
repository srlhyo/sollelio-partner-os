/**
 * Inline stroke icons. No icon dependency and no emoji: a handful of 24px glyphs
 * drawn the same way, so they stay legible at the sizes both surfaces use.
 */
export type IconName =
  | 'app'
  | 'globe'
  | 'folder'
  | 'document'
  | 'prototype'
  | 'link'
  | 'external'
  | 'arrow'
  | 'back'
  | 'menu'
  | 'mail'
  | 'clock'
  | 'check'
  | 'alert'
  | 'lock'
  | 'plus'
  | 'edit'
  | 'org'
  | 'person'
  | 'refresh'
  | 'eye'
  | 'send';

const PATHS: Record<IconName, string> = {
  app: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  document: 'M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM13 3v5h5M8 13h8M8 17h5',
  prototype: 'M4 5h16v11H4zM9 20h6M12 16v4',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  external: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M15 5l-7 7 7 7',
  menu: 'M4 7h16M4 12h16M4 17h16',
  mail: 'M3 5h18v14H3zM3.5 7l8.5 6 8.5-6',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M12 7.5V12l3 2',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M12 8v5M12 16h.01',
  lock: 'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L18.5 9.5a2 2 0 0 0-4-4L4 16z',
  org: 'M4 3h16v18H4zM9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3',
  person: 'M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M4.5 20a7.5 7.5 0 0 1 15 0',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Sollelio master symbol, unchanged. Never redrawn or recoloured. */
export function SollelioSymbol({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Sollelio" style={{ flexShrink: 0 }}>
      <path fill="#3030A8" d="M8 8h34c4 0 6 2 6 6v17c0 6-3 10-8 13L8 58V8Z" />
      <path fill="#2457F5" d="M58 8h26c5 0 8 3 8 8v20L60 50c-5 2-8-1-8-6V18c0-7 2-10 6-10Z" />
      <path fill="#3030A8" d="M8 66l32-14c5-2 8 1 8 6v24c0 7-3 10-10 10H16c-5 0-8-3-8-8V66Z" />
      <path fill="#3030A8" d="M60 56l32-14v42c0 5-3 8-8 8H58c-4 0-6-2-6-6V69c0-6 3-10 8-13Z" />
    </svg>
  );
}
