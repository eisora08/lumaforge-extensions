import { state, _fetchSeq, BTN_ID, FIXES_BTN_ID, BTN_APPID_ATTR, BTN_STATE_ATTR, BTN_MARKER_ATTR, BTN_MARKER_VAL, IS_LINUX, NAMESPACE, MODAL_MARKER_ATTR, MODAL_MARKER_VAL } from '../core/state';
import { svgDownload, svgSpinner, svgCheck, svgGear, svgX, svgCloudDownload } from '../ui/svg';
import { ST } from '../ui/styles';
import { ensureKeyframes } from '../ui/styles';
import { extractAppId, findActionContainer, localStatusUrl } from '../ui/helpers';
import { retryFetch } from '../api/bridge';
import { stopDownloadPoll } from '../modals/source';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
export function abortPendingRequests(): void {
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
  _fetchSeq.value++;
}

export function cancelAllRetries(): void {
  for (var i = 0; i < state.retryTimers.length; i++) {
    clearTimeout(state.retryTimers[i]);
  }
  state.retryTimers = [];
}

export function removeButton(): void {
  var btn = document.getElementById(BTN_ID);
  if (btn) btn.remove();
  removeFixesButton();
}

export function removeFixesButton(): void {
  var btn = document.getElementById(FIXES_BTN_ID);
  if (btn) btn.remove();
}

export function updateFixesButton(appId: string): void {
  try {
    var mainBtn = document.getElementById(BTN_ID);
    var existing = document.getElementById(FIXES_BTN_ID);
    var installed = !!mainBtn &&
      mainBtn.getAttribute(BTN_APPID_ATTR) === appId &&
      mainBtn.getAttribute(BTN_STATE_ATTR) === 'installed';

    if (!installed) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.getAttribute(BTN_APPID_ATTR) === appId) return;
    if (existing) existing.remove();

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = FIXES_BTN_ID;
    btn.className = 'luma-ssh-fixes-button';
    btn.setAttribute(BTN_MARKER_ATTR, BTN_MARKER_VAL);
    btn.setAttribute(BTN_APPID_ATTR, appId);
    btn.setAttribute('aria-label', 'Game fixes for app ' + appId);
    btn.title = 'Apply SmokeAPI, Steamless, Goldberg or Online-Fix';
    btn.setAttribute('style',
      'display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:8px 14px;cursor:pointer;' +
      'border:1px solid rgba(255,180,60,.35);border-radius:4px;font-family:inherit;font-size:13px;font-weight:700;' +
      'letter-spacing:.3px;background:linear-gradient(to right,rgba(255,150,40,.22),rgba(255,180,60,.14));' +
      'color:#ffb43c;box-shadow:0 0 8px rgba(255,180,60,.18);transition:background .12s ease,border-color .12s ease;'
    );
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M10.5 1.5l4 4-7 7H3.5v-4l7-7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M9 3l4 4" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M2 14h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '</svg><span>FIXES</span>';

    var parent = mainBtn.parentNode;
    if (parent) {
      parent.insertBefore(btn, mainBtn.nextSibling);
    }
  } catch (_) { }
}

export function getObserverRoot(): Node {
  if (document.documentElement) return document.documentElement;
  return document.body;
}

export function syncNamespaceState(): void {
  if ((window as any)[NAMESPACE]) {
    (window as any)[NAMESPACE].active = state.activated;
    (window as any)[NAMESPACE].currentUrl = state.currentUrl;
    (window as any)[NAMESPACE].currentAppId = state.currentAppId;
    (window as any)[NAMESPACE].reconcileCount = state.reconcileCount;
    (window as any)[NAMESPACE].observerActive = !!state.observer;
    (window as any)[NAMESPACE].historyWrapped = state.historyPatched;
  }
}

// ---------------------------------------------------------------------------
// Button state helpers
// ---------------------------------------------------------------------------
export function setButtonState(appId: string, style: string, html: string, disabled: boolean): boolean {
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

export function setButtonLumaState(appId: string, lumaState: string): void {
  try {
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (btn.getAttribute(BTN_APPID_ATTR) !== appId) return;
    btn.setAttribute(BTN_STATE_ATTR, lumaState);
  } catch (_) { }
}

export function applyInLibraryState(appId: string): void {
  if (IS_LINUX) {
    setButtonState(appId, ST.btnInstall, svgDownload() + '<span>INSTALL</span>', false);
    setButtonLumaState(appId, 'in-library');
    console.log('[LUMA_INJECT] App', appId, 'already in Luma library (INSTALL — Linux)');
  } else {
    setButtonState(appId, ST.btnInstalled, svgCheck() + '<span>IN LIBRARY</span>', true);
    setButtonLumaState(appId, 'in-library');
    console.log('[LUMA_INJECT] App', appId, 'already in Luma library');
  }
  removeFixesButton();
}

export function applyInstalledState(appId: string): void {
  setButtonState(appId, ST.btnInstalled, svgCheck() + '<span>INSTALLED</span>', true);
  setButtonLumaState(appId, 'installed');
  updateFixesButton(appId);
  console.log('[LUMA_INJECT] App', appId, 'content installed (blocked)');
}

export function applyInstallingState(appId: string): void {
  setButtonState(appId, ST.btnInstalled, svgSpinner() + '<span>INSTALLING</span>', true);
  setButtonLumaState(appId, 'installing');
  removeFixesButton();
  console.log('[LUMA_INJECT] App', appId, 'content installing');
}

// ---------------------------------------------------------------------------
// Bridge recovery timer
// ---------------------------------------------------------------------------
export function scheduleBridgeRecovery(appId: string): void {
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
export function handleLocalStatusResult(appId: string, err: any, data: any): void {
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

    // Check if this app is currently being downloaded
    if (state.installingAppIds[appId]) {
      applyInstallingState(appId);
      removeFixesButton();
    } else if (installed) {
      applyInstalledState(appId);
    } else if (inLibrary) {
      applyInLibraryState(appId);
      removeFixesButton();
    } else {
      setButtonState(appId, ST.btn, svgDownload() + '<span>ADD VIA LUMAFORGE</span>', false);
      setButtonLumaState(appId, 'ready');
      removeFixesButton();
    }
  } catch (_) { }
}

// ---------------------------------------------------------------------------
// checkLocalStatus — unified with dedup and abortable retry
// ---------------------------------------------------------------------------
export function checkLocalStatus(appId: string, cb: (err: any, data: any, appId: string) => void): void {
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
export function ensureLumaButtonExists(): void {
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

    var seq = ++_fetchSeq.value;
    checkLocalStatus(appId, function (err, data, resolvedAppId) {
      if (seq !== _fetchSeq.value) {
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
