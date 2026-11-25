// Packaging of the Candle Path modules for Doomscroll and Tab Graveyard (Requirements 10.9, 11).
// Every test works on a temporary repository copy; the real repository is only read.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APPS, REPO_ROOT, SITE, checkSite, main } from '../scripts/sync-skeleton.mjs';
import { validatePackage as validateDoomscroll } from '../scripts/validate-doomscroll-package.mjs';
import { validatePackage as validateGraveyard } from '../scripts/validate-graveyard-package.mjs';

const DOOM = APPS.doomscroll.dir;
const GRAVE = APPS.graveyard.dir;
const NEW_MODULES = ['skeleton/effects/ritual.js', 'skeleton/ritual/candle-path.js'];
const OTHER_DOOM_IDS = /doomscroll-(?:fog|flicker|rot|block)\b/;

const temps = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (temps.length) await fs.rm(temps.pop(), { recursive: true, force: true });
});

/** Temp repo: the whole root skeleton/ (with skeleton/test/) and each registered app folder without its test/. */
async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'haunt-pack-'));
  temps.push(root);
  await fs.cp(path.join(REPO_ROOT, 'skeleton'), path.join(root, 'skeleton'), { recursive: true });
  for (const { dir } of Object.values(APPS)) {
    const appRoot = path.join(REPO_ROOT, dir);
    const noTests = (src) => path.relative(appRoot, src).split(path.sep)[0] !== 'test';
    await fs.cp(appRoot, path.join(root, dir), { recursive: true, filter: noTests });
  }
  return root;
}

const abs = (root, rel) => path.join(root, ...rel.split('/'));
const put = async (root, rel, data) => {
  await fs.mkdir(path.dirname(abs(root, rel)), { recursive: true });
  await fs.writeFile(abs(root, rel), data);
};
const editJson = async (root, rel, fn) => {
  const doc = JSON.parse(await fs.readFile(abs(root, rel), 'utf8'));
  fn(doc);
  await fs.writeFile(abs(root, rel), JSON.stringify(doc, null, 2));
};

/** Every file under dir (no exclusions), as Map<posixRel, Buffer>. */
async function readTree(dir) {
  const out = new Map();
  async function rec(d, prefix) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await rec(path.join(d, e.name), rel);
      else out.set(rel, await fs.readFile(path.join(d, e.name)));
    }
  }
  await rec(dir, '');
  return out;
}

/** Run the Skeleton_Sync CLI entry in-process against root; returns { code, stderr }. */
async function run(args, root) {
  const lines = [];
  vi.spyOn(console, 'error').mockImplementation((...a) => { lines.push(a.join(' ')); });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const code = await main(args, root);
  vi.restoreAllMocks();
  return { code, stderr: lines.join('\n') };
}

describe('Generated_Skeletons', () => {
  // Haunt Kit invariant 17: Generated copies are exact
  it('build:skeletons makes every app copy equal the Skeleton byte for byte with no skeleton/test/ file', async () => {
    const root = await makeRepo();
    // Stale mirror content that the build must replace.
    await put(root, `${DOOM}/skeleton/effects/ritual.js`, 'stale\n');
    await fs.rm(abs(root, `${GRAVE}/skeleton/ritual/candle-path.js`));
    await put(root, `${GRAVE}/skeleton/test/leftover.test.js`, 'stale\n');

    const { code, stderr } = await run([], root);
    expect(stderr).toBe('');
    expect(code).toBe(0);

    const source = await readTree(abs(root, 'skeleton'));
    expect([...source.keys()].some((rel) => rel.startsWith('test/'))).toBe(true);
    const production = new Map([...source].filter(([rel]) => !rel.startsWith('test/')));
    for (const rel of NEW_MODULES) expect(production.has(rel.slice('skeleton/'.length))).toBe(true);

    for (const { dir } of Object.values(APPS)) {
      const target = await readTree(abs(root, `${dir}/skeleton`));
      expect([...target.keys()].sort(), dir).toEqual([...production.keys()].sort());
      for (const [rel, buf] of production) expect(buf.equals(target.get(rel)), `${dir}/skeleton/${rel}`).toBe(true);
    }

    expect((await run(['--check'], root)).code).toBe(0);
  });

  // Haunt Kit invariant 17: Generated copies are exact
  const DRIFT = [
    {
      name: 'one changed line in skeleton/effects/ritual.js',
      diagnostic: 'changed: effects/ritual.js',
      mutate: async (root, dir) => {
        const rel = `${dir}/skeleton/effects/ritual.js`;
        const lines = (await fs.readFile(abs(root, rel), 'utf8')).split('\n');
        lines[0] = `${lines[0]} // drift`;
        await fs.writeFile(abs(root, rel), lines.join('\n'));
      },
    },
    {
      name: 'a missing skeleton/ritual/candle-path.js',
      diagnostic: 'missing: ritual/candle-path.js',
      mutate: (root, dir) => fs.rm(abs(root, `${dir}/skeleton/ritual/candle-path.js`)),
    },
    {
      name: 'an extra file',
      diagnostic: 'extra:   effects/extra.js',
      mutate: (root, dir) => put(root, `${dir}/skeleton/effects/extra.js`, 'export const extra = 1;\n'),
    },
  ];
  for (const key of Object.keys(APPS)) {
    for (const { name, diagnostic, mutate } of DRIFT) {
      it(`check:skeletons fails and names the file for ${name} in ${key}`, async () => {
        const root = await makeRepo();
        expect((await run([], root)).code).toBe(0);
        await mutate(root, APPS[key].dir);
        const { code, stderr } = await run(['--check'], root);
        expect(code).not.toBe(0);
        expect(stderr).toContain(`${APPS[key].label} skeleton mirror is out of sync`);
        expect(stderr).toContain(diagnostic);
      });
    }
  }
});

describe('Playground copies (demo-site/skeleton/ and demo-site/presets/)', () => {
  const PRESETS = { 'doomscroll.json': DOOM, 'graveyard.json': GRAVE };

  // Haunt Kit invariant 17: Generated copies are exact
  it('the committed Playground copies are in sync in the real repository', async () => {
    const res = await checkSite(REPO_ROOT);
    expect(res.diagnostics).toEqual([]);
    expect(res.ok).toBe(true);
  });

  // Haunt Kit invariant 17: Generated copies are exact
  it('build:skeletons makes demo-site/skeleton/ equal the Skeleton and each Preset equal its app rules.json', async () => {
    const root = await makeRepo();
    // Stale content the build must replace.
    await put(root, `${SITE.dir}/skeleton/effects/ritual.js`, 'stale\n');
    await put(root, `${SITE.dir}/skeleton/test/leftover.test.js`, 'stale\n');
    await put(root, `${SITE.dir}/presets/doomscroll.json`, '[]\n');
    await put(root, `${SITE.dir}/index.html`, 'hand-written\n');

    const { code, stderr } = await run([], root);
    expect(stderr).toBe('');
    expect(code).toBe(0);

    const production = new Map([...(await readTree(abs(root, 'skeleton')))].filter(([rel]) => !rel.startsWith('test/')));
    const target = await readTree(abs(root, `${SITE.dir}/skeleton`));
    expect([...target.keys()].sort()).toEqual([...production.keys()].sort());
    for (const [rel, buf] of production) expect(buf.equals(target.get(rel)), `${SITE.dir}/skeleton/${rel}`).toBe(true);

    const presets = await readTree(abs(root, `${SITE.dir}/presets`));
    expect([...presets.keys()].sort()).toEqual(Object.keys(PRESETS).sort());
    for (const [file, dir] of Object.entries(PRESETS)) {
      const src = await fs.readFile(abs(root, `${dir}/rules.json`));
      expect(src.equals(presets.get(file)), file).toBe(true);
    }
    // Hand-written Playground files are left alone.
    expect(await fs.readFile(abs(root, `${SITE.dir}/index.html`), 'utf8')).toBe('hand-written\n');
    expect((await run(['--check'], root)).code).toBe(0);
  });

  // Haunt Kit invariant 17: Generated copies are exact
  const SITE_DRIFT = [
    {
      name: 'one changed line in the Playground skeleton/effects/ritual.js',
      diagnostic: 'changed: skeleton/effects/ritual.js',
      mutate: async (root) => {
        const rel = `${SITE.dir}/skeleton/effects/ritual.js`;
        const lines = (await fs.readFile(abs(root, rel), 'utf8')).split('\n');
        lines[0] = `${lines[0]} // drift`;
        await fs.writeFile(abs(root, rel), lines.join('\n'));
      },
    },
    {
      name: 'a missing Playground skeleton/ritual/candle-path.js',
      diagnostic: 'missing: skeleton/ritual/candle-path.js',
      mutate: (root) => fs.rm(abs(root, `${SITE.dir}/skeleton/ritual/candle-path.js`)),
    },
    {
      name: 'an extra file in the Playground skeleton',
      diagnostic: 'extra:   skeleton/effects/extra.js',
      mutate: (root) => put(root, `${SITE.dir}/skeleton/effects/extra.js`, 'export const extra = 1;\n'),
    },
    {
      name: 'a changed Graveyard preset',
      diagnostic: 'changed: presets/graveyard.json',
      mutate: (root) => editJson(root, `${SITE.dir}/presets/graveyard.json`, (doc) => { doc.rules[0].trigger.threshold = 1; }),
    },
    {
      name: 'a missing Doomscroll preset',
      diagnostic: 'missing: presets/doomscroll.json',
      mutate: (root) => fs.rm(abs(root, `${SITE.dir}/presets/doomscroll.json`)),
    },
    {
      name: 'a changed app rules.json without a rebuild',
      diagnostic: 'changed: presets/doomscroll.json',
      mutate: (root) => editJson(root, `${DOOM}/rules.json`, (doc) => { doc.rules[0].description = 'edited'; }),
    },
  ];
  for (const { name, diagnostic, mutate } of SITE_DRIFT) {
    it(`check:skeletons fails and names the file for ${name}`, async () => {
      const root = await makeRepo();
      expect((await run([], root)).code).toBe(0);
      await mutate(root);
      const { code, stderr } = await run(['--check'], root);
      expect(code).not.toBe(0);
      expect(stderr).toContain(`${SITE.label} copies are out of sync (run: npm run build:skeletons):`);
      expect(stderr).toContain(diagnostic);
    });
  }
});

describe('Doomscroll Package_Validator', () => {
  const RULES = `${DOOM}/rules.json`;
  const MANIFEST = `${DOOM}/manifest.json`;
  const fifth = (fn) => (doc) => fn(doc.rules.find((r) => r.id === 'doomscroll-ritual'));

  // Haunt Kit invariant 18: Package validators report exactly the broken rule
  it('is ok on the unmutated copy', async () => {
    const root = await makeRepo();
    const res = await validateDoomscroll(root);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  // Haunt Kit invariant 18: Package validators report exactly the broken rule
  const RULE_MUTATIONS = [
    ['the fifth rule missing', (doc) => { doc.rules = doc.rules.filter((r) => r.id !== 'doomscroll-ritual'); }],
    ['id changed', fifth((r) => { r.id = 'doomscroll-candles'; })],
    ['enabled false', fifth((r) => { r.enabled = false; })],
    ['match missing a host', fifth((r) => { r.match = r.match.slice(0, 2); })],
    ['match reordered', fifth((r) => { r.match = [...r.match].reverse(); })],
    ['trigger meter changed', fifth((r) => { r.trigger.meter = 'scrollDistance'; })],
    ['trigger threshold changed', fifth((r) => { r.trigger.threshold = 1400; })],
    ['trigger rampTo added', fifth((r) => { r.trigger.rampTo = 1800; })],
    ['effect type changed', fifth((r) => { r.effect.type = 'block'; })],
    ['params.size changed', fifth((r) => { r.effect.params.size = 6; })],
    ['params.candles changed', fifth((r) => { r.effect.params.candles = 4; })],
    ['params.sound changed', fifth((r) => { r.effect.params.sound = true; })],
    ['params extra key', fifth((r) => { r.effect.params.heading = 'Light them'; })],
    ['undo mode changed', fifth((r) => { r.undo = { mode: 'instant' }; })],
    ['undo durationMs changed', fifth((r) => { r.undo.durationMs = 400; })],
  ];
  for (const [name, mutate] of RULE_MUTATIONS) {
    it(`reports an error naming rules.json and doomscroll-ritual for ${name}`, async () => {
      const root = await makeRepo();
      await editJson(root, RULES, mutate);
      const res = await validateDoomscroll(root);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.startsWith('rules.json:') && e.includes('doomscroll-ritual')), res.errors.join('\n')).toBe(true);
      for (const e of res.errors) {
        expect(e.startsWith('rules.json:'), e).toBe(true);
        if (!/ids\/order/.test(e)) expect(e, 'only the broken rule is named').not.toMatch(OTHER_DOOM_IDS);
      }
    });
  }

  it('names the trigger gap for an added rampTo', async () => {
    const root = await makeRepo();
    await editJson(root, RULES, fifth((r) => { r.trigger.rampTo = 1800; }));
    const { errors } = await validateDoomscroll(root);
    expect(errors).toContain('rules.json: doomscroll-ritual: trigger must be timeOnSite 1500 with no rampTo');
  });

  // Haunt Kit invariant 18: Package validators report exactly the broken rule
  for (const mod of NEW_MODULES) {
    it(`reports ${mod} missing from web_accessible_resources`, async () => {
      const root = await makeRepo();
      await editJson(root, MANIFEST, (m) => {
        m.web_accessible_resources[0].resources = m.web_accessible_resources[0].resources.filter((r) => r !== mod);
      });
      const res = await validateDoomscroll(root);
      expect(res.ok).toBe(false);
      expect(res.errors).toEqual([`manifest.json: web_accessible_resources is missing ${mod}`]);
    });
  }
});

describe('Tab Graveyard Package_Validator', () => {
  // Haunt Kit invariant 18: Package validators report exactly the broken rule
  it('is ok on the unmutated copy', async () => {
    const root = await makeRepo();
    const res = await validateGraveyard(root);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  // Haunt Kit invariant 18: Package validators report exactly the broken rule
  it('reports skeleton/effects/ritual.js missing from web_accessible_resources', async () => {
    const root = await makeRepo();
    await editJson(root, `${GRAVE}/manifest.json`, (m) => {
      m.web_accessible_resources[0].resources = m.web_accessible_resources[0].resources.filter((r) => r !== 'skeleton/effects/ritual.js');
    });
    const res = await validateGraveyard(root);
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual(['manifest.json: web_accessible_resources is missing skeleton/effects/ritual.js']);
  });
});

describe('rule-schema.json ritual documentation', () => {
  // Defaults and ranges from Requirement 5 criterion 5 and Requirement 4 criterion 5.
  const PARAMS = {
    heading: { type: 'string', minLength: 1, maxLength: 200, default: 'Light the candles to banish the ghost' },
    instructions: { type: 'string', minLength: 1, maxLength: 300, default: 'Draw one path through every square, passing the candles in order. Candle N must be your last square. Drag back to undo.' },
    size: { type: 'integer', minimum: 3, maximum: 7, default: 5 },
    candles: { type: 'integer', minimum: 2, maximum: 9, default: 5 },
    sound: { type: 'boolean', default: false },
    maxOpacity: { type: 'number', minimum: 0, maximum: 1, default: 0.96 },
    blockAt: { type: 'number', minimum: 0, maximum: 1, default: 1 },
  };

  it('documents every ritual param with its default and range, and keeps effect.type a plain string', async () => {
    const schema = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'skeleton', 'rule-schema.json'), 'utf8'));
    expect(schema.definitions.rule.properties.effect.properties.type).toEqual({ type: 'string' });

    const def = schema.definitions['params-ritual'];
    expect(def.type).toBe('object');
    expect(typeof def.description).toBe('string');
    expect(def.description.length).toBeGreaterThan(0);
    expect(Object.keys(def.properties).sort()).toEqual(Object.keys(PARAMS).sort());

    for (const [name, exp] of Object.entries(PARAMS)) {
      const p = def.properties[name];
      const { description, ...keywords } = p;
      expect(keywords, name).toEqual(exp);
      expect(typeof description, name).toBe('string');
      const shownDefault = exp.type === 'string' ? `Default "${exp.default}"` : `Default ${exp.default}`;
      expect(description, name).toContain(shownDefault);
      const [lo, hi] = exp.type === 'string' ? [exp.minLength, exp.maxLength] : [exp.minimum, exp.maximum];
      if (lo !== undefined) expect(description, name).toContain(`${lo} to ${hi}`);
    }
  });
});
