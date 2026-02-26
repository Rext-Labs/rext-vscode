import * as vscode from 'vscode';
import { VariableStore } from './variables';
import { DYNAMIC_VARS } from './dynamic-variables';

export class RextVariablesProvider implements vscode.TreeDataProvider<VarItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<VarItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: VarItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: VarItem): VarItem[] {
        if (!element) {
            // Nodos raíz: los 4 scopes + built-in
            const scopes: { label: string; scope: string; icon: string }[] = [
                { label: 'Session', scope: 'session', icon: 'symbol-variable' },
                { label: 'Collection', scope: 'collection', icon: 'folder' },
                { label: 'Environment', scope: 'env', icon: 'globe' },
                { label: 'Global', scope: 'global', icon: 'database' },
                { label: 'Built-in ⚡', scope: 'builtin', icon: 'zap' }
            ];

            return scopes.map(s => {
                if (s.scope === 'builtin') {
                    const count = Object.keys(DYNAMIC_VARS).length;
                    const item = new VarItem(
                        s.label,
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    item.contextValue = s.scope;
                    item.description = `(${count})`;
                    item.iconPath = new vscode.ThemeIcon(s.icon);
                    return item;
                }

                const vars = VariableStore.getScopeVars(s.scope);
                const count = Object.keys(vars).length;
                const item = new VarItem(
                    s.label,
                    count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
                );
                item.contextValue = s.scope;
                item.description = `(${count})`;
                item.iconPath = new vscode.ThemeIcon(s.icon);
                return item;
            });
        }

        // Hijos: variables del scope
        const scope = element.contextValue || '';

        // Built-in: mostrar variables dinámicas
        if (scope === 'builtin') {
            return Object.entries(DYNAMIC_VARS).map(([name, entry]) => {
                const item = new VarItem(name, vscode.TreeItemCollapsibleState.None);
                item.description = entry.description;
                item.tooltip = `${name} → ${entry.example}`;
                item.iconPath = new vscode.ThemeIcon('symbol-function');
                return item;
            });
        }

        const vars = VariableStore.getScopeVars(scope);
        return Object.entries(vars).map(([key, value]) => {
            const displayValue = typeof value === 'string' && value.length > 50
                ? value.substring(0, 50) + '...'
                : String(value);
            const item = new VarItem(key, vscode.TreeItemCollapsibleState.None);
            item.description = displayValue;
            item.tooltip = `${key} = ${value}`;
            item.iconPath = new vscode.ThemeIcon('symbol-constant');
            return item;
        });
    }
}

class VarItem extends vscode.TreeItem { }
