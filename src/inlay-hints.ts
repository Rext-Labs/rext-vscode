import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseRext, RextRequest } from './parser';

export class RextInlayHintsProvider implements vscode.InlayHintsProvider {

    private _requestMap: Map<string, RextRequest> = new Map();

    async provideInlayHints(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.InlayHint[]> {
        // Build map of all request IDs across workspace
        await this._buildRequestMap();

        const hints: vscode.InlayHint[] = [];
        const text = document.getText();
        const lines = text.split(/\r?\n/);

        for (let i = range.start.line; i <= Math.min(range.end.line, lines.length - 1); i++) {
            const line = lines[i].trim();
            const match = line.match(/^@pre\s+([a-zA-Z0-9]{6})/);
            if (match) {
                const refId = match[1];
                const req = this._requestMap.get(refId);
                if (req) {
                    const name = req.name || `${req.method} ${req.url}`;
                    const pos = new vscode.Position(i, lines[i].length);
                    const hint = new vscode.InlayHint(pos, ` → ${name}`, vscode.InlayHintKind.Parameter);
                    hint.paddingLeft = true;
                    hints.push(hint);
                }
            }
        }

        return hints;
    }

    private async _buildRequestMap() {
        this._requestMap.clear();
        const uris = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
        for (const uri of uris) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                const requests = parseRext(content);
                for (const r of requests) {
                    if (r.id) { this._requestMap.set(r.id, r); }
                }
            } catch { /* skip */ }
        }
    }
}
