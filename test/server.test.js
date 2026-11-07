const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

function createRequest(app, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const http = require('node:http');
      const payload = body ? JSON.stringify(body) : null;

      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: payload
          ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            ...headers,
          }
          : headers,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          server.close();
          resolve({
            statusCode: res.statusCode,
            body: data ? JSON.parse(data) : null,
          });
        });
      });

      req.on('error', (error) => {
        server.close();
        reject(error);
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  });
}

test('GET /health returns service status', async () => {
  const app = createApp();
  const response = await createRequest(app, 'GET', '/health');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'free-llm-api-provider');
});

test('POST /v1/chat/completions returns OpenAI-compatible completion payload', async () => {
  const app = createApp();
  const response = await createRequest(app, 'POST', '/v1/chat/completions', {
    model: 'demo-model',
    messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
    temperature: 0.7,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.object, 'chat.completion');
  assert.ok(Array.isArray(response.body.choices));
  assert.equal(response.body.choices[0].message.role, 'assistant');
  assert.ok(response.body.choices[0].message.content.length > 0);
});

test('POST /v1/chat/completions appends the chat path to OPENAI_BASE_URL', async () => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.OPENAI_BASE_URL;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalLocalApiKey = process.env.FREE_LLM_API_KEY;
  const baseUrl = 'https://provider.example/v1';
  let requestedUrl;
  let authorizationHeader;

  process.env.OPENAI_BASE_URL = baseUrl;
  process.env.OPENAI_API_KEY = 'upstream-test-key';
  process.env.FREE_LLM_API_KEY = 'local-test-key';
  global.fetch = async (url, options) => {
    requestedUrl = String(url);
    authorizationHeader = options.headers.Authorization;
    return new Response(JSON.stringify({
      id: 'chatcmpl-upstream',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Upstream response' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const response = await createRequest(createApp(), 'POST', '/v1/chat/completions', {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
    }, { Authorization: 'Bearer local-test-key' });

    assert.equal(response.statusCode, 200);
    assert.equal(requestedUrl, `${baseUrl}/chat/completions`);
    assert.equal(authorizationHeader, 'Bearer upstream-test-key');
    assert.equal(response.body.choices[0].message.content, 'Upstream response');
  } finally {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = originalBaseUrl;
    }
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    if (originalLocalApiKey === undefined) {
      delete process.env.FREE_LLM_API_KEY;
    } else {
      process.env.FREE_LLM_API_KEY = originalLocalApiKey;
    }
  }
});

test('GET /v1/models proxies the upstream model list when configured', async () => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.OPENAI_BASE_URL;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalLocalApiKey = process.env.FREE_LLM_API_KEY;
  const baseUrl = 'https://provider.example/v1';
  let requestedUrl;
  let requestMethod;
  let authorizationHeader;

  process.env.OPENAI_BASE_URL = baseUrl;
  process.env.OPENAI_API_KEY = 'upstream-test-key';
  process.env.FREE_LLM_API_KEY = 'local-test-key';
  global.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestMethod = options.method;
    authorizationHeader = options.headers.Authorization;
    return new Response(JSON.stringify({
      object: 'list',
      data: [
        { id: 'model-one', object: 'model' },
        { id: 'model-two', object: 'model' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const response = await createRequest(createApp(), 'GET', '/v1/models', undefined, {
      Authorization: 'Bearer local-test-key',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(requestedUrl, `${baseUrl}/models`);
    assert.equal(requestMethod, 'GET');
    assert.equal(authorizationHeader, 'Bearer upstream-test-key');
    assert.deepEqual(response.body.data.map((model) => model.id), ['model-one', 'model-two']);
  } finally {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = originalBaseUrl;
    }
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    if (originalLocalApiKey === undefined) {
      delete process.env.FREE_LLM_API_KEY;
    } else {
      process.env.FREE_LLM_API_KEY = originalLocalApiKey;
    }
  }
});

test('POST /v1/chat/completions rejects requests without API key when configured', async () => {
  process.env.FREE_LLM_API_KEY = 'super-secret-key';
  const app = createApp();

  try {
    const response = await createRequest(app, 'POST', '/v1/chat/completions', {
      model: 'demo-model',
      messages: [{ role: 'user', content: 'This should fail without key.' }],
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, 'missing_api_key');
  } finally {
    delete process.env.FREE_LLM_API_KEY;
  }
});
