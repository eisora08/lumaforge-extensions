// Fails the build when version metadata drifts apart.
// Sources of truth: extensions/steam-store-helper/manifest.json.
//
//   npm run versions:check
//
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = 'extensions/steam-store-helper';

const errors = [];

function read(rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

const manifest = readJson(`${EXT}/manifest.json`);
const version = manifest.version;
if (!version) {
  errors.push(`${EXT}/manifest.json has no "version"`);
}

// 1. extension.lua must declare the same version.
const extensionLua = read(`${EXT}/extension.lua`);
const luaVersion = (extensionLua.match(/^\s*version\s*=\s*"([^"]+)"/m) || [])[1];
if (luaVersion !== version) {
  errors.push(`extension.lua version "${luaVersion}" != manifest.json "${version}"`);
}

// 2. index.json must declare the same version for every extension, and every
//    manifestUrl must actually exist (an index entry pointing at a deleted
//    extension installs a broken package).
const index = readJson('index.json');
for (const ext of index.extensions || []) {
  if (ext.id === manifest.id && ext.version !== version) {
    errors.push(`index.json version "${ext.version}" != manifest.json "${version}" (id: ${ext.id})`);
  }
  if (ext.manifestUrl && !existsSync(resolve(root, ext.manifestUrl))) {
    errors.push(`index.json manifestUrl does not exist: ${ext.manifestUrl}`);
  }
}
if (!(index.extensions || []).some((e) => e.id === manifest.id)) {
  errors.push(`index.json is missing an entry for "${manifest.id}"`);
}

// 3. README table must list the same version, and must not reference
//    extensions that were removed from the repository.
const readme = read('README.md');
const readmeVersion = (readme.match(new RegExp(`\`${manifest.id}\`\\s*\\|\\s*([^|\\s]+)`)) || [])[1];
if (readmeVersion !== version) {
  errors.push(`README.md version "${readmeVersion}" != manifest.json "${version}"`);
}
for (const ext of index.extensions || []) {
  if (new RegExp(ext.id, 'i').test(readme) === false && ext.id === manifest.id) {
    errors.push(`README.md has no row for "${ext.id}"`);
  }
}
const removedIds = ['opensteamtool'];
for (const id of removedIds) {
  if (new RegExp(id, 'i').test(readme)) {
    errors.push(`README.md still references removed extension "${id}"`);
  }
}

// 4. Runtime version constants must come from the build-time injection, never
//    from a hardcoded literal (that is how the badge went stale before).
const stateTs = read(`${EXT}/src/core/state.ts`);
if (!stateTs.includes('__LUMA_VERSION__')) {
  errors.push('src/core/state.ts must derive LUMA_INJECT_VERSION from __LUMA_VERSION__');
}
if (/LUMA_INJECT_VERSION\s*=\s*['"]/.test(stateTs)) {
  errors.push('src/core/state.ts hardcodes LUMA_INJECT_VERSION instead of using __LUMA_VERSION__');
}
const sidebarTs = read(`${EXT}/src/sidebar/SidebarPanel.ts`);
if (!sidebarTs.includes('var LUMA_VERSION = __LUMA_VERSION__;')) {
  errors.push('src/sidebar/SidebarPanel.ts must derive LUMA_VERSION from __LUMA_VERSION__');
}

if (errors.length) {
  console.error('Version check FAILED:\n');
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`\nmanifest.json version: ${version}`);
  process.exit(1);
}

console.log(`Version check OK — all sources agree on ${version}`);
