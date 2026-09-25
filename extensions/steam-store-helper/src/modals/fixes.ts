import { state, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, LUMA_INJECT_VERSION } from '../core/state';
import { svgBox, svgX, svgSpinner, svgErrorCircle, svgCheck, svgGear, svgLock, svgCloudDownload, svgCheckSmall, svgRefresh } from '../ui/svg';
import { ST } from '../ui/styles';
import { fixesInfoUrl, fixesStatusUrl, fixesApplyUrl, fixesUnfixUrl, fixesCatalogUrl, toolInstallUrl, toolsUrl, getModalBody, restartSteamUrl } from '../ui/helpers';
import { escapeHtml } from '../ui/dom';
import { closeModal } from './source';

// ---------------------------------------------------------------------------
// Fixes modal — SmokeAPI / Steamless / Goldberg / Online Fix / Catalog fixes
// ---------------------------------------------------------------------------

var POLL_MS = 1000;
var TOOL_POLL_MS = 1500;
var RESULT_TTL_MS = 6000;

interface FixRowDef {
  key: string;           // job/tool key used by backend
  label: string;
  desc: string;
  appliedKey: string;    // key in status.applied
  toolId: string | null; // thirdparty tool id (null = no install needed)
  installedKey: string | null; // key in status.tools
  icon: () => string;
  available: (info: any, status: any) => boolean;
}

var ROW_DEFS: FixRowDef[] = [
  {
    key: 'smokeapi',
    label: 'SmokeAPI',
    desc: 'SmokeAPI is a tool for Steamworks DLC ownership emulation in games that are legitimately owned in Steam',
    appliedKey: 'smokeApi',
    toolId: 'smokeapi',
    installedKey: 'smokeApiInstalled',
    icon: function () { return svgCheck(14, 14); },
    available: function (info, status) {
      return !!(info && info.installed) && (info.hasSteamApi32 || info.hasSteamApi64 || statusApplied(status, 'smokeApi'));
    },
  },
  {
    key: 'steamless',
    label: 'Steamless',
    desc: 'Removes SteamStub DRM from the game executable. The backend verifies SteamStub on apply and reports if unpacking is not needed.',
    appliedKey: 'steamless',
    toolId: 'steamless',
    installedKey: 'steamlessInstalled',
    icon: function () { return svgLock(); },
    available: function (info) { return !!(info && info.installed); },
  },
  {
    key: 'goldberg',
    label: 'Goldberg Emulator',
    desc: 'Steam emulator (fork): steam_api wrapper, achievements and LAN support.',
    appliedKey: 'goldberg',
    toolId: 'goldberg_fork',
    installedKey: 'goldbergInstalled',
    icon: function () { return svgGear(); },
    available: function (info) { return !!(info && info.installed); },
  },
  {
    key: 'online_fix',
    label: 'Online-Fix',
    desc: 'Online-Fix.net crack for multiplayer/online games (requires a RAR extractor).',
    appliedKey: 'onlineFix',
    toolId: null,
    installedKey: null,
    icon: function () { return svgCloudDownload(); },
    available: function (info, status) {
      return !!(info && info.hasOnlineFix) || statusApplied(status, 'onlineFix');
    },
  },
];

function statusApplied(status: any, key: string): boolean {
  return !!(status && status.applied && status.applied[key]);
}

function toolInstalled(status: any, key: string | null): boolean {
  if (!key) return true;
  return !!(status && status.tools && status.tools[key]);
}

export function openFixesModal(appId: string): void {
  try {
    closeModal();

    state.savedFocusElement = document.activeElement;
    state.fixesModalState = {
      appId: appId,
      info: null,
      status: null,
      catalogEntries: [],
      pending: {},
      results: {},
      toolInstallBusy: null,
      lastJobStatus: {},
      pollSeq: 0,
      pollTimer: null,
    };

    var backdrop = document.createElement('div');
    backdrop.setAttribute(MODAL_MARKER_ATTR, MODAL_MARKER_VAL);
    backdrop.setAttribute('class', 'luma-ssh-modal-backdrop');
    backdrop.setAttribute('style', ST.backdrop);

    var panel = document.createElement('div');
    panel.setAttribute('class', 'luma-ssh-modal-panel');
    panel.setAttribute('style', ST.panel + 'width:min(660px,calc(100vw - 32px));');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    var titleId = 'luma-fixes-title-' + appId;
    var descId = 'luma-fixes-desc-' + appId;
    panel.setAttribute('aria-labelledby', titleId);
    panel.setAttribute('aria-describedby', descId);

    // Header
    var header = document.createElement('div');
    header.setAttribute('style', ST.header);
    var hdrIcon = document.createElement('span');
    hdrIcon.setAttribute('style', ST.headerIcon);
    hdrIcon.innerHTML = svgGear();
    var hdrTextWrap = document.createElement('div');
    hdrTextWrap.setAttribute('style', 'min-width:0;flex:1;');
    var hdrTitle = document.createElement('div');
    hdrTitle.id = titleId;
    hdrTitle.setAttribute('style', ST.headerTitle);
    hdrTitle.textContent = 'Game Fixes';
    var hdrSubtitle = document.createElement('div');
    hdrSubtitle.id = descId;
    hdrSubtitle.setAttribute('style', ST.headerSubtitle);
    hdrSubtitle.textContent = 'App ' + appId;
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
    closeBtn.addEventListener('click', function () { closeFixesModal(); });

    var headerRight = document.createElement('div');
    headerRight.setAttribute('style', 'display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;');
    headerRight.appendChild(closeBtn);
    headerRight.appendChild(hdrVersion);

    header.appendChild(hdrIcon);
    header.appendChild(hdrTextWrap);
    header.appendChild(headerRight);

    // Body (loading)
    var body = document.createElement('div');
    body.setAttribute('class', 'luma-ssh-modal-body');
    body.setAttribute('data-lumaforge-modal-body', 'true');
    body.setAttribute('style', ST.body);
    body.innerHTML =
      '<div style="' + ST.loading + '">' +
      svgSpinner() +
      '<span style="' + ST.loadingText + '">Detecting game fixes\u2026</span>' +
      '</div>';

    // Footer
    var footer = document.createElement('div');
    footer.setAttribute('style', ST.footer);
    var footerNote = document.createElement('span');
    footerNote.setAttribute('style', ST.footerNote);
    footerNote.textContent = 'Fixes back up original files (.bak) and write a fix log';
    var restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.setAttribute('style', ST.cancelBtn);
    restartBtn.textContent = 'Restart Steam';
    restartBtn.addEventListener('click', function () { restartSteamFixes(); });
    var closeFooterBtn = document.createElement('button');
    closeFooterBtn.type = 'button';
    closeFooterBtn.setAttribute('style', ST.cancelBtn);
    closeFooterBtn.textContent = 'Close';
    closeFooterBtn.addEventListener('click', function () { closeFixesModal(); });
    footer.appendChild(footerNote);
    footer.appendChild(restartBtn);
    footer.appendChild(closeFooterBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    backdrop.appendChild(panel);

    (document.body || document.documentElement).appendChild(backdrop);
    try { closeBtn.focus(); } catch (_) { }

    loadFixesData(appId);
  } catch (_) { }
}

export function closeFixesModal(): void {
  var ms = state.fixesModalState;
  if (ms) {
    ms.pollSeq++;
    if (ms.pollTimer) clearTimeout(ms.pollTimer);
  }
  state.fixesModalState = null;
  closeModal();
}

function currentBody(): HTMLElement | null {
  return getModalBody() as HTMLElement | null;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
function loadFixesData(appId: string): void {
  var ms = state.fixesModalState;
  if (!ms || ms.appId !== appId) return;

  Promise.all([
    fetch(fixesInfoUrl(appId), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.json(); }),
    fetch(fixesStatusUrl(appId), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.json(); }),
    fetch(fixesCatalogUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; }),
  ])
    .then(function (res) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId) return;
      var infoResp: any = res[0];
      var statusResp: any = res[1];
      var catalogResp: any = res[2];

      if (!infoResp || !infoResp.ok) throw new Error((infoResp && infoResp.message) || 'Failed to load fix info');
      if (!statusResp || !statusResp.ok) throw new Error((statusResp && statusResp.message) || 'Failed to load fix status');

      m.info = infoResp.info;
      m.status = statusResp;

      // Catalog entries for this appId, type=fix only
      var entries: any[] = [];
      if (catalogResp && catalogResp.ok !== false && Array.isArray(catalogResp.entries)) {
        entries = catalogResp.entries.filter(function (e: any) {
          return String(e.appId) === String(appId) && e.type === 'fix' && e.downloadUrl;
        });
      } else if (catalogResp && catalogResp.ok === false && catalogResp.message) {
        m.results['__catalog'] = { ok: false, message: catalogResp.message, at: Date.now() };
      }
      m.catalogEntries = entries;

      // Seed lastJobStatus so we only show results for NEW completions
      var last: Record<string, string> = {};
      if (statusResp.jobs) {
        Object.keys(statusResp.jobs).forEach(function (k) {
          last[k] = statusResp.jobs[k].status;
        });
      }
      m.lastJobStatus = last;

      renderFixes(appId);
      ensurePolling(appId);
    })
    .catch(function (err) {
      var body = currentBody();
      if (!body) return;
      body.innerHTML =
        '<div style="' + ST.errorWrap + '">' +
        '<div style="' + ST.errorIcon + '">' + svgErrorCircle() + '</div>' +
        '<div style="' + ST.errorTitle + '">Failed to Load Fixes</div>' +
        '<div style="' + ST.errorMsgNew + '">' + escapeHtml(err.message || 'Unknown error') + '</div>' +
        '<div style="' + ST.errorActions + '">' +
        '<button type="button" id="luma-fixes-retry" style="' + ST.retryBtn + '">TRY AGAIN</button>' +
        '</div>' +
        '</div>';
      var retryBtn = document.getElementById('luma-fixes-retry');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          var m = state.fixesModalState;
          if (!m) return;
          var b = currentBody();
          if (b) {
            b.innerHTML =
              '<div style="' + ST.loading + '">' +
              svgSpinner() +
              '<span style="' + ST.loadingText + '">Detecting game fixes\u2026</span>' +
              '</div>';
          }
          loadFixesData(m.appId);
        });
      }
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderFixes(appId: string): void {
  var body = currentBody();
  var ms = state.fixesModalState;
  if (!body || !ms || ms.appId !== appId) return;

  var info = ms.info;
  var status = ms.status;
  if (!info || !status) return;

  var html = '';

  // ── Info chips ──
  var chips: string[] = [];
  if (info.installed) {
    if (info.gameArch) chips.push(escapeHtml(String(info.gameArch).toUpperCase()));
    if (info.mainExe) chips.push(escapeHtml(info.mainExe));
    if (info.hasSteamApi64) chips.push('steam_api64');
    if (info.hasSteamApi32) chips.push('steam_api32');
    if (info.hasSteamStubDrm) chips.push('SteamStub DRM');
    if (info.hasOnlineFix) chips.push('Online-Fix available');
  }
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;align-items:center;">';
  html += '<span style="font-size:13px;font-weight:700;color:#fff;">' + escapeHtml(info.name || 'App ' + appId) + '</span>';
  if (info.installed) {
    chips.forEach(function (c) {
      html += '<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(102,192,255,.12);color:#66c0ff;">' + c + '</span>';
    });
  }
  html += '</div>';

  if (!info.installed) {
    html +=
      '<div style="' + ST.errorWrap + ';margin:8px 0;">' +
      '<div style="' + ST.errorIcon + '">' + svgErrorCircle() + '</div>' +
      '<div style="' + ST.errorTitle + '">Game Not Installed</div>' +
      '<div style="' + ST.errorMsgNew + '">Install the game to apply fixes.</div>' +
      '</div>';
    body.innerHTML = html;
    return;
  }

  // ── Native rows ──
  var rowsShown = 0;
  for (var i = 0; i < ROW_DEFS.length; i++) {
    var def = ROW_DEFS[i];
    if (!def.available(info, status)) continue;
    html += renderRow(appId, def.key, def.label, def.desc, status.applied ? !!status.applied[def.appliedKey] : false,
      def.toolId, def.installedKey, def.icon(), null, ms);
    rowsShown++;
  }

  // ── Catalog rows ──
  for (var ci = 0; ci < ms.catalogEntries.length; ci++) {
    var entry = ms.catalogEntries[ci];
    var fixType = entry.provider === 'rockstar' ? 'RockstarFix' : 'Voices38Fix';
    var catApplied = !!(status.applied && status.applied[fixType]);
    var providerLabel = entry.provider === 'rockstar' ? 'Rockstar Games' : 'Voices38';
    html += renderRow(appId, 'catalog:' + entry.id, escapeHtml(entry.title || fixType),
      'Catalog fix \u00b7 ' + escapeHtml(providerLabel) + (entry.fileSizeHuman ? ' \u00b7 ' + escapeHtml(entry.fileSizeHuman) : ''),
      catApplied, null, null, svgBox(), { downloadUrl: entry.downloadUrl, fixType: fixType }, ms);
    rowsShown++;
  }

  var catalogErr = ms.results['__catalog'];
  if (catalogErr) {
    html += '<div style="font-size:11px;color:#8f98a0;margin-top:4px;">Catalog: ' + escapeHtml(catalogErr.message) + '</div>';
  }

  if (rowsShown === 0) {
    html += '<div style="font-size:12px;color:#8f98a0;padding:12px 0;">No fixes available for this game.</div>';
  }

  body.innerHTML = html;
  wireRowActions(appId);
}

function renderRow(
  appId: string,
  rowKey: string,
  label: string,
  desc: string,
  applied: boolean,
  toolId: string | null,
  installedKey: string | null,
  iconSvg: string,
  catalog: { downloadUrl: string; fixType: string } | null,
  ms: any
): string {
  var status = ms.status;
  var jobKey = catalog ? 'catalog' : rowKey;
  var job = status && status.jobs ? status.jobs[jobKey] : null;
  // For catalog jobs, only treat as belonging to this row if pending for this row
  var isBusy = !!ms.pending[rowKey] || !!(job && job.status === 'running' && ms.pending[rowKey] !== false && rowBusyFor(rowKey, jobKey, ms));
  if (catalog) isBusy = !!ms.pending[rowKey] || !!(job && job.status === 'running' && ms.pending[rowKey]);

  var installed = toolInstalled(status, installedKey);
  var result = ms.results[rowKey] && (Date.now() - ms.results[rowKey].at < RESULT_TTL_MS) ? ms.results[rowKey] : null;

  var s = '<div class="luma-fix-row" data-fix-row="' + escapeHtml(rowKey) + '" style="';
  s += 'display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:10px;margin-bottom:10px;';
  s += 'border:1px solid ' + (applied ? 'rgba(100,200,130,.25)' : 'rgba(255,255,255,.07)') + ';';
  s += 'background:' + (applied ? 'rgba(46,160,67,.06)' : 'rgba(255,255,255,.03)') + ';';
  s += 'position:relative;overflow:hidden;">';

  // icon
  s += '<div style="width:36px;height:36px;border-radius:8px;background:rgba(102,192,255,.08);border:1px solid rgba(102,192,255,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:' + (applied ? '#64c882' : '#66c0ff') + ';">' + iconSvg + '</div>';

  // info
  s += '<div style="flex:1;min-width:0;">';
  s += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
  s += '<span style="font-size:13px;font-weight:700;color:#fff;">' + label + '</span>';
  if (applied) {
    s += '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(46,160,67,.15);color:#64c882;">' + svgCheckSmall() + 'APPLIED</span>';
  }
  if (toolId && !installed) {
    s += '<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(255,180,60,.12);color:#ffb43c;">TOOL NEEDED</span>';
  }
  s += '</div>';
  s += '<div style="font-size:11px;color:#8f98a0;margin-top:3px;line-height:1.4;">' + desc + '</div>';

  // job progress
  if (isBusy && job) {
    var prog = job.progress || 0;
    s += '<div style="margin-top:8px;">';
    s += '<div style="height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;">';
    s += '<div style="height:100%;width:' + prog + '%;background:linear-gradient(to right,#1a9fff,#66c0ff);transition:width .3s ease;"></div>';
    s += '</div>';
    s += '<div style="font-size:10px;color:#66c0ff;margin-top:4px;">' + escapeHtml(job.message || 'Working\u2026') + ' (' + prog + '%)</div>';
    s += '</div>';
  } else if (isBusy) {
    s += '<div style="margin-top:8px;display:flex;align-items:center;gap:6px;font-size:11px;color:#66c0ff;">' + svgSpinner() + '<span>Starting\u2026</span></div>';
  }

  // result flash
  if (result && !isBusy) {
    var rcolor = result.ok ? '#64c882' : '#ff6e6e';
    s += '<div style="margin-top:6px;font-size:11px;color:' + rcolor + ';">' + escapeHtml(result.message) + '</div>';
  }

  s += '</div>'; // info

  // actions
  s += '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;align-items:flex-end;">';
  if (toolId && !installed && !isBusy) {
    s += '<button type="button" class="luma-fix-install" data-tool-id="' + escapeHtml(toolId) + '" data-fix-row="' + escapeHtml(rowKey) + '" style="' + miniBtn('#ffb43c') + '">Install tool</button>';
  } else if (isBusy) {
    s += '<button type="button" disabled style="' + miniBtn('#8f98a0') + ';opacity:.5;cursor:default;">\u2026</button>';
  } else if (applied) {
    s += '<button type="button" class="luma-fix-unfix" data-fix-row="' + escapeHtml(rowKey) + '"' +
      (catalog ? ' data-fix-type="' + escapeHtml(catalog.fixType) + '"' : '') +
      ' style="' + miniBtn('#ff6e6e') + '">Unfix</button>';
  } else {
    s += '<button type="button" class="luma-fix-apply" data-fix-row="' + escapeHtml(rowKey) + '"' +
      (catalog ? ' data-download-url="' + escapeHtml(catalog.downloadUrl) + '" data-fix-type="' + escapeHtml(catalog.fixType) + '"' : '') +
      ' style="' + miniBtn('#64c882') + '"' + (toolId && !installed ? ' disabled style="' + miniBtn('#8f98a0') + ';opacity:.5;"' : '') + '>Apply</button>';
  }
  s += '</div>';

  s += '</div>'; // row
  return s;
}

function rowBusyFor(rowKey: string, jobKey: string, ms: any): boolean {
  // pending flag set by apply click is authoritative
  return !!ms.pending[rowKey];
}

function miniBtn(color: string): string {
  return 'padding:5px 14px;border-radius:6px;border:1px solid ' + color + '44;background:' + color + '18;color:' + color +
    ';font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .12s ease;';
}

function wireRowActions(appId: string): void {
  var body = currentBody();
  if (!body) return;

  body.querySelectorAll('.luma-fix-apply').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var rowKey = btn.getAttribute('data-fix-row') || '';
      var downloadUrl = btn.getAttribute('data-download-url');
      var fixType = btn.getAttribute('data-fix-type');
      applyFix(appId, rowKey, downloadUrl, fixType);
    });
  });

  body.querySelectorAll('.luma-fix-unfix').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var rowKey = btn.getAttribute('data-fix-row') || '';
      var fixType = btn.getAttribute('data-fix-type');
      unfixFix(appId, rowKey, fixType);
    });
  });

  body.querySelectorAll('.luma-fix-install').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var toolId = btn.getAttribute('data-tool-id') || '';
      installFixTool(appId, toolId);
    });
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function applyFix(appId: string, rowKey: string, downloadUrl: string | null, fixType: string | null): void {
  var ms = state.fixesModalState;
  if (!ms || ms.appId !== appId || ms.pending[rowKey]) return;

  var payload: any;
  if (rowKey.indexOf('catalog:') === 0) {
    payload = {
      tool: 'catalog',
      download_url: downloadUrl || '',
      fix_type: fixType || 'Voices38Fix',
    };
  } else {
    payload = { tool: rowKey };
  }

  ms.pending[rowKey] = true;
  delete ms.results[rowKey];
  renderFixes(appId);

  fetch(fixesApplyUrl(appId), {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId) return;
      if (!d || !d.ok) {
        delete m.pending[rowKey];
        m.results[rowKey] = { ok: false, message: (d && d.message) || 'Failed to start apply', at: Date.now() };
        renderFixes(appId);
        return;
      }
      ensurePolling(appId);
    })
    .catch(function (err) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId) return;
      delete m.pending[rowKey];
      m.results[rowKey] = { ok: false, message: err.message || 'Network error', at: Date.now() };
      renderFixes(appId);
    });
}

function unfixFix(appId: string, rowKey: string, fixType: string | null): void {
  var ms = state.fixesModalState;
  if (!ms || ms.appId !== appId || ms.pending[rowKey]) return;

  var isCatalog = rowKey.indexOf('catalog:') === 0;
  var payload: any = isCatalog
    ? { tool: 'catalog', fix_type: fixType || 'Voices38Fix' }
    : { tool: rowKey };

  ms.pending[rowKey] = true;
  renderFixes(appId);

  fetch(fixesUnfixUrl(appId), {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId) return;
      delete m.pending[rowKey];
      if (d && d.ok && d.result) {
        m.results[rowKey] = { ok: !!d.result.ok, message: d.result.message || 'Done', at: Date.now() };
      } else {
        m.results[rowKey] = { ok: false, message: (d && d.message) || 'Unfix failed', at: Date.now() };
      }
      refreshStatus(appId).then(function () { renderFixes(appId); });
    })
    .catch(function (err) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId) return;
      delete m.pending[rowKey];
      m.results[rowKey] = { ok: false, message: err.message || 'Network error', at: Date.now() };
      renderFixes(appId);
    });
}

function installFixTool(appId: string, toolId: string): void {
  var ms = state.fixesModalState;
  if (!ms || ms.appId !== appId || ms.toolInstallBusy) return;

  ms.toolInstallBusy = toolId;
  renderFixes(appId);

  fetch(toolInstallUrl(toolId), { method: 'POST', mode: 'cors', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId) return;
      if (!d || !d.ok) {
        m.toolInstallBusy = null;
        m.results['__tool'] = { ok: false, message: (d && d.message) || 'Install failed', at: Date.now() };
        renderFixes(appId);
        return;
      }
      ensurePolling(appId);
      pollToolInstall(appId, toolId, 0);
    })
    .catch(function (err) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId) return;
      m.toolInstallBusy = null;
      m.results['__tool'] = { ok: false, message: err.message || 'Network error', at: Date.now() };
      renderFixes(appId);
    });
}

function pollToolInstall(appId: string, toolId: string, attempt: number): void {
  var ms = state.fixesModalState;
  if (!ms || ms.appId !== appId || ms.toolInstallBusy !== toolId) return;
  if (attempt > 120) {
    ms.toolInstallBusy = null;
    ms.results['__tool'] = { ok: false, message: 'Tool install timed out', at: Date.now() };
    renderFixes(appId);
    return;
  }

  fetch(toolsUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId || m.toolInstallBusy !== toolId) return;
      var tools: any[] = (d && (d.tools || d)) || [];
      if (!Array.isArray(tools)) tools = [];
      var tool = null;
      for (var i = 0; i < tools.length; i++) {
        if (tools[i].id === toolId) { tool = tools[i]; break; }
      }
      if (tool && tool.installed) {
        m.toolInstallBusy = null;
        m.results['__tool'] = { ok: true, message: (tool.name || toolId) + ' installed', at: Date.now() };
        refreshStatus(appId).then(function () { renderFixes(appId); });
        return;
      }
      var job = tool && tool.job;
      if (job && job.status === 'error') {
        m.toolInstallBusy = null;
        m.results['__tool'] = { ok: false, message: job.message || 'Install failed', at: Date.now() };
        renderFixes(appId);
        return;
      }
      // still installing — update button label
      var body = currentBody();
      if (body) {
        var btn = body.querySelector('.luma-fix-install[data-tool-id="' + toolId + '"]');
        if (btn && job) {
          btn.textContent = 'Installing ' + (job.progress || 0) + '%';
        }
      }
      setTimeout(function () { pollToolInstall(appId, toolId, attempt + 1); }, TOOL_POLL_MS);
    })
    .catch(function () {
      setTimeout(function () { pollToolInstall(appId, toolId, attempt + 1); }, TOOL_POLL_MS);
    });
}

// ---------------------------------------------------------------------------
// Status polling (1s while jobs/pending active)
// ---------------------------------------------------------------------------
function refreshStatus(appId: string): Promise<void> {
  var ms = state.fixesModalState;
  if (!ms || ms.appId !== appId) return Promise.resolve();
  return fetch(fixesStatusUrl(appId), { method: 'GET', mode: 'cors', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var m = state.fixesModalState;
      if (!m || m.appId !== appId) return;
      if (d && d.ok) m.status = d;
    })
    .catch(function () {});
}

function ensurePolling(appId: string): void {
  var ms = state.fixesModalState;
  if (!ms || ms.appId !== appId) return;
  if (ms.pollTimer) return;
  runPoll(appId, ms.pollSeq);
}

function runPoll(appId: string, seq: number): void {
  var ms = state.fixesModalState;
  if (!ms || ms.appId !== appId || ms.pollSeq !== seq) return;

  refreshStatus(appId).then(function () {
    var m = state.fixesModalState;
    if (!m || m.appId !== appId || m.pollSeq !== seq) return;

    var status = m.status;
    var jobs = (status && status.jobs) || {};
    var anyRunning = false;

    // Detect job completions → capture results, clear pending
    var jobKeys = Object.keys(jobs);
    for (var i = 0; i < jobKeys.length; i++) {
      var jk = jobKeys[i];
      var job = jobs[jk];
      var prev = m.lastJobStatus[jk];
      if (job.status === 'running') anyRunning = true;
      if ((job.status === 'done' || job.status === 'error') && prev !== job.status) {
        // Clear pending flags for rows using this job key
        Object.keys(m.pending).forEach(function (rowKey) {
          var effectiveKey = rowKey.indexOf('catalog:') === 0 ? 'catalog' : rowKey;
          if (effectiveKey === jk) delete m.pending[rowKey];
        });
        if (job.result) {
          // map to a row key for display
          var displayRow = jk === 'catalog' ? firstCatalogRow(m) || 'catalog' : jk;
          m.results[displayRow] = { ok: !!job.result.ok, message: job.result.message || 'Done', at: Date.now() };
        }
      }
      m.lastJobStatus[jk] = job.status;
    }

    // Clear pending flags whose job never appeared (error before job creation)
    Object.keys(m.pending).forEach(function (rowKey) {
      var effectiveKey = rowKey.indexOf('catalog:') === 0 ? 'catalog' : rowKey;
      var j = jobs[effectiveKey];
      if (!j) {
        // give it a moment — job may not have been created yet
        var held = m as any;
        if (!held.__pendingSince) held.__pendingSince = {};
        if (!held.__pendingSince[rowKey]) {
          held.__pendingSince[rowKey] = Date.now();
        } else if (Date.now() - held.__pendingSince[rowKey] > 4000) {
          delete m.pending[rowKey];
          delete held.__pendingSince[rowKey];
        }
      } else if (j.status === 'done' || j.status === 'error') {
        delete m.pending[rowKey];
        var held2 = m as any;
        if (held2.__pendingSince) delete held2.__pendingSince[rowKey];
      } else {
        var held3 = m as any;
        if (held3.__pendingSince) delete held3.__pendingSince[rowKey];
      }
    });

    if (Object.keys(m.pending).length > 0) anyRunning = true;

    renderFixes(appId);

    // Expiry of result flashes
    var hasFreshResult = Object.keys(m.results).some(function (k) {
      return Date.now() - m.results[k].at < RESULT_TTL_MS;
    });

    if (anyRunning || hasFreshResult || m.toolInstallBusy) {
      m.pollTimer = setTimeout(function () { runPoll(appId, seq); }, POLL_MS);
    } else {
      m.pollTimer = null;
      // final render to clear stale flashes
      renderFixes(appId);
    }
  });
}

function firstCatalogRow(ms: any): string | null {
  for (var i = 0; i < ms.catalogEntries.length; i++) {
    if (ms.pending['catalog:' + ms.catalogEntries[i].id]) return 'catalog:' + ms.catalogEntries[i].id;
  }
  return ms.catalogEntries.length > 0 ? 'catalog:' + ms.catalogEntries[0].id : null;
}

function restartSteamFixes(): void {
  fetch(restartSteamUrl(), { method: 'POST', mode: 'cors', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .catch(function () {});
}
