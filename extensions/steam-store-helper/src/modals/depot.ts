import { state, BTN_ID, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, IS_LINUX, LUMA_INJECT_VERSION } from '../core/state';
import { svgBox, svgX, svgSpinner, svgErrorCircle, svgDownload, svgCheck, svgRefresh, svgLibrary } from '../ui/svg';
import { ST } from '../ui/styles';
import { depotsUrl, depotDownloadUrl, depotDownloadStatusUrl, openLibraryUrl, restartSteamUrl, getModalBody } from '../ui/helpers';
import { formatBytes, formatOs, escapeHtml } from '../ui/dom';
import { closeModal } from './source';

var restartSteamBtnEl: HTMLButtonElement | null = null;

// ---------------------------------------------------------------------------
// Depot download modal (Linux only)
// ---------------------------------------------------------------------------
export function openDepotModal(appId: string): void {
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

      // Track in activeDepotJobs for sidebar
      state.activeDepotJobs.push({
        jobId: d.jobId,
        appId: appId,
        gameName: ms.gameName,
        outputDir: ms.outputDir,
        phase: 'Starting download...',
        progress: 0,
        speed: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        status: 'downloading',
        pollSeq: 0,
        pollTimer: null,
      });

      showDepotProgress(appId, d.jobId);
      startDepotDownloadPoll(d.jobId, appId);
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

export function showDepotProgress(appId: string, jobId: string): void {
  var body = getModalBody() as HTMLElement;
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
export function startDepotDownloadPoll(jobId: string, appId: string): void {
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

        // Update activeDepotJobs entry with progress
        for (var i = 0; i < state.activeDepotJobs.length; i++) {
          if (state.activeDepotJobs[i].jobId === jobId) {
            state.activeDepotJobs[i].phase = d.phase || d.message || d.status || '';
            state.activeDepotJobs[i].progress = d.progress || 0;
            state.activeDepotJobs[i].bytesDownloaded = d.bytesRead || 0;
            state.activeDepotJobs[i].totalBytes = d.totalBytes || 0;
            state.activeDepotJobs[i].status = d.status || 'downloading';
            break;
          }
        }

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

export function updateDepotProgressUI(d: any): void {
  try {
    var fill = document.getElementById('luma-depot-progress-fill') as HTMLElement | null;
    var msg = document.getElementById('luma-depot-progress-msg') as HTMLElement | null;
    var detail = document.getElementById('luma-depot-progress-detail') as HTMLElement | null;

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
      var parts: string[] = [];
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

export function showDepotDownloadSuccess(appId: string): void {
  var jobId = state.depotModalState ? state.depotModalState.jobId : null;
  state.depotModalState = null;
  if (jobId) {
    state.activeDepotJobs = state.activeDepotJobs.filter(function(j) { return j.jobId !== jobId; });
  }
  var body = getModalBody() as HTMLElement;
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

  var restartBtnEl = document.getElementById('luma-depot-restart-steam') as HTMLButtonElement | null;
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

export function showDepotDownloadError(message: string): void {
  if (state.depotModalState) {
    var jobId = state.depotModalState.jobId;
    state.depotModalState.downloading = false;
    if (jobId) {
      state.activeDepotJobs = state.activeDepotJobs.filter(function(j) { return j.jobId !== jobId; });
    }
  }
  var body = getModalBody() as HTMLElement;
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
