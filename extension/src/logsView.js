const vscode = require('vscode');

function registerLogsView(context, outputChannel) {
  const disposables = [];

  const treeDataProvider = {
    onDidChangeTreeData: new vscode.EventEmitter().event,
    getTreeItem: (element) => element,
    getChildren: () => {
      const text = outputChannel ? outputChannel.text : '';
      if (!text) {
        return [new vscode.TreeItem('No logs yet.')];
      }
      const lines = text.split('\n').filter((line) => line.trim());
      const recent = lines.slice(-50);
      return recent.map(
        (line) =>
          new vscode.TreeItem(line.length > 100 ? line.slice(0, 97) + '…' : line, vscode.TreeItemKind.None)
      );
    },
  };

  disposables.push(
    vscode.window.createTreeView('freellmapi/logsView', { treeDataProvider })
  );

  context.subscriptions.push(...disposables);
}

module.exports = { registerLogsView };