const express = require('express');

function buildPrompt(messages = []) {
  return messages
    .filter((message) => message && typeof message.content === 'string')
    .map((message) => `${message.role || 'user'}: ${message.content}`)
    .join('\n');
}

function createDemoResponse(prompt, model) {
  const normalizedPrompt = (prompt || '').trim();
  const summary = normalizedPrompt ? normalizedPrompt.slice(0, 180) : 'no prompt provided';

  return `This is a demo response from the FreeLLM API provider for model "${model || 'demo-model'}". You asked: "${summary}". Configure a real provider via FREE_LLM_PROVIDER_URL or OPENAI_BASE_URL to route requests to an external model.`;
}

async function proxyToProvider(providerUrl, requestBody, requestHeaders) {
  const request = {
    method: requestBody === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requestHeaders,
    },
  };

  if (requestBody !== undefined) {
    request.body = JSON.stringify(requestBody);
  }

  const response = await fetch(providerUrl, {
    ...request,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider request failed (${response.status}): ${text}`);
  }

  return response.json();
}

function getProviderModelsUrl() {
  const baseUrl = process.env.OPENAI_BASE_URL;
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}/models`;
  }

  const providerUrl = process.env.FREE_LLM_PROVIDER_URL || process.env.PROVIDER_URL;
  if (!providerUrl) {
    return undefined;
  }

  const normalizedUrl = providerUrl.replace(/\/+$/, '');
  if (normalizedUrl.endsWith('/chat/completions')) {
    return `${normalizedUrl.slice(0, -'/chat/completions'.length)}/models`;
  }

  return `${normalizedUrl}/models`;
}

function createApp() {
  const app = express();
  const requiredApiKey = process.env.FREE_LLM_API_KEY || process.env.OPENAI_API_KEY;

  app.use(express.json({ limit: '2mb' }));

  const requireApiKey = (req, res, next) => {
    if (!requiredApiKey) {
      return next();
    }

    const authHeader = req.headers.authorization || req.headers['x-api-key'];
    const suppliedKey = typeof authHeader === 'string' ? authHeader : Array.isArray(authHeader) ? authHeader[0] : '';
    const normalizedKey = suppliedKey.startsWith('Bearer ') ? suppliedKey.slice(7) : suppliedKey;

    if (normalizedKey === requiredApiKey) {
      return next();
    }

    return res.status(401).json({
      error: {
        message: 'Missing or invalid API key.',
        type: 'invalid_request_error',
        code: 'missing_api_key',
      },
    });
  };

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'free-llm-api-provider',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/v1/models', requireApiKey, async (req, res) => {
    const providerUrl = getProviderModelsUrl();
    if (!providerUrl) {
      return res.json({
        object: 'list',
        data: [
          { id: 'demo-model', object: 'model', created: 0, owned_by: 'local' },
        ],
      });
    }

    const headers = {};
    if (process.env.OPENAI_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
    }

    try {
      const models = await proxyToProvider(providerUrl, undefined, headers);
      return res.json(models);
    } catch (error) {
      return res.status(502).json({
        error: {
          message: error.message || 'Upstream model request failed',
          type: 'provider_error',
          code: 'provider_failed',
        },
      });
    }
  });

  app.post('/v1/chat/completions', requireApiKey, async (req, res) => {
    const requestBody = req.body || {};
    const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
    const model = requestBody.model || 'demo-model';
    const openAiBaseUrl = process.env.OPENAI_BASE_URL?.replace(/\/+$/, '');
    const providerUrl = process.env.FREE_LLM_PROVIDER_URL
      || (openAiBaseUrl ? `${openAiBaseUrl}/chat/completions` : process.env.PROVIDER_URL);

    try {
      if (providerUrl) {
        const headers = {};
        if (process.env.OPENAI_API_KEY) {
          headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
        }

        const remoteResult = await proxyToProvider(providerUrl, requestBody, headers);
        return res.json(remoteResult);
      }

      const prompt = buildPrompt(messages);
      const content = createDemoResponse(prompt, model);
      const created = Math.floor(Date.now() / 1000);
      const completion = {
        id: `chatcmpl-${created}`,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: Math.max(1, prompt.length),
          completion_tokens: Math.max(1, content.length),
          total_tokens: Math.max(1, prompt.length + content.length),
        },
      };

      return res.json(completion);
    } catch (error) {
      return res.status(502).json({
        error: {
          message: error.message || 'Upstream provider request failed',
          type: 'provider_error',
          code: 'provider_failed',
        },
      });
    }
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'internal_error',
        code: 'internal_server_error',
      },
    });
  });

  return app;
}

module.exports = { createApp, buildPrompt, createDemoResponse };
