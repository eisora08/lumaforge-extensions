import { state, LUMA_INJECT_VERSION, DOCUMENT_ID, NAMESPACE } from './core/state';
import { extractAppId } from './ui/helpers';
import { scheduleReconcile, reconcile } from './core/spa';
import { activate, teardown } from './core/lifecycle';

// ---------------------------------------------------------------------------
// Namespace & Bootstrap
// ---------------------------------------------------------------------------
function bootstrap(): void {
  try {
    console.log('[FORENSIC_INJECT] VERSION=' + LUMA_INJECT_VERSION);
    console.log('[FORENSIC_INJECT] PAGE_URL=' + window.location.href);
    console.log('[FORENSIC_INJECT] ORIGIN=' + window.location.origin);
    console.log('[FORENSIC_INJECT] Document ID=' + DOCUMENT_ID);

    var existingLifecycle = !!((window as any)[NAMESPACE] && (window as any)[NAMESPACE].activate);
    var existingVersion = ((window as any)[NAMESPACE] && (window as any)[NAMESPACE].version) || 'none';

    console.log('[FORENSIC_INJECT] Existing lifecycle found: ' + existingLifecycle);
    console.log('[FORENSIC_INJECT] Existing version: ' + existingVersion);

    // Same-version reuse: if same version is already active, just reconcile
    if ((window as any)[NAMESPACE] && (window as any)[NAMESPACE].version === LUMA_INJECT_VERSION && (window as any)[NAMESPACE].active) {
      console.log('[LUMA_RUNTIME] Same-version lifecycle already active, scheduling reconcile');
      if (typeof (window as any)[NAMESPACE].scheduleReconcile === 'function') {
        (window as any)[NAMESPACE].scheduleReconcile('reinjection');
      }
      return;
    }

    // Different version or no existing lifecycle: deactivate old and create new
    if ((window as any)[NAMESPACE]) {
      console.log('[FORENSIC_INJECT] Deactivating previous instance (v' + existingVersion + ')');
      if (typeof (window as any)[NAMESPACE].deactivate === 'function') {
        (window as any)[NAMESPACE].deactivate();
      }
      console.log('[FORENSIC_INJECT] Previous lifecycle teardown complete');
    }

    (window as any)[NAMESPACE] = {
      activate: activate,
      deactivate: function () { teardown(); },
      scheduleReconcile: scheduleReconcile,
      version: LUMA_INJECT_VERSION,
      active: false,
      documentId: DOCUMENT_ID,
      currentUrl: null,
      currentAppId: null,
      reconcileCount: 0,
      observerActive: false,
      historyWrapped: false,
    };

    console.log('[FORENSIC_INJECT] Lifecycle assigned (v' + LUMA_INJECT_VERSION + ')');
  } catch (e) { console.error('[CEF_INJECT_ERROR] namespace:', e); }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    activate();
  } else {
    document.addEventListener('DOMContentLoaded', activate);
  }
}

bootstrap();
