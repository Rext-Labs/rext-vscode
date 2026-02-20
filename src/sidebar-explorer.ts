import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseRext, RextRequest } from './parser';

type ViewMode = 'files' | 'collections';

export class RextExplorerProvider implements vscode.TreeDataProvider<ExplorerItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ExplorerItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _viewMode: ViewMode = 'files';

    get viewMode() { return this._viewMode; }

    toggleViewMode() {
        this._viewMode = this._viewMode === 'files' ? 'collections' : 'files';
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ExplorerItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ExplorerItem): Promise<ExplorerItem[]> {
        if (!vscode.workspace.workspaceFolders) { return []; }

        // Nivel raíz
        if (!element) {
            if (this._viewMode === 'files') {
                return this._getFileItems();
            } else {
                return this._getCollectionItems();
            }
        }

        // Hijos de un archivo .rext → sus requests
        if (element.contextValue === 'rextFile') {
            return this._getRequestItems(element.resourceUri!.fsPath);
        }

        // Hijos de una colección → archivos .rext en esa carpeta
        if (element.contextValue === 'collection') {
            return this._getFilesInCollection(element.resourceUri!.fsPath);
        }

        return [];
    }

    // --- Vista de archivos ---

    private async _getFileItems(): Promise<ExplorerItem[]> {
        const files = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
        return files
            .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
            .map(uri => {
                const item = new ExplorerItem(
                    path.basename(uri.fsPath),
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                item.resourceUri = uri;
                item.contextValue = 'rextFile';
                item.iconPath = new vscode.ThemeIcon('file');
                item.tooltip = uri.fsPath;
                return item;
            });
    }

    // --- Vista de colecciones ---

    private async _getCollectionItems(): Promise<ExplorerItem[]> {
        const collectionFiles = await vscode.workspace.findFiles('**/.rext.collection.json', '**/node_modules/**');
        const items: ExplorerItem[] = [];

        for (const collFile of collectionFiles) {
            const dirPath = path.dirname(collFile.fsPath);
            const dirName = path.basename(dirPath);
            const item = new ExplorerItem(
                `📁 ${dirName}`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            item.resourceUri = vscode.Uri.file(dirPath);
            item.contextValue = 'collection';
            item.iconPath = new vscode.ThemeIcon('folder-library');
            item.tooltip = dirPath;
            items.push(item);
        }

        // Archivos .rext sin colección
        const allFiles = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
        const collectionDirs = new Set(collectionFiles.map(f => path.dirname(f.fsPath)));
        const looseFiles = allFiles.filter(f => !collectionDirs.has(path.dirname(f.fsPath)));

        for (const uri of looseFiles) {
            const item = new ExplorerItem(
                path.basename(uri.fsPath),
                vscode.TreeItemCollapsibleState.Collapsed
            );
            item.resourceUri = uri;
            item.contextValue = 'rextFile';
            item.iconPath = new vscode.ThemeIcon('file');
            items.push(item);
        }

        return items;
    }

    private async _getFilesInCollection(dirPath: string): Promise<ExplorerItem[]> {
        const pattern = new vscode.RelativePattern(dirPath, '*.rext');
        const files = await vscode.workspace.findFiles(pattern);
        return files.map(uri => {
            const item = new ExplorerItem(
                path.basename(uri.fsPath),
                vscode.TreeItemCollapsibleState.Collapsed
            );
            item.resourceUri = uri;
            item.contextValue = 'rextFile';
            item.iconPath = new vscode.ThemeIcon('file');
            return item;
        });
    }

    // --- Requests de un archivo ---

    private _getRequestItems(filePath: string): ExplorerItem[] {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const requests = parseRext(content);
            return requests.map((req, index) => {
                const label = req.name || `${req.method} ${req.url}`;
                const item = new ExplorerItem(label, vscode.TreeItemCollapsibleState.None);
                item.description = req.method;
                item.contextValue = 'request';
                item.iconPath = this._getMethodIcon(req.method);
                item.command = {
                    command: 'rext.openFileAtLine',
                    title: 'Abrir',
                    arguments: [filePath, req.startLine]
                };
                return item;
            });
        } catch {
            return [];
        }
    }

    private _getMethodIcon(method: string): vscode.ThemeIcon {
        switch (method.toUpperCase()) {
            case 'GET': return new vscode.ThemeIcon('arrow-down', new vscode.ThemeColor('charts.green'));
            case 'POST': return new vscode.ThemeIcon('arrow-up', new vscode.ThemeColor('charts.yellow'));
            case 'PUT': return new vscode.ThemeIcon('arrow-swap', new vscode.ThemeColor('charts.blue'));
            case 'DELETE': return new vscode.ThemeIcon('trash', new vscode.ThemeColor('charts.red'));
            case 'PATCH': return new vscode.ThemeIcon('edit', new vscode.ThemeColor('charts.orange'));
            default: return new vscode.ThemeIcon('symbol-method');
        }
    }
}

class ExplorerItem extends vscode.TreeItem { }
