import { state, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, NAMESPACE } from '../core/state';
import { svgGear, svgX, svgSpinner, svgErrorCircle, svgDownload } from '../ui/svg';
import { ST } from '../ui/styles';
import { esc, bridgeUrl, downloadsQueueUrl } from '../ui/helpers';
import { retryFetch } from '../api/bridge';
import { closeModal } from './source';
import { t } from '../i18n';
import { openSidebar } from '../sidebar/SidebarPanel';

var SETTINGS_BTN_ID = 'luma-ssh-settings-btn';
var _settingsBtnTimer: ReturnType<typeof setInterval> | null = null;
var _settingsBtnHasDownloads = false;

// The floating gear must only exist on real surfaces (library main window,
// store pages). Context menus / notifications / supernavs inherit the
// steamloopback origin and run this script too — popups must stay clean, and
// so do the splash/tracking windows (about:blank, data:, 1x1 SharedJSContext).
//
// Theme-independent: inject on every steamloopback document except the
// surfaces we can positively exclude (context menu popups, gamepad ui, tiny
// windows). Earlier positive signals were broken — #library only exists with
// the fluenty theme, #root does not exist in the real library window, and
// [class*="FocusNavigationRoot"] never matches Steam's hashed CSS-module
// classes. The inject log carries a document identity dump so we can see
// exactly which surfaces got the gear and tighten from evidence.
// Returns '' when the surface is real, otherwise the reason it is skipped.
function transientReason(): string {
  try {
    var body = document.body;
    if (!body) return 'no body';
    var cls = body.className || '';
    if (cls.indexOf('ContextMenuPopupBody') !== -1) return 'context menu popup';
    // Steam writes these classes into <body> at CreatePopup document.write
    // time, so they are already present when the plugin script runs:
    // ModalDialogBody = Settings / Properties / promos / alerts (legacy modal,
    // ModalDialogPopup overlay, alert popups), HoverPopupBody = supernavs and
    // other hover popups.
    if (cls.indexOf('ModalDialogBody') !== -1) return 'modal dialog popup';
    if (cls.indexOf('HoverPopupBody') !== -1) return 'hover popup';
    // Friends List / chat windows carry "fullheight" as body (too generic) but
    // always set friendsui-container on <html>.
    var htmlCls = (document.documentElement && document.documentElement.className) || '';
    if (htmlCls.indexOf('friendsui-container') !== -1) return 'friends/chat window';
    if (cls.indexOf('GamepadUI') !== -1) return 'gamepad ui';
    if (window.innerWidth < 480 || window.innerHeight < 400) return 'tiny window ' + window.innerWidth + 'x' + window.innerHeight;
    // Login / Steam Guard surface: the SPA never changes the pathname (Steam
    // uses replaceState without a URL), so the only reliable signal is the
    // password field the sign-in form (and the PIN prompt) render. The check
    // runs before the hostname gate so it also covers the login window on
    // steamloopback; by the time the library mounts, the field is gone and
    // reconcile() injects the gear. Modal password fields in the library
    // cannot remove an existing gear — the id check above returns first.
    if (document.querySelector('input[type="password"]')) return 'login form (password input)';
    var host = location.hostname;
    if (host === 'store.steampowered.com') return '';
    if (host === 'steamloopback.host') return '';
    return 'origin ' + (host || location.protocol);
  } catch (_) { }
  return '';
}

// One-line identity dump of the document we just injected into — used to
// find which surfaces get the gear unnecessarily.
function docIdentity(): string {
  try {
    var b = document.body;
    var first = b && b.firstElementChild;
    var desc = first
      ? first.tagName.toLowerCase() + (first.id ? '#' + first.id : '') +
        (first.className && typeof first.className === 'string'
          ? '.' + first.className.split(/\s+/).slice(0, 3).join('.') : '')
      : 'none';
    return 'title=' + JSON.stringify(document.title) +
      ' path=' + location.pathname + location.hash +
      ' query=' + (location.search || '-').slice(0, 40) +
      ' bodyChildren=' + (b ? b.childElementCount : 0) +
      ' firstChild=' + desc +
      ' bodyCls=' + JSON.stringify(((b && b.className) || '').slice(0, 120)) +
      ' htmlCls=' + JSON.stringify(((document.documentElement && document.documentElement.className) || '').slice(0, 80)) +
      ' popupTarget=' + (document.getElementById('popup_target') ? 'Y' : 'N') +
      ' size=' + window.innerWidth + 'x' + window.innerHeight;
  } catch (_) { }
  return 'identity unavailable';
}

var _lastGearSkip = '';

export function ensureSettingsButton(): void {
  try {
    if (document.getElementById(SETTINGS_BTN_ID)) return;
    var reason = transientReason();
    if (reason) {
      if (reason !== _lastGearSkip) {
        _lastGearSkip = reason;
        console.log('[LUMA_INJECT] Floating settings button skipped: ' + reason +
          ' [doc] ' + docIdentity());
      }
      return;
    }
    _lastGearSkip = '';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = SETTINGS_BTN_ID;
    btn.setAttribute('aria-label', 'LumaForge');
    btn.title = 'LumaForge';
    btn.innerHTML = svgGear();
    // Store pages have no bottom bar → sit at 16px like always. The library
    // main window has a 50px bottom bar (Friends & Chat) → 66px clears it.
    var bottomPx = (location.hostname === 'store.steampowered.com') ? '16px' : '66px';
    btn.setAttribute('style',
      'position:fixed;bottom:' + bottomPx + ';right:16px;z-index:2147483647;' +
      'width:36px;height:36px;border-radius:50%;' +
      'background:rgba(30,30,40,.85);border:1px solid rgba(255,255,255,.15);' +
      'color:rgba(255,255,255,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.4);transition:all .2s;' +
      'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'
    );
    btn.addEventListener('mouseenter', function() {
      btn.style.background = 'rgba(50,50,65,.95)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'rgba(255,255,255,.3)';
      if (!_settingsBtnHasDownloads) btn.style.transform = 'scale(1.1)';
    });
    btn.addEventListener('mouseleave', function() {
      btn.style.background = _settingsBtnHasDownloads ? 'var(--luma-ssh-a20,rgba(102,192,255,.2))' : 'rgba(30,30,40,.85)';
      btn.style.color = _settingsBtnHasDownloads ? 'var(--luma-ssh-accent,#66c0ff)' : 'rgba(255,255,255,.6)';
      btn.style.borderColor = _settingsBtnHasDownloads ? 'var(--luma-ssh-a40,rgba(102,192,255,.4))' : 'rgba(255,255,255,.15)';
      btn.style.transform = 'scale(1)';
    });
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      // Downloads tab only while something is actually downloading — otherwise
      // land on the dashboard.
      openSidebar(_settingsBtnHasDownloads ? 'downloads' : 'dashboard');
    });

    (document.body || document.documentElement).appendChild(btn);
    console.log('[LUMA_INJECT] Floating settings button injected (surface=' +
      (location.hostname === 'store.steampowered.com' ? 'store' : 'library') +
      ', url=' + location.href + ') [doc] ' + docIdentity());

    // Start reactive icon update timer
    startSettingsBtnTimer();
  } catch (e) {
    console.error('[CEF_INJECT_ERROR] ensureSettingsButton:', e);
  }
}

function startSettingsBtnTimer(): void {
  if (_settingsBtnTimer) return;
  _settingsBtnTimer = setInterval(function() {
    var btn = document.getElementById(SETTINGS_BTN_ID) as HTMLElement | null;
    if (!btn) { stopSettingsBtnTimer(); return; }
    // Background/hidden documents (popups, minimized windows) must not poll —
    // N docs x 2s used to flood the bridge with TIME_WAIT connections.
    if (document.hidden) return;

    // Check bridge queue for active downloads
    fetch(downloadsQueueUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data || !data.ok) return;
        var queueActive = (data.queue || []).length > 0;
        var hasDownloads = queueActive || state.activeDownloads.length > 0;

        if (hasDownloads !== _settingsBtnHasDownloads) {
          _settingsBtnHasDownloads = hasDownloads;
          if (hasDownloads) {
            btn.innerHTML = svgDownload();
            btn.title = 'LumaForge \u2014 Active Downloads';
            btn.style.background = 'var(--luma-ssh-a15,rgba(102,192,255,.15))';
            btn.style.color = 'var(--luma-ssh-accent,#66c0ff)';
            btn.style.borderColor = 'var(--luma-ssh-a30,rgba(102,192,255,.3))';
            btn.style.animation = 'luma_ssh_download_pulse 2s ease-in-out infinite, luma_ssh_download_glow 2s ease-in-out infinite';
          } else {
            btn.innerHTML = svgGear();
            btn.title = 'LumaForge';
            btn.style.background = 'rgba(30,30,40,.85)';
            btn.style.color = 'rgba(255,255,255,.6)';
            btn.style.borderColor = 'rgba(255,255,255,.15)';
            btn.style.animation = 'none';
          }
        }
      })
      .catch(function() {});
  }, 2000);
}

function stopSettingsBtnTimer(): void {
  if (_settingsBtnTimer) {
    clearInterval(_settingsBtnTimer);
    _settingsBtnTimer = null;
  }
}

export function removeSettingsButton(): void {
  stopSettingsBtnTimer();
  var btn = document.getElementById(SETTINGS_BTN_ID);
  if (btn) btn.remove();
}

// ---------------------------------------------------------------------------
// Settings modal — manage provider API keys and configuration
// ---------------------------------------------------------------------------
export function openSettingsModal(): void {
  try {
    closeModal();
    state.savedFocusElement = document.activeElement;

    var backdrop = document.createElement('div');
    backdrop.setAttribute(MODAL_MARKER_ATTR, MODAL_MARKER_VAL);
    backdrop.setAttribute('class', 'luma-ssh-modal-backdrop');
    backdrop.setAttribute('style', ST.backdrop);

    var panel = document.createElement('div');
    panel.setAttribute('class', 'luma-ssh-modal-panel');
    panel.setAttribute('style', ST.panel);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    var titleId = 'luma-settings-title';
    panel.setAttribute('aria-labelledby', titleId);

    var header = document.createElement('div');
    header.setAttribute('style', ST.header);
    var hdrIcon = document.createElement('span');
    hdrIcon.setAttribute('style', ST.headerIcon);
    hdrIcon.innerHTML = svgGear();
    var hdrTextWrap = document.createElement('div');
    hdrTextWrap.setAttribute('style', 'min-width:0;flex:1;');
    var hdrTitle = document.createElement('div');
    hdrTitle.id = titleId;
    hdrTitle.setAttribute('style', ST.headerTitle);
    hdrTitle.textContent = t('Provider Settings');
    var hdrSubtitle = document.createElement('div');
    hdrSubtitle.setAttribute('style', ST.headerSubtitle);
    hdrSubtitle.textContent = t('Configure download providers and API keys');
    hdrTextWrap.appendChild(hdrTitle);
    hdrTextWrap.appendChild(hdrSubtitle);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('class', 'luma-ssh-close-btn');
    closeBtn.setAttribute('style', ST.closeBtn);
    closeBtn.setAttribute('aria-label', t('Close'));
    closeBtn.innerHTML = svgX();
    closeBtn.addEventListener('click', closeModal);

    var headerRight = document.createElement('div');
    headerRight.setAttribute('style', 'display:flex;align-items:center;flex-shrink:0;gap:4px;');
    headerRight.appendChild(closeBtn);

    header.appendChild(hdrIcon);
    header.appendChild(hdrTextWrap);
    header.appendChild(headerRight);

    var body = document.createElement('div');
    body.setAttribute('class', 'luma-ssh-modal-body');
    body.setAttribute('data-lumaforge-modal-body', 'true');
    body.setAttribute('style', ST.body);
    body.innerHTML =
      '<div style="' + ST.loading + '">' +
      svgSpinner() +
      '<span style="' + ST.loadingText + '">' + t('Loading settings…') + '</span>' +
      '</div>';

    var footer = document.createElement('div');
    footer.setAttribute('style', ST.footer);

    var testAllBtn = document.createElement('button');
    testAllBtn.type = 'button';
    testAllBtn.setAttribute('style', ST.cancelBtn);
    testAllBtn.textContent = t('Test All');
    testAllBtn.addEventListener('click', function() {
      var allRows = body.querySelectorAll('[data-provider-row]');
      allRows.forEach(function(row) {
        var testBtn = (row as Element).querySelector('[data-test-btn]');
        if (testBtn) (testBtn as HTMLButtonElement).click();
      });
    });

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.setAttribute('style', (ST as any).downloadBtn || ST.primaryBtn);
    saveBtn.textContent = t('Save Settings');
    saveBtn.addEventListener('click', function() {
      saveSettings(body);
    });

    footer.appendChild(testAllBtn);
    footer.appendChild(saveBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    backdrop.appendChild(panel);

    (document.body || document.documentElement).appendChild(backdrop);
    try { closeBtn.focus(); } catch (_) { }

    // Fetch current settings
    var settingsUrl = bridgeUrl('/api/settings');
    retryFetch(settingsUrl, { method: 'GET', mode: 'cors', cache: 'no-store' }, 'settings', {})
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        if (!data.ok) throw new Error(data.message || t('Failed to load settings'));
        renderSettingsProviders(body, data.providers || []);
      })
      .catch(function(err) {
        body.innerHTML =
          '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 16px;color:rgba(255,255,255,.5);">' +
          svgErrorCircle() +
          '<div>' + t('Failed to load settings') + ': ' + (err.message || err) + '</div>' +
          '</div>';
      });
  } catch (err) {
    console.error('[LUMA_INJECT] openSettingsModal error:', err);
  }
}

export function renderSettingsProviders(container: HTMLElement, providers: any[]): void {
  var html = '';
  html += '<div style="display:flex;flex-direction:column;gap:8px;">';

  for (var i = 0; i < providers.length; i++) {
    var p = providers[i];
    var toggleId = 'luma-setting-toggle-' + i;
    var keyId = 'luma-setting-key-' + i;
    var urlId = 'luma-setting-url-' + i;
    var testStatusId = 'luma-setting-test-' + i;

    html += '<div data-provider-row data-provider-id="' + esc(p.id) + '" data-provider-name="' + esc(p.name || '') + '" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;">';
    html += '<input type="checkbox" id="' + toggleId + '" data-provider-enabled ' + (p.enabled ? 'checked' : '') + ' style="opacity:0;width:0;height:0;position:absolute;">';
    html += '<span style="position:absolute;inset:0;background:rgba(255,255,255,.15);border-radius:10px;transition:background .2s;"></span>';
    html += '<span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;' + (p.enabled ? 'transform:translateX(16px);' : '') + '"></span>';
    html += '</label>';
    html += '<span style="font-size:13px;font-weight:600;color:rgba(255,255,255,.9);">' + esc(p.name) + '</span>';
    html += '</div>';
    html += '<span id="' + testStatusId + '" style="font-size:11px;color:rgba(255,255,255,.4);"></span>';
    html += '</div>';

    html += '<div style="display:flex;flex-direction:column;gap:6px;">';
    if (p.id === 'steamkeys') {
      html += '<div style="font-size:11px;color:#64c882;">' + t('Local provider — no URL and no API key required (lua generation + manifest fetch)') + '</div>';
    } else {
      html += '<div style="display:flex;align-items:center;gap:6px;">';
      html += '<label style="font-size:11px;color:rgba(255,255,255,.5);width:60px;flex-shrink:0;">URL</label>';
      html += '<input id="' + urlId + '" data-provider-url type="text" value="' + esc(p.baseUrl || '') + '" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:5px 8px;color:rgba(255,255,255,.9);font-size:12px;font-family:monospace;outline:none;">';
      html += '</div>';
      html += '<div style="display:flex;align-items:center;gap:6px;">';
      html += '<label style="font-size:11px;color:rgba(255,255,255,.5);width:60px;flex-shrink:0;">API Key</label>';
      html += '<input id="' + keyId + '" data-provider-key type="password" value="" placeholder="' + (p.hasKey ? p.maskedKey : t('No key set')) + '" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:5px 8px;color:rgba(255,255,255,.9);font-size:12px;font-family:monospace;outline:none;">';
      html += '<button data-test-btn type="button" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:4px;padding:5px 10px;color:rgba(255,255,255,.7);font-size:11px;cursor:pointer;white-space:nowrap;">' + t('Test') + '</button>';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;

  // Wire up toggle switch styling
  var toggles = container.querySelectorAll('input[type="checkbox"]');
  toggles.forEach(function(toggle) {
    (toggle as HTMLInputElement).addEventListener('change', function() {
      var slider = toggle.parentElement!.querySelector('span:first-child') as HTMLElement;
      var knob = toggle.parentElement!.querySelector('span:last-child') as HTMLElement;
      if ((toggle as HTMLInputElement).checked) {
        slider.style.background = 'rgba(76,175,80,.6)';
        knob.style.transform = 'translateX(16px)';
      } else {
        slider.style.background = 'rgba(255,255,255,.15)';
        knob.style.transform = 'translateX(0)';
      }
    });
    toggle.dispatchEvent(new Event('change'));
  });

  // Wire up test buttons
  var testBtns = container.querySelectorAll('[data-test-btn]');
  testBtns.forEach(function(btn) {
    (btn as HTMLButtonElement).addEventListener('click', function() {
      var row = btn.closest('[data-provider-row]')!;
      var providerId = row.getAttribute('data-provider-id');
      var urlInput = row.querySelector('[data-provider-url]') as HTMLInputElement;
      var keyInput = row.querySelector('[data-provider-key]') as HTMLInputElement;
      var statusEl = row.querySelector('[id^="luma-setting-test-"]') as HTMLElement;

      (btn as HTMLButtonElement).textContent = t('Testing\u2026');
      (btn as HTMLButtonElement).disabled = true;
      statusEl.textContent = '';
      statusEl.style.color = 'rgba(255,255,255,.4)';

      var payload = JSON.stringify({
        providerId: providerId,
        baseUrl: urlInput.value,
        apiKey: keyInput.value || undefined
      });

      retryFetch(bridgeUrl('/api/settings/test-key'), {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }, 'settings-test', {})
        .then(function(r) { return r.json(); })
        .then(function(data) {
          (btn as HTMLButtonElement).textContent = t('Test');
          (btn as HTMLButtonElement).disabled = false;
          if (data.ok) {
            statusEl.textContent = '\u2713 ' + data.message;
            statusEl.style.color = '#4caf50';
          } else {
            statusEl.textContent = '\u2717 ' + data.message;
            statusEl.style.color = '#e74c3c';
          }
        })
        .catch(function(err) {
          (btn as HTMLButtonElement).textContent = t('Test');
          (btn as HTMLButtonElement).disabled = false;
          statusEl.textContent = '\u2717 ' + t('Error') + ': ' + (err.message || err);
          statusEl.style.color = '#e74c3c';
        });
    });
  });
}

export function saveSettings(container: HTMLElement): void {
  var rows = container.querySelectorAll('[data-provider-row]');
  var providers: any[] = [];

  rows.forEach(function(row) {
    var id = row.getAttribute('data-provider-id');
    var enabled = (row.querySelector('[data-provider-enabled]') as HTMLInputElement).checked;
    var urlInput = row.querySelector('[data-provider-url]') as HTMLInputElement | null;
    var baseUrl = urlInput ? urlInput.value : undefined;
    var keyInput = row.querySelector('[data-provider-key]') as HTMLInputElement | null;
    var apiKey = keyInput && keyInput.value ? keyInput.value : undefined;
    var nameAttr = row.getAttribute('data-provider-name');

    providers.push({
      id: id,
      name: nameAttr || (id!.charAt(0).toUpperCase() + id!.slice(1)),
      enabled: enabled,
      baseUrl: baseUrl,
      apiKey: apiKey
    });
  });

  var saveBtn = container.closest('[role="dialog"]')!.querySelector('button:last-child') as HTMLButtonElement;
  if (saveBtn) {
    saveBtn.textContent = t('Saving\u2026');
    saveBtn.disabled = true;
  }

  retryFetch(bridgeUrl('/api/settings'), {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers: providers })
  }, 'settings-save', {})
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (saveBtn) {
        saveBtn.textContent = data.ok ? '\u2713 ' + t('Saved') : t('Save Settings');
        saveBtn.disabled = false;
      }
      if (data.ok) {
        closeModal();
      }
    })
    .catch(function(err) {
      if (saveBtn) {
        saveBtn.textContent = t('Save Settings');
        saveBtn.disabled = false;
      }
    });
}
