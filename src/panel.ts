import * as vscode from 'vscode';
import * as path from 'path';

export class RextResultsPanel {
    public static currentPanel: RextResultsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _resultsHistory: any[] = [];
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'clearHistory':
                        this._resultsHistory = [];
                        break;
                    case 'saveResponse': {
                        const extMap: Record<string, string> = {
                            json: 'json', xml: 'xml', html: 'html',
                            css: 'css', javascript: 'js', text: 'txt'
                        };
                        const ext = extMap[message.format] || 'txt';
                        const uri = await vscode.window.showSaveDialog({
                            defaultUri: vscode.Uri.file(`response.${ext}`),
                            filters: { 'All Files': ['*'], [ext.toUpperCase()]: [ext] }
                        });
                        if (uri) {
                            const fs = require('fs');
                            fs.writeFileSync(uri.fsPath, message.body, 'utf-8');
                            vscode.window.showInformationMessage(`Respuesta guardada en ${uri.fsPath}`);
                        }
                        break;
                    }
                }
            },
            null,
            this._disposables
        );

        this._panel.webview.html = this._getHtmlForWebview();
    }

    private static _extensionUri: vscode.Uri;
    public static setExtensionUri(uri: vscode.Uri) {
        RextResultsPanel._extensionUri = uri;
    }

    private static _ensurePanel() {
        if (RextResultsPanel.currentPanel) {
            RextResultsPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'rextResults',
            'Rext Timeline',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(RextResultsPanel._extensionUri, 'dist', 'webview')
                ]
            }
        );
        RextResultsPanel.currentPanel = new RextResultsPanel(panel, RextResultsPanel._extensionUri);
    }

    public static displayPending(info: { name?: string; method: string; url: string }) {
        RextResultsPanel._ensurePanel();
        const pendingData = {
            _pending: true,
            name: info.name,
            method: info.method,
            url: info.url,
            status: 0,
            data: null,
            headers: {}
        };
        RextResultsPanel.currentPanel!._resultsHistory.unshift(pendingData);
        RextResultsPanel.currentPanel!._panel.webview.postMessage({ type: 'addPending', data: pendingData });
    }

    public static updatePending(data: any) {
        if (!RextResultsPanel.currentPanel) { return; }
        const idx = RextResultsPanel.currentPanel._resultsHistory.findIndex((r: any) => r._pending === true);
        if (idx !== -1) {
            RextResultsPanel.currentPanel._resultsHistory[idx] = data;
        } else {
            RextResultsPanel.currentPanel._resultsHistory.unshift(data);
        }
        RextResultsPanel.currentPanel._panel.webview.postMessage({ type: 'updatePending', data });
    }

    public static display(data: any) {
        RextResultsPanel._ensurePanel();
        RextResultsPanel.currentPanel!._resultsHistory.unshift(data);
        RextResultsPanel.currentPanel!._panel.webview.postMessage({ type: 'display', data });
    }

    public static showDetail(data: any) {
        RextResultsPanel._ensurePanel();
        RextResultsPanel.currentPanel!._panel.webview.postMessage({ type: 'showDetail', data });
    }

    private _getHtmlForWebview() {
        const webview = this._panel.webview;
        const distPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview');

        const panelJs = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'panel.js'));
        const panelCss = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'panel.css'));
        // Shared chunk
        const vscodeJs = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'vscode.js'));

        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <link href="${panelCss}" rel="stylesheet" />
</head>
<body>
    <div id="app"></div>
    <script type="module" src="${vscodeJs}"></script>
    <script type="module" src="${panelJs}"></script>
</body>
</html>`;
    }

    dispose() {
        RextResultsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }
}