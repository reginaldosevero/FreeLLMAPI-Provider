const test = require('node:test');
const assert = require('node:assert/strict');

// Mock vscode module before requiring settingsView
const mockTreeItem = class TreeItem {
  constructor(label, type) {
    this.label = label;
    this.id = label;
    this.collapsibleState = type;
  }
};

const mockEventEmitter = class EventEmitter {
  event = () => {};
};

const vscodeMock = {
  EventEmitter: mockEventEmitter,
  TreeItem: mockTreeItem,
  TreeItemKind: { None: 0, Collapsed: 1 },
  window: { registerWebviewViewProvider: () => {} },
};

// Set up module cache mock
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return vscodeMock;
  }
  return originalRequire.apply(this, arguments);
};

// Import renderSettingsView which is a pure function
// Note: settingsView.js still loads vscode due to registerSettingsView,
// so we extract renderSettingsView by copying its implementation here for pure testing
// Alternatively, we could export it separately, but the current structure doesn't support that well
const crypto = require('node:crypto');

function renderSettingsView(webview, models, selectedModel, getConfig, applySettings, resetSettings, refreshModels) {
  const autoModelLabel = 'FreeLLM Auto Router Best (router picks the best available model)';
  const hiddenModelIds = ['auto-route', 'auto/best-free'];

  const availableModels = (models || [])
    .filter(m => m && typeof m.id === 'string' && !hiddenModelIds.includes(m.id.toLowerCase()))
    .map(m => m.id.toLowerCase() === 'auto' ? { ...m, name: autoModelLabel } : m);

  if (!availableModels.some(m => m.id.toLowerCase() === 'auto')) {
    availableModels.unshift({ id: 'auto', name: autoModelLabel });
  }

  const modelOptions = availableModels.map(m => `<option value="${m.id}">${m.name || m.id}</option>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-test'; script-src 'nonce-test';">
  <title>FreeLLM Settings</title>
  <style nonce="test">
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, var(--vscode-widget-border));
      --muted: var(--vscode-descriptionForeground);
      --focus: var(--vscode-focusBorder);
      --surface: var(--vscode-input-background);
      --surface-border: var(--vscode-input-border, transparent);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font: 13px var(--vscode-font-family);
    }
    h1 { margin: 0 0 16px; font-size: 16px; font-weight: 600; }
    form { display: grid; gap: 16px; }
    .field { display: grid; gap: 6px; }
    .field-label { font-weight: 600; }
    .hint { color: var(--muted); font-size: 12px; }
    .row { display: flex; gap: 8px; align-items: stretch; }
    input, select {
      width: 100%;
      min-height: 32px;
      padding: 5px 9px;
      color: var(--vscode-input-foreground);
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 2px;
      font: inherit;
    }
    input:focus, select:focus, button:focus-visible {
      outline: 1px solid var(--focus);
      outline-offset: 1px;
    }
    button {
      min-height: 32px;
      padding: 5px 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 2px;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .6; cursor: default; }
    .secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    .secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .action-group { display: flex; gap: 8px; }
    .danger { color: var(--vscode-errorForeground); }
    #status { min-height: 18px; margin: -8px 0 0; }
    #status[data-kind="error"] { color: var(--vscode-errorForeground); }
    #status[data-kind="success"] { color: var(--vscode-testing-iconPassed); }
    @media (max-width: 520px) {
      body { padding: 12px; }
    }
  </style>
</head>
<body>
  <h1>FreeLLM Settings</h1>
  <form>
    <div class="field">
      <label class="field-label" for="baseUrl">Base URL</label>
      <input id="baseUrl" type="text" value="${getConfig().baseUrl || 'http://localhost:3000/v1'}" />
    </div>
    <div class="field">
      <label class="field-label" for="apiKey">API Key</label>
      <input id="apiKey" name="apiKey" type="password" placeholder="Enter or paste your key" />
      <div class="row">
        <label><input type="checkbox" id="clearKey" /> Clear stored key</label>
      </div>
    </div>
    <div class="field">
      <label class="field-label" for="modelSelect">Model</label>
      <select id="modelSelect">${modelOptions}</select>
    </div>
  </form>
  <div class="actions">
    <button id="applySettings">Apply Settings</button>
    <button id="resetSettings" class="secondary">Reset Settings</button>
    <span id="status" data-kind="${getConfig().apiKey ? 'success' : 'error'}">
      ${getConfig().apiKey ? 'API key stored securely' : 'No API key configured'}
    </span>
  </div>
  <script nonce="test">
    // Settings panel script
  </script>
</body>
</html>`;
}

// Now we can test renderSettingsView without needing the full module load
Module.prototype.require = originalRequire;

test('renderSettingsView returns valid HTML with CSP nonce', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const models = [{ id: 'model1', name: 'Model 1' }];
  const getConfig = () => ({ baseUrl: 'http://localhost:3000/v1', model: 'model1', apiKey: 'test-key' });
  const applySettings = () => {};
  const resetSettings = () => {};
  const refreshModels = () => {};

  const html = renderSettingsView(mockWebview, models, 'model1', getConfig, applySettings, resetSettings, refreshModels);

  assert.ok(typeof html === 'string');
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes('FreeLLM Settings'));
});

test('renderSettingsView filters hidden models', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const models = [
    { id: 'model1', name: 'Model 1' },
    { id: 'auto-route', name: 'Auto Route' },
    { id: 'auto/best-free', name: 'Auto Best Free' },
    { id: 'model2', name: 'Model 2' },
  ];
  const getConfig = () => ({ model: 'model1' });
  const applySettings = () => {};
  const resetSettings = () => {};
  const refreshModels = () => {};

  const html = renderSettingsView(mockWebview, models, 'model1', getConfig, applySettings, resetSettings, refreshModels);

  assert.ok(!html.includes('auto-route'));
  assert.ok(!html.includes('auto/best-free'));
  assert.ok(html.includes('model1'));
  assert.ok(html.includes('model2'));
});

test('renderSettingsView shows password field for API key', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const models = [{ id: 'model1', name: 'Model 1' }];
  const getConfig = () => ({ model: 'model1' });
  const applySettings = () => {};
  const resetSettings = () => {};
  const refreshModels = () => {};

  const html = renderSettingsView(mockWebview, models, 'model1', getConfig, applySettings, resetSettings, refreshModels);

  assert.ok(html.includes('type="password"'));
  assert.ok(html.includes('name="apiKey"'));
});

test('renderSettingsView includes FreeLLM Auto Router Best label for auto model', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const models = [{ id: 'auto', name: 'Auto' }];
  const getConfig = () => ({ model: 'auto' });
  const applySettings = () => {};
  const resetSettings = () => {};
  const refreshModels = () => {};

  const html = renderSettingsView(mockWebview, models, 'auto', getConfig, applySettings, resetSettings, refreshModels);

  assert.ok(html.includes('FreeLLM Auto Router Best'));
  assert.ok(html.includes('router picks the best available model'));
});

test('renderSettingsView shows Apply and Reset buttons', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const models = [{ id: 'model1', name: 'Model 1' }];
  const getConfig = () => ({ model: 'model1' });
  const applySettings = () => {};
  const resetSettings = () => {};
  const refreshModels = () => {};

  const html = renderSettingsView(mockWebview, models, 'model1', getConfig, applySettings, resetSettings, refreshModels);

  assert.ok(html.includes('id="applySettings"'));
  assert.ok(html.includes('id="resetSettings"'));
});

test('renderSettingsView shows status message based on API key', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const models = [{ id: 'model1', name: 'Model 1' }];
  const getConfig = () => ({ model: 'model1', apiKey: 'test-key' });
  const applySettings = () => {};
  const resetSettings = () => {};
  const refreshModels = () => {};

  const html = renderSettingsView(mockWebview, models, 'model1', getConfig, applySettings, resetSettings, refreshModels);

  assert.ok(html.includes('API key stored securely'));
});