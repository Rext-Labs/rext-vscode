import * as vscode from 'vscode';

interface HistoryEntry {
    name?: string;
    method: string;
    url: string;
    status: number;
    duration: number;
    timestamp: number;
}

export class RextHistoryProvider implements vscode.TreeDataProvider<HistoryItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<HistoryItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private static readonly STORAGE_KEY = 'rext.requestHistory';
    private static readonly MAX_ENTRIES = 50;
    private _globalState: vscode.Memento | undefined;

    init(context: vscode.ExtensionContext) {
        this._globalState = context.globalState;
    }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Agrega una entrada al historial global.
     */
    addEntry(result: any) {
        if (!this._globalState) { return; }
        const history = this._getHistory();
        history.unshift({
            name: result.name,
            method: result.method || 'GET',
            url: result.url || '',
            status: result.status || 0,
            duration: result.duration || 0,
            timestamp: Date.now()
        });

        // Limitar a MAX_ENTRIES
        if (history.length > RextHistoryProvider.MAX_ENTRIES) {
            history.length = RextHistoryProvider.MAX_ENTRIES;
        }

        this._globalState.update(RextHistoryProvider.STORAGE_KEY, history);
        this.refresh();
    }

    clearHistory() {
        if (!this._globalState) { return; }
        this._globalState.update(RextHistoryProvider.STORAGE_KEY, []);
        this.refresh();
    }

    private _getHistory(): HistoryEntry[] {
        if (!this._globalState) { return []; }
        return this._globalState.get<HistoryEntry[]>(RextHistoryProvider.STORAGE_KEY, []);
    }

    getTreeItem(element: HistoryItem): vscode.TreeItem {
        return element;
    }

    getChildren(): HistoryItem[] {
        const history = this._getHistory();
        if (history.length === 0) {
            const empty = new HistoryItem('Sin historial', vscode.TreeItemCollapsibleState.None);
            empty.iconPath = new vscode.ThemeIcon('info');
            return [empty];
        }

        return history.map(entry => {
            const label = entry.name || entry.url.split('/').pop() || entry.url;
            const item = new HistoryItem(label, vscode.TreeItemCollapsibleState.None);

            const statusIcon = entry.status >= 200 && entry.status < 300 ? '$(pass)' : '$(error)';
            item.description = `${entry.method} · ${entry.status} · ${entry.duration}ms`;
            item.tooltip = `${entry.method} ${entry.url}\nStatus: ${entry.status}\nDuración: ${entry.duration}ms\n${new Date(entry.timestamp).toLocaleString()}`;

            if (entry.status >= 200 && entry.status < 300) {
                item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
            } else if (entry.status >= 400) {
                item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            } else {
                item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
            }

            return item;
        });
    }
}

class HistoryItem extends vscode.TreeItem { }
