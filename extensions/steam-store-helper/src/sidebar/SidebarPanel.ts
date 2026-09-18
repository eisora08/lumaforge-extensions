import { state, MODAL_MARKER_ATTR, MODAL_MARKER_VAL } from '../core/state';
import { svgX, svgGear, svgSpinner, svgCheck, svgErrorCircle, svgRefresh, svgDownload, svgBox } from '../ui/svg';
import { ensureKeyframes } from '../ui/styles';
import { bridgeUrl, depotsUrl, restartSteamUrl } from '../ui/helpers';
import { formatBytes, escapeHtml } from '../ui/dom';
import { retryFetch } from '../api/bridge';

var SIDEBAR_ID = 'luma-sidebar-panel';
var BACKDROP_ID = 'luma-sidebar-backdrop';
var LUMA_VERSION = '2.6.0';

var currentTab = 'downloads';
var _downloadsPollTimer: ReturnType<typeof setTimeout> | null = null;
var _downloadsPollSeq = 0;

var TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'providers', label: 'Providers' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'tools', label: 'Tools' },
  { id: 'settings', label: 'Settings' },
];

function closeSidebar() {
  var panel = document.getElementById(SIDEBAR_ID);
  var backdrop = document.getElementById(BACKDROP_ID);
  if (panel) panel.remove();
  if (backdrop) backdrop.remove();
  stopDownloadsPoll();
}

function switchTab(tabId: string) {
  currentTab = tabId;
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

  switch (tabId) {
    case 'dashboard': renderDashboardTab(content as HTMLElement); break;
    case 'providers': renderProvidersTab(content as HTMLElement); break;
    case 'downloads': renderDownloadsTab(content as HTMLElement); break;
    case 'tools': renderToolsTab(content as HTMLElement); break;
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
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px;">';
  html += '<div class="luma-stat-card"><div class="luma-stat-icon blue">' + svgGear() + '</div><div><div class="luma-stat-value" id="luma-dash-providers">--</div><div class="luma-stat-label">Active Providers</div></div></div>';
  html += '<div class="luma-stat-card"><div class="luma-stat-icon green">' + svgDownload() + '</div><div><div class="luma-stat-value" id="luma-dash-downloads">' + (state.activeDownloads.length + state.activeDepotJobs.length) + '</div><div class="luma-stat-label">Active Downloads</div></div></div>';
  html += '</div>';

  // Active downloads list
  if (state.activeDownloads.length > 0 || state.activeDepotJobs.length > 0) {
    html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Active Now</div>';
    for (var i = 0; i < state.activeDownloads.length; i++) {
      var dl = state.activeDownloads[i];
      html += '<div class="luma-stat-card" style="margin-bottom:6px;"><div class="luma-stat-icon blue">' + svgDownload() + '</div><div style="flex:1;min-width:0;">';
      html += '<div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">App ' + dl.appId + '</div>';
      html += '<div style="font-size:10px;color:#8f98a0;">' + escapeHtml(dl.phase || 'Downloading') + '</div>';
      html += '</div></div>';
    }
    for (var j = 0; j < state.activeDepotJobs.length; j++) {
      var job = state.activeDepotJobs[j];
      html += '<div class="luma-stat-card" style="margin-bottom:6px;"><div class="luma-stat-icon orange">' + svgBox() + '</div><div style="flex:1;min-width:0;">';
      html += '<div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(job.gameName || 'App ' + job.appId) + '</div>';
      html += '<div style="font-size:10px;color:#8f98a0;">' + escapeHtml(job.phase || job.status) + '</div>';
      html += '</div></div>';
    }
    html += '</div>';
  }

  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Quick Actions</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
  html += '<button class="luma-sidebar-btn secondary" id="luma-dash-refresh">Refresh</button>';
  html += '</div></div>';
  container.innerHTML = html;

  var refreshBtn = document.getElementById('luma-dash-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function() { renderDashboardTab(container); });

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
        h += '<div class="luma-provider-row" data-provider-idx="' + i + '" data-provider-id="' + esc(p.id) + '" style="flex-direction:column;align-items:stretch;gap:8px;">';

        // Row 1: name + toggle
        h += '<div style="display:flex;align-items:center;justify-content:space-between;">';
        h += '<div style="display:flex;align-items:center;gap:8px;min-width:0;">';
        h += '<button class="luma-toggle' + (p.enabled ? ' on' : '') + '" data-toggle="' + i + '"></button>';
        h += '<div style="min-width:0;">';
        h += '<div style="font-size:13px;font-weight:600;color:#fff;">' + esc(p.name) + '</div>';
        h += '<div style="font-size:10px;color:#8f98a0;">' + (p.hasKey ? 'API key configured' : 'No API key') + '</div>';
        h += '</div></div>';
        h += '<span class="luma-provider-test-status" data-test-status="' + i + '" style="font-size:10px;color:#8f98a0;"></span>';
        h += '</div>';

        // Row 2: URL
        h += '<div style="display:flex;align-items:center;gap:6px;">';
        h += '<label style="font-size:10px;color:#8f98a0;width:32px;flex-shrink:0;">URL</label>';
        h += '<input type="text" data-provider-url="' + i + '" value="' + esc(p.baseUrl || '') + '" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:5px 8px;color:#fff;font-size:11px;font-family:monospace;outline:none;">';
        h += '</div>';

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
    var keyInput = row.querySelector('[data-provider-key]') as HTMLInputElement;

    providers.push({
      id: id,
      name: id!.charAt(0).toUpperCase() + id!.slice(1),
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
  container.innerHTML = html;

  var listEl = document.getElementById('luma-downloads-list');
  if (!listEl) return;

  function renderCards() {
    if (seq !== _downloadsPollSeq) return;
    var cardsHtml = '';

    var activeSource = state.activeDownloads;
    var activeDepot = state.activeDepotJobs;

    if (activeSource.length === 0 && activeDepot.length === 0) {
      cardsHtml = '<div style="text-align:center;padding:24px;color:#8f98a0;">' +
        '<div style="margin-bottom:8px;font-size:24px;opacity:.3;">' + svgDownload() + '</div>' +
        '<div style="font-size:13px;">No active downloads</div>' +
        '<div style="font-size:11px;margin-top:4px;opacity:.6;">Start a download from any game page</div>' +
        '</div>';
      listEl.innerHTML = cardsHtml;
      return;
    }

    // Source downloads (from extension)
    for (var i = 0; i < state.activeDownloads.length; i++) {
      var dl = state.activeDownloads[i];
      var speeds = computeSpeed(dl.requestId, dl.bytesDownloaded);
      dl.speed = speeds.speed;
      var history = getSpeedHistory(dl.requestId);
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
        history: history,
        type: 'source',
        status: 'downloading',
      });
    }

    // Depot downloads (from depot modal)
    for (var j = 0; j < state.activeDepotJobs.length; j++) {
      var job = state.activeDepotJobs[j];
      var dSpeeds = computeSpeed(job.jobId, job.bytesDownloaded);
      job.speed = dSpeeds.speed;
      var dHistory = getSpeedHistory(job.jobId);
      cardsHtml += renderActiveCard({
        jobId: job.jobId,
        gameName: job.gameName || 'App ' + job.appId,
        appId: job.appId,
        phase: job.phase || job.status || 'Downloading',
        progress: job.progress,
        speed: job.speed,
        peak: dSpeeds.peak,
        bytesDownloaded: job.bytesDownloaded,
        totalBytes: job.totalBytes,
        history: dHistory,
        type: 'depot',
        status: job.status,
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
  }

  renderCards();

  // Poll for updates
  function pollDownloads() {
    if (seq !== _downloadsPollSeq) return;
    pollSourceDownloads(seq);
    pollDepotDownloads(seq);
    renderCards();
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
  var isAnimating = opts.status === 'downloading' || opts.status === 'resolving' || opts.status === 'extracting' || opts.status === 'processing' || opts.status === 'queued';

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
    h += '<button data-pause-job="' + opts.jobId + '" data-job-type="depot" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;" title="Pause">\u23f8</button>';
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
          }
        })
        .catch(function() {});
    })(dl);
  }
}

// ---------------------------------------------------------------------------
// Poll depot downloads
// ---------------------------------------------------------------------------
function pollDepotDownloads(seq: number) {
  for (var i = 0; i < state.activeDepotJobs.length; i++) {
    var job = state.activeDepotJobs[i];
    (function(download) {
      fetch(bridgeUrl('/api/depot-download-status/' + download.jobId), { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (_downloadsPollSeq !== seq) return;
          if (!data || !data.ok) return;
          download.phase = data.phase || data.message || data.status || '';
          download.progress = data.progress || 0;
          download.bytesDownloaded = data.bytesRead || data.bytesDownloaded || 0;
          download.totalBytes = data.totalBytes || 0;
          download.status = data.status || 'downloading';
          if (data.status === 'completed' || data.status === 'failed') {
            clearSpeedSamples(download.jobId);
            state.activeDepotJobs = state.activeDepotJobs.filter(function(j) { return j.jobId !== download.jobId; });
          }
        })
        .catch(function() {});
    })(job);
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
  fetch(bridgeUrl('/api/depot-download-cancel/' + jobId), { method: 'POST', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function() {
      state.activeDepotJobs = state.activeDepotJobs.filter(function(j) { return j.jobId !== jobId; });
      clearSpeedSamples(jobId);
      renderDownloadsTab(document.querySelector('.luma-sidebar-content') as HTMLElement);
    })
    .catch(function() {});
}

function cancelSourceDownload(requestId: string) {
  // Source downloads don't have a cancel endpoint, just remove from tracking
  state.activeDownloads = state.activeDownloads.filter(function(d) { return d.requestId !== requestId; });
  clearSpeedSamples(requestId);
  renderDownloadsTab(document.querySelector('.luma-sidebar-content') as HTMLElement);
}

function pauseDepotDownload(jobId: string) {
  fetch(bridgeUrl('/api/depot-download-pause/' + jobId), { method: 'POST', mode: 'cors', cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .catch(function() {});
}

// ---------------------------------------------------------------------------
// Tools tab
// ---------------------------------------------------------------------------
function renderToolsTab(container: HTMLElement) {
  var html = '';
  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">DepotDownloader</div>';
  html += '<div class="luma-stat-card"><div class="luma-stat-icon green">' + svgBox() + '</div><div><div style="font-size:13px;font-weight:600;color:#fff;">Available</div><div style="font-size:11px;color:#8f98a0;">For content downloads</div></div></div>';
  html += '</div>';
  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">SLS Steam</div>';
  html += '<div class="luma-stat-card"><div class="luma-stat-icon orange">' + svgRefresh() + '</div><div><div style="font-size:13px;font-weight:600;color:#fff;">Check Status</div><div style="font-size:11px;color:#8f98a0;">Steam library integration</div></div></div>';
  html += '</div>';
  html += '<div class="luma-sidebar-section"><div class="luma-sidebar-section-title">Steam Integration</div>';
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
}

// ---------------------------------------------------------------------------
// Settings tab (about)
// ---------------------------------------------------------------------------
function renderSettingsTab(container: HTMLElement) {
  var html = '';
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s: string): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Open sidebar
// ---------------------------------------------------------------------------
export function openSidebar(initialTab?: string) {
  if (document.getElementById(SIDEBAR_ID)) return;
  ensureKeyframes();

  if (initialTab) currentTab = initialTab;

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
    tabsHtml += '<button class="luma-sidebar-tab' + (tab.id === currentTab ? ' active' : '') + '" data-tab="' + tab.id + '" style="flex:1;padding:10px 4px;text-align:center;font-size:11px;font-weight:600;color:#8f98a0;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s ease;">' + tab.label + '</button>';
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

  renderTabContent(currentTab);
}
