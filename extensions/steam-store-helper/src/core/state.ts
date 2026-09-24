// Steam Store Helper — Constants, state, and platform detection

var LUMA_INJECT_VERSION = '2.6.0-Auto-Update';
var DOCUMENT_ID = Date.now() + '-' + Math.random().toString(36).slice(2);

var EXTENSION_ID = 'steam-store-helper';
var BRIDGE_HOST = '127.0.0.1';
var BRIDGE_SCHEME = 'http';
var bridgeConfig = {
  port: 21775,
  detected: false,
};
var BRIDGE_PORT = 21775;
var BRIDGE_PORT_DETECTED = false;

try { document.title = 'SSH_INJECTED_' + DOCUMENT_ID; } catch(_) {}
var NAMESPACE = '__lumaforge_ssh__';
var BTN_ID = 'luma-action-btn';
var FIXES_BTN_ID = 'luma-fixes-btn';
var MODAL_MARKER_ATTR = 'data-lumaforge-modal';
var MODAL_MARKER_VAL = EXTENSION_ID;
var BTN_MARKER_ATTR = 'data-lumaforge-extension';
var BTN_MARKER_VAL = EXTENSION_ID;
var BTN_APPID_ATTR = 'data-lumaforge-app-id';
var BTN_STATE_ATTR = 'data-lumaforge-state';
var APP_URL_RE = /\/app\/(\d+)(?:\/|$)/;
var MAX_ID_LENGTH = 12;
var RECONCILE_DEBOUNCE_MS = 200;
var LOCAL_STATUS_TIMEOUT_MS = 8000;

var ACTION_SELECTORS = [
  '#game_area_purchase_game .btn_addtocart',
  '.game_area_purchase_game .btn_addtocart',
  '#game_area_purchase_game',
  '.game_area_purchase_game',
  '.apphub_OtherSiteInfo',
  '.app_title_area',
  '.queue_controls_ctn',
  '.game_header_image_full',
];

export var _fetchSeq = { value: 0 };

interface State {
  activated: boolean;
  currentAppId: string | null;
  currentUrl: string | null;
  observer: MutationObserver | null;
  observerRoot: Node | null;
  historyPatched: boolean;
  origPushState: typeof History.prototype.pushState | null;
  origReplaceState: typeof History.prototype.replaceState | null;
  statusAbortController: AbortController | null;
  providerAbortController: AbortController | null;
  statusRequest: {
    appId: string;
    controller: AbortController;
    retryTimer: ReturnType<typeof setTimeout> | null;
  } | null;

  recoveryTimer: ReturnType<typeof setTimeout> | null;
  bridgeRecoveryCount: number;
  bridgeRecoveryAppId: string | null;
  statusCache: Record<string, { inLibrary: boolean; installed: boolean; timestamp: number }> | null;

  retryTimers: ReturnType<typeof setTimeout>[];
  activeDownloads: Array<{
    requestId: string;
    appId: string;
    sourceId: string;
    gameName?: string;
    pollSeq: number;
    pollTimer: ReturnType<typeof setTimeout> | null;
    phase: string;
    progress: number;
    speed: number;
    bytesDownloaded: number;
    totalBytes: number;
  }>;
  activeDepotJobs: Array<{
    jobId: string;
    appId: string;
    gameName?: string;
    outputDir?: string;
    phase: string;
    progress: number;
    speed: number;
    bytesDownloaded: number;
    totalBytes: number;
    status: string;
    pollSeq: number;
    pollTimer: ReturnType<typeof setTimeout> | null;
  }>;
  providerStatsCache: any[] | null;
  popstateHandler: (() => void) | null;
  hashchangeHandler: (() => void) | null;
  pageshowHandler: (() => void) | null;
  pagehideHandler: (() => void) | null;
  beforeunloadHandler: (() => void) | null;
  _rafPending: boolean;
  reconcileCount: number;
  documentId: string;
  savedFocusElement: Element | null;
  installingAppIds: Record<string, boolean>;
  depotModalState: {
    appId: string;
    depots: any[];
    selected: Record<number, boolean>;
    outputDir: string;
    downloading: boolean;
    jobId: string | null;
    gameName?: string;
  } | null;

  fixesModalState: {
    appId: string;
    info: any;
    status: any;
    catalogEntries: any[];
    pending: Record<string, boolean>;
    results: Record<string, { ok: boolean; message: string; at: number }>;
    toolInstallBusy: string | null;
    lastJobStatus: Record<string, string>;
    pollSeq: number;
    pollTimer: ReturnType<typeof setTimeout> | null;
  } | null;

  // Session-persisted fields (survive page navigations via sessionStorage)
  currentTab: string;
  sidebarOpen: boolean;
  downloadHistory: Array<{
    id: string;
    appId: string;
    gameName?: string;
    type: 'source' | 'depot';
    status: 'completed' | 'failed' | 'cancelled';
    timestamp: number;
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
  }>;
}

var state: State = {
  activated: false,
  currentAppId: null,
  currentUrl: null,
  observer: null,
  observerRoot: null,
  historyPatched: false,
  origPushState: null,
  origReplaceState: null,
  statusAbortController: null,
  providerAbortController: null,
  statusRequest: null,

  recoveryTimer: null,
  bridgeRecoveryCount: 0,
  bridgeRecoveryAppId: null,
  statusCache: null,

  retryTimers: [],
  activeDownloads: [],
  activeDepotJobs: [],
  providerStatsCache: null,
  popstateHandler: null,
  hashchangeHandler: null,
  pageshowHandler: null,
  pagehideHandler: null,
  beforeunloadHandler: null,
  _rafPending: false,
  reconcileCount: 0,
  documentId: DOCUMENT_ID,
  savedFocusElement: null,
  installingAppIds: {},
  depotModalState: null,
  fixesModalState: null,

  // Session-persisted defaults
  currentTab: 'downloads',
  sidebarOpen: false,
  downloadHistory: [],
};

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
var IS_LINUX = typeof navigator !== 'undefined' &&
               navigator.platform.toLowerCase().indexOf('linux') !== -1;

// ---------------------------------------------------------------------------
// Persistent state (survives page navigations AND Steam restarts)
// ---------------------------------------------------------------------------
var SESSION_KEY = '__lumaforge_ssh_session__';

export function saveSessionState(): void {
  try {
    var snapshot = {
      currentTab: state.currentTab,
      sidebarOpen: state.sidebarOpen,
      downloadHistory: state.downloadHistory,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch (_) {}
}

export function loadSessionState(): void {
  try {
    var raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    var snapshot = JSON.parse(raw);
    if (snapshot.currentTab) state.currentTab = snapshot.currentTab;
    if (typeof snapshot.sidebarOpen === 'boolean') state.sidebarOpen = snapshot.sidebarOpen;
    // NOTE: activeDownloads, activeDepotJobs, installingAppIds are NOT restored.
    // Downloads moved to downloadHistory (as "paused") during teardown().
    // User must click Resume to restart them.
    if (snapshot.downloadHistory && Array.isArray(snapshot.downloadHistory)) {
      state.downloadHistory = snapshot.downloadHistory;
    }
  } catch (_) {}
}

export {
  LUMA_INJECT_VERSION,
  DOCUMENT_ID,
  EXTENSION_ID,
  BRIDGE_HOST,
  BRIDGE_PORT,
  BRIDGE_SCHEME,
  BRIDGE_PORT_DETECTED,
  bridgeConfig,
  NAMESPACE,
  BTN_ID,
  FIXES_BTN_ID,
  MODAL_MARKER_ATTR,
  MODAL_MARKER_VAL,
  BTN_MARKER_ATTR,
  BTN_MARKER_VAL,
  BTN_APPID_ATTR,
  BTN_STATE_ATTR,
  APP_URL_RE,
  MAX_ID_LENGTH,
  RECONCILE_DEBOUNCE_MS,
  LOCAL_STATUS_TIMEOUT_MS,
  ACTION_SELECTORS,
  state,
  IS_LINUX,
};
