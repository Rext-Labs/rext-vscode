// VS Code API wrapper for webview
interface VsCodeApi {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

let _vscodeApi: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
    if (!_vscodeApi) {
        // @ts-ignore - acquireVsCodeApi is injected by VS Code
        _vscodeApi = acquireVsCodeApi();
    }
    return _vscodeApi!;
}

export function postMessage(command: string, data?: any) {
    getVsCodeApi().postMessage({ command, ...data });
}
