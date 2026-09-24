import { APP_URL_RE, MAX_ID_LENGTH, ACTION_SELECTORS, BRIDGE_HOST, BRIDGE_SCHEME, bridgeConfig, MODAL_MARKER_ATTR, MODAL_MARKER_VAL } from '../core/state';

// ---------------------------------------------------------------------------
// URL & ID helpers
// ---------------------------------------------------------------------------
export function extractAppId(): string | null {
  try {
    // Method 1: Try window.location (works in standard browser)
    var m = (window.location.pathname || '').match(APP_URL_RE);
    if (!m) m = (window.location.href || '').match(APP_URL_RE);
    if (m) {
      var id = m[1];
      if (/^\d+$/.test(id) && id.length <= MAX_ID_LENGTH && id !== '0') return id;
    }

    // Method 2: Steam global variables
    if (typeof (window as any).g_rgCurrentAppID !== 'undefined' && (window as any).g_rgCurrentAppID) {
      return String((window as any).g_rgCurrentAppID);
    }
    if (typeof (window as any).g_applicationID !== 'undefined' && (window as any).g_applicationID) {
      return String((window as any).g_applicationID);
    }
    if (typeof (window as any).g_unAppID !== 'undefined' && (window as any).g_unAppID) {
      return String((window as any).g_unAppID);
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
    var subInput = document.querySelector('input[name="subid"]') as HTMLInputElement | null;
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

export function findActionContainer(): Element | null {
  for (var i = 0; i < ACTION_SELECTORS.length; i++) {
    var el = document.querySelector(ACTION_SELECTORS[i]);
    if (el) return el;
  }
  return null;
}

export function formatFileSize(bytes: number | string): string | null {
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

export function formatTimeRemaining(expiresAt: string | null, serverTimestamp?: string | null): string | null {
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

export function bridgeUrl(path: string): string {
  return BRIDGE_SCHEME + '://' + BRIDGE_HOST + ':' + bridgeConfig.port + path;
}

export function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function detectBridgePort(): Promise<void> {
  if (bridgeConfig.detected) return Promise.resolve();
  var ports = [21775, 21776, 21777];
  var tryPort = function (i: number): Promise<void> {
    if (i >= ports.length) return Promise.resolve();
    var url = BRIDGE_SCHEME + '://' + BRIDGE_HOST + ':' + ports[i] + '/health';
    return fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(2000) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.status === 'ok') {
          bridgeConfig.port = ports[i];
          bridgeConfig.detected = true;
          console.log('[LUMA_INJECT] Detected bridge on port', bridgeConfig.port);
        }
      })
      .catch(function () { return tryPort(i + 1); });
  };
  return tryPort(0);
}

export function sourcesUrl(appId: string): string {
  return bridgeUrl('/api/sources/' + appId);
}

export function providersUrl(): string {
  return bridgeUrl('/api/providers');
}

export function downloadUrl(): string {
  return bridgeUrl('/api/download');
}

export function localStatusUrl(appId: string): string {
  return bridgeUrl('/api/local-status/' + appId);
}

export function downloadStatusUrl(requestId: string): string {
  return bridgeUrl('/api/download-status/' + requestId);
}

export function steamKeysPinsUrl(): string {
  return bridgeUrl('/api/steam-keys/pins');
}

export function steamKeysPinUrl(): string {
  return bridgeUrl('/api/steam-keys/pin');
}

export function steamKeysUnpinUrl(): string {
  return bridgeUrl('/api/steam-keys/unpin');
}

export function steamKeysSettingsUrl(): string {
  return bridgeUrl('/api/steam-keys/settings');
}

export function openLibraryUrl(appId: string): string {
  return bridgeUrl('/api/open-library/' + appId);
}

export function depotsUrl(appId: string): string {
  return bridgeUrl('/api/depots/' + appId);
}

export function depotDownloadUrl(): string {
  return bridgeUrl('/api/depot-download');
}

export function depotDownloadStatusUrl(jobId: string): string {
  return bridgeUrl('/api/depot-download-status/' + jobId);
}

export function steamLibraryFoldersUrl(): string {
  return bridgeUrl('/api/steam-library-folders');
}

export function downloadsQueueUrl(): string {
  return bridgeUrl('/api/downloads-queue');
}

export function downloadsQueueAddUrl(): string {
  return bridgeUrl('/api/downloads-queue/add');
}

export function downloadsQueueRemoveUrl(id: string): string {
  return bridgeUrl('/api/downloads-queue/remove/' + id);
}

export function restartSteamUrl(): string {
  return bridgeUrl('/api/restart-steam');
}

export function downloadsQueueClearHistoryUrl(): string {
  return bridgeUrl('/api/downloads-queue/clear-history');
}

export function downloadsQueueRemoveHistoryUrl(id: string): string {
  return bridgeUrl('/api/downloads-queue/remove-history/' + id);
}

export function luaFilesUrl(): string {
  return bridgeUrl('/api/lua-files');
}

export function luaFileDeleteUrl(appId: string): string {
  return bridgeUrl('/api/lua-files/' + appId);
}

export function providerStatsUrl(): string {
  return bridgeUrl('/api/provider-stats');
}

export function toolsUrl(): string {
  return bridgeUrl('/api/tools');
}

export function toolInstallUrl(id: string): string {
  return bridgeUrl('/api/tools/' + id + '/install');
}

export function toolUpdateUrl(id: string): string {
  return bridgeUrl('/api/tools/' + id + '/update');
}

export function toolUninstallUrl(id: string): string {
  return bridgeUrl('/api/tools/' + id + '/uninstall');
}

export function fixesInfoUrl(appId: string): string {
  return bridgeUrl('/api/fixes/' + appId + '/info');
}

export function fixesStatusUrl(appId: string): string {
  return bridgeUrl('/api/fixes/' + appId + '/status');
}

export function fixesApplyUrl(appId: string): string {
  return bridgeUrl('/api/fixes/' + appId + '/apply');
}

export function fixesUnfixUrl(appId: string): string {
  return bridgeUrl('/api/fixes/' + appId + '/unfix');
}

export function fixesAppliedUrl(): string {
  return bridgeUrl('/api/fixes/applied');
}

export function fixesCatalogUrl(): string {
  return bridgeUrl('/api/fixes/catalog');
}

export function steamAccountUrl(): string {
  return bridgeUrl('/api/steam-account');
}

export function steamAccountDetectUrl(): string {
  return bridgeUrl('/api/steam-account/detect');
}

export function openUrlApi(): string {
  return bridgeUrl('/api/open-url');
}

export function getModalBody(): Element | null {
  return document.querySelector(
    '[' + MODAL_MARKER_ATTR + '="' + MODAL_MARKER_VAL + '"] [data-lumaforge-modal-body="true"]'
  );
}

export function getModalBadge(card: Element): Element | null {
  return card ? card.querySelector('[data-lumaforge-source-badge="true"]') : null;
}
