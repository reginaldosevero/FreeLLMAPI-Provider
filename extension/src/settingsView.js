const vscode = require('vscode');
const crypto = require('node:crypto');

function renderSettingsView(webview, models, selectedModel, getConfig, applySettings, resetSettings, refreshModels) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

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
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>FreeLLM Settings</title>
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
      .row { flex-direction: column; }
      .row button { width: 100%; }
    }
  </style>
</head>
<body>
  <h1>FreeLLM API Settings</h1>
  <form id="settingsForm" novalidate>
    <div class="field">
      <label class="field-label" for="baseUrl">Endpoint base URL</label>
      <input id="baseUrl" name="baseUrl" type="url" autocomplete="url" required aria-describedby="baseUrlHint" placeholder="http://localhost:3000/v1">
      <span class="hint" id="baseUrlHint">Use the OpenAI-compatible base URL, including /v1.</span>
    </div>
    <div class="field">
      <label class="field-label" for="apiKey">API key</label>
      <input id="apiKey" name="apiKey" type="password" autocomplete="new-password" placeholder="Leave blank to keep current">
      <label class="hint"><input id="clearKey" type="checkbox" style="width:auto;min-height:auto;vertical-align:middle"> Remove saved API key</label>
      <span id="keyState" role="status" class="hint">Checking saved key…</span>
    </div>
    <div class="field">
      <label class="field-label" for="modelSelect">Default model</label>
      <label class="hint" for="modelFilter">Search models by name or ID</label>
      <input id="modelFilter" type="search" autocomplete="off" placeholder="Type a model name or ID">
      <span class="hint">Model list refreshes automatically every 30 seconds.</span>
      <div class="row">
        <select id="modelSelect" aria-label="Choose a model">${modelOptions}</select>
        <button id="refreshModels" type="button" class="secondary">$(refresh) Refresh</button>
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
      const refreshButton = document.getElementById('refreshModels');
      const applyButton = document.getElementById('applySettings');
      const resetButton = document.getElementById('resetSettings');
      const keyState = document.getElementById('keyState');
      const status = document.getElementById('status');
      const hiddenModelIds = ['auto-route', 'auto/best-free'];
      let availableModels = [];

      function showStatus(message, kind) {
        status.textContent = message || '';
        status.dataset.kind = kind || '';
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

      let selectedModelId = '${selectedModel || 'auto'}';
      modelFilter.addEventListener('input', renderModelOptions);

      refreshButton.addEventListener('click', () => {
        refreshButton.disabled = true;
        showStatus('Refreshing models…');
        vscode.postMessage({ type: 'refreshModels' });
      });

      applyButton.addEventListener('click', () => {
        const payload = {
          baseUrl: baseUrl.value.trim(),
          model: manualModel.value.trim() || modelSelect.value || 'auto',
          apiKey: apiKey.value,
          clearApiKey: clearKey.checked,
        };
        if (!payload.baseUrl || !payload.model) {
          showStatus('Endpoint and model are required.', 'error');
          return;
        }
        applyButton.disabled = true;
        showStatus('Applying settings…');
        vscode.postMessage({ type: 'applySettings', payload });
      });

      resetButton.addEventListener('click', () => {
        if (!confirm('Reset the FreeLLM endpoint and model, and delete the saved API key?')) return;
        resetButton.disabled = true;
        showStatus('Resetting settings…');
        vscode.postMessage({ type: 'resetSettings' });
      });

      window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data) return;

        if (data.type === 'models') {
          availableModels = data.models;
          selectedModelId = data.model || 'auto';
          renderModelOptions();
          refreshButton.disabled = false;
          showStatus('');
        } else if (data.type === 'keyState') {
          keyState.textContent = data.text || '';
        } else if (data.type === 'applyResult') {
          applyButton.disabled = false;
          if (data.error) {
            showStatus(data.error, 'error');
          } else {
            showStatus('Settings applied.', 'success');
            keyState.textContent = data.hasApiKey ? 'API key saved securely.' : 'No API key set.';
          }
        } else if (data.type === 'resetResult') {
          resetButton.disabled = false;
          if (data.error) {
            showStatus(data.error, 'error');
          } else {
            showStatus('Settings reset.', 'success');
            baseUrl.value = data.baseUrl || '';
            apiKey.value = '';
            clearKey.checked = false;
            keyState.textContent = 'No API key set.';
            availableModels = data.models || [];
            selectedModelId = data.model || 'auto';
            renderModelOptions();
          }
        } else if (data.type === 'error') {
          showStatus(data.message || 'An error occurred.', 'error');
          applyButton.disabled = false;
          resetButton.disabled = false;
          refreshButton.disabled = false;
        }
      });

      // Initialize: ask extension for current models and key state
      vscode.postMessage({ type: 'init' });
    })();
  </script>
</body>
</html>`;
}

function registerSettingsView(context, getConfig, applySettings, resetSettings, refreshModels) {
  const vscode = require('vscode');
  const disposables = [];

  disposables.push(
    vscode.window.registerWebviewViewProvider('freellmapi/settingsView', {
      resolveWebviewView: async (webview, _context, _token) => {
        webview.options = {
          enableScripts: true,
        };

        const updateWebview = async () => {
          const config = await getConfig();
          const endpoint = `${String(config.baseUrl).replace(/\/+$/, '')}/models`;
          let models = [];
          try {
            const headers = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
            const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(10000) });
            if (response.ok) {
              const body = await response.json();
              const entries = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
              models = entries.flatMap(entry => {
                if (typeof entry === 'string') return [{ id: entry }];
                if (!entry || typeof entry !== 'object') return [];
                const id = typeof entry.id === 'string' ? entry.id : typeof entry.name === 'string' ? entry.name : undefined;
                return id ? [{ ...entry, id }] : [];
              });
            }
          } catch (e) {
            // ignore
          }

          webview.html = renderSettingsView(webview, models, config.model || 'auto', getConfig, applySettings, resetSettings, refreshModels);
        };

        webview.onDidReceiveMessage(async (event) => {
          if (!event?.type) return;

          if (event.type === 'init') {
            await updateWebview();
            const config = await getConfig();
            const hasKey = !!(await context.secrets.get('freeLlmProvider.apiKey')) || !!config.apiKey;
            webview.postMessage({
              type: 'keyState',
              text: hasKey ? 'API key saved securely.' : 'No API key set.',
            });
          } else if (event.type === 'refreshModels') {
            await updateWebview();
          } else if (event.type === 'applySettings') {
            try {
              const result = await applySettings(event.payload);
              webview.postMessage({
                type: 'applyResult',
                hasApiKey: result.hasApiKey,
              });
            } catch (error) {
              webview.postMessage({
                type: 'applyResult',
                error: error instanceof Error ? error.message : String(error),
              });
            }
          } else if (event.type === 'resetSettings') {
            try {
              const result = await resetSettings();
              webview.postMessage({
                type: 'resetResult',
                baseUrl: result?.baseUrl,
                model: result?.model,
                models: result?.models,
              });
            } catch (error) {
              webview.postMessage({
                type: 'resetResult',
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        });

        await updateWebview();

        // Send init message to trigger client-side setup
        const config = await getConfig();
        const hasKey = !!(await context.secrets.get('freeLlmProvider.apiKey')) || !!config.apiKey;
        webview.postMessage({
          type: 'keyState',
          text: hasKey ? 'API key saved securely.' : 'No API key set.',
        });

        return disposables;
      },
    })
  );

  context.subscriptions.push(...disposables);
}

module.exports = { registerSettingsView, renderSettingsView };