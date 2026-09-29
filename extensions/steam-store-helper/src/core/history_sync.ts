import { state, saveSessionState } from './state';
import { downloadsQueueHistoryUrl } from '../ui/helpers';

// ---------------------------------------------------------------------------
// History sync
//
// state.downloadHistory lives in per-origin localStorage — only the store
// origin accumulates it, so the library window never sees it. Push the local
// entries to the bridge queue file (POST /api/downloads-queue/history, add-only
// by id) so GET /api/downloads-queue returns the union on every surface.
// ---------------------------------------------------------------------------

var _lastPushSig: string | null = null;
var _pushTimer: ReturnType<typeof setTimeout> | null = null;

function historySig(items: any[]): string {
  return items
    .map(function (h) { return String(h.id); })
    .join(',');
}

function toBridgeEntry(h: any) {
  return {
    id: String(h.id),
    appId: parseInt(String(h.appId), 10) || 0,
    gameName: h.gameName || ('App ' + h.appId),
    status: String(h.status || 'completed'),
    progress: typeof h.progress === 'number' ? h.progress : 0,
    bytesDownloaded: h.bytesDownloaded || 0,
    totalBytes: h.totalBytes || 0,
    // Bridge HistoryItem.completedAt is epoch SECONDS (now_epoch in the proxy)
    completedAt: Math.floor((h.timestamp || Date.now()) / 1000),
  };
}

// Debounced fire-and-forget push: only when the set of ids changed, at most
// one in-flight schedule (the bridge keeps merging add-only by id, so a
// redundant push is harmless anyway).
export function pushHistoryToBridge(): void {
  try {
    var items = state.downloadHistory || [];
    if (!items.length) return;
    if (historySig(items) === _lastPushSig) return;
    if (_pushTimer) return;
    _pushTimer = setTimeout(function () {
      _pushTimer = null;
      var list = state.downloadHistory || [];
      if (!list.length) return;
      var sig = historySig(list);
      if (sig === _lastPushSig) return;
      _lastPushSig = sig;
      fetch(downloadsQueueHistoryUrl(), {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list.map(toBridgeEntry)),
      }).catch(function () {
        _lastPushSig = null; // allow retry on next change/save
      });
    }, 1200);
  } catch (_) { }
}

// Single entry point for completion records: unshift + cap + persist + sync.
export function addHistoryEntry(entry: {
  id: string;
  appId: string;
  gameName?: string;
  type: 'source' | 'depot';
  status: 'completed' | 'failed' | 'cancelled';
  timestamp: number;
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
}): void {
  state.downloadHistory.unshift(entry);
  if (state.downloadHistory.length > 10) state.downloadHistory.length = 10;
  saveSessionState();
  pushHistoryToBridge();
}
