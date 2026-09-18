// Steam Store Helper — LumaForge Lite CEF injection payload v2.6.0-Auto-Update
// Runs inside Steam's Chromium Embedded Framework browser context.
// Self-contained, idempotent, teardown-safe.
// All critical CSS uses inline styles to bypass Steam's CSP.
// Uses event delegation — survives full DOM rebuilds by Steam.
// SPA-aware: MutationObserver + history hooks track app page navigation.
// Button markers: data-lumaforge-extension, data-lumaforge-app-id, data-lumaforge-state
(function () {
  'use strict';

  var LUMA_INJECT_VERSION = '2.6.0-Auto-Update';
  var DOCUMENT_ID = Date.now() + '-' + Math.random().toString(36).slice(2);

  var EXTENSION_ID = 'steam-store-helper';
  var BRIDGE_HOST = '127.0.0.1';
  var BRIDGE_PORT = 21775;
  var BRIDGE_SCHEME = 'http';
  var BRIDGE_PORT_DETECTED = false;

  try { document.title = 'SSH_INJECTED_' + DOCUMENT_ID; } catch(_) {}
  var NAMESPACE = '__lumaforge_ssh__';
  var BTN_ID = 'luma-action-btn';
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

  var _fetchSeq = 0;

  var state = {
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
    requestContext: null,
    downloadPollTimer: null,
    downloadPollSeq: 0,
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
    depotModalState: null,
  };

  // ---------------------------------------------------------------------------
  // Platform detection
  // ---------------------------------------------------------------------------
  var IS_LINUX = typeof navigator !== 'undefined' &&
                 navigator.platform.toLowerCase().indexOf('linux') !== -1;

  // ---------------------------------------------------------------------------
  // SVG Icons (all inline-styled)
  // ---------------------------------------------------------------------------
  function svgDownload(w, h) {
    w = w || 14; h = h || 14;
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4.5 7.5L8 11l3.5-3.5"/><path d="M2 12v1.5a1 1 0 001 1h10a1 1 0 001-1V12"/></svg>';
  }
  function svgCloudDownload() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 12l4 4 4-4"/><path d="M4 18v-2a4 4 0 014-4h8a4 4 0 014 4v2"/></svg>';
  }
  function svgSpinner() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="animation:luma_ssh_spin .8s linear infinite"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="42 42" stroke-linecap="round"/></svg>';
  }
  function svgCheck(w, h) {
    w = w || 14; h = h || 14;
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 4"/></svg>';
  }
  function svgX() {
    return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  }
  function svgLibrary() {
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="12" rx="1"/><rect x="9" y="2" width="5" height="8" rx="1"/></svg>';
  }
  function svgArrowRight() {
    return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
  }
  function svgErrorCircle() {
    return '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#e74c3c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="20"/><path d="M18 18l12 12M30 18L18 30"/></svg>';
  }
  function svgLock() {
    return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
  }
  function svgBox() {
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5l6-3.5 6 3.5v5l-6 3.5-6-3.5z"/><path d="M2 5.5l6 3.5 6-3.5"/><path d="M8 9v4.5"/></svg>';
  }
  function svgCheckSmall() {
    return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5 6.5-7"/></svg>';
  }
  function svgRefresh() {
    return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 019.43-3.9M13.5 8a5.5 5.5 0 01-9.43 3.9"/><path d="M12 1v4h-4M4 15v-4h4"/></svg>';
  }

  // ---------------------------------------------------------------------------
  // Theme-aware CSS variable system + keyframes + class styles
  // ---------------------------------------------------------------------------
  function ensureKeyframes() {
    try {
      if (document.getElementById('luma_ssh_kf')) return;
      var s = document.createElement('style');
      s.id = 'luma_ssh_kf';
      s.textContent =

        // ── Theme-aware CSS variables with fallbacks ──
        ':root{' +
        '--luma-ssh-accent:#66c0ff;' +
        '--luma-ssh-accent-dim:rgba(102,192,255,.32);' +
        '--luma-ssh-accent-glow:rgba(102,192,255,.15);' +
        '--luma-ssh-accent-strong:rgba(102,192,255,.82);' +
        '--luma-ssh-bg-panel:#1b2838;' +
        '--luma-ssh-bg-card:rgba(255,255,255,.03);' +
        '--luma-ssh-bg-card-hover:rgba(255,255,255,.06);' +
        '--luma-ssh-border:rgba(102,192,255,.15);' +
        '--luma-ssh-border-strong:rgba(255,255,255,.06);' +
        '--luma-ssh-text-primary:#fff;' +
        '--luma-ssh-text:#c7d5e0;' +
        '--luma-ssh-text-muted:#8f98a0;' +
        '--luma-ssh-success:#64c882;' +
        '--luma-ssh-success-bg:rgba(46,160,67,.15);' +
        '--luma-ssh-error:#e74c3c;' +
        '--luma-ssh-error-bg:rgba(231,76,60,.12);' +
        '--luma-ssh-btn-bg:linear-gradient(180deg,#2478a8 0%,#17628f 100%);' +
        '--luma-ssh-btn-bg-hover:linear-gradient(180deg,#32a9ed 0%,#1687c5 100%);' +
        '--luma-ssh-btn-bg-active:linear-gradient(180deg,#1687c5 0%,#126b9c 100%);' +
        '--luma-ssh-btn-text:#dff4ff;' +
        '--luma-ssh-btn-shadow:0 1px 2px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.08);' +
        '--luma-ssh-panel-shadow:0 8px 32px rgba(0,0,0,.6),0 0 60px var(--luma-ssh-accent-glow);' +
        '}' +

        // ── Keyframes ──
        '@keyframes luma_ssh_spin{to{transform:rotate(360deg)}}' +
        '@keyframes luma_ssh_fade{from{opacity:0}to{opacity:1}}' +
        '@keyframes luma_ssh_slide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}' +

        // ── Action button ──
        '.luma-ssh-action-button:not([aria-disabled="true"]):hover{' +
        'background:var(--luma-ssh-btn-bg-hover)!important;' +
        'border-color:var(--luma-ssh-accent-strong)!important;' +
        'color:#fff!important;' +
        'box-shadow:0 0 12px var(--luma-ssh-accent-glow),inset 0 1px 0 rgba(255,255,255,.18)!important;' +
        '}' +

        '.luma-ssh-action-button:not([aria-disabled="true"]):active{' +
        'transform:translateY(1px) scale(.985);' +
        'background:var(--luma-ssh-btn-bg-active)!important;' +
        'box-shadow:0 1px 2px rgba(0,0,0,.4)!important;' +
        '}' +

        '.luma-ssh-action-button:focus-visible{' +
        'outline:2px solid var(--luma-ssh-accent)!important;' +
        'outline-offset:2px!important;' +
        'box-shadow:0 0 0 3px var(--luma-ssh-accent-glow)!important;' +
        '}' +

        '.luma-ssh-action-button[aria-disabled="true"]{' +
        'cursor:default!important;' +
        '}' +

        // ── Modal panel box-sizing ──
        '.luma-ssh-modal-panel,.luma-ssh-modal-panel *,' +
        '.luma-ssh-modal-panel *::before,.luma-ssh-modal-panel *::after{' +
        'box-sizing:border-box;' +
        '}' +

        // ── Source cards ──
        '.luma-source-card{' +
        'display:grid;' +
        'grid-template-columns:42px minmax(0,1fr) auto;' +
        'align-items:center;' +
        'column-gap:14px;' +
        'width:100%;' +
        'max-width:100%;' +
        'min-width:0;' +
        'padding:14px 16px;' +
        'margin-bottom:8px;' +
        'background:rgba(255,255,255,.025);' +
        'border:1px solid rgba(255,255,255,.06);' +
        'border-radius:11px;' +
        'cursor:pointer;' +
        'transition:background .15s ease,border-color .15s ease,opacity .15s ease,box-shadow .15s ease;' +
        'position:relative;' +
        'overflow:visible;' +
        '}' +

        '.luma-source-card:hover{' +
        'background:rgba(255,255,255,.05)!important;' +
        'border-color:rgba(102,192,255,.18)!important;' +
        'box-shadow:0 2px 12px rgba(0,0,0,.2);' +
        '}' +

        '.luma-source-card.blocked{' +
        'opacity:.45!important;' +
        'cursor:not-allowed!important;' +
        'pointer-events:auto!important;' +
        '}' +

        '.luma-source-card.blocked:hover{' +
        'background:rgba(255,255,255,.05)!important;' +
        'border-color:rgba(231,76,60,.2)!important;' +
        'opacity:.6!important;' +
        'box-shadow:none!important;' +
        '}' +

        // ── Source tooltip (contained) ──
        '.luma-source-tooltip{' +
        'position:absolute;' +
        'bottom:calc(100% + 8px);' +
        'left:50%;' +
        'transform:translateX(-50%);' +
        'background:#1b2838;' +
        'border:1px solid rgba(102,192,255,.2);' +
        'border-radius:6px;' +
        'padding:8px 12px;' +
        'font-size:11px;' +
        'color:#c7d5e0;' +
        'white-space:normal;' +
        'width:max-content;' +
        'max-width:min(320px,calc(100vw - 32px));' +
        'overflow-wrap:anywhere;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.6);' +
        'z-index:10;' +
        'pointer-events:none;' +
        'opacity:0;' +
        'transition:opacity .15s ease;' +
        '}' +

        '.luma-source-card:hover .luma-source-tooltip{' +
        'opacity:1;' +
        '}' +

        '.luma-source-expiry{' +
        'display:inline-flex;' +
        'align-items:center;' +
        'gap:4px;' +
        'padding:2px 8px;' +
        'border-radius:8px;' +
        'font-size:10px;' +
        'font-weight:700;' +
        'white-space:nowrap;' +
        'margin-top:4px;' +
        '}' +

        '.luma-source-expiry.ok{' +
        'background:rgba(46,160,67,.12);' +
        'color:var(--luma-ssh-success);' +
        '}' +

        '.luma-source-expiry.warning{' +
        'background:rgba(255,180,0,.12);' +
        'color:#ffb400;' +
        '}' +

        '.luma-source-expiry.expired{' +
        'background:var(--luma-ssh-error-bg);' +
        'color:var(--luma-ssh-error);' +
        '}' +

        // ── Usage info chips ──
        '.luma-usage-chips{' +
        'display:flex;' +
        'flex-wrap:wrap;' +
        'gap:6px;' +
        'min-width:0;' +
        'margin-top:5px;' +
        '}' +
        '.luma-usage-chip{' +
        'display:inline-flex;' +
        'align-items:center;' +
        'gap:3px;' +
        'padding:2px 7px;' +
        'border-radius:6px;' +
        'font-size:10px;' +
        'font-weight:600;' +
        'color:#66c0f4;' +
        'background:rgba(102,192,255,.08);' +
        'white-space:nowrap;' +
        '}' +

        // ── Close button hover ──
        '.luma-ssh-close-btn:hover{' +
        'background:rgba(255,255,255,.08)!important;' +
        'color:#fff!important;' +
        '}' +
        '.luma-ssh-close-btn:focus-visible{' +
        'outline:2px solid var(--luma-ssh-accent);' +
        'outline-offset:2px;' +
        '}' +

        // ── Modal scrollbar ──
        '.luma-ssh-modal-body{' +
        'scrollbar-width:thin;' +
        'scrollbar-color:rgba(102,192,255,.25) transparent;' +
        '}' +
        '.luma-ssh-modal-body::-webkit-scrollbar{width:6px;}' +
        '.luma-ssh-modal-body::-webkit-scrollbar-track{background:transparent;}' +
        '.luma-ssh-modal-body::-webkit-scrollbar-thumb{' +
        'background:rgba(102,192,255,.25);border-radius:3px;' +
        '}' +
        '.luma-ssh-modal-body::-webkit-scrollbar-thumb:hover{' +
        'background:rgba(102,192,255,.4);' +
        '}' +

        // ── Depot card styles ──
        '.luma-depot-card{' +
        'display:grid;' +
        'grid-template-columns:22px 1fr auto;' +
        'align-items:center;' +
        'column-gap:12px;' +
        'width:100%;' +
        'padding:10px 14px;' +
        'margin-bottom:4px;' +
        'background:rgba(255,255,255,.025);' +
        'border:1px solid rgba(255,255,255,.06);' +
        'border-radius:8px;' +
        'cursor:pointer;' +
        'transition:background .15s ease,border-color .15s ease,opacity .15s ease;' +
        '}' +
        '.luma-depot-card:hover{' +
        'background:rgba(255,255,255,.05)!important;' +
        'border-color:rgba(102,192,255,.18)!important;' +
        '}' +
        '.luma-depot-card.selected{' +
        'border-color:rgba(102,192,255,.3)!important;' +
        'background:rgba(102,192,255,.06)!important;' +
        '}' +
        '.luma-depot-card.disabled{' +
        'opacity:.45!important;' +
        'cursor:not-allowed!important;' +
        'pointer-events:auto!important;' +
        '}' +
        '.luma-depot-card input[type="checkbox"]{' +
        'accent-color:#66c0ff;' +
        'width:16px;' +
        'height:16px;' +
        'cursor:pointer;' +
        'margin:0;' +
        '}' +
        '.luma-depot-card.disabled input[type="checkbox"]{' +
        'cursor:not-allowed;' +
        '}' +

        // ── Depot group header ──
        '.luma-depot-group-header{' +
        'display:flex;' +
        'align-items:center;' +
        'justify-content:space-between;' +
        'padding:8px 4px 4px;' +
        'font-size:11px;' +
        'font-weight:700;' +
        'color:var(--luma-ssh-text-muted,#8f98a0);' +
        'text-transform:uppercase;' +
        'letter-spacing:.5px;' +
        '}' +
        '.luma-depot-group-toggle{' +
        'font-size:11px;' +
        'color:var(--luma-ssh-accent,#66c0ff);' +
        'cursor:pointer;' +
        'background:none;' +
        'border:none;' +
        'padding:2px 6px;' +
        'font-weight:600;' +
        'border-radius:4px;' +
        'transition:background .12s ease;' +
        '}' +
        '.luma-depot-group-toggle:hover{' +
        'background:rgba(102,192,255,.1);' +
        '}' +

        // ── Depot size/OS badges ──
        '.luma-depot-meta{' +
        'display:flex;' +
        'align-items:center;' +
        'gap:6px;' +
        'flex-shrink:0;' +
        '}' +
        '.luma-depot-size{' +
        'font-size:11px;' +
        'font-weight:600;' +
        'color:var(--luma-ssh-text-muted,#8f98a0);' +
        'white-space:nowrap;' +
        '}' +
        '.luma-depot-os{' +
        'display:inline-flex;' +
        'align-items:center;' +
        'padding:2px 6px;' +
        'border-radius:4px;' +
        'font-size:10px;' +
        'font-weight:600;' +
        'white-space:nowrap;' +
        'background:rgba(102,192,255,.08);' +
        'color:var(--luma-ssh-accent,#66c0ff);' +
        '}' +

        // ── Depot info (name + details) ──
        '.luma-depot-info{' +
        'min-width:0;' +
        'overflow:hidden;' +
        '}' +
        '.luma-depot-name{' +
        'font-size:13px;' +
        'font-weight:600;' +
        'color:var(--luma-ssh-text-primary,#fff);' +
        'white-space:nowrap;' +
        'overflow:hidden;' +
        'text-overflow:ellipsis;' +
        '}' +
        '.luma-depot-detail{' +
        'font-size:10px;' +
        'color:var(--luma-ssh-text-muted,#8f98a0);' +
        'margin-top:1px;' +
        'overflow-wrap:anywhere;' +
        'word-break:break-word;' +
        '}' +

        // ── Depot total bar ──
        '.luma-depot-total{' +
        'display:flex;' +
        'align-items:center;' +
        'justify-content:space-between;' +
        'padding:10px 0 0;' +
        'font-size:12px;' +
        'color:var(--luma-ssh-text-muted,#8f98a0);' +
        'border-top:1px solid rgba(102,192,255,.1);' +
        'margin-top:8px;' +
        '}' +
        '.luma-depot-total strong{' +
        'color:var(--luma-ssh-text-primary,#fff);' +
        'font-weight:700;' +
        '}' +

        // ── Depot progress bar ──
        '.luma-depot-progress{' +
        'padding:20px 0;text-align:center;' +
        '}' +
        '.luma-depot-progress-label{' +
        'font-size:13px;' +
        'color:var(--luma-ssh-text-muted,#8f98a0);' +
        'margin-bottom:8px;' +
        '}' +
        '.luma-depot-progress-bar{' +
        'width:100%;' +
        'height:6px;' +
        'background:rgba(255,255,255,.06);' +
        'border:1px solid rgba(255,255,255,.04);' +
        'border-radius:3px;' +
        'overflow:hidden;' +
        'margin:12px 0;' +
        '}' +
        '.luma-depot-progress-fill{' +
        'height:100%;' +
        'background:linear-gradient(to right,rgba(26,159,255,.9),rgba(102,192,255,.9));' +
        'border-radius:3px;' +
        'transition:width .3s ease;' +
        'width:0%;' +
        '}' +

        // ── Responsive media queries ──
        '@media(max-width:520px){' +
        '.luma-ssh-modal-backdrop{padding:10px!important;}' +
        '.luma-ssh-modal-panel{border-radius:12px!important;}' +
        '.luma-ssh-source-card{grid-template-columns:40px minmax(0,1fr);}' +
        '.luma-ssh-source-card .luma-source-badge-wrap{grid-column:1/-1;margin-top:4px;justify-self:start;}' +
        '.luma-ssh-success-actions,.luma-ssh-error-actions{flex-wrap:wrap;}' +
        '.luma-ssh-success-actions button,.luma-ssh-error-actions button{width:100%;justify-content:center;}' +
        '}' +
        '';
      (document.head || document.documentElement).appendChild(s);
    } catch (_) { }
  }

  // ---------------------------------------------------------------------------
  // Inline style constants
  // ---------------------------------------------------------------------------
  var ST = {
    btn: 'display:inline-flex;align-items:center;gap:7px;padding:7px 16px;margin-left:10px;border:1px solid var(--luma-ssh-accent-dim,rgba(102,192,255,.32));border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:var(--luma-ssh-btn-bg,linear-gradient(180deg,#2478a8 0%,#17628f 100%));color:var(--luma-ssh-btn-text,#dff4ff);box-shadow:var(--luma-ssh-btn-shadow,0 1px 2px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.08));vertical-align:middle;position:relative;z-index:1;transition:background .16s ease,border-color .16s ease,box-shadow .16s ease,transform .08s ease,color .16s ease;flex-shrink:0;',
    btnSuccess: 'display:inline-flex;align-items:center;gap:6px;padding:7px 16px;margin-left:10px;border:none;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:linear-gradient(to right,var(--luma-ssh-success,#2ea043),var(--luma-ssh-success,#64c882));color:#fff;box-shadow:0 0 8px rgba(100,200,130,.3);vertical-align:middle;position:relative;z-index:1;flex-shrink:0;',
    btnInstalled: 'display:inline-flex;align-items:center;gap:6px;padding:7px 16px;margin-left:10px;border:1px solid rgba(100,200,130,.3);border-radius:3px;cursor:default;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:rgba(46,160,67,.1);color:var(--luma-ssh-success,#64c882);vertical-align:middle;position:relative;z-index:1;opacity:.7;pointer-events:none;flex-shrink:0;',

    backdrop: 'position:fixed;inset:0;width:100%;height:100%;padding:20px;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(5,10,17,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);overflow-y:auto;overflow-x:hidden;font-family:\'Motiva Sans\',Arial,sans-serif;',
    panel: 'background:radial-gradient(circle at top left,rgba(102,192,255,.08),transparent 42%),linear-gradient(165deg,#18283a 0%,#132131 55%,#101b29 100%);color:var(--luma-ssh-text,#c7d5e0);border:1px solid rgba(125,196,238,.18);border-radius:16px;width:min(520px,calc(100vw - 32px));max-height:min(80vh,calc(100vh - 40px));display:flex;flex-direction:column;box-shadow:0 28px 80px rgba(0,0,0,.58),0 8px 28px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.045);overflow:hidden;animation:luma_ssh_slide .25s ease-out;flex-shrink:0;',
    header: 'display:flex;align-items:flex-start;gap:12px;padding:18px 20px 14px;border-bottom:1px solid rgba(102,192,255,.1);min-width:0;',
    headerIcon: 'width:40px;height:40px;border-radius:10px;background:rgba(102,192,255,.1);border:1px solid rgba(102,192,255,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--luma-ssh-accent,#66c0ff);',
    headerTitle: 'font-size:17px;font-weight:700;color:var(--luma-ssh-text-primary,#fff);min-width:0;line-height:1.3;',
    headerSubtitle: 'font-size:11px;color:var(--luma-ssh-text-muted,#8f98a0);margin-top:2px;line-height:1.3;',
    headerVersion: 'display:inline-flex;align-items:center;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(102,192,255,.1);color:var(--luma-ssh-accent,#66c0ff);flex-shrink:0;white-space:nowrap;margin-top:4px;',
    closeBtn: 'background:none;border:none;cursor:pointer;padding:6px;color:var(--luma-ssh-text-muted,#8f98a0);display:flex;align-items:center;justify-content:center;border-radius:6px;margin-left:auto;flex-shrink:0;transition:background .12s ease,color .12s ease;',
    body: 'padding:16px 20px;flex:1;overflow-y:auto;overflow-x:hidden;min-height:60px;',
    loading: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px 0;',
    loadingText: 'font-size:13px;color:var(--luma-ssh-text-muted,#8f98a0);',
    errorWrap: 'text-align:center;padding:28px 0 12px;',
    errorMsg: 'color:var(--luma-ssh-error,#e74c3c);font-size:13px;margin-bottom:4px;',
    errorDetail: 'color:var(--luma-ssh-text-muted,#8f98a0);font-size:11px;margin-top:6px;font-family:monospace;word-break:break-word;max-height:60px;overflow-y:auto;',
    retryBtn: 'background:none;border:1px solid var(--luma-ssh-accent-dim,rgba(102,192,255,.3));color:var(--luma-ssh-accent,#66c0ff);padding:6px 16px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;margin-top:10px;',
    cardIcon: 'width:42px;height:42px;border-radius:10px;background:rgba(102,192,255,.08);border:1px solid rgba(102,192,255,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--luma-ssh-accent,#66c0ff);',
    cardInfo: 'min-width:0;overflow:hidden;',
    cardName: 'font-size:14px;font-weight:600;color:var(--luma-ssh-text-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    cardDetail: 'font-size:11px;color:var(--luma-ssh-text-muted,#8f98a0);margin-top:2px;overflow-wrap:anywhere;word-break:break-word;',
    badgeAvail: 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0;background:var(--luma-ssh-success-bg,rgba(46,160,67,.15));color:var(--luma-ssh-success,#64c882);box-shadow:0 0 8px rgba(46,160,67,.2);',
    badgeUnavail: 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0;background:rgba(255,255,255,.05);color:var(--luma-ssh-text-muted,#8f98a0);',
    footer: 'padding:12px 20px;border-top:1px solid rgba(102,192,255,.08);display:flex;align-items:center;justify-content:space-between;width:100%;overflow:hidden;background:rgba(0,0,0,.15);',
    footerNote: 'font-size:10px;color:var(--luma-ssh-text-muted,#8f98a0);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;',
    cancelBtn: 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--luma-ssh-text,#c7d5e0);padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;transition:background .12s ease,border-color .12s ease;flex-shrink:0;',
    progressWrap: 'padding:28px 0;text-align:center;',
    progressLabel: 'font-size:13px;color:var(--luma-ssh-text-muted,#8f98a0);margin-bottom:8px;',
    progressBar: 'width:100%;height:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.04);border-radius:3px;overflow:hidden;margin:12px 0;',
    progressFill: 'height:100%;background:linear-gradient(to right,rgba(26,159,255,.9),rgba(102,192,255,.9));border-radius:3px;transition:width .3s ease;width:0%;',
    successWrap: 'text-align:center;padding:28px 0 16px;',
    successIcon: 'width:52px;height:52px;border-radius:50%;background:rgba(46,160,67,.12);border:1px solid rgba(46,160,67,.15);display:flex;align-items:center;justify-content:center;color:var(--luma-ssh-success,#64c882);margin:0 auto 16px;box-shadow:0 0 20px rgba(46,160,67,.15);',
    successTitle: 'font-size:16px;font-weight:700;color:var(--luma-ssh-text-primary,#fff);margin-bottom:6px;',
    successDetail: 'font-size:12px;color:var(--luma-ssh-text-muted,#8f98a0);margin-bottom:20px;overflow-wrap:anywhere;word-break:break-word;',
    successActions: 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap;',
    primaryBtn: 'display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border:none;border-radius:4px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.3px;background:linear-gradient(to right,var(--luma-ssh-accent,#1a9fff),var(--luma-ssh-accent,#66c0ff));color:var(--luma-ssh-text-primary,#fff);box-shadow:0 0 8px var(--luma-ssh-accent-glow,rgba(102,192,255,.25));min-width:0;overflow:hidden;',
    secondaryBtn: 'display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border:1px solid var(--luma-ssh-accent-dim,rgba(102,192,255,.3));border-radius:4px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;background:transparent;color:var(--luma-ssh-accent,#66c0ff);min-width:0;overflow:hidden;',
    errorIcon: 'width:52px;height:52px;border-radius:50%;background:var(--luma-ssh-error-bg,rgba(231,76,60,.12));border:1px solid rgba(231,76,60,.15);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 0 20px rgba(231,76,60,.12);',
    errorTitle: 'font-size:16px;font-weight:700;color:var(--luma-ssh-text-primary,#fff);margin-bottom:6px;',
    errorMsgNew: 'font-size:12px;color:var(--luma-ssh-error,#e74c3c);margin-bottom:20px;overflow-wrap:anywhere;word-break:break-word;',
    errorActions: 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap;',

    // Depot modal styles
    btnInstalledClickable: 'display:inline-flex;align-items:center;gap:6px;padding:7px 16px;margin-left:10px;border:1px solid rgba(100,200,130,.3);border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:rgba(46,160,67,.15);color:var(--luma-ssh-success,#64c882);vertical-align:middle;position:relative;z-index:1;flex-shrink:0;transition:background .16s ease,border-color .16s ease,box-shadow .16s ease,transform .08s ease;',
    depotGroupHeader: 'display:flex;align-items:center;justify-content:space-between;padding:8px 4px 4px;font-size:11px;font-weight:700;color:var(--luma-ssh-text-muted,#8f98a0);text-transform:uppercase;letter-spacing:.5px;',
    depotCard: 'display:grid;grid-template-columns:22px 1fr auto;align-items:center;column-gap:12px;width:100%;padding:10px 14px;margin-bottom:4px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);border-radius:8px;cursor:pointer;transition:background .15s ease,border-color .15s ease,opacity .15s ease;',
    depotCardSelected: 'border-color:rgba(102,192,255,.3)!important;background:rgba(102,192,255,.06)!important;',
    depotCardDisabled: 'opacity:.45!important;cursor:not-allowed!important;',
    depotInfo: 'min-width:0;overflow:hidden;',
    depotName: 'font-size:13px;font-weight:600;color:var(--luma-ssh-text-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    depotDetail: 'font-size:10px;color:var(--luma-ssh-text-muted,#8f98a0);margin-top:1px;overflow-wrap:anywhere;word-break:break-word;',
    depotMeta: 'display:flex;align-items:center;gap:6px;flex-shrink:0;',
    depotSize: 'font-size:11px;font-weight:600;color:var(--luma-ssh-text-muted,#8f98a0);white-space:nowrap;',
    depotOs: 'display:inline-flex;align-items:center;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;background:rgba(102,192,255,.08);color:var(--luma-ssh-accent,#66c0ff);',
    depotTotal: 'display:flex;align-items:center;justify-content:space-between;padding:10px 0 0;font-size:12px;color:var(--luma-ssh-text-muted,#8f98a0);border-top:1px solid rgba(102,192,255,.1);margin-top:8px;',
    depotTotalStrong: 'color:var(--luma-ssh-text-primary,#fff);font-weight:700;',
    depotProgressWrap: 'padding:20px 0;text-align:center;',
    depotProgressLabel: 'font-size:13px;color:var(--luma-ssh-text-muted,#8f98a0);margin-bottom:8px;',
    depotProgressBar: 'width:100%;height:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.04);border-radius:3px;overflow:hidden;margin:12px 0;',
    depotProgressFill: 'height:100%;background:linear-gradient(to right,rgba(26,159,255,.9),rgba(102,192,255,.9));border-radius:3px;transition:width .3s ease;width:0%;',
  };

  function dot(hue) {
    var c = hue === 'green' ? 'var(--luma-ssh-success,#64c882);box-shadow:0 0 6px rgba(46,160,67,.6)' :
      hue === 'blue' ? 'var(--luma-ssh-accent,#66c0ff);box-shadow:0 0 6px rgba(102,192,255,.6)' :
        hue === 'red' ? 'var(--luma-ssh-error,#e74c3c);box-shadow:0 0 6px rgba(231,76,60,.6)' :
          'var(--luma-ssh-text-muted,#8f98a0)';
    return '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + c + ';"></span>';
  }

  // ---------------------------------------------------------------------------
  // URL & ID helpers
  // ---------------------------------------------------------------------------
  function extractAppId() {
    try {
      // Method 1: Try window.location (works in standard browser)
      var m = (window.location.pathname || '').match(APP_URL_RE);
      if (!m) m = (window.location.href || '').match(APP_URL_RE);
      if (m) {
        var id = m[1];
        if (/^\d+$/.test(id) && id.length <= MAX_ID_LENGTH && id !== '0') return id;
      }

      // Method 2: Steam global variables
      if (typeof g_rgCurrentAppID !== 'undefined' && g_rgCurrentAppID) {
        return String(g_rgCurrentAppID);
      }
      if (typeof g_applicationID !== 'undefined' && g_applicationID) {
        return String(g_applicationID);
      }
      if (typeof g_unAppID !== 'undefined' && g_unAppID) {
        return String(g_unAppID);
      }

      // Method 3: DOM — look for links with /app/ pattern
      var appLinks = document.querySelectorAll('a[href*="/app/"]');
      for (var i = 0; i < appLinks.length; i++) {
        var href = appLinks[i].getAttribute('href') || '';
        var linkMatch = href.match(APP_URL_RE);
        if (linkMatch) {
          var linkId = linkMatch[1];
          if (/^\d+$/.test(linkId) && linkId.length <= MAX_ID_LENGTH && linkId !== '0') return linkId;
        }
      }

      // Method 4: DOM — look for subid input
      var subInput = document.querySelector('input[name="subid"]');
      if (subInput && subInput.value && /^\d+$/.test(subInput.value)) {
        return subInput.value;
      }

      // Method 5: DOM — look for data-appid attributes
      var appElements = document.querySelectorAll('[data-appid]');
      if (appElements.length > 0) {
        var appId = appElements[0].getAttribute('data-appid');
        if (appId && /^\d+$/.test(appId) && appId !== '0') return appId;
      }

      // Method 6: Parse canonical link
      var canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) {
        var canonicalHref = canonical.getAttribute('href') || '';
        var canonicalMatch = canonicalHref.match(APP_URL_RE);
        if (canonicalMatch) {
          var cid = canonicalMatch[1];
          if (/^\d+$/.test(cid) && cid.length <= MAX_ID_LENGTH && cid !== '0') return cid;
        }
      }

      return null;
    } catch (_) { return null; }
  }

  function findActionContainer() {
    for (var i = 0; i < ACTION_SELECTORS.length; i++) {
      var el = document.querySelector(ACTION_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function formatFileSize(bytes) {
    var numericBytes = Number(bytes);

    if (
      !Number.isFinite(numericBytes) ||
      numericBytes <= 0
    ) {
      return null;
    }

    var units = ['B', 'KB', 'MB', 'GB'];
    var unitIndex = 0;
    var value = numericBytes;

    while (
      value >= 1024 &&
      unitIndex < units.length - 1
    ) {
      value /= 1024;
      unitIndex++;
    }

    var decimals = value >= 100 || unitIndex === 0 ? 0 : 1;

    return (
      value.toFixed(decimals) +
      ' ' +
      units[unitIndex]
    );
  }
  function formatTimeRemaining(expiresAt, serverTimestamp) {
    if (!expiresAt) {
      return null;
    }

    var expirationTime = Date.parse(expiresAt);

    if (!Number.isFinite(expirationTime)) {
      return null;
    }

    var referenceTime = serverTimestamp
      ? Date.parse(serverTimestamp)
      : Date.now();

    if (!Number.isFinite(referenceTime)) {
      referenceTime = Date.now();
    }

    var remainingMs =
      expirationTime - referenceTime;

    if (remainingMs <= 0) {
      return 'Expired';
    }

    var totalHours = Math.floor(
      remainingMs / (1000 * 60 * 60)
    );

    var days = Math.floor(totalHours / 24);
    var hours = totalHours % 24;

    if (days > 0) {
      return days + 'd ' + hours + 'h';
    }

    if (hours > 0) {
      return hours + 'h';
    }

    var minutes = Math.max(
      1,
      Math.floor(
        remainingMs / (1000 * 60)
      )
    );

    return minutes + 'm';
  }
  function bridgeUrl(path) {
    return BRIDGE_SCHEME + '://' + BRIDGE_HOST + ':' + BRIDGE_PORT + path;
  }

  function detectBridgePort() {
    if (BRIDGE_PORT_DETECTED) return Promise.resolve();
    var ports = [21775, 21777];
    var tryPort = function (i) {
      if (i >= ports.length) return Promise.resolve();
      var url = BRIDGE_SCHEME + '://' + BRIDGE_HOST + ':' + ports[i] + '/health';
      return fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(2000) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.status === 'ok') {
            BRIDGE_PORT = ports[i];
            BRIDGE_PORT_DETECTED = true;
            console.log('[LUMA_INJECT] Detected Tauri bridge on port', BRIDGE_PORT);
          }
        })
        .catch(function () { return tryPort(i + 1); });
    };
    return tryPort(0);
  }

  function sourcesUrl(appId) {
    return bridgeUrl('/api/sources/' + appId);
  }

  function providersUrl() {
    return bridgeUrl('/api/providers');
  }

  function downloadUrl() {
    return bridgeUrl('/api/download');
  }

  function localStatusUrl(appId) {
    return bridgeUrl('/api/local-status/' + appId);
  }

  function downloadStatusUrl(requestId) {
    return bridgeUrl('/api/download-status/' + requestId);
  }

  function openLibraryUrl(appId) {
    return bridgeUrl('/api/open-library/' + appId);
  }

  function depotsUrl(appId) {
    return bridgeUrl('/api/depots/' + appId);
  }

  function depotDownloadUrl() {
    return bridgeUrl('/api/depot-download');
  }

  function depotDownloadStatusUrl(jobId) {
    return bridgeUrl('/api/depot-download-status/' + jobId);
  }

  function restartSteamUrl() {
    return bridgeUrl('/api/restart-steam');
  }

  function providerStatsUrl() {
    return bridgeUrl('/api/provider-stats');
  }

  function getModalBody() {
    return document.querySelector(
      '[' + MODAL_MARKER_ATTR + '="' + MODAL_MARKER_VAL + '"] [data-lumaforge-modal-body="true"]'
    );
  }

  function getModalBadge(card) {
    return card ? card.querySelector('[data-lumaforge-source-badge="true"]') : null;
  }

  // ---------------------------------------------------------------------------
  // Bridge fetch helper with comprehensive logging
  // ---------------------------------------------------------------------------
  function bridgeFetch(url, opts, label) {
    console.log('[LUMA_BRIDGE] ' + label + ' — Method:', opts.method || 'GET');
    console.log('[LUMA_BRIDGE] ' + label + ' — URL:', url);
    console.log('[LUMA_BRIDGE] ' + label + ' — Origin:', window.location.origin);
    console.log('[LUMA_BRIDGE] ' + label + ' — Page URL:', window.location.href);
    return fetch(url, opts)
      .then(function (r) {
        console.log('[LUMA_BRIDGE] ' + label + ' — Response status:', r.status, r.statusText);
        return r;
      })
      .catch(function (err) {
        console.error('[LUMA_BRIDGE] ' + label + ' — FAILED:', err.message || err);
        console.error('[LUMA_BRIDGE] ' + label + ' — Error name:', err && err.name);
        console.error('[LUMA_BRIDGE] ' + label + ' — Error message:', err && err.message);
        if (err && err.stack) console.error('[LUMA_BRIDGE] ' + label + ' — Error stack:', err.stack);
        throw err;
      });
  }

  // ---------------------------------------------------------------------------
  // Unified fetch retry helper — retries only network-level failures
  // hooks.beforeAttempt(attempt) -> false to abort the chain
  // ---------------------------------------------------------------------------
  var RETRY_DELAYS = [0, 300, 750, 1500];
  var MAX_RETRY_ATTEMPTS = 4;

  function retryFetch(url, opts, label, hooks) {
    hooks = hooks || {};
    var attempt = 0;

    function tryOnce() {
      attempt++;
      var attemptNum = attempt;

      if (hooks.beforeAttempt && !hooks.beforeAttempt(attemptNum)) {
        return Promise.reject(new DOMException('Context invalidated', 'AbortError'));
      }

      console.log('[LUMA_BRIDGE] ' + label + ' attempt ' + attemptNum + (hooks.appId ? ' for AppID: ' + hooks.appId : ''));

      return fetch(url, opts)
        .then(function (r) {
          if (opts && opts.signal && opts.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          console.log('[LUMA_BRIDGE] ' + label + ' succeeded' + (hooks.appId ? ' for AppID: ' + hooks.appId : ''));
          return r;
        })
        .catch(function (err) {
          if (opts && opts.signal && opts.signal.aborted) {
            throw err;
          }
          if (err && err.name === 'AbortError') {
            throw err;
          }
          var isNetworkFailure = !err || !err.response;
          if (attemptNum < MAX_RETRY_ATTEMPTS && isNetworkFailure) {
            var delay = RETRY_DELAYS[attemptNum] || 1500;
            console.log('[LUMA_BRIDGE] Network failure' + (hooks.appId ? ' for AppID ' + hooks.appId : '') + '; retrying in ' + delay + 'ms');
            return new Promise(function (resolve, reject) {
              var timerId = setTimeout(function () {
                var idx = state.retryTimers.indexOf(timerId);
                if (idx !== -1) state.retryTimers.splice(idx, 1);
                tryOnce().then(resolve, reject);
              }, delay);
              state.retryTimers.push(timerId);
            });
          }
          console.log('[LUMA_BRIDGE] ' + label + ' failed after ' + attemptNum + ' attempts' + (hooks.appId ? ' for AppID: ' + hooks.appId : ''));
          throw err;
        });
    }

    return tryOnce();
  }

  // ---------------------------------------------------------------------------
  // Helper functions
  // ---------------------------------------------------------------------------
  function abortPendingRequests() {
    if (state.statusAbortController) {
      state.statusAbortController.abort();
      state.statusAbortController = null;
    }
    if (state.providerAbortController) {
      state.providerAbortController.abort();
      state.providerAbortController = null;
    }
    if (state.statusRequest) {
      if (state.statusRequest.controller) state.statusRequest.controller.abort();
      if (state.statusRequest.retryTimer) clearTimeout(state.statusRequest.retryTimer);
      state.statusRequest = null;
    }
    if (state.recoveryTimer) {
      clearTimeout(state.recoveryTimer);
      state.recoveryTimer = null;
    }
    stopDownloadPoll();
    cancelAllRetries();
    _fetchSeq++;
  }

  function cancelAllRetries() {
    for (var i = 0; i < state.retryTimers.length; i++) {
      clearTimeout(state.retryTimers[i]);
    }
    state.retryTimers = [];
  }

  function removeButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) btn.remove();
  }

  function getObserverRoot() {
    if (document.documentElement) return document.documentElement;
    return document.body;
  }

  function syncNamespaceState() {
    if (window[NAMESPACE]) {
      window[NAMESPACE].active = state.activated;
      window[NAMESPACE].currentUrl = state.currentUrl;
      window[NAMESPACE].currentAppId = state.currentAppId;
      window[NAMESPACE].reconcileCount = state.reconcileCount;
      window[NAMESPACE].observerActive = !!state.observer;
      window[NAMESPACE].historyWrapped = state.historyPatched;
    }
  }

  // ---------------------------------------------------------------------------
  // Button state helpers
  // ---------------------------------------------------------------------------
  function setButtonState(appId, style, html, disabled) {
    try {
      var btn = document.getElementById(BTN_ID);
      if (!btn) return false;
      if (btn.getAttribute(BTN_APPID_ATTR) !== appId) return false;
      btn.setAttribute('style', style);
      btn.innerHTML = html;
      if (disabled) {
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.removeAttribute('aria-disabled');
      }
      return true;
    } catch (_) { return false; }
  }

  function setButtonLumaState(appId, lumaState) {
    try {
      var btn = document.getElementById(BTN_ID);
      if (!btn) return;
      if (btn.getAttribute(BTN_APPID_ATTR) !== appId) return;
      btn.setAttribute(BTN_STATE_ATTR, lumaState);
    } catch (_) { }
  }

  function applyInLibraryState(appId) {
    if (IS_LINUX) {
      setButtonState(appId, ST.btnInstalledClickable, svgCheck() + '<span>IN LIBRARY</span>', false);
      setButtonLumaState(appId, 'in-library');
      console.log('[LUMA_INJECT] App', appId, 'already in Luma library (clickable — Linux)');
    } else {
      setButtonState(appId, ST.btnInstalled, svgCheck() + '<span>IN LIBRARY</span>', true);
      setButtonLumaState(appId, 'in-library');
      console.log('[LUMA_INJECT] App', appId, 'already in Luma library');
    }
  }

  function applyInstalledState(appId) {
    setButtonState(appId, ST.btnInstalled, svgCheck() + '<span>INSTALLED</span>', true);
    setButtonLumaState(appId, 'installed');
    console.log('[LUMA_INJECT] App', appId, 'content installed (blocked)');
  }

  // ---------------------------------------------------------------------------
  // Bridge recovery timer
  // ---------------------------------------------------------------------------
  function scheduleBridgeRecovery(appId) {
    if (state.recoveryTimer) {
      clearTimeout(state.recoveryTimer);
      state.recoveryTimer = null;
    }

    if (!state.activated || state.currentAppId !== appId) {
      return;
    }

    var btn = document.getElementById(BTN_ID);

    if (!btn || btn.getAttribute(BTN_APPID_ATTR) !== appId) {
      return;
    }

    if (btn.getAttribute(BTN_STATE_ATTR) !== 'bridge-error') {
      return;
    }

    if (state.bridgeRecoveryAppId !== appId) {
      state.bridgeRecoveryAppId = appId;
      state.bridgeRecoveryCount = 0;
    }

    if (state.bridgeRecoveryCount >= 1) {
      console.log(
        '[LUMA_BRIDGE] Automatic recovery limit reached for AppID:',
        appId
      );

      return;
    }

    state.bridgeRecoveryCount++;

    console.log(
      '[LUMA_BRIDGE] Scheduling automatic recovery for AppID:',
      appId
    );

    state.recoveryTimer = setTimeout(function () {
      state.recoveryTimer = null;

      if (!state.activated || state.currentAppId !== appId) {
        return;
      }

      var currentButton = document.getElementById(BTN_ID);

      if (
        !currentButton ||
        currentButton.getAttribute(BTN_APPID_ATTR) !== appId
      ) {
        return;
      }

      if (
        currentButton.getAttribute(BTN_STATE_ATTR) !==
        'bridge-error'
      ) {
        return;
      }

      console.log(
        '[LUMA_BRIDGE] Running automatic recovery for AppID:',
        appId
      );

      ensureLumaButtonExists();
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Local-status result handler (shared between reconcile and click-to-retry)
  // ---------------------------------------------------------------------------
  function handleLocalStatusResult(appId, err, data) {
    try {
      var b = document.getElementById(BTN_ID);
      if (!b || b.getAttribute(BTN_APPID_ATTR) !== appId) {
        console.log('[LUMA_WATCHER] Button gone or AppID mismatch after local-status for', appId);
        return;
      }

      if (err) {
        if (err.name === 'AbortError') {
          console.log('[LUMA_BRIDGE] Aborted request for AppID:', appId);
          return;
        }
        console.error('[LUMA_INJECT] Bridge error for', appId, ':', err.name || err.message || err);
        setButtonState(appId, ST.btn, svgDownload() + '<span>BRIDGE ERROR</span>', false);
        setButtonLumaState(appId, 'bridge-error');
        scheduleBridgeRecovery(appId);
        return;
      }

      if (!data || !data.ok) {
        var detail = data ? (data.message || 'invalid') : 'no data';
        console.error('[LUMA_INJECT] Invalid status for', appId, ':', detail);
        setButtonState(appId, ST.btn, svgDownload() + '<span>BRIDGE ERROR</span>', false);
        setButtonLumaState(appId, 'bridge-error');
        scheduleBridgeRecovery(appId);
        return;
      }

      state.bridgeRecoveryAppId = appId;
      state.bridgeRecoveryCount = 0;

      var inLibrary = data.inLibrary === true || data.in_library === true;
      var installed = data.installed === true || data.has_acf === true;
      console.log('[LUMA_INJECT] App', appId, 'inLibrary =', inLibrary, 'installed =', installed);

      if (!state.statusCache) state.statusCache = {};
      state.statusCache[appId] = { inLibrary: inLibrary, installed: installed, timestamp: Date.now() };

      if (installed) {
        applyInstalledState(appId);
      } else if (inLibrary) {
        applyInLibraryState(appId);
      } else {
        setButtonState(appId, ST.btn, svgDownload() + '<span>ADD VIA LUMAFORGE</span>', false);
        setButtonLumaState(appId, 'ready');
      }
    } catch (_) { }
  }

  // ---------------------------------------------------------------------------
  // checkLocalStatus — unified with dedup and abortable retry
  // ---------------------------------------------------------------------------
  function checkLocalStatus(appId, cb) {
    try {
      if (state.recoveryTimer) {
        clearTimeout(state.recoveryTimer);
        state.recoveryTimer = null;
      }

      if (state.statusRequest && state.statusRequest.appId === appId) {
        console.log('[LUMA_BRIDGE] Reusing pending request for AppID:', appId);
        return;
      }

      if (state.statusRequest) {
        if (state.statusRequest.controller) state.statusRequest.controller.abort();
        if (state.statusRequest.retryTimer) clearTimeout(state.statusRequest.retryTimer);
        state.statusRequest = null;
      }
      if (state.statusAbortController) {
        state.statusAbortController.abort();
        state.statusAbortController = null;
      }

      var controller = new AbortController();
      state.statusAbortController = controller;
      state.statusRequest = { appId: appId, controller: controller, retryTimer: null };

      var url = localStatusUrl(appId);
      console.log('[LUMA_WATCHER] Local status requested for AppID:', appId);

      retryFetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal,
      }, 'local-status', {
        appId: appId,
        beforeAttempt: function (attemptNum) {
          if (!state.activated || controller.signal.aborted) return false;
          if (state.currentAppId !== appId) return false;
          var btn = document.getElementById(BTN_ID);
          if (!btn || btn.getAttribute(BTN_APPID_ATTR) !== appId) return false;

          if (attemptNum <= 3) {
            setButtonState(appId, ST.btn + 'opacity:.7;pointer-events:none;', svgSpinner() + '<span>CHECKING\u2026</span>', true);
            setButtonLumaState(appId, 'checking');
          }
          return true;
        },
      })
        .then(function (r) {
          if (controller.signal.aborted) return;
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          if (controller.signal.aborted) return;
          if (!d || !d.ok) throw new Error('Invalid response');
          var responseAppId = String(d.appId || d.app_id || '');
          if (responseAppId !== String(appId)) {
            console.log('[LUMA_BRIDGE] Stale response ignored for AppID:', appId, '(got:', responseAppId + ')');
            return;
          }
          if (state.currentAppId !== appId) return;

          console.log('[LUMA_BRIDGE] Local-status succeeded for AppID:', appId);

          if (state.statusRequest && state.statusRequest.appId === appId) {
            state.statusRequest = null;
          }

          cb(null, d, appId);
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') {
            console.log('[LUMA_BRIDGE] Aborted request for AppID:', appId);
            return;
          }
          if (!state.activated || state.currentAppId !== appId) return;

          if (state.statusRequest && state.statusRequest.appId === appId) {
            state.statusRequest = null;
          }

          cb(err, null, appId);
        });
    } catch (e) { cb(e, null, appId); }
  }

  // ---------------------------------------------------------------------------
  // CORE: ensureLumaButtonExists()
  // ---------------------------------------------------------------------------
  function ensureLumaButtonExists() {
    try {
      var appId = extractAppId();

      if (!appId) {
        removeButton();
        state.currentAppId = null;
        return;
      }

      var existing = document.getElementById(BTN_ID);
      if (existing && existing.getAttribute(BTN_APPID_ATTR) === appId) {
        var existingState = existing.getAttribute(BTN_STATE_ATTR);
        if (existingState !== 'bridge-error' && existingState !== 'request-error') {
          return;
        }
        console.log('[LUMA_WATCHER] Retrying for AppID:', appId, '(was:', existingState + ')');
        setButtonState(appId, ST.btn + 'opacity:.7;pointer-events:none;', svgSpinner() + '<span>CHECKING\u2026</span>', true);
        setButtonLumaState(appId, 'checking');
      } else {
        if (existing) existing.remove();

        console.log('[LUMA_WATCHER] Injecting controls for AppID:', appId);

        var container = findActionContainer();
        if (!container) {
          console.log('[LUMA_WATCHER] Target container not found yet for AppID:', appId);
          return;
        }

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = BTN_ID;
        btn.className = 'luma-ssh-action-button';
        btn.setAttribute(BTN_MARKER_ATTR, BTN_MARKER_VAL);
        btn.setAttribute(BTN_APPID_ATTR, appId);
        btn.setAttribute(BTN_STATE_ATTR, 'checking');
        btn.setAttribute('aria-label', 'Add app ' + appId + ' via LumaForge');
        btn.title = 'Select a download source for app ' + appId;
        btn.setAttribute('style', ST.btn + 'opacity:.7;pointer-events:none;');
        btn.setAttribute('aria-disabled', 'true');
        btn.innerHTML = svgSpinner() + '<span>CHECKING\u2026</span>';

        var parent = container.parentNode;
        if (parent) {
          parent.insertBefore(btn, container.nextSibling);
        } else {
          container.appendChild(btn);
        }
      }

      state.currentAppId = appId;
      ensureKeyframes();
      syncNamespaceState();

      console.log('[LUMA_INJECT] Injecting for AppID:', appId);

      var seq = ++_fetchSeq;
      checkLocalStatus(appId, function (err, data, resolvedAppId) {
        if (seq !== _fetchSeq) {
          console.log('[LUMA_WATCHER] Ignored stale response for AppID:', resolvedAppId);
          return;
        }
        if (state.currentAppId !== resolvedAppId) {
          console.log('[LUMA_WATCHER] Ignored stale response for AppID:', resolvedAppId, '(current:', state.currentAppId + ')');
          return;
        }
        handleLocalStatusResult(resolvedAppId, err, data);
      });
    } catch (e) {
      console.error('[CEF_INJECT_ERROR] ensureLumaButtonExists:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Event delegation
  // ---------------------------------------------------------------------------
  function setupEventDelegation() {
    try {
      document.body.addEventListener('click', function (e) {
        try {
          var btn = e.target.closest('#' + BTN_ID);
          if (btn) {
            e.preventDefault();
            e.stopPropagation();
            var btnAppId = btn.getAttribute(BTN_APPID_ATTR) || extractAppId();
            if (!btnAppId) return;
            var btnLumaState = btn.getAttribute(BTN_STATE_ATTR);
            if (btnLumaState === 'bridge-error' || btnLumaState === 'request-error') {
              console.log('[LUMA_INJECT] Retry click for AppID:', btnAppId);

              state.bridgeRecoveryAppId = btnAppId;
              state.bridgeRecoveryCount = 0;

              setButtonState(btnAppId, ST.btn + 'opacity:.7;pointer-events:none;', svgSpinner() + '<span>CHECKING\u2026</span>', true);
              setButtonLumaState(btnAppId, 'checking');
              checkLocalStatus(btnAppId, function (err, data, resolvedId) {
                handleLocalStatusResult(resolvedId, err, data);
              });
              return;
            }
            if (btn.getAttribute('aria-disabled') === 'true') return;
            var btnText = btn.textContent || '';
            if (btnText.indexOf('IN LIBRARY') !== -1) {
              if (IS_LINUX) {
                console.log('[LUMA_INJECT] IN LIBRARY click on Linux → opening depot modal for AppID:', btnAppId);
                openDepotModal(btnAppId);
              }
              return;
            }
            console.log('[LUMA_INJECT] Delegated click for AppID:', btnAppId);
            openSourceModal(btnAppId);
            return;
          }
          if (e.target.id === 'luma-retry-sources' || e.target.closest('#luma-retry-sources')) {
            e.preventDefault();
            e.stopPropagation();
            var retryAppId = extractAppId();
            if (retryAppId) openSourceModal(retryAppId);
            return;
          }
        } catch (err) {
          console.error('[CEF_INJECT_ERROR] delegated click:', err);
        }
      }, true);

      document.body.addEventListener('click', function (e) {
        try {
          if (e.target.getAttribute(MODAL_MARKER_ATTR) === MODAL_MARKER_VAL) {
            closeModal();
          }
        } catch (_) { }
      }, true);

      document.addEventListener('keydown', function (e) {
        try {
          if (e.key === 'Escape' || e.keyCode === 27) {
            var modal = document.querySelector('[' + MODAL_MARKER_ATTR + '="' + MODAL_MARKER_VAL + '"]');
            if (modal) {
              e.preventDefault();
              e.stopPropagation();
              closeModal();
            }
          }
        } catch (_) { }
      }, true);

      console.log('[LUMA_INJECT] Event delegation active on document.body');
    } catch (e) {
      console.error('[CEF_INJECT_ERROR] setupEventDelegation:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Modal: close
  // ---------------------------------------------------------------------------
  function closeModal() {
    try {
      if (state.providerAbortController) {
        state.providerAbortController.abort();
        state.providerAbortController = null;
      }
      stopDownloadPoll();
      var m = document.querySelector('[' + MODAL_MARKER_ATTR + '="' + MODAL_MARKER_VAL + '"]');
      if (m) m.remove();
      if (state.savedFocusElement && state.savedFocusElement.isConnected) {
        state.savedFocusElement.focus();
      }
      state.savedFocusElement = null;
    } catch (e) { console.error('[CEF_INJECT_ERROR] closeModal:', e); }
  }

  // ---------------------------------------------------------------------------
  // Modal: build and show
  // ---------------------------------------------------------------------------
  function openSourceModal(appId) {
    try {
      console.log('[LUMA_INJECT] Opening modal for AppID:', appId);

      state.savedFocusElement = document.activeElement;
      closeModal();

      var backdrop = document.createElement('div');
      backdrop.setAttribute(MODAL_MARKER_ATTR, MODAL_MARKER_VAL);
      backdrop.setAttribute('class', 'luma-ssh-modal-backdrop');
      backdrop.setAttribute('style', ST.backdrop);

      var panel = document.createElement('div');
      panel.setAttribute('class', 'luma-ssh-modal-panel');
      panel.setAttribute('style', ST.panel);
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');

      var titleId = 'luma-modal-title-' + appId;
      var descId = 'luma-modal-desc-' + appId;
      panel.setAttribute('aria-labelledby', titleId);
      panel.setAttribute('aria-describedby', descId);
      panel.addEventListener('click', function (e) { e.stopPropagation(); });

      var header = document.createElement('div');
      header.setAttribute('style', ST.header);
      var hdrIcon = document.createElement('span');
      hdrIcon.setAttribute('style', ST.headerIcon);
      hdrIcon.innerHTML = svgCloudDownload();
      var hdrTextWrap = document.createElement('div');
      hdrTextWrap.setAttribute('style', 'min-width:0;flex:1;');
      var hdrTitle = document.createElement('div');
      hdrTitle.id = titleId;
      hdrTitle.setAttribute('style', ST.headerTitle);
      hdrTitle.textContent = 'Select Download Source';
      var hdrSubtitle = document.createElement('div');
      hdrSubtitle.id = descId;
      hdrSubtitle.setAttribute('style', ST.headerSubtitle);
      hdrSubtitle.textContent = 'Choose a trusted provider for this package';
      hdrTextWrap.appendChild(hdrTitle);
      hdrTextWrap.appendChild(hdrSubtitle);

      var hdrVersion = document.createElement('span');
      hdrVersion.setAttribute('style', ST.headerVersion);
      var verParts = (LUMA_INJECT_VERSION || '').split('-');
      hdrVersion.textContent = 'v' + (verParts[0] || LUMA_INJECT_VERSION);

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('class', 'luma-ssh-close-btn');
      closeBtn.setAttribute('style', ST.closeBtn);
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML = svgX();
      closeBtn.addEventListener('click', closeModal);

      var headerRight = document.createElement('div');
      headerRight.setAttribute('style', 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;');
      headerRight.appendChild(hdrVersion);
      headerRight.appendChild(closeBtn);

      header.appendChild(hdrIcon);
      header.appendChild(hdrTextWrap);
      header.appendChild(headerRight);

      var body = document.createElement('div');
      body.setAttribute('class', 'luma-ssh-modal-body');
      body.setAttribute('data-lumaforge-modal-body', 'true');
      body.setAttribute('style', ST.body);
      body.innerHTML =
        '<div style="' + ST.loading + '">' +
        svgSpinner() +
        '<span style="' + ST.loadingText + '">Loading providers\u2026</span>' +
        '</div>';

      var footer = document.createElement('div');
      footer.setAttribute('style', ST.footer);
      var footerNote = document.createElement('span');
      footerNote.setAttribute('style', ST.footerNote);
      footerNote.textContent = 'Packages are installed through LumaForge';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.setAttribute('style', ST.cancelBtn);
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', closeModal);
      footer.appendChild(footerNote);
      footer.appendChild(cancelBtn);

      panel.appendChild(header);
      panel.appendChild(body);
      panel.appendChild(footer);
      backdrop.appendChild(panel);

      (document.body || document.documentElement).appendChild(backdrop);
      console.log('[LUMA_INJECT] Modal appended to document.body');

      try { closeBtn.focus(); } catch (_) { }
      try { logModalHorizontalOverflow(); } catch (_) { }

      console.log("[PROVIDER_FETCH] VERSION:", LUMA_INJECT_VERSION);
      console.log("[PROVIDER_FETCH] METHOD:", "GET");
      console.log("[PROVIDER_FETCH] URL:", sourcesUrl(appId));
      console.log("[PROVIDER_FETCH] PAGE:", window.location.href);
      console.log("[PROVIDER_FETCH] ORIGIN:", window.location.origin);
      console.log("[PROVIDER_FETCH] PROTOCOL:", window.location.protocol);
      console.log("[PROVIDER_FETCH] SECURE_CONTEXT:", window.isSecureContext);

      if (state.providerAbortController) {
        state.providerAbortController.abort();
      }
      var providerController = new AbortController();
      state.providerAbortController = providerController;
      var providerTimeout = setTimeout(function () {
        if (!providerController.signal.aborted) {
          console.error(
            '[LUMA_BRIDGE] Sources request timed out for AppID:',
            appId
          );

          providerController.abort();
        }
      }, 12000);
      var url = sourcesUrl(appId);
      var providerOpts = { method: 'GET', mode: 'cors', cache: 'no-store', signal: providerController.signal };
      retryFetch(url, providerOpts, 'sources', {
        appId: appId,
        beforeAttempt: function () {
          if (!state.activated || providerController.signal.aborted) return false;
          var modal = document.querySelector('[' + MODAL_MARKER_ATTR + '="' + MODAL_MARKER_VAL + '"]');
          if (!modal) return false;
          return true;
        },
      })
        .then(function (r) {
          clearTimeout(providerTimeout);
          console.log("[PROVIDER_FETCH] RESPONSE_RECEIVED:", true);
          console.log("[PROVIDER_FETCH] STATUS:", r.status);
          console.log("[PROVIDER_FETCH] OK:", r.ok);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          if (providerController.signal.aborted) {
            console.log(
              '[PROVIDER_FETCH] Response ignored because request was aborted'
            );

            return;
          }

          console.log(
            '[PROVIDER_FETCH] PARSED_RESPONSE:',
            data
          );

          var sources = Array.isArray(data.sources)
            ? data.sources
            : [];

          var unavailableSources = Array.isArray(
            data.unavailableSources
          )
            ? data.unavailableSources
            : [];

          console.log(
            '[PROVIDER_FETCH] AVAILABLE_SOURCES:',
            sources.length
          );

          console.log(
            '[PROVIDER_FETCH] UNAVAILABLE_SOURCES:',
            unavailableSources.length
          );

          function renderWithStats(providerStats) {
            if (data && data.ok === true) {
              renderSources(
                body,
                sources,
                unavailableSources,
                appId,
                data.message || null,
                providerStats || null
              );
              if (
                state.providerAbortController ===
                providerController
              ) {
                state.providerAbortController = null;
              }
              return;
            }
            throw new Error(
              data && data.message
                ? data.message
                : 'Invalid response from bridge'
            );
          }

          fetch(providerStatsUrl(), {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store',
            signal: providerController.signal,
          })
            .then(function (r) {
              if (!r.ok) return null;
              return r.json();
            })
            .then(function (statsData) {
              if (providerController.signal.aborted) return;
              var providerStats = (statsData && statsData.ok && Array.isArray(statsData.providers))
                ? statsData.providers
                : null;
              state.providerStatsCache = providerStats;
              renderWithStats(providerStats);
            })
            .catch(function () {
              renderWithStats(null);
            });
        })
        .catch(function (error) {
          clearTimeout(providerTimeout);

          var modal = document.querySelector(
            '[' +
            MODAL_MARKER_ATTR +
            '="' +
            MODAL_MARKER_VAL +
            '"]'
          );

          // El modal ya fue cerrado. No hay UI que actualizar.
          if (!modal) {
            return;
          }

          var wasTimedOut =
            error &&
            error.name === 'AbortError' &&
            providerController.signal.aborted &&
            state.providerAbortController === providerController;

          var wasClosedOrReplaced =
            error &&
            error.name === 'AbortError' &&
            state.providerAbortController !== providerController;

          // Cerrar el modal o abrir otro modal aborta la solicitud.
          // Eso no debe mostrarse como un error.
          if (wasClosedOrReplaced) {
            return;
          }

          console.error(
            '[PROVIDER_FETCH] REJECTED:',
            error
          );

          console.error(
            '[PROVIDER_FETCH] ERROR_NAME:',
            error && error.name
          );

          console.error(
            '[PROVIDER_FETCH] ERROR_MESSAGE:',
            error && error.message
          );

          var detail = wasTimedOut
            ? 'The provider check took too long. Please try again.'
            : (
              (error && error.name
                ? error.name
                : 'Error') +
              ': ' +
              (error && error.message
                ? error.message
                : 'Unknown provider error')
            );

          body.innerHTML =
            '<div style="' + ST.errorWrap + '">' +
            '<div style="' + ST.errorMsg + '">' +
            'Could not check package sources.' +
            '</div>' +
            '<div style="' + ST.errorDetail + '">' +
            detail +
            '</div>' +
            '<div style="text-align:center">' +
            '<button id="luma-retry-sources" style="' +
            ST.retryBtn +
            '">' +
            'Retry' +
            '</button>' +
            '</div>' +
            '</div>';
        });

    } catch (e) { console.error('[CEF_INJECT_ERROR] openSourceModal:', e); }
  }

  // ---------------------------------------------------------------------------
  // Modal: render source list
  // ---------------------------------------------------------------------------
  function renderSources(
    body,
    sources,
    unavailableSources,
    appId,
    message,
    providerStats
  ) {
    try {
      console.log(
        '[PROVIDER_RENDER] Rendering sources:',
        {
          appId: appId,
          available: sources
            ? sources.length
            : 0,
          unavailable: unavailableSources
            ? unavailableSources.length
            : 0,
          message: message
        }
      );

      function findProviderStat(sourceId) {
        if (!providerStats || !sourceId) return null;
        for (var i = 0; i < providerStats.length; i++) {
          if (providerStats[i].id === sourceId) return providerStats[i];
        }
        return null;
      }

      function buildBlockedCard(source) {
        var sourceId = source.id || '';
        var sourceName = source.name || sourceId || 'Provider';
        var reason = source.detail || 'Package not available';
        var pstat = findProviderStat(sourceId);

        var card = document.createElement('div');
        card.className = 'luma-source-card blocked';
        card.setAttribute('data-lumaforge-source-id', sourceId);

        var icon = document.createElement('div');
        icon.setAttribute('style', ST.cardIcon + 'color:var(--luma-ssh-text-muted,#8f98a0);');
        icon.innerHTML = svgLock();

        var info = document.createElement('div');
        info.setAttribute('style', ST.cardInfo);
        var name = document.createElement('div');
        name.setAttribute('style', ST.cardName + 'color:var(--luma-ssh-text-muted,#8f98a0);');
        name.textContent = sourceName;
        var detail = document.createElement('div');
        detail.setAttribute('style', ST.cardDetail);
        detail.textContent = reason;
        info.appendChild(name);
        info.appendChild(detail);

        if (pstat && pstat.hasKey && pstat.apiKeyExpiresAt) {
          var expMs = Date.parse(pstat.apiKeyExpiresAt);
          var nowMs = Date.now();
          var remainingMs = expMs - nowMs;
          var expiryClass = 'ok';
          var expiryText = '';

          if (remainingMs <= 0) {
            expiryClass = 'expired';
            expiryText = 'API Key Expired';
          } else {
            var days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
            var hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            expiryText = 'Key expires in ' + days + 'd ' + hours + 'h';
            if (days < 3) expiryClass = 'warning';
          }

          var usageParts = [];
          if (pstat.remainingToday != null && pstat.dailyLimit != null && pstat.dailyLimit > 0) {
            usageParts.push(pstat.remainingToday + '/' + pstat.dailyLimit + ' downloads today');
          }
          if (pstat.canMakeRequests === false) {
            usageParts.push('Requests unavailable');
          }

          var expiryBadge = document.createElement('div');
          expiryBadge.className = 'luma-source-expiry ' + expiryClass;
          expiryBadge.textContent = expiryText;
          info.appendChild(expiryBadge);

          if (usageParts.length > 0) {
            var usageLine = document.createElement('div');
            usageLine.className = 'luma-usage-chips';
            usageParts.forEach(function(part) {
              var chip = document.createElement('span');
              chip.className = 'luma-usage-chip';
              chip.textContent = part;
              usageLine.appendChild(chip);
            });
            info.appendChild(usageLine);
          }
        } else if (pstat && !pstat.hasKey) {
          var noKeyLine = document.createElement('div');
          noKeyLine.setAttribute('style', 'font-size:10px;color:var(--luma-ssh-error,#e74c3c);margin-top:3px;');
          noKeyLine.textContent = 'No API key configured';
          info.appendChild(noKeyLine);
        }

        var badge = document.createElement('div');
        badge.setAttribute('data-lumaforge-source-badge', 'true');
        badge.setAttribute('style', ST.badgeUnavail);
        badge.innerHTML = svgLock() + '<span>Unavailable</span>';

        var tooltip = document.createElement('div');
        tooltip.className = 'luma-source-tooltip';
        tooltip.textContent = sourceName + ': ' + reason;

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(badge);
        card.appendChild(tooltip);

        return card;
      }

      if (!sources || !sources.length) {
        body.innerHTML =
          '<div style="' + ST.errorWrap + '">' +
          '<div style="' + ST.errorMsg + '">' +
          'No package sources available.' +
          '</div>' +
          '<div style="' + ST.errorDetail + '">' +
          (
            message ||
            'No enabled provider currently has a package for this App ID.'
          ) +
          '</div>' +
          '</div>';

        if (unavailableSources && unavailableSources.length) {
          var unavailWrap = document.createElement('div');
          unavailWrap.setAttribute('style', 'margin-top:12px;');
          unavailableSources.forEach(function (src) {
            unavailWrap.appendChild(buildBlockedCard(src));
          });
          body.appendChild(unavailWrap);
        }

        console.log(
          '[PROVIDER_RENDER] Empty-source state rendered'
        );

        return;
      }

      // Conserva aquí el resto actual de renderSources().
      body.innerHTML = '';
      sources.forEach(function (src) {


        var selectable = src.selectable === true;
        var avail = src.available === true;

        var checkOnDownload =
          src.availabilityState === 'check_on_download' ||
          src.availability_state === 'check_on_download';



        var card = document.createElement('div');
        card.className = 'luma-source-card';

        if (!selectable) {
          card.setAttribute('style', 'opacity:.45;cursor:default;');
        }

        card.setAttribute('data-lumaforge-source-id', src.id);

        var icon = document.createElement('div');
        icon.setAttribute('style', ST.cardIcon);
        icon.innerHTML = svgDownload(18, 18);

        var info = document.createElement('div');
        info.setAttribute('style', ST.cardInfo);
        var name = document.createElement('div');
        name.setAttribute('style', ST.cardName);
        name.textContent = src.name || src.id;
        var detail = document.createElement('div');
        detail.setAttribute('style', ST.cardDetail);
        if (avail) {
          var packageSize = formatFileSize(
            src.total || src.packageSize || 0
          );

          if (packageSize) {
            detail.textContent =
              'Package available \u2022 ' + packageSize;
          } else {
            detail.textContent = 'Package available';
          }
        } else if (checkOnDownload && selectable) {
          detail.textContent =
            'Select Ryuu to download the package';
        } else {
          detail.textContent =
            src.detail || 'Not available';
        }
        info.appendChild(name);
        info.appendChild(detail);

        var cardSourceStats = null;
        if (src.usage) {
          cardSourceStats = src.usage;
        } else {
          var pstat = findProviderStat(src.id);
          if (pstat && pstat.hasKey) {
            cardSourceStats = {
              remaining_today: pstat.remainingToday,
              daily_limit: pstat.dailyLimit,
              api_key_expires_at: pstat.apiKeyExpiresAt,
              can_make_requests: pstat.canMakeRequests,
            };
          }
        }

        if (cardSourceStats) {
          var usageParts = [];

          var remainingToday = Number(
            cardSourceStats.remaining_today != null
              ? cardSourceStats.remaining_today
              : cardSourceStats.remainingToday
          );

          var dailyLimit = Number(
            cardSourceStats.daily_limit != null
              ? cardSourceStats.daily_limit
              : cardSourceStats.dailyLimit
          );

          var expiresAt =
            cardSourceStats.api_key_expires_at ||
            cardSourceStats.apiKeyExpiresAt ||
            null;

          var serverTimestamp =
            cardSourceStats.timestamp || null;

          if (
            Number.isFinite(remainingToday) &&
            Number.isFinite(dailyLimit) &&
            dailyLimit > 0
          ) {
            usageParts.push(
              remainingToday +
              '/' +
              dailyLimit +
              ' downloads left'
            );
          }

          var expirationText = formatTimeRemaining(
            expiresAt,
            serverTimestamp
          );

          if (expirationText) {
            usageParts.push(
              expirationText === 'Expired'
                ? 'API key expired'
                : 'Key: ' + expirationText
            );
          }

          if (cardSourceStats.can_make_requests === false) {
            usageParts.push('Requests unavailable');
          }

          if (usageParts.length > 0) {
            var usageDetail = document.createElement('div');
            usageDetail.className = 'luma-usage-chips';
            usageParts.forEach(function(part) {
              var chip = document.createElement('span');
              chip.className = 'luma-usage-chip';
              chip.textContent = part;
              usageDetail.appendChild(chip);
            });

            info.appendChild(usageDetail);
          }
        }

        var badge = document.createElement('div');
        badge.setAttribute('data-lumaforge-source-badge', 'true');
        badge.setAttribute('class', 'luma-source-badge-wrap');

        if (avail) {
          badge.setAttribute(
            'style',
            ST.badgeAvail
          );

          badge.innerHTML =
            dot('green') +
            '<span>Available</span>';
        } else if (checkOnDownload && selectable) {
          badge.setAttribute(
            'style',
            'display:inline-flex;' +
            'align-items:center;' +
            'gap:4px;' +
            'padding:4px 10px;' +
            'border-radius:12px;' +
            'font-size:11px;' +
            'font-weight:700;' +
            'white-space:nowrap;' +
            'flex-shrink:0;' +
            'background:rgba(102,192,255,.14);' +
            'color:var(--luma-ssh-accent,#66c0ff);' +
            'box-shadow:0 0 8px rgba(102,192,255,.16);'
          );

          badge.innerHTML =
            dot('blue') +
            '<span>Download</span>';
        } else {
          badge.setAttribute(
            'style',
            ST.badgeUnavail
          );

          badge.innerHTML =
            dot('gray') +
            '<span>Unavailable</span>';
        }

        var tooltip = document.createElement('div');
        tooltip.className = 'luma-source-tooltip';
        var tooltipParts = [];
        tooltipParts.push((src.name || src.id || 'Provider') + ': ' + (src.detail || (avail ? 'Package available' : 'Not available')));
        if (avail) {
          var pstat2 = findProviderStat(src.id);
          if (pstat2 && pstat2.hasKey) {
            if (pstat2.remainingToday != null && pstat2.dailyLimit != null && pstat2.dailyLimit > 0) {
              tooltipParts.push('Downloads: ' + pstat2.remainingToday + '/' + pstat2.dailyLimit + ' remaining today');
            }
            if (pstat2.apiKeyExpiresAt) {
              var expText = formatTimeRemaining(pstat2.apiKeyExpiresAt);
              if (expText) {
                tooltipParts.push('API key: ' + (expText === 'Expired' ? 'Expired' : expText + ' remaining'));
              }
            }
          }
        }
        tooltip.textContent = tooltipParts.join(' \u2022 ');

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(badge);
        card.appendChild(tooltip);


        if (selectable) {
          card.addEventListener('click', function () {
            handleSourceClick(card, appId, src.id);
          });
        }


        body.appendChild(card);
      });

      if (unavailableSources && unavailableSources.length) {
        var blockedHeader = document.createElement('div');
        blockedHeader.setAttribute('style',
          'font-size:11px;color:var(--luma-ssh-text-muted,#8f98a0);font-weight:600;text-transform:uppercase;' +
          'letter-spacing:.5px;margin-top:14px;margin-bottom:6px;padding-left:2px;'
        );
        blockedHeader.textContent = 'Unavailable Sources';
        body.appendChild(blockedHeader);

        unavailableSources.forEach(function (src) {
          body.appendChild(buildBlockedCard(src));
        });
      }

      // Output type selection
      // var outputWrap = document.createElement('div');
      // outputWrap.setAttribute('style', 'margin-top:12px;padding:10px 14px;background:var(--luma-ssh-bg-card,rgba(255,255,255,.03));border:1px solid var(--luma-ssh-border-strong,rgba(255,255,255,.06));border-radius:6px;');
      // var outputLabel = document.createElement('div');
      // outputLabel.setAttribute('style', 'font-size:12px;color:var(--luma-ssh-text-muted,#8f98a0);margin-bottom:6px;font-weight:600;');
      // outputLabel.textContent = 'Output type:';
      // outputWrap.appendChild(outputLabel);


      // var outputTypes = [
      //   { value: 'lua+manifest', label: 'Lua + Manifest' },
      //   { value: 'lua', label: 'Lua only' },
      //   { value: 'manifest', label: 'Manifest only' },
      // ];

      // var outputGroup = document.createElement('div');
      // outputGroup.setAttribute('style', 'display:flex;gap:12px;');
      // outputTypes.forEach(function (opt, idx) {
      //   var lbl = document.createElement('label');
      //   lbl.setAttribute('style', 'display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--luma-ssh-text,#c7d5e0);cursor:pointer;');
      //   var radio = document.createElement('input');
      //   radio.type = 'radio';
      //   radio.name = 'luma-output-type';
      //   radio.value = opt.value;
      //   if (idx === 0) radio.checked = true;
      //   radio.setAttribute('style', 'margin:0;');
      //   lbl.appendChild(radio);
      //   lbl.appendChild(document.createTextNode(opt.label));
      //   outputGroup.appendChild(lbl);
      // });
      // outputWrap.appendChild(outputGroup);
      // body.appendChild(outputWrap);
      try { logModalHorizontalOverflow(); } catch (_) { }
    } catch (e) { console.error('[CEF_INJECT_ERROR] renderSources:', e); }
  }

  // ---------------------------------------------------------------------------
  // Modal: source click -> download with state machine
  // ---------------------------------------------------------------------------
  function handleSourceClick(card, appId, sourceId) {
    try {
      if (card.getAttribute('data-pending') === 'true') return;
      card.setAttribute('data-pending', 'true');
      card.setAttribute('style', 'opacity:.5;cursor:wait;pointer-events:none;');

      var badge = getModalBadge(card);
      if (badge) {
        badge.setAttribute('style', ST.badgeAvail);
        badge.innerHTML = dot('blue') + '<span>ADDING\u2026</span>';
      }

      setButtonState(appId, ST.btn + 'opacity:.7;pointer-events:none;', svgSpinner() + '<span>ADDING\u2026</span>', true);
      setButtonLumaState(appId, 'adding');

      var selectedOutputType = 'lua+manifest';
      var outputRadio = document.querySelector('input[name="luma-output-type"]:checked');
      if (outputRadio) selectedOutputType = outputRadio.value;

      var payload = JSON.stringify({ appId: appId, sourceId: sourceId, outputType: selectedOutputType });
      bridgeFetch(downloadUrl(), {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }, 'download')
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.message) || 'Download rejected');
          console.log('[LUMA_INJECT] Download accepted for', appId, 'via', sourceId, 'requestId:', d.requestId);

          state.requestContext = {
            requestId: d.requestId,
            appId: appId,
            sourceId: sourceId,
          };

          if (badge) {
            badge.setAttribute('style', ST.badgeAvail);
            badge.innerHTML = dot('blue') + '<span>Queued</span>';
          }

          showDownloadProgress(appId, d.requestId);
          startDownloadPoll(d.requestId, appId);
        })
        .catch(function (err) {
          console.error('[LUMA_BRIDGE] download — Error:', err.message || err);
          card.setAttribute('data-pending', 'false');
          card.removeAttribute('style');
          if (badge) {
            badge.setAttribute('style', ST.badgeUnavail);
            badge.innerHTML = dot('red') + '<span>FAILED \u2014 RETRY</span>';
          }
          setButtonState(appId, ST.btn, svgDownload() + '<span>TRY AGAIN</span>', false);
          setButtonLumaState(appId, 'ready');
          setTimeout(function () {
            setButtonState(appId, ST.btn, svgDownload() + '<span>ADD VIA LUMAFORGE</span>', false);
          }, 3000);
        });
    } catch (e) { console.error('[CEF_INJECT_ERROR] handleSourceClick:', e); }
  }

  // ---------------------------------------------------------------------------
  // Download progress: show progress state in modal
  // ---------------------------------------------------------------------------
  function showDownloadProgress(appId, requestId) {
    try {
      var body = getModalBody();
      if (!body) return;

      body.innerHTML =
        '<div style="' + ST.progressWrap + '">' +
        '<div style="margin-bottom:14px;">' + svgSpinner() + '</div>' +
        '<div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:6px;">Downloading\u2026</div>' +
        '<div style="' + ST.progressLabel + '"><span style="font-family:monospace;font-size:10px;opacity:.7;" title="' + (requestId || '') + '">' + (requestId || '').slice(0, 16) + '\u2026</span></div>' +
        '<div style="' + ST.progressBar + '"><div id="luma-progress-fill" style="' + ST.progressFill + '"></div></div>' +
        '<div id="luma-progress-status" style="font-size:12px;color:#66c0ff;">Queued</div>' +
        '</div>';
      try { logModalHorizontalOverflow(); } catch (_) { }
    } catch (_) { }
  }

  function updateProgressUI(job) {
    try {
      var fill = document.getElementById('luma-progress-fill');
      var status = document.getElementById('luma-progress-status');
      if (fill) {
        var pct = job.progress;
        if (!pct && pct !== 0) {
          if (job.status === 'completed') pct = 100;
          else if (job.status === 'processing') pct = 90;
          else if (job.status === 'extracting') pct = 75;
          else if (job.status === 'downloading') pct = 50;
          else if (job.status === 'checking_availability') pct = 20;
          else if (job.status === 'validating') pct = 5;
          else if (job.status === 'queued') pct = 0;
          else pct = 10;
        }
        fill.style.width = pct + '%';
      }
      if (status) {
        var msg = job.message || job.status || 'Working\u2026';
        status.textContent = msg;
      }
    } catch (_) { }
  }

  // ---------------------------------------------------------------------------
  // Download poll: poll GET /api/download-status/{requestId}
  // ---------------------------------------------------------------------------
  function startDownloadPoll(requestId, appId) {
    stopDownloadPoll();
    state.downloadPollSeq++;
    var seq = state.downloadPollSeq;

    function poll() {
      if (!state.requestContext || state.requestContext.requestId !== requestId) return;
      if (!state.activated || state.currentAppId !== appId) return;

      console.log('[LUMA_INJECT] Polling download status for requestId:', requestId);

      fetch(downloadStatusUrl(requestId), {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
      })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          if (state.downloadPollSeq !== seq) return;
          if (!d || !d.ok) throw new Error((d && d.message) || 'Invalid response');

          console.log('[LUMA_INJECT] Download status:', d.status, 'for requestId:', requestId);
          updateProgressUI(d);

          if (d.status === 'completed') {
            state.requestContext = null;
            showDownloadSuccess(appId, requestId);
            return;
          }
          if (d.status === 'failed') {
            state.requestContext = null;
            showDownloadError(appId, d.message || 'Download failed', d.errorCode);
            return;
          }

          state.downloadPollTimer = setTimeout(poll, 1500);
        })
        .catch(function (err) {
          if (state.downloadPollSeq !== seq) return;
          console.error('[LUMA_INJECT] Poll error:', err.message || err);
          state.downloadPollTimer = setTimeout(poll, 2500);
        });
    }

    state.downloadPollTimer = setTimeout(poll, 800);
  }

  function stopDownloadPoll() {
    state.downloadPollSeq++;
    if (state.downloadPollTimer) {
      clearTimeout(state.downloadPollTimer);
      state.downloadPollTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Depot download modal (Linux only)
  // ---------------------------------------------------------------------------
  function openDepotModal(appId) {
    try {
      closeModal();

      state.savedFocusElement = document.activeElement;
      state.depotModalState = { appId: appId, depots: [], selected: {}, outputDir: '', downloading: false, jobId: null };

      var backdrop = document.createElement('div');
      backdrop.setAttribute(MODAL_MARKER_ATTR, MODAL_MARKER_VAL);
      backdrop.setAttribute('class', 'luma-ssh-modal-backdrop');
      backdrop.setAttribute('style', ST.backdrop);

      var panel = document.createElement('div');
      panel.setAttribute('class', 'luma-ssh-modal-panel');
      panel.setAttribute('style', ST.panel + 'width:min(560px,calc(100vw - 32px));');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.addEventListener('click', function (e) { e.stopPropagation(); });

      var titleId = 'luma-depot-title-' + appId;
      var descId = 'luma-depot-desc-' + appId;
      panel.setAttribute('aria-labelledby', titleId);
      panel.setAttribute('aria-describedby', descId);

      // Header
      var header = document.createElement('div');
      header.setAttribute('style', ST.header);
      var hdrIcon = document.createElement('span');
      hdrIcon.setAttribute('style', ST.headerIcon);
      hdrIcon.innerHTML = svgBox();
      var hdrTextWrap = document.createElement('div');
      hdrTextWrap.setAttribute('style', 'min-width:0;flex:1;');
      var hdrTitle = document.createElement('div');
      hdrTitle.id = titleId;
      hdrTitle.setAttribute('style', ST.headerTitle);
      hdrTitle.textContent = 'Download Content';
      var hdrSubtitle = document.createElement('div');
      hdrSubtitle.id = descId;
      hdrSubtitle.setAttribute('style', ST.headerSubtitle);
      hdrSubtitle.textContent = 'Select depots to download game content';
      hdrTextWrap.appendChild(hdrTitle);
      hdrTextWrap.appendChild(hdrSubtitle);

      var hdrVersion = document.createElement('span');
      hdrVersion.setAttribute('style', ST.headerVersion);
      var verParts = (LUMA_INJECT_VERSION || '').split('-');
      hdrVersion.textContent = 'v' + (verParts[0] || LUMA_INJECT_VERSION);

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('class', 'luma-ssh-close-btn');
      closeBtn.setAttribute('style', ST.closeBtn);
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML = svgX();
      closeBtn.addEventListener('click', function () {
        if (state.depotModalState && state.depotModalState.downloading) return;
        state.depotModalState = null;
        closeModal();
      });

      var headerRight = document.createElement('div');
      headerRight.setAttribute('style', 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;');
      headerRight.appendChild(hdrVersion);
      headerRight.appendChild(closeBtn);

      header.appendChild(hdrIcon);
      header.appendChild(hdrTextWrap);
      header.appendChild(headerRight);

      // Body (loading state)
      var body = document.createElement('div');
      body.setAttribute('class', 'luma-ssh-modal-body');
      body.setAttribute('data-lumaforge-modal-body', 'true');
      body.setAttribute('style', ST.body);
      body.innerHTML =
        '<div style="' + ST.loading + '">' +
        svgSpinner() +
        '<span style="' + ST.loadingText + '">Resolving depots\u2026</span>' +
        '</div>';

      // Footer
      var footer = document.createElement('div');
      footer.setAttribute('style', ST.footer);
      var footerNote = document.createElement('span');
      footerNote.setAttribute('style', ST.footerNote);
      footerNote.textContent = 'Content is downloaded through DepotDownloaderMod';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.setAttribute('style', ST.cancelBtn);
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function () {
        if (state.depotModalState && state.depotModalState.downloading) return;
        state.depotModalState = null;
        closeModal();
      });
      footer.appendChild(footerNote);
      footer.appendChild(cancelBtn);

      panel.appendChild(header);
      panel.appendChild(body);
      panel.appendChild(footer);
      backdrop.appendChild(panel);

      (document.body || document.documentElement).appendChild(backdrop);
      try { closeBtn.focus(); } catch (_) { }
      try { logModalHorizontalOverflow(); } catch (_) { }

      // Fetch depots
      fetchDepotsForModal(appId);
    } catch (_) { }
  }

  function fetchDepotsForModal(appId) {
    fetch(depotsUrl(appId), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || 'HTTP ' + r.status); });
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.message) || 'Failed to resolve depots');
        if (!state.depotModalState || state.depotModalState.appId !== appId) return;

        state.depotModalState.depots = d.depots || [];
        state.depotModalState.gameName = d.gameName || 'Unknown';
        state.depotModalState.outputDir = d.outputDir || '';

        // Pre-select depots with manifests (base game)
        var selected = {};
        (d.depots || []).forEach(function (depot) {
          if (depot.manifestId && depot.manifestId.length > 0 && depot.hasKey !== false) {
            selected[depot.depotId] = true;
          }
        });
        state.depotModalState.selected = selected;

        renderDepotList(appId);
      })
      .catch(function (err) {
        if (!state.depotModalState || state.depotModalState.appId !== appId) return;
        var body = getModalBody();
        if (!body) return;

        var isNotInstalled = err.message && err.message.indexOf('not installed') !== -1;
        var isNoKeys = err.message && err.message.indexOf('No depot keys') !== -1;

        body.innerHTML =
          '<div style="' + ST.errorWrap + '">' +
          '<div style="' + ST.errorIcon + '">' + svgErrorCircle() + '</div>' +
          '<div style="' + ST.errorTitle + '">' + (isNotInstalled ? 'DepotDownloaderMod Not Installed' : isNoKeys ? 'No Depot Keys Found' : 'Failed to Resolve Depots') + '</div>' +
          '<div style="' + ST.errorMsgNew + '">' + (err.message || 'Unknown error') + '</div>' +
          '<div style="' + ST.errorActions + '">' +
          '<button type="button" id="luma-depot-retry" style="' + ST.retryBtn + '">TRY AGAIN</button>' +
          '</div>' +
          '</div>';

        var retryBtn = document.getElementById('luma-depot-retry');
        if (retryBtn) {
          retryBtn.addEventListener('click', function () {
            fetchDepotsForModal(appId);
          });
        }
      });
  }

  function renderDepotList(appId) {
    var body = getModalBody();
    if (!body) return;
    var ms = state.depotModalState;
    if (!ms) return;

    var depots = ms.depots;
    var selected = ms.selected;

    // Group depots
    var baseDepots = [];
    var dlcDepots = [];
    var sharedDepots = [];
    depots.forEach(function (d) {
      if (d.isShared) sharedDepots.push(d);
      else if (d.dlcAppId) dlcDepots.push(d);
      else baseDepots.push(d);
    });

    var totalSelected = 0;
    var totalSize = 0;
    Object.keys(selected).forEach(function (id) {
      if (selected[id]) {
        totalSelected++;
        var depot = depots.find(function (d) { return d.depotId === parseInt(id); });
        if (depot) totalSize += depot.size || 0;
      }
    });

    var html = '';

    function renderGroup(title, groupDepots, groupKey) {
      if (groupDepots.length === 0) return '';
      var groupSelected = groupDepots.filter(function (d) { return selected[d.depotId]; }).length;
      var groupSize = groupDepots.reduce(function (sum, d) { return sum + (selected[d.depotId] ? (d.size || 0) : 0); }, 0);

      var s = '<div class="luma-depot-group">';
      s += '<div style="' + ST.depotGroupHeader + '">';
      s += '<span>' + title + ' (' + groupSelected + '/' + groupDepots.length + ')' + '</span>';
      s += '<button type="button" class="luma-depot-group-toggle" data-group="' + groupKey + '">Select All</button>';
      s += '</div>';

      groupDepots.forEach(function (depot) {
        var hasManifest = depot.manifestId && depot.manifestId.length > 0;
        var hasKey = depot.key && depot.key.length > 0;
        var canDownload = hasManifest && hasKey;
        var isSelected = !!selected[depot.depotId];
        var cardClass = 'luma-depot-card';
        if (!canDownload) cardClass += ' disabled';
        if (isSelected && canDownload) cardClass += ' selected';

        var sizeStr = formatBytes(depot.size || 0);
        var osStr = depot.os ? formatOs(depot.os) : '';
        var langStr = depot.language || '';

        s += '<div class="' + cardClass + '" data-depot-id="' + depot.depotId + '">';
        s += '<input type="checkbox"' + (isSelected ? ' checked' : '') + (canDownload ? '' : ' disabled') + '>';
        s += '<div style="' + ST.depotInfo + '">';
        s += '<div style="' + ST.depotName + '">' + escapeHtml(depot.name || 'Depot ' + depot.depotId) + '</div>';
        var detailParts = [];
        if (depot.dlcAppId) detailParts.push('DLC ' + depot.dlcAppId);
        if (!hasManifest) detailParts.push('No manifest');
        if (!hasKey) detailParts.push('No key');
        if (detailParts.length > 0) {
          s += '<div style="' + ST.depotDetail + '">' + escapeHtml(detailParts.join(' \u00b7 ')) + '</div>';
        }
        s += '</div>';
        s += '<div style="' + ST.depotMeta + '">';
        s += '<span style="' + ST.depotSize + '">' + sizeStr + '</span>';
        if (osStr) s += '<span style="' + ST.depotOs + '">' + osStr + '</span>';
        s += '</div>';
        s += '</div>';
      });
      s += '</div>';
      return s;
    }

    html += renderGroup('Base Game', baseDepots, 'base');
    html += renderGroup('DLC', dlcDepots, 'dlc');
    html += renderGroup('Shared', sharedDepots, 'shared');

    // Total bar
    html += '<div style="' + ST.depotTotal + '">';
    html += '<span><strong>' + totalSelected + '</strong> depot' + (totalSelected !== 1 ? 's' : '') + ' selected \u00b7 <strong>' + formatBytes(totalSize) + '</strong></span>';
    html += '<button type="button" id="luma-depot-start" style="' + ST.primaryBtn + (totalSelected === 0 ? 'opacity:.5;pointer-events:none;' : '') + '">' + svgDownload() + '<span>START DOWNLOAD</span></button>';
    html += '</div>';

    body.innerHTML = html;

    // Event listeners for depot cards
    body.querySelectorAll('.luma-depot-card:not(.disabled)').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.tagName === 'INPUT') return;
        var checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          var depotId = parseInt(card.getAttribute('data-depot-id'));
          selected[depotId] = checkbox.checked;
          renderDepotList(appId);
        }
      });
    });

    // Checkbox change events
    body.querySelectorAll('.luma-depot-card:not(.disabled) input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var card = cb.closest('.luma-depot-card');
        if (card) {
          var depotId = parseInt(card.getAttribute('data-depot-id'));
          selected[depotId] = cb.checked;
          renderDepotList(appId);
        }
      });
    });

    // Select All toggles
    body.querySelectorAll('.luma-depot-group-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var groupKey = btn.getAttribute('data-group');
        var groupDepots = groupKey === 'base' ? baseDepots : groupKey === 'dlc' ? dlcDepots : sharedDepots;
        var allSelected = groupDepots.every(function (d) { return selected[d.depotId] && d.manifestId && d.key; });
        groupDepots.forEach(function (d) {
          if (d.manifestId && d.key) {
            selected[d.depotId] = !allSelected;
          }
        });
        renderDepotList(appId);
      });
    });

    // Start download button
    var startBtn = document.getElementById('luma-depot-start');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        startDepotDownload(appId);
      });
    }
  }

  function startDepotDownload(appId) {
    var ms = state.depotModalState;
    if (!ms || ms.downloading) return;

    var selectedDepots = ms.depots.filter(function (d) { return ms.selected[d.depotId]; });
    if (selectedDepots.length === 0) return;

    ms.downloading = true;

    var payload = JSON.stringify({
      appId: String(appId),
      gameName: ms.gameName || 'Unknown',
      outputDir: ms.outputDir || '',
      depots: selectedDepots.map(function (d) {
        return {
          depotId: d.depotId,
          manifestId: d.manifestId || '',
          manifestPath: d.manifestPath || null,
          size: d.size || 0,
        };
      }),
    });

    fetch(depotDownloadUrl(), {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || 'HTTP ' + r.status); });
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.message) || 'Failed to start download');
        ms.jobId = d.jobId;
        showDepotProgress(appId, d.jobId);
        startDepotDownloadPoll(d.jobId, appId);
      })
      .catch(function (err) {
        ms.downloading = false;
        var body = getModalBody();
        if (!body) return;
        body.innerHTML =
          '<div style="' + ST.errorWrap + '">' +
          '<div style="' + ST.errorIcon + '">' + svgErrorCircle() + '</div>' +
          '<div style="' + ST.errorTitle + '">Download Failed to Start</div>' +
          '<div style="' + ST.errorMsgNew + '">' + (err.message || 'Unknown error') + '</div>' +
          '<div style="' + ST.errorActions + '">' +
          '<button type="button" id="luma-depot-retry" style="' + ST.retryBtn + '">TRY AGAIN</button>' +
          '<button type="button" id="luma-depot-close" style="' + ST.cancelBtn + '">CLOSE</button>' +
          '</div>' +
          '</div>';

        var retryBtn = document.getElementById('luma-depot-retry');
        if (retryBtn) {
          retryBtn.addEventListener('click', function () {
            ms.downloading = false;
            startDepotDownload(appId);
          });
        }
        var closeBtnEl = document.getElementById('luma-depot-close');
        if (closeBtnEl) {
          closeBtnEl.addEventListener('click', function () {
            state.depotModalState = null;
            closeModal();
          });
        }
      });
  }

  var restartSteamBtnEl = null;

  function restartSteam(appId) {
    fetch(restartSteamUrl(), { method: 'POST', mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (res.ok && res.data && res.data.ok) {
          console.log('[LUMA_INJECT] Steam restarted successfully');
          if (restartSteamBtnEl) {
            restartSteamBtnEl.innerHTML = svgCheck() + '<span>RESTARTED</span>';
            restartSteamBtnEl.disabled = true;
          }
        } else {
          console.error('[LUMA_INJECT] Steam restart failed:', res.data && res.data.message);
          if (restartSteamBtnEl) {
            restartSteamBtnEl.innerHTML = svgRefresh() + '<span>RESTART STEAM</span>';
            restartSteamBtnEl.disabled = false;
          }
        }
      })
      .catch(function (err) {
        console.error('[LUMA_INJECT] Steam restart error:', err);
        if (restartSteamBtnEl) {
          restartSteamBtnEl.innerHTML = svgRefresh() + '<span>RESTART STEAM</span>';
          restartSteamBtnEl.disabled = false;
        }
      });
  }

  function showDepotProgress(appId, jobId) {
    var body = getModalBody();
    if (!body) return;

    body.innerHTML =
      '<div style="' + ST.depotProgressWrap + '">' +
      '<div style="margin-bottom:14px;">' + svgSpinner() + '</div>' +
      '<div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:6px;">Downloading Content\u2026</div>' +
      '<div id="luma-depot-progress-msg" style="' + ST.depotProgressLabel + '">Starting download...</div>' +
      '<div style="' + ST.depotProgressBar + '"><div id="luma-depot-progress-fill" style="' + ST.depotProgressFill + '"></div></div>' +
      '<div id="luma-depot-progress-detail" style="font-size:11px;color:#66c0ff;"></div>' +
      '</div>';
  }

  var _depotPollSeq = 0;
  function startDepotDownloadPoll(jobId, appId) {
    _depotPollSeq++;
    var seq = _depotPollSeq;

    function poll() {
      if (seq !== _depotPollSeq) return;
      var ms = state.depotModalState;
      if (!ms || ms.jobId !== jobId) return;

      fetch(depotDownloadStatusUrl(jobId), { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          if (seq !== _depotPollSeq) return;
          if (!d || !d.ok) throw new Error((d && d.message) || 'Invalid response');

          updateDepotProgressUI(d);

          if (d.status === 'completed') {
            showDepotDownloadSuccess(appId);
            return;
          }
          if (d.status === 'failed') {
            showDepotDownloadError(d.error || 'Download failed');
            return;
          }
          // Continue polling for 'integrating' status (post-download Steam integration)
          if (d.status === 'integrating') {
            setTimeout(poll, 1500);
            return;
          }

          setTimeout(poll, 1000);
        })
        .catch(function () {
          if (seq !== _depotPollSeq) return;
          setTimeout(poll, 2000);
        });
    }

    setTimeout(poll, 1000);
  }

  function updateDepotProgressUI(d) {
    try {
      var fill = document.getElementById('luma-depot-progress-fill');
      var msg = document.getElementById('luma-depot-progress-msg');
      var detail = document.getElementById('luma-depot-progress-detail');

      if (fill) {
        fill.style.width = (d.progress || 0) + '%';
      }
      if (msg) {
        if (d.status === 'integrating') {
          msg.textContent = 'Integrating with Steam\u2026';
          if (fill) fill.style.width = '100%';
        } else {
          var phase = d.phase || 'downloading';
          var phaseLabel = phase === 'validating' ? 'Validating' : phase === 'extracting' ? 'Extracting' : 'Downloading';
          msg.textContent = phaseLabel + ' \u2014 ' + (d.progress || 0).toFixed(1) + '%';
        }
      }
      if (detail) {
        var parts = [];
        if (d.status === 'integrating') {
          parts.push('Registering game in Steam library');
        } else {
          if (d.bytesRead && d.totalBytes) {
            parts.push(formatBytes(d.bytesRead) + ' / ' + formatBytes(d.totalBytes));
          }
          if (d.speedBytesPerSec) {
            parts.push(formatBytes(d.speedBytesPerSec) + '/s');
          }
        }
        if (d.message) {
          parts.push(d.message);
        }
        detail.textContent = parts.join(' \u00b7 ');
      }
    } catch (_) { }
  }

  function showDepotDownloadSuccess(appId) {
    state.depotModalState = null;
    var body = getModalBody();
    if (!body) return;

    var restartBtn = IS_LINUX
      ? '<button type="button" id="luma-depot-restart-steam" style="' + ST.primaryBtn + '">' + svgRefresh() + '<span>RESTART STEAM</span></button>'
      : '';

    body.innerHTML =
      '<div style="' + ST.successWrap + '">' +
      '<div style="' + ST.successIcon + '">' + svgCheck(26, 26) + '</div>' +
      '<div style="' + ST.successTitle + '">Content Downloaded</div>' +
      '<div style="' + ST.successDetail + '">Game content has been downloaded and registered in Steam.</div>' +
      '<div style="' + ST.successActions + '" class="luma-ssh-success-actions">' +
      restartBtn +
      '<button type="button" id="luma-depot-open-library" style="' + (IS_LINUX ? ST.secondaryBtn : ST.primaryBtn) + '">' + svgLibrary() + '<span>VIEW IN LIBRARY</span></button>' +
      '<button type="button" id="luma-depot-close" style="' + ST.secondaryBtn + '">CLOSE</button>' +
      '</div>' +
      '</div>';

    var restartBtnEl = document.getElementById('luma-depot-restart-steam');
    if (restartBtnEl) {
      restartBtnEl.addEventListener('click', function () {
        restartSteamBtnEl = restartBtnEl;
        restartBtnEl.disabled = true;
        restartBtnEl.innerHTML = svgSpinner() + '<span>RESTARTING...</span>';
        restartSteam(appId);
      });
    }
    var openLibBtn = document.getElementById('luma-depot-open-library');
    if (openLibBtn) {
      openLibBtn.addEventListener('click', function () {
        fetch(openLibraryUrl(appId), { method: 'POST', mode: 'cors', cache: 'no-store' }).catch(function () { });
        closeModal();
      });
    }
    var closeBtnEl = document.getElementById('luma-depot-close');
    if (closeBtnEl) {
      closeBtnEl.addEventListener('click', function () {
        closeModal();
      });
    }
  }

  function showDepotDownloadError(message) {
    if (state.depotModalState) state.depotModalState.downloading = false;
    var body = getModalBody();
    if (!body) return;

    body.innerHTML =
      '<div style="' + ST.errorWrap + '">' +
      '<div style="' + ST.errorIcon + '">' + svgErrorCircle() + '</div>' +
      '<div style="' + ST.errorTitle + '">Download Failed</div>' +
      '<div style="' + ST.errorMsgNew + '">' + escapeHtml(message) + '</div>' +
      '<div style="' + ST.errorActions + '">' +
      '<button type="button" id="luma-depot-retry" style="' + ST.retryBtn + '">TRY AGAIN</button>' +
      '<button type="button" id="luma-depot-close" style="' + ST.cancelBtn + '">CLOSE</button>' +
      '</div>' +
      '</div>';

    var retryBtn = document.getElementById('luma-depot-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        if (state.depotModalState) {
          state.depotModalState.downloading = false;
          renderDepotList(state.depotModalState.appId);
        }
      });
    }
    var closeBtnEl = document.getElementById('luma-depot-close');
    if (closeBtnEl) {
      closeBtnEl.addEventListener('click', function () {
        state.depotModalState = null;
        closeModal();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Utility: format bytes
  // ---------------------------------------------------------------------------
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    i = Math.min(i, units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function formatOs(os) {
    if (!os) return '';
    var lower = os.toLowerCase();
    if (lower.indexOf('linux') !== -1) return '\uD83D\uDC27 Linux';
    if (lower.indexOf('windows') !== -1) return '\uD83D\uDDE1\uFE0F Windows';
    if (lower.indexOf('mac') !== -1 || lower.indexOf('osx') !== -1) return '\uD83C\uDF4E macOS';
    return os;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Download success: show success state in modal
  // ---------------------------------------------------------------------------
  function showDownloadSuccess(appId, requestId) {
    try {
      var body = getModalBody();
      if (!body) return;

      setButtonState(appId, ST.btnSuccess, svgCheck() + '<span>ADDED TO LUMAFORGE</span>', false);
      setButtonLumaState(appId, 'added');

      var depotBtn = IS_LINUX
        ? '<button type="button" id="luma-btn-depot-download" style="' + ST.primaryBtn + '">' + svgBox() + '<span>DOWNLOAD CONTENT</span></button>'
        : '';
      var libraryBtnStyle = IS_LINUX ? ST.secondaryBtn : ST.primaryBtn;

      body.innerHTML =
        '<div style="' + ST.successWrap + '">' +
        '<div style="' + ST.successIcon + '">' + svgCheck(26, 26) + '</div>' +
        '<div style="' + ST.successTitle + '">Package Added Successfully</div>' +
        '<div style="' + ST.successDetail + '">The package has been downloaded and installed to your Steam library.</div>' +
        '<div style="' + ST.successActions + '" class="luma-ssh-success-actions">' +
        depotBtn +
        '<button type="button" id="luma-btn-open-library" style="' + libraryBtnStyle + '">' + svgLibrary() + '<span>VIEW IN LIBRARY</span></button>' +
        '<button type="button" id="luma-btn-continue" style="' + ST.secondaryBtn + '">CONTINUE BROWSING</button>' +
        '</div>' +
        '</div>';

      var depotDlBtn = document.getElementById('luma-btn-depot-download');
      if (depotDlBtn) {
        depotDlBtn.addEventListener('click', function () {
          closeModal();
          openDepotModal(appId);
        });
      }

      var openLibBtn = document.getElementById('luma-btn-open-library');
      if (openLibBtn) {
        openLibBtn.addEventListener('click', function () {
          fetch(openLibraryUrl(appId), { method: 'POST', mode: 'cors', cache: 'no-store' })
            .catch(function () { });
          closeModal();
        });
      }

      var continueBtn = document.getElementById('luma-btn-continue');
      if (continueBtn) {
        continueBtn.addEventListener('click', function () {
          closeModal();
        });
      }
      try { logModalHorizontalOverflow(); } catch (_) { }
    } catch (_) { }
  }

  // ---------------------------------------------------------------------------
  // Download error: show error state in modal
  // ---------------------------------------------------------------------------
  function showDownloadError(appId, message, errorCode) {
    try {
      var body = getModalBody();
      if (!body) return;

      setButtonState(appId, ST.btn, svgDownload() + '<span>TRY AGAIN</span>', false);
      setButtonLumaState(appId, 'ready');
      setTimeout(function () {
        setButtonState(appId, ST.btn, svgDownload() + '<span>ADD VIA LUMAFORGE</span>', false);
      }, 4000);

      var detail = errorCode ? (errorCode + ': ' + message) : message;
      body.innerHTML =
        '<div style="' + ST.errorWrap + '">' +
        '<div style="' + ST.errorIcon + '">' + svgErrorCircle() + '</div>' +
        '<div style="' + ST.errorTitle + '">Download Failed</div>' +
        '<div style="' + ST.errorMsgNew + '">' + detail + '</div>' +
        '<div style="' + ST.errorActions + '" class="luma-ssh-error-actions">' +
        '<button type="button" id="luma-btn-retry-download" style="' + ST.primaryBtn + '">' + svgDownload() + '<span>TRY AGAIN</span></button>' +
        '<button type="button" id="luma-btn-close-error" style="' + ST.secondaryBtn + '">CLOSE</button>' +
        '</div>' +
        '</div>';

      var retryBtn = document.getElementById('luma-btn-retry-download');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          openSourceModal(appId);
        });
      }

      var closeBtn = document.getElementById('luma-btn-close-error');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          closeModal();
        });
      }
      try { logModalHorizontalOverflow(); } catch (_) { }
    } catch (_) { }
  }

  // ---------------------------------------------------------------------------
  // Reconcile: detect URL/AppID changes and update controls
  // ---------------------------------------------------------------------------
  function reconcile() {
    state.reconcileCount++;
    var url = window.location.href;
    var appId = extractAppId();
    var prevUrl = state.currentUrl;
    var prevAppId = state.currentAppId;

    console.log('[LUMA_WATCHER] Reconcile start');
    console.log('[LUMA_WATCHER] Current URL:', url);
    console.log('[LUMA_WATCHER] Previous URL:', prevUrl);
    console.log('[LUMA_WATCHER] Parsed AppID:', appId);
    console.log('[LUMA_WATCHER] Previous AppID:', prevAppId);
    console.log('[LUMA_WATCHER] Document ID:', state.documentId);

    state.currentUrl = url;

    // Check observer root connectivity
    if (state.observer && state.observerRoot) {
      var connected = state.observerRoot.isConnected;
      console.log('[LUMA_WATCHER] Observer root connected:', connected);
      if (!connected) {
        console.log('[LUMA_WATCHER] Reattached observer after root replacement');
        state.observer.disconnect();
        state.observerRoot = getObserverRoot();
        state.observer.observe(state.observerRoot, { childList: true, subtree: true });
      }
    }

    // Not on an app page
    if (!appId) {
      if (prevAppId) {
        console.log('[LUMA_WATCHER] Left app page, removing controls for AppID:', prevAppId);
        abortPendingRequests();
        removeButton();
        closeModal();
        state.currentAppId = null;
        syncNamespaceState();
      }
      return;
    }

    // App ID changed
    if (appId !== prevAppId) {
      console.log(
        '[LUMA_WATCHER] AppID changed:',
        prevAppId,
        '->',
        appId
      );

      abortPendingRequests();
      removeButton();
      closeModal();

      state.currentAppId = appId;
      state.bridgeRecoveryAppId = appId;
      state.bridgeRecoveryCount = 0;

      ensureLumaButtonExists();
      syncNamespaceState();
      return;
    }

    // Same App ID — check if button still exists and its state
    var existingBtn = document.getElementById(BTN_ID);
    if (!existingBtn || existingBtn.getAttribute(BTN_APPID_ATTR) !== appId) {
      console.log('[LUMA_WATCHER] Button missing for same AppID:', appId);
      ensureLumaButtonExists();
      syncNamespaceState();
      return;
    }

    var existingState = existingBtn.getAttribute(BTN_STATE_ATTR);
    console.log('[LUMA_WATCHER] Existing button state:', existingState);

    if (existingState === 'bridge-error' || existingState === 'request-error') {
      if (state.recoveryTimer) {
        console.log('[LUMA_WATCHER] Button in retryable state, recovery already scheduled for AppID:', appId);
      } else {
        console.log('[LUMA_WATCHER] Button in retryable state, scheduling recovery for AppID:', appId);
        scheduleBridgeRecovery(appId);
      }
      syncNamespaceState();
      return;
    }

    syncNamespaceState();
  }

  // ---------------------------------------------------------------------------
  // MutationObserver
  // ---------------------------------------------------------------------------
  function startObserver() {
    try {
      if (state.observer) {
        if (state.observerRoot && !state.observerRoot.isConnected) {
          console.log('[LUMA_WATCHER] Observer root disconnected, reattaching');
          state.observer.disconnect();
          state.observerRoot = getObserverRoot();
          state.observer.observe(state.observerRoot, { childList: true, subtree: true });
          console.log('[LUMA_WATCHER] Reattached observer after root replacement');
        }
        return;
      }
      state.observerRoot = getObserverRoot();
      state.observer = new MutationObserver(function () {
        scheduleReconcile('dom');
      });
      state.observer.observe(state.observerRoot, { childList: true, subtree: true });
      console.log('[LUMA_WATCHER] MutationObserver attached to', state.observerRoot.nodeName);
      console.log('[LUMA_WATCHER] Observer root:', state.observerRoot.nodeName);
    } catch (e) { console.error('[CEF_INJECT_ERROR] startObserver:', e); }
  }

  function stopObserver() {
    try {
      if (state.observer) { state.observer.disconnect(); state.observer = null; state.observerRoot = null; }
    } catch (e) { console.error('[CEF_INJECT_ERROR] stopObserver:', e); }
  }

  function scheduleReconcile(reason) {
    try {
      if (!state.activated || state._rafPending) return;
      state._rafPending = true;
      console.log('[LUMA_WATCHER] DOM reconciliation requested:', reason);
      requestAnimationFrame(function () {
        state._rafPending = false;
        if (!state.activated) return;
        reconcile();
      });
    } catch (e) { console.error('[CEF_INJECT_ERROR] scheduleReconcile:', e); }
  }

  // ---------------------------------------------------------------------------
  // SPA navigation hooks
  // ---------------------------------------------------------------------------
  function patchHistory() {
    try {
      if (state.historyPatched) return;
      state.origPushState = History.prototype.pushState;
      state.origReplaceState = History.prototype.replaceState;
      History.prototype.pushState = function () {
        var r = state.origPushState.apply(this, arguments);
        console.log('[LUMA_WATCHER] pushState');
        scheduleReconcile('pushState');
        return r;
      };
      History.prototype.replaceState = function () {
        var r = state.origReplaceState.apply(this, arguments);
        console.log('[LUMA_WATCHER] replaceState');
        scheduleReconcile('replaceState');
        return r;
      };
      state.popstateHandler = function () {
        console.log('[LUMA_WATCHER] popstate');
        scheduleReconcile('popstate');
      };
      state.hashchangeHandler = function () {
        console.log('[LUMA_WATCHER] hashchange');
        scheduleReconcile('hashchange');
      };
      state.pageshowHandler = function () {
        console.log('[LUMA_WATCHER] pageshow');
        scheduleReconcile('pageshow');
      };
      state.pagehideHandler = function () {
        console.log('[LUMA_WATCHER] pagehide');
      };
      state.beforeunloadHandler = function () {
        console.log('[LUMA_WATCHER] beforeunload');
      };
      window.addEventListener('popstate', state.popstateHandler);
      window.addEventListener('hashchange', state.hashchangeHandler);
      window.addEventListener('pageshow', state.pageshowHandler);
      window.addEventListener('pagehide', state.pagehideHandler);
      window.addEventListener('beforeunload', state.beforeunloadHandler);
      state.historyPatched = true;
      console.log('[LUMA_WATCHER] SPA navigation hooks installed');
    } catch (e) { console.error('[CEF_INJECT_ERROR] patchHistory:', e); }
  }

  function restoreHistory() {
    try {
      if (!state.historyPatched) return;
      if (state.origPushState) History.prototype.pushState = state.origPushState;
      if (state.origReplaceState) History.prototype.replaceState = state.origReplaceState;
      if (state.popstateHandler) window.removeEventListener('popstate', state.popstateHandler);
      if (state.hashchangeHandler) window.removeEventListener('hashchange', state.hashchangeHandler);
      if (state.pageshowHandler) window.removeEventListener('pageshow', state.pageshowHandler);
      if (state.pagehideHandler) window.removeEventListener('pagehide', state.pagehideHandler);
      if (state.beforeunloadHandler) window.removeEventListener('beforeunload', state.beforeunloadHandler);
      state.popstateHandler = null;
      state.hashchangeHandler = null;
      state.pageshowHandler = null;
      state.pagehideHandler = null;
      state.beforeunloadHandler = null;
      state.origPushState = null;
      state.origReplaceState = null;
      state.historyPatched = false;
    } catch (e) { console.error('[CEF_INJECT_ERROR] restoreHistory:', e); }
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------
  function teardown() {
    try {
      console.log('[LUMA_WATCHER] Tearing down lifecycle');
      state.activated = false;
      abortPendingRequests();
      cancelAllRetries();
      stopDownloadPoll();
      state.requestContext = null;
      if (state.providerAbortController) {
        state.providerAbortController.abort();
        state.providerAbortController = null;
      }
      state.statusCache = null;
      stopObserver();
      restoreHistory();
      closeModal();
      removeButton();
      state.currentAppId = null;
      state.currentUrl = null;
      syncNamespaceState();
    } catch (e) { console.error('[CEF_INJECT_ERROR] teardown:', e); }
  }

  // ---------------------------------------------------------------------------
  // Activation
  // ---------------------------------------------------------------------------
  function activate() {
    try {
      if (state.activated) {
        console.log('[LUMA_RUNTIME] Already active, scheduling reconcile');
        reconcile();
        return;
      }
      state.activated = true;
      state.currentUrl = location.href;
      state.currentAppId = extractAppId();
      patchHistory();
      setupEventDelegation();
      startObserver();
      ensureLumaButtonExists();
      detectBridgePort();
      syncNamespaceState();
      console.log('[LUMA_RUNTIME] Version:', LUMA_INJECT_VERSION);
      console.log('[LUMA_RUNTIME] Target URL:', window.location.href);
      console.log('[LUMA_RUNTIME] Document ID:', state.documentId);
      console.log('[LUMA_RUNTIME] Lifecycle already existed: false');
      console.log('[LUMA_RUNTIME] Existing lifecycle version: none');
      console.log('[LUMA_RUNTIME] Active:', true);
      console.log('[LUMA_RUNTIME] Current AppID:', state.currentAppId);
      console.log('[LUMA_RUNTIME] Reconcile count:', state.reconcileCount);
      console.log('[LUMA_RUNTIME] Observer active:', !!state.observer);
      console.log('[LUMA_RUNTIME] History wrapped:', state.historyPatched);
    } catch (e) { console.error('[CEF_INJECT_ERROR] activate:', e); }
  }

  // ---------------------------------------------------------------------------
  // Debug overflow diagnostic (disabled by default)
  // ---------------------------------------------------------------------------
  var LUMA_DEBUG_OVERFLOW = false;
  function logModalHorizontalOverflow() {
    if (!LUMA_DEBUG_OVERFLOW) return;
    var modal = document.querySelector(
      '[' + MODAL_MARKER_ATTR + '="' + MODAL_MARKER_VAL + '"]'
    );
    if (!modal) return;
    var panel = modal.querySelector('.luma-ssh-modal-panel');
    var body = modal.querySelector('.luma-ssh-modal-body');
    var footer = modal.querySelector('[style*="border-top"]');
    var all = modal.querySelectorAll('*');
    Array.prototype.forEach.call(all, function (el) {
      if (el.scrollWidth > el.clientWidth + 1) {
        console.warn(
          '[LUMA_MODAL_OVERFLOW]',
          el.tagName,
          el.className || '',
          { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: (el.textContent || '').slice(0, 80) }
        );
      }
    });
    if (panel) console.log('[LUMA_MODAL_OVERFLOW_CHECK] panel:', panel.scrollWidth <= panel.clientWidth + 1, panel.scrollWidth, panel.clientWidth);
    if (body) console.log('[LUMA_MODAL_OVERFLOW_CHECK] body:', body.scrollWidth <= body.clientWidth + 1, body.scrollWidth, body.clientWidth);
  }

  // ---------------------------------------------------------------------------
  // Namespace & Bootstrap
  // ---------------------------------------------------------------------------
  try {
    console.log('[FORENSIC_INJECT] VERSION=' + LUMA_INJECT_VERSION);
    console.log('[FORENSIC_INJECT] PAGE_URL=' + window.location.href);
    console.log('[FORENSIC_INJECT] ORIGIN=' + window.location.origin);
    console.log('[FORENSIC_INJECT] Document ID=' + DOCUMENT_ID);

    var existingLifecycle = !!(window[NAMESPACE] && window[NAMESPACE].activate);
    var existingVersion = (window[NAMESPACE] && window[NAMESPACE].version) || 'none';

    console.log('[FORENSIC_INJECT] Existing lifecycle found: ' + existingLifecycle);
    console.log('[FORENSIC_INJECT] Existing version: ' + existingVersion);

    // Same-version reuse: if same version is already active, just reconcile
    if (window[NAMESPACE] && window[NAMESPACE].version === LUMA_INJECT_VERSION && window[NAMESPACE].active) {
      console.log('[LUMA_RUNTIME] Same-version lifecycle already active, scheduling reconcile');
      if (typeof window[NAMESPACE].scheduleReconcile === 'function') {
        window[NAMESPACE].scheduleReconcile('reinjection');
      }
      return;
    }

    // Different version or no existing lifecycle: deactivate old and create new
    if (window[NAMESPACE]) {
      console.log('[FORENSIC_INJECT] Deactivating previous instance (v' + existingVersion + ')');
      if (typeof window[NAMESPACE].deactivate === 'function') {
        window[NAMESPACE].deactivate();
      }
      console.log('[FORENSIC_INJECT] Previous lifecycle teardown complete');
    }

    window[NAMESPACE] = {
      activate: activate,
      deactivate: function () { teardown(); },
      scheduleReconcile: scheduleReconcile,
      version: LUMA_INJECT_VERSION,
      active: false,
      documentId: DOCUMENT_ID,
      currentUrl: null,
      currentAppId: null,
      reconcileCount: 0,
      observerActive: false,
      historyWrapped: false,
    };

    console.log('[FORENSIC_INJECT] Lifecycle assigned (v' + LUMA_INJECT_VERSION + ')');
  } catch (e) { console.error('[CEF_INJECT_ERROR] namespace:', e); }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    activate();
  } else {
    document.addEventListener('DOMContentLoaded', activate);
  }
})();
