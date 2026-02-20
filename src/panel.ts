import * as vscode from 'vscode';

export class RextResultsPanel {
    public static currentPanel: RextResultsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _resultsHistory: any[] = []; // Almacena todas las respuestas de la sesión
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Escuchar mensajes del webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                if (message.command === 'clearHistory') {
                    this._resultsHistory = [];
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Muestra un request en estado "pending" (en progreso) en el panel.
     */
    public static displayPending(info: { name?: string; method: string; url: string }) {
        const pendingData = {
            _pending: true,
            name: info.name,
            method: info.method,
            url: info.url,
            status: 0,
            data: null,
            headers: {}
        };

        if (RextResultsPanel.currentPanel) {
            RextResultsPanel.currentPanel._resultsHistory.unshift(pendingData);
            RextResultsPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            RextResultsPanel.currentPanel._update();
        } else {
            const panel = vscode.window.createWebviewPanel(
                'rextResults',
                'Rext Timeline',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
            RextResultsPanel.currentPanel = new RextResultsPanel(panel);
            RextResultsPanel.currentPanel._resultsHistory.push(pendingData);
            RextResultsPanel.currentPanel._update();
        }
    }

    /**
     * Reemplaza el primer item pending con el resultado final.
     */
    public static updatePending(data: any) {
        if (!RextResultsPanel.currentPanel) { return; }
        const idx = RextResultsPanel.currentPanel._resultsHistory.findIndex((r: any) => r._pending === true);
        if (idx !== -1) {
            RextResultsPanel.currentPanel._resultsHistory[idx] = data;
        } else {
            RextResultsPanel.currentPanel._resultsHistory.unshift(data);
        }
        RextResultsPanel.currentPanel._update();
    }

    public static display(data: any) {
        if (RextResultsPanel.currentPanel) {
            RextResultsPanel.currentPanel._resultsHistory.unshift(data);
            RextResultsPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            RextResultsPanel.currentPanel._update();
        } else {
            const panel = vscode.window.createWebviewPanel(
                'rextResults',
                'Rext Timeline',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
            RextResultsPanel.currentPanel = new RextResultsPanel(panel);
            RextResultsPanel.currentPanel._resultsHistory.push(data);
            RextResultsPanel.currentPanel._update();
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        const historyJson = JSON.stringify(this._resultsHistory);

        return `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
                <style>
                    :root {
                        --bg: var(--vscode-editor-background);
                        --fg: var(--vscode-editor-foreground);
                        --border: var(--vscode-widget-border);
                        --accent: var(--vscode-button-background);
                        --item-hover: var(--vscode-list-hoverBackground);
                    }
                    body { font-family: var(--vscode-font-family); padding: 0; margin: 0; background: var(--bg); color: var(--fg); display: flex; height: 100vh; overflow: hidden; }
                    
                    /* Sidebar */
                    #sidebar { width: 280px; border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; flex-shrink: 0; }
                    .history-header { padding: 12px; font-weight: bold; border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.1); display: flex; justify-content: space-between; }
                    .history-item { padding: 10px; border-bottom: 1px solid var(--border); cursor: pointer; font-size: 0.85em; transition: background 0.2s; }
                    .history-item:hover { background: var(--item-hover); }
                    .history-item.active { background: var(--vscode-list-activeSelectionBackground); border-left: 4px solid var(--accent); opacity: 1; }
                    .method { font-weight: bold; color: #569cd6; margin-right: 5px; }
                    .status-dot { height: 8px; width: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; }
                    .status-2xx { background: #4caf50; box-shadow: 0 0 5px #4caf50; }
                    .status-err { background: #f44336; box-shadow: 0 0 5px #f44336; }
                    .status-pending { background: #2196f3; animation: pulse 1s infinite; }
                    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

                    /* Main Content */
                    #main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
                    .header-bar { padding: 15px; border-bottom: 1px solid var(--border); }
                    .url-display { font-family: monospace; font-size: 1.1em; word-break: break-all; margin-bottom: 10px; }
                    
                    /* Assertions */
                    .assertions-container { margin: 10px 15px; }
                    .assertion-item { padding: 6px 12px; margin-bottom: 4px; border-radius: 4px; font-size: 0.9em; border-left: 4px solid transparent; }
                    .assertion-item.pass { background: rgba(76, 175, 80, 0.1); color: #4caf50; border-left-color: #4caf50; }
                    .assertion-item.fail { background: rgba(244, 67, 54, 0.1); color: #f44336; border-left-color: #f44336; }

                    /* Viewer Area */
                    .viewer-area { flex: 1; overflow-y: auto; padding: 0 15px 20px 15px; }
                    .tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--border); margin-bottom: 15px; }
                    .tab { padding: 8px 5px; cursor: pointer; opacity: 0.6; border-bottom: 2px solid transparent; }
                    .tab.active { opacity: 1; border-bottom-color: var(--accent); font-weight: bold; }
                    
                    .search-box { margin-bottom: 10px; }
                    #search-input { width: 100%; padding: 6px; background: var(--vscode-input-background); color: var(--fg); border: 1px solid var(--border); border-radius: 2px; }
                    
                    table { width: 100%; border-collapse: collapse; }
                    td { padding: 8px; border-bottom: 1px solid var(--border); font-family: monospace; font-size: 0.9em; }
                    pre { margin: 0; padding: 10px !important; border-radius: 4px !important; }
                    mark { background: #ffeb3b; color: #000; }
                    .hidden { display: none; }
                </style>
            </head>
            <body>
                <div id="sidebar">
                    <div class="history-header">
                        <span>Timeline</span>
                        <button onclick="clearHistory()" style="background:none; border:none; color:var(--fg); cursor:pointer; opacity:0.5;">🗑️</button>
                    </div>
                    <div id="history-list"></div>
                </div>

                <div id="main-content">
                    <div class="header-bar">
                        <div id="detail-title" class="url-display">Selecciona una petición</div>
                        <div id="detail-status"></div>
                    </div>
                    
                    <div id="assertions-view" class="assertions-container"></div>

                    <div class="viewer-area">
                        <div class="tabs">
                            <div class="tab active" onclick="switchTab('body')">Body</div>
                            <div class="tab" onclick="switchTab('headers')">Headers</div>
                        </div>

                        <div id="content-body">
                            <div class="search-box">
                                <input type="text" id="search-input" placeholder="Filtrar en respuesta..." oninput="renderDetail()">
                            </div>
                            <pre><code id="code-block" class="language-json"></code></pre>
                        </div>

                        <div id="content-headers" class="hidden">
                            <table id="headers-table"></table>
                        </div>
                    </div>
                </div>

                <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js"></script>
                <script>
                    const vscodeApi = acquireVsCodeApi();
                    let history = ${historyJson};
                    let currentIndex = 0;
                    let currentTab = 'body';

                    function renderHistory() {
                        const list = document.getElementById('history-list');
                        list.innerHTML = history.map((req, i) => {
                            if (req._pending) {
                                return \`
                                    <div class="history-item \${i === currentIndex ? 'active' : ''}" onclick="selectRequest(\${i})">
                                        <span class="status-dot status-pending"></span>
                                        <span class="method">\${req.method?.toUpperCase() || 'GET'}</span>
                                        <span style="opacity:0.8">\${req.name || req.url?.split('/').pop() || 'req'}</span>
                                        <div style="font-size: 0.75em; opacity: 0.7; margin-top: 5px; color: #2196f3;">⏳ En progreso...</div>
                                    </div>
                                \`;
                            }
                            const isOk = req.status >= 200 && req.status < 300;
                            return \`
                                <div class="history-item \${i === currentIndex ? 'active' : ''}" onclick="selectRequest(\${i})">
                                    <span class="status-dot \${isOk ? 'status-2xx' : 'status-err'}"></span>
                                    <span class="method">\${req.method?.toUpperCase() || 'GET'}</span>
                                    <span style="opacity:0.8">\${req.name || req.url?.split('/').pop() || 'req'}</span>
                                    \${req.attempts > 1 ? '<span style="background:#ff9800;color:#000;border-radius:3px;padding:1px 5px;font-size:0.7em;margin-left:5px">⟳ ' + req.attempts + '/' + req.maxAttempts + '</span>' : ''}
                                    <div style="font-size: 0.75em; opacity: 0.5; margin-top: 5px;">\${req.duration != null ? req.duration + 'ms' : ''}</div>
                                </div>
                            \`;
                        }).join('');
                    }

                    function selectRequest(index) {
                        currentIndex = index;
                        renderHistory();
                        renderDetail();
                    }

                    function switchTab(tab) {
                        currentTab = tab;
                        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.innerText.toLowerCase() === tab));
                        document.getElementById('content-body').classList.toggle('hidden', tab !== 'body');
                        document.getElementById('content-headers').classList.toggle('hidden', tab !== 'headers');
                        renderDetail();
                    }

                    function renderDetail() {
                        const req = history[currentIndex];
                        if (!req) return;

                        const searchTerm = document.getElementById('search-input').value.toLowerCase();
                        
                        document.getElementById('detail-title').innerHTML = req.name 
                            ? \`<strong>\${req.name}</strong><br><span style="font-size:0.8em;opacity:0.7">\${req.method || 'GET'} \${req.url || ''}</span>\` 
                            : \`\${req.method || 'GET'} \${req.url || 'URL no disponible'}\`;
                        let statusHtml = \`<strong>Status:</strong> \${req.status}\`;
                        if (req.duration != null) { statusHtml += \` <span style="opacity:0.6;margin-left:10px">⏱ \${req.duration}ms</span>\`; }
                        if (req.attempts > 1) { statusHtml += \` <span style="color:#ff9800;margin-left:10px">⟳ Intento \${req.attempts}/\${req.maxAttempts}</span>\`; }
                        document.getElementById('detail-status').innerHTML = statusHtml;

                        // Render Assertions
                        const assertView = document.getElementById('assertions-view');
                        if (req.assertions && req.assertions.length > 0) {
                            assertView.innerHTML = req.assertions.map(a => \`
                                <div class="assertion-item \${a.pass ? 'pass' : 'fail'}">
                                    \${a.pass ? '✅' : '❌'} \${a.label}
                                </div>
                            \`).join('');
                        } else {
                            assertView.innerHTML = '';
                        }

                        if (currentTab === 'body') {
                            let json = JSON.stringify(req.data, null, 2);
                            const codeBlock = document.getElementById('code-block');
                            
                            if (searchTerm) {
                                // Resaltado de búsqueda
                                const regex = new RegExp('(' + searchTerm + ')', 'gi');
                                const highlighted = json.replace(regex, '<mark>$1</mark>');
                                codeBlock.innerHTML = highlighted;
                            } else {
                                codeBlock.textContent = json;
                                Prism.highlightElement(codeBlock);
                            }
                        } else {
                            const table = document.getElementById('headers-table');
                            table.innerHTML = Object.entries(req.headers)
                                .map(([k, v]) => \`<tr><td><strong>\${k}</strong></td><td>\${v}</td></tr>\`).join('');
                        }
                    }

                    function clearHistory() {
                        history = [];
                        renderHistory();
                        document.getElementById('detail-title').innerText = 'Historial limpio';
                        document.getElementById('assertions-view').innerHTML = '';
                        document.getElementById('code-block').textContent = '';
                        // Notificar a la extensión para limpiar el historial en TypeScript
                        vscodeApi.postMessage({ command: 'clearHistory' });
                    }

                    renderHistory();
                    renderDetail();
                </script>
            </body>
            </html>
        `;
    }

    public dispose() {
        RextResultsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }
}