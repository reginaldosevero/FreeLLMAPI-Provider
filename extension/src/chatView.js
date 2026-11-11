const crypto = require('node:crypto');

function renderChatView(webview, provider) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>FreeLLM Chat</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, var(--vscode-widget-border));
      --muted: var(--vscode-descriptionForeground);
      --surface: var(--vscode-input-background);
      --surface-border: var(--vscode-input-border, transparent);
      --focus: var(--vscode-focusBorder);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font: 13px var(--vscode-font-family);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 4px 2px 12px;
    }
    .message {
      max-width: 88%;
      padding: 8px 12px;
      border-radius: 8px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .message.assistant {
      align-self: flex-start;
      background: var(--vscode-textBlockQuote-background, var(--surface));
      border: 1px solid var(--border);
    }
    .message.status {
      align-self: center;
      color: var(--muted);
      font-style: italic;
      font-size: 12px;
    }
    .composer {
      display: flex;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }
    textarea {
      flex: 1;
      min-height: 38px;
      max-height: 120px;
      resize: vertical;
      padding: 7px 9px;
      color: var(--vscode-input-foreground);
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 4px;
      font: inherit;
      font-family: inherit;
    }
    textarea:focus {
      outline: 1px solid var(--focus);
      outline-offset: 1px;
    }
    button {
      min-height: 38px;
      padding: 0 14px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 4px;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .5; cursor: default; }
  </style>
</head>
<body>
  <div id="messages">
    <div class="message assistant">FreeLLM chat is ready. Ask anything.</div>
  </div>
  <div class="composer">
    <textarea id="input" placeholder="Type a message and press Enter to send" rows="1"></textarea>
    <button id="send" type="button">Send</button>
  </div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const messages = document.getElementById('messages');
      const input = document.getElementById('input');
      const sendButton = document.getElementById('send');

      function addMessage(role, text) {
        const div = document.createElement('div');
        div.className = 'message ' + role;
        div.textContent = text;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
      }

      function setStatus(text) {
        const div = document.createElement('div');
        div.className = 'message status';
        div.textContent = text;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
      }

      function send() {
        const text = input.value.trim();
        if (!text) return;
        addMessage('user', text);
        input.value = '';
        input.style.height = 'auto';
        setStatus('FreeLLM is thinking…');
        vscode.postMessage({ type: 'chat', message: text });
      }

      sendButton.addEventListener('click', send);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
        if (e.key === 'Enter' && e.shiftKey) {
          // allow newline
        }
      });

      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });

      window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data) return;
        if (data.type === 'response') {
          const status = messages.querySelector('.message.status');
          if (status) status.remove();
          addMessage('assistant', data.text || '(no response)');
        } else if (data.type === 'error') {
          const status = messages.querySelector('.message.status');
          if (status) status.remove();
          addMessage('assistant', 'Error: ' + (data.text || 'request failed'));
        }
      });

      // auto-focus the input
      setTimeout(() => input.focus(), 100);
    })();
  </script>
</body>
</html>`;
}

function registerChatView(context, getConfig, provider) {
  const disposables = [];
  const vscode = require('vscode');

  disposables.push(
    vscode.window.registerWebviewViewProvider('freellmapi/chatView', {
      resolveWebviewView(webview, _context, _token) {
        webview.options = {
          enableScripts: true,
        };
        webview.html = renderChatView(webview);

        const sendChat = async (userText) => {
          try {
            const config = await getConfig();
            const endpoint = `${String(config.baseUrl).replace(/\/+$/, '')}/chat/completions`;
            const headers = {
              'Content-Type': 'application/json',
            };
            if (config.apiKey) {
              headers.Authorization = `Bearer ${config.apiKey}`;
            }

            const response = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: config.model || 'auto',
                messages: [{ role: 'user', content: userText }],
                temperature: 0.7,
              }),
            });

            const body = await response.text();
            if (!response.ok) {
              webview.postMessage({
                type: 'error',
                text: `HTTP ${response.status}: ${body.slice(0, 200)}`,
              });
              return;
            }

            const json = JSON.parse(body);
            const text = json?.choices?.[0]?.message?.content || '(no response returned)';
            webview.postMessage({ type: 'response', text });
          } catch (error) {
            webview.postMessage({
              type: 'error',
              text: error instanceof Error ? error.message : String(error),
            });
          }
        };

        webview.onDidReceiveMessage(async (event) => {
          if (event?.type === 'chat' && typeof event.message === 'string') {
            await sendChat(event.message);
          }
        });

        return disposables;
      },
    })
  );

  context.subscriptions.push(...disposables);
}

module.exports = { registerChatView, renderChatView };