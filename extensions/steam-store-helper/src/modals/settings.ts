import { state, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, NAMESPACE } from '../core/state';
import { svgGear, svgX, svgSpinner, svgErrorCircle } from '../ui/svg';
import { ST } from '../ui/styles';
import { esc, bridgeUrl } from '../ui/helpers';
import { retryFetch } from '../api/bridge';
import { closeModal } from './source';
import { openSidebar } from '../sidebar/SidebarPanel';

var SETTINGS_BTN_ID = 'luma-ssh-settings-btn';

export function ensureSettingsButton(): void {
  try {
    if (document.getElementById(SETTINGS_BTN_ID)) return;
    if (!window.location.pathname.match(/\/app\/\d+/)) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = SETTINGS_BTN_ID;
    btn.setAttribute('aria-label', 'LumaForge Settings');
    btn.title = 'LumaForge Provider Settings';
    btn.innerHTML = svgGear();
    btn.setAttribute('style',
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;' +
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
      btn.style.transform = 'scale(1.1)';
    });
    btn.addEventListener('mouseleave', function() {
      btn.style.background = 'rgba(30,30,40,.85)';
      btn.style.color = 'rgba(255,255,255,.6)';
      btn.style.borderColor = 'rgba(255,255,255,.15)';
      btn.style.transform = 'scale(1)';
    });
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      openSidebar();
    });

    (document.body || document.documentElement).appendChild(btn);
    console.log('[LUMA_INJECT] Floating settings button injected');
  } catch (e) {
    console.error('[CEF_INJECT_ERROR] ensureSettingsButton:', e);
  }
}

export function removeSettingsButton(): void {
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
    hdrTitle.textContent = 'Provider Settings';
    var hdrSubtitle = document.createElement('div');
    hdrSubtitle.setAttribute('style', ST.headerSubtitle);
    hdrSubtitle.textContent = 'Configure download providers and API keys';
    hdrTextWrap.appendChild(hdrTitle);
    hdrTextWrap.appendChild(hdrSubtitle);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('class', 'luma-ssh-close-btn');
    closeBtn.setAttribute('style', ST.closeBtn);
    closeBtn.setAttribute('aria-label', 'Close');
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
      '<span style="' + ST.loadingText + '">Loading settings\u2026</span>' +
      '</div>';

    var footer = document.createElement('div');
    footer.setAttribute('style', ST.footer);

    var testAllBtn = document.createElement('button');
    testAllBtn.type = 'button';
    testAllBtn.setAttribute('style', ST.cancelBtn);
    testAllBtn.textContent = 'Test All';
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
    saveBtn.textContent = 'Save Settings';
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
        if (!data.ok) throw new Error(data.message || 'Failed to load settings');
        renderSettingsProviders(body, data.providers || []);
      })
      .catch(function(err) {
        body.innerHTML =
          '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 16px;color:rgba(255,255,255,.5);">' +
          svgErrorCircle() +
          '<div>Failed to load settings: ' + (err.message || err) + '</div>' +
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

    html += '<div data-provider-row data-provider-id="' + esc(p.id) + '" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px;">';
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
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += '<label style="font-size:11px;color:rgba(255,255,255,.5);width:60px;flex-shrink:0;">URL</label>';
    html += '<input id="' + urlId + '" data-provider-url type="text" value="' + esc(p.baseUrl || '') + '" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:5px 8px;color:rgba(255,255,255,.9);font-size:12px;font-family:monospace;outline:none;">';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += '<label style="font-size:11px;color:rgba(255,255,255,.5);width:60px;flex-shrink:0;">API Key</label>';
    html += '<input id="' + keyId + '" data-provider-key type="password" value="" placeholder="' + (p.hasKey ? p.maskedKey : 'No key set') + '" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:5px 8px;color:rgba(255,255,255,.9);font-size:12px;font-family:monospace;outline:none;">';
    html += '<button data-test-btn type="button" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:4px;padding:5px 10px;color:rgba(255,255,255,.7);font-size:11px;cursor:pointer;white-space:nowrap;">Test</button>';
    html += '</div>';
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

      (btn as HTMLButtonElement).textContent = 'Testing\u2026';
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
          (btn as HTMLButtonElement).textContent = 'Test';
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
          (btn as HTMLButtonElement).textContent = 'Test';
          (btn as HTMLButtonElement).disabled = false;
          statusEl.textContent = '\u2717 Error: ' + (err.message || err);
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
    var baseUrl = (row.querySelector('[data-provider-url]') as HTMLInputElement).value;
    var keyInput = row.querySelector('[data-provider-key]') as HTMLInputElement;
    var apiKey = keyInput.value || undefined;

    providers.push({
      id: id,
      name: id!.charAt(0).toUpperCase() + id!.slice(1),
      enabled: enabled,
      baseUrl: baseUrl,
      apiKey: apiKey
    });
  });

  var saveBtn = container.closest('[role="dialog"]')!.querySelector('button:last-child') as HTMLButtonElement;
  if (saveBtn) {
    saveBtn.textContent = 'Saving\u2026';
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
        saveBtn.textContent = data.ok ? '\u2713 Saved' : 'Save Settings';
        saveBtn.disabled = false;
      }
      if (data.ok) {
        closeModal();
      }
    })
    .catch(function(err) {
      if (saveBtn) {
        saveBtn.textContent = 'Save Settings';
        saveBtn.disabled = false;
      }
    });
}
