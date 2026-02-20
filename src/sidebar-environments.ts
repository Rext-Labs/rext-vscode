import * as vscode from 'vscode';
import { EnvironmentManager } from './environment';

export class RextEnvironmentsProvider implements vscode.TreeDataProvider<EnvItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<EnvItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: EnvItem): vscode.TreeItem {
        return element;
    }

    getChildren(): EnvItem[] {
        const envNames = EnvironmentManager.getEnvironmentNames();
        const activeEnv = EnvironmentManager.getActiveEnvironment();

        if (envNames.length === 0) {
            const empty = new EnvItem('Sin rext.env.json', vscode.TreeItemCollapsibleState.None);
            empty.iconPath = new vscode.ThemeIcon('info');
            return [empty];
        }

        return envNames.map(name => {
            const isActive = name === activeEnv;
            const item = new EnvItem(
                isActive ? `${name}  ✔` : name,
                vscode.TreeItemCollapsibleState.None
            );
            item.contextValue = 'environment';
            item.description = isActive ? 'activo' : '';
            item.iconPath = isActive
                ? new vscode.ThemeIcon('globe', new vscode.ThemeColor('charts.green'))
                : new vscode.ThemeIcon('globe');
            item.command = {
                command: 'rext.selectEnvironment',
                title: 'Seleccionar entorno',
                arguments: [name]
            };
            return item;
        });
    }
}

class EnvItem extends vscode.TreeItem { }
