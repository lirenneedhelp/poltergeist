// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPopup, TEXT, POPUP_MESSAGE } from '../popup.js';

const html = readFileSync(path.join(process.cwd(), 'app1-doomscroll', 'popup.html'), 'utf8');

function mountPopupHtml() {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

let sent;
let handler;
let chromeApi;
const $ = (id) => document.getElementById(id);

function setup(reply = { ok: true, supported: true, paused: false, demoMode: false }) {
  mountPopupHtml();
  sent = [];
  handler = (msg) => (msg.type === POPUP_MESSAGE.POPUP_STATE ? reply : { ok: true });
  chromeApi = {
    tabs: { query: vi.fn(async () => [{ id: 42, url: 'https://secret.example/', title: 'secret' }]) },
    runtime: { sendMessage: vi.fn(async (msg) => { sent.push(msg); return handler(msg); }) },
  };
  return createPopup({ chrome: chromeApi, document });
}

beforeEach(() => { document.documentElement.innerHTML = ''; });

describe('popup markup', () => {
  it('has accessible status and labelled native controls, no inline script', () => {
    mountPopupHtml();
    const status = $('status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    const labelOf = (id) => document.querySelector(`label[for="${id}"]`).textContent.trim();
    expect(labelOf('pause')).toBe('Pause on this tab');
    expect(labelOf('demo')).toBe('Demo mode on supported tabs');
    expect($('pause').tagName).toBe('INPUT');
    expect($('pause').type).toBe('checkbox');
    expect($('demo').type).toBe('checkbox');
    expect(html).toMatch(/<link rel="stylesheet" href="popup\.css">/);
    expect(html).toMatch(/<script type="module" src="popup\.js"><\/script>/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe('load', () => {
  it('queries the active tab and sends only its id', async () => {
    const popup = setup();
    await popup.init();
    expect(chromeApi.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sent).toEqual([{ type: POPUP_MESSAGE.POPUP_STATE, tabId: 42 }]);
    expect(JSON.stringify(sent)).not.toMatch(/secret/);
  });

  it('shows active normal state on a supported tab', async () => {
    await setup().init();
    expect($('status-text').textContent).toBe(TEXT.active);
    expect($('pause').disabled).toBe(false);
    expect($('demo').disabled).toBe(false);
    expect($('notice').hidden).toBe(true);
  });

  it('shows demo and paused states', async () => {
    await setup({ ok: true, supported: true, paused: false, demoMode: true }).init();
    expect($('status-text').textContent).toBe(TEXT.demo);
    expect($('demo').checked).toBe(true);
    await setup({ ok: true, supported: true, paused: true, demoMode: true }).init();
    expect($('status-text').textContent).toBe(TEXT.paused);
    expect($('pause').checked).toBe(true);
  });

  it('disables only pause when unsupported; demo stays usable globally', async () => {
    await setup({ ok: true, supported: false, paused: false, demoMode: false }).init();
    expect($('status-text').textContent).toBe(TEXT.unsupported);
    expect($('pause').disabled).toBe(true);
    expect($('demo').disabled).toBe(false);
  });

  it('shows an error when the tab or worker reply is unusable', async () => {
    const popup = setup({ ok: false, error: 'x' });
    await popup.init();
    expect($('status-text').textContent).toBe(TEXT.error);
    const p2 = setup();
    chromeApi.tabs.query.mockResolvedValue([]);
    await p2.init();
    expect($('status-text').textContent).toBe(TEXT.error);
    expect(sent).toEqual([]);
  });
});

describe('pause updates', () => {
  it('sends a set-paused command and shows the confirmed state', async () => {
    const popup = setup();
    await popup.init();
    handler = () => ({ ok: true, paused: true, delivered: true });
    $('pause').checked = true;
    $('pause').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect($('status-text').textContent).toBe(TEXT.paused));
    expect(sent.at(-1)).toEqual({ type: POPUP_MESSAGE.SET_PAUSED, tabId: 42, paused: true });
    expect($('pause').checked).toBe(true);
    expect($('pause').disabled).toBe(false);
  });

  it('suppresses duplicate clicks while a command is in flight', async () => {
    const popup = setup();
    await popup.init();
    const gate = deferred();
    handler = () => gate.promise;
    const first = popup.changePaused(true);
    expect($('pause').disabled).toBe(true);
    expect($('pause').getAttribute('aria-busy')).toBe('true');
    await popup.changePaused(true);
    await popup.changePaused(false);
    gate.resolve({ ok: true, paused: true, delivered: true });
    await first;
    expect(sent.filter((m) => m.type === POPUP_MESSAGE.SET_PAUSED)).toHaveLength(1);
    expect($('pause').getAttribute('aria-busy')).toBe('false');
  });

  it('rolls back and shows an error when the commit fails', async () => {
    const popup = setup();
    await popup.init();
    handler = () => ({ ok: false, error: 'could not save pause state' });
    $('pause').checked = true;
    await popup.changePaused(true);
    expect($('pause').checked).toBe(false);
    expect(popup.state.paused).toBe(false);
    expect($('notice').hidden).toBe(false);
    expect($('notice').dataset.kind).toBe('error');
    expect($('notice').textContent).toBe(TEXT.saveFailed);
  });

  it('keeps a committed pause and shows an unavailable notice when undelivered', async () => {
    const popup = setup();
    await popup.init();
    handler = () => ({ ok: true, paused: true, delivered: false });
    await popup.changePaused(true);
    expect($('pause').checked).toBe(true);
    expect(popup.state.paused).toBe(true);
    expect($('notice').dataset.kind).toBe('unavailable');
    expect($('notice').textContent).toBe(TEXT.undelivered);
    expect($('status-text').textContent).toBe(TEXT.paused);
  });

  it('ignores pause changes on an unsupported tab', async () => {
    const popup = setup({ ok: true, supported: false, paused: false, demoMode: false });
    await popup.init();
    await popup.changePaused(true);
    expect(sent.filter((m) => m.type === POPUP_MESSAGE.SET_PAUSED)).toHaveLength(0);
    expect($('pause').checked).toBe(false);
  });
});

describe('demo updates', () => {
  it('updates demo on a supported tab', async () => {
    const popup = setup();
    await popup.init();
    handler = () => ({ ok: true, demoMode: true });
    await popup.changeDemo(true);
    expect(sent.at(-1)).toEqual({ type: POPUP_MESSAGE.SET_DEMO, enabled: true });
    expect($('demo').checked).toBe(true);
    expect($('status-text').textContent).toBe(TEXT.demo);
  });

  it('works on an unsupported tab', async () => {
    const popup = setup({ ok: true, supported: false, paused: false, demoMode: false });
    await popup.init();
    handler = () => ({ ok: true, demoMode: true });
    await popup.changeDemo(true);
    expect($('demo').checked).toBe(true);
    expect($('status-text').textContent).toBe(TEXT.unsupported);
    expect($('pause').disabled).toBe(true);
  });

  it('suppresses duplicates and rolls back on failure', async () => {
    const popup = setup();
    await popup.init();
    const gate = deferred();
    handler = () => gate.promise;
    const first = popup.changeDemo(true);
    expect($('demo').disabled).toBe(true);
    await popup.changeDemo(true);
    gate.resolve({ ok: false, error: 'could not save demo mode' });
    await first;
    expect(sent.filter((m) => m.type === POPUP_MESSAGE.SET_DEMO)).toHaveLength(1);
    expect($('demo').checked).toBe(false);
    expect($('notice').textContent).toBe(TEXT.saveFailed);
  });

  it('treats a rejected sendMessage as a failed commit', async () => {
    const popup = setup();
    await popup.init();
    chromeApi.runtime.sendMessage.mockRejectedValue(new Error('gone'));
    await popup.changeDemo(true);
    expect($('demo').checked).toBe(false);
    expect($('notice').dataset.kind).toBe('error');
  });
});

describe('popup sends no browsing data', () => {
  it('messages contain only ids and Booleans', async () => {
    const popup = setup();
    await popup.init();
    handler = (m) => (m.type === POPUP_MESSAGE.SET_PAUSED
      ? { ok: true, paused: true, delivered: true } : { ok: true, demoMode: true });
    await popup.changePaused(true);
    await popup.changeDemo(true);
    expect(JSON.stringify(sent)).not.toMatch(/url|title|http|text|history|meter/i);
  });
});
