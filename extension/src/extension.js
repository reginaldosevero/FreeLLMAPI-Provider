const vscode = require('vscode');
const {
  AUTO_MODEL_LABEL,
  createLanguageModelChatProvider,
  getModelLabel,
  getModelListSignature,
  isVisibleModel,
  parseModels,
} = require('./language-model-provider');
const { createSettingsPanel } = require('./settings-panel');
const { registerChatView } = require('./chatView');
const { registerLogsView } = require('./logsView');
const { registerSettingsView } = require('./settingsView');

const API_KEY_SECRET = 'freeLlmProvider.apiKey';
const DEFAULT_BASE_URL = 'http://localhost:3000/v1';
let extensionContext;
let connectionStatusItem;
let connectionStatusLog = () => {};
let connectionCheckRunning = false;
let connectionState = 'unknown';
let openExtensionSettingsPanel = () => {};
let refreshNativeModels = () => {};
let lastModelListSignature;

async function getConfig() {
  const config = vscode.workspace.getConfiguration('freeLlmProvider');
  const storedApiKey = await extensionContext?.secrets.get(API_KEY_SECRET);
  return {
    baseUrl: config.get('baseUrl', DEFAULT_BASE_URL),
    apiKey: storedApiKey || config.get('apiKey', ''),
    model: config.get('model', 'auto') === 'auto-route' ? 'auto' : config.get('model', 'auto'),
  };
}

function makeUrl(baseUrl, path) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const joinedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${joinedPath}`;
}

async function fetchModels(baseUrl, apiKey) {
  const response = await fetch(makeUrl(baseUrl, '/models'), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body || 'Model list request failed'}`);
  }

  return parseModels(JSON.parse(body));
}

function createModelPickerItems(models, currentModel, includeManual = false) {
  const autoModel = models.find((model) => model.id.toLowerCase() === 'auto');
  const autoEntry = autoModel || { id: 'auto', name: AUTO_MODEL_LABEL };
  const items = [{
    label: getModelLabel(autoEntry),
    description: 'Auto Best Pick · model ID: auto',
    value: 'auto',
    picked: currentModel === 'auto',
  }];

  items.push(...models
    .filter((model) => model.id.toLowerCase() !== 'auto' && isVisibleModel(model))
    .map((model) => ({
      label: getModelLabel(model),
      description: [
        model.name !== model.id ? `Model ID: ${model.id}` : undefined,
        typeof model.owned_by === 'string' ? `Provider: ${model.owned_by}` : undefined,
      ].filter(Boolean).join(' · ') || undefined,
      value: model.id,
      picked: model.id === currentModel,
    })));

  if (includeManual) {
    items.push({
      label: '$(edit) Enter model ID manually',
      description: 'Use an ID not listed by the endpoint',
      manual: true,
    });
  }

  return items;
}

function setConnectionStatus(state, detail = '') {
  if (!connectionStatusItem) {
    return;
  }

  connectionState = state;
  const states = {
    checking: {
      text: '$(sync~spin) FreeLLM',
      color: '#d29922',
      tooltip: 'Checking FreeLLM connection...',
      command: 'freellmapi.saveSettings',
    },
    connected: {
      text: '$(check) FreeLLM',
      color: '#3fb950',
      tooltip: detail || 'FreeLLM connected. Click to choose a model.',
      command: 'freellmapi.selectModel',
    },
    disconnected: {
      text: '$(error) FreeLLM',
      color: '#f85149',
      tooltip: detail || 'FreeLLM disconnected. Click to configure the connection.',
      command: 'freellmapi.saveSettings',
    },
  };
  const status = states[state] || states.checking;
  connectionStatusItem.text = status.text;
  connectionStatusItem.color = status.color;
  connectionStatusItem.tooltip = status.tooltip;
  connectionStatusItem.command = status.command;
}

async function updateConnectionStatus() {
  if (!connectionStatusItem || connectionCheckRunning) {
    return;
  }

  connectionCheckRunning = true;
  if (connectionState === 'unknown') {
    setConnectionStatus('checking');
  }

  try {
    const config = await getConfig();
    const models = (await fetchModels(config.baseUrl, config.apiKey)).filter(isVisibleModel);
    const signature = getModelListSignature(models);
    if (signature !== lastModelListSignature) {
      lastModelListSignature = signature;
      refreshNativeModels();
      openExtensionSettingsPanel.refreshModels?.(models, config.model);
      connectionStatusLog(`Model list refreshed; ${models.length} model(s) available.`);
    }
    setConnectionStatus('connected', `FreeLLM connected (${models.length} models). Click to choose a model.`);
    connectionStatusLog(`Connection check succeeded; ${models.length} model(s) available.`);
  } catch (error) {
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'request timed out'
      : 'network or configuration error';
    setConnectionStatus('disconnected', `FreeLLM ${reason}. Click to configure the connection.`);
    connectionStatusLog(`Connection check failed (${reason}).`);
  } finally {
    connectionCheckRunning = false;
  }
}

async function testConnection() {
  const config = await getConfig();
  const endpoint = makeUrl(config.baseUrl, '/models');

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  try {
    const response = await fetch(endpoint, { method: 'GET', headers });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body || 'Request failed'}`);
    }

    vscode.window.showInformationMessage(
      `FreeLLM connected successfully: ${endpoint} (${response.status})`
    );
    setConnectionStatus('connected');

    return { status: response.status, body: body ? JSON.parse(body) : {} };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setConnectionStatus('disconnected');
    const action = await vscode.window.showErrorMessage(
      `FreeLLM connection failed: ${message}`,
      'Configure and save settings'
    );
    if (action) {
      await saveSettings();
    }
    throw error;
  }
}

async function applyPanelSettings(input) {
  if (!input || typeof input.baseUrl !== 'string' || typeof input.model !== 'string') {
    throw new Error('Endpoint and model are required.');
  }

  const baseUrl = input.baseUrl.trim();
  const model = input.model.trim() || 'auto';
  const enteredApiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (baseUrl.length > 2048 || model.length > 256 || enteredApiKey.length > 8192) {
    throw new Error('A setting exceeds the allowed length.');
  }

  let endpoint;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new Error('Enter a valid endpoint URL.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('Use an http or https URL without embedded credentials.');
  }

  const current = await getConfig();
  const keyToSave = input.clearApiKey ? '' : enteredApiKey || current.apiKey;
  const config = vscode.workspace.getConfiguration('freeLlmProvider');
  if (keyToSave) {
    await extensionContext.secrets.store(API_KEY_SECRET, keyToSave);
  } else {
    await extensionContext.secrets.delete(API_KEY_SECRET);
  }
  await config.update('baseUrl', baseUrl.replace(/\/+$/, ''), vscode.ConfigurationTarget.Global);
  await config.update('model', model === 'auto-route' ? 'auto' : model, vscode.ConfigurationTarget.Global);
  await config.update('apiKey', '', vscode.ConfigurationTarget.Global);
  refreshNativeModels();
  void updateConnectionStatus();
  return { hasApiKey: Boolean(keyToSave) };
}

async function resetPanelSettings() {
  const confirmation = await vscode.window.showWarningMessage(
    'Reset the FreeLLM endpoint and model, and delete the saved API key?',
    { modal: true },
    'Reset FreeLLM'
  );
  if (confirmation !== 'Reset FreeLLM') {
    return undefined;
  }

  const config = vscode.workspace.getConfiguration('freeLlmProvider');
  await extensionContext.secrets.delete(API_KEY_SECRET);
  await config.update('baseUrl', DEFAULT_BASE_URL, vscode.ConfigurationTarget.Global);
  await config.update('apiKey', '', vscode.ConfigurationTarget.Global);
  await config.update('model', 'auto', vscode.ConfigurationTarget.Global);
  refreshNativeModels();
  void updateConnectionStatus();
  const models = await fetchModels(DEFAULT_BASE_URL, '').catch(() => []);
  return { baseUrl: DEFAULT_BASE_URL, model: 'auto', models };
}

function saveSettings() {
  openExtensionSettingsPanel();
}

async function resetSettings() {
  try {
    const result = await resetPanelSettings();
    if (result) {
      vscode.window.showInformationMessage('FreeLLM settings reset.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`FreeLLM settings could not be reset: ${message}`);
  }
}

async function selectModel() {
  const config = await getConfig();

  try {
    const models = await fetchModels(config.baseUrl, config.apiKey);

    setConnectionStatus('connected');
    const selection = await vscode.window.showQuickPick(createModelPickerItems(models, config.model), {
      placeHolder: `Select a model (${models.length} available)`,
      matchOnDescription: true,
    });

    if (!selection) {
      return;
    }

    await vscode.workspace
      .getConfiguration('freeLlmProvider')
      .update('model', selection.value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`FreeLLM model set to ${selection.label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setConnectionStatus('disconnected');
    vscode.window.showErrorMessage(`FreeLLM could not load models: ${message}`);
  }
}

async function sendSampleChat() {
  const config = await getConfig();
  const endpoint = makeUrl(config.baseUrl, '/chat/completions');

  const payload = {
    model: config.model,
    messages: [
      { role: 'user', content: 'Say hello from the FreeLLM VS Code extension.' },
    ],
    temperature: 0.7,
  };

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body || 'Chat request failed'}`);
    }

    const json = JSON.parse(body);
    const text = json?.choices?.[0]?.message?.content || 'No response returned';

    vscode.window.showInformationMessage(`FreeLLM response: ${text.slice(0, 140)}`);
    return json;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const action = await vscode.window.showErrorMessage(
      `FreeLLM chat request failed: ${message}`,
      'Configure and save settings'
    );
    if (action) {
      await saveSettings();
    }
    throw error;
  }
}

function registerSafely(context, register, label, log) {
  try {
    const disposable = register();
    if (disposable) {
      context.subscriptions.push(disposable);
    }
    return true;
  } catch (error) {
    // A second installed copy of this extension shares the vendor and command
    // IDs, so a duplicate registration must not abort activation: the copy that
    // owns the contribution still serves it.
    log(`${label} is already registered by another FreeLLM extension copy; skipping.`);
    return false;
  }
}

function activate(context) {
  extensionContext = context;
  const outputChannel = vscode.window.createOutputChannel('FreeLLM API');
  const log = (message) => outputChannel.appendLine(message);
  connectionStatusLog = log;
  log('Extension activated.');

  openExtensionSettingsPanel = createSettingsPanel(vscode, context, {
    getSettings: getConfig,
    searchModels: async (baseUrl, apiKey) => (await fetchModels(baseUrl, apiKey))
      .filter(isVisibleModel)
      .map((model) => ({
        id: model.id,
        name: getModelLabel(model),
        owned_by: typeof model.owned_by === 'string' ? model.owned_by : undefined,
      })),
    applySettings: applyPanelSettings,
    resetSettings: resetPanelSettings,
  });

  const modelInformationChanged = new vscode.EventEmitter();
  refreshNativeModels = () => modelInformationChanged.fire();
  const configurationChanged = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('freeLlmProvider')) {
      log('FreeLLM settings changed; refreshing model list.');
      refreshNativeModels();
      void updateConnectionStatus();
    }
  });
  const secretChanged = context.secrets.onDidChange((event) => {
    if (event.key === API_KEY_SECRET) {
      log('FreeLLM credential changed; refreshing model list.');
      refreshNativeModels();
      void updateConnectionStatus();
    }
  });

  const statusBarItem = vscode.window.createStatusBarItem(
    'free-llm-api-provider.connection',
    vscode.StatusBarAlignment.Right,
    10000
  );
  statusBarItem.name = 'FreeLLM API connection';
  connectionStatusItem = statusBarItem;
  setConnectionStatus('checking');
  statusBarItem.show();
  void updateConnectionStatus();
  const connectionCheckInterval = setInterval(() => {
    void updateConnectionStatus();
  }, 30000);

  registerSafely(context, () => vscode.commands.registerCommand('freellmapi.testConnection', async () => {
    await testConnection();
    await sendSampleChat();
  }), 'Command freellmapi.testConnection', log);

  registerSafely(context, () => vscode.commands.registerCommand('freellmapi.selectModel', selectModel), 'Command freellmapi.selectModel', log);

  registerSafely(context, () => vscode.commands.registerCommand('freellmapi.openSettings', () => {
    openExtensionSettingsPanel();
  }), 'Command freellmapi.openSettings', log);

  registerSafely(context, () => vscode.commands.registerCommand('freellmapi.showLogs', () => {
    outputChannel.show(true);
  }), 'Command freellmapi.showLogs', log);

  registerSafely(context, () => vscode.commands.registerCommand('freellmapi.saveSettings', saveSettings), 'Command freellmapi.saveSettings', log);
  registerSafely(context, () => vscode.commands.registerCommand('freellmapi.resetSettings', resetSettings), 'Command freellmapi.resetSettings', log);

  const providerRegistered = registerSafely(
    context,
    () => vscode.lm.registerLanguageModelChatProvider(
      'severo-freellmapi',
      createLanguageModelChatProvider(vscode, getConfig, log, modelInformationChanged.event)
    ),
    'Model provider severo-freellmapi',
    log
  );
  log(providerRegistered
    ? 'Registered the native VS Code Chat model provider.'
    : 'Reusing the native VS Code Chat model provider registered by another copy.');

  // Register sidebar views declared in package.json (activity bar container freellmapi-sidebar).
  // Settings opens when clicking the extension icon.
  // Logs view is also available in the sidebar.
  registerLogsView(context, outputChannel);
  registerSettingsView(context, getConfig, applyPanelSettings, resetPanelSettings);

  context.subscriptions.push(
    outputChannel,
    modelInformationChanged,
    configurationChanged,
    secretChanged,
    statusBarItem,
    { dispose: () => clearInterval(connectionCheckInterval) }
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  testConnection,
  selectModel,
  saveSettings,
  resetSettings,
  sendSampleChat,
  createModelPickerItems,
};
