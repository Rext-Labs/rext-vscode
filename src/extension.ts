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
import { generateCode, ExportLanguage, toPostmanCollection, findMissingPreRequestIds } from './codegen';
import { activateDecorations } from './decorations';
import { parseRextFull } from './parser';

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Scans workspace for @pre IDs in `requests` not already present,
 * prompts user to include them, and merges them into the array.
 */
async function resolveMissingPreRequests(exportSet: any[], allAvailable?: any[]): Promise<void> {
  console.log('[Postman Export] resolveMissingPreRequests called with', exportSet.length, 'requests in export set');
  for (const r of exportSet) {
    console.log(`  → [${r.id || 'no-id'}] ${r.name || r.method + ' ' + r.url} | preRequestIds:`, r.preRequestIds || 'NONE');
  }

  const missingIds = findMissingPreRequestIds(exportSet);
  console.log('[Postman Export] Missing pre-request IDs:', missingIds);
  if (missingIds.length === 0) {
    console.log('[Postman Export] No missing IDs — skipping prompt');
    return;
  }

  // First look in allAvailable (same file), then fall back to workspace scan
  const found: { id: string; name: string; req: any }[] = [];
  const remainingIds = [...missingIds];

  if (allAvailable) {
    for (const r of allAvailable) {
      const idx = remainingIds.indexOf(r.id);
      if (r.id && idx !== -1) {
        console.log('[Postman Export] Found pre-request in same file:', r.id, r.name);
        found.push({ id: r.id, name: r.name || `${r.method} ${r.url}`, req: r });
        remainingIds.splice(idx, 1);
      }
    }
  }

  // Scan workspace for any still missing
  if (remainingIds.length > 0) {
    const rextFiles = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
    console.log('[Postman Export] Scanning', rextFiles.length, 'workspace files for IDs:', remainingIds);
    const fs = require('fs');
    for (const fileUri of rextFiles) {
      try {
        const content = fs.readFileSync(fileUri.fsPath, 'utf-8');
        VariableStore.loadCollection(fileUri.fsPath);
        const { requests: fileReqs } = parseRextFull(content);
        for (const r of fileReqs) {
          if (r.id && remainingIds.includes(r.id)) {
            console.log('[Postman Export] Found pre-request in workspace:', r.id, r.name, 'in', fileUri.fsPath);
            found.push({ id: r.id, name: r.name || `${r.method} ${r.url}`, req: r });
          }
        }
      } catch { /* skip */ }
    }
  }

  console.log('[Postman Export] Total found:', found.length);
  if (found.length === 0) return;

  const names = found.map(f => `• ${f.name} (${f.id})`).join('\n');
  const answer = await vscode.window.showInformationMessage(
    `Se encontraron ${found.length} pre-request(s) no incluidos:\n${names}\n\n¿Incluirlos en la exportación?`,
    { modal: true },
    'Sí, incluir',
    'No, solo pm.sendRequest()'
  );

  console.log('[Postman Export] User answer:', answer);
  if (answer === 'Sí, incluir') {
    for (const f of found) {
      exportSet.unshift(f.req);
    }
  }
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
      { label: '$(package) Postman Collection', lang: 'postman' as ExportLanguage },
    ], { placeHolder: '📋 Exportar como...' });

    if (picked) {
      if (picked.lang === 'postman') {
        // For single request export, check pre-requests against just this request
        const exportSet = [request];
        await resolveMissingPreRequests(exportSet, requests);
        // If pre-requests were included, generate full collection; otherwise single item
        const code = exportSet.length > 1
          ? JSON.stringify(toPostmanCollection(exportSet, request.name || 'Collection'), null, 2)
          : generateCode('postman', request, exportSet);
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`${request.name || 'request'}.postman.json`),
          filters: { 'Postman Collection': ['json'] }
        });
        if (uri) {
          const fs = require('fs');
          fs.writeFileSync(uri.fsPath, code, 'utf-8');
          vscode.window.showInformationMessage(`✅ Postman item exportado a ${uri.fsPath}`);
        }
      } else {
        const code = generateCode(picked.lang, request);
        await vscode.env.clipboard.writeText(code);
        vscode.window.showInformationMessage(`✅ Código ${picked.label.replace(/\$\([^)]+\)\s*/, '')} copiado al clipboard`);
      }
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
        { label: '$(package) Postman Collection', lang: 'postman' as ExportLanguage },
      ], { placeHolder: '📋 Exportar como...' });

      if (picked) {
        if (picked.lang === 'postman') {
          const exportSet = [request];
          await resolveMissingPreRequests(exportSet, requests);
          const code = exportSet.length > 1
            ? JSON.stringify(toPostmanCollection(exportSet, request.name || 'Collection'), null, 2)
            : generateCode('postman', request, exportSet);
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${request.name || 'request'}.postman.json`),
            filters: { 'Postman Collection': ['json'] }
          });
          if (uri) {
            const fs = require('fs');
            fs.writeFileSync(uri.fsPath, code, 'utf-8');
            vscode.window.showInformationMessage(`✅ Postman item exportado a ${uri.fsPath}`);
          }
        } else {
          const code = generateCode(picked.lang, request);
          await vscode.env.clipboard.writeText(code);
          vscode.window.showInformationMessage(`✅ Código ${picked.label.replace(/\$\([^)]+\)\s*/, '')} copiado al clipboard`);
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error: ${err.message}`);
    }
  });

  // --- COMANDO 7: Exportar TODO a Postman Collection ---
  const exportToPostman = vscode.commands.registerCommand('rext.exportToPostman', async () => {
    const rextFiles = await vscode.workspace.findFiles('**/*.rext', '**/node_modules/**');
    if (rextFiles.length === 0) {
      vscode.window.showWarningMessage('No se encontraron archivos .rext en el workspace.');
      return;
    }

    EnvironmentManager.loadActiveEnvironment();

    const allRequests: any[] = [];
    const allConfigs: any[] = [];

    for (const fileUri of rextFiles) {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      VariableStore.loadCollection(fileUri.fsPath);
      const { requests, configs } = parseRextFull(doc.getText());
      requests.forEach(r => (r as any)._filePath = fileUri.fsPath);
      allRequests.push(...requests);
      allConfigs.push(...configs);
    }

    const workspaceName = vscode.workspace.name || 'Rext Collection';
    const collection = toPostmanCollection(allRequests, workspaceName, allConfigs);
    const json = JSON.stringify(collection, null, 2);

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${workspaceName}.postman_collection.json`),
      filters: { 'Postman Collection': ['json'] }
    });

    if (uri) {
      const fs = require('fs');
      fs.writeFileSync(uri.fsPath, json, 'utf-8');
      vscode.window.showInformationMessage(`✅ ${allRequests.length} requests exportados a Postman Collection`);
    }
  });

  // --- COMANDO 8: Exportar archivo actual a Postman Collection ---
  const exportFileToPostman = vscode.commands.registerCommand('rext.exportFileToPostman', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'rext') {
      vscode.window.showWarningMessage('Abre un archivo .rext para exportar.');
      return;
    }

    EnvironmentManager.loadActiveEnvironment();
    VariableStore.loadCollection(editor.document.uri.fsPath);

    const { requests, configs } = parseRextFull(editor.document.getText());
    requests.forEach(r => (r as any)._filePath = editor.document.uri.fsPath);

    if (requests.length === 0) {
      vscode.window.showWarningMessage('No se encontraron requests en el archivo.');
      return;
    }

    // Resolve missing @pre requests
    await resolveMissingPreRequests(requests);

    const fileName = editor.document.uri.fsPath.split('/').pop()?.replace('.rext', '') || 'Collection';
    const collection = toPostmanCollection(requests, fileName, configs);
    const json = JSON.stringify(collection, null, 2);

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${fileName}.postman_collection.json`),
      filters: { 'Postman Collection': ['json'] }
    });

    if (uri) {
      const fs = require('fs');
      fs.writeFileSync(uri.fsPath, json, 'utf-8');
      vscode.window.showInformationMessage(`✅ ${requests.length} requests exportados a Postman Collection`);
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
    runCurrent, runAll, switchEnv, runFromSidebar, exportRequest, exportFromSidebar, exportToPostman, exportFileToPostman,
    saveListener, diagnosticCollection, diagChangeListener, diagOpenListener, quickFixProvider,
    vscode.languages.registerCodeLensProvider({ language: 'rext' }, codelensProvider),
    vscode.languages.registerCompletionItemProvider({ language: 'rext' }, new RextCompletionProvider(), ' ', '{'),
    vscode.languages.registerInlayHintsProvider({ language: 'rext' }, new RextInlayHintsProvider())
  );
}