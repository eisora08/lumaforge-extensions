import { state } from '../core/state';

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
