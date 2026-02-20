import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseRext, parseRextFull } from './parser';
import { VariableStore } from './variables';
import { EnvironmentManager } from './environment';

interface HistoryEntry {
    id?: string;
    name?: string;
    method: string;
    url: string;
    status: number;
    duration: number;
    timestamp: number;
}

export class RextSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'rext-sidebar-view';
    private _view?: vscode.WebviewView;
    private _history: HistoryEntry[] = [];
    private _globalState: vscode.Memento | undefined;

    private static readonly HISTORY_KEY = 'rext.requestHistory';
    private static readonly MAX_HISTORY = 50;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    init(context: vscode.ExtensionContext) {
        this._globalState = context.globalState;
        this._history = this._globalState.get<HistoryEntry[]>(RextSidebarProvider.HISTORY_KEY, []);
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'openFile': {
                    const doc = await vscode.workspace.openTextDocument(msg.filePath);
                    const editor = await vscode.window.showTextDocument(doc);
                    if (msg.line !== undefined) {
                        const pos = new vscode.Position(msg.line, 0);
                        editor.selection = new vscode.Selection(pos, pos);
                        editor.revealRange(new vscode.Range(pos, pos));
                    }
                    break;
                }
                case 'switchEnv':
                    await EnvironmentManager.setActiveEnvironment(msg.envName);
                    this.refresh();
                    break;
                case 'clearHistory':
                    this._history = [];
                    this._globalState?.update(RextSidebarProvider.HISTORY_KEY, []);
                    this.refresh();
                    break;
                case 'refresh':
                    this.refresh();
                    break;
                case 'runRequest':
                    vscode.commands.executeCommand('rext.runFromSidebar', msg.filePath, msg.requestIndex);
                    break;
                case 'renameRequest': {
                    const newName = await vscode.window.showInputBox({
                        prompt: 'New request name',
                        value: msg.currentName || ''
                    });
                    if (newName !== undefined) {
                        await this._modifyRequestDirective(msg.filePath, msg.line, '@name', newName);
                    }
                    break;
                }
                case 'moveToCollection': {
                    const collections = await this._getAllCollections();
                    const items = [...collections, '$(add) New collection…'];
                    let target = await vscode.window.showQuickPick(items, { placeHolder: 'Move to which collection?' });
                    if (target === '$(add) New collection…') {
                        target = await vscode.window.showInputBox({ prompt: 'New collection name' });
                    }
                    if (target) {
                        await this._modifyRequestDirective(msg.filePath, msg.line, '@collection', target);
                    }
                    break;
                }
                case 'moveRequestToCollection': {
                    if (msg.targetCollection) {
                        await this._modifyRequestDirective(msg.filePath, msg.line, '@collection', msg.targetCollection);
                    }
                    break;
                }
                case 'newRequest': {
                    const doc = await vscode.workspace.openTextDocument(msg.filePath);
                    const edit = new vscode.WorkspaceEdit();
                    const lastLine = doc.lineCount;
                    edit.insert(vscode.Uri.file(msg.filePath), new vscode.Position(lastLine, 0), '\n###\n@name New Request\nGET {{baseUrl}}/\n');
                    await vscode.workspace.applyEdit(edit);
                    await doc.save();
                    this.refresh();
                    break;
                }
                case 'runAllFile': {
                    const filePath = msg.filePath;
                    const fileContent = fs.readFileSync(filePath, 'utf-8');
                    const { parseRext } = require('./parser');
                    const { runRequest } = require('./runner');
                    const { EnvironmentManager } = require('./environment');
                    const { VariableStore } = require('./variables');
                    const { RextResultsPanel } = require('./panel');

                    EnvironmentManager.loadActiveEnvironment();
                    VariableStore.loadCollection(filePath);

                    const requests = parseRext(fileContent);
                    for (const req of requests) {
                        RextResultsPanel.displayPending({
                            name: req.name,
                            method: req.method,
                            url: VariableStore.replaceInString(req.url)
                        });
                        const result = await runRequest(req, requests);
                        RextResultsPanel.updatePending(result);
                        this.addHistoryEntry(result, req.id);
                    }
                    this.refresh();
                    break;
                }
            }
        });
    }

    addHistoryEntry(result: any, requestId?: string) {
        const entry: any = {
            id: requestId,
            name: result.name,
            method: result.method || 'GET',
            url: result.url || '',
            status: result.status || 0,
            duration: result.duration || 0,
            timestamp: Date.now()
        };
        if (result.preResults && result.preResults.length > 0) {
            entry.preResults = result.preResults.map((pr: any) => ({
                name: pr.name || 'pre',
                method: pr.method || 'GET',
                status: pr.status || 0,
                duration: pr.duration || 0
            }));
        }
        this._history.unshift(entry);
        if (this._history.length > RextSidebarProvider.MAX_HISTORY) {
            this._history.length = RextSidebarProvider.MAX_HISTORY;
        }
        this._globalState?.update(RextSidebarProvider.HISTORY_KEY, this._history);
        this.refresh();
    }

    async refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtml();
            const explorerData = await this._getExplorerData();
            this._view.webview.postMessage({ type: 'explorerData', data: explorerData });
        }
    }

    private async _getExplorerData() {
        const files: any[] = [];
        const allConfigs: any[] = [];
        const uris = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
        for (const uri of uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                const { requests: parsed, configs } = parseRextFull(content);
                const requests = parsed.map(r => ({
                    id: r.id,
                    name: r.name || r.method + ' ' + r.url,
                    method: r.method,
                    line: r.startLine,
                    collection: r.collection,
                    group: r.group,
                    tags: r.tags,
                    deprecated: r.deprecated
                }));
                files.push({
                    name: path.basename(uri.fsPath),
                    path: uri.fsPath,
                    requests
                });
                configs.forEach(c => allConfigs.push({
                    collection: c.collection,
                    baseUrl: c.baseUrl,
                    headers: c.headers,
                    timeout: c.timeout,
                    retries: c.retries,
                    assertions: c.assertions,
                    filePath: uri.fsPath,
                    startLine: c.startLine,
                    endLine: c.endLine
                }));
            } catch { /* skip */ }
        }
        return { files, configs: allConfigs };
    }
    private async _modifyRequestDirective(filePath: string, requestLine: number, directive: string, value: string) {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const lines = doc.getText().split(/\r?\n/);
        const edit = new vscode.WorkspaceEdit();

        // Find the request block boundaries
        let blockStart = requestLine;
        let blockEnd = lines.length - 1;
        // Walk up to find ### or start
        while (blockStart > 0 && !lines[blockStart].trim().startsWith('###')) {
            blockStart--;
        }
        // Walk down to find next ### or end
        for (let i = requestLine + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('###')) { blockEnd = i - 1; break; }
        }

        // Look for existing directive in the block
        let found = false;
        for (let i = blockStart; i <= blockEnd; i++) {
            const t = lines[i].trim();
            if (t.startsWith(directive)) {
                const range = new vscode.Range(i, 0, i, lines[i].length);
                edit.replace(uri, range, `${directive} ${value}`);
                found = true;
                break;
            }
        }

        // If not found, insert after ### or at blockStart
        if (!found) {
            let insertLine = blockStart;
            if (lines[blockStart]?.trim().startsWith('###')) {
                insertLine = blockStart + 1;
            }
            // Skip @id if present
            while (insertLine <= blockEnd && lines[insertLine]?.trim().startsWith('@id')) {
                insertLine++;
            }
            edit.insert(uri, new vscode.Position(insertLine, 0), `${directive} ${value}\n`);
        }

        await vscode.workspace.applyEdit(edit);
        await doc.save();
        this.refresh();
    }

    private async _getAllCollections(): Promise<string[]> {
        const collections = new Set<string>();
        const uris = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
        for (const uri of uris) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                const requests = parseRext(content);
                for (const r of requests) {
                    if (r.collection) { collections.add(r.collection); }
                }
            } catch { /* skip */ }
        }
        return [...collections].sort();
    }

    private _getHtml(): string {
        const data = {
            history: this._history,
            envs: EnvironmentManager.getEnvironmentNames(),
            activeEnv: EnvironmentManager.getActiveEnvironment(),
            vars: {
                session: VariableStore.getScopeVars('session'),
                collection: VariableStore.getScopeVars('collection'),
                env: VariableStore.getScopeVars('env'),
                global: VariableStore.getScopeVars('global')
            }
        };

        this._loadExplorerAsync();

        return /*html*/`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--vscode-font-family);font-size:12px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);overflow:hidden;height:100vh;display:flex;flex-direction:column}

.header{padding:10px 10px 0;flex-shrink:0}
.header-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.header-top h3{margin:0;font-size:13px;font-weight:600;opacity:.8}
.env-chip{font-size:9px;padding:2px 8px;border-radius:10px;background:rgba(78,201,112,.15);color:#4ec970;font-weight:600;letter-spacing:.3px;text-transform:uppercase}
.tab-bar{display:flex;gap:2px;background:var(--vscode-input-background);border-radius:6px;padding:3px;margin-bottom:8px}
.tab{flex:1;padding:5px 2px;text-align:center;cursor:pointer;border-radius:4px;font-size:11px;opacity:.55;transition:all .15s;user-select:none}
.tab:hover{opacity:.85}
.tab.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);opacity:1;font-weight:600}

.filter-bar{position:relative;margin-bottom:6px}
.filter-bar input{width:100%;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);color:var(--vscode-input-foreground);padding:5px 8px 5px 26px;border-radius:4px;font-size:11px;outline:none}
.filter-bar input:focus{border-color:var(--vscode-focusBorder)}
.filter-bar .si{position:absolute;left:8px;top:50%;transform:translateY(-50%);opacity:.4;font-size:11px}

.content{flex:1;overflow-y:auto;padding:0 6px 6px}
.panel{display:none}.panel.active{display:block}

.toolbar{display:flex;justify-content:space-between;align-items:center;padding:4px 6px;margin-bottom:4px}
.toolbar-label{font-size:10px;text-transform:uppercase;opacity:.45;letter-spacing:.5px;font-weight:600}
.tb{background:none;border:none;color:var(--vscode-foreground);cursor:pointer;opacity:.5;padding:3px 5px;border-radius:3px;font-size:13px;transition:all .15s}
.tb:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground)}

.file-group{margin-bottom:2px}
.fh{padding:5px 8px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:6px;font-size:12px;transition:background .1s}
.fh:hover{background:var(--vscode-list-hoverBackground)}
.chv{font-size:10px;opacity:.4;transition:transform .15s;display:inline-block}
.chv.open{transform:rotate(90deg)}
.fn{font-weight:500}
.rc{opacity:.35;font-size:10px;margin-left:4px}
.fr{padding-left:8px}

.ri{padding:4px 8px;cursor:pointer;border-radius:3px;display:flex;align-items:center;gap:8px;font-size:11px;transition:background .1s;position:relative}
.ri:hover{background:var(--vscode-list-hoverBackground)}

.mb{font-weight:700;font-size:9px;padding:2px 5px;border-radius:3px;min-width:36px;text-align:center;letter-spacing:.3px}
.b-GET{background:rgba(76,175,80,.15);color:#4caf50}
.b-POST{background:rgba(255,152,0,.15);color:#ff9800}
.b-PUT{background:rgba(33,150,243,.15);color:#2196f3}
.b-DELETE{background:rgba(244,67,54,.15);color:#f44336}
.b-PATCH{background:rgba(156,39,176,.15);color:#9c27b0}
.rn{opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}

.play-btn{margin-left:auto;background:none;border:none;color:#4caf50;cursor:pointer;font-size:10px;padding:2px 4px;border-radius:3px;opacity:0;transition:opacity .15s;flex-shrink:0}
.ri:hover .play-btn{opacity:.7}
.play-btn:hover{opacity:1!important;background:rgba(76,175,80,.15)}

.hi{padding:7px 8px;border-radius:4px;display:flex;align-items:center;gap:8px;margin-bottom:2px;transition:background .1s;flex-wrap:wrap}
.hi:hover{background:var(--vscode-list-hoverBackground)}
.pre-group{width:100%}
.pre-group.collapsed .pre-children{display:none}
.pre-group.collapsed .chv{transform:rotate(0deg)!important}
.pre-group .chv{transform:rotate(90deg);transition:transform .15s;display:inline-block}
.sb{font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;min-width:28px;text-align:center}
.s2{background:rgba(76,175,80,.15);color:#4caf50}
.s4{background:rgba(244,67,54,.15);color:#f44336}
.s5{background:rgba(255,152,0,.15);color:#ff9800}
.hinfo{flex:1;min-width:0}
.hn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}
.hm{font-size:10px;opacity:.35;margin-top:2px}
.hd{margin-left:auto;font-size:10px;opacity:.45;white-space:nowrap}

.ei{padding:8px 10px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:10px;margin-bottom:2px;transition:all .15s;border:1px solid transparent}
.ei:hover{background:var(--vscode-list-hoverBackground)}
.ei.ae{background:rgba(76,175,80,.08);border-color:rgba(76,175,80,.2)}
.ed{width:8px;height:8px;border-radius:50%;background:var(--vscode-foreground);opacity:.25;flex-shrink:0}
.ei.ae .ed{background:#4caf50;opacity:1;box-shadow:0 0 6px rgba(76,175,80,.4)}
.ename{font-weight:500}
.atag{margin-left:auto;font-size:9px;background:rgba(76,175,80,.15);color:#4caf50;padding:1px 6px;border-radius:3px;font-weight:600}

.ss{margin-bottom:6px}
.sh{padding:5px 8px;font-weight:600;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:6px;border-radius:4px;transition:background .1s}
.sh:hover{background:var(--vscode-list-hoverBackground)}
.sc{margin-left:auto;font-size:9px;opacity:.35;font-weight:normal;background:var(--vscode-input-background);padding:1px 5px;border-radius:8px}
.vi{padding:3px 8px 3px 24px;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;display:flex;gap:4px;line-height:1.5}
.vk{color:#569cd6}.ve{opacity:.25}.vv{opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em{padding:24px 12px;text-align:center;opacity:.35;font-style:italic;font-size:11px}

.tag-badge{font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(86,156,214,.15);color:#569cd6;margin-left:2px}
.ri.dep{opacity:.45;text-decoration:line-through}
.ri.dep .rn{text-decoration:line-through}
.grp-header{padding:4px 8px 4px 16px;cursor:pointer;border-radius:3px;display:flex;align-items:center;gap:6px;font-size:11px;opacity:.7;font-weight:500}
.grp-header:hover{background:var(--vscode-list-hoverBackground)}
.grp-children{padding-left:6px}
.coll-header{padding:6px 8px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;transition:background .1s}
.coll-header:hover{background:var(--vscode-list-hoverBackground)}
.coll-children{padding-left:4px}
.coll-icon{width:14px;height:14px;opacity:.7;flex-shrink:0}
.grp-icon{width:12px;height:12px;opacity:.6;flex-shrink:0}
.uncoll .coll-icon{opacity:.35}

.ctx-menu{position:fixed;background:var(--vscode-menu-background,#252526);border:1px solid var(--vscode-menu-border,#454545);border-radius:5px;padding:4px 0;box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:999;min-width:160px;font-size:12px}
.ctx-item{padding:6px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background .1s}
.ctx-item:hover{background:var(--vscode-menu-selectionBackground,#094771)}
.ctx-sep{height:1px;margin:4px 8px;background:var(--vscode-menu-separatorBackground,#454545)}
.drag-over{outline:2px dashed #4ec970;outline-offset:-2px;background:rgba(78,201,112,.08)!important;border-radius:4px}
.cfg-gear{margin-left:auto;opacity:.3;cursor:pointer;transition:opacity .15s;display:flex;align-items:center}
.cfg-gear:hover{opacity:.8}
.cfg-gear svg{width:14px;height:14px}
.cfg-body{padding:4px 0 4px 4px}
.cfg-row{font-size:10px;padding:2px 4px;display:flex;gap:6px;align-items:baseline}
.cfg-key{color:#4ec970;font-weight:600;min-width:55px}
.cfg-val{opacity:.8}
.cfg-indent{padding-left:16px}
.cfg-hk{color:var(--vscode-symbolIcon-propertyForeground,#9cdcfe);opacity:.8}
.cfg-hv{opacity:.65}

.content::-webkit-scrollbar{width:5px}
.content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:3px}
.content::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.15)}
</style></head>
<body>
<div class="header">
  <div class="header-top"><h3>Rext</h3>${data.activeEnv ? `<span class="env-chip">${data.activeEnv}</span>` : ''}</div>
  <div class="tab-bar" id="tabBar">
    <div class="tab active" data-tab="explorer">Files</div>
    <div class="tab" data-tab="collections">Collections</div>
    <div class="tab" data-tab="history">Activity</div>
    <div class="tab" data-tab="envs">Env</div>
    <div class="tab" data-tab="vars">Vars</div>
  </div>
  <div class="filter-bar"><span class="si">🔍</span><input id="fi" placeholder="Filter..."/></div>
</div>
<div class="content">
  <div id="p-explorer" class="panel active">
    <div class="toolbar"><span class="toolbar-label">Files</span><div><button class="tb" id="btnRefresh">↻</button></div></div>
    <div id="ec"></div>
  </div>
  <div id="p-collections" class="panel">
    <div class="toolbar"><span class="toolbar-label">Collections</span><div><button class="tb" id="btnRefreshCol">↻</button></div></div>
    <div id="cc"></div>
  </div>
  <div id="p-history" class="panel">
    <div class="toolbar"><span class="toolbar-label">Recent Requests</span><div><button class="tb" id="btnClear">🗑</button></div></div>
    <div id="hc"></div>
  </div>
  <div id="p-envs" class="panel">
    <div class="toolbar"><span class="toolbar-label">Environments</span></div>
    <div id="nc"></div>
  </div>
  <div id="p-vars" class="panel">
    <div class="toolbar"><span class="toolbar-label">Variables</span><div><button class="tb" id="btnRefreshVars">↻</button></div></div>
    <div id="vc"></div>
  </div>
</div>
<script>
(function(){
  const vscode = acquireVsCodeApi();
  let explorerData = {files:[]};
  const data = ${JSON.stringify(data)};
  let filterText = '';

  // --- Tab switching ---
  document.getElementById('tabBar').addEventListener('click', function(e) {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('p-' + tabName).classList.add('active');
  });

  // --- Filter ---
  document.getElementById('fi').addEventListener('input', function(e) {
    filterText = e.target.value.toLowerCase();
    renderExplorer();
    renderCollections();
    renderHistory();
  });

  // --- Toolbar buttons ---
  document.getElementById('btnRefresh').addEventListener('click', function() {
    vscode.postMessage({command:'refresh'});
  });
  document.getElementById('btnRefreshCol').addEventListener('click', function() {
    vscode.postMessage({command:'refresh'});
  });
  document.getElementById('btnClear').addEventListener('click', function() {
    vscode.postMessage({command:'clearHistory'});
  });
  document.getElementById('btnRefreshVars').addEventListener('click', function() {
    vscode.postMessage({command:'refresh'});
  });

  // --- Event delegation for dynamic content ---
  document.addEventListener('click', function(e) {
    const target = e.target;

    // Close context menu
    const ctxMenu = document.querySelector('.ctx-menu');
    if (ctxMenu && !ctxMenu.contains(target)) {
      ctxMenu.remove();
    }

    // Play button
    const playBtn = target.closest('.play-btn');
    if (playBtn) {
      e.stopPropagation();
      const ri = playBtn.closest('.ri');
      vscode.postMessage({command:'runRequest', filePath: ri.dataset.file, requestIndex: parseInt(ri.dataset.idx)});
      return;
    }

    // Request item click (open file)
    // Config gear click
    const gear = target.closest('.cfg-gear');
    if (gear) {
      e.stopPropagation();
      var collChildren = gear.closest('.coll-header').nextElementSibling;
      var body = collChildren.querySelector('.cfg-body');
      if (body) { body.style.display = body.style.display === 'none' ? 'block' : 'none'; }
      return;
    }

    const ri = target.closest('.ri');
    if (ri && !target.closest('.play-btn')) {
      vscode.postMessage({command:'openFile', filePath: ri.dataset.file, line: parseInt(ri.dataset.line)});
      return;
    }

    // Scope header toggle
    const sh = target.closest('.sh');
    if (sh) {
      const chv = sh.querySelector('.chv');
      const sv = sh.nextElementSibling;
      if (sv.style.display === 'none') {
        sv.style.display = 'block';
        chv.classList.add('open');
      } else {
        sv.style.display = 'none';
        chv.classList.remove('open');
      }
      return;
    }

    // Env item click
    const ei = target.closest('.ei');
    if (ei) {
      vscode.postMessage({command:'switchEnv', envName: ei.dataset.env});
      return;
    }

    // Context menu item
    const ctxItem = target.closest('.ctx-item');
    if (ctxItem) {
      const action = ctxItem.dataset.action;
      const fp = ctxItem.dataset.file;
      if (action === 'run') {
        vscode.postMessage({command:'runRequest', filePath: fp, requestIndex: parseInt(ctxItem.dataset.idx)});
      } else if (action === 'open') {
        vscode.postMessage({command:'openFile', filePath: fp, line: parseInt(ctxItem.dataset.line)});
      } else if (action === 'rename') {
        vscode.postMessage({command:'renameRequest', filePath: fp, line: parseInt(ctxItem.dataset.line), currentName: ctxItem.dataset.currentname});
      } else if (action === 'move') {
        vscode.postMessage({command:'moveToCollection', filePath: fp, line: parseInt(ctxItem.dataset.line)});
      } else if (action === 'newRequest') {
        vscode.postMessage({command:'newRequest', filePath: fp});
      } else if (action === 'runAllFile') {
        vscode.postMessage({command:'runAllFile', filePath: fp});
      }
      const menu = document.querySelector('.ctx-menu');
      if (menu) menu.remove();
      return;
    }
  });

  // --- Context menu ---
  document.addEventListener('contextmenu', function(e) {
    // File header context menu
    const fh = e.target.closest('.fh');
    if (fh) {
      e.preventDefault();
      const old = document.querySelector('.ctx-menu');
      if (old) old.remove();
      const fp = fh.dataset.file;
      const menu = document.createElement('div');
      menu.className = 'ctx-menu';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.innerHTML =
        '<div class="ctx-item" data-action="runAllFile" data-file="' + esc(fp) + '">▶▶ Run All</div>' +
        '<div class="ctx-item" data-action="open" data-file="' + esc(fp) + '" data-line="0">📄 Open in Editor</div>' +
        '<div class="ctx-sep"></div>' +
        '<div class="ctx-item" data-action="newRequest" data-file="' + esc(fp) + '">➕ New Request</div>';
      document.body.appendChild(menu);
      return;
    }

    // Request item context menu
    const ri = e.target.closest('.ri');
    if (!ri) return;
    e.preventDefault();
    const old = document.querySelector('.ctx-menu');
    if (old) old.remove();

    const fp = ri.dataset.file;
    const ln = ri.dataset.line;
    const idx = ri.dataset.idx;
    const nm = ri.dataset.name || '';

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML =
      '<div class="ctx-item" data-action="run" data-file="' + esc(fp) + '" data-idx="' + idx + '">▶ Run</div>' +
      '<div class="ctx-item" data-action="open" data-file="' + esc(fp) + '" data-line="' + ln + '">📄 Open in Editor</div>' +
      '<div class="ctx-sep"></div>' +
      '<div class="ctx-item" data-action="rename" data-file="' + esc(fp) + '" data-line="' + ln + '" data-currentname="' + esc(nm) + '">✏️ Rename</div>' +
      '<div class="ctx-item" data-action="move" data-file="' + esc(fp) + '" data-line="' + ln + '">📁 Move to Collection…</div>' +
      '<div class="ctx-sep"></div>' +
      '<div class="ctx-item" data-action="newRequest" data-file="' + esc(fp) + '">➕ New Request</div>';
    document.body.appendChild(menu);
  });

  // --- Drag & Drop ---
  document.addEventListener('dragstart', function(e) {
    var ri = e.target.closest('.ri');
    if (!ri) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({
      file: ri.dataset.file,
      line: parseInt(ri.dataset.line),
      name: ri.dataset.name
    }));
    e.dataTransfer.effectAllowed = 'move';
    ri.style.opacity = '0.4';
    setTimeout(function() { ri.style.opacity = ''; }, 300);
  });

  document.addEventListener('dragover', function(e) {
    var ch = e.target.closest('.coll-header');
    if (ch) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ch.classList.add('drag-over'); }
  });

  document.addEventListener('dragleave', function(e) {
    var ch = e.target.closest('.coll-header');
    if (ch) ch.classList.remove('drag-over');
  });

  document.addEventListener('drop', function(e) {
    var ch = e.target.closest('.coll-header');
    if (!ch) return;
    e.preventDefault();
    ch.classList.remove('drag-over');
    try {
      var payload = JSON.parse(e.dataTransfer.getData('text/plain'));
      // Get collection name from the header text (skip chevron and icon)
      var spans = ch.querySelectorAll('span');
      var colName = '';
      for (var i = 0; i < spans.length; i++) {
        if (!spans[i].classList.contains('chv') && !spans[i].classList.contains('rc')) {
          colName = spans[i].textContent.trim();
          break;
        }
      }
      if (colName && colName !== 'Uncollected') {
        vscode.postMessage({
          command: 'moveRequestToCollection',
          filePath: payload.file,
          line: payload.line,
          targetCollection: colName
        });
      }
    } catch(err) {}
  });

  function esc(s) { return (s||'').replace(/"/g, '&quot;'); }
  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // --- Files (flat) ---
  function renderExplorer() {
    var c = document.getElementById('ec');
    if (!explorerData.files.length) { c.innerHTML = '<div class="em">No .rext files found</div>'; return; }
    var html = '';
    explorerData.files.forEach(function(f) {
      var reqs = f.requests.filter(function(r) {
        return !filterText || r.name.toLowerCase().indexOf(filterText) !== -1 || r.method.toLowerCase().indexOf(filterText) !== -1;
      });
      if (filterText && !reqs.length) return;
      html += '<div class="file-group"><div class="fh" data-file="' + esc(f.path) + '" onclick="toggleNext(this)"><span class="chv open">\u25b6</span><span class="fn">' + escHtml(f.name) + '</span><span class="rc">' + f.requests.length + '</span></div><div class="fr">';
      reqs.forEach(function(r, i) { html += renderReqItem(f, r, i); });
      html += '</div></div>';
    });
    c.innerHTML = html;
  }

  // --- Collections (hierarchical, by request.collection) ---
  function renderCollections() {
    var c = document.getElementById('cc');
    if (!explorerData.files.length) { c.innerHTML = '<div class="em">No .rext files found</div>'; return; }

    var collections = {};
    var uncollectedReqs = [];
    explorerData.files.forEach(function(f) {
      f.requests.forEach(function(r, i) {
        var ok = !filterText || r.name.toLowerCase().indexOf(filterText) !== -1 || r.method.toLowerCase().indexOf(filterText) !== -1 || (r.tags && r.tags.some(function(t){return t.toLowerCase().indexOf(filterText) !== -1}));
        if (!ok) return;
        var item = {r:r, idx:i, file:f};
        if (r.collection) {
          if (!collections[r.collection]) collections[r.collection] = [];
          collections[r.collection].push(item);
        } else {
          uncollectedReqs.push(item);
        }
      });
    });

    var html = '';
    var cfgs = explorerData.configs || [];
    Object.keys(collections).forEach(function(colName) {
      var items = collections[colName];
      var cfg = cfgs.find(function(c) { return c.collection === colName; }) || cfgs.find(function(c) { return !c.collection; });
      var gearBtn = cfg ? '<span class="cfg-gear" title="Config"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.3.7L2 7.4v1.2l2.4.5.3.7-1.3 2 .8.8 2-1.3.7.3.5 2.4h1.2l.5-2.4.7-.3 2 1.3.8-.8-1.3-2 .3-.7 2.4-.5V7.4l-2.4-.5-.3-.7 1.3-2-.8-.8-2 1.3-.7-.3zM9.4 1l.5 2.4L12 2.1l2 2-1.3 2.1 2.4.5v2.8l-2.4.5L14 12l-2 2-2.1-1.3-.5 2.4H6.6l-.5-2.4L4 14l-2-2 1.3-2.1L1 9.4V6.6l2.4-.5L2.1 4l2-2 2.1 1.3L6.6 1h2.8zM8 10a2 2 0 100-4 2 2 0 000 4z"/></svg></span>' : '';
      var configBody = '';
      if (cfg) {
        configBody = '<div class="cfg-body" style="display:none">';
        if (cfg.baseUrl) configBody += '<div class="cfg-row"><span class="cfg-key">baseUrl</span><span class="cfg-val">' + escHtml(cfg.baseUrl) + '</span></div>';
        if (cfg.timeout) configBody += '<div class="cfg-row"><span class="cfg-key">timeout</span><span class="cfg-val">' + cfg.timeout + 'ms</span></div>';
        if (cfg.retries) configBody += '<div class="cfg-row"><span class="cfg-key">retries</span><span class="cfg-val">' + cfg.retries + '</span></div>';
        if (cfg.headers && Object.keys(cfg.headers).length) {
          configBody += '<div class="cfg-row"><span class="cfg-key">headers</span></div>';
          Object.keys(cfg.headers).forEach(function(k) { configBody += '<div class="cfg-row cfg-indent"><span class="cfg-hk">' + escHtml(k) + ':</span> <span class="cfg-hv">' + escHtml(cfg.headers[k]) + '</span></div>'; });
        }
        if (cfg.assertions && cfg.assertions.length) {
          configBody += '<div class="cfg-row"><span class="cfg-key">assert</span></div>';
          cfg.assertions.forEach(function(a) { configBody += '<div class="cfg-row cfg-indent"><span class="cfg-hv">' + escHtml(a.type + ' == ' + a.expected) + '</span></div>'; });
        }
        configBody += '</div>';
      }
      html += '<div class="file-group"><div class="coll-header" onclick="toggleNext(this)"><span class="chv open">\\u25b6</span><svg class="coll-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8.49V13h-12V7h12v4.49z"/></svg><span>' + escHtml(colName) + '</span><span class="rc">' + items.length + '</span>' + gearBtn + '</div><div class="coll-children">' + configBody;
      var groups = {};
      var ungrouped = [];
      items.forEach(function(item) {
        if (item.r.group) {
          var parts = item.r.group.split('/').map(function(p){return p.trim()});
          var key = parts[0];
          if (!groups[key]) groups[key] = {subs:{}, reqs:[]};
          if (parts.length > 1) {
            var sub = parts.slice(1).join(' / ');
            if (!groups[key].subs[sub]) groups[key].subs[sub] = [];
            groups[key].subs[sub].push(item);
          } else { groups[key].reqs.push(item); }
        } else { ungrouped.push(item); }
      });
      Object.keys(groups).forEach(function(gName) {
        var g = groups[gName];
        html += '<div class="grp-header" onclick="toggleNext(this)"><span class="chv open">\u25b6</span><svg class="grp-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8.49V13h-12V7h12v4.49z"/></svg>' + escHtml(gName) + '</div><div class="grp-children">';
        Object.keys(g.subs).forEach(function(sName) {
          html += '<div class="grp-header" onclick="toggleNext(this)"><span class="chv open">\u25b6</span><svg class="grp-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8.49V13h-12V7h12v4.49z"/></svg>' + escHtml(sName) + '</div><div class="grp-children">';
          g.subs[sName].forEach(function(it) { html += renderReqItem(it.file, it.r, it.idx); });
          html += '</div>';
        });
        g.reqs.forEach(function(it) { html += renderReqItem(it.file, it.r, it.idx); });
        html += '</div>';
      });
      ungrouped.forEach(function(it) { html += renderReqItem(it.file, it.r, it.idx); });
      html += '</div></div>';
    });

    if (uncollectedReqs.length) {
      html += '<div class="file-group uncoll"><div class="coll-header" onclick="toggleNext(this)" style="opacity:.5"><span class="chv open">\u25b6</span><svg class="coll-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM2 8a6 6 0 1112 0A6 6 0 012 8z"/><path d="M5 7h6v2H5z"/></svg><span>Uncollected</span><span class="rc">' + uncollectedReqs.length + '</span></div><div class="coll-children">';
      uncollectedReqs.forEach(function(it) { html += renderReqItem(it.file, it.r, it.idx); });
      html += '</div></div>';
    }

    c.innerHTML = html || '<div class="em">No collections found. Add @collection to your .rext files.</div>';
  }

  function renderReqItem(f, r, idx) {
    var depClass = r.deprecated ? ' dep' : '';
    var tags = '';
    if (r.tags && r.tags.length) {
      r.tags.forEach(function(t) { tags += '<span class="tag-badge">' + escHtml(t) + '</span>'; });
    }
    return '<div class="ri' + depClass + '" draggable="true" data-file="' + esc(f.path) + '" data-line="' + r.line + '" data-idx="' + idx + '" data-name="' + esc(r.name) + '" data-collection="' + esc(r.collection || '') + '"><span class="mb b-' + r.method + '">' + r.method + '</span><span class="rn">' + escHtml(r.name) + '</span>' + tags + '<button class="play-btn" title="Run">▶</button></div>';
  }

  function toggleNext(el) {
    var chv = el.querySelector('.chv');
    var next = el.nextElementSibling;
    if (next.style.display === 'none') {
      next.style.display = 'block';
      chv.classList.add('open');
    } else {
      next.style.display = 'none';
      chv.classList.remove('open');
    }
  }

  function toggleCfg(gearEl) {
    var collChildren = gearEl.closest('.coll-header').nextElementSibling;
    var body = collChildren.querySelector('.cfg-body');
    if (body) {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    }
  }

  function renderHistory() {
    var c = document.getElementById('hc');
    if (!data.history.length) { c.innerHTML = '<div class="em">No requests yet</div>'; return; }
    var html = '';
    data.history.forEach(function(h, idx) {
      if (filterText && (h.name||h.url).toLowerCase().indexOf(filterText) === -1 && h.method.toLowerCase().indexOf(filterText) === -1) return;
      var sc = h.status >= 200 && h.status < 300 ? 's2' : h.status >= 500 ? 's5' : 's4';
      var nm = h.name || (h.url.split('/').pop()) || h.url;
      var tm = new Date(h.timestamp).toLocaleTimeString();
      // Pre-results
      var preHtml = '';
      if (h.preResults && h.preResults.length > 0) {
        preHtml += '<div class="pre-group collapsed" onclick="event.stopPropagation();this.classList.toggle(&quot;collapsed&quot;)" style="cursor:pointer;margin-top:4px">';
        preHtml += '<div style="font-size:0.7em;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;padding:2px 0"><span class="chv open" style="font-size:8px;margin-right:4px">▶</span>⚡ Pre-requests (' + h.preResults.length + ')</div>';
        preHtml += '<div class="pre-children" onclick="event.stopPropagation()">';
        h.preResults.forEach(function(pr) {
          var psc = pr.status >= 200 && pr.status < 300 ? 's2' : 's5';
          preHtml += '<div style="margin-left:12px;border-left:2px solid var(--vscode-button-background);padding:2px 8px;font-size:0.85em;opacity:0.8">';
          preHtml += '<span class="mb b-' + pr.method + '" style="font-size:0.8em">' + pr.method + '</span> ';
          preHtml += '<span>' + escHtml(pr.name) + '</span> ';
          preHtml += '<span class="sb ' + psc + '" style="font-size:0.75em">' + pr.status + '</span> ';
          preHtml += '<span class="hd" style="font-size:0.75em">' + pr.duration + 'ms</span>';
          preHtml += '</div>';
        });
        preHtml += '</div></div>';
      }
      html += '<div class="hi"><span class="mb b-' + h.method + '">' + h.method + '</span><div class="hinfo"><div class="hn">' + escHtml(nm) + '</div><div class="hm">' + tm + '</div></div><span class="sb ' + sc + '">' + h.status + '</span><span class="hd">' + h.duration + 'ms</span>' + preHtml + '</div>';
    });
    c.innerHTML = html || '<div class="em">No matches</div>';
  }

  function renderEnvs() {
    var c = document.getElementById('nc');
    if (!data.envs.length) { c.innerHTML = '<div class="em">No rext.env.json found</div>'; return; }
    var html = '';
    data.envs.forEach(function(name) {
      var isActive = name === data.activeEnv;
      html += '<div class="ei' + (isActive ? ' ae' : '') + '" data-env="' + esc(name) + '"><span class="ed"></span><span class="ename">' + escHtml(name) + '</span>' + (isActive ? '<span class="atag">ACTIVE</span>' : '') + '</div>';
    });
    c.innerHTML = html;
  }

  function renderVars() {
    var c = document.getElementById('vc');
    var scopes = [{k:'session',l:'Session'},{k:'collection',l:'Collection'},{k:'env',l:'Environment'},{k:'global',l:'Global'}];
    var html = '';
    scopes.forEach(function(s) {
      var vars = data.vars[s.k] || {};
      var entries = Object.entries(vars);
      var vh = '';
      entries.forEach(function(pair) {
        var k = pair[0], v = pair[1];
        var sv = typeof v === 'object' ? JSON.stringify(v) : String(v);
        var d = sv.length > 35 ? sv.substring(0, 35) + '…' : sv;
        vh += '<div class="vi"><span class="vk">' + escHtml(k) + '</span><span class="ve">=</span><span class="vv">' + escHtml(d) + '</span></div>';
      });
      html += '<div class="ss"><div class="sh"><span class="chv open">▶</span><span>' + s.l + '</span><span class="sc">' + entries.length + '</span></div><div>' + (vh || '<div class="em">Empty</div>') + '</div></div>';
    });
    c.innerHTML = html;
  }

  // --- Message from extension ---
  window.addEventListener('message', function(e) {
    if (e.data.type === 'explorerData') {
      explorerData = e.data.data;
      renderExplorer();
      renderCollections();
    }
  });

  // Initial render
  renderHistory();
  renderEnvs();
  renderVars();
})();
</script>
</body></html>`;
    }

    private async _loadExplorerAsync() {
        const data = await this._getExplorerData();
        if (this._view) {
            this._view.webview.postMessage({ type: 'explorerData', data });
        }
    }
}
