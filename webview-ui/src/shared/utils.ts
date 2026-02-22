export function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function statusClass(status: number): string {
    if (status >= 200 && status < 300) return 'status-2xx';
    if (status >= 500) return 'status-5xx';
    return 'status-err';
}

export function methodColor(method: string): string {
    const colors: Record<string, string> = {
        GET: '#61affe', POST: '#49cc90', PUT: '#fca130',
        PATCH: '#50e3c2', DELETE: '#f93e3e', HEAD: '#9012fe', OPTIONS: '#0d5aa7',
    };
    return colors[method.toUpperCase()] || '#999';
}
