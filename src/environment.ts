import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { VariableStore } from './variables';

export interface RextEnvironments {
    $active?: string;
    [envName: string]: Record<string, string> | string | undefined;
}

export class EnvironmentManager {
    private static _envFilePath: string | undefined;
    private static _environments: RextEnvironments = {};
    private static _activeEnv: string = '';
    private static _statusBarItem: vscode.StatusBarItem;
    private static _watcher: vscode.FileSystemWatcher | undefined;

    /**
     * Inicializa el EnvironmentManager: busca rext.env.json, crea status bar y watcher.
     */
    public static init(context: vscode.ExtensionContext) {
        // Crear Status Bar Item
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._statusBarItem.command = 'rext.switchEnvironment';
        this._statusBarItem.tooltip = 'Cambiar entorno Rext';
        context.subscriptions.push(this._statusBarItem);

        // Buscar y cargar rext.env.json
        this._findAndLoad();

        // FileSystemWatcher para hot-reload
        if (vscode.workspace.workspaceFolders) {
            const pattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], '**/rext.env.json');
            this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

            this._watcher.onDidChange(() => this._findAndLoad());
            this._watcher.onDidCreate(() => this._findAndLoad());
            this._watcher.onDidDelete(() => {
                this._environments = {};
                this._activeEnv = '';
                this._updateStatusBar();
                VariableStore.clearEnvironment();
            });

            context.subscriptions.push(this._watcher);
        }
    }

    /**
     * Busca rext.env.json en el workspace y carga el entorno activo.
     */
    private static _findAndLoad() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            this._updateStatusBar();
            return;
        }

        // Buscar rext.env.json en la raíz del workspace
        const envFile = path.join(workspaceFolders[0].uri.fsPath, 'rext.env.json');

        if (fs.existsSync(envFile)) {
            this._envFilePath = envFile;
            try {
                const content = fs.readFileSync(envFile, 'utf-8');
                this._environments = JSON.parse(content);
                this._activeEnv = (this._environments.$active as string) || '';

                // Si no hay entorno activo, usar el primero disponible
                if (!this._activeEnv) {
                    const names = this.getEnvironmentNames();
                    if (names.length > 0) {
                        this._activeEnv = names[0];
                    }
                }

                this.loadActiveEnvironment();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Error al leer rext.env.json: ${err.message}`);
            }
        } else {
            this._envFilePath = undefined;
            this._environments = {};
            this._activeEnv = '';
        }

        this._updateStatusBar();
    }

    /**
     * Retorna los nombres de los entornos (excluyendo $active).
     */
    public static getEnvironmentNames(): string[] {
        return Object.keys(this._environments).filter(k => k !== '$active');
    }

    /**
     * Retorna el nombre del entorno activo.
     */
    public static getActiveEnvironment(): string {
        return this._activeEnv;
    }

    /**
     * Cambia el entorno activo, carga sus variables y persiste en el archivo.
     */
    public static async setActiveEnvironment(name: string) {
        this._activeEnv = name;
        this._environments.$active = name;

        // Persistir en rext.env.json
        if (this._envFilePath) {
            try {
                fs.writeFileSync(this._envFilePath, JSON.stringify(this._environments, null, 2), 'utf-8');
            } catch (err: any) {
                vscode.window.showErrorMessage(`Error al guardar rext.env.json: ${err.message}`);
            }
        }

        this.loadActiveEnvironment();
        this._updateStatusBar();
        vscode.window.showInformationMessage(`🌍 Entorno cambiado a: ${name}`);
    }

    /**
     * Carga las variables del entorno activo en el VariableStore.
     */
    public static loadActiveEnvironment() {
        VariableStore.clearEnvironment();

        if (!this._activeEnv) { return; }

        const envVars = this._environments[this._activeEnv];
        if (envVars && typeof envVars === 'object') {
            VariableStore.loadEnvironment(envVars as Record<string, string>);
        }
    }

    /**
     * Guarda una variable en el entorno activo y persiste en rext.env.json.
     */
    public static setEnvVariable(key: string, value: string) {
        if (!this._activeEnv || !this._envFilePath) { return; }

        const envObj = this._environments[this._activeEnv];
        if (envObj && typeof envObj === 'object') {
            const parts = key.split('.');
            if (parts.length === 1) {
                (envObj as Record<string, any>)[key] = value;
            } else {
                // Crear objetos anidados: prueba.name -> { prueba: { name: value } }
                let current: any = envObj;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
                        current[parts[i]] = {};
                    }
                    current = current[parts[i]];
                }
                current[parts[parts.length - 1]] = value;
            }
        }

        try {
            fs.writeFileSync(this._envFilePath, JSON.stringify(this._environments, null, 2), 'utf-8');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error al guardar variable en rext.env.json: ${err.message}`);
        }
    }

    /**
     * Actualiza el texto del Status Bar Item.
     */
    private static _updateStatusBar() {
        if (this._activeEnv) {
            this._statusBarItem.text = `$(globe) Rext: ${this._activeEnv}`;
            this._statusBarItem.show();
        } else if (this.getEnvironmentNames().length > 0) {
            this._statusBarItem.text = '$(globe) Rext: Sin entorno';
            this._statusBarItem.show();
        } else {
            this._statusBarItem.hide();
        }
    }
}
