const test = require('node:test');
const assert = require('node:assert/strict');
const { renderChatView } = require('../extension/src/chatView');

test('renderChatView returns valid HTML with CSP nonce', () => {
  const mockWebview = {
    cspSource: 'vscode-webview://test',
  };
  const mockProvider = { displayName: 'Test Provider' };
  
  const html = renderChatView(mockWebview, mockProvider);
  
  assert.ok(typeof html === 'string');
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("style-src"));
  assert.ok(html.includes("script-src"));
  assert.ok(html.includes('FreeLLM Chat'));
});

test('renderChatView includes message areas for user and assistant', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const mockProvider = { displayName: 'Test Provider' };
  
  const html = renderChatView(mockWebview, mockProvider);
  
  assert.ok(html.includes('id="messages"'));
  assert.ok(html.includes('class="message assistant"'));
});

test('renderChatView includes send composer', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const mockProvider = { displayName: 'Test Provider' };
  
  const html = renderChatView(mockWebview, mockProvider);
  
  assert.ok(html.includes('id="input"'));
  assert.ok(html.includes('id="send"'));
  assert.ok(html.includes('placeholder="Type a message and press Enter to send"'));
});

test('renderChatView includes JavaScript for chat functionality', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const mockProvider = { displayName: 'Test Provider' };
  
  const html = renderChatView(mockWebview, mockProvider);
  
  assert.ok(html.includes('acquireVsCodeApi()'));
  assert.ok(html.includes('vscode.postMessage'));
});

test('renderChatView has nonce in script tag', () => {
  const mockWebview = { cspSource: 'vscode-webview://test' };
  const mockProvider = { displayName: 'Test Provider' };
  
  const html = renderChatView(mockWebview, mockProvider);
  
  // Check that nonce appears in both CSP and script tag
  const nonceMatch = html.match(/nonce="([a-f0-9]+)"/);
  assert.ok(nonceMatch, 'Nonce should be present');
  const nonce = nonceMatch[1];
  assert.ok(html.includes(`'nonce-${nonce}'`), 'Nonce should be in CSP');
  assert.ok(html.includes(`nonce="${nonce}"`), 'Nonce should be in script tag');
});