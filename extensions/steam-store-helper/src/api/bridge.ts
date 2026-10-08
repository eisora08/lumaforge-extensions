import { state } from '../core/state';
import { bridgeUrl } from '../ui/helpers';

// ---------------------------------------------------------------------------
// Bridge fetch helper with comprehensive logging
// ---------------------------------------------------------------------------
export function bridgeFetch(url: string, opts: RequestInit, label: string): Promise<Response> {
  console.log('[LUMA_BRIDGE] ' + label + ' — Method:', opts.method || 'GET');
  console.log('[LUMA_BRIDGE] ' + label + ' — URL:', url);
  console.log('[LUMA_BRIDGE] ' + label + ' — Origin:', window.location.origin);
  console.log('[LUMA_BRIDGE] ' + label + ' — Page URL:', window.location.href);
  return fetch(url, opts)
    .then(function (r) {
      console.log('[LUMA_BRIDGE] ' + label + ' — Response status:', r.status, r.statusText);
      return r;
    })
    .catch(function (err) {
      console.error('[LUMA_BRIDGE] ' + label + ' — FAILED:', err.message || err);
      console.error('[LUMA_BRIDGE] ' + label + ' — Error name:', err && err.name);
      console.error('[LUMA_BRIDGE] ' + label + ' — Error message:', err && err.message);
      if (err && err.stack) console.error('[LUMA_BRIDGE] ' + label + ' — Error stack:', err.stack);
      throw err;
    });
}

// ---------------------------------------------------------------------------
// Unified fetch retry helper — retries only network-level failures
// hooks.beforeAttempt(attempt) -> false to abort the chain
// ---------------------------------------------------------------------------
var RETRY_DELAYS = [0, 300, 750, 1500];
var MAX_RETRY_ATTEMPTS = 4;

export function retryFetch(
  url: string,
  opts: RequestInit,
  label: string,
  hooks?: {
    appId?: string;
    beforeAttempt?: (attemptNum: number) => boolean;
  }
): Promise<Response> {
  hooks = hooks || {};
  var attempt = 0;

  function tryOnce(): Promise<Response> {
    attempt++;
    var attemptNum = attempt;

    if (hooks.beforeAttempt && !hooks.beforeAttempt(attemptNum)) {
      return Promise.reject(new DOMException('Context invalidated', 'AbortError'));
    }

    console.log('[LUMA_BRIDGE] ' + label + ' attempt ' + attemptNum + (hooks.appId ? ' for AppID: ' + hooks.appId : ''));

    return fetch(url, opts)
      .then(function (r) {
        if (opts && opts.signal && (opts.signal as AbortSignal).aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        console.log('[LUMA_BRIDGE] ' + label + ' succeeded' + (hooks.appId ? ' for AppID: ' + hooks.appId : ''));
        return r;
      })
      .catch(function (err) {
        if (opts && opts.signal && (opts.signal as AbortSignal).aborted) {
          throw err;
        }
        if (err && err.name === 'AbortError') {
          throw err;
        }
        var isNetworkFailure = !err || !err.response;
        if (attemptNum < MAX_RETRY_ATTEMPTS && isNetworkFailure) {
          var delay = RETRY_DELAYS[attemptNum] || 1500;
          console.log('[LUMA_BRIDGE] Network failure' + (hooks.appId ? ' for AppID ' + hooks.appId : '') + '; retrying in ' + delay + 'ms');
          return new Promise(function (resolve, reject) {
            var timerId = setTimeout(function () {
              var idx = state.retryTimers.indexOf(timerId);
              if (idx !== -1) state.retryTimers.splice(idx, 1);
              tryOnce().then(resolve, reject);
            }, delay);
            state.retryTimers.push(timerId);
          });
        }
        console.log('[LUMA_BRIDGE] ' + label + ' failed after ' + attemptNum + ' attempts' + (hooks.appId ? ' for AppID: ' + hooks.appId : ''));
        throw err;
      });
  }

  return tryOnce();
}

// ---------------------------------------------------------------------------
// Art chain loader — tries each step in order until an image renders.
// Steps starting with '/' are bridge paths resolved via bridgeUrl() and
// fetched as JSON ({ok, ct, b64} → Blob URL, same as the sidebar — never
// <img src="http://127.0.0.1"> which is blocked as mixed content). Any
// other step is a direct https image URL. When every step fails the <img>
// is hidden so the parent box's SVG fallback icon shows through. Callers
// create the <img> with opacity:0 — this fades it in on first success.
// ---------------------------------------------------------------------------
export function loadArtChain(img: HTMLImageElement, appId: string, steps: string[]): void {
  var idx = 0;
  var clean = steps.filter(function (s) {
    return !!s;
  });

  function fail(): void {
    idx++;
    if (idx >= clean.length) {
      img.style.display = 'none';
      return;
    }
    tryStep();
  }

  function show(src: string): void {
    img.onload = function () {
      img.style.opacity = '1';
    };
    img.onerror = function () {
      fail();
    };
    img.src = src;
  }

  function tryStep(): void {
    var step = clean[idx];
    if (step.charAt(0) === '/') {
      retryFetch(bridgeUrl(step), { method: 'GET', mode: 'cors', cache: 'no-store' }, 'modal-art', { appId: appId })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.ok || !d.b64) {
            fail();
            return;
          }
          var bin = atob(d.b64);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          show(URL.createObjectURL(new Blob([arr], { type: d.ct || 'image/jpeg' })));
        })
        .catch(function () {
          fail();
        });
    } else {
      show(step);
    }
  }

  console.log('[LUMA_BRIDGE] art chain for AppID ' + appId + ' — steps: ' + clean.length);
  if (clean.length === 0) {
    img.style.display = 'none';
    return;
  }
  tryStep();
}
