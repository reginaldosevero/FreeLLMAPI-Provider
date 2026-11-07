# FreeLLMAPI-Provider

A lightweight OpenAI-compatible AI API provider starter. It exposes a simple chat completions endpoint and can optionally forward requests to a real upstream provider when you configure one.

## Features

- `GET /health` for health checks
- `GET /v1/models` for model discovery
- `POST /v1/chat/completions` for OpenAI-compatible chat requests
- Optional upstream proxy via `FREE_LLM_PROVIDER_URL`, `OPENAI_BASE_URL`, or `PROVIDER_URL`

## Quick start

```bash
npm install
cp .env.example .env
npm start
```

Then call:

```bash
curl http://localhost:3000/health
```

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "demo-model",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
```

## API key and VS Code integration

If you want the endpoint to require an API key, set `FREE_LLM_API_KEY` in `.env`.

```env
FREE_LLM_API_KEY=meu-token-secreto
PORT=3000
```

Then in VS Code or in any OpenAI-compatible client, use:

- Base URL: `http://localhost:3000/v1`
- API key: the same value from `FREE_LLM_API_KEY`
- Header: `Authorization: Bearer <your-key>`

This works with OpenAI-compatible clients and many AI extensions that accept a custom endpoint.

## Optional upstream provider

Set one of the following environment variables in `.env`:

```env
FREE_LLM_PROVIDER_URL=https://example.com/v1/chat/completions
OPENAI_BASE_URL=https://example.com/v1
PROVIDER_URL=https://example.com/api
OPENAI_API_KEY=your-api-key
```

When a provider URL is configured, requests are proxied to that service automatically.

## Scripts

```bash
npm test
npm run dev
npm start
```

## VS Code extension

The `extension/` folder contains the VS Code extension published to the Marketplace as
[Free LLM API Provider](https://marketplace.visualstudio.com/items?itemName=rsluna.free-llm-api-provider)
(`rsluna.free-llm-api-provider`).

It connects the native VS Code Chat model picker to any OpenAI-compatible endpoint, with
automatic model discovery from `/v1/models`, an Auto routing option, and an API key kept in
VS Code SecretStorage.

```bash
cd extension
npm install
npm run check
npm run package
```

Install the built `.vsix` with **Extensions: Install from VSIX...** in the Command Palette, or
install it directly from the Marketplace:

```
ext install rsluna.free-llm-api-provider
```

Configure it with **FreeLLM: Open extension settings**: set the base URL and key, search the
models, then select **Apply**.

## License

MIT
