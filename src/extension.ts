import * as vscode from 'vscode';
import { parseRext } from './parser';
import { runRequest } from './runner';
import { RextResultsPanel } from './panel';
import { RextCodeLensProvider } from './codelens';
import { EnvironmentManager } from './environment';
import { VariableStore } from './variables';
import { RextSidebarProvider } from './sidebar-webview';
import { RextCompletionProvider } from './completion';
import { RextInlayHintsProvider } from './inlay-hints';
import { generateCode, ExportLanguage } from './codegen';
import { activateDecorations } from './decorations';

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('🚀 Rext-Labs: Iniciando laboratorio...');

  VariableStore.initGlobalState(context);
  EnvironmentManager.init(context);
  RextResultsPanel.setExtensionUri(context.extensionUri);
  activateDecorations(context);

  // --- Sidebar WebviewView ---
  const sidebarProvider = new RextSidebarProvider(context.extensionUri);
  sidebarProvider.init(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RextSidebarProvider.viewId, sidebarProvider)
  );

  // --- COMANDO 1: Ejecutar petición actual ---
  const runCurrent = vscode.commands.registerCommand('rext.runCurrentFile', async (requestIndex?: number) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    EnvironmentManager.loadActiveEnvironment();
    VariableStore.loadCollection(editor.document.uri.fsPath);

    const requests = parseRext(editor.document.getText());
    requests.forEach(r => (r as any)._filePath = editor.document.uri.fsPath);
    let requestToRun;

    if (requestIndex !== undefined) {
      requestToRun = requests[requestIndex];
    } else {
      const cursorLine = editor.selection.active.line;
      requestToRun = requests.find(req => cursorLine >= req.startLine && cursorLine <= req.endLine);
    }

    if (requestToRun) {
      RextResultsPanel.displayPending({
        name: requestToRun.name,
        method: requestToRun.method,
        url: VariableStore.replaceInString(requestToRun.url)
      });
      const result = await runRequest(requestToRun, requests);
      RextResultsPanel.updatePending(result);
      sidebarProvider.addHistoryEntry(result, requestToRun.id);
      sidebarProvider.refresh();
    } else {
      vscode.window.showWarningMessage("No se encontró una petición en la posición actual del cursor.");
    }
  });

  // --- COMANDO 2: Ejecutar todo (Modo Flujo) ---
  const runAll = vscode.commands.registerCommand('rext.runAll', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    EnvironmentManager.loadActiveEnvironment();
    VariableStore.loadCollection(editor.document.uri.fsPath);

    const requests = parseRext(editor.document.getText());
    requests.forEach(r => (r as any)._filePath = editor.document.uri.fsPath);
    for (const req of requests) {
      RextResultsPanel.displayPending({
        name: req.name,
        method: req.method,
        url: VariableStore.replaceInString(req.url)
      });
      const result = await runRequest(req, requests);
      RextResultsPanel.updatePending(result);
      sidebarProvider.addHistoryEntry(result, req.id);
    }
    sidebarProvider.refresh();
  });

  // --- COMANDO 3: Cambiar entorno ---
  const switchEnv = vscode.commands.registerCommand('rext.switchEnvironment', async () => {
    const envNames = EnvironmentManager.getEnvironmentNames();
    if (envNames.length === 0) {
      vscode.window.showWarningMessage("No se encontró rext.env.json en el workspace.");
      return;
    }

    const activeEnv = EnvironmentManager.getActiveEnvironment();
    const items = envNames.map(name => ({
      label: name === activeEnv ? `$(check) ${name}` : `     ${name}`,
      envName: name,
      description: name === activeEnv ? 'activo' : ''
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '🌍 Selecciona un entorno'
    });

    if (picked) {
      await EnvironmentManager.setActiveEnvironment(picked.envName);
      sidebarProvider.refresh();
    }
  });

  // --- COMANDO 4: Ejecutar desde sidebar ---
  const runFromSidebar = vscode.commands.registerCommand('rext.runFromSidebar', async (filePath: string, requestIndex: number) => {
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      EnvironmentManager.loadActiveEnvironment();
      VariableStore.loadCollection(filePath);

      const requests = parseRext(doc.getText());
      requests.forEach(r => (r as any)._filePath = filePath);
      const requestToRun = requests[requestIndex];

      if (requestToRun) {
        RextResultsPanel.displayPending({
          name: requestToRun.name,
          method: requestToRun.method,
          url: VariableStore.replaceInString(requestToRun.url)
        });
        const result = await runRequest(requestToRun, requests);
        RextResultsPanel.updatePending(result);
        sidebarProvider.addHistoryEntry(result, requestToRun.id);
        sidebarProvider.refresh();
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error: ${err.message}`);
    }
  });

  // --- COMANDO 5: Exportar request como código ---
  const exportRequest = vscode.commands.registerCommand('rext.exportRequest', async (requestIndex?: number) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    EnvironmentManager.loadActiveEnvironment();
    VariableStore.loadCollection(editor.document.uri.fsPath);

    const requests = parseRext(editor.document.getText());
    let request;

    if (requestIndex !== undefined) {
      request = requests[requestIndex];
    } else {
      const cursorLine = editor.selection.active.line;
      request = requests.find(req => cursorLine >= req.startLine && cursorLine <= req.endLine);
    }

    if (!request) {
      vscode.window.showWarningMessage('No se encontró una petición en la posición actual.');
      return;
    }

    const picked = await vscode.window.showQuickPick([
      { label: '$(terminal) cURL', lang: 'curl' as ExportLanguage },
      { label: '$(symbol-method) JavaScript (fetch)', lang: 'javascript' as ExportLanguage },
      { label: '$(code) Go (net/http)', lang: 'go' as ExportLanguage },
      { label: '$(symbol-class) Dart (http)', lang: 'dart' as ExportLanguage },
      { label: '$(symbol-variable) Python (requests)', lang: 'python' as ExportLanguage },
    ], { placeHolder: '📋 Exportar como...' });

    if (picked) {
      const code = generateCode(picked.lang, request);
      await vscode.env.clipboard.writeText(code);
      vscode.window.showInformationMessage(`✅ Código ${picked.label.replace(/\$\([^)]+\)\s*/, '')} copiado al clipboard`);
    }
  });

  // --- COMANDO 6: Exportar desde sidebar ---
  const exportFromSidebar = vscode.commands.registerCommand('rext.exportFromSidebar', async (filePath: string, requestIndex: number) => {
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      EnvironmentManager.loadActiveEnvironment();
      VariableStore.loadCollection(filePath);

      const requests = parseRext(doc.getText());
      const request = requests[requestIndex];
      if (!request) { return; }

      const picked = await vscode.window.showQuickPick([
        { label: '$(terminal) cURL', lang: 'curl' as ExportLanguage },
        { label: '$(symbol-method) JavaScript (fetch)', lang: 'javascript' as ExportLanguage },
        { label: '$(code) Go (net/http)', lang: 'go' as ExportLanguage },
        { label: '$(symbol-class) Dart (http)', lang: 'dart' as ExportLanguage },
        { label: '$(symbol-variable) Python (requests)', lang: 'python' as ExportLanguage },
      ], { placeHolder: '📋 Exportar como...' });

      if (picked) {
        const code = generateCode(picked.lang, request);
        await vscode.env.clipboard.writeText(code);
        vscode.window.showInformationMessage(`✅ Código ${picked.label.replace(/\$\([^)]+\)\s*/, '')} copiado al clipboard`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error: ${err.message}`);
    }
  });

  // --- AUTO-INYECCIÓN DE @id AL GUARDAR ---
  let isAutoInjecting = false;

  const saveListener = vscode.workspace.onDidSaveTextDocument(async (doc) => {
    if (doc.languageId !== 'rext' || isAutoInjecting) { return; }

    // Siempre refrescar sidebar al guardar
    sidebarProvider.refresh();

    const requests = parseRext(doc.getText());
    const missingIds = requests.filter(r => r.hasMissingId);
    if (missingIds.length === 0) { return; }

    isAutoInjecting = true;
    try {
      const edit = new vscode.WorkspaceEdit();
      const lines = doc.getText().split(/\r?\n/);

      // Procesar de abajo hacia arriba para no desplazar líneas
      for (let i = missingIds.length - 1; i >= 0; i--) {
        const req = missingIds[i];
        const newId = generateId();
        let insertLine = req.startLine;
        const startText = lines[req.startLine]?.trim();
        if (startText?.startsWith('###')) {
          insertLine = req.startLine + 1;
        }
        edit.insert(doc.uri, new vscode.Position(insertLine, 0), `@id ${newId}\n`);
      }

      await vscode.workspace.applyEdit(edit);
      await doc.save();
    } finally {
      isAutoInjecting = false;
    }
    sidebarProvider.refresh();
  });

  // --- DIAGNÓSTICOS: IDs duplicados ---
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('rext');

  function updateDiagnostics(doc: vscode.TextDocument) {
    if (doc.languageId !== 'rext') { return; }

    const lines = doc.getText().split(/\r?\n/);
    const idMap = new Map<string, number[]>();
    const diags: vscode.Diagnostic[] = [];

    lines.forEach((line, idx) => {
      const match = line.trim().match(/^@id\s+([a-zA-Z0-9]{6})$/);
      if (match) {
        const id = match[1];
        if (!idMap.has(id)) { idMap.set(id, []); }
        idMap.get(id)!.push(idx);
      }
    });

    idMap.forEach((lineNumbers, id) => {
      if (lineNumbers.length > 1) {
        lineNumbers.forEach(ln => {
          const range = new vscode.Range(ln, 0, ln, lines[ln].length);
          const diag = new vscode.Diagnostic(
            range,
            `ID duplicado "${id}". Genera uno nuevo para mantener la trazabilidad independiente.`,
            vscode.DiagnosticSeverity.Error
          );
          diag.code = 'rext-duplicate-id';
          diag.source = 'Rext';
          diags.push(diag);
        });
      }
    });

    diagnosticCollection.set(doc.uri, diags);
  }

  const diagChangeListener = vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document));
  const diagOpenListener = vscode.workspace.onDidOpenTextDocument(doc => updateDiagnostics(doc));
  vscode.workspace.textDocuments.forEach(doc => updateDiagnostics(doc));

  // --- Quick Fix: regenerar/borrar @id duplicado ---
  const quickFixProvider = vscode.languages.registerCodeActionsProvider('rext', {
    provideCodeActions(document, _range, context) {
      const actions: vscode.CodeAction[] = [];
      for (const diag of context.diagnostics) {
        if (diag.code === 'rext-duplicate-id') {
          // Acción 1: Regenerar ID (preferida)
          const regenerate = new vscode.CodeAction(
            '🔄 Regenerar @id',
            vscode.CodeActionKind.QuickFix
          );
          regenerate.edit = new vscode.WorkspaceEdit();
          const line = document.lineAt(diag.range.start.line);
          const fullLineRange = new vscode.Range(line.range.start, line.range.end);
          regenerate.edit.replace(document.uri, fullLineRange, `@id ${generateId()}`);
          regenerate.diagnostics = [diag];
          regenerate.isPreferred = true;
          actions.push(regenerate);

          // Acción 2: Borrar @id
          const remove = new vscode.CodeAction(
            '🗑 Borrar @id',
            vscode.CodeActionKind.QuickFix
          );
          remove.edit = new vscode.WorkspaceEdit();
          const lineRange = new vscode.Range(diag.range.start.line, 0, diag.range.start.line + 1, 0);
          remove.edit.delete(document.uri, lineRange);
          remove.diagnostics = [diag];
          actions.push(remove);
        }
      }
      return actions;
    }
  });

  // --- CodeLens ---
  const codelensProvider = new RextCodeLensProvider();

  context.subscriptions.push(
    runCurrent, runAll, switchEnv, runFromSidebar, exportRequest, exportFromSidebar,
    saveListener, diagnosticCollection, diagChangeListener, diagOpenListener, quickFixProvider,
    vscode.languages.registerCodeLensProvider({ language: 'rext' }, codelensProvider),
    vscode.languages.registerCompletionItemProvider({ language: 'rext' }, new RextCompletionProvider(), ' ', '{'),
    vscode.languages.registerInlayHintsProvider({ language: 'rext' }, new RextInlayHintsProvider())
  );
}