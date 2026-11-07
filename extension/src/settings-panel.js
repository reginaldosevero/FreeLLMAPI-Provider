const crypto = require('node:crypto');

function renderSettingsPanel(webview) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const contentSecurityPolicy = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <title>FreeLLM API</title>
  <style nonce="${nonce}">
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
      max-width: 760px;
      margin: 0 auto;
      padding: 28px 30px 36px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font: 13px var(--vscode-font-family);
    }
    h1 { margin: 0 0 22px; font-size: 19px; font-weight: 600; }
    form { display: grid; gap: 20px; }
    .field { display: grid; gap: 7px; }
    .field-label { font-weight: 600; }
    .hint, #keyState, #status { color: var(--muted); }
    .row { display: flex; gap: 8px; align-items: stretch; }
    input, select {
      min-width: 0;
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
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .action-group { display: flex; gap: 8px; }
    .danger { color: var(--vscode-errorForeground); }
    #status { min-height: 18px; margin: -10px 0 0; }
    #status[data-kind="error"] { color: var(--vscode-errorForeground); }
    #status[data-kind="success"] { color: var(--vscode-testing-iconPassed); }
    @media (max-width: 520px) {
      body { padding: 20px 16px; }
      .row { flex-direction: column; }
      .row button { width: 100%; }
    }
  </style>
</head>
<body>
  <h1>FreeLLM API</h1>
  <form id="settingsForm" novalidate>
    <div class="field">
      <label class="field-label" for="baseUrl">Endpoint base URL</label>
      <input id="baseUrl" name="baseUrl" type="url" autocomplete="url" required aria-describedby="baseUrlHint">
      <span class="hint" id="baseUrlHint">Use the OpenAI-compatible base URL, including /v1.</span>
    </div>
    <div class="field">
      <label class="field-label" for="apiKey">API key</label>
      <input id="apiKey" name="apiKey" type="password" autocomplete="new-password" placeholder="Saved securely; leave blank to keep it">
      <label class="hint"><input id="clearKey" type="checkbox" style="width:auto;min-height:auto;vertical-align:middle"> Remove saved API key</label>
      <span id="keyState" role="status">Checking saved key…</span>
    </div>
    <div class="field">
      <label class="field-label" for="modelSelect">Default model</label>
      <label class="hint" for="modelFilter">Search models by name or ID</label>
      <input id="modelFilter" type="search" autocomplete="off" placeholder="Type a model name or ID">
      <span class="hint">Model list refreshes automatically every 30 seconds.</span>
      <div class="row">
        <select id="modelSelect" aria-label="Choose a model"><option value="auto">FreeLLM Auto Router Best (router picks the best available model)</option></select>
        <button id="searchModels" type="button" class="secondary">Search models</button>
      </div>
      <label class="hint" for="manualModel">Or enter a model ID manually</label>
      <input id="manualModel" type="text" autocomplete="off" placeholder="Optional model ID">
    </div>
    <p id="status" role="status" aria-live="polite"></p>
    <div class="actions">
      <button id="resetSettings" type="button" class="secondary danger">Reset</button>
      <div class="action-group">
        <button id="applySettings" type="button">Apply</button>
      </div>
    </div>
  </form>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const baseUrl = document.getElementById('baseUrl');
      const apiKey = document.getElementById('apiKey');
      const clearKey = document.getElementById('clearKey');
      const modelSelect = document.getElementById('modelSelect');
      const modelFilter = document.getElementById('modelFilter');
      const manualModel = document.getElementById('manualModel');
      const searchButton = document.getElementById('searchModels');
      const applyButton = document.getElementById('applySettings');
      const resetButton = document.getElementById('resetSettings');
      const keyState = document.getElementById('keyState');
      const status = document.getElementById('status');
      const autoModelLabel = 'FreeLLM Auto Router Best (router picks the best available model)';
      const hiddenModelIds = ['auto-route', 'auto/best-free'];
      let availableModels = [];
      let selectedModelId = 'auto';

      function showStatus(message, kind) {
        status.textContent = message || '';
        status.dataset.kind = kind || '';
      }

      function renderModels(models, selectedModel) {
        const entries = Array.isArray(models) ? models : [];
        availableModels = entries
          .filter((model) => model && typeof model.id === 'string' && !hiddenModelIds.includes(model.id.toLowerCase()))
          .map((model) => model.id.toLowerCase() === 'auto' ? { ...model, name: autoModelLabel } : model);
        if (!availableModels.some((model) => model.id.toLowerCase() === 'auto')) {
          availableModels.unshift({ id: 'auto', name: autoModelLabel });
        }

        selectedModelId = availableModels.some((model) => model.id === selectedModel) ? selectedModel : 'auto';
        manualModel.value = selectedModelId === selectedModel ? '' : (selectedModel || '');
        renderModelOptions();
      }

      function renderModelOptions() {
        const query = modelFilter.value.trim().toLowerCase();
        const matchingModels = availableModels.filter((model) =>
          
          (model.name || model.id).toLowerCase().includes(query) || model.id.toLowerCase().includes(query)
        );
        modelSelect.replaceChildren();
        for (const model of matchingModels) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name || model.id;
          modelSelect.append(option);
        }

        if (matchingModels.length === 0) {
          const option = document.createElement('option');
          option.textContent = 'No models match your search';
          option.disabled = true;
          modelSelect.append(option);
          modelSelect.selectedIndex = 0;
          return;
        }

        modelSelect.value = matchingModels.some((model) => model.id === selectedModelId) ? selectedModelId : '';
      }

      modelFilter.addEventListener('input', renderModelOptions);

      searchButton.addEventListener('click', () => {
        searchButton.disabled = true;
        showStatus('Searching models…');
        vscode.postMessage({
          type: 'searchModels',
          baseUrl: baseUrl.value,
          apiKey: apiKey.value,
        });
      });

      modelSelect.addEventListener('change', () => {
        selectedModelId = modelSelect.value;
        manualModel.value = '';
      });

      applyButton.addEventListener('click', () => {
        const parsedUrl = (() => {
          try { return new URL(baseUrl.value); } catch { return undefined; }
        })();
        if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol)) {
          showStatus('Enter a valid http or https endpoint URL.', 'error');
          baseUrl.focus();
          return;
        }

        const model = manualModel.value.trim() || selectedModelId || modelSelect.value || 'auto';
        applyButton.disabled = true;
        showStatus('Applying settings…');
        vscode.postMessage({
          type: 'applySettings',
          baseUrl: baseUrl.value,
          apiKey: apiKey.value,
          clearApiKey: clearKey.checked,
          model,
        });
      });

      resetButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'resetSettings' });
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'settings') {
          baseUrl.value = message.baseUrl || '';
          keyState.textContent = message.hasApiKey ? 'An API key is saved securely.' : 'No API key is saved.';
          clearKey.checked = false;
          apiKey.value = '';
          renderModels(message.models, message.model || 'auto');
        } else if (message.type === 'models') {
          searchButton.disabled = false;
          renderModels(message.models, message.selectedModel || modelSelect.value || 'auto');
          showStatus(message.models.length + ' models found. Auto-refresh runs every 30 seconds.', 'success');
        } else if (message.type === 'error') {
          searchButton.disabled = false;
          applyButton.disabled = false;
          showStatus(message.message, 'error');
        } else if (message.type === 'applied') {
          applyButton.disabled = false;
          apiKey.value = '';
          clearKey.checked = false;
          keyState.textContent = message.hasApiKey ? 'API key saved securely.' : 'No API key is saved.';
          showStatus('Settings applied.', 'success');
        } else if (message.type === 'reset') {
          applyButton.disabled = false;
          baseUrl.value = message.baseUrl;
          apiKey.value = '';
          clearKey.checked = false;
          keyState.textContent = 'No API key is saved.';
          modelFilter.value = '';
          manualModel.value = '';
          renderModels(message.models || [], 'auto');
          showStatus('Settings reset.', 'success');
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}

function createSettingsPanel(vscode, context, handlers) {
  let panel;
  let panelMessageSubscription;

  async function sendSettings() {
    if (!panel) {
      return;
    }

    const config = await handlers.getSettings();
    panel.webview.postMessage({
      type: 'settings',
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: Boolean(config.apiKey),
      models: [],
    });

    try {
      const models = await handlers.searchModels(config.baseUrl, config.apiKey);
      panel.webview.postMessage({ type: 'models', models, selectedModel: config.model });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      panel.webview.postMessage({ type: 'error', message: `Model search failed: ${message}` });
    }
  }

  async function handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    try {
      if (message.type === 'ready') {
        await sendSettings();
        return;
      }

      if (message.type === 'searchModels') {
        if (typeof message.baseUrl !== 'string' || typeof message.apiKey !== 'string') {
          throw new Error('Invalid search settings.');
        }
        const config = await handlers.getSettings();
        const apiKey = message.apiKey.trim() || config.apiKey;
        const models = await handlers.searchModels(message.baseUrl, apiKey);
        panel?.webview.postMessage({ type: 'models', models, selectedModel: config.model });
        return;
      }

      if (message.type === 'applySettings') {
        const result = await handlers.applySettings(message);
        panel?.webview.postMessage({ type: 'applied', hasApiKey: result.hasApiKey });
        return;
      }

      if (message.type === 'resetSettings') {
        const reset = await handlers.resetSettings();
        if (reset) {
          panel?.webview.postMessage({
            type: 'reset',
            baseUrl: reset.baseUrl,
            models: reset.models,
          });
        }
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      panel?.webview.postMessage({ type: 'error', message: messageText });
    }
  }

  function openSettingsPanel() {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Active);
      return panel;
    }

    panel = vscode.window.createWebviewPanel(
      'freellmapi.settings',
      'FreeLLM API',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [] }
    );
    panel.webview.html = renderSettingsPanel(panel.webview);
    panelMessageSubscription = panel.webview.onDidReceiveMessage(handleMessage);
    panel.onDidDispose(() => {
      panelMessageSubscription?.dispose();
      panelMessageSubscription = undefined;
      panel = undefined;
    }, undefined, context.subscriptions);
    context.subscriptions.push(panel);
    return panel;
  }

  openSettingsPanel.refreshModels = (models, selectedModel) => {
    panel?.webview.postMessage({ type: 'models', models, selectedModel });
  };

  return openSettingsPanel;
}

module.exports = { createSettingsPanel, renderSettingsPanel };