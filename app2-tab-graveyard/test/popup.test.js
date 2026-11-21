// @vitest-environment jsdom
// Popup tests: popup.html is mounted in jsdom without its script tag, and createPopup is
// driven with a fake Chrome API covering exactly what the popup uses (tabs.query and
// runtime.sendMessage). Worker replies follow the shapes background.js returns. The
// active Tab object is a Proxy that records any read of url, pendingUrl, title, or
// favIconUrl, so a test fails if the popup reads more than the tab id.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPopup, formatDuration, notClosedText, POPUP_MESSAGE, TEXT } from '../popup.js';
import { MESSAGE } from '../background.js';
import { formatDuration as tombstoneFormatDuration } from '../../skeleton/effects/tombstone.js';

// jsdom replaces the global URL, so file paths are built from the repo root (as in Doomscroll's popup test).
const APP_DIR = path.join(process.cwd(), 'app2-tab-graveyard');
const HTML = readFileSync(path.join(APP_DIR, 'popup.html'), 'utf8');
const CSS = readFileSync(path.join(APP_DIR, 'popup.css'), 'utf8');

const TAB_ID = 42;
const SECRET = 'SECRET-TAB-PROPERTY';
const FORBIDDEN = ['url', 'pendingUrl', 'title', 'favIconUrl'];
const PS = POPUP_MESSAGE.POPUP_STATE;

const deadA = { tabId: 7, title: 'Lecture 4 notes', url: 'https://example.edu/l4?token=abc#notes', awaySeconds: 93600 };
const deadB = { tabId: 8, title: '   ', url: 'https://food.test:8443/stew', awaySeconds: 259200 };
const buriedE = { id: 'e1', title: 'Old thread', url: 'https://forum.test/t/1', buriedAt: Date.UTC(2026, 2, 12, 12), awaySeconds: 90000 };

function popupState(overrides = {}) {
  return {
    ok: true,
    demoMode: false,
    rulesLoaded: true,
    current: { known: true, stage: 'fogged', awaySeconds: 2700 },
    dead: [deadA, deadB],
    buried: [buriedE],
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const $ = (id) => document.getElementById(id);
const rows = (listId) => [...$(listId).querySelectorAll('li')];
const part = (li, cls) => li.querySelector(`.${cls}`).textContent;
const reopenButtons = () => [...$('buried-list').querySelectorAll('button.reopen')];

let sent;
let respond; // message type -> reply value, or a function of the message
let chromeApi;
let tabReads;
const commands = () => sent.filter((m) => m.type !== PS);

function setup({ state = popupState() } = {}) {
  document.documentElement.innerHTML = HTML.replace(/<script[\s\S]*?<\/script>/g, '');
  sent = [];
  tabReads = [];
  respond = { [PS]: state };
  const tab = new Proxy(
    { id: TAB_ID, active: true, windowId: 1, url: SECRET, pendingUrl: SECRET, title: SECRET, favIconUrl: SECRET },
    {
      get(target, key, receiver) {
        if (FORBIDDEN.includes(key)) tabReads.push(key);
        return Reflect.get(target, key, receiver);
      },
    },
  );
  chromeApi = {
    tabs: { query: vi.fn(async () => [tab]) },
    runtime: {
      sendMessage: vi.fn(async (msg) => {
        sent.push(clone(msg));
        const r = respond[msg.type];
        return typeof r === 'function' ? r(msg) : clone(r);
      }),
    },
  };
  return createPopup({ chrome: chromeApi, document, locale: 'en-GB' });
}

function expectAllControlsDisabled() {
  expect($('resurrect').disabled).toBe(true);
  expect($('bury').disabled).toBe(true);
  expect($('demo').disabled).toBe(true);
  for (const button of reopenButtons()) expect(button.disabled).toBe(true);
}

beforeEach(() => { document.documentElement.innerHTML = ''; });

describe('popup markup', () => {
  it('uses native buttons, a labelled demo checkbox, and external files only', () => {
    document.documentElement.innerHTML = HTML.replace(/<script[\s\S]*?<\/script>/g, '');
    for (const [id, text] of [['resurrect', 'Resurrect this tab'], ['bury', 'Bury all (0)']]) {
      expect($(id).tagName).toBe('BUTTON');
      expect($(id).type).toBe('button');
      expect($(id).textContent).toBe(text);
    }
    expect($('demo').tagName).toBe('INPUT');
    expect($('demo').type).toBe('checkbox');
    expect(document.querySelector('label[for="demo"]').textContent.trim()).toBe('Demo mode');
    for (const id of ['current', 'notice']) {
      expect($(id).getAttribute('role')).toBe('status');
      expect($(id).getAttribute('aria-live')).toBe('polite');
    }
    expect(HTML).toMatch(/<link rel="stylesheet" href="popup\.css">/);
    expect(HTML).toMatch(/<script type="module" src="popup\.js"><\/script>/);
    expect(HTML).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(HTML).not.toMatch(/\son[a-z]+\s*=/i);
    expect(HTML).not.toMatch(/\sstyle\s*=/i);
  });

  it('styles visible focus and disabled states, with no animation', () => {
    expect(CSS).toMatch(/button:focus-visible[\s\S]*?\{[^}]*outline:\s*2px solid/);
    expect(CSS).toMatch(/\.control input:focus-visible/);
    expect(CSS).toMatch(/button:disabled[^{]*\{[^}]*cursor:\s*not-allowed/);
    expect(CSS).toMatch(/\.control:has\(input:disabled\)/);
    expect(CSS).not.toMatch(/@keyframes/);
    const motion = [...CSS.matchAll(/\b(transition|animation)\s*:\s*([^;]+);/g)].map((m) => m[2].trim());
    expect(motion.length).toBeGreaterThan(0);
    expect(motion.every((v) => v === 'none')).toBe(true);
  });

  it('uses the same message names as the worker', () => {
    for (const [key, type] of Object.entries(POPUP_MESSAGE)) expect(MESSAGE[key]).toBe(type);
  });
});

describe('loading and error states', () => {
  it('shows the loading state with every control disabled until the worker replies', async () => {
    const popup = setup();
    const tabs = deferred();
    chromeApi.tabs.query.mockReturnValue(tabs.promise);
    const done = popup.init();
    expect($('current-stage').textContent).toBe(TEXT.loading);
    expect($('current').dataset.stage).toBe('loading');
    expect($('current-away').hidden).toBe(true);
    expectAllControlsDisabled();
    expect($('main').getAttribute('aria-busy')).toBe('true');
    for (const id of ['dead-list', 'dead-empty', 'buried-list', 'buried-empty']) expect($(id).hidden).toBe(true);

    tabs.resolve([{ id: TAB_ID }]);
    expect(await done).toBe(true);
    expect($('current-stage').textContent).toBe('Fogged');
    expect($('main').getAttribute('aria-busy')).toBe('false');
  });

  it.each([
    ['the worker replies with an error', () => { respond[PS] = { ok: false, error: 'rules unavailable' }; }],
    ['the worker reply is malformed', () => { respond[PS] = { ok: true, demoMode: 'yes', current: {}, dead: [], buried: [] }; }],
    ['sendMessage rejects', () => { chromeApi.runtime.sendMessage.mockRejectedValue(new Error('gone')); }],
    ['there is no active tab', () => { chromeApi.tabs.query.mockResolvedValue([]); }],
    ['tabs.query rejects', () => { chromeApi.tabs.query.mockRejectedValue(new Error('no tabs')); }],
  ])('shows the error state when %s', async (_name, arrange) => {
    const popup = setup();
    arrange();
    expect(await popup.init()).toBe(false);
    expect($('current-stage').textContent).toBe(TEXT.unreachable);
    expect($('current').dataset.stage).toBe('error');
    expectAllControlsDisabled();
    expect($('bury').textContent).toBe('Bury all (0)');
    for (const id of ['current-away', 'dead-list', 'dead-empty', 'buried-list', 'buried-empty', 'notice']) {
      expect($(id).hidden).toBe(true);
    }
    expect($('main').getAttribute('aria-busy')).toBe('false');
  });

  it('sends nothing when there is no active tab id', async () => {
    const popup = setup();
    chromeApi.tabs.query.mockResolvedValue([{ active: true }]);
    await popup.init();
    expect(sent).toEqual([]);
  });
});

describe('This tab', () => {
  it('reads only the active tab id and sends only that id', async () => {
    await setup().init();
    expect(chromeApi.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sent).toEqual([{ type: PS, tabId: TAB_ID }]);
    expect(tabReads).toEqual([]);
    expect(JSON.stringify(sent)).not.toContain(SECRET);
  });

  it.each([
    ['alive', 'Alive', 0, 'Away for 0 seconds'],
    ['fogged', 'Fogged', 2700, 'Away for 45 minutes'],
    ['rotting', 'Rotting', 18000, 'Away for 5 hours'],
    ['dead', 'Dead', 93600, 'Away for 26 hours'],
  ])('shows the %s stage and the Away_Time', async (stage, label, awaySeconds, away) => {
    await setup({ state: popupState({ current: { known: true, stage, awaySeconds } }) }).init();
    expect($('current-stage').textContent).toBe(label);
    expect($('current').dataset.stage).toBe(stage);
    expect($('current-away').hidden).toBe(false);
    expect($('current-away').textContent).toBe(away);
    expect($('resurrect').disabled).toBe(false);
  });

  it('shows Not haunted here and disables Resurrect for an unknown tab', async () => {
    const popup = setup({ state: popupState({ current: { known: false } }) });
    await popup.init();
    expect($('current-stage').textContent).toBe('Not haunted here');
    expect($('current').dataset.stage).toBe('unknown');
    expect($('current-away').hidden).toBe(true);
    expect($('resurrect').disabled).toBe(true);
    // The rest of the popup still works on an unhaunted tab.
    expect($('demo').disabled).toBe(false);
    expect($('bury').disabled).toBe(false);
    expect(rows('dead-list')).toHaveLength(2);
    expect(await popup.resurrect()).toBe(false);
    expect(commands()).toEqual([]);
  });
});

describe('Graveyard and Buried lists', () => {
  it('lists dead tabs with their title, host only, and time abandoned', async () => {
    await setup().init();
    const [a, b] = rows('dead-list');
    expect(rows('dead-list')).toHaveLength(2);
    expect(part(a, 'row-title')).toBe('Lecture 4 notes');
    expect(part(a, 'row-host')).toBe('example.edu');
    expect(part(a, 'row-when')).toBe('Abandoned 26 hours');
    // A blank title falls back to the host.
    expect(part(b, 'row-title')).toBe('food.test:8443');
    expect(part(b, 'row-host')).toBe('food.test:8443');
    expect(part(b, 'row-when')).toBe('Abandoned 3 days');
    expect($('dead-list').hidden).toBe(false);
    expect($('dead-empty').hidden).toBe(true);
    const text = document.body.textContent;
    for (const fragment of ['/l4', 'token', '#notes', '/stew', '/t/1', 'https://']) expect(text).not.toContain(fragment);
  });

  it('lists buried entries with host, date, and a labelled Reopen button', async () => {
    await setup().init();
    const [entry] = rows('buried-list');
    expect(rows('buried-list')).toHaveLength(1);
    expect(part(entry, 'row-title')).toBe('Old thread');
    expect(part(entry, 'row-host')).toBe('forum.test');
    expect(part(entry, 'row-when')).toBe('Buried 12 Mar 2026');
    const [button] = reopenButtons();
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('Reopen');
    expect(button.getAttribute('aria-label')).toBe('Reopen Old thread');
    expect(button.disabled).toBe(false);
    expect($('buried-empty').hidden).toBe(true);
  });

  it('shows the dead-tab count on Bury all and disables it when there are none', async () => {
    await setup().init();
    expect($('bury').textContent).toBe('Bury all (2)');
    expect($('bury').disabled).toBe(false);

    const empty = setup({ state: popupState({ dead: [], buried: [] }) });
    await empty.init();
    expect($('bury').textContent).toBe('Bury all (0)');
    expect($('bury').disabled).toBe(true);
    expect($('dead-list').hidden).toBe(true);
    expect($('dead-empty').hidden).toBe(false);
    expect($('dead-empty').textContent).toBe('No dead tabs.');
    expect($('buried-empty').hidden).toBe(false);
    expect($('buried-empty').textContent).toBe('Nothing buried yet.');
    expect(await empty.buryAll()).toBe(false);
    expect(commands()).toEqual([]);
  });

  it('explains an empty Graveyard when the worker could not load the rules', async () => {
    await setup({ state: popupState({ rulesLoaded: false, dead: [], current: { known: true, stage: null, awaySeconds: 0 } }) }).init();
    expect($('dead-empty').hidden).toBe(false);
    expect($('dead-empty').textContent).toBe(TEXT.rulesMissing);
    expect($('bury').disabled).toBe(true);
    expect($('current-stage').textContent).toBe(TEXT.unknownStage);
  });

  it('renders markup in titles as text', async () => {
    const evil = '<img src=x onerror="globalThis.__popupPwned = 1">';
    const bold = '<b>bold</b> & co';
    await setup({
      state: popupState({
        dead: [{ ...deadA, title: evil }],
        buried: [{ ...buriedE, title: bold }],
      }),
    }).init();
    expect(part(rows('dead-list')[0], 'row-title')).toBe(evil);
    expect(part(rows('buried-list')[0], 'row-title')).toBe(bold);
    expect(reopenButtons()[0].getAttribute('aria-label')).toBe(`Reopen ${bold}`);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('#buried-list b')).toBeNull();
    expect(globalThis.__popupPwned).toBeUndefined();
  });
});

describe('Bury all', () => {
  it('sends the listed tab ids, then shows the refreshed state', async () => {
    const popup = setup();
    await popup.init();
    const gate = deferred();
    respond[POPUP_MESSAGE.BURY] = () => gate.promise;
    $('bury').click();
    expectAllControlsDisabled();
    expect($('main').getAttribute('aria-busy')).toBe('true');

    respond[PS] = popupState({
      dead: [],
      buried: [
        { id: 'n1', title: deadA.title, url: deadA.url, buriedAt: Date.UTC(2026, 2, 13, 12), awaySeconds: 93600 },
        { id: 'n2', title: '', url: deadB.url, buriedAt: Date.UTC(2026, 2, 13, 12), awaySeconds: 259200 },
        buriedE,
      ],
    });
    gate.resolve({ ok: true, buried: [7, 8], notClosed: [] });
    await vi.waitFor(() => expect(rows('dead-list')).toHaveLength(0));

    expect(sent).toEqual([
      { type: PS, tabId: TAB_ID },
      { type: POPUP_MESSAGE.BURY, tabIds: [7, 8] },
      { type: PS, tabId: TAB_ID },
    ]);
    expect(rows('buried-list').map((li) => part(li, 'row-title'))).toEqual(['Lecture 4 notes', 'food.test:8443', 'Old thread']);
    expect($('bury').textContent).toBe('Bury all (0)');
    expect($('bury').disabled).toBe(true);
    expect($('notice').hidden).toBe(true);
    expect($('main').getAttribute('aria-busy')).toBe('false');
  });

  it('warns when some tabs could not be closed', async () => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.BURY] = { ok: true, buried: [7], notClosed: [8] };
    respond[PS] = popupState({ dead: [deadB] });
    expect(await popup.buryAll()).toBe(true);
    expect($('notice').hidden).toBe(false);
    expect($('notice').dataset.kind).toBe('warning');
    expect($('notice').textContent).toBe('Could not close 1 tab. It is still open.');
    expect(notClosedText(2)).toBe('Could not close 2 tabs. They are still open.');
    expect($('bury').textContent).toBe('Bury all (1)');
  });

  it.each([
    ['an error reply', { ok: false, error: 'could not save buried list' }],
    ['a success reply without result lists', { ok: true }],
    ['no reply', undefined],
  ])('keeps the last confirmed lists and shows an error on %s', async (_name, reply) => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.BURY] = reply;
    expect(await popup.buryAll()).toBe(false);
    expect($('notice').hidden).toBe(false);
    expect($('notice').dataset.kind).toBe('error');
    expect($('notice').textContent).toBe(TEXT.buryFailed);
    expect(rows('dead-list').map((li) => part(li, 'row-title'))).toEqual(['Lecture 4 notes', 'food.test:8443']);
    expect($('bury').textContent).toBe('Bury all (2)');
    expect($('bury').disabled).toBe(false);
    expect(sent.map((m) => m.type)).toEqual([PS, POPUP_MESSAGE.BURY]); // no refresh after a failure
  });
});

describe('Reopen', () => {
  it('reopens a buried entry from its button and refreshes the list', async () => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.REOPEN] = { ok: true, entryRemoved: true };
    respond[PS] = popupState({ buried: [] });
    reopenButtons()[0].click();
    await vi.waitFor(() => expect(rows('buried-list')).toHaveLength(0));
    expect(commands()).toEqual([{ type: POPUP_MESSAGE.REOPEN, entryId: 'e1' }]);
    expect($('buried-empty').hidden).toBe(false);
    expect($('notice').hidden).toBe(true);
  });

  it('keeps the entry and shows an error when reopening fails', async () => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.REOPEN] = { ok: false, error: 'unsupported url' };
    expect(await popup.reopen('e1')).toBe(false);
    expect($('notice').dataset.kind).toBe('error');
    expect($('notice').textContent).toBe(TEXT.reopenFailed);
    expect(rows('buried-list')).toHaveLength(1);
    expect(reopenButtons()[0].disabled).toBe(false);
  });

  it('warns when the tab opened but the entry stayed listed', async () => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.REOPEN] = { ok: true, entryRemoved: false };
    expect(await popup.reopen('e1')).toBe(true);
    expect($('notice').dataset.kind).toBe('warning');
    expect($('notice').textContent).toBe(TEXT.reopenKept);
  });

  it('ignores an entry id that is not listed', async () => {
    const popup = setup();
    await popup.init();
    expect(await popup.reopen('not-listed')).toBe(false);
    expect(commands()).toEqual([]);
  });
});

describe('Resurrect this tab', () => {
  it('resets the tab and shows the refreshed stage', async () => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.RESURRECT_TAB] = { ok: true, delivered: true };
    respond[PS] = popupState({ current: { known: true, stage: 'alive', awaySeconds: 0 } });
    $('resurrect').click();
    await vi.waitFor(() => expect($('current-stage').textContent).toBe('Alive'));
    expect(commands()).toEqual([{ type: POPUP_MESSAGE.RESURRECT_TAB, tabId: TAB_ID }]);
    expect($('current-away').textContent).toBe('Away for 0 seconds');
    expect($('notice').hidden).toBe(true);
    expect($('resurrect').disabled).toBe(false);
  });

  it('warns when the reset was saved but the tab did not receive it', async () => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.RESURRECT_TAB] = { ok: true, delivered: false };
    respond[PS] = popupState({ current: { known: true, stage: 'alive', awaySeconds: 0 } });
    expect(await popup.resurrect()).toBe(true);
    expect($('notice').hidden).toBe(false);
    expect($('notice').dataset.kind).toBe('warning');
    expect($('notice').textContent).toBe(TEXT.undelivered);
    expect($('current-stage').textContent).toBe('Alive');
  });

  it('keeps the last confirmed stage and shows an error when Resurrect fails', async () => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.RESURRECT_TAB] = { ok: false, error: 'unknown tab' };
    expect(await popup.resurrect()).toBe(false);
    expect($('notice').dataset.kind).toBe('error');
    expect($('notice').textContent).toBe(TEXT.resurrectFailed);
    expect($('current-stage').textContent).toBe('Fogged');
    expect($('resurrect').disabled).toBe(false);
    expect(sent.map((m) => m.type)).toEqual([PS, POPUP_MESSAGE.RESURRECT_TAB]);
  });

  it('shows the error state when the refresh after a command fails', async () => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.RESURRECT_TAB] = { ok: true, delivered: true };
    respond[PS] = { ok: false, error: 'gone' };
    await popup.resurrect();
    expect($('current-stage').textContent).toBe(TEXT.unreachable);
    expectAllControlsDisabled();
  });
});

describe('Demo mode', () => {
  it('shows the stored flag', async () => {
    await setup({ state: popupState({ demoMode: true }) }).init();
    expect($('demo').checked).toBe(true);
    expect($('demo').disabled).toBe(false);
  });

  it('sends the change, shows it while in flight, and keeps the confirmed state', async () => {
    const popup = setup();
    await popup.init();
    const gate = deferred();
    respond[POPUP_MESSAGE.SET_DEMO] = () => gate.promise;
    $('demo').checked = true;
    $('demo').dispatchEvent(new Event('change'));
    expect($('demo').checked).toBe(true);
    expectAllControlsDisabled();

    respond[PS] = popupState({ demoMode: true });
    gate.resolve({ ok: true, demoMode: true });
    await vi.waitFor(() => expect($('demo').disabled).toBe(false));
    expect($('demo').checked).toBe(true);
    expect(commands()).toEqual([{ type: POPUP_MESSAGE.SET_DEMO, enabled: true }]);
    expect($('notice').hidden).toBe(true);
  });

  it.each([
    ['an error reply', { ok: false, error: 'could not save demo mode' }],
    ['a reply with the other flag', { ok: true, demoMode: false }],
  ])('rolls the checkbox back and shows an error on %s', async (_name, reply) => {
    const popup = setup();
    await popup.init();
    respond[POPUP_MESSAGE.SET_DEMO] = reply;
    $('demo').checked = true;
    $('demo').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect($('notice').hidden).toBe(false));
    expect($('demo').checked).toBe(false);
    expect($('demo').disabled).toBe(false);
    expect($('notice').dataset.kind).toBe('error');
    expect($('notice').textContent).toBe(TEXT.demoFailed);
  });
});

describe('one command at a time', () => {
  it('disables every control and ignores further commands while one is in flight', async () => {
    const popup = setup();
    await popup.init();
    const gate = deferred();
    respond[POPUP_MESSAGE.BURY] = () => gate.promise;
    const first = popup.buryAll();
    expectAllControlsDisabled();
    expect($('main').getAttribute('aria-busy')).toBe('true');

    expect(await popup.buryAll()).toBe(false);
    expect(await popup.resurrect()).toBe(false);
    expect(await popup.reopen('e1')).toBe(false);
    expect(await popup.setDemo(true)).toBe(false);
    $('bury').click();
    $('resurrect').click();
    reopenButtons()[0].click();
    expectAllControlsDisabled();

    gate.resolve({ ok: true, buried: [7, 8], notClosed: [] });
    expect(await first).toBe(true);
    expect(commands()).toEqual([{ type: POPUP_MESSAGE.BURY, tabIds: [7, 8] }]);
    expect($('main').getAttribute('aria-busy')).toBe('false');
    expect($('bury').disabled).toBe(false);
    expect($('demo').checked).toBe(false);
  });
});

describe('duration wording matches the tombstone', () => {
  // Pins the popup's duplicated formatter and skeleton/effects/tombstone.js formatDuration
  // to the same outputs (Requirement 4.5 wording, used by the popup per the design).
  const TABLE = [
    [0, '0 seconds'],
    [1, '1 second'],
    [2, '2 seconds'],
    [59, '59 seconds'],
    [59.9, '59 seconds'],
    [60, '1 minute'],
    [61, '1 minute'],
    [119, '1 minute'],
    [120, '2 minutes'],
    [3599, '59 minutes'],
    [3600, '1 hour'],
    [3601, '1 hour'],
    [7199, '1 hour'],
    [7200, '2 hours'],
    [86399, '23 hours'],
    [86400, '24 hours'],
    [93600, '26 hours'],
    [47 * 3600 + 59 * 60, '47 hours'],
    [172799, '47 hours'],
    [172800, '2 days'],
    [172801, '2 days'],
    [259199, '2 days'],
    [259200, '3 days'],
    [864000, '10 days'],
    [-5, '0 seconds'],
    [Number.NaN, 'a while'],
    [Number.POSITIVE_INFINITY, 'a while'],
    [undefined, 'a while'],
    [null, 'a while'],
    ['60', 'a while'],
  ];

  it.each(TABLE)('formats %s as "%s" in both', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
    expect(tombstoneFormatDuration(seconds)).toBe(expected);
  });
});
