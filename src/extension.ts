import * as vscode from 'vscode';
import { parseRext } from './parser';
import { runRequest } from './runner';
import { RextResultsPanel } from './panel';
import { RextCodeLensProvider } from './codelens';
import { EnvironmentManager } from './environment';
import { VariableStore } from './variables';

export function activate(context: vscode.ExtensionContext) {
  console.log('🚀 Rext-Labs: Iniciando laboratorio...');

  // Inicializar globalState para variables globales persistentes
  VariableStore.initGlobalState(context);

  // Inicializar gestor de entornos (StatusBar + FileWatcher + carga de variables)
  EnvironmentManager.init(context);

  // COMANDO 1: Ejecutar solo la petición actual
  let runCurrent = vscode.commands.registerCommand('rext.runCurrentFile', async (requestIndex?: number) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    // Recargar variables del entorno activo y collection antes de ejecutar
    EnvironmentManager.loadActiveEnvironment();
    VariableStore.loadCollection(editor.document.uri.fsPath);

    const requests = parseRext(editor.document.getText());
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
      const result = await runRequest(requestToRun);
      RextResultsPanel.updatePending(result);
    } else {
      vscode.window.showWarningMessage("No se encontró una petición en la posición actual del cursor.");
    }
  });

  // COMANDO 2: Ejecutar todo el archivo (Modo Flujo)
  let runAll = vscode.commands.registerCommand('rext.runAll', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    // Recargar variables del entorno activo y collection antes de ejecutar
    EnvironmentManager.loadActiveEnvironment();
    VariableStore.loadCollection(editor.document.uri.fsPath);

    const requests = parseRext(editor.document.getText());
    for (const req of requests) {
      RextResultsPanel.displayPending({
        name: req.name,
        method: req.method,
        url: VariableStore.replaceInString(req.url)
      });
      const result = await runRequest(req);
      RextResultsPanel.updatePending(result);
    }
  });

  // COMANDO 3: Cambiar entorno
  let switchEnv = vscode.commands.registerCommand('rext.switchEnvironment', async () => {
    const envNames = EnvironmentManager.getEnvironmentNames();

    if (envNames.length === 0) {
      vscode.window.showWarningMessage("No se encontró rext.env.json en el workspace. Crea uno para definir entornos.");
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
    }
  });

  // Proveedor de CodeLens
  const codelensProvider = new RextCodeLensProvider();

  context.subscriptions.push(
    runCurrent,
    runAll,
    switchEnv,
    vscode.languages.registerCodeLensProvider({ language: 'rext' }, codelensProvider)
  );
}