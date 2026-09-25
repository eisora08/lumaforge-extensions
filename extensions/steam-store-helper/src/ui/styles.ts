// ---------------------------------------------------------------------------
// Theme-aware CSS variable system + keyframes + class styles
// ---------------------------------------------------------------------------
export function ensureKeyframes(): void {
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
      '@keyframes luma_ssh_download_pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.15);opacity:.8}}' +
      '@keyframes luma_ssh_download_glow{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,.4),0 0 8px rgba(102,192,255,.3)}50%{box-shadow:0 2px 8px rgba(0,0,0,.4),0 0 16px rgba(102,192,255,.6)}}' +

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

      '.luma-source-card:first-child .luma-source-tooltip{' +
      'bottom:auto;' +
      'top:calc(100% + 8px);' +
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

      // ── Sidebar panel ──
      '.luma-sidebar-tabs .luma-sidebar-tab.active{color:#66c0ff!important;border-bottom-color:#66c0ff!important;}' +
      '.luma-sidebar-tabs .luma-sidebar-tab:hover{color:#c7d5e0!important;background:rgba(255,255,255,.03);}' +
      '.luma-sidebar-content{scrollbar-width:thin;scrollbar-color:rgba(102,192,255,.2) transparent;}' +
      '.luma-sidebar-content::-webkit-scrollbar{width:6px;}' +
      '.luma-sidebar-content::-webkit-scrollbar-track{background:transparent;}' +
      '.luma-sidebar-content::-webkit-scrollbar-thumb{background:rgba(102,192,255,.2);border-radius:3px;}' +
      '.luma-sidebar-section{margin-bottom:20px;}' +
      '.luma-sidebar-section-title{font-size:11px;font-weight:700;color:#8f98a0;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;}' +
      '.luma-stat-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px;display:flex;align-items:center;gap:10px;margin-bottom:8px;}' +
      '.luma-stat-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}' +
      '.luma-stat-icon.blue{background:rgba(102,192,255,.12);color:#66c0ff;}' +
      '.luma-stat-icon.green{background:rgba(46,160,67,.15);color:#64c882;}' +
      '.luma-stat-icon.orange{background:rgba(255,180,0,.12);color:#ffb400;}' +
      '.luma-stat-icon.red{background:rgba(231,76,60,.12);color:#e74c3c;}' +
      '.luma-stat-value{font-size:18px;font-weight:700;color:#fff;line-height:1;}' +
      '.luma-stat-label{font-size:10px;color:#8f98a0;margin-top:2px;}' +
      '.luma-provider-row{display:flex;align-items:center;gap:12px;padding:10px 12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:8px;margin-bottom:8px;transition:background .15s ease;}' +
      '.luma-provider-row:hover{background:rgba(255,255,255,.04);}' +
      '.luma-toggle{width:36px;height:20px;border-radius:10px;background:rgba(255,255,255,.1);border:none;cursor:pointer;position:relative;flex-shrink:0;transition:background .2s ease;}' +
      '.luma-toggle.on{background:#66c0ff;}' +
      '.luma-toggle::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s ease;}' +
      '.luma-toggle.on::after{transform:translateX(16px);}' +
      '.luma-sidebar-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid transparent;transition:all .15s ease;}' +
      '.luma-sidebar-btn.primary{background:linear-gradient(180deg,#2478a8 0%,#17628f 100%);color:#dff4ff;border-color:rgba(102,192,255,.2);}' +
      '.luma-sidebar-btn.primary:hover{background:linear-gradient(180deg,#32a9ed 0%,#1687c5 100%);border-color:rgba(102,192,255,.5);}' +
      '.luma-sidebar-btn.secondary{background:rgba(255,255,255,.05);color:#c7d5e0;border-color:rgba(255,255,255,.1);}' +
      '.luma-sidebar-btn.secondary:hover{background:rgba(255,255,255,.08);}' +
      '.luma-ssh-close-btn:hover{background:rgba(255,255,255,.08)!important;color:#fff!important;}' +
      '.luma-ssh-close-btn:focus-visible{outline:2px solid #66c0ff;outline-offset:2px;}' +
      '#luma-sidebar-panel .luma-sidebar-tabs::-webkit-scrollbar{height:0;width:0;}' +
      '';
    (document.head || document.documentElement).appendChild(s);
  } catch (_) { }
}

// ---------------------------------------------------------------------------
// Inline style constants
// ---------------------------------------------------------------------------
export var ST: Record<string, string> = {
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
  btnInstall: 'display:inline-flex;align-items:center;gap:6px;padding:7px 16px;margin-left:10px;border:1px solid rgba(102,192,255,.4);border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:rgba(102,192,255,.12);color:#66c0ff;vertical-align:middle;position:relative;z-index:1;flex-shrink:0;transition:background .16s ease,border-color .16s ease,box-shadow .16s ease,transform .08s ease;',
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

export function dot(hue: string): string {
  var c = hue === 'green' ? 'var(--luma-ssh-success,#64c882);box-shadow:0 0 6px rgba(46,160,67,.6)' :
    hue === 'blue' ? 'var(--luma-ssh-accent,#66c0ff);box-shadow:0 0 6px rgba(102,192,255,.6)' :
      hue === 'red' ? 'var(--luma-ssh-error,#e74c3c);box-shadow:0 0 6px rgba(231,76,60,.6)' :
        'var(--luma-ssh-text-muted,#8f98a0)';
  return '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + c + ';"></span>';
}
