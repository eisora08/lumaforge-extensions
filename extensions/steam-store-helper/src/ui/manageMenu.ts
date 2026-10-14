import { luaFilesUrl, luaFileDeleteUrl, steamKeysPinsUrl, steamKeysPinUrl, steamKeysUnpinUrl, jsLog, isLibrarySurface } from './helpers';
import { openFixesModal } from '../modals/fixes';
import { LUMA_INJECT_VERSION } from '../core/state';
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
// The exact-text "Manage" row element from the last hover; the geometry
// path uses it as the anchor to find the submenu on PCs whose menus have
// neither readable classes nor ARIA roles.
var manageRowEl: Element | null = null;
// True while the pointer is ON the "Manage" row, inside our own submenu, or
// in the zone immediately right/top-aligned with that row. Hover-family
// acceptance (geometry path + isManageMenu fallback) requires this — a stale
// 2s window alone accepted other submenus ("Add to" / "Remove from") and
// arbitrary menus after the user clicked away.
var pointerOnManage = false;
// Last prefetchMenuData() start; setContextApp uses it to collapse bursts
// of same-app contextmenu re-dispatches into a single bridge round-trip.
var lastPrefetchAt = 0;
// Last menu-specific cue: a "Manage" hover, a right-click that opened a
// root menu, or a click on the "Manage" trigger. Generic pointer activity
// is NOT a cue (any mouseover refreshes it) — only these events mean a
// menu is opening/open, which is the sole condition under which the heavy
// class-agnostic whole-doc paths can match. Gating on generic activity made
// idle hovering run that sweep on every scan, failing ~1/s (scan fail[final]
// was the top proxy-log line).
var menuCueAt = 0;
// One beacon per menu popup realm so the proxy log shows every realm that
// loaded the script and which of them runs the scanner; repeated
// startManageMenu calls in popup realms stay quiet after the first.
var _popupRealmNoted = false;
// Skip-log dedupe, two tiers. Realm-wide reasons (no menuData/no ctxAppId)
// collapse into this single slot: one line per state change. Document-
// specific reasons (they embed the doc title) go into a per-document map —
// a 13-doc sweep alternates titles every scan, so a single-slot dedupe
// never settled and printed ~2000 lines per 3 minutes.
var _lastScanSkip = '';
var _skipByDoc: WeakMap<Document, string> = new WeakMap();
// Menu/contents container that last received (or confirmed) our items;
// stripOrphans() keeps only this one and removes [data-luma-manage] rows
// everywhere else (Steam reuses submenu DOM between triggers, so rows left
// behind would resurface in "Add to" / "Remove from" submenus).
var lastEnsured: Element | null = null;
// Snapshot of lastEnsured's shape (children count + first row text) taken at
// ensure time: a failing scan only invalidates lastEnsured when the content
// changed (Steam reused the element for another menu) or it is gone/hidden —
// a still-identical visible container is the submenu the user is navigating.
var lastEnsuredSig = '';

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
var _msgHooked = false;
var _bindOpener: any = null;
var _bindOpener2: any = null;
var _bcFixes: any = null;
var _bcFixesHooked = false;

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
  // Export the fixes-modal opener on THIS realm's window so any instance
  // that owns a row (menus render as IFRAMEs on some PCs and as
  // window.open popups on others; every injected realm scans them) can
  // redirect the mount to the main library window instead of appending the
  // modal inside a menu frame that Steam hides or reuses.
  try { (window as any).__lumaFixesMount = openFixesModal; } catch (_) { }
  if (!_msgHooked) {
    _msgHooked = true;
    // Cross-origin fallback for mountFixesModal: when the direct property
    // read on the owning window throws, it posts {__lumaFixesOpen} here and
    // the modal opens in THIS realm's document.
    try {
      window.addEventListener('message', function (ev: MessageEvent) {
        try {
          var d: any = ev.data;
          if (d && d.__lumaFixesOpen) {
            if (window.name && window.name.indexOf('PopupWindow_') === 0) return;
            jsLog('fixes mount via=message');
            openFixesModal(String(d.__lumaFixesOpen));
          }
        } catch (_) { }
      });
    } catch (_) { }
  }
  // Broadcast fallback: when the row's owning realm cannot reach any
  // script-bearing ancestor (menu popups' opener has no script here), the
  // emitter posts {__lumaFixesOpen} on this channel and exactly one receiver
  // — a library-surface window not named contextmenu_* — opens the modal.
  // Menu popup realms are filtered by name so a closing popup can never
  // swallow the modal, and store realms fail the isLibrarySurface() guard.
  if (!_bcFixesHooked) {
    _bcFixesHooked = true;
    try {
      _bcFixes = new BroadcastChannel('lumaforge-fixes');
      _bcFixes.onmessage = function (ev: MessageEvent) {
        try {
          var d: any = ev.data;
          if (!d || !d.__lumaFixesOpen) return;
            if (!isLibrarySurface()) return;
            if (window.name && window.name.indexOf('contextmenu_') === 0) return;
            if (window.name && window.name.indexOf('PopupWindow_') === 0) return;
            jsLog('fixes mount via=broadcast');
          openFixesModal(String(d.__lumaFixesOpen));
        } catch (_) { }
      };
    } catch (_) { }
  }
  // Menu popup realms (window.name "contextmenu_N" on older builds,
  // "PopupWindow_*" on current ones) are script-bearing too
  // and until now ran a full scanner stack of their own: listeners on every
  // document they track, g_PopupManager sweeps, popup observers and a 1s
  // tick. Every menu event therefore fired in all 13 realms at once — 13
  // duplicate bridge prefetches per right-click ("MENU data" x13 within
  // 6ms in the session log) and 13 realms racing to inject the same rows,
  // which made the fixes-modal mount depend on which realm won the race.
  // The library window already tracks every document these realms see (the
  // same g_PopupManager through the opener chain, plus its own window.open
  // wrap) and injects there alone; popup realms keep only the
  // fixes-modal plumbing above (window export + message + broadcast).
  var isMenuPopup = false;
  try {
    isMenuPopup =
      window.name.indexOf('contextmenu_') === 0
      || window.name.indexOf('PopupWindow_') === 0;
  } catch (_) { }
  if (isMenuPopup) {
    if (!_popupRealmNoted) {
      _popupRealmNoted = true;
      var pbeacon = 'manage build ' + LUMA_INJECT_VERSION +
        ' opener=' + (window.opener ? 'Y' : 'N') +
        ' frame=' + (window.parent && window.parent !== window ? 'Y' : 'N') +
        ' href=' + location.href.slice(0, 70) +
        ' name=' + (window.name || '-') + ' scanner=N';
      jsLog(pbeacon);
      console.log('[LUMA_INJECT] ' + pbeacon);
    }
    return;
  }
  if (bound) return;
  bound = true;
  // Steam clears window.opener after popup setup on some builds, which
  // silently emptied mountFixesModal's candidate list at click time. Capture
  // the live WindowProxy references while they are still reachable here; the
  // references stay usable for redirects even after .opener is nulled.
  if (!_bindOpener) {
    try { _bindOpener = window.opener || null; } catch (_) { }
    try { _bindOpener2 = (_bindOpener && (_bindOpener as any).opener) || null; } catch (_) { }
  }
  // Build beacon: the proxy log must always show which inject build is
  // actually running — stale copies on other PCs were indistinguishable.
  // Topology flags separate frames (parent != self) from windows/popups;
  // href identifies which realm bound (main index.html vs menu popups).
  // console.log echoes through cef_hook in case the early jsLog is dropped.
  var beacon = 'manage build ' + LUMA_INJECT_VERSION +
    ' opener=' + (window.opener ? 'Y' : 'N') +
    ' frame=' + (window.parent && window.parent !== window ? 'Y' : 'N') +
    ' href=' + location.href.slice(0, 70) +
    ' name=' + (window.name || '-') + ' scanner=Y';
  jsLog(beacon);
  console.log('[LUMA_INJECT] ' + beacon);
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
  entry.timer = setInterval(function () { pollPopup(entry); }, 1000);
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

// Scan this document plus every reachable popup document. Coalesced: the
// library body mutates constantly (React), and one scan per 60ms window is
// plenty — the submenu cannot appear and matter faster than that.
var scanPending = false;
function scanAll(): void {
  if (scanPending) return;
  scanPending = true;
  setTimeout(function () {
    scanPending = false;
    if (!bound) return;
    scanMenus(document);
    for (var i = 0; i < popups.length; i++) {
      if (popups[i].doc) scanMenus(popups[i].doc as Document);
    }
  }, 60);
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
  // Burst guard: Steam re-dispatches contextmenu (or the user double
  // right-clicks) while the menu is already open — one refetch per burst
  // keeps data fresh without hammering the bridge with duplicate requests.
  if (id && id === ctxAppId && menuData && Date.now() - lastPrefetchAt < 400) return;
  ctxAppId = id;
  if (id) prefetchMenuData(id);
  else menuData = null;
}

function onContextMenu(e: MouseEvent): void {
  try {
    var t: any = e.target;
    // Right-clicks inside an already-open menu are not a new context:
    // Steam re-dispatches contextmenu on menu rows, and processing those
    // reset the hover window and re-prefetched in bursts — which killed
    // the Manage fallback on PCs where the submenu is identified by hover.
    if (t && t.closest && (t.closest('.contextMenu') || t.closest('[role="menu"]'))) return;
    menuCueAt = Date.now();
    // The event may fire in a popup document (bound via trackPopup).
    var doc = ((e.target as any) && (e.target as any).ownerDocument) || document;
    var id = appIdFromNode(e.target);
    if (!id && doc.elementFromPoint) {
      var under = doc.elementFromPoint(e.clientX, e.clientY);
      if (under && under !== e.target) id = appIdFromNode(under);
    }
    if (!id) id = lastHoverAppId;
    // Only a context for a DIFFERENT app kills the hover window; a repeat
    // for the same app (synthetic events, double right-click) keeps it. A
    // different app also means the previous menu's rows are leftovers in a
    // reused element — strip them before the new menu renders.
    if (id !== ctxAppId) { manageHoverAt = 0; manageRowEl = null; pointerOnManage = false; hardStripAll(); }
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
    var id = appIdFromNode(t);
    if (id) lastHoverAppId = id;
    // Remember when the pointer sits on the "Manage" entry: the submenu that
    // opens right after is the one we inject into. Class-agnostic: hashed
    // class names differ between PCs, so also match role=menuitem /
    // aria-haspopup and raw text.
    var item = t.closest ? (t.closest('.contextMenuItem') ||
      t.closest('[role="menuitem"]') || t.closest('[aria-haspopup]')) : null;
    if (item && matchTxt(item.textContent, STR_MANAGE)) { manageHoverAt = Date.now(); manageRowEl = item; }
    else if (!item && matchTxt(t.textContent, STR_MANAGE)) { manageHoverAt = Date.now(); manageRowEl = t; }
    else if (item) {
      // Pointer moved to a DIFFERENT root entry ("Add to", "Remove from",
      // ...): the next submenu Steam opens is not ours, so cancel the hover
      // window. Rows inside our own submenu do not reset it — their host
      // menu has no "Manage" trigger row.
      var host = item.closest ? (item.closest('.contextMenu') ||
        item.closest('[role="menu"]')) : null;
      if (host && menuHasManageRow(host)) { manageHoverAt = 0; manageRowEl = null; }
    } else if (manageRowEl && t.parentElement &&
      t.parentElement === manageRowEl.parentElement) {
      // Class-less PC (no .contextMenuItem / role=menuitem anywhere): sibling
      // root entries share the parent with the "Manage" row. A short
      // non-Manage sibling text ("Add to", "Remove from") means the next
      // submenu is not ours — cancel the hover window so tryGeometryPath
      // never targets it. Empty-text siblings (icons inside our own row)
      // do not clear.
      var st = (t.textContent || '').trim();
      if (st.length > 0 && st.length < 40 && !matchTxt(t.textContent, STR_MANAGE)) {
        manageHoverAt = 0;
        manageRowEl = null;
      }
    }
    updatePointerOnManage(t);
  } catch (_) { }
}

// Recompute pointerOnManage for the current hover target: true only on the
// "Manage" row itself, inside our own injected submenu, or in the zone
// immediately right of the row and top-aligned with it (where its submenu
// opens). Anywhere else — other root rows, other menus, the library
// background — is false, which is what stops stale-window acceptance of
// "Add to" / "Remove from" / arbitrary menus.
function updatePointerOnManage(t: any): void {
  var was = pointerOnManage;
  var next = false;
  try {
    if (manageRowEl) {
      if (t === manageRowEl || (manageRowEl.contains && manageRowEl.contains(t))) {
        next = true;
      } else if (lastEnsured && (t === lastEnsured || (lastEnsured.contains && lastEnsured.contains(t)))) {
        next = true;
      } else {
        var tr = t.getBoundingClientRect ? t.getBoundingClientRect() : null;
        var rr = manageRowEl.getBoundingClientRect ? manageRowEl.getBoundingClientRect() : null;
        if (tr && rr && (tr.width || tr.height) && (rr.width || rr.height) &&
          tr.top >= rr.top - 10 && tr.top <= rr.top + 10 && tr.left >= rr.left - 40) {
          // Same horizontal band as the Manage row: the row's own icon/label
          // (left of the label), the row itself, or the submenu zone to its
          // right. Other root rows sit ~30px away vertically and the library
          // background starts far left — both miss this band.
          next = true;
        }
      }
    }
  } catch (_) { next = false; }
  pointerOnManage = next;
  // Entering the Manage row: Steam opens the hover submenu after ~300ms via
  // a class/visibility toggle — no childList mutation, so the observers
  // never fire and no scan lands inside the hover window (the other PC's
  // logs showed zero scans with hoverAge 100-2000ms). Schedule them.
  if (next && !was) scheduleHoverScans();
}

var _hoverScanTimers: (ReturnType<typeof setTimeout>)[] = [];
function scheduleHoverScans(): void {
  for (var i = 0; i < _hoverScanTimers.length; i++) clearTimeout(_hoverScanTimers[i]);
  _hoverScanTimers.length = 0;
  var delays = [350, 700, 1200];
  for (var j = 0; j < delays.length; j++) {
    (function (ms: number) {
      _hoverScanTimers.push(setTimeout(function () {
        if (bound && pointerOnManage) scanAll();
      }, ms));
    })(delays[j]);
  }
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
    if (!manage) {
      // Our own action rows: leave them for their click handler.
      if (t.closest('[data-luma-manage]')) return;
      // Any other click means a menu just closed (or was already stale).
      // Steam reuses the same DOM element for every later menu — rows left
      // inside would resurface everywhere (tabs, dropdowns, other games)
      // because hiding a menu only toggles classes, which never fires our
      // childList observers. Strip every document now.
      hardStripAll();
      return;
    }
    menuCueAt = Date.now();
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
  lastPrefetchAt = Date.now();
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

// key = stable reason WITHOUT volatile detail (menuDump counts change on
// every call and would defeat any dedupe); detail = full line, printed only
// when the key actually changes for this document (or realm-wide).
function scanSkip(d: Document, key: string, detail?: string): void {
  _lastOkByDoc.delete(d);
  if (_skipByDoc.get(d) === key) return;
  if (key === _lastScanSkip) return;
  _skipByDoc.set(d, key);
  _lastScanSkip = key;
  console.log('[LUMA_INJECT] Manage menu scan skipped: ' + (detail || key));
}

// Successful inject in this document: forget its skip state so a later
// genuine failure reprints (parity with the old single-slot reset).
function scanSkipReset(d: Document): void {
  _lastScanSkip = '';
  try { _skipByDoc.delete(d); } catch (_) { }
}

// Success prints deduped per document+path: while a menu stays open every
// mutation re-scan succeeds and used to reprint the full dump (24 lines
// for 7 interactions). scanSkip() clears the marker so the next menu-open
// prints again.
var _lastOkByDoc: WeakMap<Document, string> = new WeakMap();
function scanOk(d: Document, path: string, msg: string): void {
  if (_lastOkByDoc.get(d) === path) return;
  _lastOkByDoc.set(d, path);
  console.log('[LUMA_INJECT] Manage menu ' + path + ' OK: ' + msg);
}

// One-line jsLog breadcrumb (throttled to 1/s) for remote debugging: when
// identification fails on a PC, the proxy log shows what the scan actually
// saw — visible menus, hover-window age (ms since hovering "Manage", -1 if
// never/invalidated), tracked documents and the appid.
var _lastJsFailAt = 0;
function jsScanFail(d: Document, where: string): void {
  var now = Date.now();
  if (now - _lastJsFailAt < 1000) return;
  _lastJsFailAt = now;
  try {
    var menus = d.querySelectorAll('.contextMenu, [role="menu"]');
    var vis = 0;
    for (var i = 0; i < menus.length; i++) if (isVisibleEl(menus[i])) vis++;
    jsLog('scan fail[' + where + '] visMenus=' + vis + '/' + menus.length +
      ' hoverAge=' + (manageHoverAt ? (now - manageHoverAt) : -1) +
      ' ptr=' + (pointerOnManage ? 'Y' : 'N') +
      ' row=' + (manageRowEl ? 'Y' : 'N') +
      ' docs=' + (1 + popups.length) + ' appid=' + (ctxAppId || 'null'));
  } catch (_) { }
}

function scanMenus(doc?: Document): void {
  var d: Document = doc || document;
  try {
    var md = menuData;
    if (!md || !md.ready) { scanSkip(d, 'no menuData (ready=' + !!(md && md.ready) + ')'); return; }
    if (!ctxAppId) { scanSkip(d, 'no ctxAppId'); return; }
    if (md.appId !== ctxAppId) { scanSkip(d, 'menuData appid ' + md.appId + ' != ctxAppId ' + ctxAppId); return; }
    var pt = d.getElementById('popup_target');
    var root: Element | null = pt || d.body;
    if (!root) { scanSkip(d, 'no #popup_target and no body in doc(' + d.title + ')'); return; }
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
      scanSkipReset(d);
      scanOk(d, 'class:' + via, menuDump(d));
      return;
    }

    // Heavy class-agnostic paths walk the WHOLE document (the menu may live
    // in a popup we cannot query by class) and only match while a menu is
    // opening/open — within 4s of a Manage hover, a right-click or a Manage
    // click. The old gate used generic pointer activity, which any mouseover
    // refreshed, so idle hovering re-ran this sweep on every scan and failed
    // about once per second (scan fail[final] was the top proxy-log line).
    // The cheap class paths above stay ungated: they keep working when the
    // submenu sits open longer than the cue window.
    // pointerOnManage keeps the window alive while the pointer stays on the
    // Manage row or inside its submenu: Steam loads the submenu asynchronously
    // and can take longer than 4s, in which case the mutation that finally
    // renders it must still be allowed to inject (parked pointer = live
    // interaction; elsewhere the gate stays closed and idle sweeps stay off).
    if (Date.now() - Math.max(manageHoverAt, menuCueAt) > 4000 && !pointerOnManage) {
      scanSkip(d, 'no menu cue in last 4s; class paths empty in doc(' + JSON.stringify(d.title) + ')');
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
      scanSkipReset(d);
      scanOk(d, 'row', '(proto=' +
        JSON.stringify((rowHit.proto.textContent || '').trim().slice(0, 40)) +
        ' contents=' + JSON.stringify((rowHit.contents.getAttribute('class') || rowHit.contents.tagName).slice(0, 60)) +
        ') ' + menuDump(d));
      return;
    }

    // Aria path: the "Manage" trigger row carries aria-controls/aria-haspopup
    // pointing at its submenu — decisive for games that are not installed
    // (no "Browse local files" row exists there).
    if (tryAriaPath(d)) {
      scanSkipReset(d);
      scanOk(d, 'aria', menuDump(d));
      return;
    }

    // Geometry path: on PCs whose menus have neither readable classes nor
    // ARIA roles (visMenus=0/0), the hovered "Manage" row plus the position
    // of the submenu that opened to its right is all we have — and enough.
    if (tryGeometryPath(d)) {
      scanSkipReset(d);
      return;
    }

    // role=menu candidates (Steam uses the role on some menu components).
    var roleMenus = d.querySelectorAll('[role="menu"]');
    var roleHit = false;
    for (var r = 0; r < roleMenus.length && !roleHit; r++) {
      if (isManageMenu(d, roleMenus[r])) { roleHit = true; ensureItems(d, roleMenus[r], null); }
    }
    if (roleHit) {
      scanSkipReset(d);
      scanOk(d, 'role', menuDump(d));
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
      scanSkipReset(d);
      scanOk(d, 'sweep', '(' + bestLen + ' chars): ' + menuDump(d));
      return;
    }

    // Full scan failed: nothing in this doc is the Manage submenu. Drop the
    // keep-list only when the container actually changed — hidden/gone, or
    // its contents re-rendered (Steam reused the element for another menu,
    // which is exactly when the rows become leftovers). An unchanged
    // VISIBLE container is the submenu the user is navigating right now
    // (every scan fails on the class-less PC): stripping it would delete
    // the rows mid-interaction.
    if (lastEnsured) {
      var liveContents = resolveContents(d, lastEnsured);
      if (!isVisibleEl(lastEnsured) || !liveContents ||
        menuSig(liveContents) !== lastEnsuredSig) lastEnsured = null;
    }
    jsScanFail(d, 'final');
    var skipKey = 'no Manage menu in doc(' + JSON.stringify(d.title) + ')';
    scanSkip(d, skipKey, skipKey + '; ' + menuDump(d));
  } catch (e) {
    console.warn('[LUMA_INJECT] Manage menu scan error:', e);
  } finally {
    // Steam reuses submenu DOM between triggers: any [data-luma-manage] row
    // outside the last accepted container is a leftover from a previous
    // hover (e.g. the "Add to" submenu reusing the just-closed Manage
    // submenu element) and must go.
    stripOrphans(d, lastEnsured);
  }
}

// Remove our injected rows from every place except the last accepted menu /
// contents container. Per-document, so a skip scan in one document never
// touches items that live in another.
var STRIP_MIN_AGE_MS = 1500;

// Immediate cleanup of every row in every reachable document, ignoring the
// age immunity: fired when the user clicks (a menu closed) or right-clicks
// a different app. This is the primary defense against Steam's DOM reuse —
// the childList observers never see a menu close (class toggle only).
function hardStripAll(): void {
  try {
    var docs: Document[] = [document];
    for (var i = 0; i < popups.length; i++) {
      var pd = popups[i].doc;
      if (pd && docs.indexOf(pd) === -1) docs.push(pd);
    }
    var removed = 0;
    for (var k = 0; k < docs.length; k++) {
      var items = docs[k].querySelectorAll('[data-luma-manage]');
      for (var j = 0; j < items.length; j++) { items[j].remove(); removed++; }
    }
    lastEnsured = null;
    lastEnsuredSig = '';
    manageHoverAt = 0;
    manageRowEl = null;
    pointerOnManage = false;
    if (removed) {
      console.log('[LUMA_INJECT] Manage menu hard strip: ' + removed + ' rows');
      jsLog('MENU hard strip: ' + removed + ' rows');
    }
  } catch (_) { }
}

// Shape snapshot of a contents container: children count + first row text.
// Steam reusing the element for another menu re-renders those, changing the
// signature — that is the signal to drop lastEnsured (and strip) even when
// the container is still visible.
function menuSig(el: Element | null): string {
  if (!el) return '';
  try {
    var fc = el.firstElementChild;
    return el.childElementCount + '|' + (fc ? (fc.textContent || '').trim().slice(0, 30) : '');
  } catch (_) { return '?'; }
}
function stripOrphans(d: Document, keep: Element | null): void {
  try {
    var items = d.querySelectorAll('[data-luma-manage]');
    var removed: string[] = [];
    var now = Date.now();
    for (var i = 0; i < items.length; i++) {
      var it = items[i] as HTMLElement;
      if (keep && (it === keep || (keep.contains && keep.contains(it)))) continue;
      // Fresh rows are IMMUNE: a scan that fails to identify the submenu
      // right after an inject must never delete what was just injected —
      // that accept/fail alternation is what caused the inject/strip
      // memory loop that crashed Steam. Only stale leftovers (rows left in
      // a DOM element Steam reused for another submenu) get removed.
      var at = parseInt(it.getAttribute('data-luma-at') || '0', 10);
      if (at && now - at < STRIP_MIN_AGE_MS) continue;
      removed.push(it.getAttribute('data-luma-manage') || '?');
      it.remove();
    }
    if (removed.length) {
      console.log('[LUMA_INJECT] Manage menu orphans removed: ' + removed.join(','));
      jsLog('MENU orphans removed: ' + removed.join(','));
    }
  } catch (_) { }
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
    var target = cid ? resolveIdAnyDoc(d, cid) : null;
    if (!target || !isVisibleEl(target)) continue;
    var contents = resolveContents(d, target);
    if (contents) {
      // Steam can REUSE the trigger's aria-controls target for a different
      // submenu ("Add to" / "Remove from"). If the contents now declare a
      // non-Manage label, they are not the Manage submenu — reject instead
      // of relying on the structural resolveContents fallback.
      var lbEl = (contents.getAttribute && contents.getAttribute('aria-labelledby'))
        ? contents : contents.querySelector('[aria-labelledby]');
      if (lbEl) {
        var lbId = lbEl.getAttribute('aria-labelledby');
        var lbNode = lbId ? resolveIdAnyDoc(d, lbId) : null;
        if (lbNode && !matchTxt(lbNode.textContent, STR_MANAGE)) continue;
      }
      ensureItems(d, contents, null);
      return true;
    }
  }
  return false;
}

// Hover path for PCs where the menu container has neither readable classes
// nor roles (visMenus=0/0): the "Manage" trigger row still exists (its exact
// text sets manageRowEl on hover) and the submenu is a small box of
// [role="menuitem"] rows positioned near that row (the other PC's menuDump:
// roleMenuItem=13 with zero .contextMenu / role=menu). Gated on the pointer
// being ON the Manage row right now, SAME document only (rects from
// different windows are incomparable), with a generous band — ±60px top and
// within 700px on either side, because Steam flips submenus leftward near
// the screen edge.
function tryGeometryPath(d: Document): boolean {
  if (!pointerOnManage) return false;
  if (Date.now() - manageHoverAt > 2000) return false;
  var row = manageRowEl as HTMLElement | null;
  if (!row || !isVisibleEl(row)) return false;
  if (row.ownerDocument !== d) return false;
  var rr = row.getBoundingClientRect();
  if (!rr || (!rr.width && !rr.height)) return false;
  var cands = d.querySelectorAll('div, ul, table');
  var best: HTMLElement | null = null;
  var bestGap = 1e9;
  var bestArea = 1e9;
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i] as HTMLElement;
    // Skip the row itself, its ancestors (the root menu holds it, so the
    // root can never be a candidate) and its descendants.
    if (el === row || row.contains(el) || el.contains(row)) continue;
    var t = (el.textContent || '').trim();
    if (!t || t.length >= 250) continue;
    if (matchTxt(t, STR_MANAGE)) continue;
    if (el.querySelector('[data-luma-manage]')) continue;
    if (!isVisibleEl(el)) continue;
    // Real menu box: at least one menu-item row. This is the only structural
    // signal the class-less PC leaves on the submenu.
    if (!el.querySelector('[role="menuitem"], .contextMenuItem')) continue;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // Vertical band: top-aligned with the Manage row within ±60px (adjacent
    // triggers sit ~40px off, but their submenu can only open when its own
    // trigger is hovered — which zeroes pointerOnManage).
    if (r.top < rr.top - 60 || r.top > rr.top + 60) continue;
    // Horizontal gap on either side (right = normal, left = edge flip);
    // overlapping counts as 0.
    var gap: number;
    if (r.left >= rr.right - 4) gap = r.left - rr.right;
    else if (r.right <= rr.left + 4) gap = rr.left - r.right;
    else gap = 0;
    if (gap > 700) continue;
    var area = r.width * r.height;
    // Closest wins beyond ±40px; within that band the smaller element wins
    // (the inner contents box over a positioned wrapper).
    if (gap < bestGap - 40 || (gap <= bestGap + 40 && area < bestArea)) {
      if (gap < bestGap) bestGap = gap;
      bestArea = area;
      best = el;
    }
  }
  if (!best) return false;
  if (!resolveContents(d, best)) return false;
  ensureItems(d, best, best.firstElementChild as HTMLElement | null);
  console.log('[LUMA_INJECT] Manage menu geometry path OK (gap=' +
    Math.round(bestGap) + ' area=' + Math.round(bestArea) + '): ' + menuDump(d));
  return true;
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
    var lbl = resolveIdAnyDoc(d, lb);
    // A declared label is a verdict: anything but "Manage" (e.g. "Add to" /
    // "Remove from") means this submenu is not ours — never fall through to
    // the hover fallback, which would accept it while the Manage hover is
    // still fresh. If the id does not resolve (cross-window label), keep
    // going: the fallbacks below cover it.
    if (lbl) return matchTxt(lbl.textContent, STR_MANAGE);
  }
  // Hover fallback, structurally gated: right after hovering "Manage" the
  // submenu that opens is accepted only when it is LINKED to the menu that
  // hosts the "Manage" trigger (appended right after it, or inside the same
  // wrapper with no other visible menu in between). The previous version
  // accepted ANY small visible menu within the 2s window, which is how our
  // items leaked into every other menu (supernavs, root menus, notifications).
  // The pointer must additionally be ON the Manage row right now: moving to
  // "Add to" (whose submenu is linked exactly like ours) zeroes this and the
  // fallback rejects it, whatever the window says.
  if (!pointerOnManage) return false;
  if (Date.now() - manageHoverAt > 2000) return false;
  if (t.length >= 400) return false;
  var items = menu.querySelectorAll('.contextMenuItem, [role="menuitem"]');
  if (!items.length) return false;
  for (var i = 0; i < items.length; i++) {
    if (matchTxt(items[i].textContent, STR_MANAGE)) return false; // the parent/root menu itself
  }
  return linkedManageSubmenu(d, menu) || linkedManageSubmenuAnyDoc(d, menu);
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

// Some PCs render the root menu and its hover submenu in SEPARATE popup
// windows: the "Manage" trigger the user hovered lives in one document and
// the submenu that opens is in another, so neither the sibling structure
// nor aria ids can link them in-document. Within the hover window, any small
// visible menu without a "Manage" row (checked by the caller) is accepted
// when a sibling document still shows the visible "Manage" root it opened
// from. Moving the pointer to another root entry clears manageHoverAt (see
// onMouseOver), so this cannot catch "Add to" / "Remove from" submenus.
function linkedManageSubmenuAnyDoc(d: Document, menu: Element): boolean {
  if (Date.now() - manageHoverAt > 2000) return false;
  var roots: Document[] = [document];
  for (var i = 0; i < popups.length; i++) {
    var pd = popups[i].doc;
    if (pd && roots.indexOf(pd) === -1) roots.push(pd);
  }
  for (var r = 0; r < roots.length; r++) {
    var rd = roots[r];
    if (rd === d) continue;
    var ms = rd.querySelectorAll('.contextMenu, [role="menu"]');
    for (var m = 0; m < ms.length; m++) {
      if (!isVisibleEl(ms[m])) continue;
      if (menuHasManageRow(ms[m])) {
        console.log('[LUMA_INJECT] Manage submenu accepted via cross-window link');
        return true;
      }
    }
  }
  return false;
}

// aria-controls/aria-labelledby ids may live in a different document when
// Steam renders a menu in a separate popup window. Look the id up in the
// scanned document, the bound main document and every tracked popup.
function resolveIdAnyDoc(d: Document, id: string): Element | null {
  try {
    var el = d.getElementById(id);
    if (el) return el;
    if (d !== document) {
      el = document.getElementById(id);
      if (el) return el;
    }
    for (var i = 0; i < popups.length; i++) {
      var pd = popups[i].doc;
      if (pd && pd !== d) {
        el = pd.getElementById(id);
        if (el) return el;
      }
    }
  } catch (_) { }
  return null;
}

// Resolve the item container from a menu/contents/submenu-root candidate:
// known class, aria-labelledby → "Manage", role=menuitem children, or a
// box of several short rows.
function resolveContents(d: Document, menu: Element): HTMLElement | null {
  var byClass = menu.querySelector('.contextMenuContents');
  if (byClass) return byClass as HTMLElement;
  var lbSelf = menu.getAttribute && menu.getAttribute('aria-labelledby');
  if (lbSelf) {
    var l0 = resolveIdAnyDoc(d, lbSelf);
    if (l0 && matchTxt(l0.textContent, STR_MANAGE)) return menu as HTMLElement;
  }
  var byLb = menu.querySelector('[aria-labelledby]');
  if (byLb) {
    var lb2 = byLb.getAttribute('aria-labelledby');
    var l1 = lb2 ? resolveIdAnyDoc(d, lb2) : null;
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
  lastEnsured = menu;
  // Contents container: known class, aria-labelledby → Manage, then
  // structural fallbacks (row path passes the container directly).
  var contents = resolveContents(d, menu);
  if (!contents) {
    lastEnsuredSig = menuSig(menu);
    scanSkip(d, 'Manage submenu has no contents container',
      'Manage submenu has no contents container (role menuitem=' +
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
  if (same) { lastEnsuredSig = menuSig(contents); return; }
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
  lastEnsuredSig = menuSig(contents);
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
  item.setAttribute('data-luma-at', String(Date.now()));
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

// Mount the fixes modal in the MAIN library window. The row's click handler
// runs in whichever injected realm created the row — menus render as
// IFRAMEs (opener = null, top/parent = the library window) on some PCs and
// as window.open popups (opener = creator) on others, so probe the chain
// topmost-first: top, opener-of-opener, parent, opener, then self. Same
// origin throughout (steamloopback), so the direct property read works; a
// cross-origin read that throws falls back to postMessage (the listener
// installed by startManageMenu opens it in the receiver's document).
//
// Candidates are also gated on viewport size: menu popup realms that Steam
// names WITHOUT the contextmenu_/PopupWindow_ prefixes measure ~21x21px
// (Linux builds), and mounting there renders an invisible modal — the
// "fixes check rect=21x21@0,0" symptom. A cross-origin realm that can't be
// measured counts as visible so the postMessage fallback still runs.
function realmVisible(w: any): boolean {
  try {
    return (w.innerWidth || 0) >= 300 && (w.innerHeight || 0) >= 200;
  } catch (_) {
    return true;
  }
}
function mountFixesModal(appId: string): void {
  var cands: any[] = [];
  var tags: string[] = [];
  function add(w: any, tag: string): void {
    try {
      if (!w) return;
      if (!realmVisible(w)) return;
      for (var i = 0; i < cands.length; i++) if (cands[i] === w) return;
      cands.push(w);
      tags.push(tag);
    } catch (_) { }
  }
  // Saved references (captured at startManageMenu while .opener was alive)
  // come first: Steam nulls window.opener after popup setup on some builds,
  // which would otherwise drop the main library window from this list.
  try { add(window.top, 'top'); } catch (_) { }
  try { add(_bindOpener2, 'bOpener2'); } catch (_) { }
  try { add(window.opener && (window.opener as any).opener, 'opener2'); } catch (_) { }
  try { add(window.parent, 'parent'); } catch (_) { }
  try { add(_bindOpener, 'bOpener'); } catch (_) { }
  try { add(window.opener, 'opener'); } catch (_) { }
  // Self-mount only from a real library window: menu popup realms (named
  // contextmenu_* on older builds, PopupWindow_* on current ones) mount
  // into a window that closes right after the click, which is why the
  // modal "disappeared" or "appeared by the tray icon".
  // Those realms broadcast instead and the visible library window answers.
  var selfOk = true;
  try {
    if (!isLibrarySurface()) selfOk = false;
    if (!realmVisible(window)) selfOk = false;
    if (window.name && window.name.indexOf('contextmenu_') === 0) selfOk = false;
    if (window.name && window.name.indexOf('PopupWindow_') === 0) selfOk = false;
  } catch (_) { }
  if (selfOk) { try { add(window, 'self'); } catch (_) { } }
  var threwNonSelf = false;
  var postTargets: any[] = [];
  var exp: string[] = [];
  for (var i = 0; i < cands.length; i++) {
    if (cands[i] === window) continue;
    try {
      var f = cands[i].__lumaFixesMount;
      if (typeof f === 'function') {
        jsLog('fixes mount via=' + tags[i]);
        f(appId);
        return;
      }
      exp.push(tags[i] + ':N');
    } catch (_) {
      threwNonSelf = true; postTargets.push(cands[i]); exp.push(tags[i] + ':T');
    }
  }
  // One diagnostic line: which realm owns the row (self href), whether .opener
  // survived until click time, and what the saved opener chain actually holds.
  var savedHref = 'X';
  try { savedHref = String((_bindOpener && _bindOpener.location && _bindOpener.location.href) || 'NONE'); savedHref = savedHref.slice(0, 70); } catch (_) { savedHref = 'X'; }
  var diag = 'fixes chain self=' + location.href.slice(0, 70) +
    ' name=' + (window.name || '-') +
    ' focus=' + (document.hasFocus() ? 'Y' : 'N') +
    ' vp=' + window.innerWidth + 'x' + window.innerHeight +
    ' selfOk=' + (selfOk ? 'Y' : 'N') +
    ' openerClick=' + (window.opener ? 'Y' : 'N') +
    ' saved=' + (_bindOpener ? 'Y' : 'N') +
    ' savedHref=' + savedHref +
    ' exp=' + (exp.join(',') || 'none') +
    (threwNonSelf ? ' threw=Y' : '');
  jsLog(diag);
  console.log('[LUMA_INJECT] ' + diag);
  if (threwNonSelf && postTargets.length) {
    try {
      postTargets[0].postMessage({ __lumaFixesOpen: appId }, '*');
      jsLog('fixes mount via=postmessage');
      return;
    } catch (_) { }
  }
  if (selfOk) {
    jsLog('fixes mount via=self');
    openFixesModal(appId);
    return;
  }
  // Owning realm is a menu popup (or not a library surface): elect the
  // visible library window over BroadcastChannel instead of mounting into a
  // window that is about to close.
  var bcOk = false;
  try {
    var bc = new BroadcastChannel('lumaforge-fixes');
    bc.postMessage({ __lumaFixesOpen: appId });
    try { bc.close(); } catch (_) { }
    bcOk = true;
  } catch (_) { }
  if (bcOk) jsLog('fixes mount via=broadcast-emit');
  else jsLog('fixes mount via=blocked');
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
    mountFixesModal(appId);
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
