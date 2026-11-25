// Generic_Validator for apps created by scripts/new-haunt.mjs. Build/test-time only; nothing here ships.
// Called by scripts/sync-skeleton.mjs as validatePackage(repoRoot, { key, ...registryEntry }).
// Checks Requirement 12 criteria 5, 6 and 10. Never writes.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateRules, builtinEffects } from '../skeleton/index.js';
import { isValidPattern } from '../skeleton/match.js';
import { REPO_ROOT } from './sync-skeleton.mjs';
import { resolveGraph, expandWar, scanSource, walk, stripJsComments } from './package-checks.mjs';

export const MAX_HOSTS = 20;
const ALLOWED_SCHEMES = new Set(['http', 'https', '*']);

/** DOM lookups that would tie content.js to a site's markup. */
export const SELECTOR_APIS = Object.freeze([
  'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName',
  'getElementsByTagName', 'getElementsByName', 'closest(',
]);

/** A host pattern a Generated_App may use: a valid match pattern on http, https or *. */
export function isAllowedHost(pattern) {
  if (!isValidPattern(pattern)) return false;
  return ALLOWED_SCHEMES.has(pattern.split('://')[0]);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b)
  && same([...new Set(a)].sort(), [...new Set(b)].sort());

/** Returns the hosts (host_permissions) when they are valid, else null; pushes one error when invalid. */
function checkHosts(m, errors) {
  const hosts = m.host_permissions;
  if (!Array.isArray(hosts) || hosts.length < 1 || hosts.length > MAX_HOSTS || !hosts.every(isAllowedHost)) {
    errors.push(`manifest.json: host_permissions must be 1 to ${MAX_HOSTS} http, https or * match patterns`);
    return null;
  }
  return hosts;
}

export function validateManifestDocument(m, { allFiles = [], reachable = new Set() } = {}) {
  const errors = [];
  const at = 'manifest.json';
  if (!isObj(m)) return { errors: [`${at}: must be an object`], hosts: null };
  if (m.manifest_version !== 3) errors.push(`${at}: manifest_version must be 3`);
  if (!nonEmptyString(m.name)) errors.push(`${at}: name is required`);
  if (!nonEmptyString(m.version)) errors.push(`${at}: version is required`);
  if (!same(m.permissions, ['storage'])) errors.push(`${at}: permissions must be exactly ["storage"]`);
  const hosts = checkHosts(m, errors);
  if (!isObj(m.background) || m.background.service_worker !== 'background.js' || m.background.type !== 'module') {
    errors.push(`${at}: background must be the module worker background.js`);
  }
  if (!isObj(m.action) || m.action.default_popup !== 'popup.html') errors.push(`${at}: action.default_popup must be popup.html`);

  const cs = m.content_scripts;
  if (!Array.isArray(cs) || cs.length !== 1 || !isObj(cs[0])) errors.push(`${at}: exactly one content script is required`);
  else {
    const c = cs[0];
    if (hosts && !same(c.matches, hosts)) errors.push(`${at}: content_scripts[0].matches must equal host_permissions`);
    if (!same(c.js, ['content.js'])) errors.push(`${at}: content_scripts[0].js must be ["content.js"]`);
    if (c.run_at !== 'document_idle') errors.push(`${at}: content script must run at document_idle`);
    if (c.all_frames !== false) errors.push(`${at}: content script must set all_frames false`);
    if (c.type !== undefined || c.module !== undefined || (c.world !== undefined && c.world !== 'ISOLATED')) {
      errors.push(`${at}: content script must be a classic script in the isolated world`);
    }
  }

  const war = m.web_accessible_resources;
  if (!Array.isArray(war) || war.length !== 1 || !isObj(war[0])) errors.push(`${at}: exactly one web_accessible_resources entry is required`);
  else {
    if (hosts && !same(war[0].matches, hosts)) errors.push(`${at}: web_accessible_resources matches must equal host_permissions`);
    if (war[0].use_dynamic_url !== false) errors.push(`${at}: web_accessible_resources must set use_dynamic_url false`);
    const exposed = expandWar(m, allFiles);
    const expected = new Set(['rules.json', ...reachable]);
    for (const f of exposed) if (!expected.has(f)) errors.push(`${at}: web_accessible_resources exposes unexpected resource ${f}`);
    for (const f of expected) if (!exposed.has(f)) errors.push(`${at}: web_accessible_resources is missing ${f}`);
  }
  return { errors, hosts };
}

const isStarter = (r, type) => isObj(r) && isObj(r.effect) && r.effect.type === type && isObj(r.trigger)
  && r.trigger.meter === 'timeOnSite' && typeof r.trigger.threshold === 'number'
  && typeof r.trigger.rampTo === 'number' && r.trigger.rampTo > r.trigger.threshold;

/** hosts is the validated host_permissions, or null when the manifest gave none. */
export function validateRulesDocument(doc, hosts) {
  const errors = [];
  const res = validateRules(doc, builtinEffects);
  if (!res.valid) for (const e of res.errors) errors.push(`rules.json: schema: ${e}`);
  const rules = isObj(doc) && Array.isArray(doc.rules) ? doc.rules : null;
  if (!rules) return [...errors, 'rules.json: must be an object with a rules array'];
  if (hosts) {
    rules.forEach((r, i) => {
      if (!sameSet(r?.match, hosts)) errors.push(`rules.json: ${r?.id ?? `rules[${i}]`}: match must be the hosts in host_permissions`);
    });
  }
  for (const type of ['fog', 'rot']) {
    if (!rules.some((r) => isStarter(r, type))) errors.push(`rules.json: needs a ${type} rule on timeOnSite with rampTo greater than threshold`);
  }
  return errors;
}

/** content.js must not look up site DOM. Returns at most one error line. */
export function checkContentSelectors(src) {
  const code = stripJsComments(src);
  const found = SELECTOR_APIS.filter((api) => (api.endsWith('(')
    ? new RegExp(`\\b${api.slice(0, -1)}\\s*\\(`).test(code)
    : new RegExp(`\\b${api}\\b`).test(code)));
  return found.length ? [`content.js: site DOM selectors are not allowed (${found.join(', ')})`] : [];
}

/**
 * Validate a Generated_App. Never writes. Returns { ok, errors } with one line per failed rule.
 * `app` is the registry entry plus `key`; only `app.dir` is required.
 */
export async function validatePackage(repoRoot = REPO_ROOT, app) {
  if (!isObj(app) || !nonEmptyString(app.dir)) {
    return { ok: false, errors: ['validate-app-package: an app entry with dir is required'] };
  }
  const errors = [];
  const appRoot = path.join(repoRoot, app.dir);

  let paths = new Map();
  try { paths = await walk(appRoot); } catch (e) {
    return { ok: false, errors: [`.: cannot read app folder ${app.dir} (${e.message})`] };
  }
  const allFiles = [...paths.keys()].sort();
  const read = (rel) => fs.readFile(paths.get(rel), 'utf8');
  const readJson = async (rel) => {
    if (!paths.has(rel)) { errors.push(`${rel}: missing`); return undefined; }
    try { return JSON.parse(await read(rel)); } catch (e) { errors.push(`${rel}: cannot parse JSON (${e.message})`); return undefined; }
  };

  const manifest = await readJson('manifest.json');
  const rules = await readJson('rules.json');

  const skeletonSources = new Map();
  for (const rel of allFiles) if (rel.startsWith('skeleton/') && rel.endsWith('.js')) skeletonSources.set(rel, await read(rel));
  const graph = resolveGraph(skeletonSources, 'skeleton/index.js');
  errors.push(...graph.errors);

  // App-owned ES modules: check their static imports too (bare, absolute, remote, escaping).
  const appSources = new Map();
  for (const rel of allFiles) if (!rel.startsWith('test/') && /\.m?js$/.test(rel)) appSources.set(rel, skeletonSources.get(rel) ?? await read(rel));
  for (const entry of ['background.js', 'popup.js']) {
    if (appSources.has(entry)) errors.push(...resolveGraph(appSources, entry).errors);
  }

  let hosts = null;
  if (manifest !== undefined) {
    const res = validateManifestDocument(manifest, { allFiles, reachable: graph.reachable });
    errors.push(...res.errors);
    hosts = res.hosts;
  }
  if (rules !== undefined) errors.push(...validateRulesDocument(rules, hosts));

  for (const rel of allFiles) {
    if (rel.startsWith('skeleton/') || rel.startsWith('test/')) continue;
    if (!/\.(?:m?js|html?)$/i.test(rel)) continue;
    errors.push(...scanSource(rel, await read(rel)));
  }
  if (paths.has('content.js')) errors.push(...checkContentSelectors(await read('content.js')));
  else errors.push('content.js: missing');

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}
