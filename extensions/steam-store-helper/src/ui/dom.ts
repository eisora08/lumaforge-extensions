// ---------------------------------------------------------------------------
// Utility: format bytes
// ---------------------------------------------------------------------------
export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  i = Math.min(i, units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

export function formatOs(os: string): string {
  if (!os) return '';
  var lower = os.toLowerCase();
  if (lower.indexOf('linux') !== -1) return '\uD83D\uDC27 Linux';
  if (lower.indexOf('windows') !== -1) return '\uD83D\uDDE1\uFE0F Windows';
  if (lower.indexOf('mac') !== -1 || lower.indexOf('osx') !== -1) return '\uD83C\uDF4E macOS';
  return os;
}

export function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
