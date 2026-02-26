import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseRext, parseRextFull, RextRequest, RextConfig } from './parser';
import { VariableStore } from './variables';
import { EnvironmentManager } from './environment';
import { RextResultsPanel } from './panel';
import { toPostmanCollection, findMissingPreRequestIds } from './codegen';

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
    private _fullResults: any[] = [];
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
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')
            ]
        };
        webviewView.webview.html = this._getHtml();

        // Re-send data when the sidebar becomes visible again
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.refresh();
            }
        });

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
                    await EnvironmentManager.setActiveEnvironment(msg.env);
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
                case 'showHistoryItem': {
                    const idx = msg.index as number;
                    const fullResult = this._fullResults[idx];
                    if (fullResult) {
                        RextResultsPanel.showDetail(fullResult);
                    } else {
                        vscode.window.showInformationMessage('Resultado completo no disponible. Ejecuta la petición nuevamente.');
                    }
                    break;
                }
                case 'run':
                    vscode.commands.executeCommand('rext.runFromSidebar', msg.filePath, msg.requestIndex);
                    break;
                case 'export':
                    vscode.commands.executeCommand('rext.exportFromSidebar', msg.filePath, msg.requestIndex);
                    break;
                case 'rename': {
                    const newName = await vscode.window.showInputBox({
                        prompt: 'New request name',
                        value: msg.currentName || ''
                    });
                    if (newName !== undefined) {
                        await this._modifyRequestDirective(msg.filePath, msg.line, '@name', newName);
                    }
                    break;
                }
                case 'open': {
                    const doc2 = await vscode.workspace.openTextDocument(msg.filePath);
                    const editor2 = await vscode.window.showTextDocument(doc2);
                    if (msg.line !== undefined) {
                        const pos2 = new vscode.Position(msg.line, 0);
                        editor2.selection = new vscode.Selection(pos2, pos2);
                        editor2.revealRange(new vscode.Range(pos2, pos2));
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
                case 'exportCollectionToPostman': {
                    await this._exportFilteredToPostman(
                        r => r.collection === msg.collectionName,
                        msg.collectionName || 'Collection'
                    );
                    break;
                }
                case 'exportGroupToPostman': {
                    await this._exportFilteredToPostman(
                        (r: RextRequest) => r.group === msg.groupName || !!(r.group && r.group.startsWith(msg.groupName + '/')),
                        msg.groupName || 'Group'
                    );
                    break;
                }
                case 'exportFileToPostman': {
                    const fp = msg.filePath;
                    EnvironmentManager.loadActiveEnvironment();
                    VariableStore.loadCollection(fp);
                    const content = fs.readFileSync(fp, 'utf-8');
                    const { requests: reqs, configs: cfgs } = parseRextFull(content);

                    // Resolve missing @pre requests
                    const missingIds = findMissingPreRequestIds(reqs);
                    if (missingIds.length > 0) {
                        const allFiles = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
                        const found: RextRequest[] = [];
                        for (const u of allFiles) {
                            try {
                                const c = fs.readFileSync(u.fsPath, 'utf-8');
                                VariableStore.loadCollection(u.fsPath);
                                const { requests: rr } = parseRextFull(c);
                                for (const r of rr) {
                                    if (r.id && missingIds.includes(r.id)) found.push(r);
                                }
                            } catch { /* skip */ }
                        }
                        if (found.length > 0) {
                            const names = found.map(f => `• ${f.name || f.method + ' ' + f.url} (${f.id})`).join('\n');
                            const answer = await vscode.window.showInformationMessage(
                                `Se encontraron ${found.length} pre-request(s) externos:\n${names}\n\n¿Incluirlos en la exportación?`,
                                { modal: true },
                                'Sí, incluir',
                                'No, solo pm.sendRequest()'
                            );
                            if (answer === 'Sí, incluir') {
                                for (const f of found) { reqs.unshift(f); }
                            }
                        }
                    }

                    const fName = path.basename(fp, '.rext');
                    const col = toPostmanCollection(reqs, fName, cfgs);
                    const json = JSON.stringify(col, null, 2);
                    const uri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(`${fName}.postman_collection.json`),
                        filters: { 'Postman Collection': ['json'] }
                    });
                    if (uri) {
                        fs.writeFileSync(uri.fsPath, json, 'utf-8');
                        vscode.window.showInformationMessage(`✅ ${reqs.length} requests exportados a Postman`);
                    }
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
        this._fullResults.unshift(result);
        if (this._history.length > RextSidebarProvider.MAX_HISTORY) {
            this._history.length = RextSidebarProvider.MAX_HISTORY;
            this._fullResults.length = RextSidebarProvider.MAX_HISTORY;
        }
        this._globalState?.update(RextSidebarProvider.HISTORY_KEY, this._history);
        this.refresh();
    }

    async refresh() {
        if (this._view) {
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
            this._view.webview.postMessage({ type: 'updateData', data });
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

    private async _exportFilteredToPostman(filter: (r: RextRequest) => boolean, name: string) {
        const uris = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
        const allRequests: RextRequest[] = [];
        const allConfigs: RextConfig[] = [];

        EnvironmentManager.loadActiveEnvironment();

        for (const uri of uris) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                VariableStore.loadCollection(uri.fsPath);
                const { requests, configs } = parseRextFull(content);
                requests.forEach(r => (r as any)._filePath = uri.fsPath);
                allRequests.push(...requests.filter(filter));
                allConfigs.push(...configs);
            } catch { /* skip */ }
        }

        if (allRequests.length === 0) {
            vscode.window.showWarningMessage(`No se encontraron requests para "${name}".`);
            return;
        }

        // Resolve missing @pre requests
        const missingIds = findMissingPreRequestIds(allRequests);
        if (missingIds.length > 0) {
            // Scan for them in already loaded requests
            const allWorkspaceReqs: RextRequest[] = [];
            for (const u of uris) {
                try {
                    const c = fs.readFileSync(u.fsPath, 'utf-8');
                    VariableStore.loadCollection(u.fsPath);
                    const { requests: rr } = parseRextFull(c);
                    allWorkspaceReqs.push(...rr);
                } catch { /* skip */ }
            }
            const found = allWorkspaceReqs.filter(r => r.id && missingIds.includes(r.id));
            if (found.length > 0) {
                const names = found.map(f => `• ${f.name || f.method + ' ' + f.url} (${f.id})`).join('\n');
                const answer = await vscode.window.showInformationMessage(
                    `Se encontraron ${found.length} pre-request(s) externos:\n${names}\n\n¿Incluirlos en la exportación?`,
                    { modal: true },
                    'Sí, incluir',
                    'No, solo pm.sendRequest()'
                );
                if (answer === 'Sí, incluir') {
                    for (const f of found) {
                        allRequests.unshift(f);
                    }
                }
            }
        }

        const collection = toPostmanCollection(allRequests, name, allConfigs);
        const json = JSON.stringify(collection, null, 2);

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${name}.postman_collection.json`),
            filters: { 'Postman Collection': ['json'] }
        });

        if (uri) {
            fs.writeFileSync(uri.fsPath, json, 'utf-8');
            vscode.window.showInformationMessage(`✅ ${allRequests.length} requests exportados a Postman`);
        }
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
        const webview = this._view!.webview;
        const distPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview');

        const sidebarJs = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'sidebar.js'));
        const sidebarCss = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'sidebar.css'));
        const vscodeJs = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'vscode.js'));

        const initData = JSON.stringify({
            history: this._history,
            envs: EnvironmentManager.getEnvironmentNames(),
            activeEnv: EnvironmentManager.getActiveEnvironment(),
            vars: {
                session: VariableStore.getScopeVars('session'),
                collection: VariableStore.getScopeVars('collection'),
                env: VariableStore.getScopeVars('env'),
                global: VariableStore.getScopeVars('global')
            }
        });

        this._loadExplorerAsync();

        return /*html*/`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<link href="${sidebarCss}" rel="stylesheet" />
</head>
<body>
<div id="app"></div>
<script type="module" src="${vscodeJs}"></script>
<script type="module" src="${sidebarJs}"></script>
<script>
  window.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      window.postMessage({ type: 'init', data: ${initData} }, '*');
    }, 100);
  });
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
