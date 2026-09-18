import { state, BTN_ID, BTN_APPID_ATTR, BTN_STATE_ATTR, MODAL_MARKER_ATTR, MODAL_MARKER_VAL, LUMA_INJECT_VERSION, IS_LINUX } from '../core/state';
import { svgDownload, svgSpinner, svgCheck, svgX, svgCloudDownload, svgLock, svgBox, svgErrorCircle, svgLibrary } from '../ui/svg';
import { ST, dot } from '../ui/styles';
import { formatFileSize, formatTimeRemaining, sourcesUrl, providerStatsUrl, downloadUrl, downloadStatusUrl, openLibraryUrl, getModalBody, getModalBadge, esc } from '../ui/helpers';
import { bridgeFetch } from '../api/bridge';
import { setButtonState, setButtonLumaState } from '../ui/button';
import { openDepotModal } from './depot';
import { ensureSettingsButton, openSettingsModal } from './settings';

// ---------------------------------------------------------------------------
// Modal: close
// ---------------------------------------------------------------------------
export function closeModal(): void {
  try {
    if (state.providerAbortController) {
      state.providerAbortController.abort();
      state.providerAbortController = null;
    }
    stopDownloadPoll();
    var m = document.querySelector('[' + MODAL_MARKER_ATTR + '="' + MODAL_MARKER_VAL + '"]');
    if (m) m.remove();
    if (state.savedFocusElement && (state.savedFocusElement as any).isConnected) {
      (state.savedFocusElement as HTMLElement).focus();
    }
    state.savedFocusElement = null;
  } catch (e) { console.error('[CEF_INJECT_ERROR] closeModal:', e); }
}

// ---------------------------------------------------------------------------
// Modal: build and show
// ---------------------------------------------------------------------------
export function openSourceModal(appId: string): void {
  try {
    console.log('[LUMA_INJECT] Opening modal for AppID:', appId);

    state.savedFocusElement = document.activeElement;
    closeModal();

    var backdrop = document.createElement('div');
    backdrop.setAttribute(MODAL_MARKER_ATTR, MODAL_MARKER_VAL);
    backdrop.setAttribute('class', 'luma-ssh-modal-backdrop');
    backdrop.setAttribute('style', ST.backdrop);

    var panel = document.createElement('div');
    panel.setAttribute('class', 'luma-ssh-modal-panel');
    panel.setAttribute('style', ST.panel);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    var titleId = 'luma-modal-title-' + appId;
    var descId = 'luma-modal-desc-' + appId;
    panel.setAttribute('aria-labelledby', titleId);
    panel.setAttribute('aria-describedby', descId);
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    var header = document.createElement('div');
    header.setAttribute('style', ST.header);
    var hdrIcon = document.createElement('span');
    hdrIcon.setAttribute('style', ST.headerIcon);
    hdrIcon.innerHTML = svgCloudDownload();
    var hdrTextWrap = document.createElement('div');
    hdrTextWrap.setAttribute('style', 'min-width:0;flex:1;');
    var hdrTitle = document.createElement('div');
    hdrTitle.id = titleId;
    hdrTitle.setAttribute('style', ST.headerTitle);
    hdrTitle.textContent = 'Select Download Source';
    var hdrSubtitle = document.createElement('div');
    hdrSubtitle.id = descId;
    hdrSubtitle.setAttribute('style', ST.headerSubtitle);
    hdrSubtitle.textContent = 'Choose a trusted provider for this package';
    hdrTextWrap.appendChild(hdrTitle);
    hdrTextWrap.appendChild(hdrSubtitle);

    var hdrVersion = document.createElement('span');
    hdrVersion.setAttribute('style', ST.headerVersion);
    var verParts = (LUMA_INJECT_VERSION || '').split('-');
    hdrVersion.textContent = 'v' + (verParts[0] || LUMA_INJECT_VERSION);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('class', 'luma-ssh-close-btn');
    closeBtn.setAttribute('style', ST.closeBtn);
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = svgX();
    closeBtn.addEventListener('click', closeModal);

    var headerRight = document.createElement('div');
    headerRight.setAttribute('style', 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;');

    var settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.setAttribute('style', 'background:none;border:none;cursor:pointer;padding:4px;color:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background .15s,color .15s;');
    settingsBtn.setAttribute('aria-label', 'Settings');
    settingsBtn.innerHTML = svgBox();
    settingsBtn.addEventListener('mouseenter', function() { settingsBtn.style.color = '#fff'; settingsBtn.style.background = 'rgba(255,255,255,.1)'; });
    settingsBtn.addEventListener('mouseleave', function() { settingsBtn.style.color = 'rgba(255,255,255,.55)'; settingsBtn.style.background = 'none'; });
    settingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openSettingsModal();
    });

    headerRight.appendChild(hdrVersion);
    headerRight.appendChild(settingsBtn);
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
      '<span style="' + ST.loadingText + '">Loading providers\u2026</span>' +
      '</div>';

    var footer = document.createElement('div');
    footer.setAttribute('style', ST.footer);
    var footerNote = document.createElement('span');
    footerNote.setAttribute('style', ST.footerNote);
    footerNote.textContent = 'Packages are installed through LumaForge';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.setAttribute('style', ST.cancelBtn);
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeModal);
    footer.appendChild(footerNote);
    footer.appendChild(cancelBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    backdrop.appendChild(panel);

    (document.body || document.documentElement).appendChild(backdrop);
    console.log('[LUMA_INJECT] Modal appended to document.body');

    try { closeBtn.focus(); } catch (_) { }
    try { logModalHorizontalOverflow(); } catch (_) { }

    console.log("[PROVIDER_FETCH] VERSION:", LUMA_INJECT_VERSION);
    console.log("[PROVIDER_FETCH] METHOD:", "GET");
    console.log("[PROVIDER_FETCH] URL:", sourcesUrl(appId));
    console.log("[PROVIDER_FETCH] PAGE:", window.location.href);
    console.log("[PROVIDER_FETCH] ORIGIN:", window.location.origin);
    console.log("[PROVIDER_FETCH] PROTOCOL:", window.location.protocol);
    console.log("[PROVIDER_FETCH] SECURE_CONTEXT:", window.isSecureContext);

    if (state.providerAbortController) {
      state.providerAbortController.abort();
    }
    var providerController = new AbortController();
    state.providerAbortController = providerController;
    var providerTimeout = setTimeout(function () {
      if (!providerController.signal.aborted) {
        console.error(
          '[LUMA_BRIDGE] Sources request timed out for AppID:',
          appId
        );

        providerController.abort();
      }
    }, 12000);
    var url = sourcesUrl(appId);
    var providerOpts: RequestInit = { method: 'GET', mode: 'cors', cache: 'no-store', signal: providerController.signal };
    bridgeFetch(url, providerOpts, 'sources')
      .then(function (r) {
        clearTimeout(providerTimeout);
        console.log("[PROVIDER_FETCH] RESPONSE_RECEIVED:", true);
        console.log("[PROVIDER_FETCH] STATUS:", r.status);
        console.log("[PROVIDER_FETCH] OK:", r.ok);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (providerController.signal.aborted) {
          console.log(
            '[PROVIDER_FETCH] Response ignored because request was aborted'
          );

          return;
        }

        console.log(
          '[PROVIDER_FETCH] PARSED_RESPONSE:',
          data
        );

        var sources = Array.isArray(data.sources)
          ? data.sources
          : [];

        var unavailableSources = Array.isArray(
          data.unavailableSources
        )
          ? data.unavailableSources
          : [];

        console.log(
          '[PROVIDER_FETCH] AVAILABLE_SOURCES:',
          sources.length
        );

        console.log(
          '[PROVIDER_FETCH] UNAVAILABLE_SOURCES:',
          unavailableSources.length
        );

        function renderWithStats(providerStats: any) {
          if (data && data.ok === true) {
            renderSources(
              body,
              sources,
              unavailableSources,
              appId,
              data.message || null,
              providerStats || null
            );
            if (
              state.providerAbortController ===
              providerController
            ) {
              state.providerAbortController = null;
            }
            return;
          }
          throw new Error(
            data && data.message
              ? data.message
              : 'Invalid response from bridge'
          );
        }

        fetch(providerStatsUrl(), {
          method: 'GET',
          mode: 'cors',
          cache: 'no-store',
          signal: providerController.signal,
        })
          .then(function (r) {
            if (!r.ok) return null;
            return r.json();
          })
          .then(function (statsData) {
            if (providerController.signal.aborted) return;
            var providerStats = (statsData && statsData.ok && Array.isArray(statsData.providers))
              ? statsData.providers
              : null;
            state.providerStatsCache = providerStats;
            renderWithStats(providerStats);
          })
          .catch(function () {
            renderWithStats(null);
          });
      })
      .catch(function (error) {
        clearTimeout(providerTimeout);

        var modal = document.querySelector(
          '[' +
          MODAL_MARKER_ATTR +
          '="' +
          MODAL_MARKER_VAL +
          '"]'
        );

        // El modal ya fue cerrado. No hay UI que actualizar.
        if (!modal) {
          return;
        }

        var wasTimedOut =
          error &&
          error.name === 'AbortError' &&
          providerController.signal.aborted &&
          state.providerAbortController === providerController;

        var wasClosedOrReplaced =
          error &&
          error.name === 'AbortError' &&
          state.providerAbortController !== providerController;

        // Cerrar el modal o abrir otro modal aborta la solicitud.
        // Eso no debe mostrarse como un error.
        if (wasClosedOrReplaced) {
          return;
        }

        console.error(
          '[PROVIDER_FETCH] REJECTED:',
          error
        );

        console.error(
          '[PROVIDER_FETCH] ERROR_NAME:',
          error && error.name
        );

        console.error(
          '[PROVIDER_FETCH] ERROR_MESSAGE:',
          error && error.message
        );

        var detail = wasTimedOut
          ? 'The provider check took too long. Please try again.'
          : (
            (error && error.name
              ? error.name
              : 'Error') +
            ': ' +
            (error && error.message
              ? error.message
              : 'Unknown provider error')
          );

        body.innerHTML =
          '<div style="' + ST.errorWrap + '">' +
          '<div style="' + ST.errorMsg + '">' +
          'Could not check package sources.' +
          '</div>' +
          '<div style="' + ST.errorDetail + '">' +
          detail +
          '</div>' +
          '<div style="text-align:center">' +
          '<button id="luma-retry-sources" style="' +
          ST.retryBtn +
          '">' +
          'Retry' +
          '</button>' +
          '</div>' +
          '</div>';
      });

  } catch (e) { console.error('[CEF_INJECT_ERROR] openSourceModal:', e); }
}

// ---------------------------------------------------------------------------
// Modal: render source list
// ---------------------------------------------------------------------------
export function renderSources(
  body: HTMLElement,
  sources: any[],
  unavailableSources: any[],
  appId: string,
  message: string | null,
  providerStats: any[] | null
): void {
  try {
    console.log(
      '[PROVIDER_RENDER] Rendering sources:',
      {
        appId: appId,
        available: sources
          ? sources.length
          : 0,
        unavailable: unavailableSources
          ? unavailableSources.length
          : 0,
        message: message
      }
    );

    function findProviderStat(sourceId: string) {
      if (!providerStats || !sourceId) return null;
      for (var i = 0; i < providerStats.length; i++) {
        if (providerStats[i].id === sourceId) return providerStats[i];
      }
      return null;
    }

    function buildBlockedCard(source: any) {
      var sourceId = source.id || '';
      var sourceName = source.name || sourceId || 'Provider';
      var reason = source.detail || 'Package not available';
      var pstat = findProviderStat(sourceId);

      var card = document.createElement('div');
      card.className = 'luma-source-card blocked';
      card.setAttribute('data-lumaforge-source-id', sourceId);

      var icon = document.createElement('div');
      icon.setAttribute('style', ST.cardIcon + 'color:var(--luma-ssh-text-muted,#8f98a0);');
      icon.innerHTML = svgLock();

      var info = document.createElement('div');
      info.setAttribute('style', ST.cardInfo);
      var name = document.createElement('div');
      name.setAttribute('style', ST.cardName + 'color:var(--luma-ssh-text-muted,#8f98a0);');
      name.textContent = sourceName;
      var detail = document.createElement('div');
      detail.setAttribute('style', ST.cardDetail);
      detail.textContent = reason;
      info.appendChild(name);
      info.appendChild(detail);

      if (pstat && pstat.hasKey && pstat.apiKeyExpiresAt) {
        var expMs = Date.parse(pstat.apiKeyExpiresAt);
        var nowMs = Date.now();
        var remainingMs = expMs - nowMs;
        var expiryClass = 'ok';
        var expiryText = '';

        if (remainingMs <= 0) {
          expiryClass = 'expired';
          expiryText = 'API Key Expired';
        } else {
          var days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
          var hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          expiryText = 'Key expires in ' + days + 'd ' + hours + 'h';
          if (days < 3) expiryClass = 'warning';
        }

        var usageParts: string[] = [];
        if (pstat.remainingToday != null && pstat.dailyLimit != null && pstat.dailyLimit > 0) {
          usageParts.push(pstat.remainingToday + '/' + pstat.dailyLimit + ' downloads today');
        }
        if (pstat.canMakeRequests === false) {
          usageParts.push('Requests unavailable');
        }

        var expiryBadge = document.createElement('div');
        expiryBadge.className = 'luma-source-expiry ' + expiryClass;
        expiryBadge.textContent = expiryText;
        info.appendChild(expiryBadge);

        if (usageParts.length > 0) {
          var usageLine = document.createElement('div');
          usageLine.className = 'luma-usage-chips';
          usageParts.forEach(function(part) {
            var chip = document.createElement('span');
            chip.className = 'luma-usage-chip';
            chip.textContent = part;
            usageLine.appendChild(chip);
          });
          info.appendChild(usageLine);
        }
      } else if (pstat && !pstat.hasKey) {
        var noKeyLine = document.createElement('div');
        noKeyLine.setAttribute('style', 'font-size:10px;color:var(--luma-ssh-error,#e74c3c);margin-top:3px;');
        noKeyLine.textContent = 'No API key configured';
        info.appendChild(noKeyLine);
      }

      var badge = document.createElement('div');
      badge.setAttribute('data-lumaforge-source-badge', 'true');
      badge.setAttribute('style', ST.badgeUnavail);
      badge.innerHTML = svgLock() + '<span>Unavailable</span>';

      var tooltip = document.createElement('div');
      tooltip.className = 'luma-source-tooltip';
      tooltip.textContent = sourceName + ': ' + reason;

      card.appendChild(icon);
      card.appendChild(info);
      card.appendChild(badge);
      card.appendChild(tooltip);

      return card;
    }

    if (!sources || !sources.length) {
      body.innerHTML =
        '<div style="' + ST.errorWrap + '">' +
        '<div style="' + ST.errorMsg + '">' +
        'No package sources available.' +
        '</div>' +
        '<div style="' + ST.errorDetail + '">' +
        (
          message ||
          'No enabled provider currently has a package for this App ID.'
        ) +
        '</div>' +
        '</div>';

      if (unavailableSources && unavailableSources.length) {
        var unavailWrap = document.createElement('div');
        unavailWrap.setAttribute('style', 'margin-top:12px;');
        unavailableSources.forEach(function (src) {
          unavailWrap.appendChild(buildBlockedCard(src));
        });
        body.appendChild(unavailWrap);
      }

      console.log(
        '[PROVIDER_RENDER] Empty-source state rendered'
      );

      return;
    }

    // Conserva aquí el resto actual de renderSources().
    body.innerHTML = '';
    sources.forEach(function (src) {


      var selectable = src.selectable === true;
      var avail = src.available === true;

      var checkOnDownload =
        src.availabilityState === 'check_on_download' ||
        src.availability_state === 'check_on_download';



      var card = document.createElement('div');
      card.className = 'luma-source-card';

      if (!selectable) {
        card.setAttribute('style', 'opacity:.45;cursor:default;');
      }

      card.setAttribute('data-lumaforge-source-id', src.id);

      var icon = document.createElement('div');
      icon.setAttribute('style', ST.cardIcon);
      icon.innerHTML = svgDownload(18, 18);

      var info = document.createElement('div');
      info.setAttribute('style', ST.cardInfo);
      var name = document.createElement('div');
      name.setAttribute('style', ST.cardName);
      name.textContent = src.name || src.id;
      var detail = document.createElement('div');
      detail.setAttribute('style', ST.cardDetail);
      if (avail) {
        var packageSize = formatFileSize(
          src.total || src.packageSize || 0
        );

        if (packageSize) {
          detail.textContent =
            'Package available \u2022 ' + packageSize;
        } else {
          detail.textContent = 'Package available';
        }
      } else if (checkOnDownload && selectable) {
        detail.textContent =
          'Select Ryuu to download the package';
      } else {
        detail.textContent =
          src.detail || 'Not available';
      }
      info.appendChild(name);
      info.appendChild(detail);

      var cardSourceStats: any = null;
      if (src.usage) {
        cardSourceStats = src.usage;
      } else {
        var pstat = findProviderStat(src.id);
        if (pstat && pstat.hasKey) {
          cardSourceStats = {
            remaining_today: pstat.remainingToday,
            daily_limit: pstat.dailyLimit,
            api_key_expires_at: pstat.apiKeyExpiresAt,
            can_make_requests: pstat.canMakeRequests,
          };
        }
      }

      if (cardSourceStats) {
        var usageParts: string[] = [];

        var remainingToday = Number(
          cardSourceStats.remaining_today != null
            ? cardSourceStats.remaining_today
            : cardSourceStats.remainingToday
        );

        var dailyLimit = Number(
          cardSourceStats.daily_limit != null
            ? cardSourceStats.daily_limit
            : cardSourceStats.dailyLimit
        );

        var expiresAt =
          cardSourceStats.api_key_expires_at ||
          cardSourceStats.apiKeyExpiresAt ||
          null;

        var serverTimestamp =
          cardSourceStats.timestamp || null;

        if (
          Number.isFinite(remainingToday) &&
          Number.isFinite(dailyLimit) &&
          dailyLimit > 0
        ) {
          usageParts.push(
            remainingToday +
            '/' +
            dailyLimit +
            ' downloads left'
          );
        }

        var expirationText = formatTimeRemaining(
          expiresAt,
          serverTimestamp
        );

        if (expirationText) {
          usageParts.push(
            expirationText === 'Expired'
              ? 'API key expired'
              : 'Key: ' + expirationText
          );
        }

        if (cardSourceStats.can_make_requests === false) {
          usageParts.push('Requests unavailable');
        }

        if (usageParts.length > 0) {
          var usageDetail = document.createElement('div');
          usageDetail.className = 'luma-usage-chips';
          usageParts.forEach(function(part) {
            var chip = document.createElement('span');
            chip.className = 'luma-usage-chip';
            chip.textContent = part;
            usageDetail.appendChild(chip);
          });

          info.appendChild(usageDetail);
        }
      }

      var badge = document.createElement('div');
      badge.setAttribute('data-lumaforge-source-badge', 'true');
      badge.setAttribute('class', 'luma-source-badge-wrap');

      if (avail) {
        badge.setAttribute(
          'style',
          ST.badgeAvail
        );

        badge.innerHTML =
          dot('green') +
          '<span>Available</span>';
      } else if (checkOnDownload && selectable) {
        badge.setAttribute(
          'style',
          'display:inline-flex;' +
          'align-items:center;' +
          'gap:4px;' +
          'padding:4px 10px;' +
          'border-radius:12px;' +
          'font-size:11px;' +
          'font-weight:700;' +
          'white-space:nowrap;' +
          'flex-shrink:0;' +
          'background:rgba(102,192,255,.14);' +
          'color:var(--luma-ssh-accent,#66c0ff);' +
          'box-shadow:0 0 8px rgba(102,192,255,.16);'
        );

        badge.innerHTML =
          dot('blue') +
          '<span>Download</span>';
      } else {
        badge.setAttribute(
          'style',
          ST.badgeUnavail
        );

        badge.innerHTML =
          dot('gray') +
          '<span>Unavailable</span>';
      }

      var tooltip = document.createElement('div');
      tooltip.className = 'luma-source-tooltip';
      var tooltipParts: string[] = [];
      tooltipParts.push((src.name || src.id || 'Provider') + ': ' + (src.detail || (avail ? 'Package available' : 'Not available')));
      if (avail) {
        var pstat2 = findProviderStat(src.id);
        if (pstat2 && pstat2.hasKey) {
          if (pstat2.remainingToday != null && pstat2.dailyLimit != null && pstat2.dailyLimit > 0) {
            tooltipParts.push('Downloads: ' + pstat2.remainingToday + '/' + pstat2.dailyLimit + ' remaining today');
          }
          if (pstat2.apiKeyExpiresAt) {
            var expText = formatTimeRemaining(pstat2.apiKeyExpiresAt);
            if (expText) {
              tooltipParts.push('API key: ' + (expText === 'Expired' ? 'Expired' : expText + ' remaining'));
            }
          }
        }
      }
      tooltip.textContent = tooltipParts.join(' \u2022 ');

      card.appendChild(icon);
      card.appendChild(info);
      card.appendChild(badge);
      card.appendChild(tooltip);


      if (selectable) {
        card.addEventListener('click', function () {
          handleSourceClick(card, appId, src.id);
        });
      }


      body.appendChild(card);
    });

    if (unavailableSources && unavailableSources.length) {
      var blockedHeader = document.createElement('div');
      blockedHeader.setAttribute('style',
        'font-size:11px;color:var(--luma-ssh-text-muted,#8f98a0);font-weight:600;text-transform:uppercase;' +
        'letter-spacing:.5px;margin-top:14px;margin-bottom:6px;padding-left:2px;'
      );
      blockedHeader.textContent = 'Unavailable Sources';
      body.appendChild(blockedHeader);

      unavailableSources.forEach(function (src) {
        body.appendChild(buildBlockedCard(src));
      });
    }

    try { logModalHorizontalOverflow(); } catch (_) { }
  } catch (e) { console.error('[CEF_INJECT_ERROR] renderSources:', e); }
}

// ---------------------------------------------------------------------------
// Modal: source click -> download with state machine
// ---------------------------------------------------------------------------
export function handleSourceClick(card: HTMLElement, appId: string, sourceId: string): void {
  try {
    if (card.getAttribute('data-pending') === 'true') return;
    card.setAttribute('data-pending', 'true');
    card.setAttribute('style', 'opacity:.5;cursor:wait;pointer-events:none;');

    var badge = getModalBadge(card);
    if (badge) {
      badge.setAttribute('style', ST.badgeAvail);
      badge.innerHTML = dot('blue') + '<span>ADDING\u2026</span>';
    }

    setButtonState(appId, ST.btn + 'opacity:.7;pointer-events:none;', svgSpinner() + '<span>ADDING\u2026</span>', true);
    setButtonLumaState(appId, 'adding');

    var selectedOutputType = 'lua+manifest';
    var outputRadio = document.querySelector('input[name="luma-output-type"]:checked') as HTMLInputElement | null;
    if (outputRadio) selectedOutputType = outputRadio.value;

    var payload = JSON.stringify({ appId: appId, sourceId: sourceId, outputType: selectedOutputType });
    bridgeFetch(downloadUrl(), {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }, 'download')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.message) || 'Download rejected');
        console.log('[LUMA_INJECT] Download accepted for', appId, 'via', sourceId, 'requestId:', d.requestId);

        state.requestContext = {
          requestId: d.requestId,
          appId: appId,
          sourceId: sourceId,
        };

        // Also track in activeDownloads for sidebar
        state.activeDownloads.push({
          requestId: d.requestId,
          appId: appId,
          sourceId: sourceId,
          pollSeq: 0,
          pollTimer: null,
          phase: 'Queued',
          progress: 0,
          speed: 0,
          bytesDownloaded: 0,
          totalBytes: 0,
        });

        if (badge) {
          badge.setAttribute('style', ST.badgeAvail);
          badge.innerHTML = dot('blue') + '<span>Queued</span>';
        }

        showDownloadProgress(appId, d.requestId);
        startDownloadPoll(d.requestId, appId);
      })
      .catch(function (err) {
        console.error('[LUMA_BRIDGE] download — Error:', err.message || err);
        card.setAttribute('data-pending', 'false');
        card.removeAttribute('style');
        if (badge) {
          badge.setAttribute('style', ST.badgeUnavail);
          badge.innerHTML = dot('red') + '<span>FAILED \u2014 RETRY</span>';
        }
        setButtonState(appId, ST.btn, svgDownload() + '<span>TRY AGAIN</span>', false);
        setButtonLumaState(appId, 'ready');
        setTimeout(function () {
          setButtonState(appId, ST.btn, svgDownload() + '<span>ADD VIA LUMAFORGE</span>', false);
        }, 3000);
      });
  } catch (e) { console.error('[CEF_INJECT_ERROR] handleSourceClick:', e); }
}

// ---------------------------------------------------------------------------
// Download progress: show progress state in modal
// ---------------------------------------------------------------------------
export function showDownloadProgress(appId: string, requestId: string): void {
  try {
    var body = getModalBody();
    if (!body) return;

    body.innerHTML =
      '<div style="' + ST.progressWrap + '">' +
      '<div style="margin-bottom:14px;">' + svgSpinner() + '</div>' +
      '<div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:6px;">Downloading\u2026</div>' +
      '<div style="' + ST.progressLabel + '"><span style="font-family:monospace;font-size:10px;opacity:.7;" title="' + (requestId || '') + '">' + (requestId || '').slice(0, 16) + '\u2026</span></div>' +
      '<div style="' + ST.progressBar + '"><div id="luma-progress-fill" style="' + ST.progressFill + '"></div></div>' +
      '<div id="luma-progress-status" style="font-size:12px;color:#66c0ff;">Queued</div>' +
      '</div>';
    try { logModalHorizontalOverflow(); } catch (_) { }
  } catch (_) { }
}

export function updateProgressUI(job: any): void {
  try {
    var fill = document.getElementById('luma-progress-fill') as HTMLElement | null;
    var status = document.getElementById('luma-progress-status') as HTMLElement | null;
    if (fill) {
      var pct = job.progress;
      if (!pct && pct !== 0) {
        if (job.status === 'completed') pct = 100;
        else if (job.status === 'processing') pct = 90;
        else if (job.status === 'extracting') pct = 75;
        else if (job.status === 'downloading') pct = 50;
        else if (job.status === 'checking_availability') pct = 20;
        else if (job.status === 'validating') pct = 5;
        else if (job.status === 'queued') pct = 0;
        else pct = 10;
      }
      fill.style.width = pct + '%';
    }
    if (status) {
      var msg = job.message || job.status || 'Working\u2026';
      status.textContent = msg;
    }
  } catch (_) { }
}

// ---------------------------------------------------------------------------
// Download poll: poll GET /api/download-status/{requestId}
// ---------------------------------------------------------------------------
export function startDownloadPoll(requestId: string, appId: string): void {
  stopDownloadPoll();
  state.downloadPollSeq++;
  var seq = state.downloadPollSeq;

  function poll() {
    if (!state.requestContext || state.requestContext.requestId !== requestId) return;
    if (!state.activated || state.currentAppId !== appId) return;

    console.log('[LUMA_INJECT] Polling download status for requestId:', requestId);

    fetch(downloadStatusUrl(requestId), {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        if (state.downloadPollSeq !== seq) return;
        if (!d || !d.ok) throw new Error((d && d.message) || 'Invalid response');

        console.log('[LUMA_INJECT] Download status:', d.status, 'for requestId:', requestId);
        updateProgressUI(d);

        // Update activeDownloads entry with progress
        for (var i = 0; i < state.activeDownloads.length; i++) {
          if (state.activeDownloads[i].requestId === requestId) {
            state.activeDownloads[i].phase = d.message || d.status || '';
            state.activeDownloads[i].progress = d.progress || 0;
            state.activeDownloads[i].speed = d.speed || 0;
            state.activeDownloads[i].bytesDownloaded = d.bytesDownloaded || 0;
            state.activeDownloads[i].totalBytes = d.totalBytes || 0;
            break;
          }
        }

        if (d.status === 'completed') {
          state.requestContext = null;
          state.activeDownloads = state.activeDownloads.filter(function(j) { return j.requestId !== requestId; });
          showDownloadSuccess(appId, requestId);
          return;
        }
        if (d.status === 'failed') {
          state.requestContext = null;
          state.activeDownloads = state.activeDownloads.filter(function(j) { return j.requestId !== requestId; });
          showDownloadError(appId, d.message || 'Download failed', d.errorCode);
          return;
        }

        state.downloadPollTimer = setTimeout(poll, 1500);
      })
      .catch(function (err) {
        if (state.downloadPollSeq !== seq) return;
        console.error('[LUMA_INJECT] Poll error:', err.message || err);
        state.downloadPollTimer = setTimeout(poll, 2500);
      });
  }

  state.downloadPollTimer = setTimeout(poll, 800);
}

export function stopDownloadPoll(): void {
  state.downloadPollSeq++;
  if (state.downloadPollTimer) {
    clearTimeout(state.downloadPollTimer);
    state.downloadPollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Download success: show success state in modal
// ---------------------------------------------------------------------------
export function showDownloadSuccess(appId: string, requestId: string): void {
  try {
    var body = getModalBody();
    if (!body) return;

    setButtonState(appId, ST.btnSuccess, svgCheck() + '<span>ADDED TO LUMAFORGE</span>', false);
    setButtonLumaState(appId, 'added');

    var depotBtn = IS_LINUX
      ? '<button type="button" id="luma-btn-depot-download" style="' + ST.primaryBtn + '">' + svgBox() + '<span>DOWNLOAD CONTENT</span></button>'
      : '';
    var libraryBtnStyle = IS_LINUX ? ST.secondaryBtn : ST.primaryBtn;

    body.innerHTML =
      '<div style="' + ST.successWrap + '">' +
      '<div style="' + ST.successIcon + '">' + svgCheck(26, 26) + '</div>' +
      '<div style="' + ST.successTitle + '">Package Added Successfully</div>' +
      '<div style="' + ST.successDetail + '">The package has been downloaded and installed to your Steam library.</div>' +
      '<div style="' + ST.successActions + '" class="luma-ssh-success-actions">' +
      depotBtn +
      '<button type="button" id="luma-btn-open-library" style="' + libraryBtnStyle + '">' + svgLibrary() + '<span>VIEW IN LIBRARY</span></button>' +
      '<button type="button" id="luma-btn-continue" style="' + ST.secondaryBtn + '">CONTINUE BROWSING</button>' +
      '</div>' +
      '</div>';

    var depotDlBtn = document.getElementById('luma-btn-depot-download');
    if (depotDlBtn) {
      depotDlBtn.addEventListener('click', function () {
        closeModal();
        openDepotModal(appId);
      });
    }

    var openLibBtn = document.getElementById('luma-btn-open-library');
    if (openLibBtn) {
      openLibBtn.addEventListener('click', function () {
        fetch(openLibraryUrl(appId), { method: 'POST', mode: 'cors', cache: 'no-store' })
          .catch(function () { });
        closeModal();
      });
    }

    var continueBtn = document.getElementById('luma-btn-continue');
    if (continueBtn) {
      continueBtn.addEventListener('click', function () {
        closeModal();
      });
    }
    try { logModalHorizontalOverflow(); } catch (_) { }
  } catch (_) { }
}

// ---------------------------------------------------------------------------
// Download error: show error state in modal
// ---------------------------------------------------------------------------
export function showDownloadError(appId: string, message: string, errorCode?: string): void {
  try {
    var body = getModalBody();
    if (!body) return;

    setButtonState(appId, ST.btn, svgDownload() + '<span>TRY AGAIN</span>', false);
    setButtonLumaState(appId, 'ready');
    setTimeout(function () {
      setButtonState(appId, ST.btn, svgDownload() + '<span>ADD VIA LUMAFORGE</span>', false);
    }, 4000);

    var detail = errorCode ? (errorCode + ': ' + message) : message;
    body.innerHTML =
      '<div style="' + ST.errorWrap + '">' +
      '<div style="' + ST.errorIcon + '">' + svgErrorCircle() + '</div>' +
      '<div style="' + ST.errorTitle + '">Download Failed</div>' +
      '<div style="' + ST.errorMsgNew + '">' + detail + '</div>' +
      '<div style="' + ST.errorActions + '" class="luma-ssh-error-actions">' +
      '<button type="button" id="luma-btn-retry-download" style="' + ST.primaryBtn + '">' + svgDownload() + '<span>TRY AGAIN</span></button>' +
      '<button type="button" id="luma-btn-close-error" style="' + ST.secondaryBtn + '">CLOSE</button>' +
      '</div>' +
      '</div>';

    var retryBtn = document.getElementById('luma-btn-retry-download');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        openSourceModal(appId);
      });
    }

    var closeBtn = document.getElementById('luma-btn-close-error');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeModal();
      });
    }
    try { logModalHorizontalOverflow(); } catch (_) { }
  } catch (_) { }
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
