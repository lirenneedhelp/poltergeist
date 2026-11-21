// Package Validator for app1-doomscroll. Build/test-time only; nothing here ships in the extension.
//   node scripts/validate-doomscroll-package.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRules, builtinEffects } from '../skeleton/index.js';
import { check as checkMirror, REPO_ROOT } from './sync-doomscroll-skeleton.mjs';
import { stripJsComments, extractStaticSpecifiers, resolveGraph, expandWar, scanSource, walk } from './package-checks.mjs';

// Re-exported so existing importers of this module keep working.
export { stripJsComments, extractStaticSpecifiers, resolveGraph, expandWar, scanSource };

export const HOSTS = Object.freeze([
  'https://www.youtube.com/*',
  'https://x.com/*',
  'https://www.instagram.com/*',
]);

const MESSAGE = 'You have scrolled long enough. Close this tab and take a break.';

/** Exact expected rules (id, order, meter values, params, undo). */
export const EXPECTED_RULES = Object.freeze([
  { id: 'doomscroll-fog', threshold: 120, rampTo: 300, type: 'fog', params: { maxBlur: 5, maxGrayscale: 0.8, tint: '#9eb2a4', noise: 0.6, mist: 0.5, driftMs: 20000 }, undo: { mode: 'fade', durationMs: 400 } },
  { id: 'doomscroll-flicker', threshold: 300, rampTo: 600, type: 'flicker', params: { maxDepth: 0.22, periodMs: 1600 }, undo: { mode: 'instant' } },
  { id: 'doomscroll-rot', threshold: 600, rampTo: 900, type: 'rot', params: { maxFraction: 0.55, glyphs: '▓▒░█' }, undo: { mode: 'instant' } },
  { id: 'doomscroll-block', threshold: 1200, rampTo: 1500, type: 'block', params: { maxOpacity: 0.96, blockAt: 0.8, message: MESSAGE, detail: 'You lost {duration} to this feed.', durationMeter: 'timeOnSite', figure: 'ghost', fadeInMs: 1500 }, undo: { mode: 'fade', durationMs: 600 } },
]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedSame = (a, b) => Array.isArray(a) && same([...a].sort(), [...b].sort()) && new Set(a).size === a.length;
const sameKeys = (a, b) => a !== null && typeof a === 'object' && same(Object.keys(a).sort(), Object.keys(b).sort());
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateRulesDocument(doc) {
  const errors = [];
  const res = validateRules(doc, builtinEffects);
  if (!res.valid) for (const e of res.errors) errors.push(`rules.json: schema: ${e}`);
  const rules = isObj(doc) && Array.isArray(doc.rules) ? doc.rules : null;
  if (!rules) return [...errors, 'rules.json: must be an object with a rules array'];
  if (!same(rules.map((r) => r?.id), EXPECTED_RULES.map((r) => r.id))) {
    errors.push(`rules.json: rule ids/order must be ${EXPECTED_RULES.map((r) => r.id).join(', ')}`);
  }
  EXPECTED_RULES.forEach((exp, i) => {
    const r = rules[i];
    if (!isObj(r) || r.id !== exp.id) return;
    const at = `rules.json: ${exp.id}`;
    if (r.enabled !== true) errors.push(`${at}: enabled must be true`);
    if (!sortedSame(r.match, HOSTS) || !same(r.match, HOSTS)) errors.push(`${at}: match must be exactly the approved hosts`);
    if (!same(r.trigger, { meter: 'timeOnSite', threshold: exp.threshold, rampTo: exp.rampTo })) errors.push(`${at}: trigger must be timeOnSite ${exp.threshold}->${exp.rampTo}`);
    if (!isObj(r.effect) || r.effect.type !== exp.type || !same(r.effect.params, exp.params)) errors.push(`${at}: effect type/params differ from expected`);
    if (!same(r.undo, exp.undo)) errors.push(`${at}: undo must be ${JSON.stringify(exp.undo)}`);
  });
  return errors;
}

export function validateManifestDocument(m, { allFiles = [], reachable = new Set() } = {}) {
  const errors = [];
  const at = 'manifest.json';
  if (!isObj(m)) return [`${at}: must be an object`];
  if (m.manifest_version !== 3) errors.push(`${at}: manifest_version must be 3`);
  if (!same(m.permissions, ['storage'])) errors.push(`${at}: permissions must be exactly ["storage"]`);
  if (!same(m.host_permissions, HOSTS)) errors.push(`${at}: host_permissions must be exactly the approved hosts`);
  if (!isObj(m.background) || m.background.service_worker !== 'background.js' || m.background.type !== 'module' || !sameKeys(m.background, { service_worker: 0, type: 0 })) {
    errors.push(`${at}: background must be the module worker background.js`);
  }
  if (!isObj(m.action) || m.action.default_popup !== 'popup.html') errors.push(`${at}: action.default_popup must be popup.html`);
  const cs = m.content_scripts;
  if (!Array.isArray(cs) || cs.length !== 1) errors.push(`${at}: exactly one content script is required`);
  else {
    const c = cs[0];
    if (!same(c.matches, HOSTS)) errors.push(`${at}: content_scripts[0].matches must be exactly the approved hosts`);
    if (!same(c.js, ['content.js'])) errors.push(`${at}: content_scripts[0].js must be ["content.js"]`);
    if (c.run_at !== 'document_idle') errors.push(`${at}: content script must run at document_idle`);
    if (c.all_frames !== false) errors.push(`${at}: content script must be top frame only (all_frames false)`);
    if (c.world !== undefined && c.world !== 'ISOLATED') errors.push(`${at}: content script must use the isolated world`);
    if (c.type !== undefined || c.module !== undefined) errors.push(`${at}: content script must be classic`);
    if (c.css !== undefined || c.exclude_matches !== undefined || c.include_globs !== undefined || c.match_about_blank !== undefined) errors.push(`${at}: unexpected content script fields`);
  }
  for (const key of ['externally_connectable', 'optional_permissions', 'optional_host_permissions', 'content_security_policy', 'sandbox']) {
    if (m[key] !== undefined) errors.push(`${at}: ${key} is not allowed`);
  }
  const war = m.web_accessible_resources;
  if (!Array.isArray(war) || war.length !== 1) errors.push(`${at}: exactly one web_accessible_resources entry is required`);
  else {
    if (!same(war[0].matches, HOSTS)) errors.push(`${at}: web_accessible_resources matches must be exactly the approved hosts`);
    if (war[0].use_dynamic_url !== false) errors.push(`${at}: web_accessible_resources must set use_dynamic_url false for content-script import/fetch compatibility`);
    if (war[0].extension_ids !== undefined) errors.push(`${at}: web_accessible_resources must not set extension_ids`);
  }
  const exposed = expandWar(m, allFiles);
  const expected = new Set([...reachable, 'rules.json']);
  for (const f of exposed) {
    if (!expected.has(f)) errors.push(`${at}: web_accessible_resources exposes unexpected resource ${f}${/(^|\/)test\//.test(f) ? ' (test file)' : ''}`);
  }
  for (const f of expected) if (!exposed.has(f)) errors.push(`${at}: web_accessible_resources is missing ${f}`);
  return errors;
}

/** Validate app1-doomscroll under repoRoot. Never writes. Returns { ok, errors }. */
export async function validatePackage(repoRoot = REPO_ROOT) {
  const errors = [];
  const appRoot = path.join(repoRoot, 'app1-doomscroll');
  const readJson = async (name) => {
    try { return JSON.parse(await fs.readFile(path.join(appRoot, name), 'utf8')); }
    catch (e) { errors.push(`${name}: cannot read/parse JSON (${e.message})`); return undefined; }
  };
  const manifest = await readJson('manifest.json');
  const rules = await readJson('rules.json');
  if (rules !== undefined) errors.push(...validateRulesDocument(rules));

  let paths = new Map();
  try { paths = await walk(appRoot); } catch (e) { errors.push(`app1-doomscroll: cannot read (${e.message})`); }
  const allFiles = [...paths.keys()].sort();

  const jsSources = new Map();
  for (const [rel, abs] of paths) if (rel.startsWith('skeleton/') && rel.endsWith('.js')) jsSources.set(rel, await fs.readFile(abs, 'utf8'));
  const graph = resolveGraph(jsSources, 'skeleton/index.js');
  errors.push(...graph.errors);
  if (manifest !== undefined) errors.push(...validateManifestDocument(manifest, { allFiles, reachable: graph.reachable }));

  for (const [rel, abs] of paths) {
    if (rel.startsWith('skeleton/') || rel.startsWith('test/')) continue;
    if (!/\.(?:m?js|html?)$/i.test(rel)) continue;
    errors.push(...scanSource(rel, await fs.readFile(abs, 'utf8')));
  }

  const mirror = await checkMirror(repoRoot);
  for (const d of mirror.diagnostics) errors.push(`skeleton mirror: ${d}`);
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validatePackage().then(({ ok, errors }) => {
    if (!ok) for (const e of errors) console.error(e);
    else console.log('Doomscroll package is valid.');
    process.exitCode = ok ? 0 : 1;
  });
}
