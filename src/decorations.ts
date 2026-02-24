import * as vscode from 'vscode';
import { VariableStore } from './variables';

// Color per scope
const SCOPE_COLORS: Record<string, { color: string; bg: string }> = {
    env: { color: '#4ec970', bg: 'rgba(78,201,112,0.08)' },     // green
    session: { color: '#569cd6', bg: 'rgba(86,156,214,0.08)' },     // blue
    collection: { color: '#ce9178', bg: 'rgba(206,145,120,0.08)' },    // orange
    global: { color: '#c586c0', bg: 'rgba(197,134,192,0.08)' },    // purple
    capture: { color: '#4fc1e9', bg: 'rgba(79,193,233,0.08)' },     // teal/cyan
    undefined: { color: '#f44747', bg: 'rgba(244,71,71,0.08)' },      // red
};

// Brace decoration (the {{ and }} chars)
const braceDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#808080',
    fontWeight: 'bold',
});

// One decoration type per scope
const scopeDecorationTypes: Record<string, vscode.TextEditorDecorationType> = {};
for (const [scope, colors] of Object.entries(SCOPE_COLORS)) {
    const style: vscode.DecorationRenderOptions = {
        color: colors.color,
        backgroundColor: colors.bg,
        borderRadius: '2px',
        fontWeight: '600',
    };
    if (scope === 'capture') {
        style.textDecoration = 'underline wavy #e6c84c';
    }
    scopeDecorationTypes[scope] = vscode.window.createTextEditorDecorationType(style);
}

/** Scans document text for @capture directives and returns a map of variable name → source info */
export function scanCapturedVars(text: string): Map<string, { scope: string; source: string }> {
    const captured = new Map<string, { scope: string; source: string }>();
    const lines = text.split(/\r?\n/);
    let currentName = '';

    for (const line of lines) {
        const trimmed = line.trim();
        const nameMatch = trimmed.match(/^@name\s+(.+)/);
        if (nameMatch) { currentName = nameMatch[1].trim(); continue; }
        if (trimmed.startsWith('###') || trimmed === '---') { currentName = ''; }

        const capMatch = trimmed.match(/^@capture\s+(?:(session|collection|env|global)\.)?(\w+)\s*=/);
        if (capMatch) {
            const scope = capMatch[1] || 'session';
            const varName = capMatch[2];
            captured.set(varName, { scope, source: currentName || 'request' });
        }
    }
    return captured;
}

function resolveVariableScope(key: string, capturedVars: Map<string, { scope: string; source: string }>): string {
    const scopes = ['session', 'collection', 'env', 'global'] as const;
    for (const scope of scopes) {
        const vars = VariableStore.getScopeVars(scope);
        if (key in vars) { return scope; }
    }
    if (capturedVars.has(key)) { return 'capture'; }
    return 'undefined';
}

export function updateDecorations(editor: vscode.TextEditor) {
    if (editor.document.languageId !== 'rext') { return; }

    const text = editor.document.getText();
    const capturedVars = scanCapturedVars(text);
    const regex = /\{\{(\w+)\}\}/g;
    let match: RegExpExecArray | null;

    const braces: vscode.DecorationOptions[] = [];
    const scopeBuckets: Record<string, vscode.DecorationOptions[]> = {};
    for (const key of Object.keys(SCOPE_COLORS)) { scopeBuckets[key] = []; }

    while ((match = regex.exec(text)) !== null) {
        const varName = match[1];
        const scope = resolveVariableScope(varName, capturedVars);
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + match[0].length);

        // Braces: {{ and }}
        const openStart = startPos;
        const openEnd = editor.document.positionAt(match.index + 2);
        const closeStart = editor.document.positionAt(match.index + match[0].length - 2);
        const closeEnd = endPos;
        braces.push({ range: new vscode.Range(openStart, openEnd) });
        braces.push({ range: new vscode.Range(closeStart, closeEnd) });

        // Variable name with tooltip
        const varStart = editor.document.positionAt(match.index + 2);
        const varEnd = editor.document.positionAt(match.index + 2 + varName.length);
        let hoverMessage: vscode.MarkdownString;

        if (scope === 'capture') {
            const info = capturedVars.get(varName)!;
            hoverMessage = new vscode.MarkdownString(
                `**\`${varName}\`**\n\n` +
                `**Scope:** \`${info.scope}\` *(pendiente)*\n\n` +
                `**Definida por:** \`@capture\` en **${info.source}**`
            );
        } else if (scope !== 'undefined') {
            const value = VariableStore.getScopeVars(scope)[varName];
            hoverMessage = new vscode.MarkdownString(
                `**\`${varName}\`**\n\n` +
                `**Scope:** \`${scope}\`\n\n` +
                `**Value:** \`${value}\``
            );
        } else {
            hoverMessage = new vscode.MarkdownString(
                `**\`${varName}\`**\n\n` +
                `⚠️ Variable no definida en ningún scope ni captura`
            );
        }

        scopeBuckets[scope].push({
            range: new vscode.Range(varStart, varEnd),
            hoverMessage,
        });
    }

    // Apply decorations
    editor.setDecorations(braceDecorationType, braces);
    for (const [scope, type] of Object.entries(scopeDecorationTypes)) {
        editor.setDecorations(type, scopeBuckets[scope] || []);
    }
}

export function activateDecorations(context: vscode.ExtensionContext) {
    // Trigger on active editor change
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) { updateDecorations(activeEditor); }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                activeEditor = editor;
                updateDecorations(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (activeEditor && event.document === activeEditor.document) {
                updateDecorations(activeEditor);
            }
        })
    );
}
