// ---------------------------------------------------------------------------
// SVG Icons (all inline-styled)
// ---------------------------------------------------------------------------
export function svgDownload(w: number, h: number): string {
  w = w || 14; h = h || 14;
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4.5 7.5L8 11l3.5-3.5"/><path d="M2 12v1.5a1 1 0 001 1h10a1 1 0 001-1V12"/></svg>';
}
export function svgCloudDownload(): string {
  return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 12l4 4 4-4"/><path d="M4 18v-2a4 4 0 014-4h8a4 4 0 014 4v2"/></svg>';
}
export function svgSpinner(): string {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="animation:luma_ssh_spin .8s linear infinite"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="42 42" stroke-linecap="round"/></svg>';
}
export function svgCheck(w: number, h: number): string {
  w = w || 14; h = h || 14;
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 4"/></svg>';
}
export function svgX(): string {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
}
export function svgLibrary(): string {
  return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="12" rx="1"/><rect x="9" y="2" width="5" height="8" rx="1"/></svg>';
}
export function svgArrowRight(): string {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
}
export function svgErrorCircle(): string {
  return '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#e74c3c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="20"/><path d="M18 18l12 12M30 18L18 30"/></svg>';
}
export function svgLock(): string {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
}
export function svgBox(): string {
  return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5l6-3.5 6 3.5v5l-6 3.5-6-3.5z"/><path d="M2 5.5l6 3.5 6-3.5"/><path d="M8 9v4.5"/></svg>';
}
export function svgCheckSmall(): string {
  return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5 6.5-7"/></svg>';
}
export function svgRefresh(): string {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 019.43-3.9M13.5 8a5.5 5.5 0 01-9.43 3.9"/><path d="M12 1v4h-4M4 15v-4h4"/></svg>';
}
export function svgGear(): string {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M13.3 10a1.2 1.2 0 00.2 1.3l.1.1a1.45 1.45 0 11-2 2l-.1-.1a1.2 1.2 0 00-1.3-.2 1.2 1.2 0 00-.7 1.1v.2a1.45 1.45 0 01-2.9 0v-.1a1.2 1.2 0 00-.8-1.1 1.2 1.2 0 00-1.3.2l-.1.1a1.45 1.45 0 11-2-2l.1-.1a1.2 1.2 0 00.2-1.3 1.2 1.2 0 00-1.1-.7h-.2a1.45 1.45 0 010-2.9h.1a1.2 1.2 0 001.1-.8 1.2 1.2 0 00-.2-1.3l-.1-.1a1.45 1.45 0 112-2l.1.1a1.2 1.2 0 001.3.2h.1a1.2 1.2 0 00.7-1.1v-.2a1.45 1.45 0 012.9 0v.1a1.2 1.2 0 00.7 1.1 1.2 1.2 0 001.3-.2l.1-.1a1.45 1.45 0 112 2l-.1.1a1.2 1.2 0 00-.2 1.3v.1a1.2 1.2 0 001.1.7h.2a1.45 1.45 0 010 2.9h-.1a1.2 1.2 0 00-1.1.7z"/></svg>';
}
export function svgPlay(): string {
  return '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M4 2.5v11l9-5.5z"/></svg>';
}
