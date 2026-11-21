// @vitest-environment jsdom
// haunt-polish Requirement 5: rules shared by every new visual in Fog, Block, and Tombstone.
// Example-based only (Requirement 9.1). Motion is observed through the animate spy (Requirement 9.8).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fog from '../effects/fog.js';
import * as block from '../effects/block.js';
import * as tombstone from '../effects/tombstone.js';
import { installAnimateSpy, makeEnv } from './polish-helpers.js';

const PAGE = '<head><title>Lecture 4 notes</title></head><body><h1>Headline text</h1><p>Some paragraph of text here.</p></body>';
const EFFECTS = { fog, block, tombstone };
const SVG_NS = 'http://www.w3.org/2000/svg';
const DETAIL = 'You lost {duration} to this feed.';

const snap = () => ({
  html: document.documentElement.outerHTML,
  htmlStyle: document.documentElement.getAttribute('style'),
  bodyStyle: document.body ? document.body.getAttribute('style') : null,
});

const attrs = (el) => Array.from(el.attributes, (a) => [a.name, a.value]);
const sheets = () => (document.adoptedStyleSheets ? [...document.adoptedStyleSheets] : []);

/** Every element in the light DOM and in every (nested) open shadow root. */
function allElements(root = document) {
  const out = [];
  const visit = (node) => {
    for (const el of node.querySelectorAll('*')) {
      out.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return out;
}

// Meter values that make every duration param visible in the rendered text.
const readMeter = (name) => ({ timeOnSite: 20, timeAway: 33, scrollDistance: 999999 })[name];

let spy;
let live;
/** Remember a handle so afterEach can undo it if a test fails part-way. */
const track = (fx, h) => {
  live.push([fx, h]);
  return h;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = PAGE;
  document.documentElement.removeAttribute('style');
  spy = installAnimateSpy();
  live = [];
});
afterEach(() => {
  for (const [fx, h] of live) fx.undo(h, { durationMs: 0 });
  spy.restore();
  vi.useRealTimers();
});

describe('source scan of fog.js, block.js, and tombstone.js (Requirements 5.2, 5.3, 7.11)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const FORBIDDEN = [
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'DOMParser',
    'createContextualFragment',
    'document.write',
    'url(',
    'image-set(',
    '@import',
    '@font-face',
  ];

  it.each(['fog.js', 'block.js', 'tombstone.js'])('%s uses no HTML parsing and loads no resource', (file) => {
    const src = readFileSync(resolve(here, '../effects', file), 'utf8');
    for (const token of FORBIDDEN) expect(src.includes(token), `${file} contains ${token}`).toBe(false);
    const all = src.split(SVG_NS).length - 1;
    const asNamespaceArg = src.split(`createElementNS('${SVG_NS}'`).length - 1;
    expect(asNamespaceArg).toBe(all);
  });
});

describe('DOM scan after apply (Requirements 5.1, 5.2)', () => {
  it.each([false, true])('adds only effect hosts, no resources, and leaves head and body untouched (reducedMotion=%s)', (reducedMotion) => {
    const env = makeEnv({ readMeter, reducedMotion });
    const html = document.documentElement;
    const headBefore = document.head.outerHTML;
    const bodyBefore = document.body.outerHTML;
    const htmlAttrs = attrs(html);
    const bodyAttrs = attrs(document.body);
    const sheetsBefore = sheets();
    const childrenBefore = [...html.children];

    track(fog, fog.apply(env, {}, 1));
    track(block, block.apply(env, { detail: DETAIL }, 1));
    track(tombstone, tombstone.apply(env, {}, 1));

    expect(document.head.outerHTML).toBe(headBefore);
    expect(document.body.outerHTML).toBe(bodyBefore);
    expect(attrs(html)).toEqual(htmlAttrs);
    expect(attrs(document.body)).toEqual(bodyAttrs);
    expect(sheets()).toEqual(sheetsBefore);

    const added = [...html.children].filter((el) => !childrenBefore.includes(el));
    expect(added.map((el) => el.getAttribute('data-poltergeist')).sort()).toEqual(['block', 'fog', 'tombstone']);

    const elements = allElements();
    for (const el of elements) {
      expect(['img', 'image']).not.toContain(el.localName);
      for (const a of el.attributes) {
        expect(['href', 'src']).not.toContain(a.localName);
        expect(a.value.toLowerCase()).not.toContain('url(');
        expect(a.value.toLowerCase()).not.toContain('image-set(');
      }
      if (el.localName === 'style') {
        expect(el.textContent).not.toMatch(/url\(|image-set\(|@import|@font-face/i);
      }
    }
    // The shadow content was actually scanned: the ghost svg and the tombstone h1 are present.
    expect(elements.some((el) => el.localName === 'svg')).toBe(true);
    expect(elements.some((el) => el.localName === 'h1' && el.getRootNode() !== document)).toBe(true);
  });
});

/** A comparable picture of what an effect rendered: its DOM plus every animate() call. */
function blockPicture(h) {
  return {
    light: h.el.outerHTML,
    shadow: h.el.shadowRoot.innerHTML,
    anims: spy.calls.map((c) => ({ tag: c.target.localName, keyframes: c.keyframes, options: c.options })),
  };
}
function tombstonePicture(h) {
  return {
    light: h.host.outerHTML,
    shadow: h.host.shadowRoot.innerHTML,
    anims: spy.calls.map((c) => ({ tag: c.target.localName, keyframes: c.keyframes, options: c.options })),
  };
}
function fogPicture(h) {
  return {
    light: h.el.outerHTML,
    anims: spy.calls.map((c) => ({ keyframes: c.keyframes, options: c.options })),
  };
}

/** Render with params, take the picture, undo, and reset the spy. */
function render(fx, picture, params) {
  const env = makeEnv({ readMeter });
  const h = fx.apply(env, params, 0.9);
  const pic = picture(h);
  fx.undo(h, { durationMs: 0 });
  spy.calls.length = 0;
  return pic;
}

const BAD_SCALES = [null, 0, -1, '60', NaN, Infinity];
const BAD_STRINGS = [null, 5, true, {}];

describe('invalid values of the new params render like the default (Requirement 5.6)', () => {
  const cases = [
    ['block', block, blockPicture, {}, 'figure', [null, 'skull', 5, '']],
    ['block', block, blockPicture, {}, 'detail', BAD_STRINGS],
    ['block', block, blockPicture, { detail: DETAIL }, 'durationMeter', BAD_STRINGS],
    ['block', block, blockPicture, {}, 'fadeInMs', [null, -1, 20000, NaN, Infinity, '400']],
    ['block', block, blockPicture, { detail: DETAIL }, 'durationScale', BAD_SCALES],
    ['block', block, blockPicture, { detail: DETAIL }, 'durationSuffix', BAD_STRINGS],
    ['tombstone', tombstone, tombstonePicture, {}, 'weathered', [null, 'false', 0, 1]],
    ['tombstone', tombstone, tombstonePicture, {}, 'mark', BAD_STRINGS],
    ['tombstone', tombstone, tombstonePicture, {}, 'riseInMs', [null, -1, 20000, NaN, '300']],
    ['tombstone', tombstone, tombstonePicture, {}, 'durationScale', BAD_SCALES],
    ['tombstone', tombstone, tombstonePicture, {}, 'durationSuffix', BAD_STRINGS],
    ['fog', fog, fogPicture, {}, 'tint', [null, 5, true, {}]],
    ['fog', fog, fogPicture, {}, 'noise', [null, -0.1, 1.5, NaN, '0.5']],
    ['fog', fog, fogPicture, {}, 'driftMs', [null, -1, 500, 999, 700000, NaN, '5000']],
  ];

  it.each(cases.map(([name, fx, picture, base, param, values]) => [`${name} ${param}`, fx, picture, base, param, values]))(
    '%s', (_label, fx, picture, base, param, values) => {
    const expected = render(fx, picture, base);
    for (const value of values) {
      const params = Object.freeze({ ...base, [param]: value });
      const actual = render(fx, picture, params);
      expect(actual, `${param} = ${String(value)}`).toEqual(expected);
    }
    },
  );

  it('the default pictures show the defaults these cases compare against', () => {
    const b = render(block, blockPicture, { detail: DETAIL });
    expect(b.shadow).toContain('<svg');
    expect(b.shadow).toContain('You lost 20 seconds to this feed.');
    expect(b.anims.map((a) => a.options.duration)).toEqual([1500, 1500, 1500]);
    const t = render(tombstone, tombstonePicture, {});
    expect(t.shadow).toContain('R.I.P.');
    expect(t.shadow).toContain('Abandoned for 33 seconds.');
    expect(t.shadow).toContain('gradient(');
    expect(t.anims.map((a) => a.options.duration)).toEqual([800]);
    const f = render(fog, fogPicture, {});
    expect(f.light).toContain('background-color: rgb(158, 178, 164)');
    expect(f.anims.map((a) => a.options.duration)).toEqual([20000]);
  });
});

describe('hostile tint values (Requirements 5.4, 5.10)', () => {
  const HOSTILE = ['red;background:url(https://example.com/x.png)', 'var(--x)', 'u\\rl(x)', '{}', 'VAR(--x)', 'attr(title)', 'env(x)'];

  it.each(HOSTILE)('%s gives no tint layer, no declaration, and no error', (tint) => {
    const env = makeEnv();
    const noTint = render(fog, fogPicture, { tint: '' });
    const pageBefore = allElements().filter((el) => !el.closest('[data-poltergeist]')).map((el) => el.getAttribute('style'));
    let h;
    expect(() => {
      h = track(fog, fog.apply(env, { tint }, 1));
      h = fog.apply(env, { tint }, 0.5, h);
    }).not.toThrow();
    expect(h.tintEl).toBeNull();
    for (const el of h.el.querySelectorAll('*')) expect(el.style.backgroundColor).toBe('');
    expect(document.documentElement.outerHTML).not.toContain('example.com');
    expect(document.documentElement.outerHTML.toLowerCase()).not.toMatch(/var\(|attr\(|env\(/);
    const pageAfter = allElements().filter((el) => !el.closest('[data-poltergeist]')).map((el) => el.getAttribute('style'));
    expect(pageAfter).toEqual(pageBefore);
    fog.undo(h, { durationMs: 0 });
    spy.calls.length = 0;
    // Same rendering as tint '' at the same intensity.
    const again = render(fog, fogPicture, { tint });
    expect(again).toEqual(noTint);
  });
});

describe('env with only document and reducedMotion (Requirement 5.8)', () => {
  it.each([false, true])('Fog and Block apply and undo instantly without error (reducedMotion=%s)', (reducedMotion) => {
    const env = { document, reducedMotion };
    const before = snap();
    let f;
    let b;
    expect(() => {
      f = fog.apply(env, {}, 0.6);
      f = fog.apply(env, {}, 1, f);
      b = block.apply(env, { detail: `${DETAIL} {duration}` }, 0.6);
      b = block.apply(env, { detail: `${DETAIL} {duration}` }, 1, b);
    }).not.toThrow();
    expect(b.el.shadowRoot.querySelector('p').textContent).toBe('You lost a while to this feed. a while');
    expect(() => {
      fog.undo(f, { durationMs: 0 });
      block.undo(b, { durationMs: 0 });
    }).not.toThrow();
    expect(snap()).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('undo cancels every animation and restores the snapshot (Requirement 5.7)', () => {
  const setups = {
    fog: () => fog.apply(makeEnv(), {}, 1),
    block: () => block.apply(makeEnv({ readMeter }), { detail: DETAIL }, 1),
    tombstone: () => tombstone.apply(makeEnv({ readMeter }), {}, 1),
  };
  const counts = { fog: 1, block: 3, tombstone: 1 };

  describe.each(Object.keys(setups))('%s', (name) => {
    const fx = EFFECTS[name];

    it('instant undo', () => {
      const before = snap();
      const h = track(fx, setups[name]());
      expect(spy.calls).toHaveLength(counts[name]);
      fx.undo(h, { durationMs: 0 });
      for (const anim of spy.calls) expect(anim.cancel).toHaveBeenCalledTimes(1);
      expect(spy.calls.every((a) => a.playState === 'idle')).toBe(true);
      expect(snap()).toEqual(before);
      expect(vi.getTimerCount()).toBe(0);
      // Nothing restarts later, and a second undo changes nothing.
      document.dispatchEvent(new Event('visibilitychange'));
      expect(() => fx.undo(h, { durationMs: 0 })).not.toThrow();
      expect(spy.calls).toHaveLength(counts[name]);
      expect(snap()).toEqual(before);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('fade undo cancels the motion in the finish step', () => {
      const before = snap();
      const h = track(fx, setups[name]());
      fx.undo(h, { durationMs: 500 });
      vi.advanceTimersByTime(499);
      expect(snap()).not.toEqual(before);
      vi.advanceTimersByTime(1);
      for (const anim of spy.calls) expect(anim.cancel).toHaveBeenCalledTimes(1);
      expect(snap()).toEqual(before);
      expect(vi.getTimerCount()).toBe(0);
      expect(() => fx.undo(h, { durationMs: 0 })).not.toThrow();
      expect(snap()).toEqual(before);
    });
  });
});
