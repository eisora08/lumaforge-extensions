import { state, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, IS_LINUX, saveSessionState } from '../core/state';
import { svgX, svgGear, svgSpinner, svgCheck, svgErrorCircle, svgRefresh, svgDownload, svgBox, svgPlay, svgLibrary } from '../ui/svg';
import { ensureKeyframes } from '../ui/styles';
import { bridgeUrl, depotsUrl, restartSteamUrl, downloadsQueueUrl, downloadsQueueRemoveUrl, downloadsQueueClearHistoryUrl, downloadsQueueRemoveHistoryUrl, openLibraryUrl, luaFilesUrl, luaFileDeleteUrl, toolsUrl, toolInstallUrl, toolUpdateUrl, toolUninstallUrl, fixesAppliedUrl, fixesStatusUrl, fixesInfoUrl, fixesUnfixUrl, steamAccountUrl, steamAccountDetectUrl, openUrlApi, steamKeysPinsUrl, steamKeysPinUrl, steamKeysUnpinUrl } from '../ui/helpers';
import { formatBytes, escapeHtml } from '../ui/dom';
import { retryFetch } from '../api/bridge';
import { openDepotModal, restartSteam } from '../modals/depot';
import { openSourceModal } from '../modals/source';
import { applyInLibraryState } from '../ui/button';

var SIDEBAR_ID = 'luma-sidebar-panel';
var BACKDROP_ID = 'luma-sidebar-backdrop';
var LUMA_VERSION = '2.6.0';

var _downloadsPollTimer: ReturnType<typeof setTimeout> | null = null;
var _downloadsPollSeq = 0;
var _shownDepotCompletions: Record<string, boolean> = {};
var _toolsPollTimer: ReturnType<typeof setTimeout> | null = null;
var _toolsPollSeq = 0;
var _fixesPollTimer: ReturnType<typeof setTimeout> | null = null;
var _fixesPollSeq = 0;
var _dashPollTimer: ReturnType<typeof setTimeout> | null = null;
var _dashPollSeq = 0;

// Lua list client-side cache + search/sort state (persists across tab switches)
var _luaFiles: any[] = [];
var _luaPins: any = {};
var _luaQuery = '';
var _luaSort = 'name-asc';

function showSteamRestartDialog(appId: string, gameName: string): void {
  var overlay = document.createElement('div');
  overlay.id = 'luma-steam-restart-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);';

  var restartBtnHtml = IS_LINUX
    ? '<button type="button" id="luma-sr-restart" style="padding:10px 18px;border-radius:8px;border:none;background:#66c0ff;color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">' + svgRefresh() + ' RESTART STEAM</button>'
    : '';

  overlay.innerHTML =
    '<div style="background:#1b2838;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:28px 24px 20px;max-width:380px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.5);">' +
    '<div style="margin-bottom:12px;">' + svgCheck(32, 32) + '</div>' +
    '<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:6px;">Content Downloaded</div>' +
    '<div style="font-size:12px;color:#8f98a0;margin-bottom:4px;">' + escapeHtml(gameName) + '</div>' +
    '<div style="font-size:12px;color:#8f98a0;margin-bottom:16px;">Game content has been downloaded and registered in Steam.</div>' +
    (IS_LINUX
      ? '<div style="margin-bottom:16px;padding:10px 14px;border-radius:8px;background:rgba(102,192,255,.08);border:1px solid rgba(102,192,255,.15);font-size:12px;color:#c7d5e0;">Steam needs to be restarted to detect the new game.<br>Would you like to restart now?</div>'
      : '') +
    '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
    restartBtnHtml +
    '<button type="button" id="luma-sr-library" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#c7d5e0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">' + svgLibrary() + ' VIEW IN LIBRARY</button>' +
    '<button type="button" id="luma-sr-close" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#8f98a0;font-size:13px;cursor:pointer;">' + (IS_LINUX ? 'RESTART LATER' : 'CLOSE') + '</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.remove();
  });

  var restartBtn = document.getElementById('luma-sr-restart') as HTMLButtonElement | null;
  if (restartBtn) {
    restartBtn.addEventListener('click', function () {
      restartBtn.disabled = true;
      restartBtn.innerHTML = svgSpinner() + ' RESTARTING...';
      restartSteam(appId);
    });
  }
  var libBtn = document.getElementById('luma-sr-library');
  if (libBtn) {
    libBtn.addEventListener('click', function () {
      fetch(openLibraryUrl(appId), { method: 'POST', mode: 'cors', cache: 'no-store' }).catch(function () { });
      overlay.remove();
    });
  }
  var closeBtn = document.getElementById('luma-sr-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      overlay.remove();
    });
  }
}

var TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'providers', label: 'Providers' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'tools', label: 'Tools' },
  { id: 'fixes', label: 'Fixes' },
  { id: 'settings', label: 'Settings' },
];

function closeSidebar() {
  var panel = document.getElementById(SIDEBAR_ID);
  var backdrop = document.getElementById(BACKDROP_ID);
  if (panel) panel.remove();
  if (backdrop) backdrop.remove();
  stopDownloadsPoll();
  stopDashPoll();
  stopToolsPoll();
  stopFixesPoll();
  state.sidebarOpen = false;
  saveSessionState();
  // Show floating settings button again
  var settingsBtn = document.getElementById('luma-ssh-settings-btn') as HTMLElement | null;
  if (settingsBtn) settingsBtn.style.display = '';
}

function switchTab(tabId: string) {
  state.currentTab = tabId;
  saveSessionState();
  var panel = document.getElementById(SIDEBAR_ID);
  if (!panel) return;
  var tabs = panel.querySelectorAll('.luma-sidebar-tab');
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i] as HTMLElement;
    t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
  }
  renderTabContent(tabId);
}

function renderTabContent(tabId: string) {
  var panel = document.getElementById(SIDEBAR_ID);
  if (!panel) return;
  var content = panel.querySelector('.luma-sidebar-content');
  if (!content) return;
  (content as HTMLElement).innerHTML = '<div style="text-align:center;padding:40px;color:#8f98a0;">Loading...</div>';
  if (tabId !== 'tools') stopToolsPoll();
  if (tabId !== 'fixes') stopFixesPoll();
  if (tabId !== 'dashboard') stopDashPoll();

  switch (tabId) {
    case 'dashboard': renderDashboardTab(content as HTMLElement); break;
    case 'providers': renderProvidersTab(content as HTMLElement); break;
    case 'downloads': renderDownloadsTab(content as HTMLElement); break;
    case 'tools': renderToolsTab(content as HTMLElement); break;
    case 'fixes': renderFixesTab(content as HTMLElement); break;
    case 'settings': renderSettingsTab(content as HTMLElement); break;
  }
}

// ---------------------------------------------------------------------------
// Speed computation (sliding window — copied from luma-lite)
// ---------------------------------------------------------------------------
var _speedSamples: Map<string, Array<{ bytes: number; time: number }>> = new Map();

function computeSpeed(jobId: string, bytesRead: number): { speed: number; peak: number } {
  var now = Date.now();
  var samples = _speedSamples.get(jobId) || [];
  samples.push({ bytes: bytesRead, time: now });
  while (samples.length > 30) samples.shift();
  _speedSamples.set(jobId, samples);
  if (samples.length < 2) return { speed: 0, peak: 0 };

  var windowMs = 5000;
  var cutoff = now - windowMs;
  var oldest = samples[0];
  for (var i = 0; i < samples.length; i++) {
    if (samples[i].time <= cutoff) oldest = samples[i];
  }

  var dt = (now - oldest.time) / 1000;
  var db = bytesRead - oldest.bytes;
  var speed = dt > 0.3 && db >= 0 ? Math.round(db / dt) : 0;

  var peak = 0;
  for (var j = 1; j < samples.length; j++) {
    var ddt = (samples[j].time - samples[j - 1].time) / 1000;
    var ddb = samples[j].bytes - samples[j - 1].bytes;
    if (ddt > 0.3 && ddb >= 0) peak = Math.max(peak, Math.round(ddb / ddt));
  }
  return { speed: speed, peak: peak };
}

function clearSpeedSamples(jobId: string) {
  _speedSamples.delete(jobId);
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '\u2014';
  var units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  var speed = bytesPerSec;
  var unitIndex = 0;
  while (speed >= 1024 && unitIndex < units.length - 1) {
    speed /= 1024;
    unitIndex++;
  }
  return speed.toFixed(speed >= 10 ? 0 : 1) + ' ' + units[unitIndex];
}

function getSpeedHistory(jobId: string): number[] {
  var samples = _speedSamples.get(jobId) || [];
  if (samples.length < 2) return [];
  var speeds: number[] = [];
  for (var i = 1; i < samples.length; i++) {
    var dt = (samples[i].time - samples[i - 1].time) / 1000;
    var db = samples[i].bytes - samples[i - 1].bytes;
    if (dt > 0.2 && db >= 0) speeds.push(Math.round(db / dt));
  }
  return speeds;
}

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------
function renderDashboardTab(container: HTMLElement) {
  var html = '';
  html += '<div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px;">';
  html += '<div class="luma-stat-card"><div class="luma-stat-icon blue">' + svgGear() + '</div><div><div class="luma-stat-value" id="luma-dash-providers">--</div><div class="luma-stat-label">Active Providers</div></div></div>';
  html += '<div class="luma-stat-card"><div class="luma-stat-icon green">' + svgDownload() + '</div><div><div class="luma-stat-value" id="luma-dash-downloads">' + (state.activeDownloads.length + state.activeDepotJobs.length) + '</div><div class="luma-stat-label">Active Downloads</div></div></div>';
  html += '</div>';

  // Active downloads list (repainted live by the dashboard poll)
  html += '<div class="luma-sidebar-section" id="luma-dash-active-section" style="' + ((state.activeDownloads.length > 0 || state.activeDepotJobs.length > 0) ? '' : 'display:none;') + '"><div class="luma-sidebar-section-title">Active Now</div><div id="luma-dash-active"></div></div>';

  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Quick Actions</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
  html += '<button class="luma-sidebar-btn secondary" id="luma-dash-refresh">Refresh</button>';
  html += '</div></div>';

  // Lua Scripts section — flex:1 reaches the sidebar footer, scrolls internally
  html += '<div class="luma-sidebar-section" style="flex:1;display:flex;flex-direction:column;min-height:0;margin-bottom:0;"><div class="luma-sidebar-section-title" style="flex-shrink:0;">Lua Scripts</div>';
  html += '<div style="display:flex;gap:6px;margin-bottom:8px;flex-shrink:0;">';
  html += '<input id="luma-lua-search" type="text" placeholder="Search\u2026" value="' + esc(_luaQuery) + '" style="flex:1 1 auto;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:6px 9px;color:#fff;font-size:11px;outline:none;" />';
  html += '<select id="luma-lua-sort" style="flex:0 0 96px;width:96px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:6px 6px;color:#c7d5e0;font-size:11px;cursor:pointer;outline:none;">';
  html += '<option value="name-asc"' + (_luaSort === 'name-asc' ? ' selected' : '') + '>Name A-Z</option>';
  html += '<option value="name-desc"' + (_luaSort === 'name-desc' ? ' selected' : '') + '>Name Z-A</option>';
  html += '<option value="newest"' + (_luaSort === 'newest' ? ' selected' : '') + '>Newest</option>';
  html += '<option value="oldest"' + (_luaSort === 'oldest' ? ' selected' : '') + '>Oldest</option>';
  html += '</select>';
  html += '</div>';
  html += '<div id="luma-dash-lua-container" style="flex:1;min-height:0;overflow-y:auto;padding-right:4px;">';
  html += '<div style="font-size:11px;color:#8f98a0;padding:8px 0;">Loading...</div>';
  html += '</div></div>';
  html += '</div>';

  container.innerHTML = html;

  renderActiveNow();

  var refreshBtn = document.getElementById('luma-dash-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function() { renderDashboardTab(container); });

  var searchEl = document.getElementById('luma-lua-search') as HTMLInputElement | null;
  if (searchEl) searchEl.addEventListener('input', function() { _luaQuery = searchEl.value; paintLuaCards(); });

  var sortEl = document.getElementById('luma-lua-sort') as HTMLSelectElement | null;
  if (sortEl) sortEl.addEventListener('change', function() { _luaSort = sortEl.value; paintLuaCards(); });

  // Fetch provider stats
  fetch(bridgeUrl('/api/provider-stats'), { method: 'GET', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok && data.providers) {
        var active = data.providers.filter(function(p: any) { return p.enabled && p.hasKey; }).length;
        var total = data.providers.length;
        var el = document.getElementById('luma-dash-providers');
        if (el) el.textContent = active + '/' + total;
      }
    })
    .catch(function() {});

  // Fetch Lua files + pin/installed state
  loadLuaCards();

  // Live updates while the dashboard is mounted (start first: it resets the hook)
  startDashPoll();
  state.onDownloadSettled = function() {
    renderActiveNow();
    loadLuaCards();
  };
}

// ---------------------------------------------------------------------------
// Dashboard poll — keeps Active Now + download phases live (no Downloads tab)
// ---------------------------------------------------------------------------
function startDashPoll(): void {
  stopDashPoll();
  _dashPollSeq++;
  var seq = _dashPollSeq;

  function tick(): void {
    if (seq !== _dashPollSeq) return;
    // Re-fetch phases/progress for tracked source downloads
    if (state.activeDownloads.length > 0) pollSourceDownloads(_downloadsPollSeq);
    renderActiveNow();
    _dashPollTimer = setTimeout(tick, 1500);
  }
  _dashPollTimer = setTimeout(tick, 1500);
}

function stopDashPoll(): void {
  _dashPollSeq++;
  if (_dashPollTimer) {
    clearTimeout(_dashPollTimer);
    _dashPollTimer = null;
  }
  state.onDownloadSettled = null;
}

// ---------------------------------------------------------------------------
// Dashboard: Lua cards with Installed/Pinned badges + pin mini-menu
// ---------------------------------------------------------------------------
function loadLuaCards(): void {
  fetch(steamKeysPinsUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(pd) { renderLuaCards(pd && pd.ok && pd.pins ? pd.pins : {}); })
    .catch(function() { renderLuaCards({}); });
}

function renderLuaCards(pins: any): void {
  fetch(luaFilesUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _luaPins = pins;
      _luaFiles = (data && data.ok && data.files) ? data.files : [];
      paintLuaCards();
    })
    .catch(function() {
      _luaPins = pins;
      _luaFiles = [];
      paintLuaCards();
    });
}

function renderActiveNow(): void {
  var section = document.getElementById('luma-dash-active-section');
  var wrap = document.getElementById('luma-dash-active');
  var stat = document.getElementById('luma-dash-downloads');
  if (stat) stat.textContent = String(state.activeDownloads.length + state.activeDepotJobs.length);
  if (!section || !wrap) return;

  var hasAny = state.activeDownloads.length > 0 || state.activeDepotJobs.length > 0;
  section.style.display = hasAny ? '' : 'none';
  if (!hasAny) { wrap.innerHTML = ''; return; }

  var h = '';
  for (var i = 0; i < state.activeDownloads.length; i++) {
    var dl = state.activeDownloads[i];
    var pct = Math.max(0, Math.min(100, dl.progress || 0));
    h += '<div class="luma-stat-card" style="margin-bottom:6px;"><div class="luma-stat-icon blue">' + svgDownload() + '</div><div style="flex:1;min-width:0;">';
    h += '<div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">App ' + esc(dl.appId) + '</div>';
    h += '<div style="font-size:10px;color:#8f98a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(dl.phase || 'Downloading') + ' \u00b7 ' + pct.toFixed(0) + '%</div>';
    h += '<div style="height:3px;border-radius:2px;background:rgba(255,255,255,.08);margin-top:5px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:#66c0ff;border-radius:2px;transition:width .3s;"></div></div>';
    h += '</div></div>';
  }
  for (var j = 0; j < state.activeDepotJobs.length; j++) {
    var job = state.activeDepotJobs[j];
    h += '<div class="luma-stat-card" style="margin-bottom:6px;"><div class="luma-stat-icon orange">' + svgBox() + '</div><div style="flex:1;min-width:0;">';
    h += '<div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(job.gameName || 'App ' + job.appId) + '</div>';
    h += '<div style="font-size:10px;color:#8f98a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(job.phase || job.status) + '</div>';
    h += '</div></div>';
  }
  wrap.innerHTML = h;
}

function paintLuaCards(): void {
  var luaContainer = document.getElementById('luma-dash-lua-container');
  if (!luaContainer) return;

  var pins = _luaPins;
  var q = _luaQuery.trim().toLowerCase();
  var files = _luaFiles.slice();
  if (q) {
    files = files.filter(function(f: any) {
      return String(f.name || '').toLowerCase().indexOf(q) !== -1 ||
             String(f.appId || '').indexOf(q) !== -1 ||
             String(f.filename || '').toLowerCase().indexOf(q) !== -1;
    });
  }
  files.sort(function(a: any, b: any) {
    if (_luaSort === 'newest' || _luaSort === 'oldest') {
      var diff = (b.modified || 0) - (a.modified || 0);
      if (diff !== 0) return _luaSort === 'newest' ? diff : -diff;
      // Same mtime (bulk-created files): fall back to appId order
      diff = Number(b.appId || 0) - Number(a.appId || 0);
      return _luaSort === 'newest' ? diff : -diff;
    }
    var an = String(a.name || 'App ' + a.appId).toLowerCase();
    var bn = String(b.name || 'App ' + b.appId).toLowerCase();
    if (an < bn) return _luaSort === 'name-asc' ? -1 : 1;
    if (an > bn) return _luaSort === 'name-asc' ? 1 : -1;
    return 0;
  });

  if (files.length === 0) {
    luaContainer.innerHTML = '<div style="font-size:11px;color:#8f98a0;padding:8px 0;">' + (_luaFiles.length === 0 ? 'No Lua scripts installed' : 'No matches') + '</div>';
    return;
  }

  var h = '';
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
        var pin = pins[f.appId] || null;
        var installed = !!(pin && pin.installed);
        var hasPins = !!(pin && pin.hasPins);
        var badges = '';
        if (installed) badges += ' \u00b7 <span style="color:#64c882;">Installed</span>';
        if (hasPins) badges += ' \u00b7 <span style="color:#f0ad4e;">Pinned</span>';

        h += '<div class="luma-stat-card" data-lua-appid="' + esc(f.appId) + '" style="margin-bottom:6px;padding:10px;display:flex;align-items:center;gap:10px;">';
        h += '<div class="luma-stat-icon blue">' + svgBox() + '</div>';
        h += '<div style="flex:1;min-width:0;">';
        h += '<div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(f.name || 'App ' + f.appId) + '</div>';
        h += '<div style="font-size:10px;color:#8f98a0;">ID: ' + esc(f.appId) + ' \u00b7 ' + esc(f.filename) + badges + '</div>';
        h += '</div>';
        h += '<div style="position:relative;flex-shrink:0;">';
        if (hasPins) {
          h += '<button class="luma-lua-pin-btn" data-lua-pin-direct="' + esc(f.appId) + '" title="Unpin manifest" style="background:rgba(240,173,78,.15);border:1px solid rgba(240,173,78,.5);color:#f0ad4e;border-radius:4px;padding:4px 7px;font-size:11px;cursor:pointer;line-height:1;">\u{1F4CC}</button>';
        } else {
          h += '<button class="luma-lua-pin-btn" data-lua-pin-toggle="' + esc(f.appId) + '" title="Manifest pins" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:4px;padding:4px 7px;font-size:11px;cursor:pointer;line-height:1;">\u{1F4CC}</button>';
        }
        h += '<div class="luma-lua-pin-menu" data-lua-pin-menu="' + esc(f.appId) + '" style="display:none;position:absolute;right:0;top:calc(100% + 4px);z-index:60;background:#1b2838;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px;min-width:190px;box-shadow:0 6px 20px rgba(0,0,0,.5);text-align:left;">';
        h += '<button data-lua-pin-action="current" data-app="' + esc(f.appId) + '" style="display:' + (installed ? 'block' : 'none') + ';width:100%;text-align:left;background:none;border:none;color:#c7d5e0;font-size:11px;padding:6px 8px;cursor:pointer;border-radius:4px;white-space:nowrap;">\u{1F4CC} Pin to Current Version</button>';
        h += '<button data-lua-pin-action="latest" data-app="' + esc(f.appId) + '" style="display:block;width:100%;text-align:left;background:none;border:none;color:#c7d5e0;font-size:11px;padding:6px 8px;cursor:pointer;border-radius:4px;white-space:nowrap;">\u{1F4CC} Pin to Latest Version</button>';
        h += '<button data-lua-pin-action="unpin" data-app="' + esc(f.appId) + '" style="display:' + (hasPins ? 'block' : 'none') + ';width:100%;text-align:left;background:none;border:none;color:#e74c3c;font-size:11px;padding:6px 8px;cursor:pointer;border-radius:4px;white-space:nowrap;">\u26D4 Unpin</button>';
        h += '</div>';
        h += '</div>';
        h += '<button class="luma-lua-delete-btn" data-lua-delete="' + esc(f.appId) + '" title="Remove Lua script" style="background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.25);border-radius:4px;padding:4px 7px;color:#e74c3c;font-size:11px;cursor:pointer;flex-shrink:0;line-height:1;">\u{1F5D1}\u{FE0F}</button>';
        h += '</div>';
      }
      luaContainer.innerHTML = h;

      // Close menus when clicking outside a menu (bind once per container)
      if (!luaContainer.getAttribute('data-pin-bound')) {
        luaContainer.setAttribute('data-pin-bound', '1');
        luaContainer.addEventListener('click', function(ev) {
          var t = ev.target as HTMLElement;
          if (t.closest && t.closest('[data-lua-pin-menu],[data-lua-pin-toggle],[data-lua-pin-direct]')) return;
          var openMenus = luaContainer.querySelectorAll('[data-lua-pin-menu]');
          for (var m = 0; m < openMenus.length; m++) {
            (openMenus[m] as HTMLElement).style.display = 'none';
          }
        });
      }

      // Direct unpin (pinned state button)
      var pinDirects = luaContainer.querySelectorAll('[data-lua-pin-direct]');
      for (var d = 0; d < pinDirects.length; d++) {
        (function(btn: Element) {
          btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var appId = btn.getAttribute('data-lua-pin-direct');
            if (!appId) return;
            (btn as HTMLButtonElement).disabled = true;

            fetch(steamKeysUnpinUrl(), {
              method: 'POST',
              mode: 'cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ appId: appId })
            })
              .then(function(r) { return r.json(); })
              .then(function(res) {
                if (res && res.ok) loadLuaCards();
                else {
                  (btn as HTMLButtonElement).disabled = false;
                  console.warn('[LUMA_INJECT] Unpin failed:', res && res.message);
                }
              })
              .catch(function() { (btn as HTMLButtonElement).disabled = false; });
          });
        })(pinDirects[d]);
      }

      // Pin toggle buttons
      var pinToggles = luaContainer.querySelectorAll('[data-lua-pin-toggle]');
      for (var t = 0; t < pinToggles.length; t++) {
        (function(btn: Element) {
          btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var appId = btn.getAttribute('data-lua-pin-toggle');
            var menu = luaContainer.querySelector('[data-lua-pin-menu="' + appId + '"]') as HTMLElement;
            if (!menu) return;
            var isOpen = menu.style.display !== 'none';
            var allMenus = luaContainer.querySelectorAll('[data-lua-pin-menu]');
            for (var m = 0; m < allMenus.length; m++) {
              (allMenus[m] as HTMLElement).style.display = 'none';
            }
            menu.style.display = isOpen ? 'none' : 'block';
          });
        })(pinToggles[t]);
      }

      // Pin/unpin actions
      var pinActions = luaContainer.querySelectorAll('[data-lua-pin-action]');
      for (var a = 0; a < pinActions.length; a++) {
        (function(btn: Element) {
          btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var action = btn.getAttribute('data-lua-pin-action');
            var appId = btn.getAttribute('data-app');
            if (!appId || !action) return;
            var menu = luaContainer.querySelector('[data-lua-pin-menu="' + appId + '"]') as HTMLElement;
            if (menu) menu.style.display = 'none';

            var url = action === 'unpin' ? steamKeysUnpinUrl() : steamKeysPinUrl();
            var payload = action === 'unpin'
              ? { appId: appId }
              : { appId: appId, mode: action };
            (btn as HTMLButtonElement).disabled = true;

            fetch(url, {
              method: 'POST',
              mode: 'cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
              .then(function(r) { return r.json(); })
              .then(function(res) {
                if (res && res.ok) loadLuaCards();
                else {
                  (btn as HTMLButtonElement).disabled = false;
                  console.warn('[LUMA_INJECT] Pin op failed:', res && res.message);
                }
              })
              .catch(function() { (btn as HTMLButtonElement).disabled = false; });
          });
        })(pinActions[a]);
      }

      // Delete buttons (icon-only)
      var deleteBtns = luaContainer.querySelectorAll('[data-lua-delete]');
      for (var j = 0; j < deleteBtns.length; j++) {
        (function(btn: Element) {
          btn.addEventListener('click', function() {
            var appId = btn.getAttribute('data-lua-delete');
            if (!appId) return;
            var card = luaContainer.querySelector('[data-lua-appid="' + appId + '"]');
            (btn as HTMLButtonElement).textContent = '\u2026';
            (btn as HTMLButtonElement).disabled = true;

            fetch(luaFileDeleteUrl(appId), { method: 'DELETE', mode: 'cors', cache: 'no-store' })
              .then(function(r) { return r.json(); })
              .then(function(result) {
                if (result.ok && card) {
                  (card as HTMLElement).style.transition = 'opacity .3s, transform .3s';
                  (card as HTMLElement).style.opacity = '0';
                  (card as HTMLElement).style.transform = 'translateX(20px)';
                  setTimeout(function() { card.remove(); }, 300);
                  for (var k = _luaFiles.length - 1; k >= 0; k--) {
                    if (String(_luaFiles[k] && _luaFiles[k].appId) === String(appId)) _luaFiles.splice(k, 1);
                  }
                  setTimeout(function() { loadLuaCards(); }, 350);
                } else {
                  (btn as HTMLButtonElement).textContent = '\u{1F5D1}\u{FE0F}';
                  (btn as HTMLButtonElement).disabled = false;
                }
              })
              .catch(function() {
                (btn as HTMLButtonElement).textContent = '\u{1F5D1}\u{FE0F}';
                (btn as HTMLButtonElement).disabled = false;
              });
          });
        })(deleteBtns[j]);
      }
}

// ---------------------------------------------------------------------------
// Providers tab — full provider settings (independent of luma-lite)
// ---------------------------------------------------------------------------
function renderProvidersTab(container: HTMLElement) {
  var html = '<div style="text-align:center;padding:40px;color:#8f98a0;">Loading providers...</div>';
  container.innerHTML = html;

  fetch(bridgeUrl('/api/settings'), { method: 'GET', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#e74c3c;">Failed to load settings</div>';
        return;
      }
      var providers = data.providers || [];
      var h = '';

      // Provider list
      h += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Providers (' + providers.length + ')</div>';
      for (var i = 0; i < providers.length; i++) {
        var p = providers[i];
        h += '<div class="luma-provider-row" data-provider-idx="' + i + '" data-provider-id="' + esc(p.id) + '" data-provider-name="' + esc(p.name || '') + '" style="flex-direction:column;align-items:stretch;gap:8px;">';

        // Row 1: name + toggle
        h += '<div style="display:flex;align-items:center;justify-content:space-between;">';
        h += '<div style="display:flex;align-items:center;gap:8px;min-width:0;">';
        h += '<button class="luma-toggle' + (p.enabled ? ' on' : '') + '" data-toggle="' + i + '"></button>';
        h += '<div style="min-width:0;">';
        h += '<div style="font-size:13px;font-weight:600;color:#fff;">' + esc(p.name) + '</div>';
        h += '<div style="font-size:10px;color:#8f98a0;">' + (p.id === 'steamkeys' ? 'Local provider (no API key)' : (p.hasKey ? 'API key configured' : 'No API key')) + '</div>';
        h += '</div></div>';
        h += '<span class="luma-provider-test-status" data-test-status="' + i + '" style="font-size:10px;color:#8f98a0;"></span>';
        h += '</div>';

        // Row 2: URL
        h += '<div style="display:flex;align-items:center;gap:6px;">';
        h += '<label style="font-size:10px;color:#8f98a0;width:32px;flex-shrink:0;">URL</label>';
        h += '<input type="text" data-provider-url="' + i + '" value="' + esc(p.baseUrl || '') + '" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:5px 8px;color:#fff;font-size:11px;font-family:monospace;outline:none;">';
        h += '</div>';

        if (p.id !== 'steamkeys') {
          // Row 3: API Key + Test + Get Key link
          h += '<div style="display:flex;align-items:center;gap:6px;">';
          h += '<label style="font-size:10px;color:#8f98a0;width:32px;flex-shrink:0;">Key</label>';
          h += '<input type="password" data-provider-key="' + i + '" value="" placeholder="' + (p.hasKey ? p.maskedKey : 'Enter API key') + '" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:5px 8px;color:#fff;font-size:11px;font-family:monospace;outline:none;">';
          h += '<button class="luma-sidebar-btn secondary" data-test-btn="' + i + '" style="padding:4px 8px;font-size:10px;">Test</button>';
          h += '</div>';

          // Get API Key link
          var keyUrl = getKeyUrl(p.id);
          if (keyUrl) {
            h += '<div style="text-align:right;">';
            h += '<a href="' + keyUrl + '" target="_blank" rel="noopener" style="font-size:10px;color:#66c0ff;text-decoration:none;">Get API Key \u2197</a>';
            h += '</div>';
          }
        }

        h += '</div>';
      }
      h += '</div>';

      // Save button
      h += '<div style="padding:12px 0;display:flex;gap:8px;justify-content:flex-end;">';
      h += '<button class="luma-sidebar-btn secondary" id="luma-providers-test-all">Test All</button>';
      h += '<button class="luma-sidebar-btn primary" id="luma-providers-save">Save Settings</button>';
      h += '</div>';

      container.innerHTML = h;

      // Wire up toggles
      container.querySelectorAll('[data-toggle]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = btn.getAttribute('data-toggle');
          btn.classList.toggle('on');
        });
      });

      // Wire up test buttons
      container.querySelectorAll('[data-test-btn]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = btn.getAttribute('data-test-btn');
          testProvider(container, parseInt(idx!));
        });
      });

      // Wire up save
      var saveBtn = document.getElementById('luma-providers-save');
      if (saveBtn) saveBtn.addEventListener('click', function() { saveProviders(container); });

      // Wire up test all
      var testAllBtn = document.getElementById('luma-providers-test-all');
      if (testAllBtn) testAllBtn.addEventListener('click', function() {
        for (var k = 0; k < providers.length; k++) {
          testProvider(container, k);
        }
      });
    })
    .catch(function() {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#e74c3c;">' +
        '<div style="margin-bottom:12px;">' + svgErrorCircle() + '</div>' +
        '<div>Bridge not available</div>' +
        '<div style="font-size:11px;color:#8f98a0;margin-top:8px;">Make sure the CDP proxy is running</div>' +
        '</div>';
    });
}

function getKeyUrl(providerId: string): string {
  var urls: Record<string, string> = {
    'steamrip': 'https://steamrip.com',
    'steamunlocked': 'https://steamunlocked.co',
    'steamgg': 'https://steamgg.net',
    'goggg': 'https://goggg.net',
    'hubcapdb': 'https://www.hubcapdb.com',
    'steamdb': 'https://steamdb.info',
    'csrin': 'https://cs.rin.ru',
  };
  return urls[providerId] || '';
}

function testProvider(container: HTMLElement, idx: number) {
  var row = container.querySelector('[data-provider-idx="' + idx + '"]');
  if (!row) return;
  var urlInput = row.querySelector('[data-provider-url="' + idx + '"]') as HTMLInputElement;
  var keyInput = row.querySelector('[data-provider-key="' + idx + '"]') as HTMLInputElement;
  var statusEl = row.querySelector('[data-test-status="' + idx + '"]') as HTMLElement;
  var providerId = row.getAttribute('data-provider-id');

  if (statusEl) statusEl.textContent = 'Testing...';
  statusEl.style.color = '#66c0ff';

  retryFetch(bridgeUrl('/api/settings/test-key'), {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: providerId,
      baseUrl: urlInput ? urlInput.value : '',
      apiKey: keyInput && keyInput.value ? keyInput.value : undefined
    })
  }, 'sidebar-test-' + idx, {})
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        statusEl.textContent = '\u2713 ' + data.message;
        statusEl.style.color = '#64c882';
      } else {
        statusEl.textContent = '\u2717 ' + data.message;
        statusEl.style.color = '#e74c3c';
      }
    })
    .catch(function(err) {
      statusEl.textContent = '\u2717 Error';
      statusEl.style.color = '#e74c3c';
    });
}

function saveProviders(container: HTMLElement) {
  var rows = container.querySelectorAll('[data-provider-idx]');
  var providers: any[] = [];

  rows.forEach(function(row) {
    var id = row.getAttribute('data-provider-id');
    var toggle = row.querySelector('[data-toggle]') as HTMLElement;
    var enabled = toggle ? toggle.classList.contains('on') : false;
    var urlInput = row.querySelector('[data-provider-url]') as HTMLInputElement;
    var keyInput = row.querySelector('[data-provider-key]') as HTMLInputElement | null;
    var nameAttr = row.getAttribute('data-provider-name');

    providers.push({
      id: id,
      name: nameAttr || (id!.charAt(0).toUpperCase() + id!.slice(1)),
      enabled: enabled,
      baseUrl: urlInput ? urlInput.value : '',
      apiKey: keyInput && keyInput.value ? keyInput.value : undefined
    });
  });

  var saveBtn = document.getElementById('luma-providers-save') as HTMLButtonElement;
  if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true; }

  retryFetch(bridgeUrl('/api/settings'), {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers: providers })
  }, 'sidebar-save', {})
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (saveBtn) {
        saveBtn.textContent = data.ok ? '\u2713 Saved' : 'Save Settings';
        saveBtn.disabled = false;
        if (data.ok) setTimeout(function() { saveBtn.textContent = 'Save Settings'; }, 2000);
      }
    })
    .catch(function() {
      if (saveBtn) { saveBtn.textContent = 'Save Settings'; saveBtn.disabled = false; }
    });
}

// ---------------------------------------------------------------------------
// Downloads tab — ActiveDownloadCard (copied from luma-lite)
// ---------------------------------------------------------------------------
function renderDownloadsTab(container: HTMLElement) {
  stopDownloadsPoll();
  _downloadsPollSeq++;
  var seq = _downloadsPollSeq;

  var html = '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Active Downloads</div>';
  html += '<div id="luma-downloads-list"></div>';
  html += '</div>';
  html += '<div class="luma-sidebar-section" style="margin-top:12px;"><div class="luma-sidebar-section-title" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" id="luma-history-toggle"><span>History</span><div style="display:flex;align-items:center;gap:6px;"><button id="luma-clear-history-btn" style="background:none;border:none;color:#8f98a0;font-size:10px;cursor:pointer;padding:2px 4px;border-radius:4px;" title="Clear History">Clear</button><span style="font-size:10px;color:#8f98a0;">&#9660;</span></div></div>';
  html += '<div id="luma-history-list"></div>';
  html += '</div>';
  container.innerHTML = html;

  var listEl = document.getElementById('luma-downloads-list');
  var historyEl = document.getElementById('luma-history-list');
  var historyVisible = true;

  // Toggle history visibility
  var historyToggle = document.getElementById('luma-history-toggle');
  if (historyToggle && historyEl) {
    historyToggle.addEventListener('click', function() {
      historyVisible = !historyVisible;
      historyEl.style.display = historyVisible ? 'block' : 'none';
      var arrow = historyToggle.querySelector('span:last-child');
      if (arrow) arrow.innerHTML = historyVisible ? '&#9660;' : '&#9654;';
    });
    renderHistory();
  }

  // Clear history button
  var clearHistoryBtn = document.getElementById('luma-clear-history-btn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      fetch(downloadsQueueClearHistoryUrl(), { method: 'POST', mode: 'cors', cache: 'no-store' })
        .then(function() { renderCards(); })
        .catch(function() {});
    });
  }

  function renderHistory(bridgeHistory?: any[]) {
    if (!historyEl) return;
    var hHtml = '';
    var histArr = bridgeHistory || state.downloadHistory || [];
    for (var h = 0; h < histArr.length; h++) {
      var hist = histArr[h];
      var isPaused = hist.status === 'paused';
      var statusColor = hist.status === 'completed' ? '#67e8f9' : hist.status === 'failed' ? '#f87171' : isPaused ? '#fbbf24' : '#f87171';
      var statusLabel = hist.status === 'completed' ? 'COMPLETED' : hist.status === 'failed' ? 'FAILED' : isPaused ? 'PAUSED' : 'CANCELLED';
      var statusBg = hist.status === 'completed' ? 'rgba(103,232,249,.12)' : hist.status === 'failed' ? 'rgba(248,113,113,.12)' : isPaused ? 'rgba(251,191,36,.12)' : 'rgba(248,113,113,.12)';
      var pct = hist.status === 'completed' ? 100 : hist.status === 'failed' ? (hist.progress || 0) : hist.totalBytes > 0 ? Math.round((hist.bytesDownloaded / hist.totalBytes) * 100) : (hist.progress || 0);
      var timeAgo = formatTimeAgo(hist.timestamp || hist.completedAt || 0);
      hHtml += '<div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.03);margin-bottom:6px;border:1px solid rgba(255,255,255,.04);">';
      hHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">';
      hHtml += '<div style="font-size:12px;font-weight:600;color:#fff;">' + esc(hist.gameName || 'App ' + hist.appId) + '</div>';
      hHtml += '<div style="display:flex;align-items:center;gap:4px;">';
      hHtml += '<div style="padding:2px 6px;border-radius:6px;font-size:9px;font-weight:700;background:' + statusBg + ';color:' + statusColor + ';">' + statusLabel + '</div>';
      hHtml += '<button data-remove-history="' + hist.id + '" style="background:none;border:none;color:#8f98a0;font-size:11px;cursor:pointer;padding:2px 4px;border-radius:4px;" title="Remove">&times;</button>';
      hHtml += '</div>';
      hHtml += '</div>';
      hHtml += '<div style="display:flex;align-items:center;justify-content:space-between;">';
      hHtml += '<div style="font-size:10px;color:#8f98a0;">' + pct + '%</div>';
      hHtml += '<div style="font-size:10px;color:#8f98a0;">' + timeAgo + '</div>';
      hHtml += '</div>';
      hHtml += '<div style="height:3px;border-radius:2px;background:rgba(255,255,255,.06);margin-top:6px;overflow:hidden;">';
      hHtml += '<div style="height:100%;width:' + pct + '%;background:' + statusColor + ';border-radius:2px;"></div>';
      hHtml += '</div>';
      if (isPaused) {
        hHtml += '<button data-resume-history="' + h + '" data-resume-type="' + hist.type + '" data-resume-appid="' + hist.appId + '" style="margin-top:8px;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;border:1px solid rgba(102,192,255,.3);background:rgba(102,192,255,.1);color:#66c0ff;font-size:10px;font-weight:600;cursor:pointer;">' + svgPlay() + ' Resume</button>';
      }
      hHtml += '</div>';
    }
    historyEl.innerHTML = hHtml;

    // Attach resume button handlers
    var resumeButtons = historyEl.querySelectorAll('[data-resume-history]');
    for (var b = 0; b < resumeButtons.length; b++) {
      resumeButtons[b].addEventListener('click', function(this: HTMLElement) {
        var idx = parseInt(this.getAttribute('data-resume-history') || '-1', 10);
        var type = this.getAttribute('data-resume-type') || '';
        var appId = this.getAttribute('data-resume-appid') || '';
        resumeFromHistory(idx, type, appId);
      });
    }

    // Attach remove history button handlers
    var removeButtons = historyEl.querySelectorAll('[data-remove-history]');
    for (var r = 0; r < removeButtons.length; r++) {
      removeButtons[r].addEventListener('click', function(this: HTMLElement) {
        var id = this.getAttribute('data-remove-history');
        if (id) {
          fetch(downloadsQueueRemoveHistoryUrl(id), { method: 'POST', mode: 'cors', cache: 'no-store' })
            .then(function() { renderCards(); })
            .catch(function() {});
        }
      });
    }
  }

  function renderCards() {
    if (seq !== _downloadsPollSeq) return;

    // Fetch queue from bridge
    fetch(downloadsQueueUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (seq !== _downloadsPollSeq) return;
        if (!data || !data.ok) return;

        // Always render history from bridge (even when no active downloads)
        renderHistory(data.history || []);

        // Detect completed depot downloads and show restart dialog (only if completed within last 30s)
        var history = data.history || [];
        var nowSec = Date.now() / 1000;
        for (var h of history) {
          if (h.status === 'completed' && h.appId && !_shownDepotCompletions[h.id]) {
            var completedAt = h.completedAt || 0;
            if (nowSec - completedAt < 30) {
              _shownDepotCompletions[h.id] = true;
              applyInLibraryState(String(h.appId));
              showSteamRestartDialog(String(h.appId), h.gameName || 'App ' + h.appId);
            }
          }
        }

        var queue = data.queue || [];
        var cardsHtml = '';

        if (queue.length === 0 && state.activeDownloads.length === 0) {
          cardsHtml = '<div style="text-align:center;padding:24px;color:#8f98a0;">' +
            '<div style="margin-bottom:8px;font-size:24px;opacity:.3;">' + svgDownload() + '</div>' +
            '<div style="font-size:13px;">No active downloads</div>' +
            '<div style="font-size:11px;margin-top:4px;opacity:.6;">Start a download from any game page</div>' +
            '</div>';
          listEl.innerHTML = cardsHtml;
          return;
        }

        // Source downloads (from extension - kept for backwards compat)
        for (var i = 0; i < state.activeDownloads.length; i++) {
          var dl = state.activeDownloads[i];
          var speeds = computeSpeed(dl.requestId, dl.bytesDownloaded);
          dl.speed = speeds.speed;
          var speedHist = getSpeedHistory(dl.requestId);
          cardsHtml += renderActiveCard({
            jobId: dl.requestId,
            gameName: 'App ' + dl.appId,
            appId: dl.appId,
            phase: dl.phase || 'Downloading',
            progress: dl.progress,
            speed: dl.speed,
            peak: speeds.peak,
            bytesDownloaded: dl.bytesDownloaded,
            totalBytes: dl.totalBytes,
            history: speedHist,
            type: 'source',
            status: 'downloading',
          });
        }

        // Depot downloads from queue
        for (var j = 0; j < queue.length; j++) {
          var item = queue[j];
          var dSpeeds = computeSpeed(item.id, item.bytesDownloaded);
          var dHistory = getSpeedHistory(item.id);
          var position = item.status === 'queued' ? ' (Queued #' + (j + 1) + ')' : '';
          cardsHtml += renderActiveCard({
            jobId: item.id,
            gameName: item.gameName || 'App ' + item.appId,
            appId: String(item.appId),
            phase: (item.status === 'downloading' ? 'Downloading' : item.status === 'queued' ? 'Queued' : item.status === 'interrupted' ? 'Interrupted — resuming...' : item.status) + position,
            progress: item.progress,
            speed: dSpeeds.speed,
            peak: dSpeeds.peak,
            bytesDownloaded: item.bytesDownloaded,
            totalBytes: item.totalBytes,
            history: dHistory,
            type: 'depot',
            status: item.status,
          });
        }

        listEl.innerHTML = cardsHtml;

        // Wire up cancel buttons
        listEl.querySelectorAll('[data-cancel-job]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var jobId = btn.getAttribute('data-cancel-job');
            var jobType = btn.getAttribute('data-job-type');
            if (jobType === 'depot' && jobId) {
              cancelDepotDownload(jobId);
            } else if (jobType === 'source' && jobId) {
              cancelSourceDownload(jobId);
            }
          });
        });

        // Wire up pause buttons
        listEl.querySelectorAll('[data-pause-job]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var jobId = btn.getAttribute('data-pause-job');
            var jobType = btn.getAttribute('data-job-type');
            if (jobType === 'depot' && jobId) {
              pauseDepotDownload(jobId);
            }
          });
        });

        // Wire up resume buttons
        listEl.querySelectorAll('[data-resume-job]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var jobId = btn.getAttribute('data-resume-job');
            var jobType = btn.getAttribute('data-job-type');
            if (jobType === 'depot' && jobId) {
              resumeDepotDownload(jobId);
            }
          });
        });
      })
      .catch(function() {});
  }

  renderCards();

  // Poll for updates
  function pollDownloads() {
    if (seq !== _downloadsPollSeq) return;
    pollSourceDownloads(seq);
    renderCards(); // Also renders history from bridge
    _downloadsPollTimer = setTimeout(pollDownloads, 1500);
  }
  _downloadsPollTimer = setTimeout(pollDownloads, 1500);
}

function renderActiveCard(opts: {
  jobId: string; gameName: string; appId: string; phase: string;
  progress: number; speed: number; peak: number;
  bytesDownloaded: number; totalBytes: number; history: number[];
  type: string; status: string;
}): string {
  var pct = Math.max(0, Math.min(100, opts.progress || 0));
  var isAnimating = opts.status === 'downloading' || opts.status === 'resolving' || opts.status === 'extracting' || opts.status === 'processing' || opts.status === 'queued' || opts.status === 'interrupted';

  var h = '<div style="position:relative;border-radius:10px;overflow:hidden;margin-bottom:10px;background:linear-gradient(135deg,#1b2838,#0e1721);border:1px solid rgba(102,192,255,.1);min-height:120px;">';

  // Gradient overlay
  h += '<div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(102,192,255,.05),transparent 60%);pointer-events:none;"></div>';

  // Content
  h += '<div style="position:relative;z-index:1;padding:14px 16px;display:flex;flex-direction:column;gap:10px;">';

  // Header
  h += '<div style="display:flex;align-items:center;justify-content:space-between;">';
  h += '<div style="display:flex;align-items:center;gap:8px;min-width:0;">';
  h += '<div style="width:8px;height:8px;border-radius:50%;background:#67e8f9;flex-shrink:0;' + (isAnimating ? 'animation:luma_ssh_pulse 2s infinite;' : '') + '"></div>';
  h += '<div style="min-width:0;">';
  h += '<div style="font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(opts.gameName) + '</div>';
  h += '<div style="font-size:10px;color:#8f98a0;">App ID: ' + opts.appId + (opts.type === 'depot' ? ' \u00b7 Depot' : '') + '</div>';
  h += '</div></div>';

  // Status badge
  h += '<div style="padding:3px 8px;border-radius:8px;font-size:10px;font-weight:700;background:rgba(103,232,249,.12);color:#67e8f9;">ACTIVE</div>';
  h += '</div>';

  // Progress info
  h += '<div>';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
  h += '<span style="font-size:11px;color:#8f98a0;">' + escapeHtml(opts.phase) + '</span>';
  h += '<span style="font-size:12px;font-weight:700;color:#fff;">' + pct.toFixed(1) + '%</span>';
  h += '</div>';

  // Progress bar
  h += '<div style="height:5px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden;">';
  h += '<div style="height:100%;border-radius:3px;transform-origin:left;transition:transform .3s ease;transform:scaleX(' + (pct / 100) + ');';
  h += isAnimating ? 'background:linear-gradient(90deg,#66c0ff,#67e8f9);' : 'background:#66c0ff;';
  h += '"></div></div>';

  // Size info
  if (opts.totalBytes > 0) {
    h += '<div style="font-size:10px;color:#8f98a0;margin-top:4px;">' + formatBytes(opts.bytesDownloaded) + ' / ' + formatBytes(opts.totalBytes) + '</div>';
  }
  h += '</div>';

  // Capsule bar (speed + chart + controls)
  h += '<div style="display:flex;align-items:center;gap:0;background:rgba(0,0,0,.4);backdrop-filter:blur(8px);border-radius:8px;padding:8px 12px;">';

  // Speed
  h += '<div style="min-width:80px;display:flex;flex-direction:column;align-items:center;">';
  h += '<span style="font-size:8px;text-transform:uppercase;color:rgba(255,255,255,.4);letter-spacing:.5px;">Speed</span>';
  h += '<span style="font-size:14px;font-weight:700;color:#fff;">' + formatSpeed(opts.speed) + '</span>';
  if (opts.peak > 0) {
    h += '<span style="font-size:8px;color:rgba(255,255,255,.3);">Peak ' + formatSpeed(opts.peak) + '</span>';
  }
  h += '</div>';

  h += '<div style="width:1px;height:28px;background:rgba(255,255,255,.1);margin:0 8px;"></div>';

  // Speed chart
  h += '<div style="flex:1;display:flex;align-items:flex-end;gap:2px;height:32px;">';
  var hist = opts.history;
  if (hist.length > 0) {
    var maxSpeed = Math.max.apply(null, hist) || 1;
    var startIdx = Math.max(0, hist.length - 18);
    for (var k = startIdx; k < hist.length; k++) {
      var barH = Math.max(4, (hist[k] / maxSpeed) * 100);
      h += '<div style="flex:1;height:' + barH + '%;background:rgba(103,232,249,.6);border-radius:2px 2px 0 0;min-height:4px;"></div>';
    }
  } else {
    for (var m = 0; m < 12; m++) {
      h += '<div style="flex:1;height:4px;background:rgba(255,255,255,.1);border-radius:2px;"></div>';
    }
  }
  h += '</div>';

  h += '<div style="width:1px;height:28px;background:rgba(255,255,255,.1);margin:0 8px;"></div>';

  // Controls
  h += '<div style="display:flex;gap:4px;">';
  if (opts.type === 'depot') {
    var isPaused = opts.status === 'paused';
    var btnLabel = isPaused ? '\u25b6' : '\u23f8';
    var btnTitle = isPaused ? 'Resume' : 'Pause';
    var btnAction = isPaused ? 'resume-job' : 'pause-job';
    h += '<button data-' + btnAction + '="' + opts.jobId + '" data-job-type="depot" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;" title="' + btnTitle + '">' + btnLabel + '</button>';
  }
  h += '<button data-cancel-job="' + opts.jobId + '" data-job-type="' + opts.type + '" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(231,76,60,.3);background:none;color:#e74c3c;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;" title="Cancel">\u2715</button>';
  h += '</div>';

  h += '</div>'; // capsule
  h += '</div>'; // content
  h += '</div>'; // card
  return h;
}

// ---------------------------------------------------------------------------
// Poll source downloads
// ---------------------------------------------------------------------------
function pollSourceDownloads(seq: number) {
  for (var i = 0; i < state.activeDownloads.length; i++) {
    var dl = state.activeDownloads[i];
    (function(download) {
      fetch(bridgeUrl('/api/download-status/' + download.requestId), { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (_downloadsPollSeq !== seq) return;
          if (!data || !data.ok) return;
          download.phase = data.message || data.status || '';
          download.progress = data.progress || 0;
          download.bytesDownloaded = data.bytesRead || data.bytesDownloaded || 0;
          download.totalBytes = data.totalBytes || 0;
          if (data.status === 'completed' || data.status === 'failed') {
            clearSpeedSamples(download.requestId);
            state.activeDownloads = state.activeDownloads.filter(function(j) { return j.requestId !== download.requestId; });
            // Source download history tracked in-memory (not in bridge queue)
            state.downloadHistory.unshift({
              id: download.requestId, appId: download.appId, gameName: download.gameName,
              type: 'source', status: data.status, timestamp: Date.now(),
              progress: data.progress || 100, bytesDownloaded: data.bytesRead || data.bytesDownloaded || 0, totalBytes: data.totalBytes || 0,
            });
            if (state.downloadHistory.length > 10) state.downloadHistory.length = 10;
            saveSessionState();
            // Let the dashboard refresh lua cards / active list
            try { if (state.onDownloadSettled) state.onDownloadSettled(); } catch (_) {}
          }
        })
        .catch(function() {});
    })(dl);
  }
}

function stopDownloadsPoll() {
  _downloadsPollSeq++;
  if (_downloadsPollTimer) {
    clearTimeout(_downloadsPollTimer);
    _downloadsPollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Cancel / Pause depot download
// ---------------------------------------------------------------------------
function cancelDepotDownload(jobId: string) {
  fetch(downloadsQueueRemoveUrl(jobId), { method: 'POST', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function() {
      clearSpeedSamples(jobId);
      renderDownloadsTab(document.querySelector('.luma-sidebar-content') as HTMLElement);
    })
    .catch(function() {});
}

// ---------------------------------------------------------------------------
// Resume download from history
// ---------------------------------------------------------------------------
function resumeFromHistory(idx: number, type: string, appId: string) {
  if (type === 'depot') {
    closeSidebar();
    openDepotModal(appId);
  } else {
    closeSidebar();
    openSourceModal(appId);
  }
}

function cancelSourceDownload(requestId: string) {
  // Source downloads don't have a cancel endpoint, just remove from tracking
  state.activeDownloads = state.activeDownloads.filter(function(d) { return d.requestId !== requestId; });
  clearSpeedSamples(requestId);
  renderDownloadsTab(document.querySelector('.luma-sidebar-content') as HTMLElement);
}

function pauseDepotDownload(queueId: string) {
  fetch(bridgeUrl('/api/downloads-queue/pause/' + queueId), { method: 'POST', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .catch(function() {});
}

function resumeDepotDownload(queueId: string) {
  fetch(bridgeUrl('/api/downloads-queue/resume/' + queueId), { method: 'POST', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .catch(function() {});
}

// ---------------------------------------------------------------------------
// Tools tab
// ---------------------------------------------------------------------------
function stopToolsPoll() {
  _toolsPollSeq++;
  if (_toolsPollTimer) {
    clearTimeout(_toolsPollTimer);
    _toolsPollTimer = null;
  }
}

function renderToolsTab(container: HTMLElement) {
  stopToolsPoll();
  var seq = ++_toolsPollSeq;

  var html = '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Third-Party Tools</div>';
  html += '<div id="luma-tools-list"><div style="text-align:center;padding:24px;color:#8f98a0;">' + svgSpinner() + ' Loading tools…</div></div>';
  html += '</div>';
  html += '<div class="luma-sidebar-section" style="margin-top:12px;"><div class="luma-sidebar-section-title">Steam Integration</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
  html += '<button class="luma-sidebar-btn secondary" id="luma-tools-restart-steam">Restart Steam</button>';
  html += '</div></div>';
  container.innerHTML = html;

  var restartBtn = document.getElementById('luma-tools-restart-steam');
  if (restartBtn) {
    restartBtn.addEventListener('click', function() {
      restartBtn.textContent = 'Restarting...';
      restartBtn.setAttribute('disabled', 'true');
      fetch(restartSteamUrl(), { method: 'POST', mode: 'cors', cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.ok) {
            restartBtn.textContent = 'Restarted!';
            setTimeout(function() { restartBtn.textContent = 'Restart Steam'; restartBtn.removeAttribute('disabled'); }, 2000);
          } else {
            restartBtn.textContent = 'Failed';
            setTimeout(function() { restartBtn.textContent = 'Restart Steam'; restartBtn.removeAttribute('disabled'); }, 2000);
          }
        })
        .catch(function() {
          restartBtn.textContent = 'Error';
          setTimeout(function() { restartBtn.textContent = 'Restart Steam'; restartBtn.removeAttribute('disabled'); }, 2000);
        });
    });
  }

  var listEl = document.getElementById('luma-tools-list');

  function badge(label: string, bg: string, color: string): string {
    return '<span style="padding:2px 7px;border-radius:6px;font-size:9px;font-weight:700;background:' + bg + ';color:' + color + ';">' + esc(label) + '</span>';
  }

  function renderToolRows(tools: any[]) {
    if (seq !== _toolsPollSeq) return;
    if (!listEl || !document.getElementById('luma-tools-list')) return;

    if (!tools || tools.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#8f98a0;">No tools available</div>';
      return;
    }

    var rows = '';
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      var job = t.job || null;
      var busy = job && (job.status === 'running' || job.status === 'restarting');
      var jobError = job && job.status === 'error';

      rows += '<div class="luma-stat-card" style="flex-direction:column;align-items:stretch;gap:8px;" data-tool="' + esc(t.id) + '">';

      // Header: name + badges
      rows += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">';
      rows += '<div style="min-width:0;">';
      rows += '<div style="font-size:13px;font-weight:600;color:#fff;">' + esc(t.name) + '</div>';
      rows += '<div style="font-size:10px;color:#8f98a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(t.description || '') + '</div>';
      rows += '</div>';
      rows += '<div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">';
      if (!t.available) {
        rows += badge(t.platform === 'windows' ? 'Windows only' : 'Linux only', 'rgba(255,255,255,.06)', '#8f98a0');
      } else {
        if (t.installed) {
          rows += badge(t.installedVersion ? 'Installed v' + t.installedVersion : 'Installed', 'rgba(100,200,130,.15)', '#64c882');
        }
        if (t.updateAvailable && t.latestVersion) {
          rows += badge('Update → ' + t.latestVersion, 'rgba(102,192,255,.15)', '#66c0ff');
        }
        if (busy) {
          rows += badge(job.status === 'restarting' ? 'Restarting…' : (job.op + ' ' + job.progress + '%'), 'rgba(251,191,36,.15)', '#fbbf24');
        }
      }
      rows += '</div>';
      rows += '</div>';

      // Job message / error
      if (jobError && job.message) {
        rows += '<div style="font-size:10px;color:#e74c3c;">' + esc(job.message) + '</div>';
      } else if (busy && job.message) {
        rows += '<div style="font-size:10px;color:#fbbf24;">' + esc(job.message) + '</div>';
        if (job.status === 'running') {
          var pct = Math.max(0, Math.min(100, job.progress || 0));
          rows += '<div style="height:3px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden;">';
          rows += '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#66c0ff,#67e8f9);border-radius:2px;transition:width .3s;"></div>';
          rows += '</div>';
        }
      }

      // Buttons
      if (t.available) {
        rows += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        if (!t.installed) {
          rows += '<button class="luma-sidebar-btn primary" data-tool-action="install" data-tool-id="' + esc(t.id) + '"' + (busy ? ' disabled style="opacity:.5;cursor:default;"' : '') + '>Install</button>';
        } else {
          if (t.updateAvailable) {
            rows += '<button class="luma-sidebar-btn primary" data-tool-action="update" data-tool-id="' + esc(t.id) + '"' + (busy ? ' disabled style="opacity:.5;cursor:default;"' : '') + '>Update</button>';
          }
          rows += '<button class="luma-sidebar-btn secondary" data-tool-action="uninstall" data-tool-id="' + esc(t.id) + '"' + (busy ? ' disabled style="opacity:.5;cursor:default;"' : '') + '>Uninstall</button>';
        }
        rows += '</div>';
      }

      rows += '</div>';
    }

    listEl.innerHTML = rows;

    var buttons = listEl.querySelectorAll('[data-tool-action]');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener('click', function(this: HTMLElement) {
        var action = this.getAttribute('data-tool-action') || '';
        var id = this.getAttribute('data-tool-id') || '';
        if (!id || !action) return;
        this.setAttribute('disabled', 'true');
        (this as HTMLElement).style.opacity = '0.5';
        var url = action === 'install' ? toolInstallUrl(id)
          : action === 'update' ? toolUpdateUrl(id)
          : toolUninstallUrl(id);
        fetch(url, { method: 'POST', mode: 'cors', cache: 'no-store' })
          .then(function(r) { return r.json(); })
          .then(function() { /* list poll picks up job status */ })
          .catch(function() {
            renderTools();
          });
      });
    }
  }

  function renderTools() {
    if (seq !== _toolsPollSeq) return;
    fetch(toolsUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (seq !== _toolsPollSeq) return;
        if (data && data.ok) renderToolRows(data.tools || []);
      })
      .catch(function() {
        if (seq !== _toolsPollSeq) return;
        if (listEl) {
          listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#e74c3c;">' +
            '<div style="margin-bottom:8px;">' + svgErrorCircle() + '</div>' +
            '<div style="font-size:12px;">Bridge not available</div>' +
            '<div style="font-size:10px;color:#8f98a0;margin-top:4px;">Make sure the CDP proxy is running</div>' +
            '</div>';
        }
      });
  }

  renderTools();

  function pollTools() {
    if (seq !== _toolsPollSeq) return;
    if (!document.getElementById('luma-tools-list')) return;
    renderTools();
    _toolsPollTimer = setTimeout(pollTools, 1500);
  }
  _toolsPollTimer = setTimeout(pollTools, 1500);
}

// ---------------------------------------------------------------------------
// Fixes tab — list games with applied fixes + Unfix per type
// ---------------------------------------------------------------------------
function stopFixesPoll() {
  _fixesPollSeq++;
  if (_fixesPollTimer) {
    clearTimeout(_fixesPollTimer);
    _fixesPollTimer = null;
  }
}

var FIX_APPLIED_MAP: Array<{ appliedKey: string; label: string; tool: string; fixType?: string }> = [
  { appliedKey: 'smokeApi', label: 'SmokeAPI', tool: 'smokeapi' },
  { appliedKey: 'steamless', label: 'Steamless', tool: 'steamless' },
  { appliedKey: 'goldberg', label: 'Goldberg', tool: 'goldberg' },
  { appliedKey: 'onlineFix', label: 'Online-Fix', tool: 'online_fix' },
  { appliedKey: 'RockstarFix', label: 'Rockstar Fix', tool: 'catalog', fixType: 'RockstarFix' },
  { appliedKey: 'Voices38Fix', label: 'Voices38 Fix', tool: 'catalog', fixType: 'Voices38Fix' },
];

function renderFixesTab(container: HTMLElement) {
  stopFixesPoll();
  var seq = ++_fixesPollSeq;

  var html = '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Applied Fixes</div>';
  html += '<div id="luma-fixes-applied-list"><div style="text-align:center;padding:24px;color:#8f98a0;">' + svgSpinner() + ' Scanning fix logs…</div></div>';
  html += '</div>';
  html += '<div class="luma-sidebar-section" style="margin-top:12px;"><div class="luma-sidebar-section-title">Notes</div>';
  html += '<div style="font-size:11px;color:#8f98a0;line-height:1.6;">';
  html += '<div>Fixes are tracked per game in <code style="background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;">lumaforge-fix-log-&lt;appid&gt;.log</code>.</div>';
  html += '<div style="margin-top:4px;">Unfix removes the pasted files and restores any <code style="background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;">.bak</code> backups.</div>';
  html += '</div></div>';
  container.innerHTML = html;

  var listEl = document.getElementById('luma-fixes-applied-list');

  function badge(label: string, bg: string, color: string): string {
    return '<span style="padding:2px 7px;border-radius:6px;font-size:9px;font-weight:700;background:' + bg + ';color:' + color + ';">' + esc(label) + '</span>';
  }

  function renderRows(games: Array<{ appId: string; name: string; applied: Record<string, boolean> }>) {
    if (seq !== _fixesPollSeq || !listEl || !document.getElementById('luma-fixes-applied-list')) return;

    if (!games || games.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#8f98a0;">No fixes applied yet</div>';
      return;
    }

    var rows = '';
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      var active = FIX_APPLIED_MAP.filter(function (m) { return g.applied[m.appliedKey]; });

      rows += '<div class="luma-stat-card" style="flex-direction:column;align-items:stretch;gap:8px;" data-fix-game="' + esc(g.appId) + '">';
      rows += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">';
      rows += '<div style="min-width:0;">';
      rows += '<div style="font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(g.name) + '</div>';
      rows += '<div style="font-size:10px;color:#8f98a0;">App ' + esc(g.appId) + '</div>';
      rows += '</div>';
      rows += '<div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">';
      for (var j = 0; j < active.length; j++) {
        rows += badge(active[j].label, 'rgba(100,200,130,.15)', '#64c882');
      }
      rows += '</div>';
      rows += '</div>';

      rows += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
      for (var k = 0; k < active.length; k++) {
        var m = active[k];
        rows += '<button class="luma-sidebar-btn secondary" data-fix-unfix-app="' + esc(g.appId) + '" data-fix-unfix-tool="' + esc(m.tool) + '"' +
          (m.fixType ? ' data-fix-unfix-type="' + esc(m.fixType) + '"' : '') +
          '>Unfix ' + esc(m.label) + '</button>';
      }
      rows += '</div>';
      rows += '</div>';
    }

    listEl.innerHTML = rows;

    var buttons = listEl.querySelectorAll('[data-fix-unfix-app]');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener('click', function(this: HTMLElement) {
        var appId = this.getAttribute('data-fix-unfix-app') || '';
        var tool = this.getAttribute('data-fix-unfix-tool') || '';
        var fixType = this.getAttribute('data-fix-unfix-type');
        if (!appId || !tool) return;
        this.setAttribute('disabled', 'true');
        this.style.opacity = '0.5';
        this.textContent = 'Unfixing…';
        var payload: any = { tool: tool };
        if (fixType) payload.fix_type = fixType;
        fetch(fixesUnfixUrl(appId), {
          method: 'POST',
          mode: 'cors',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then(function(r) { return r.json(); })
          .then(function() {
            setTimeout(function() { load(); }, 400);
          })
          .catch(function() {
            setTimeout(function() { load(); }, 400);
          });
      });
    }
  }

  function load() {
    if (seq !== _fixesPollSeq) return;
    fetch(fixesAppliedUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (seq !== _fixesPollSeq) return;
        var appIds: string[] = (d && d.appIds) ? d.appIds.map(function(a: any) { return String(a); }) : [];
        if (appIds.length === 0) {
          renderRows([]);
          return;
        }
        return Promise.all(appIds.map(function(appId) {
          return Promise.all([
            fetch(fixesInfoUrl(appId), { method: 'GET', mode: 'cors', cache: 'no-store' })
              .then(function(r) { return r.json(); })
              .catch(function() { return null; }),
            fetch(fixesStatusUrl(appId), { method: 'GET', mode: 'cors', cache: 'no-store' })
              .then(function(r) { return r.json(); })
              .catch(function() { return null; }),
          ]).then(function(res) {
            var info = res[0] && res[0].info;
            var status = res[1];
            return {
              appId: appId,
              name: (info && info.name) || ('App ' + appId),
              applied: (status && status.applied) || {},
            };
          });
        }));
      })
      .then(function(games) {
        if (seq !== _fixesPollSeq) return;
        if (games) renderRows(games as any);
      })
      .catch(function() {
        if (seq !== _fixesPollSeq || !listEl) return;
        listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#e74c3c;">' +
          '<div style="margin-bottom:8px;">' + svgErrorCircle() + '</div>' +
          '<div style="font-size:12px;">Bridge not available</div>' +
          '</div>';
      });
  }

  load();

  function pollFixes() {
    if (seq !== _fixesPollSeq) return;
    if (!document.getElementById('luma-fixes-applied-list')) return;
    load();
    _fixesPollTimer = setTimeout(pollFixes, 3000);
  }
  _fixesPollTimer = setTimeout(pollFixes, 3000);
}

// ---------------------------------------------------------------------------
// Settings tab (about)
// ---------------------------------------------------------------------------
function renderSettingsTab(container: HTMLElement) {
  var html = '';

  // ── Steam Account ──
  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Steam Account</div>';
  html += '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:12px;">';
  html += '<div style="font-size:11px;color:#8f98a0;margin-bottom:4px;">Steam Web API Key <span style="color:#66c0ff;">(Goldberg achievements)</span></div>';
  html += '<div style="display:flex;gap:6px;margin-bottom:6px;">';
  html += '<input id="luma-steam-apikey" type="password" placeholder="Enter your Steam Web API key" style="flex:1;min-width:0;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:7px 9px;color:#fff;font-size:12px;outline:none;" />';
  html += '<button type="button" id="luma-steam-apikey-eye" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#8f98a0;font-size:11px;padding:0 10px;cursor:pointer;">Show</button>';
  html += '</div>';
  html += '<button type="button" id="luma-steam-getkey" style="background:rgba(102,192,255,.1);border:1px solid rgba(102,192,255,.3);border-radius:6px;color:#66c0ff;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer;">Get API key \u2197</button>';
  html += '<div style="font-size:11px;color:#8f98a0;margin:10px 0 4px;">SteamID64 <span style="color:#66c0ff;">(Voices38 / catalog fixes)</span></div>';
  html += '<input id="luma-steam-id64" type="text" placeholder="76561197960265728" style="width:100%;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:7px 9px;color:#fff;font-size:12px;outline:none;margin-bottom:8px;" />';
  html += '<div style="font-size:11px;color:#8f98a0;margin-bottom:4px;">SteamID32 (Account ID)</div>';
  html += '<input id="luma-steam-id32" type="text" placeholder="12345678" style="width:100%;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:7px 9px;color:#fff;font-size:12px;outline:none;margin-bottom:10px;" />';
  html += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">';
  html += '<button type="button" id="luma-steam-detect" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer;">Detect Steam account</button>';
  html += '<span id="luma-steam-acct" style="font-size:10px;color:#8f98a0;"></span>';
  html += '</div>';
  html += '<div id="luma-steam-accounts" style="margin-bottom:8px;"></div>';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<button type="button" id="luma-steam-save" style="background:rgba(46,160,67,.15);border:1px solid rgba(46,160,67,.4);border-radius:6px;color:#64c882;font-size:11px;font-weight:700;padding:6px 14px;cursor:pointer;">Save</button>';
  html += '<span id="luma-steam-status" style="font-size:11px;color:#64c882;"></span>';
  html += '</div>';
  html += '</div></div>';

  // ── Steam Keys ──
  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Steam Keys</div>';
  html += '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:12px;">';
  html += '<div style="font-size:11px;color:#8f98a0;margin-bottom:8px;">Manifest pinning for generated Lua scripts</div>';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<button type="button" id="luma-sk-unpin-all" style="background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.35);border-radius:6px;color:#e74c3c;font-size:11px;font-weight:700;padding:6px 14px;cursor:pointer;">Unpin All Manifests</button>';
  html += '<span id="luma-sk-unpin-status" style="font-size:11px;color:#8f98a0;"></span>';
  html += '</div>';
  html += '</div></div>';

  // ── About ──
  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">About</div>';
  html += '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:12px;">';
  html += '<div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:8px;">Steam Store Helper</div>';
  html += '<div style="font-size:11px;color:#8f98a0;line-height:1.6;">';
  html += '<div>Version: ' + LUMA_VERSION + '</div>';
  html += '<div>TypeScript + Vite</div>';
  html += '<div>LumaForge CDP Proxy</div>';
  html += '</div></div></div>';
  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Keyboard Shortcuts</div>';
  html += '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:12px;">';
  html += '<div style="font-size:11px;color:#8f98a0;line-height:1.8;">';
  html += '<div><kbd style="background:rgba(255,255,255,.08);padding:2px 6px;border-radius:4px;font-size:10px;">Esc</kbd> Close sidebar</div>';
  html += '</div></div></div>';
  container.innerHTML = html;
  wireSteamAccountSection(container);
  wireSteamKeysSection(container);
}

function wireSteamKeysSection(container: HTMLElement) {
  var unpinAllBtn = container.querySelector('#luma-sk-unpin-all') as HTMLButtonElement;
  var statusEl = container.querySelector('#luma-sk-unpin-status') as HTMLElement;
  if (!unpinAllBtn || !statusEl) return;

  unpinAllBtn.addEventListener('click', function() {
    unpinAllBtn.disabled = true;
    unpinAllBtn.textContent = 'Unpinning\u2026';
    statusEl.textContent = '';
    fetch(steamKeysUnpinUrl(), {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 0 })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        unpinAllBtn.disabled = false;
        unpinAllBtn.textContent = 'Unpin All Manifests';
        if (data && data.ok) {
          statusEl.textContent = data.message || 'Done';
          statusEl.style.color = '#64c882';
        } else {
          statusEl.textContent = (data && data.message) || 'Failed';
          statusEl.style.color = '#e74c3c';
        }
      })
      .catch(function() {
        unpinAllBtn.disabled = false;
        unpinAllBtn.textContent = 'Unpin All Manifests';
        statusEl.textContent = 'Bridge not available';
        statusEl.style.color = '#e74c3c';
      });
  });
}

function wireSteamAccountSection(container: HTMLElement) {
  var apiKeyInput = container.querySelector('#luma-steam-apikey') as HTMLInputElement;
  var eyeBtn = container.querySelector('#luma-steam-apikey-eye') as HTMLButtonElement;
  var getkeyBtn = container.querySelector('#luma-steam-getkey') as HTMLButtonElement;
  var id64Input = container.querySelector('#luma-steam-id64') as HTMLInputElement;
  var id32Input = container.querySelector('#luma-steam-id32') as HTMLInputElement;
  var detectBtn = container.querySelector('#luma-steam-detect') as HTMLButtonElement;
  var acctEl = container.querySelector('#luma-steam-acct') as HTMLElement;
  var accountsEl = container.querySelector('#luma-steam-accounts') as HTMLElement;
  var saveBtn = container.querySelector('#luma-steam-save') as HTMLButtonElement;
  var statusEl = container.querySelector('#luma-steam-status') as HTMLElement;
  if (!apiKeyInput || !id64Input || !id32Input || !saveBtn) return;
  var accountName = '';

  // Load saved values
  fetch(steamAccountUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) return;
      apiKeyInput.value = data.apiKey || '';
      id64Input.value = data.steamId64 || '';
      id32Input.value = data.steamId32 || '';
      accountName = data.accountName || '';
      if (accountName) {
        acctEl.textContent = 'Account: ' + accountName;
        acctEl.style.color = '#64c882';
      }
    })
    .catch(function() {});

  if (eyeBtn) {
    eyeBtn.addEventListener('click', function() {
      var show = apiKeyInput.type === 'password';
      apiKeyInput.type = show ? 'text' : 'password';
      eyeBtn.textContent = show ? 'Hide' : 'Show';
    });
  }

  if (getkeyBtn) {
    getkeyBtn.addEventListener('click', function() {
      statusEl.textContent = 'Opening\u2026';
      statusEl.style.color = '#66c0ff';
      retryFetch(openUrlApi(), {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://steamcommunity.com/dev/apikey' })
      }, 'open-apikey', {})
        .then(function(r) { return r.json(); })
        .then(function(data) {
          statusEl.textContent = data.ok ? 'Opening steamcommunity.com\u2026' : (data.message || 'Failed');
          statusEl.style.color = data.ok ? '#64c882' : '#ff6e6e';
        })
        .catch(function() {
          statusEl.textContent = 'Failed to open URL';
          statusEl.style.color = '#ff6e6e';
        });
    });
  }

  if (detectBtn) {
    detectBtn.addEventListener('click', function() {
      accountsEl.innerHTML = '<div style="font-size:11px;color:#66c0ff;">Scanning loginusers.vdf\u2026</div>';
      fetch(steamAccountDetectUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.ok) {
            accountsEl.innerHTML = '<div style="font-size:11px;color:#ff6e6e;">' + esc(data.message || 'Detect failed') + '</div>';
            return;
          }
          var accounts = data.accounts || [];
          if (!accounts.length) {
            accountsEl.innerHTML = '<div style="font-size:11px;color:#8f98a0;">No accounts found in loginusers.vdf</div>';
            return;
          }
          var h = '';
          for (var i = 0; i < accounts.length; i++) {
            var a = accounts[i];
            h += '<button type="button" data-acct-idx="' + i + '" style="display:block;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:7px 9px;margin-bottom:5px;cursor:pointer;">';
            h += '<div style="font-size:12px;font-weight:600;color:#fff;">' + esc(a.personaName || a.accountName || a.steamId64) + '</div>';
            h += '<div style="font-size:10px;color:#8f98a0;">' + esc(a.accountName || '') + ' \u00b7 ' + esc(a.steamId64 || '') + ' \u00b7 ID32 ' + esc(a.steamId32 || '') + '</div>';
            h += '</button>';
          }
          accountsEl.innerHTML = h;
          var btns = accountsEl.querySelectorAll('[data-acct-idx]');
          for (var j = 0; j < btns.length; j++) {
            (function(btn) {
              btn.addEventListener('click', function() {
                var idx = parseInt(btn.getAttribute('data-acct-idx') || '0', 10);
                var acc = accounts[idx];
                if (!acc) return;
                id64Input.value = acc.steamId64 || '';
                id32Input.value = acc.steamId32 || '';
                accountName = acc.accountName || '';
                acctEl.textContent = 'Account: ' + (accountName || '\u2014');
                acctEl.style.color = '#64c882';
              });
            })(btns[j] as HTMLElement);
          }
        })
        .catch(function() {
          accountsEl.innerHTML = '<div style="font-size:11px;color:#ff6e6e;">Detect failed</div>';
        });
    });
  }

  saveBtn.addEventListener('click', function() {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving\u2026';
    retryFetch(steamAccountUrl(), {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: apiKeyInput.value.trim(),
        steamId64: id64Input.value.trim(),
        steamId32: id32Input.value.trim(),
        accountName: accountName
      })
    }, 'steam-account-save', {})
      .then(function(r) { return r.json(); })
      .then(function(data) {
        saveBtn.disabled = false;
        saveBtn.textContent = data.ok ? '\u2713 Saved' : 'Save';
        statusEl.textContent = data.ok ? '' : (data.message || 'Error');
        statusEl.style.color = data.ok ? '#64c882' : '#ff6e6e';
        if (data.ok) setTimeout(function() { saveBtn.textContent = 'Save'; }, 2000);
      })
      .catch(function() {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        statusEl.textContent = 'Save failed';
        statusEl.style.color = '#ff6e6e';
      });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s: string): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTimeAgo(timestamp: number): string {
  // Rust returns seconds, Date.now() returns milliseconds
  var tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  var diff = Date.now() - tsMs;
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  var days = Math.floor(hours / 24);
  return days + 'd ago';
}

// ---------------------------------------------------------------------------
// Open sidebar
// ---------------------------------------------------------------------------
export function openSidebar(initialTab?: string) {
  if (document.getElementById(SIDEBAR_ID)) return;
  ensureKeyframes();

  if (initialTab) state.currentTab = initialTab;
  state.sidebarOpen = true;
  saveSessionState();
  // Hide floating settings button while sidebar is open
  var settingsBtn = document.getElementById('luma-ssh-settings-btn') as HTMLElement | null;
  if (settingsBtn) settingsBtn.style.display = 'none';

  var backdrop = document.createElement('div');
  backdrop.id = BACKDROP_ID;
  backdrop.setAttribute('style', 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.4);z-index:10000;animation:luma_ssh_fade .15s ease;');
  backdrop.addEventListener('click', closeSidebar);

  var panel = document.createElement('div');
  panel.id = SIDEBAR_ID;
  panel.setAttribute('style',
    'position:fixed;top:0;right:0;width:380px;height:100vh;' +
    'background:#1b2838;border-left:1px solid rgba(102,192,255,.12);' +
    'box-shadow:-8px 0 32px rgba(0,0,0,.5);z-index:10001;' +
    'display:flex;flex-direction:column;font-family:"Motiva Sans",Arial,sans-serif;' +
    'animation:luma_ssh_slide .2s ease;'
  );

  var headerHtml = '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.15);">';
  headerHtml += '<div style="font-size:15px;font-weight:700;color:#fff;">LumaForge <span style="font-size:10px;color:#8f98a0;font-weight:400;">v' + LUMA_VERSION + '</span></div>';
  headerHtml += '<button class="luma-ssh-close-btn" style="background:none;border:none;color:#8f98a0;cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;">' + svgX() + '</button>';
  headerHtml += '</div>';

  var tabsHtml = '<div class="luma-sidebar-tabs" style="display:flex;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.1);padding:0 4px;">';
  for (var i = 0; i < TABS.length; i++) {
    var tab = TABS[i];
    tabsHtml += '<button class="luma-sidebar-tab' + (tab.id === state.currentTab ? ' active' : '') + '" data-tab="' + tab.id + '" style="flex:1;padding:10px 4px;text-align:center;font-size:11px;font-weight:600;color:#8f98a0;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s ease;">' + tab.label + '</button>';
  }
  tabsHtml += '</div>';

  var contentHtml = '<div class="luma-sidebar-content" style="flex:1;overflow-y:auto;padding:16px 20px;"></div>';

  var footerHtml = '<div style="padding:12px 20px;border-top:1px solid rgba(255,255,255,.06);font-size:10px;color:#8f98a0;display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,.1);">';
  footerHtml += '<span>Steam Store Helper</span>';
  footerHtml += '<span>LumaForge CDP Proxy</span>';
  footerHtml += '</div>';

  panel.innerHTML = headerHtml + tabsHtml + contentHtml + footerHtml;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  var closeBtn = panel.querySelector('.luma-ssh-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

  var tabBtns = panel.querySelectorAll('.luma-sidebar-tab');
  for (var j = 0; j < tabBtns.length; j++) {
    tabBtns[j].addEventListener('click', function(this: HTMLElement) {
      var tabId = this.getAttribute('data-tab');
      if (tabId) switchTab(tabId);
    });
  }

  document.addEventListener('keydown', function handler(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeSidebar();
      document.removeEventListener('keydown', handler);
    }
  });

  renderTabContent(state.currentTab);
}
