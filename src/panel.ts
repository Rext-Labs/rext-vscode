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
                    .pre-item { margin-left: 18px; border-left: 2px solid var(--accent); opacity: 0.75; font-size: 0.9em; }
                    .pre-label { padding: 4px 10px; font-size: 0.7em; opacity: 0.5; text-transform: uppercase; letter-spacing: 1px; }
                    .pre-group { margin-bottom: 2px; }
                    .pre-group.collapsed .pre-children { display: none; }
                    .pre-chv { display: inline-block; transition: transform 0.15s; font-size: 8px; }
                    .pre-group:not(.collapsed) .pre-chv { transform: rotate(90deg); }

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
                    
                    .sub-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
                    .sub-tab { padding: 3px 10px; cursor: pointer; opacity: 0.5; font-size: 0.8em; border-radius: 10px; border: 1px solid var(--border); transition: all 0.15s; }
                    .sub-tab:hover { opacity: 0.8; }
                    .sub-tab.active { opacity: 1; background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
                    
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
                            <div class="tab" onclick="switchTab('cookies')">Cookies</div>
                        </div>

                        <div id="content-body">
                            <div class="search-box">
                                <input type="text" id="search-input" placeholder="Filtrar en respuesta..." oninput="renderDetail()">
                            </div>
                            <div class="sub-tabs">
                                <div class="sub-tab active" onclick="switchBodyFormat('json')">JSON</div>
                                <div class="sub-tab" onclick="switchBodyFormat('xml')">XML</div>
                                <div class="sub-tab" onclick="switchBodyFormat('text')">Text</div>
                                <div class="sub-tab" onclick="switchBodyFormat('preview')">Preview</div>
                            </div>
                            <pre><code id="code-block" class="language-json"></code></pre>
                            <div id="preview-frame" class="hidden"></div>
                        </div>

                        <div id="content-headers" class="hidden">
                            <table id="headers-table"></table>
                        </div>

                        <div id="content-cookies" class="hidden">
                            <table id="cookies-table"></table>
                        </div>
                    </div>
                </div>

                <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markup.min.js"></script>
                <script>
                    const vscodeApi = acquireVsCodeApi();
                    let history = ${historyJson};
                    let currentIndex = 0;
                    let currentTab = 'body';
                    let bodyFormat = 'json';
                    let selectedPreResult = null;

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
                            let preHtml = '';
                            if (req.preResults && req.preResults.length > 0) {
                                preHtml = '<div class="pre-group collapsed" onclick="event.stopPropagation();this.classList.toggle(&quot;collapsed&quot;)" style="cursor:pointer">' +
                                    '<div class="pre-label"><span class="pre-chv">▶</span> ⚡ Pre-requests (' + req.preResults.length + ')</div>' +
                                    '<div class="pre-children" onclick="event.stopPropagation()">';
                                preHtml += req.preResults.map((pr, pi) => {
                                    const prOk = pr.status >= 200 && pr.status < 300;
                                    return '<div class="history-item pre-item" onclick="selectPreResult(' + i + ',' + pi + ')" style="cursor:pointer">' +
                                        '<span class="status-dot ' + (prOk ? 'status-2xx' : 'status-err') + '"></span>' +
                                        '<span class="method">' + (pr.method?.toUpperCase() || 'GET') + '</span>' +
                                        '<span style="opacity:0.8">' + (pr.name || 'pre') + '</span>' +
                                        '<div style="font-size:0.7em;opacity:0.5;margin-top:3px">' + (pr.duration != null ? pr.duration + 'ms' : '') + '</div>' +
                                    '</div>';
                                }).join('');
                                preHtml += '</div></div>';
                            }
                            const isOk = req.status >= 200 && req.status < 300;
                            return preHtml + \`
                                <div class="history-item \${i === currentIndex ? 'active' : ''}" onclick="selectRequest(\${i})">
                                    <span class="status-dot \${isOk ? 'status-2xx' : 'status-err'}"></span>
                                    <span class="method">\${req.method?.toUpperCase() || 'GET'}</span>
                                    <span style="opacity:0.8">\${req.name || req.url?.split('/').pop() || 'req'}</span>
                                    \${req.attempts > 1 ? '<span style="background:#ff9800;color:#000;border-radius:3px;padding:1px 5px;font-size:0.7em;margin-left:5px">⟳ ' + req.attempts + '/' + req.maxAttempts + '</span>' : ''}
                                    <div style="font-size: 0.75em; opacity: 0.5; margin-top: 5px;">\${req.duration != null ? req.duration + 'ms' : ''}\${req.size != null ? ' · ' + formatSize(req.size) : ''}</div>
                                </div>
                            \`;
                        }).join('');
                    }

                    function selectRequest(index) {
                        currentIndex = index;
                        selectedPreResult = null;
                        renderHistory();
                        renderDetail();
                    }

                    function selectPreResult(parentIdx, preIdx) {
                        currentIndex = parentIdx;
                        selectedPreResult = history[parentIdx].preResults[preIdx];
                        renderDetail();
                    }

                    function switchBodyFormat(fmt) {
                        bodyFormat = fmt;
                        document.querySelectorAll('.sub-tab').forEach(t => t.classList.toggle('active', t.innerText.toLowerCase() === fmt));
                        renderDetail();
                    }

                    function switchTab(tab) {
                        currentTab = tab;
                        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.innerText.toLowerCase() === tab));
                        document.getElementById('content-body').classList.toggle('hidden', tab !== 'body');
                        document.getElementById('content-headers').classList.toggle('hidden', tab !== 'headers');
                        document.getElementById('content-cookies').classList.toggle('hidden', tab !== 'cookies');
                        renderDetail();
                    }

                    function renderDetail() {
                        const req = selectedPreResult || history[currentIndex];
                        if (!req) return;

                        const searchTerm = document.getElementById('search-input').value.toLowerCase();
                        
                        document.getElementById('detail-title').innerHTML = req.name 
                            ? \`<strong>\${req.name}</strong><br><span style="font-size:0.8em;opacity:0.7">\${req.method || 'GET'} \${req.url || ''}</span>\` 
                            : \`\${req.method || 'GET'} \${req.url || 'URL no disponible'}\`;
                        let statusHtml = \`<strong>Status:</strong> \${req.status}\`;
                        if (req.duration != null) { statusHtml += \` <span style="opacity:0.6;margin-left:10px">⏱ \${req.duration}ms</span>\`; }
                        if (req.size != null) { statusHtml += \` <span style="opacity:0.6;margin-left:10px">📦 \${formatSize(req.size)}</span>\`; }
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
                            const raw = typeof req.data === 'string' ? req.data : JSON.stringify(req.data, null, 2);
                            const codeBlock = document.getElementById('code-block');
                            const previewFrame = document.getElementById('preview-frame');
                            const preEl = codeBlock.parentElement;

                            if (bodyFormat === 'preview') {
                                preEl.classList.add('hidden');
                                previewFrame.classList.remove('hidden');
                                previewFrame.innerHTML = '<iframe sandbox="allow-same-origin" style="width:100%;min-height:400px;border:1px solid var(--border);border-radius:4px;background:#fff" srcdoc="' + raw.replace(/"/g, '&quot;') + '"></iframe>';
                            } else {
                                previewFrame.classList.add('hidden');
                                preEl.classList.remove('hidden');

                                let formatted = raw;
                                let lang = 'json';
                                if (bodyFormat === 'json') {
                                    try { formatted = JSON.stringify(JSON.parse(raw), null, 2); } catch(e) { formatted = raw; }
                                    lang = 'json';
                                } else if (bodyFormat === 'xml') {
                                    lang = 'xml';
                                } else {
                                    lang = 'plaintext';
                                }
                                codeBlock.className = 'language-' + lang;

                                if (searchTerm) {
                                    const regex = new RegExp('(' + searchTerm + ')', 'gi');
                                    codeBlock.innerHTML = formatted.replace(regex, '<mark>$1</mark>');
                                } else {
                                    codeBlock.textContent = formatted;
                                    if (lang !== 'plaintext') { Prism.highlightElement(codeBlock); }
                                }
                            }
                        } else if (currentTab === 'headers') {
                            const table = document.getElementById('headers-table');
                            table.innerHTML = Object.entries(req.headers)
                                .map(([k, v]) => \`<tr><td><strong>\${k}</strong></td><td>\${v}</td></tr>\`).join('');
                        } else if (currentTab === 'cookies') {
                            const table = document.getElementById('cookies-table');
                            if (req.cookies && req.cookies.length > 0) {
                                table.innerHTML = '<tr><td><strong>Name</strong></td><td><strong>Value</strong></td><td><strong>Attributes</strong></td></tr>' +
                                    req.cookies.map(c => \`<tr><td><strong>\${c.name}</strong></td><td style="word-break:break-all">\${c.value}</td><td style="opacity:0.6;font-size:0.85em">\${c.attributes}</td></tr>\`).join('');
                            } else {
                                table.innerHTML = '<tr><td style="opacity:0.5">No cookies in response</td></tr>';
                            }
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

                    function formatSize(bytes) {
                        if (bytes < 1024) return bytes + ' B';
                        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
                    }
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
        // Cerrar el grupo de editor vacío para volver a una sola columna
        vscode.commands.executeCommand('workbench.action.closeEditorsInGroup');
    }
}