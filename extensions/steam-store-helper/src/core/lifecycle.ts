import { state, LUMA_INJECT_VERSION, DOCUMENT_ID, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, BTN_ID, FIXES_BTN_ID, BTN_APPID_ATTR, saveSessionState, loadSessionState } from '../core/state';
import { abortPendingRequests, cancelAllRetries, removeButton, syncNamespaceState, ensureLumaButtonExists, setButtonState, setButtonLumaState, checkLocalStatus, handleLocalStatusResult } from '../ui/button';
import { ST, ensureBtnStates, ensureKeyframes } from '../ui/styles';
import { svgSpinner } from '../ui/svg';
import { ensureSettingsButton } from '../modals/settings';
import { closeModal, openSourceModal, stopDownloadPoll } from '../modals/source';
import { openFixesModal } from '../modals/fixes';
import { stopObserver, restoreHistory, patchHistory, reconcile, startObserver } from './spa';
import { pushHistoryToBridge } from './history_sync';
import { detectBridgePort, extractAppId, bridgeUrl, isLibrarySurface } from '../ui/helpers';
import { resolveThemeColors, watchThemeReload } from '../ui/themeColor';
import { startManageMenu, stopManageMenu } from '../ui/manageMenu';
import { t } from '../i18n';

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
export function teardown(): void {
  try {
    console.log('[LUMA_WATCHER] Tearing down lifecycle');
    state.activated = false;

    // Queue is managed by bridge — no need to move downloads to history here
    state.activeDownloads = [];
    state.activeDepotJobs = [];
    state.installingAppIds = {};
    saveSessionState();
    abortPendingRequests();
    cancelAllRetries();
    stopDownloadPoll();
    if (state.providerAbortController) {
      state.providerAbortController.abort();
      state.providerAbortController = null;
    }
    state.statusCache = null;
    stopObserver();
    restoreHistory();
    closeModal();
    removeButton();
    stopManageMenu();
    state.currentAppId = null;
    state.currentUrl = null;
    syncNamespaceState();
  } catch (e) { console.error('[CEF_INJECT_ERROR] teardown:', e); }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------
export function activate(): void {
  try {
    if (state.activated) {
      console.log('[LUMA_RUNTIME] Already active, scheduling reconcile');
      reconcile();
      return;
    }
    state.activated = true;
    loadSessionState();
    state.currentUrl = location.href;
    state.currentAppId = extractAppId();
    resolveThemeColors();
    watchThemeReload();
    // The active theme's CSS can land after activation (proxy pushes it on
    // startup) — re-resolve once so surface/accent vars pick it up.
    setTimeout(function() { resolveThemeColors(); }, 2000);
    patchHistory();
    setupEventDelegation();
    ensureBtnStates();
    // Modal styling must not depend on opening the sidebar: on the library
    // surface ensureLumaButtonExists() returns early, so this is the only
    // place keyframes/box-sizing get installed — without it the fixes modal
    // renders unstyled (Close clipped at the right edge).
    ensureKeyframes();
    startObserver();
    if (isLibrarySurface()) startManageMenu();
    ensureLumaButtonExists();
    ensureSettingsButton();
    detectBridgePort();
    syncNamespaceState();
    // Sync this origin's local download history to the bridge queue file so
    // other surfaces (library window) render it too
    pushHistoryToBridge();
    // Auto-start next queued download on activation
    fetch(bridgeUrl('/api/downloads-queue/start-next'), { method: 'POST', mode: 'cors', cache: 'no-store' }).catch(function() {});
    // One init line instead of the former 11-line block (~275 lines per
    // session): version, surface, url/doc, appid, reconcile, observer and
    // history/delegation state for remote debugging.
    console.log('[LUMA_RUNTIME] init v=' + LUMA_INJECT_VERSION +
      ' lib=' + isLibrarySurface() +
      ' gear=' + !!document.getElementById('luma-ssh-settings-btn') +
      ' root=' + !!document.getElementById('root') +
      ' popupTarget=' + !!document.getElementById('popup_target') +
      ' title=' + JSON.stringify(document.title) +
      ' bodyClass=' + (document.body ? document.body.className : 'n/a') +
      ' url=' + window.location.href +
      ' docId=' + state.documentId +
      ' appid=' + state.currentAppId +
      ' rec=' + state.reconcileCount +
      ' obs=' + !!state.observer +
      ' obsRoot=' + (state.observerRoot ? state.observerRoot.nodeName : 'none') +
      ' hist=' + state.historyPatched +
      ' deleg=' + _delegActive);
  } catch (e) { console.error('[CEF_INJECT_ERROR] activate:', e); }
}

// ---------------------------------------------------------------------------
// Debug overflow diagnostic (disabled by default)
// ---------------------------------------------------------------------------
var LUMA_DEBUG_OVERFLOW = false;
export function logModalHorizontalOverflow(): void {
  if (!LUMA_DEBUG_OVERFLOW) return;
  var modal = document.querySelector(
    '[' + MODAL_MARKER_ATTR + '="' + MODAL_MARKER_VAL + '"]'
  );
  if (!modal) return;
  var panel = modal.querySelector('.luma-ssh-modal-panel');
  var body = modal.querySelector('.luma-ssh-modal-body');
  var footer = modal.querySelector('[style*="border-top"]');
  var all = modal.querySelectorAll('*');
  Array.prototype.forEach.call(all, function (el: Element) {
    if (el.scrollWidth > el.clientWidth + 1) {
      console.warn(
        '[LUMA_MODAL_OVERFLOW]',
        el.tagName,
        (el as HTMLElement).className || '',
        { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: (el.textContent || '').slice(0, 80) }
      );
    }
  });
  if (panel) console.log('[LUMA_MODAL_OVERFLOW_CHECK] panel:', (panel as HTMLElement).scrollWidth <= (panel as HTMLElement).clientWidth + 1, (panel as HTMLElement).scrollWidth, (panel as HTMLElement).clientWidth);
  if (body) console.log('[LUMA_MODAL_OVERFLOW_CHECK] body:', (body as HTMLElement).scrollWidth <= (body as HTMLElement).clientWidth + 1, (body as HTMLElement).scrollWidth, (body as HTMLElement).clientWidth);
}

// ---------------------------------------------------------------------------
// Event delegation
// ---------------------------------------------------------------------------
var _delegActive = false;
function setupEventDelegation(): void {
  try {
    document.body.addEventListener('click', function (e) {
      try {
        var fixesBtn = (e.target as HTMLElement).closest('#' + FIXES_BTN_ID);
        if (fixesBtn) {
          e.preventDefault();
          e.stopPropagation();
          var fixesAppId = fixesBtn.getAttribute(BTN_APPID_ATTR) || extractAppId();
          if (fixesAppId) openFixesModal(fixesAppId);
          return;
        }
        var btn = (e.target as HTMLElement).closest('#' + BTN_ID);
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          var btnAppId = btn.getAttribute(BTN_APPID_ATTR) || extractAppId();
          if (!btnAppId) return;
          var btnLumaState = btn.getAttribute('data-lumaforge-state');
          if (btnLumaState === 'bridge-error' || btnLumaState === 'request-error') {
            console.log('[LUMA_INJECT] Retry click for AppID:', btnAppId);

            state.bridgeRecoveryAppId = btnAppId;
            state.bridgeRecoveryCount = 0;

            setButtonState(btnAppId, ST.btn + 'opacity:.7;pointer-events:none;', svgSpinner() + '<span>' + t('Checking\u2026') + '</span>', true);
            setButtonLumaState(btnAppId, 'checking');
            checkLocalStatus(btnAppId, function (err: any, data: any, resolvedId: string) {
              handleLocalStatusResult(resolvedId, err, data);
            });
            return;
          }
          if (btn.getAttribute('aria-disabled') === 'true') return;
          if (btnLumaState === 'added') return;
          if (btnLumaState === 'in-library' || btnLumaState === 'installed' || btnLumaState === 'installing') {
            return;
          }
          console.log('[LUMA_INJECT] Delegated click for AppID:', btnAppId);
          openSourceModal(btnAppId);
          return;
        }
        if ((e.target as HTMLElement).id === 'luma-retry-sources' || (e.target as HTMLElement).closest('#luma-retry-sources')) {
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
        if ((e.target as HTMLElement).getAttribute(MODAL_MARKER_ATTR) === MODAL_MARKER_VAL) {
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

    _delegActive = true;
  } catch (e) {
    console.error('[CEF_INJECT_ERROR] setupEventDelegation:', e);
  }
}
