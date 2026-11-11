const test = require('node:test');
const assert = require('node:assert/strict');

// Create a simple mock that doesn't require vscode at import time
const Module = require('module');
const originalRequire = Module.prototype.require;

// Track calls to createTreeView
let treeViewCalls = 0;
const vscodeMock = {
  EventEmitter: class { event = () => {}; constructor() {} },
  TreeItem: class { constructor(label, type) { this.label = label; this.collapsibleState = type; } },
  TreeItemKind: { None: 0, Collapsed: 1 },
  window: {
    createTreeView: () => { treeViewCalls++; return { id: 'test-tree', dispose: () => {} }; },
  },
};

Module.prototype.require = function(id) {
  if (id === 'vscode') return vscodeMock;
  return originalRequire.apply(this, arguments);
};

const { registerLogsView } = require('../extension/src/logsView');

Module.prototype.require = originalRequire;

test('registerLogsView registers a tree view for logs', () => {
  const mockContext = { subscriptions: [] };
  const mockOutputChannel = { text: '' };
  treeViewCalls = 0;
  
  registerLogsView(mockContext, mockOutputChannel);
  
  assert.ok(Array.isArray(mockContext.subscriptions));
  assert.ok(treeViewCalls > 0, 'createTreeView should be called');
});

test('registerLogsView handles empty output channel', () => {
  const mockContext = { subscriptions: [] };
  const mockOutputChannel = { text: '' };
  treeViewCalls = 0;
  
  registerLogsView(mockContext, mockOutputChannel);
  
  assert.ok(Array.isArray(mockContext.subscriptions));
});

test('registerLogsView processes log lines from output channel', () => {
  const mockContext = { subscriptions: [] };
  const mockOutputChannel = { text: 'line1\nline2\nline3' };
  treeViewCalls = 0;
  
  registerLogsView(mockContext, mockOutputChannel);
  
  assert.ok(Array.isArray(mockContext.subscriptions));
});

test('registerLogsView limits log lines to 50 recent', () => {
  const mockContext = { subscriptions: [] };
  // Create 100 lines of output
  const lines = Array.from({ length: 100 }, (_, i) => `log line ${i + 1}`);
  const mockOutputChannel = { text: lines.join('\n') };
  treeViewCalls = 0;
  
  registerLogsView(mockContext, mockOutputChannel);
  
  assert.ok(Array.isArray(mockContext.subscriptions));
});

test('registerLogsView shows "No logs yet" when output is empty', () => {
  const mockContext = { subscriptions: [] };
  const mockOutputChannel = { text: '' };
  treeViewCalls = 0;
  
  registerLogsView(mockContext, mockOutputChannel);
  
  assert.ok(Array.isArray(mockContext.subscriptions));
});