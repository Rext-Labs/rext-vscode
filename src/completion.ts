import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseRext } from './parser';

export class RextCompletionProvider implements vscode.CompletionItemProvider {

    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
        const lineText = document.lineAt(position).text;
        const prefix = lineText.substring(0, position.character).trim();

        // Only trigger after @pre
        if (!prefix.startsWith('@pre')) { return []; }

        // Collect all requests from workspace
        const items: vscode.CompletionItem[] = [];
        const uris = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');

        for (const uri of uris) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                const requests = parseRext(content);
                const fileName = uri.fsPath.split('/').pop() || '';

                for (const req of requests) {
                    if (!req.id) { continue; }
                    const label = req.id;
                    const name = req.name || `${req.method} ${req.url}`;
                    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
                    item.detail = name;
                    item.documentation = new vscode.MarkdownString(`**${name}**\n\n\`${req.method} ${req.url}\`\n\n📄 ${fileName}`);
                    item.insertText = req.id;
                    item.sortText = name;
                    items.push(item);
                }
            } catch { /* skip */ }
        }

        return items;
    }
}
