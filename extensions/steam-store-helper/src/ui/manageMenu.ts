import { luaFilesUrl, luaFileDeleteUrl, steamKeysPinsUrl, steamKeysPinUrl, steamKeysUnpinUrl } from './helpers';
import { openFixesModal } from '../modals/fixes';

// ---------------------------------------------------------------------------
// Library "Manage" submenu injection.
//
// The Manage submenu renders on hover (not in the DOM until then), so we
// watch #popup_target and inject our items when the submenu appears. The
// appid comes from the React fiber chain of the right-clicked element (the
// library URL never changes between games).
//
// Items: Game Fixes (always), Pin/Unpin manifest + Delete Lua (only for
// games that actually have a Lua file — same gating as the dashboard).
// ---------------------------------------------------------------------------

interface MenuData {
  appId: string;
  hasLua: boolean;
  hasPins: boolean;
  ready: boolean;
}

var bound = false;
var ctxAppId: string | null = null;
var lastHoverAppId: string | null = null;
var dataSeq = 0;
var menuData: MenuData | null = null;
var obsTarget: Element | null = null;
var popupObs: MutationObserver | null = null;
var obsTimer: ReturnType<typeof setInterval> | null = null;

export function startManageMenu(): void {
  if (bound) return;
  bound = true;
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClickCapture, true);
  ensurePopupObs();
  obsTimer = setInterval(ensurePopupObs, 2000);
}

export function stopManageMenu(): void {
  if (!bound) return;
  bound = false;
  document.removeEventListener('contextmenu', onContextMenu, true);
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('click', onClickCapture, true);
  if (obsTimer) { clearInterval(obsTimer); obsTimer = null; }
  if (popupObs) { popupObs.disconnect(); popupObs = null; }
  obsTarget = null;
  ctxAppId = null;
  lastHoverAppId = null;
  menuData = null;
}

// ---------------------------------------------------------------------------
// AppID discovery (React fiber walk)
// ---------------------------------------------------------------------------
function appIdFromNode(node: any): string | null {
  try {
    var el: any = node;
    if (el && el.nodeType === 3) el = el.parentElement;
    var fiber: any = null;
    var guard = 0;
    while (el && guard++ < 12) {
      var keys = Object.keys(el);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].indexOf('__reactFiber$') === 0 || keys[k].indexOf('__reactInternalInstance$') === 0) {
          fiber = el[keys[k]];
          break;
        }
      }
      if (fiber) break;
      el = el.parentElement;
    }
    if (!fiber) return null;
    var depth = 0;
    while (fiber && depth++ < 40) {
      var props = fiber.memoizedProps;
      if (props) {
        var cand = props.appid != null ? props.appid
          : (props.appId != null ? props.appId
          : (props.nAppID != null ? props.nAppID : null));
        if (cand != null && /^\d+$/.test(String(cand)) && String(cand).length <= 12 && String(cand) !== '0') {
          return String(cand);
        }
      }
      fiber = fiber.return;
    }
  } catch (_) { }
  return null;
}

function setContextApp(id: string | null): void {
  ctxAppId = id;
  if (id) prefetchMenuData(id);
  else menuData = null;
}

function onContextMenu(e: MouseEvent): void {
  try {
    var id = appIdFromNode(e.target);
    if (!id) {
      var under = document.elementFromPoint(e.clientX, e.clientY);
      if (under && under !== e.target) id = appIdFromNode(under);
    }
    if (!id) id = lastHoverAppId;
    setContextApp(id);
  } catch (_) { }
}

function onMouseOver(e: MouseEvent): void {
  try {
    var t: any = e.target;
    if (!t || t.nodeType !== 1) return;
    var id = appIdFromNode(t);
    if (id) lastHoverAppId = id;
  } catch (_) { }
}

function onClickCapture(e: MouseEvent): void {
  try {
    var t: any = e.target;
    if (!t || !t.closest) return;
    if (!t.closest('[aria-label="Manage"]')) return;
    var id = appIdFromNode(t) || lastHoverAppId;
    setContextApp(id);
  } catch (_) { }
}

// ---------------------------------------------------------------------------
// Menu data (lua file existence + pin state)
// ---------------------------------------------------------------------------
function prefetchMenuData(appId: string): void {
  if (menuData && menuData.appId === appId && menuData.ready) return;
  var seq = ++dataSeq;
  menuData = { appId: appId, hasLua: false, hasPins: false, ready: false };

  fetch(luaFilesUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d: any) {
      if (seq !== dataSeq) return;
      var files = (d && d.ok && d.files) ? d.files : [];
      var hasLua = false;
      for (var i = 0; i < files.length; i++) {
        if (String(files[i] && files[i].appId) === String(appId)) { hasLua = true; break; }
      }
      if (!hasLua) {
        menuData = { appId: appId, hasLua: false, hasPins: false, ready: true };
        scanMenus();
        return;
      }
      fetch(steamKeysPinsUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function (r2) { return r2.ok ? r2.json() : null; })
        .then(function (pd: any) {
          if (seq !== dataSeq) return;
          var pins = (pd && pd.ok && pd.pins) ? pd.pins : {};
          var pin = pins[appId] || null;
          menuData = { appId: appId, hasLua: true, hasPins: !!(pin && pin.hasPins), ready: true };
          scanMenus();
        })
        .catch(function () {
          if (seq !== dataSeq) return;
          menuData = { appId: appId, hasLua: true, hasPins: false, ready: true };
          scanMenus();
        });
    })
    .catch(function () {
      if (seq !== dataSeq) return;
      menuData = { appId: appId, hasLua: false, hasPins: false, ready: true };
      scanMenus();
    });
}

// ---------------------------------------------------------------------------
// Popup observer
// ---------------------------------------------------------------------------
function ensurePopupObs(): void {
  if (!bound) return;
  try {
    var pt = document.getElementById('popup_target');
    if (!pt) return;
    if (obsTarget === pt && popupObs) return;
    if (popupObs) popupObs.disconnect();
    obsTarget = pt;
    popupObs = new MutationObserver(function () { scanMenus(); });
    popupObs.observe(pt, { childList: true, subtree: true });
  } catch (_) { }
}

function scanMenus(): void {
  try {
    var d = menuData;
    if (!d || !d.ready || !ctxAppId || d.appId !== ctxAppId) return;
    var pt = document.getElementById('popup_target');
    if (!pt) return;
    var menus = pt.querySelectorAll('.contextMenu.visible');
    for (var i = 0; i < menus.length; i++) {
      if (isManageMenu(menus[i])) ensureItems(menus[i]);
    }
  } catch (_) { }
}

function isManageMenu(menu: Element): boolean {
  var t = menu.textContent || '';
  return t.indexOf('Browse local files') !== -1 && t.indexOf('Uninstall') !== -1;
}

// ---------------------------------------------------------------------------
// Item injection
// ---------------------------------------------------------------------------
function ensureItems(menu: Element): void {
  var d = menuData;
  if (!d || !d.ready || !ctxAppId || d.appId !== ctxAppId) return;
  var contents = menu.querySelector('.contextMenuContents') as HTMLElement | null;
  if (!contents) return;

  var existing = contents.querySelector('[data-luma-manage]');
  if (!existing) {
    var proto = contents.querySelector('.contextMenuItem:not(.SubMenu)') as HTMLElement | null;
    if (!proto) proto = contents.querySelector('.contextMenuItem') as HTMLElement | null;
    var protoClass = proto ? proto.className : 'contextMenuItem';
    var protoLabelClass = (proto && proto.firstElementChild && proto.firstElementChild.children.length === 0)
      ? (proto.firstElementChild as HTMLElement).className : '';

    // Insert before the last separator so Uninstall stays the final entry.
    var anchor: Element | null = null;
    var seps = contents.querySelectorAll('.ContextMenuSeparator');
    for (var i = seps.length - 1; i >= 0; i--) {
      if (seps[i].parentElement === contents) { anchor = seps[i]; break; }
    }

    var frag = document.createDocumentFragment();
    frag.appendChild(makeItem(proto, protoClass, protoLabelClass, 'Game Fixes', 'fixes'));
    if (d.hasLua) {
      frag.appendChild(makeItem(proto, protoClass, protoLabelClass,
        d.hasPins ? 'Unpin manifest' : 'Pin manifest', 'pin'));
      frag.appendChild(makeItem(proto, protoClass, protoLabelClass, 'Delete Lua…', 'delete'));
    }
    if (anchor) contents.insertBefore(frag, anchor);
    else contents.appendChild(frag);
  } else {
    updateLabels(menu, d);
  }
}

function makeItem(
  proto: HTMLElement | null,
  protoClass: string,
  protoLabelClass: string,
  label: string,
  action: string
): HTMLElement {
  var item: HTMLElement;
  if (proto) {
    item = proto.cloneNode(false) as HTMLElement;
    while (item.firstChild) item.removeChild(item.firstChild);
  } else {
    item = document.createElement('div');
    item.className = protoClass;
  }
  item.removeAttribute('id');
  item.removeAttribute('aria-haspopup');
  item.removeAttribute('aria-expanded');
  item.removeAttribute('aria-checked');
  item.setAttribute('role', 'menuitem');
  item.setAttribute('tabindex', '-1');
  item.setAttribute('data-luma-manage', action);
  item.style.cursor = 'pointer';
  if (protoLabelClass) {
    var lbl = document.createElement('div');
    lbl.className = protoLabelClass;
    lbl.textContent = label;
    item.appendChild(lbl);
  } else {
    item.textContent = label;
  }
  item.addEventListener('click', function (ev) {
    ev.stopPropagation();
    handleAction(action, item);
  });
  return item;
}

function updateLabels(menu: Element, d: MenuData): void {
  var contents = menu.querySelector('.contextMenuContents');
  if (!contents) return;
  var pinItem = contents.querySelector('[data-luma-manage="pin"]') as HTMLElement | null;
  var delItem = contents.querySelector('[data-luma-manage="delete"]') as HTMLElement | null;
  if (!d.hasLua) {
    if (pinItem) pinItem.remove();
    if (delItem) delItem.remove();
    return;
  }
  if (pinItem) setItemLabel(pinItem, d.hasPins ? 'Unpin manifest' : 'Pin manifest');
}

function setItemLabel(item: HTMLElement, label: string): void {
  if (item.children.length === 1 && item.firstElementChild) {
    item.firstElementChild.textContent = label;
  } else {
    item.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function closeMenu(menu: Element | null): void {
  if (!menu) return;
  try {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true } as any));
  } catch (_) { }
}

function handleAction(action: string, item: HTMLElement): void {
  var appId = ctxAppId;
  if (!appId) return;
  var menu = item.closest('.contextMenu') as Element | null;

  if (action === 'fixes') {
    closeMenu(menu);
    openFixesModal(appId);
    return;
  }

  if (action === 'pin') {
    var pinned = !!(menuData && menuData.hasPins);
    closeMenu(menu);
    var url = pinned ? steamKeysUnpinUrl() : steamKeysPinUrl();
    var payload = pinned ? { appId: appId } : { appId: appId, mode: 'latest' };
    fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) console.warn('[LUMA_INJECT] Menu pin op failed:', res && res.message);
        menuData = null;
      })
      .catch(function () { menuData = null; });
    return;
  }

  if (action === 'delete') {
    // Two-step inline confirm (dashboard parity): first click arms, second
    // click (within 3s) deletes.
    if (item.getAttribute('data-confirm') !== '1') {
      item.setAttribute('data-confirm', '1');
      setItemLabel(item, 'Confirm delete?');
      setTimeout(function () {
        if (item.getAttribute('data-confirm') === '1') {
          item.removeAttribute('data-confirm');
          setItemLabel(item, 'Delete Lua…');
        }
      }, 3000);
      return;
    }
    closeMenu(menu);
    fetch(luaFileDeleteUrl(appId), { method: 'DELETE', mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) menuData = null;
      })
      .catch(function () { });
    return;
  }
}
