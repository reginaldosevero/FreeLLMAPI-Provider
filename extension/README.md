# FreeLLM API Provider extension

This extension provides a lightweight VS Code companion for a custom OpenAI-compatible endpoint.

## Features

- Configure endpoint, key, and model in the FreeLLM extension panel
- Search and select models, including Auto
- Apply or reset the FreeLLM configuration
- Set your custom endpoint base URL
- Set your API key
- Test the connection to `/v1/models`
- Select any model returned by `/v1/models`, or choose `Auto` if your provider supports it
- Use the native VS Code Chat model picker with models discovered from your endpoint
- View activation and model discovery status with **FreeLLM: Show logs**
- Use the **FreeLLM** status bar item to open the model picker
- Send a sample chat request to `/v1/chat/completions`
- Expose the status in the VS Code status bar

## Configuration

Open **FreeLLM: Open extension settings** from the Command Palette, or use the FreeLLM provider's management button. Configure the endpoint and hidden API key, search for models, choose Auto or a specific model, then select **Apply**. **Reset** clears the saved key and restores defaults.

In VS Code Chat and the FreeLLM extension panel, choose **FreeLLM Auto Router Best** (model ID `auto`) for the provider's recommended automatic route. OmniRoute-only entries such as `auto/best-free` are excluded from FreeLLM's model lists.

When the route picked for a turn is too small for the prompt, the extension retries the same prompt instead of failing the turn: an `auto` request is retried on the model with the widest advertised context window, and a pinned model is retried on `auto` first. Retries only happen before any text is streamed, and only for context-limit errors, so rate limits and auth failures surface unchanged.

The API key is stored in VS Code SecretStorage and is never placed in webview storage. Existing VS Code settings are retained only for compatibility with older installations.

## Development

```bash
cd extension
npm install
npm run check
```

## Packaging

```bash
cd extension
npm run package
```
