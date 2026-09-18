import { state, BTN_ID, BTN_APPID_ATTR, NAMESPACE } from '../core/state';
import { extractAppId } from '../ui/helpers';
import { abortPendingRequests, cancelAllRetries, removeButton, getObserverRoot, syncNamespaceState, ensureLumaButtonExists, scheduleBridgeRecovery } from '../ui/button';
import { closeModal } from '../modals/source';
import { stopDownloadPoll } from '../modals/source';
import { ensureSettingsButton } from '../modals/settings';

// ---------------------------------------------------------------------------
// Reconcile: detect URL/AppID changes and update controls
// ---------------------------------------------------------------------------
export function reconcile(): void {
  state.reconcileCount++;
  var url = window.location.href;
  var appId = extractAppId();
  var prevUrl = state.currentUrl;
  var prevAppId = state.currentAppId;

  // Ensure floating settings button exists on every page
  ensureSettingsButton();

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

  var existingState = existingBtn.getAttribute('data-lumaforge-state');
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
export function startObserver(): void {
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

export function stopObserver(): void {
  try {
    if (state.observer) { state.observer.disconnect(); state.observer = null; state.observerRoot = null; }
  } catch (e) { console.error('[CEF_INJECT_ERROR] stopObserver:', e); }
}

export function scheduleReconcile(reason: string): void {
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
export function patchHistory(): void {
  try {
    if (state.historyPatched) return;
    state.origPushState = History.prototype.pushState;
    state.origReplaceState = History.prototype.replaceState;
    History.prototype.pushState = function () {
      var r = state.origPushState!.apply(this, arguments as any);
      console.log('[LUMA_WATCHER] pushState');
      scheduleReconcile('pushState');
      return r;
    };
    History.prototype.replaceState = function () {
      var r = state.origReplaceState!.apply(this, arguments as any);
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

export function restoreHistory(): void {
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
