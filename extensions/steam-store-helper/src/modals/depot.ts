import { state, BTN_ID, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, IS_LINUX, LUMA_INJECT_VERSION, saveSessionState } from '../core/state';
import { svgBox, svgX, svgSpinner, svgErrorCircle, svgDownload, svgCheck, svgRefresh, svgLibrary } from '../ui/svg';
import { ST } from '../ui/styles';
import { depotsUrl, depotDownloadUrl, depotDownloadStatusUrl, openLibraryUrl, restartSteamUrl, getModalBody, steamLibraryFoldersUrl, downloadsQueueAddUrl } from '../ui/helpers';
import { formatBytes, formatOs, escapeHtml } from '../ui/dom';
import { closeModal } from './source';
import { applyInstallingState, applyInLibraryState } from '../ui/button';
import { retryFetch } from '../api/bridge';
import { openSidebar } from '../sidebar/SidebarPanel';

var _steamLibraryFolders: Array<{ path: string; commonPath: string; label: string }> | null = null;

// ---------------------------------------------------------------------------
// Depot download modal (Linux only)
// ---------------------------------------------------------------------------
export function openDepotModal(appId: string): void {
  try {
    closeModal();

    state.savedFocusElement = document.activeElement;
    state.depotModalState = { appId: appId, depots: [], selected: {}, outputDir: '', downloading: false, jobId: null };

    // Fetch Steam library folders in background
    if (!_steamLibraryFolders) {
      retryFetch(steamLibraryFoldersUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.folders && d.folders.length > 0) {
            _steamLibraryFolders = d.folders;
          }
        })
        .catch(function () {});
    }

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

function logModalHorizontalOverflow(): void {
  // Imported from source.ts — kept inline to avoid circular dependency
}

export function fetchDepotsForModal(appId: string): void {
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
      var selected: Record<number, boolean> = {};
      (d.depots || []).forEach(function (depot: any) {
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

      (body as HTMLElement).innerHTML =
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

export function renderDepotList(appId: string): void {
  var body = getModalBody() as HTMLElement;
  if (!body) return;
  var ms = state.depotModalState;
  if (!ms) return;

  var depots = ms.depots;
  var selected = ms.selected;

  // Group depots
  var baseDepots: any[] = [];
  var dlcDepots: any[] = [];
  var sharedDepots: any[] = [];
  depots.forEach(function (d: any) {
    if (d.isShared) sharedDepots.push(d);
    else if (d.dlcAppId) dlcDepots.push(d);
    else baseDepots.push(d);
  });

  var totalSelected = 0;
  var totalSize = 0;
  Object.keys(selected).forEach(function (id) {
    if (selected[parseInt(id)]) {
      totalSelected++;
      var depot = depots.find(function (d: any) { return d.depotId === parseInt(id); });
      if (depot) totalSize += depot.size || 0;
    }
  });

  var html = '';

  function renderGroup(title: string, groupDepots: any[], groupKey: string): string {
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
      var detailParts: string[] = [];
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

  // Location dropdown
  html += '<div style="margin:12px 0;padding:12px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);">';
  html += '<div style="font-size:11px;font-weight:600;color:#8f98a0;margin-bottom:6px;">Download Location</div>';
  html += '<select id="luma-depot-location" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:#1b2838;color:#fff;font-size:12px;cursor:pointer;">';
  if (_steamLibraryFolders && _steamLibraryFolders.length > 0) {
    for (var fi = 0; fi < _steamLibraryFolders.length; fi++) {
      var folder = _steamLibraryFolders[fi];
      var isSelected = fi === 0 ? ' selected' : '';
      html += '<option value="' + escapeHtml(folder.path) + '"' + isSelected + '>' + escapeHtml(folder.label) + ' \u2014 ' + escapeHtml(folder.commonPath) + '</option>';
    }
  } else if (ms.outputDir) {
    html += '<option value="' + escapeHtml(ms.outputDir) + '">' + escapeHtml(ms.outputDir) + '/steamapps/common</option>';
  }
  html += '</select></div>';

  // Total bar
  html += '<div style="' + ST.depotTotal + '">';
  html += '<span><strong>' + totalSelected + '</strong> depot' + (totalSelected !== 1 ? 's' : '') + ' selected \u00b7 <strong>' + formatBytes(totalSize) + '</strong></span>';
  html += '<button type="button" id="luma-depot-start" style="' + ST.primaryBtn + (totalSelected === 0 ? 'opacity:.5;pointer-events:none;' : '') + '">' + svgDownload() + '<span>START DOWNLOAD</span></button>';
  html += '</div>';

  body.innerHTML = html;

  // Event listeners for depot cards
  body.querySelectorAll('.luma-depot-card:not(.disabled)').forEach(function (card) {
    card.addEventListener('click', function (e) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      var checkbox = (card as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        var depotId = parseInt((card as HTMLElement).getAttribute('data-depot-id')!);
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
        var depotId = parseInt(card.getAttribute('data-depot-id')!);
        selected[depotId] = (cb as HTMLInputElement).checked;
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

export function startDepotDownload(appId: string): void {
  var ms = state.depotModalState;
  if (!ms || ms.downloading) return;

  var selectedDepots = ms.depots.filter(function (d) { return ms!.selected[d.depotId]; });
  if (selectedDepots.length === 0) return;

  var locationSelect = document.getElementById('luma-depot-location') as HTMLSelectElement | null;
  var selectedOutputDir = locationSelect ? locationSelect.value : (ms.outputDir || '');

  ms.downloading = true;

  var payload = JSON.stringify({
    appId: String(appId),
    gameName: ms.gameName || 'Unknown',
    outputDir: selectedOutputDir,
    depots: selectedDepots.map(function (d) {
      return {
        depotId: d.depotId,
        manifestId: d.manifestId || '',
        manifestPath: d.manifestPath || null,
        size: d.size || 0,
      };
    }),
  });

  fetch(downloadsQueueAddUrl(), {
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
      if (!d || !d.ok) throw new Error((d && d.message) || 'Failed to add to queue');

      state.installingAppIds[appId] = true;
      applyInstallingState(appId);

      state.depotModalState = null;
      closeModal();
      openSidebar('downloads');
    })
    .catch(function (err) {
      ms.downloading = false;
      var body = getModalBody() as HTMLElement;
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

export function restartSteam(appId: string): void {
  fetch(restartSteamUrl(), { method: 'POST', mode: 'cors', cache: 'no-store' })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        console.log('[LUMA_INJECT] Steam restarted successfully');
      } else {
        console.error('[LUMA_INJECT] Steam restart failed:', res.data && res.data.message);
      }
    })
    .catch(function (err) {
      console.error('[LUMA_INJECT] Steam restart error:', err);
    });
}
