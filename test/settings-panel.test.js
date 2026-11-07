const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSettingsPanel } = require('../extension/src/settings-panel');

test('FreeLLM extension panel provides model search, Apply, Reset, and a password field', () => {
  const html = renderSettingsPanel({ cspSource: 'vscode-webview://test' });

  assert.match(html, /default-src 'none'/);
  assert.match(html, /id="searchModels"/);
  assert.match(html, /id="modelFilter" type="search"/);
  assert.match(html, /Search models by name or ID/);
  assert.match(html, /Model list refreshes automatically every 30 seconds/);
  assert.match(html, /Model list refreshes automatically every 30 seconds/);
  assert.match(html, /id="modelSelect"/);
  assert.match(html, /id="applySettings"/);
  assert.match(html, /id="resetSettings"/);
  assert.match(html, /id="apiKey" name="apiKey" type="password"/);
  assert.match(html, /FreeLLM Auto Router Best \(router picks the best available model\)/);
  assert.match(html, /auto\/best-free/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
});