import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseRext } from './parser';
import { VariableStore } from './variables';
import { DYNAMIC_VARS } from './dynamic-variables';
import { scanCapturedVars } from './decorations';

export class RextCompletionProvider implements vscode.CompletionItemProvider {

    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
        const lineText = document.lineAt(position).text;
        const textBefore = lineText.substring(0, position.character);

        // --- Variable completion inside {{ }} ---
        const lastOpen = textBefore.lastIndexOf('{{');
        if (lastOpen !== -1) {
            const afterOpen = textBefore.substring(lastOpen + 2);
            if (!afterOpen.includes('}}')) {
                return this._getVariableCompletions(document);
            }
        }

        // --- @pre completion ---
        const prefix = textBefore.trim();
        if (!prefix.startsWith('@pre')) { return []; }

        const items: vscode.CompletionItem[] = [];
        const uris = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');

        for (const uri of uris) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                const requests = parseRext(content);
                const fileName = uri.fsPath.split('/').pop() || '';

                for (const req of requests) {
                    if (!req.id) { continue; }
                    const name = req.name || `${req.method} ${req.url}`;
                    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
                    item.detail = req.id;
                    item.documentation = new vscode.MarkdownString(`**${name}**\n\n\`${req.method} ${req.url}\`\n\n📄 ${fileName}`);
                    item.insertText = req.id;
                    item.sortText = name;
                    item.filterText = `${name} ${req.id}`;
                    items.push(item);
                }
            } catch { /* skip */ }
        }

        return items;
    }

    private _getVariableCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const seen = new Set<string>();

        const scopes: { key: string; label: string; icon: vscode.CompletionItemKind; order: string }[] = [
            { key: 'env', label: 'env', icon: vscode.CompletionItemKind.Variable, order: '0' },
            { key: 'session', label: 'session', icon: vscode.CompletionItemKind.Field, order: '1' },
            { key: 'collection', label: 'collection', icon: vscode.CompletionItemKind.Property, order: '2' },
            { key: 'global', label: 'global', icon: vscode.CompletionItemKind.Constant, order: '3' },
        ];

        for (const scope of scopes) {
            const vars = VariableStore.getScopeVars(scope.key);
            for (const [key, value] of Object.entries(vars)) {
                if (seen.has(key)) { continue; }
                seen.add(key);

                const truncated = value.length > 50 ? value.substring(0, 50) + '…' : value;
                const item = new vscode.CompletionItem(key, scope.icon);
                item.detail = `${scope.label}: ${truncated}`;
                item.documentation = new vscode.MarkdownString(
                    `**Scope:** \`${scope.label}\`\n\n**Value:** \`${value}\``
                );
                item.insertText = key;
                item.sortText = `${scope.order}_${key}`;
                item.filterText = key;
                items.push(item);
            }
        }

        // Add captured variables from @capture directives in the file
        const capturedVars = scanCapturedVars(document.getText());
        for (const [key, info] of capturedVars) {
            if (seen.has(key)) { continue; }
            seen.add(key);

            const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Event);
            item.detail = `capture → ${info.scope} (from ${info.source})`;
            item.documentation = new vscode.MarkdownString(
                `**Scope:** \`${info.scope}\` *(pendiente)*\n\n**Definida por:** \`@capture\` en **${info.source}**`
            );
            item.insertText = key;
            item.sortText = `4_${key}`;
            item.filterText = key;
            items.push(item);
        }

        // Add dynamic built-in variables
        for (const [name, entry] of Object.entries(DYNAMIC_VARS)) {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
            item.detail = `⚡ ${entry.description}`;
            item.documentation = new vscode.MarkdownString(
                `**\`${name}\`** ⚡ Built-in\n\n${entry.description}\n\n**Ejemplo:** \`${entry.example}\``
            );
            item.insertText = entry.hasParams && entry.paramSnippet
                ? new vscode.SnippetString(entry.paramSnippet)
                : name;
            item.sortText = `5_${name}`;
            item.filterText = name;
            items.push(item);
        }

        return items;
    }
}
