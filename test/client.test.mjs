import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../public/enhance.js', import.meta.url), 'utf8');

function enhanceClipboard(clipboard) {
  const inputs = ['marvel', 'keanu-reeves'].map((slug) => ({
    value: `https://calendar.example/calendars/${slug}.ics`,
    focused: false, selected: false,
    focus() { this.focused = true; },
    select() { this.selected = true; },
  }));
  const buttons = inputs.map((_, index) => ({
    dataset: { copy: `subscription-${index}` }, hidden: true, disabled: false,
    innerHTML: `Copy link<span class="sr-only"> for source ${index}</span>`,
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
  }));
  const status = { textContent: '' };
  const timers = [];
  const document = {
    getElementById(id) { return id === 'copy-status' ? status : inputs[Number(id.split('-').at(-1))]; },
    querySelectorAll(selector) { assert.equal(selector, '[data-copy]'); return buttons; },
  };
  runInNewContext(script, { navigator: { clipboard }, document, setTimeout: (callback) => timers.push(callback) });
  return { inputs, buttons, status, timers };
}

test('copy links target their visible address and announce completion after the clipboard succeeds', async () => {
  const copied = [];
  let complete;
  const controls = enhanceClipboard({ writeText: (value) => {
    copied.push(value);
    return new Promise((resolve) => { complete = resolve; });
  } });
  assert(controls.buttons.every((button) => !button.hidden));
  const button = controls.buttons[1];
  const originalLabel = button.innerHTML;
  controls.status.textContent = 'An earlier copy result.';
  const copying = button.listeners.click();
  assert.equal(button.disabled, true);
  assert.deepEqual(copied, [controls.inputs[1].value]);
  assert.equal(controls.status.textContent, '');
  complete();
  await copying;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Copied');
  assert.match(controls.status.textContent, /link copied/i);
  assert.equal(controls.inputs[1].selected, false);
  controls.timers[0]();
  assert.equal(button.innerHTML, originalLabel);
});

test('clipboard refusal selects the matching address and explains how to copy it manually', async () => {
  const controls = enhanceClipboard({ writeText: async () => { throw new Error('Clipboard access denied.'); } });
  await controls.buttons[0].listeners.click();
  assert.equal(controls.inputs[0].focused, true);
  assert.equal(controls.inputs[0].selected, true);
  assert.equal(controls.inputs[1].selected, false);
  assert.equal(controls.buttons[0].disabled, false);
  assert.match(controls.buttons[0].textContent, /manually/i);
  assert.match(controls.status.textContent, /address is selected.+manually/i);
});

test('browsers without the Clipboard API keep the ordinary address available without a nonworking copy button', () => {
  const controls = enhanceClipboard(undefined);
  assert(controls.buttons.every((button) => button.hidden && !button.listeners.click));
  assert(controls.inputs.every((input) => input.value.startsWith('https://calendar.example/calendars/')));
  assert.equal(controls.status.textContent, '');
});
