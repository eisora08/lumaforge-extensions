// ---------------------------------------------------------------------------
// Theme-aware color resolution
// ---------------------------------------------------------------------------
// Reads the active theme's CSS variables and overrides the plugin's
// --luma-ssh-* accent family with INLINE styles on :root. Inline custom
// properties win over every stylesheet, so this works regardless of cascade
// order (the plugin's own :root defaults used to override the proxy's
// ssh-bridge style because it was appended later in the document).
//
// Accent candidate priority:
//   1. --st-accent-1              (SpaceTheme: RGB triplet "102, 108, 255")
//   2. --accent-color             (fluenty: "#135ef2")
//   3. --fill-color-accent-secondary (Steam standard, fluenty defines it)
//   4. --luma-ssh-accent          (proxy ssh-bridge, already var()-resolved)
//   5. --SystemAccentColor        (accent.rs injected, Windows accent)
//   6. #66c0ff                    (Steam blue fallback)
//
// Panel background adopts the theme only when it is dark (luminance < 0.5) —
// light themes would clash with the extension's dark card backgrounds.

interface RGB { r: number; g: number; b: number; a: number; }

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

// Parse a CSS color string: #rgb/#rrggbb/#rrggbbaa, rgb()/rgba() (comma or
// space syntax), or a bare RGB triplet ("102, 108, 255") used by themes that
// store triplets for rgb(var(--x)) composition. Returns null otherwise.
export function parseColor(raw: string): RGB | null {
  if (!raw) return null;
  var s = raw.trim().toLowerCase();
  if (!s || s === 'none' || s.indexOf('var(') === 0) return null;

  // Hex
  if (s.charAt(0) === '#') {
    var hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.replace(/./g, function (c) { return c + c; });
    }
    if (hex.length === 6 || hex.length === 8) {
      if (!/^[0-9a-f]+$/.test(hex)) return null;
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      };
    }
    return null;
  }

  // rgb()/rgba()
  var fn = s.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    var parts = fn[1].replace(/\//g, ' ').split(/[\s,]+/).filter(function (p) { return p.length; });
    if (parts.length < 3) return null;
    var nums = parts.slice(0, 3).map(function (p) {
      if (p.indexOf('%') >= 0) return clampByte(parseFloat(p) * 2.55);
      return clampByte(parseFloat(p));
    });
    if (nums.some(isNaN)) return null;
    var alpha = 1;
    if (parts.length > 3 && parts[3] !== undefined) {
      alpha = parts[3].indexOf('%') >= 0 ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
      if (isNaN(alpha)) alpha = 1;
    }
    return { r: nums[0], g: nums[1], b: nums[2], a: alpha < 0 ? 0 : alpha > 1 ? 1 : alpha };
  }

  // Bare triplet: "102, 108, 255" or "102 108 255"
  var trip = s.split(/[\s,]+/).filter(function (p) { return p.length; });
  if (trip.length === 3 && trip.every(function (p) { return /^[0-9.]+$/.test(p); })) {
    return { r: clampByte(parseFloat(trip[0])), g: clampByte(parseFloat(trip[1])), b: clampByte(parseFloat(trip[2])), a: 1 };
  }

  return null;
}

function rgba(c: RGB, a: number): string {
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (a < 0 ? 0 : a > 1 ? 1 : a) + ')';
}

// Mix channel toward white (t > 0) or black (t < 0)
function shade(c: RGB, t: number): string {
  var f = function (v: number) {
    return clampByte(t >= 0 ? v + (255 - v) * t : v * (1 + t));
  };
  return 'rgba(' + f(c.r) + ',' + f(c.g) + ',' + f(c.b) + ',1)';
}

function luminance(c: RGB): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function readVar(cs: CSSStyleDeclaration, name: string): string {
  try { return cs.getPropertyValue(name).trim(); } catch (e) { return ''; }
}

function firstColorVar(cs: CSSStyleDeclaration, names: string[]): RGB | null {
  for (var i = 0; i < names.length; i++) {
    var c = parseColor(readVar(cs, names[i]));
    if (c) return c;
  }
  return null;
}

var ACCENT_CANDIDATES = [
  '--st-accent-1',
  '--accent-color',
  '--fill-color-accent-secondary',
  '--luma-ssh-accent',
  '--SystemAccentColor'
];
var FALLBACK_ACCENT: RGB = { r: 102, g: 192, b: 255, a: 1 };

// Base surface candidates for the panel background (mica base first — the
// active theme's panel/window base color).
var SURFACE_CANDIDATES = [
  '--background-fill-color-mica-background-base',
  '--window-bg',
  '--background-col'
];

// Read a color candidate from BOTH documentElement and body (some themes
// define variables on body only; both inherit either way, so first hit wins).
function firstColorVarBoth(names: string[]): RGB | null {
  var root = document.documentElement;
  var c = firstColorVar(getComputedStyle(root), names);
  if (c) return c;
  try {
    if (document.body) c = firstColorVar(getComputedStyle(document.body), names);
  } catch (e) { }
  return c;
}

// Resolve the active theme's colors and apply them as inline :root custom
// properties. Safe to call repeatedly (theme-reload event, activation).
export function resolveThemeColors(): void {
  try {
    var root = document.documentElement;

    var accent = firstColorVarBoth(ACCENT_CANDIDATES) || FALLBACK_ACCENT;
    var set = function (name: string, value: string) {
      root.style.setProperty(name, value);
    };

    // Accent family (all derived from the resolved accent)
    set('--luma-ssh-accent', rgba(accent, accent.a < 1 ? accent.a : 1));
    set('--luma-ssh-accent-dim', rgba(accent, 0.32));
    set('--luma-ssh-accent-glow', rgba(accent, 0.15));
    set('--luma-ssh-accent-strong', rgba(accent, 0.82));
    set('--luma-ssh-border', rgba(accent, 0.15));
    set('--luma-ssh-btn-bg', 'linear-gradient(180deg,' + shade(accent, 0.25) + ' 0%,' + rgba(accent, 0.95) + ' 100%)');
    set('--luma-ssh-btn-bg-hover', 'linear-gradient(180deg,' + shade(accent, 0.45) + ' 0%,' + shade(accent, 0.15) + ' 100%)');
    set('--luma-ssh-btn-bg-active', 'linear-gradient(180deg,' + rgba(accent, 0.95) + ' 0%,' + shade(accent, -0.25) + ' 100%)');
    set('--luma-ssh-btn-text', shade(accent, 0.85));
    set('--luma-ssh-progress-fill', 'linear-gradient(to right,' + shade(accent, -0.2) + ',' + rgba(accent, 0.9) + ')');

    // Alpha tints used across styles.ts: rgba(102,192,255,.NN) replacements
    // render as var(--luma-ssh-aNN, <default>) — define every referenced tint
    // so the accent theme colors all of them.
    var tints = ['05', '06', '08', '10', '12', '14', '15', '16', '18', '20', '25', '30', '32', '40', '50', '60', '82', '90'];
    for (var i = 0; i < tints.length; i++) {
      set('--luma-ssh-a' + tints[i], rgba(accent, parseInt(tints[i], 10) / 100));
    }

    // Panel background: adopt the theme's base surface so the panel matches
    // the active theme instead of the hardcoded navy gradient. Only dark
    // themes apply (light panels would clash with dark card/text defaults).
    var surface = firstColorVarBoth(SURFACE_CANDIDATES);
    if (surface && luminance(surface) < 0.5) {
      set('--luma-ssh-bg-panel', rgba(surface, 1));
      set('--luma-ssh-bg-panel-1', shade(surface, 0.06));   // gradient top (lighter)
      set('--luma-ssh-bg-panel-2', shade(surface, -0.18));  // gradient bottom (darker)
      set('--luma-ssh-bg-elevated', shade(surface, 0.04));  // header/footer/cards
    }
  } catch (e) {
    console.error('[LUMA_INJECT] resolveThemeColors:', e);
  }
}

// Debounced re-resolution on theme switches (the proxy dispatches this event
// after pushing a new CSS payload on theme-reload).
export function watchThemeReload(): void {
  var timer: any = null;
  document.addEventListener('lumaforge:theme-reload', function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      resolveThemeColors();
    }, 120);
  });
}
