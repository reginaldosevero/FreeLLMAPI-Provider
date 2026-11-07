const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTO_MODEL_LABEL,
  createLanguageModelChatProvider,
  getModelLabel,
  getModelListSignature,
  getRequestModelId,
  getVSCodeModelId,
  isContextOverflowError,
  isVisibleModel,
  parseModels,
  pickWidestContextModel,
  toOpenAiMessages,
} = require('../extension/src/language-model-provider');

const vscode = {
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  LanguageModelTextPart: class LanguageModelTextPart {
    constructor(value) {
      this.value = value;
    }
  },
  LanguageModelToolCallPart: class LanguageModelToolCallPart {
    constructor(callId, name, input) {
      Object.assign(this, { callId, name, input });
    }
  },
};

function createToken() {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
}

test('parseModels reads OpenAI model IDs and string entries', () => {
  const models = parseModels({
    data: [{ id: 'auto', owned_by: 'gateway' }, 'model-one', { name: 'model-two' }, null],
  });

  assert.deepEqual(models.map((model) => model.id), ['auto', 'model-one', 'model-two']);
});

test('getModelLabel preserves provider names and labels unnamed auto models', () => {
  assert.equal(
    getModelLabel({ id: 'auto', name: 'Auto (router picks the best available model)' }),
    'FreeLLM Auto Router Best (router picks the best available model)'
  );
  assert.equal(getModelLabel({ id: 'auto' }), AUTO_MODEL_LABEL);
});

test('FreeLLM Auto has a unique VS Code ID and maps back to the provider auto ID', () => {
  assert.equal(getVSCodeModelId('auto'), 'freellm-auto-router-best');
  assert.equal(getRequestModelId('freellm-auto-router-best'), 'auto');
  assert.equal(getRequestModelId('model-one'), 'model-one');
});

test('model visibility keeps FreeLLM auto and hides OmniRoute auto routes', () => {
  assert.equal(isVisibleModel({ id: 'auto' }), true);
  assert.equal(isVisibleModel({ id: 'auto-route' }), false);
  assert.equal(isVisibleModel({ id: 'auto/best-free' }), false);
});

test('model list signature changes when available models or labels change', () => {
  const initial = [{ id: 'auto', name: 'Auto' }];
  const withNewModel = [...initial, { id: 'model-one', name: 'Model One' }];
  const renamedModel = [{ id: 'model-one', name: 'Model One renamed' }];

  assert.notEqual(getModelListSignature(initial), getModelListSignature(withNewModel));
  assert.notEqual(getModelListSignature(initial), getModelListSignature(renamedModel));
  assert.equal(
    getModelListSignature(initial),
    getModelListSignature([{ id: 'auto', name: 'Auto' }, { id: 'auto/best-free', name: 'Other provider' }])
  );
});

test('provider exposes the event that refreshes native model information', () => {
  const changed = () => {};
  const provider = createLanguageModelChatProvider(vscode, () => ({}), () => {}, changed);

  assert.equal(provider.onDidChangeLanguageModelChatInformation, changed);
});

test('toOpenAiMessages preserves text and tool call results', () => {
  const messages = toOpenAiMessages(vscode, [
    {
      role: vscode.LanguageModelChatMessageRole.Assistant,
      content: [
        { value: 'Checking that now.' },
        { callId: 'call-1', name: 'lookup', input: { query: 'status' } },
      ],
    },
    {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [{ callId: 'call-1', content: [{ value: 'Ready' }] }],
    },
  ]);

  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].content, 'Checking that now.');
  assert.equal(messages[0].tool_calls[0].function.arguments, '{"query":"status"}');
  assert.deepEqual(messages[1], { role: 'tool', tool_call_id: 'call-1', content: 'Ready' });
});

test('provider discovers models and returns streamed OpenAI-compatible responses', async () => {
  const originalFetch = global.fetch;
  const requested = [];
  const config = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    apiKey: 'test-key',
    model: 'auto',
  };

  global.fetch = async (url, options) => {
    requested.push({ url: String(url), options });
    if (options.method !== 'POST') {
      return new Response(JSON.stringify({
        data: [
          { id: 'auto', name: 'Auto (router picks the best available model)' },
          { id: 'auto-route', name: 'Auto Route' },
          { id: 'auto/best-free', name: 'Auto Best Free' },
          { id: 'model-one', supports_tools: false },
        ],
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const events = [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' from FreeLLM.' } }] },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(events, { headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const provider = createLanguageModelChatProvider(vscode, () => config);
    const models = await provider.provideLanguageModelChatInformation({ silent: true }, createToken());

    assert.deepEqual(models.map((model) => model.id), ['freellm-auto-router-best', 'model-one']);
    assert.equal(models[0].name, 'FreeLLM Auto Router Best (router picks the best available model)');
    assert.equal(models[0].capabilities.toolCalling, true);
    assert.equal(models[1].capabilities.toolCalling, false);
    assert.equal(requested[0].url, 'http://127.0.0.1:31415/v1/models');
    assert.equal(requested[0].options.headers.Authorization, 'Bearer test-key');

    const parts = [];
    await provider.provideLanguageModelChatResponse(
      models[0],
      [{ role: vscode.LanguageModelChatMessageRole.User, content: [{ value: 'Say hello' }] }],
      { tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
      { report: (part) => parts.push(part) },
      createToken()
    );

    assert.equal(requested[1].url, 'http://127.0.0.1:31415/v1/chat/completions');
    assert.equal(requested[1].options.headers.Authorization, 'Bearer test-key');
    assert.equal(JSON.parse(requested[1].options.body).model, 'auto');
    assert.deepEqual(parts.map((part) => part.value), ['Hello', ' from FreeLLM.']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('provider emits a single tool call from a non-streaming response', async () => {
  const originalFetch = global.fetch;
  let requestedModel;
  global.fetch = async (_url, options) => {
    requestedModel = JSON.parse(options.body).model;
    return new Response(JSON.stringify({
    choices: [{
      message: {
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'lookup', arguments: '{"query":"status"}' },
        }],
      },
    }],
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const provider = createLanguageModelChatProvider(vscode, () => ({ baseUrl: 'http://localhost/v1' }));
    const parts = [];
    await provider.provideLanguageModelChatResponse(
      { id: 'auto-route' },
      [],
      { tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
      { report: (part) => parts.push(part) },
      createToken()
    );

    assert.equal(parts.length, 1);
    assert.equal(parts[0].callId, 'call-1');
    assert.equal(parts[0].name, 'lookup');
    assert.deepEqual(parts[0].input, { query: 'status' });
    assert.equal(requestedModel, 'auto');
  } finally {
    global.fetch = originalFetch;
  }
});

test('context overflow errors are recognised and narrow models are skipped', () => {
  assert.equal(
    isContextOverflowError(new Error('This model\'s maximum context length is 32768 tokens.')),
    true
  );
  assert.equal(isContextOverflowError(new Error('HTTP 401: Unauthorized')), false);
  assert.equal(isContextOverflowError('prompt is too long: 40000 tokens'), true);

  const widest = pickWidestContextModel([
    { id: 'freellm-auto-router-best', maxInputTokens: 262000 },
    { id: 'small-model', maxInputTokens: 32768 },
    { id: 'big-model', maxInputTokens: 1048576 },
  ]);
  assert.equal(widest.id, 'big-model');
  assert.equal(pickWidestContextModel([]), undefined);
});

test('auto retries a context rejection on the widest advertised model', async () => {
  const originalFetch = global.fetch;
  const models = [];
  const bodies = [];

  global.fetch = async (_url, options) => {
    if (options.method !== 'POST') {
      return new Response(JSON.stringify({
        data: [
          { id: 'auto', name: 'Auto', context_window: 262000 },
          { id: 'small-model', name: 'Small', context_window: 32768 },
          { id: 'big-model', name: 'Big', context_window: 1048576 },
        ],
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const model = JSON.parse(options.body).model;
    models.push(model);
    bodies.push(JSON.parse(options.body).messages.length);
    if (model === 'auto') {
      return new Response(JSON.stringify({
        error: { message: "This model's maximum context length is 32768 tokens." },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('data: {"choices":[{"delta":{"content":"wide"}}]}\n\ndata: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const provider = createLanguageModelChatProvider(vscode, () => ({ baseUrl: 'http://x/v1' }));
    const parts = [];
    await provider.provideLanguageModelChatResponse(
      { id: 'freellm-auto-router-best' },
      [{ role: vscode.LanguageModelChatMessageRole.User, content: [{ value: 'long prompt' }] }],
      { tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
      { report: (part) => parts.push(part) },
      createToken()
    );

    assert.deepEqual(models, ['auto', 'big-model']);
    assert.deepEqual(bodies, [1, 1]);
    assert.deepEqual(parts.map((part) => part.value), ['wide']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('pinned model falls back to auto then to the widest model on context overflow', async () => {
  const originalFetch = global.fetch;
  const models = [];

  global.fetch = async (_url, options) => {
    if (options.method !== 'POST') {
      return new Response(JSON.stringify({
        data: [
          { id: 'auto', context_window: 262000 },
          { id: 'small-model', context_window: 32768 },
          { id: 'big-model', context_window: 1048576 },
        ],
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const model = JSON.parse(options.body).model;
    models.push(model);
    if (model !== 'big-model') {
      return new Response(JSON.stringify({
        error: { message: 'HTTP 400: This model\'s maximum context length is 32768 tokens.' },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const provider = createLanguageModelChatProvider(vscode, () => ({ baseUrl: 'http://x/v1' }));
    const parts = [];
    await provider.provideLanguageModelChatResponse(
      { id: 'small-model' },
      [{ role: vscode.LanguageModelChatMessageRole.User, content: [{ value: 'long prompt' }] }],
      { tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
      { report: (part) => parts.push(part) },
      createToken()
    );

    assert.deepEqual(models, ['small-model', 'auto', 'big-model']);
    assert.deepEqual(parts.map((part) => part.value), ['ok']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('non-context errors are not retried', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async (_url, options) => {
    if (options.method !== 'POST') {
      return new Response(JSON.stringify({ data: [{ id: 'auto', context_window: 262000 }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'HTTP 429: rate limited' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const provider = createLanguageModelChatProvider(vscode, () => ({ baseUrl: 'http://x/v1' }));
    await assert.rejects(
      () => provider.provideLanguageModelChatResponse(
        { id: 'freellm-auto-router-best' },
        [{ role: vscode.LanguageModelChatMessageRole.User, content: [{ value: 'hi' }] }],
        { tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
        { report: () => {} },
        createToken()
      ),
      /429/
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});