import { state, LUMA_INJECT_VERSION, DOCUMENT_ID, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, IS_LINUX, BTN_ID, BTN_APPID_ATTR } from '../core/state';
import { abortPendingRequests, cancelAllRetries, removeButton, syncNamespaceState, ensureLumaButtonExists, setButtonState, setButtonLumaState, checkLocalStatus, handleLocalStatusResult } from '../ui/button';
import { ST } from '../ui/styles';
import { svgSpinner } from '../ui/svg';
import { ensureSettingsButton } from '../modals/settings';
import { closeModal, openSourceModal, stopDownloadPoll } from '../modals/source';
import { openDepotModal } from '../modals/depot';
import { stopObserver, restoreHistory, patchHistory, reconcile, scheduleReconcile, startObserver } from './spa';
import { detectBridgePort, extractAppId } from '../ui/helpers';

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
export function teardown(): void {
  try {
    console.log('[LUMA_WATCHER] Tearing down lifecycle');
    state.activated = false;
    abortPendingRequests();
    cancelAllRetries();
    stopDownloadPoll();
    state.activeDownloads = [];
    state.activeDepotJobs = [];
    if (state.providerAbortController) {
      state.providerAbortController.abort();
      state.providerAbortController = null;
    }
    state.statusCache = null;
    stopObserver();
    restoreHistory();
    closeModal();
    removeButton();
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
    state.currentUrl = location.href;
    state.currentAppId = extractAppId();
    patchHistory();
    setupEventDelegation();
    startObserver();
    ensureLumaButtonExists();
    ensureSettingsButton();
    detectBridgePort();
    syncNamespaceState();
    console.log('[LUMA_RUNTIME] Version:', LUMA_INJECT_VERSION);
    console.log('[LUMA_RUNTIME] Target URL:', window.location.href);
    console.log('[LUMA_RUNTIME] Document ID:', state.documentId);
    console.log('[LUMA_RUNTIME] Lifecycle already existed: false');
    console.log('[LUMA_RUNTIME] Existing lifecycle version: none');
    console.log('[LUMA_RUNTIME] Active:', true);
    console.log('[LUMA_RUNTIME] Current AppID:', state.currentAppId);
    console.log('[LUMA_RUNTIME] Reconcile count:', state.reconcileCount);
    console.log('[LUMA_RUNTIME] Observer active:', !!state.observer);
    console.log('[LUMA_RUNTIME] History wrapped:', state.historyPatched);
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
function setupEventDelegation(): void {
  try {
    document.body.addEventListener('click', function (e) {
      try {
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

            setButtonState(btnAppId, ST.btn + 'opacity:.7;pointer-events:none;', svgSpinner() + '<span>CHECKING\u2026</span>', true);
            setButtonLumaState(btnAppId, 'checking');
            checkLocalStatus(btnAppId, function (err: any, data: any, resolvedId: string) {
              handleLocalStatusResult(resolvedId, err, data);
            });
            return;
          }
          if (btn.getAttribute('aria-disabled') === 'true') return;
          var btnText = btn.textContent || '';
          if (btnText.indexOf('IN LIBRARY') !== -1) {
            if (IS_LINUX) {
              console.log('[LUMA_INJECT] IN LIBRARY click on Linux → opening depot modal for AppID:', btnAppId);
              openDepotModal(btnAppId);
            }
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

    console.log('[LUMA_INJECT] Event delegation active on document.body');
  } catch (e) {
    console.error('[CEF_INJECT_ERROR] setupEventDelegation:', e);
  }
}
