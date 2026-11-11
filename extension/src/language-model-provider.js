const AUTO_MODEL_LABEL = 'FreeLLM Auto Router Best (router picks the best available model)';
const FREELLM_AUTO_MODEL_ID = 'freellm-auto-router-best';
const HIDDEN_MODEL_IDS = new Set(['auto-route', 'auto/best-free']);

function parseModels(payload) {
  const entries = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];

  return entries.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [{ id: entry }];
    }

    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const id = typeof entry.id === 'string'
      ? entry.id
      : typeof entry.name === 'string'
        ? entry.name
        : undefined;

    return id ? [{ ...entry, id }] : [];
  });
}

function getModelLabel(model) {
  if (model.id.toLowerCase() === 'auto') {
    return AUTO_MODEL_LABEL;
  }

  if (typeof model.name === 'string' && model.name.trim()) {
    return model.name;
  }

  return model.id;
}

function isVisibleModel(model) {
  return typeof model?.id === 'string' && !HIDDEN_MODEL_IDS.has(model.id.toLowerCase());
}

function getModelListSignature(models) {
  return JSON.stringify(
    (Array.isArray(models) ? models : [])
      .filter(isVisibleModel)
      .map((model) => [model.id, getModelLabel(model)])
  );
}

function getRequestModelId(modelId) {
  return [FREELLM_AUTO_MODEL_ID, 'auto-route'].includes(modelId.toLowerCase()) ? 'auto' : modelId;
}

function getVSCodeModelId(modelId) {
  return modelId.toLowerCase() === 'auto' ? FREELLM_AUTO_MODEL_ID : modelId;
}

function positiveNumber(...values) {
  const value = values.find((candidate) => Number.isFinite(candidate) && candidate > 0);
  return value ? Math.floor(value) : undefined;
}

function getToolCallingCapability(model) {
  if (typeof model.supports_tools === 'boolean') {
    return model.supports_tools;
  }

  const toolCalling = model.capabilities?.toolCalling;
  return typeof toolCalling === 'boolean' || typeof toolCalling === 'number'
    ? toolCalling
    : true;
}

function getText(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => (typeof part?.value === 'string' ? part.value : ''))
    .join('');
}

function toOpenAiMessages(vscode, messages) {
  return messages.flatMap((message) => {
    const role = message.role === vscode.LanguageModelChatMessageRole.Assistant
      ? 'assistant'
      : 'user';
    const content = getText(message.content);
    const parts = Array.isArray(message.content) ? message.content : [];
    const toolCalls = parts.filter((part) => typeof part?.name === 'string' && typeof part?.callId === 'string');
    const toolResults = parts.filter((part) => typeof part?.callId === 'string' && Array.isArray(part?.content));
    const converted = [];

    if (toolCalls.length) {
      converted.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map((toolCall) => ({
          id: toolCall.callId,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.input || {}),
          },
        })),
      });
    } else if (toolResults.length) {
      if (content) {
        converted.push({ role, content });
      }
      for (const result of toolResults) {
        converted.push({
          role: 'tool',
          tool_call_id: result.callId,
          content: getText(result.content),
        });
      }
    } else {
      converted.push({ role, content });
    }

    return converted;
  });
}

const CONTEXT_OVERFLOW_PATTERN = /maximum context length|context length exceeded|context[\s/]*token window|too many tokens|prompt is too long|request is too large|reduce the (length of the input|prompt)|exceeds the model'?s context/i;

function isContextOverflowError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return CONTEXT_OVERFLOW_PATTERN.test(message);
}

function pickWidestContextModel(models) {
  return (Array.isArray(models) ? models : [])
    .filter((model) => typeof model?.id === 'string' && model.id.toLowerCase() !== FREELLM_AUTO_MODEL_ID)
    .reduce((widest, model) => (
      (model.maxInputTokens || 0) > (widest?.maxInputTokens || 0) ? model : widest
    ), undefined);
}

function createLanguageModelChatProvider(
  vscode,
  getConfig,
  log = () => {},
  onDidChangeLanguageModelChatInformation
) {
  async function requestModels(token) {
    const config = await getConfig();
    const endpoint = `${String(config.baseUrl).replace(/\/+$/, '')}/models`;
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());

    try {
      const response = await fetch(endpoint, {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        log(`Model discovery failed with HTTP ${response.status}.`);
        throw new Error(`HTTP ${response.status}: ${body || 'Model list request failed'}`);
      }

      const models = parseModels(JSON.parse(body))
        .filter(isVisibleModel)
        .map((model) => ({
        id: getVSCodeModelId(model.id),
        name: getModelLabel(model),
        family: model.id.toLowerCase() === 'auto'
          ? FREELLM_AUTO_MODEL_ID
          : typeof model.family === 'string' ? model.family : model.id,
        detail: model.id.toLowerCase() === 'auto'
          ? 'Auto Best Pick'
          : typeof model.owned_by === 'string' ? model.owned_by : undefined,
        tooltip: model.id.toLowerCase() === 'auto'
          ? 'FreeLLM Auto Best Pick (model ID: auto)'
          : `FreeLLM API model: ${model.id}`,
        version: typeof model.version === 'string' ? model.version : '1',
        maxInputTokens: positiveNumber(model.max_input_tokens, model.context_length, model.context_window) || 128000,
        maxOutputTokens: positiveNumber(model.max_output_tokens, model.max_completion_tokens) || 8192,
        capabilities: {
          toolCalling: getToolCallingCapability(model),
        },
        }));
      log(`Discovered ${models.length} model(s).`);
      return models;
    } catch (error) {
      if (!token.isCancellationRequested) {
        log(`Model discovery failed (${error instanceof Error ? error.name : 'unexpected error'}).`);
      }
      throw error;
    } finally {
      cancellation.dispose();
    }
  }

  async function runChatRequest(requestModelId, messages, options, progress, token, config, state) {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    const tools = Array.isArray(options.tools) && options.tools.length
      ? options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      }))
      : undefined;
    const payload = {
      model: getRequestModelId(requestModelId),
      messages: toOpenAiMessages(vscode, messages),
      stream: true,
      ...(tools ? { tools, tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto' } : {}),
    };

    try {
      log(`Sending chat request with model ${payload.model}.`);
      const response = await fetch(`${String(config.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        log(`Chat request failed with HTTP ${response.status}.`);
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body || 'Chat request failed'}`);
      }

      const toolCalls = new Map();
      const reportPayload = (chunk) => {
        if (chunk?.error) {
          throw new Error(chunk.error.message || 'The provider returned an error');
        }

        const choice = chunk?.choices?.[0];
        const delta = choice?.delta || choice?.message || {};
        if (typeof delta.content === 'string' && delta.content) {
          state.reported = true;
          progress.report(new vscode.LanguageModelTextPart(delta.content));
        }

        for (const [fallbackIndex, call] of (delta.tool_calls || []).entries()) {
          const index = Number.isInteger(call.index) ? call.index : fallbackIndex;
          const previous = toolCalls.get(index) || { id: '', name: '', arguments: '' };
          toolCalls.set(index, {
            id: call.id || previous.id,
            name: call.function?.name ? previous.name + call.function.name : previous.name,
            arguments: call.function?.arguments ? previous.arguments + call.function.arguments : previous.arguments,
          });
        }
      };

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;

        const consumeEvent = (event) => {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data || data === '[DONE]') {
            return data === '[DONE]';
          }
          reportPayload(JSON.parse(data));
          return false;
        };

        while (!finished) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            if (consumeEvent(event)) {
              finished = true;
              break;
            }
          }
          if (done) {
            if (buffer.trim()) {
              consumeEvent(buffer);
            }
            break;
          }
        }
      } else {
        reportPayload(await response.json());
      }

      for (const [index, call] of toolCalls) {
        const input = JSON.parse(call.arguments || '{}');
        state.reported = true;
        progress.report(new vscode.LanguageModelToolCallPart(call.id || `tool-${index}`, call.name, input));
      }
      log(`Chat request completed for model ${payload.model}.`);
    } finally {
      cancellation.dispose();
    }
  }

  async function widestContextRequestId(token) {
    try {
      return pickWidestContextModel(await requestModels(token))?.id;
    } catch {
      return undefined;
    }
  }

  async function provideLanguageModelChatResponse(model, messages, options, progress, token) {
    const config = await getConfig();
    const requested = getRequestModelId(model.id);
    const state = { reported: false };
    // A context rejection is the upstream model being too small for the prompt,
    // never the account running out of tokens. Keep the same prompt and move it
    // to a wider route instead of failing the turn.
    const retries = requested === 'auto'
      ? [widestContextRequestId]
      : [() => Promise.resolve('auto'), widestContextRequestId];

    let attempt = requested;
    for (let index = 0; ; index += 1) {
      try {
        return await runChatRequest(attempt, messages, options, progress, token, config, state);
      } catch (error) {
        const retryable = !state.reported
          && !token.isCancellationRequested
          && isContextOverflowError(error);
        const next = retryable ? await retries[index]?.(token) : undefined;
        if (!next || next === attempt) {
          throw error;
        }
        log(`Model ${attempt} rejected the prompt for context limits; retrying on ${next}.`);
        attempt = next;
      }
    }
  }

  return {
    onDidChangeLanguageModelChatInformation,
    provideLanguageModelChatInformation: (_options, token) => requestModels(token),
    provideLanguageModelChatResponse,
    provideTokenCount: async (_model, text) => Math.ceil(getText(typeof text === 'string' ? text : text.content).length / 4),
  };
}

module.exports = {
  AUTO_MODEL_LABEL,
  createLanguageModelChatProvider,
  getModelLabel,
  isContextOverflowError,
  pickWidestContextModel,
  getModelListSignature,
  isVisibleModel,
  getRequestModelId,
  getVSCodeModelId,
  parseModels,
  toOpenAiMessages,
};