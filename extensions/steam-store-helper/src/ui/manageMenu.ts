import { luaFilesUrl, luaFileDeleteUrl, steamKeysPinsUrl, steamKeysPinUrl, steamKeysUnpinUrl, jsLog } from './helpers';
import { openFixesModal } from '../modals/fixes';
import { t } from '../i18n';

// ---------------------------------------------------------------------------
// Library "Manage" submenu injection.
//
// The Manage submenu renders on hover (not in the DOM until then), so we
// watch #popup_target and inject our items when the submenu appears. The
// appid comes from the React fiber chain of the right-clicked element (the
// library URL never changes between games).
//
// Items: Game Fixes (always), Delete Lua (only for games with a Lua file —
// same gating as the dashboard), plus flat pin actions: Unpin alone when
// already pinned, otherwise Pin to Current (installed only — the server
// needs the ACF) + Pin to Latest. Identification of the submenu falls back
// to the "Manage" hover when the game is not installed and Steam renders
// neither "Browse local files" nor "Uninstall".
// ---------------------------------------------------------------------------

interface MenuData {
  appId: string;
  hasLua: boolean;
  hasPins: boolean;
  installed: boolean;
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
// Set when the pointer is over the "Manage" submenu item; the submenu that
// opens right after is the one we want (works even when the game is not
// installed and Steam renders neither "Browse local files" nor "Uninstall").
var manageHoverAt = 0;
// Last pointer interaction (any hover/click/right-click in a bound doc).
// The class-agnostic heavy paths (whole-doc row search) only run within a
// few seconds of activity so idle MutationObserver churn stays cheap.
var interactAt = 0;
// Last scanMenus() skip reason — logged only when it changes (scan runs on
// every popup mutation, logging every call would flood the console).
var _lastScanSkip = '';

// Steam's own menu labels, in every language we ship detection for (english,
// spanish, latam). Exact matches for rows/labels, substring matches for menu
// text. All detection previously hard-coded the English literals, so on a
// Spanish Steam every path silently missed ("Ver archivos locales" never
// matched "Browse local files").
var STR_MANAGE = ['Manage', 'Administrar'];
var STR_BROWSE = ['Browse local files', 'Ver archivos locales', 'Explorar archivos locales'];
var STR_UNINSTALL = ['Uninstall', 'Desinstalar'];

function matchTxt(v: string | null | undefined, set: string[]): boolean {
  var s = (v || '').trim();
  for (var i = 0; i < set.length; i++) if (s === set[i]) return true;
  return false;
}

function hasTxt(v: string | null | undefined, set: string[]): boolean {
  var s = v || '';
  for (var i = 0; i < set.length; i++) if (s.indexOf(set[i]) !== -1) return true;
  return false;
}

function isVisibleEl(el: Element): boolean {
  try { return (el as HTMLElement).getClientRects().length > 0; } catch (_) { return false; }
}

// Steam creates context menus as separate `window.open("about:blank?...")`
// popups (CreatePopup in library.js) on some PCs — about:blank popups inherit
// the steamloopback origin, so from this document we can reach into them,
// bind listeners/observers on their document and inject there. The proxy does
// not inject into about:blank targets, so this wrapper is the only way our
// script participates in those menus.
interface PopupEntry {
  win: Window;
  doc: Document | null;
  obs: MutationObserver | null;
  timer: ReturnType<typeof setInterval> | null;
}
var _origOpen: any = null;
var popups: PopupEntry[] = [];

// Steam keeps the registry of every popup window in `g_PopupManager`
// (library.js assigns window.g_PopupManager). Menus are created through it
// and CreatePopup REUSES an existing popup by name — window.open is never
// called again, which is why the open-wrapper alone never fires on the PC
// where menus render in a separate window. The manager lives in the realm
// that owns the popups; our document is itself a popup (opener=Y), so probe
// self, opener and opener-of-opener for it.
var _hookedMgrs: any[] = [];
var _mgrUnregs: Array<() => void> = [];

function popupManagers(): any[] {
  var out: any[] = [];
  var roots: any[] = [];
  try { roots.push(window); } catch (_) { }
  try { if (window.opener) roots.push(window.opener); } catch (_) { }
  try { if (window.opener && (window.opener as any).opener) roots.push((window.opener as any).opener); } catch (_) { }
  for (var i = 0; i < roots.length; i++) {
    try {
      var m = roots[i].g_PopupManager;
      if (m && typeof m.GetPopups === 'function' && out.indexOf(m) === -1) out.push(m);
    } catch (_) { }
  }
  return out;
}

function popupWindowOf(p: any): Window | null {
  try {
    return (p && (p.window || (p.m_popup && p.m_popup.window))) || null;
  } catch (_) { return null; }
}

// Register a created-callback once per manager + sweep the existing list.
function hookManagers(): void {
  var ms = popupManagers();
  for (var i = 0; i < ms.length; i++) {
    var m = ms[i];
    if (_hookedMgrs.indexOf(m) !== -1) continue;
    _hookedMgrs.push(m);
    try {
      if (typeof m.AddPopupCreatedCallback === 'function') {
        var r = m.AddPopupCreatedCallback(function (p: any) {
          try { trackPopupWin(popupWindowOf(p), 'mgr-cb'); } catch (_) { }
        });
        if (r && typeof r.Unregister === 'function') {
          _mgrUnregs.push(function (u: any) { return function () { try { u(); } catch (_) { } }; }(r.Unregister));
        }
      }
      console.log('[LUMA_INJECT] g_PopupManager hooked (' + _hookedMgrs.length + ' realm(s))');
    } catch (_) { }
    sweepManager(m);
  }
}

function sweepManager(m: any): void {
  try {
    var it = m.GetPopups();
    var s;
    while (!(s = it.next()).done) trackPopupWin(popupWindowOf(s.value), 'mgr-sweep');
  } catch (_) { }
}

function sweepManagers(): void {
  var ms = popupManagers();
  for (var i = 0; i < ms.length; i++) sweepManager(ms[i]);
}

export function startManageMenu(): void {
  if (bound) return;
  bound = true;
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClickCapture, true);
  wrapWindowOpen();
  hookManagers();
  ensurePopupObs();
  obsTimer = setInterval(tick, 1000);
  console.log('[LUMA_INJECT] Manage menu bound (url=' + location.href +
    ' opener=' + (window.opener ? 'Y' : 'N') +
    ' gMgr(self/opener)=' + (hasMgr(window) ? 'Y' : 'N') + '/' +
    (window.opener && hasMgr(window.opener) ? 'Y' : 'N') + ')');
}

function hasMgr(w: any): boolean {
  try { return !!(w && w.g_PopupManager && typeof w.g_PopupManager.GetPopups === 'function'); }
  catch (_) { return false; }
}

function tick(): void {
  ensurePopupObs();
  hookManagers();
  sweepManagers();
}

export function stopManageMenu(): void {
  if (!bound) return;
  bound = false;
  document.removeEventListener('contextmenu', onContextMenu, true);
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('click', onClickCapture, true);
  unwrapWindowOpen();
  for (var i = 0; i < _mgrUnregs.length; i++) { try { _mgrUnregs[i](); } catch (_) { } }
  _mgrUnregs.length = 0;
  _hookedMgrs.length = 0;
  if (obsTimer) { clearInterval(obsTimer); obsTimer = null; }
  if (popupObs) { popupObs.disconnect(); popupObs = null; }
  obsTarget = null;
  ctxAppId = null;
  lastHoverAppId = null;
  menuData = null;
}

// ---------------------------------------------------------------------------
// window.open wrapper — track Steam popups (context menus render there on
// some PCs) and mirror our listeners + a mutation observer into each popup
// document we can reach (about:blank inherits our origin).
// ---------------------------------------------------------------------------
function wrapWindowOpen(): void {
  if (_origOpen) return;
  try {
    _origOpen = window.open;
    var orig = _origOpen;
    (window as any).open = function (this: any) {
      var w: Window | null = null;
      try { w = orig.apply(this, arguments as any); } catch (e) { throw e; }
      try { trackPopup(w, arguments[0]); } catch (_) { }
      return w;
    };
  } catch (_) { }
}

function unwrapWindowOpen(): void {
  if (!_origOpen) return;
  try { (window as any).open = _origOpen; } catch (_) { }
  _origOpen = null;
  for (var i = popups.length - 1; i >= 0; i--) cleanupPopup(popups[i]);
  popups.length = 0;
}

function trackPopup(w: Window | null, url: any): void {
  if (!w) return;
  var u = String(url === undefined || url === null ? '' : url);
  trackPopupWin(w, 'open url=' + u.slice(0, 140));
}

function trackPopupWin(w: Window | null, src: string): void {
  if (!w || w === window) return;
  for (var i = 0; i < popups.length; i++) if (popups[i].win === w) return;
  try { if (w.closed) return; } catch (_) { return; }
  console.log('[LUMA_INJECT] popup tracked (' + src + ') name=' +
    (function () { try { return w.name || '-'; } catch (_) { return '?'; } })());
  var entry: PopupEntry = { win: w, doc: null, obs: null, timer: null };
  popups.push(entry);
  pollPopup(entry);
  entry.timer = setInterval(function () { pollPopup(entry); }, 500);
}

function cleanupPopup(entry: PopupEntry): void {
  try {
    if (entry.timer) clearInterval(entry.timer);
    if (entry.obs) entry.obs.disconnect();
  } catch (_) { }
  entry.timer = null;
  entry.obs = null;
  var idx = popups.indexOf(entry);
  if (idx !== -1) popups.splice(idx, 1);
}

function pollPopup(entry: PopupEntry): void {
  try {
    if (entry.win.closed) { cleanupPopup(entry); return; }
    var d: Document | null = null;
    try { d = entry.win.document; } catch (_) { return; } // unreachable → not ours
    if (!d) return;
    if (d !== entry.doc) {
      // New/replaced document (document.write on reuse): rebind.
      if (entry.obs) { entry.obs.disconnect(); entry.obs = null; }
      entry.doc = d;
      d.addEventListener('contextmenu', onContextMenu, true);
      d.addEventListener('mouseover', onMouseOver, true);
      d.addEventListener('click', onClickCapture, true);
      console.log('[LUMA_INJECT] popup doc bound (popupTarget=' +
        (d.getElementById('popup_target') ? 'Y' : 'N') + ' title=' +
        JSON.stringify(d.title) + ')');
    }
    if (!entry.obs && d.getElementById('popup_target')) {
      var root = d.body || d.getElementById('popup_target');
      entry.obs = new MutationObserver(function () { scanMenus(d); });
      entry.obs.observe(root, { childList: true, subtree: true });
      scanMenus(d);
    }
  } catch (_) { }
}

// Scan this document plus every reachable popup document.
function scanAll(): void {
  scanMenus(document);
  for (var i = 0; i < popups.length; i++) {
    if (popups[i].doc) scanMenus(popups[i].doc as Document);
  }
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
    manageHoverAt = 0;
    interactAt = Date.now();
    // The event may fire in a popup document (bound via trackPopup).
    var doc = ((e.target as any) && (e.target as any).ownerDocument) || document;
    var id = appIdFromNode(e.target);
    if (!id && doc.elementFromPoint) {
      var under = doc.elementFromPoint(e.clientX, e.clientY);
      if (under && under !== e.target) id = appIdFromNode(under);
    }
    if (!id) id = lastHoverAppId;
    setContextApp(id);
    // Diagnostic: are the menus even in THIS document? If visible=0 here but
    // the user sees a context menu, Steam opened it in a separate popup
    // window and we must bind there instead.
    console.log('[LUMA_INJECT] Manage menu contextmenu appid=' + (id || 'null') +
      ' ' + menuDump(doc) + ' docTitle=' + JSON.stringify(doc.title));
  } catch (_) { }
}

function onMouseOver(e: MouseEvent): void {
  try {
    var t: any = e.target;
    if (!t || t.nodeType !== 1) return;
    interactAt = Date.now();
    var id = appIdFromNode(t);
    if (id) lastHoverAppId = id;
    // Remember when the pointer sits on the "Manage" entry: the submenu that
    // opens right after is the one we inject into. Class-agnostic: hashed
    // class names differ between PCs, so also match role=menuitem /
    // aria-haspopup and raw text.
    var item = t.closest ? (t.closest('.contextMenuItem') ||
      t.closest('[role="menuitem"]') || t.closest('[aria-haspopup]')) : null;
    if (item && matchTxt(item.textContent, STR_MANAGE)) manageHoverAt = Date.now();
    else if (!item && matchTxt(t.textContent, STR_MANAGE)) manageHoverAt = Date.now();
  } catch (_) { }
}

function onClickCapture(e: MouseEvent): void {
  try {
    var t: any = e.target;
    if (!t || !t.closest) return;
    var manage = t.closest ? t.closest('[aria-label]') : null;
    if (manage && !matchTxt(manage.getAttribute('aria-label'), STR_MANAGE)) manage = null;
    // Class-agnostic trigger: a menuitem whose text is exactly the localized
    // "Manage" (the popup menu, not the details-page button which carries
    // aria-label).
    var mi = t.closest('[role="menuitem"]') || t.closest('.contextMenuItem');
    if (!manage && mi && matchTxt(mi.textContent, STR_MANAGE)) manage = mi;
    if (!manage) return;
    interactAt = Date.now();
    var id = appIdFromNode(t) || lastHoverAppId;
    setContextApp(id);
    // Diagnostic: this is the trigger that actually fires (the contextmenu
    // log never appears — Steam swallows that event before our capture
    // listener). Sweep the popup manager first so the dump reflects the
    // popups that exist right now, then dump every reachable document.
    sweepManagers();
    var mgrPopups = -1;
    var mgrs = popupManagers();
    if (mgrs.length) {
      try {
        var n = 0; var it = mgrs[0].GetPopups(); var s;
        while (!(s = it.next()).done) n++;
        mgrPopups = n;
      } catch (_) { }
    }
    var out = 'click-on-Manage appid=' + (id || 'null') +
      ' opener=' + (window.opener ? 'Y' : 'N') +
      ' gMgr=' + (hasMgr(window) ? 'Y' : 'N') + '/' +
      (window.opener && hasMgr(window.opener) ? 'Y' : 'N') +
      ' mgrPopups=' + mgrPopups + ' tracked=' + popups.length +
      ' main{' + menuDump(document) + '}';
    for (var p = 0; p < popups.length; p++) {
      var pd = popups[p].doc;
      out += ' popup#' + p + (pd ? '{' + menuDump(pd) + '}' : '{unreachable}');
    }
    console.log('[LUMA_INJECT] Manage menu ' + out);
  } catch (_) { }
}

// Where are the .contextMenu elements right now? One line: counts in
// #popup_target vs whole document + identity of the first one found.
function menuDump(doc: Document): string {
  try {
    var pt = doc.getElementById('popup_target');
    var inPt = pt ? pt.querySelectorAll('.contextMenu').length : -1;
    var visInPt = pt ? pt.querySelectorAll('.contextMenu.visible').length : -1;
    var inDoc = doc.querySelectorAll('.contextMenu').length;
    var visDoc = doc.querySelectorAll('.contextMenu.visible').length;
    var first = doc.querySelector('.contextMenu');
    var where = 'none';
    if (first) {
      var p = first.parentElement;
      where = (first.getAttribute('class') || '').slice(0, 60) +
        ' in <' + (p ? (p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') +
          ' id=' + (p.id ? 'Y' : 'N') +
          ' parent=' + (p.parentElement ? p.parentElement.tagName.toLowerCase() +
            (p.parentElement.id ? '#' + p.parentElement.id : '') : 'none')) : 'none') + '>';
    }
    // Class-agnostic census too: role=menu / menuitem counts catch menus
    // whose class names we cannot predict on the other PC.
    var roleMenus = doc.querySelectorAll('[role="menu"]').length;
    var roleItems = doc.querySelectorAll('[role="menuitem"]').length;
    return 'popupTarget=' + (pt ? 'Y' : 'N') +
      ' ptChildren=' + (pt ? pt.childElementCount : -1) +
      ' inPopupTarget=' + inPt + '/' + visInPt +
      ' inDocument=' + inDoc + '/' + visDoc +
      ' roleMenu=' + roleMenus + ' roleMenuItem=' + roleItems +
      ' first=' + where;
  } catch (_) { }
  return 'menuDump unavailable';
}

// ---------------------------------------------------------------------------
// Menu data (lua file existence + pin state)
// ---------------------------------------------------------------------------
function prefetchMenuData(appId: string): void {
  // Always refetch: the dashboard (sidebar) mutates lua/pin state through its
  // own requests and this cache never saw those changes — a stale menuData
  // meant "Delete Lua" missing after a re-download (and vice versa) until
  // Steam restarted. dataSeq still guards out-of-order responses.
  var seq = ++dataSeq;
  menuData = { appId: appId, hasLua: false, hasPins: false, installed: false, ready: false };
  console.log('[LUMA_INJECT] Manage menu prefetch appid=' + appId);

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
        menuData = { appId: appId, hasLua: false, hasPins: false, installed: false, ready: true };
        console.log('[LUMA_INJECT] Manage menu data ready appid=' + appId + ' lua=false');
        jsLog('MENU data app=' + appId + ' lua=false');
        scanAll();
        return;
      }
      fetch(steamKeysPinsUrl(), { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function (r2) { return r2.ok ? r2.json() : null; })
        .then(function (pd: any) {
          if (seq !== dataSeq) return;
          var pins = (pd && pd.ok && pd.pins) ? pd.pins : {};
          var pin = pins[appId] || null;
          menuData = {
            appId: appId, hasLua: true,
            hasPins: !!(pin && pin.hasPins),
            installed: !!(pin && pin.installed),
            ready: true
          };
          console.log('[LUMA_INJECT] Manage menu data ready appid=' + appId +
            ' lua=true pins=' + menuData.hasPins + ' installed=' + menuData.installed);
          jsLog('MENU data app=' + appId + ' lua=true pins=' + menuData.hasPins +
            ' installed=' + menuData.installed);
          scanAll();
        })
        .catch(function () {
          if (seq !== dataSeq) return;
          menuData = { appId: appId, hasLua: true, hasPins: false, installed: false, ready: true };
          console.log('[LUMA_INJECT] Manage menu data ready appid=' + appId + ' lua=true pins=false (pins fetch failed)');
          scanAll();
        });
    })
    .catch(function () {
      if (seq !== dataSeq) return;
      menuData = { appId: appId, hasLua: false, hasPins: false, installed: false, ready: true };
      console.log('[LUMA_INJECT] Manage menu data ready appid=' + appId + ' lua=false (lua fetch failed)');
      jsLog('MENU data app=' + appId + ' lua=false (LUA FETCH FAILED)');
      scanAll();
    });
}

// ---------------------------------------------------------------------------
// Popup observer
// ---------------------------------------------------------------------------
function ensurePopupObs(): void {
  if (!bound) return;
  try {
    // Observe the whole body: on some PCs the menu is not rendered inside
    // #popup_target (see scanMenus fallback), so watching only that node
    // would never fire a scan.
    var root = document.body || document.getElementById('popup_target');
    if (!root) return;
    if (obsTarget === root && popupObs) return;
    if (popupObs) popupObs.disconnect();
    obsTarget = root;
    popupObs = new MutationObserver(function () { scanAll(); });
    popupObs.observe(root, { childList: true, subtree: true });
  } catch (_) { }
}

function scanSkip(reason: string): void {
  if (reason === _lastScanSkip) return;
  _lastScanSkip = reason;
  console.log('[LUMA_INJECT] Manage menu scan skipped: ' + reason);
}

function scanMenus(doc?: Document): void {
  var d: Document = doc || document;
  try {
    var md = menuData;
    if (!md || !md.ready) { scanSkip('no menuData (ready=' + !!(md && md.ready) + ')'); return; }
    if (!ctxAppId) { scanSkip('no ctxAppId'); return; }
    if (md.appId !== ctxAppId) { scanSkip('menuData appid ' + md.appId + ' != ctxAppId ' + ctxAppId); return; }
    var pt = d.getElementById('popup_target');
    var root: Element | null = pt || d.body;
    if (!root) { scanSkip('no #popup_target and no body in doc(' + d.title + ')'); return; }
    var injected = false;
    var via = '';

    // Fast path: class selectors (known-good on the PC where Steam appends
    // the readable "contextMenu" literal to the hashed class).
    var menus = root.querySelectorAll('.contextMenu.visible');
    for (var i = 0; i < menus.length && !injected; i++) {
      if (isManageMenu(d, menus[i])) { injected = true; via = 'visible-in-root'; ensureItems(d, menus[i], null); }
    }
    if (!injected && !menus.length) {
      var anywhere = d.querySelectorAll('.contextMenu.visible');
      for (var j = 0; j < anywhere.length && !injected; j++) {
        if (isManageMenu(d, anywhere[j])) { injected = true; via = 'visible-in-doc'; ensureItems(d, anywhere[j], null); }
      }
      if (!injected) {
        var allMenus = d.querySelectorAll('.contextMenu');
        for (var k = 0; k < allMenus.length && !injected; k++) {
          var m = allMenus[k];
          if (m.classList.contains('visible')) continue;
          if (isManageMenu(d, m)) { injected = true; via = 'no-visible-class'; ensureItems(d, m, null); }
        }
      }
    }
    if (injected) {
      _lastScanSkip = '';
      console.log('[LUMA_INJECT] Manage menu class path OK (via=' + via + '): ' + menuDump(d));
      return;
    }

    // Heavy class-agnostic paths need recent pointer activity — they walk
    // the whole document (the menu may live in a popup we cannot query by
    // class). Idle observers must not pay that cost.
    if (Date.now() - interactAt > 6000) {
      scanSkip('class paths empty; no recent interaction (doc=' + JSON.stringify(d.title) + ')');
      return;
    }

    // Primary class-agnostic path: exact-text rows. "Browse local files" and
    // "Uninstall" only exist inside the Manage submenu, on any PC, whatever
    // the hashed classes are. The climb stops at the smallest ancestor that
    // holds both entries (the contents container); the row we matched is the
    // proto to clone.
    var rowHit = findRowContents(d);
    if (rowHit) {
      ensureItems(d, rowHit.contents, rowHit.proto);
      _lastScanSkip = '';
      console.log('[LUMA_INJECT] Manage menu row path OK (proto=' +
        JSON.stringify((rowHit.proto.textContent || '').trim().slice(0, 40)) +
        ' contents=' + JSON.stringify((rowHit.contents.getAttribute('class') || rowHit.contents.tagName).slice(0, 60)) +
        ') ' + menuDump(d));
      return;
    }

    // Aria path: the "Manage" trigger row carries aria-controls/aria-haspopup
    // pointing at its submenu — decisive for games that are not installed
    // (no "Browse local files" row exists there).
    if (tryAriaPath(d)) {
      _lastScanSkip = '';
      console.log('[LUMA_INJECT] Manage menu aria path OK: ' + menuDump(d));
      return;
    }

    // role=menu candidates (Steam uses the role on some menu components).
    var roleMenus = d.querySelectorAll('[role="menu"]');
    var roleHit = false;
    for (var r = 0; r < roleMenus.length && !roleHit; r++) {
      if (isManageMenu(d, roleMenus[r])) { roleHit = true; ensureItems(d, roleMenus[r], null); }
    }
    if (roleHit) {
      _lastScanSkip = '';
      console.log('[LUMA_INJECT] Manage menu role=menu path OK: ' + menuDump(d));
      return;
    }

    // Last resort: smallest VISIBLE div whose whole text is just the two
    // submenu entries — never a large panel (the store search FilterBucket
    // panel used to match the old unguarded sweep and ate the injection).
    var best: HTMLElement | null = null;
    var bestLen = 1e9;
    var divs = d.querySelectorAll('div');
    for (var c = 0; c < divs.length; c++) {
      var el = divs[c] as HTMLElement;
      if (el.querySelector('[role="menu"]')) continue;
      var t = el.textContent || '';
      if (t.length >= 400) continue;
      if (!hasTxt(t, STR_BROWSE) || !hasTxt(t, STR_UNINSTALL)) continue;
      if (!isVisibleEl(el)) continue;
      if (t.length < bestLen) { best = el; bestLen = t.length; }
    }
    if (best) {
      ensureItems(d, best, null);
      _lastScanSkip = '';
      console.log('[LUMA_INJECT] Manage menu guarded sweep OK (' + bestLen +
        ' chars): ' + menuDump(d));
      return;
    }

    scanSkip('no Manage menu in doc(' + JSON.stringify(d.title) + '); ' + menuDump(d));
  } catch (e) {
    console.warn('[LUMA_INJECT] Manage menu scan error:', e);
  }
}

// Exact-text row search → { contents, proto }. Installed games always render
// "Browse local files" inside the Manage submenu; the strings are unique in
// the document (they come from #GameAction_BrowseLocalFiles / Uninstall and
// only the submenu shows them together).
function findRowContents(d: Document): { contents: HTMLElement; proto: HTMLElement } | null {
  var cands = d.querySelectorAll('div,li,span,button,[role="menuitem"]');
  var proto: HTMLElement | null = null;
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i] as HTMLElement;
    if (el.children.length > 3) continue;
    var t = (el.textContent || '').trim();
    var isBrowse = matchTxt(t, STR_BROWSE);
    if (!isBrowse && !matchTxt(t, STR_UNINSTALL)) continue;
    if (!isVisibleEl(el)) continue;
    if (isBrowse) { proto = el; break; }
    if (!proto) proto = el;
  }
  if (!proto) return null;
  // Climb to the smallest ancestor holding BOTH entries = the contents box.
  var cur: HTMLElement | null = proto;
  var guard = 0;
  while (cur && guard++ < 6) {
    var p = cur.parentElement as HTMLElement | null;
    if (!p) return null;
    var pt = p.textContent || '';
    if (hasTxt(pt, STR_BROWSE) && hasTxt(pt, STR_UNINSTALL) &&
      p.childElementCount >= 2 && isVisibleEl(p)) {
      return { contents: p, proto: cur };
    }
    cur = p;
  }
  return null;
}

// aria-controls/aria-haspopup on the "Manage" trigger → submenu container.
function tryAriaPath(d: Document): boolean {
  var els = d.querySelectorAll('[aria-haspopup], [aria-controls]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i] as HTMLElement;
    // The trigger must be a menu row: the details-page "Manage" button also
    // carries aria-label + aria-controls and must never be a match source.
    if (!el.hasAttribute('aria-haspopup') &&
      !(el.closest && (el.closest('[role="menuitem"]') || el.closest('.contextMenuItem') ||
        el.closest('[role="menu"]') || el.closest('.contextMenu')))) continue;
    var t = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (!matchTxt(t, STR_MANAGE)) continue;
    var cid = el.getAttribute('aria-controls');
    var target = cid ? d.getElementById(cid) : null;
    if (!target || !isVisibleEl(target)) continue;
    var contents = resolveContents(d, target);
    if (contents) { ensureItems(d, contents, null); return true; }
  }
  return false;
}

function isManageMenu(d: Document, menu: Element): boolean {
  if (!isVisibleEl(menu)) return false;
  var t = menu.textContent || '';
  // Installed games: Steam renders both of these only inside the Manage submenu.
  if (hasTxt(t, STR_BROWSE) && hasTxt(t, STR_UNINSTALL)) return true;
  // Not installed: neither entry exists, so identify the submenu by its
  // aria-labelledby → hidden "Manage" label. Class-agnostic: look for any
  // [aria-labelledby] descendant (hashed classes on the other PC).
  var contents = menu.querySelector('.contextMenuContents') ||
    menu.querySelector('[aria-labelledby]');
  var lb = contents && (contents.getAttribute('aria-labelledby') ||
    (menu.getAttribute && menu.getAttribute('aria-labelledby')));
  if (lb) {
    var lbl = d.getElementById(lb) || menu.ownerDocument.getElementById(lb);
    if (lbl && matchTxt(lbl.textContent, STR_MANAGE)) return true;
  }
  // Hover fallback, structurally gated: right after hovering "Manage" the
  // submenu that opens is accepted only when it is LINKED to the menu that
  // hosts the "Manage" trigger (appended right after it, or inside the same
  // wrapper with no other visible menu in between). The previous version
  // accepted ANY small visible menu within the 2s window, which is how our
  // items leaked into every other menu (supernavs, root menus, notifications).
  if (Date.now() - manageHoverAt > 2000) return false;
  if (t.length >= 400) return false;
  var items = menu.querySelectorAll('.contextMenuItem, [role="menuitem"]');
  if (!items.length) return false;
  for (var i = 0; i < items.length; i++) {
    if (matchTxt(items[i].textContent, STR_MANAGE)) return false; // the parent/root menu itself
  }
  return linkedManageSubmenu(d, menu);
}

// Is `menu` the submenu opened from a visible menu that hosts a "Manage"
// trigger row? Steam appends the hover submenu directly after its parent menu
// (or inside the parent's wrapper) — no other visible menu sits between them.
function linkedManageSubmenu(d: Document, menu: Element): boolean {
  var menus = d.querySelectorAll('.contextMenu, [role="menu"]');
  for (var i = 0; i < menus.length; i++) {
    var m = menus[i];
    if (m === menu) continue;
    if (!isVisibleEl(m)) continue;
    if (!menuHasManageRow(m)) continue;
    if (m.nextElementSibling === menu) return true;
    var nx = m.nextElementSibling;
    if (nx && nx.contains && nx.contains(menu)) return true;
    if (m.parentNode && m.parentNode === menu.parentNode) {
      var pos = m.compareDocumentPosition(menu);
      if ((pos & 4 /* DOCUMENT_POSITION_FOLLOWING */) !== 0) {
        var el = m.nextElementSibling;
        var ok = true;
        while (el && el !== menu) {
          if (el.querySelector && (el.classList.contains('contextMenu') ||
            el.getAttribute('role') === 'menu') && isVisibleEl(el)) { ok = false; break; }
          el = el.nextElementSibling;
        }
        if (ok) return true;
      }
    }
  }
  return false;
}

function menuHasManageRow(m: Element): boolean {
  var its = m.querySelectorAll('.contextMenuItem, [role="menuitem"], [aria-haspopup]');
  for (var i = 0; i < its.length; i++) {
    if (matchTxt(its[i].textContent, STR_MANAGE)) return true;
  }
  return false;
}

// Resolve the item container from a menu/contents/submenu-root candidate:
// known class, aria-labelledby → "Manage", role=menuitem children, or a
// box of several short rows.
function resolveContents(d: Document, menu: Element): HTMLElement | null {
  var byClass = menu.querySelector('.contextMenuContents');
  if (byClass) return byClass as HTMLElement;
  var lbSelf = menu.getAttribute && menu.getAttribute('aria-labelledby');
  if (lbSelf) {
    var l0 = d.getElementById(lbSelf);
    if (l0 && matchTxt(l0.textContent, STR_MANAGE)) return menu as HTMLElement;
  }
  var byLb = menu.querySelector('[aria-labelledby]');
  if (byLb) {
    var lb2 = byLb.getAttribute('aria-labelledby');
    var l1 = lb2 ? d.getElementById(lb2) : null;
    if (l1 && matchTxt(l1.textContent, STR_MANAGE)) return byLb as HTMLElement;
  }
  if (menu.querySelector('[role="menuitem"]')) return menu as HTMLElement;
  var kids = menu.children;
  var shortRows = 0;
  for (var i = 0; i < kids.length; i++) {
    if ((kids[i].textContent || '').trim().length < 60) shortRows++;
  }
  if (shortRows >= 2) return menu as HTMLElement;
  return null;
}

// ---------------------------------------------------------------------------
// Item injection
// ---------------------------------------------------------------------------
// Flat pin actions: unpin alone when already pinned, otherwise "current"
// (only when the game is on disk — the server needs the ACF) + "latest".
function desiredActions(d: MenuData): string[] {
  var out = ['fixes'];
  if (d.hasLua) {
    if (d.hasPins) {
      out.push('unpin');
    } else {
      if (d.installed) out.push('pin-current');
      out.push('pin-latest');
    }
    out.push('delete');
  }
  return out;
}

function actionLabel(action: string): string {
  switch (action) {
    case 'fixes': return t('Game Fixes');
    case 'pin-current': return t('Pin to Current Version');
    case 'pin-latest': return t('Pin to Latest Version');
    case 'unpin': return t('Unpin Manifest');
    case 'delete': return t('Delete Lua…');
    default: return action;
  }
}

function ensureItems(d: Document, menu: Element, protoHint?: HTMLElement | null): void {
  var md = menuData;
  if (!md || !md.ready || !ctxAppId || md.appId !== ctxAppId) return;
  // Contents container: known class, aria-labelledby → Manage, then
  // structural fallbacks (row path passes the container directly).
  var contents = resolveContents(d, menu);
  if (!contents) {
    scanSkip('Manage submenu has no contents container (role menuitem=' +
      menu.querySelectorAll('[role="menuitem"]').length + ')');
    return;
  }

  var desired = desiredActions(md);
  var existing = Array.prototype.slice.call(
    contents.querySelectorAll('[data-luma-manage]')) as HTMLElement[];
  var same = existing.length === desired.length;
  if (same) {
    for (var k = 0; k < desired.length; k++) {
      if (existing[k].getAttribute('data-luma-manage') !== desired[k]) { same = false; break; }
    }
  }
  if (same) return;
  for (var j = 0; j < existing.length; j++) existing[j].remove();

  // Proto row to clone: the row path hands us the exact matching row
  // (perfect styling without knowing any hashed class); otherwise hashed
  // classes first (known-good on this PC), then role=menuitem, then any
  // direct child row.
  var proto = (protoHint || null) as HTMLElement | null;
  if (!proto) proto = contents.querySelector('.contextMenuItem:not(.SubMenu)') as HTMLElement | null;
  if (!proto) proto = contents.querySelector('.contextMenuItem') as HTMLElement | null;
  if (!proto) proto = contents.querySelector('[role="menuitem"]') as HTMLElement | null;
  if (!proto) proto = contents.firstElementChild as HTMLElement | null;
  var protoClass = proto ? proto.className : 'contextMenuItem';
  var protoLabelClass = (proto && proto.firstElementChild && proto.firstElementChild.children.length === 0)
    ? (proto.firstElementChild as HTMLElement).className : '';

  // Insert before the last separator so Uninstall stays the final entry.
  var anchor: Element | null = null;
  var seps = contents.querySelectorAll('.ContextMenuSeparator, [role="separator"], [aria-hidden="true"]');
  for (var i = seps.length - 1; i >= 0; i--) {
    if (seps[i].parentElement === contents) { anchor = seps[i]; break; }
  }
  if (!anchor) {
    // No known separator class: insert before the row whose text is
    // "Uninstall" (the menu's stable last entry).
    var rows = contents.children;
    for (var q = rows.length - 1; q >= 0; q--) {
      if (matchTxt((rows[q].textContent || ''), STR_UNINSTALL)) { anchor = rows[q]; break; }
    }
  }

  var frag = d.createDocumentFragment();
  for (var a = 0; a < desired.length; a++) {
    frag.appendChild(makeItem(d, proto, protoClass, protoLabelClass, actionLabel(desired[a]), desired[a]));
  }
  if (anchor) contents.insertBefore(frag, anchor);
  else contents.appendChild(frag);
  console.log('[LUMA_INJECT] Manage menu items injected: ' + desired.join(',') +
    ' appid=' + ctxAppId + ' anchor=' + (anchor ? 'separator' : 'end') +
    ' proto=' + (proto ? JSON.stringify(protoClass.slice(0, 60)) : 'none') +
    ' contents=' + JSON.stringify((contents.getAttribute('class') || contents.tagName).slice(0, 60)));
  jsLog('MENU items injected: ' + desired.join(',') + ' appid=' + ctxAppId +
    ' anchor=' + (anchor ? 'separator' : 'end'));
}

function makeItem(
  d: Document,
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
    item = d.createElement('div');
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
    var lbl = d.createElement('div');
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
    console.log('[LUMA_INJECT] ACTION closeMenu via Escape (' + (menu.className || menu.tagName) + ')');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true } as any));
  } catch (e) {
    console.warn('[LUMA_INJECT] ACTION closeMenu error:', e && (e as any).message);
  }
}

function handleAction(action: string, item: HTMLElement): void {
  var appId = ctxAppId;
  console.log('[LUMA_INJECT] ACTION begin action=' + action + ' appId=' + appId);
  jsLog('ACTION begin action=' + action + ' appId=' + appId);
  if (!appId) {
    console.warn('[LUMA_INJECT] ACTION abort: no appId');
    return;
  }
  // Class-agnostic: hashed .contextMenu won't exist on the other PC; the
  // item itself (role=menuitem) bubbles the Escape just as well.
  var menu = (item.closest('.contextMenu') || item.closest('[role="menu"]') ||
    item) as Element | null;

  if (action === 'fixes') {
    closeMenu(menu);
    openFixesModal(appId);
    return;
  }

  if (action === 'pin-current' || action === 'pin-latest' || action === 'unpin') {
    closeMenu(menu);
    var url = action === 'unpin' ? steamKeysUnpinUrl() : steamKeysPinUrl();
    var mode = action === 'pin-current' ? 'current' : 'latest';
    var payload = action === 'unpin' ? { appId: appId } : { appId: appId, mode: mode };
    console.log('[LUMA_INJECT] ACTION ' + action + ' fetching ' + url + ' payload=' + JSON.stringify(payload));
    fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        console.log('[LUMA_INJECT] ACTION ' + action + ' response ok=' + !!(res && res.ok) +
          ' msg=' + JSON.stringify((res && res.message) || null));
        jsLog('ACTION ' + action + ' response ok=' + !!(res && res.ok) +
          ' msg=' + JSON.stringify((res && res.message) || null));
        if (!res || !res.ok) console.warn('[LUMA_INJECT] Menu pin op failed:', res && res.message);
        menuData = null;
      })
      .catch(function (e) {
        console.warn('[LUMA_INJECT] ACTION ' + action + ' fetch error:', e && e.message);
        jsLog('ACTION ' + action + ' fetch error=' + (e && e.message));
        menuData = null;
      });
    return;
  }

  if (action === 'delete') {
    // Two-step inline confirm (dashboard parity): first click arms, second
    // click (within 3s) deletes.
    if (item.getAttribute('data-confirm') !== '1') {
      item.setAttribute('data-confirm', '1');
      setItemLabel(item, t('Confirm delete?'));
      setTimeout(function () {
        if (item.getAttribute('data-confirm') === '1') {
          item.removeAttribute('data-confirm');
          setItemLabel(item, t('Delete Lua…'));
        }
      }, 3000);
      return;
    }
    closeMenu(menu);
    console.log('[LUMA_INJECT] ACTION delete fetching DELETE ' + luaFileDeleteUrl(appId));
    jsLog('ACTION delete fetching app=' + appId);
    fetch(luaFileDeleteUrl(appId), { method: 'DELETE', mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        console.log('[LUMA_INJECT] ACTION delete response ok=' + !!(res && res.ok) +
          ' removedFile=' + JSON.stringify(res && res.removedFile));
        jsLog('ACTION delete response ok=' + !!(res && res.ok) +
          ' removedFile=' + JSON.stringify(res && res.removedFile));
        if (res && res.ok) menuData = null;
      })
      .catch(function (e) {
        console.warn('[LUMA_INJECT] ACTION delete fetch error:', e && e.message);
        jsLog('ACTION delete fetch error=' + (e && e.message));
      });
    return;
  }
}
