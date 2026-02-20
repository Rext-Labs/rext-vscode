import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type CaptureScope = 'session' | 'collection' | 'env' | 'global';

export class VariableStore {
    // Capa 1: Sesión (solo en memoria, mayor prioridad)
    private static sessionVars: Record<string, string> = {};
    // Capa 2: Collection (por carpeta, persiste en .rext.collection.json)
    private static collectionVars: Record<string, string> = {};
    private static _collectionFilePath: string | undefined;
    // Capa 3: Entorno (cargadas desde rext.env.json)
    private static envVars: Record<string, string> = {};
    // Capa 4: Global (persiste en VS Code globalState)
    private static _globalState: vscode.Memento | undefined;

    private static readonly GLOBAL_KEY = 'rext.globalVariables';

    // --- Inicialización ---

    /**
     * Inyecta la referencia a globalState de VS Code para persistencia global.
     */
    public static initGlobalState(context: vscode.ExtensionContext) {
        this._globalState = context.globalState;
    }

    // --- Escritura (scoped) ---

    /**
     * Guarda una variable en el scope indicado.
     */
    public static setScoped(scope: CaptureScope, key: string, value: any) {
        const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

        switch (scope) {
            case 'session':
                this.sessionVars[key] = strValue;
                break;
            case 'collection':
                this.collectionVars[key] = strValue;
                this._persistCollection();
                break;
            case 'env':
                this.envVars[key] = strValue;
                // La persistencia en rext.env.json se maneja desde EnvironmentManager
                break;
            case 'global':
                this._setGlobal(key, strValue);
                break;
        }
    }

    /**
     * Shortcut para set en sesión (retrocompatibilidad).
     */
    public static set(key: string, value: any) {
        this.setScoped('session', key, value);
    }

    // --- Lectura (con prioridad) ---

    /**
     * Obtiene una variable. Prioridad: session > collection > env > global > placeholder.
     */
    public static get(key: string): string {
        return this.sessionVars[key]
            || this.collectionVars[key]
            || this.envVars[key]
            || this._getGlobal(key)
            || `{{${key}}}`;
    }

    /**
     * Reemplaza variables {{var}} en un string.
     */
    public static replaceInString(text: string): string {
        return text.replace(/\{\{(\w+)\}\}/g, (_, key) => this.get(key));
    }

    // --- Carga / Limpieza de capas ---

    /**
     * Carga variables de entorno desde rext.env.json.
     */
    public static loadEnvironment(vars: Record<string, string>) {
        this.envVars = { ...vars };
    }

    /**
     * Limpia las variables de entorno.
     */
    public static clearEnvironment() {
        this.envVars = {};
    }

    /**
     * Limpia las variables de sesión.
     */
    public static clearSession() {
        this.sessionVars = {};
    }

    /**
     * Carga variables de collection desde el archivo .rext.collection.json
     * ubicado en la misma carpeta que el archivo .rext activo.
     */
    public static loadCollection(rextFilePath: string) {
        const dir = path.dirname(rextFilePath);
        this._collectionFilePath = path.join(dir, '.rext.collection.json');

        if (fs.existsSync(this._collectionFilePath)) {
            try {
                const content = fs.readFileSync(this._collectionFilePath, 'utf-8');
                this.collectionVars = JSON.parse(content);
            } catch {
                this.collectionVars = {};
            }
        } else {
            this.collectionVars = {};
        }
    }

    // --- Persistencia Collection ---

    private static _persistCollection() {
        if (!this._collectionFilePath) { return; }
        try {
            fs.writeFileSync(
                this._collectionFilePath,
                JSON.stringify(this.collectionVars, null, 2),
                'utf-8'
            );
        } catch (err: any) {
            console.error(`Error al guardar .rext.collection.json: ${err.message}`);
        }
    }

    // --- Persistencia Global (VS Code globalState) ---

    private static _getGlobal(key: string): string | undefined {
        if (!this._globalState) { return undefined; }
        const globals = this._globalState.get<Record<string, string>>(this.GLOBAL_KEY, {});
        return globals[key];
    }

    private static _setGlobal(key: string, value: string) {
        if (!this._globalState) { return; }
        const globals = this._globalState.get<Record<string, string>>(this.GLOBAL_KEY, {});
        globals[key] = value;
        this._globalState.update(this.GLOBAL_KEY, globals);
    }

    /**
     * Retorna las variables de entorno actuales (para que EnvironmentManager pueda persistir).
     */
    public static getEnvVars(): Record<string, string> {
        return { ...this.envVars };
    }

    /**
     * Retorna las variables de un scope específico (para el sidebar).
     */
    public static getScopeVars(scope: string): Record<string, string> {
        switch (scope) {
            case 'session': return { ...this.sessionVars };
            case 'collection': return { ...this.collectionVars };
            case 'env': return { ...this.envVars };
            case 'global':
                if (!this._globalState) { return {}; }
                return { ...this._globalState.get<Record<string, string>>(this.GLOBAL_KEY, {}) };
            default: return {};
        }
    }
}