import { VariableStore } from './variables';
import { RextRequest } from './parser';

export type ExportLanguage = 'curl' | 'javascript' | 'go' | 'dart' | 'python';

export interface ResolvedRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    bodyFile?: string;
    formData?: { key: string; value: string; file?: { path: string; mime?: string } }[];
}

export function resolveRequest(request: RextRequest): ResolvedRequest {
    let url = VariableStore.replaceInString(request.url);
    // Append @query params
    if (request.queryParams && request.queryParams.length > 0) {
        const params = request.queryParams.map(q => {
            const key = encodeURIComponent(VariableStore.replaceInString(q.key));
            const val = encodeURIComponent(VariableStore.replaceInString(q.value));
            return `${key}=${val}`;
        }).join('&');
        url += (url.includes('?') ? '&' : '?') + params;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
        headers[key] = VariableStore.replaceInString(value);
    }
    const body = request.body ? VariableStore.replaceInString(request.body) : undefined;
    const bodyFile = request.bodyFile ? VariableStore.replaceInString(request.bodyFile) : undefined;
    const formData = request.formData?.map(f => ({
        key: f.key,
        value: VariableStore.replaceInString(f.value),
        file: f.file ? { path: VariableStore.replaceInString(f.file.path), mime: f.file.mime } : undefined
    }));

    return { method: request.method, url, headers, body, bodyFile, formData };
}

export function generateCode(lang: ExportLanguage, request: RextRequest): string {
    const resolved = resolveRequest(request);
    switch (lang) {
        case 'curl': return toCurl(resolved);
        case 'javascript': return toJavaScript(resolved);
        case 'go': return toGo(resolved);
        case 'dart': return toDart(resolved);
        case 'python': return toPython(resolved);
    }
}

// ═══ cURL ═══

function toCurl(req: ResolvedRequest): string {
    const parts: string[] = [`curl -X ${req.method}`];

    // Headers
    for (const [key, value] of Object.entries(req.headers)) {
        parts.push(`  -H '${key}: ${value}'`);
    }

    // Body: formData > bodyFile > inline
    if (req.formData && req.formData.length > 0) {
        for (const field of req.formData) {
            if (field.file) {
                parts.push(`  -F '${field.key}=@${field.file.path}'`);
            } else {
                parts.push(`  -F '${field.key}=${field.value}'`);
            }
        }
    } else if (req.bodyFile) {
        parts.push(`  -d @${req.bodyFile}`);
    } else if (req.body) {
        const escaped = req.body.replace(/'/g, "'\\''");
        parts.push(`  -d '${escaped}'`);
    }

    parts.push(`  '${req.url}'`);
    return parts.join(' \\\n');
}

// ═══ JavaScript (fetch) ═══

function toJavaScript(req: ResolvedRequest): string {
    const lines: string[] = [];

    if (req.formData && req.formData.length > 0) {
        lines.push('const formData = new FormData();');
        for (const field of req.formData) {
            if (field.file) {
                lines.push(`// Adjuntar archivo: ${field.file.path}`);
                lines.push(`formData.append('${field.key}', fileInput.files[0]);`);
            } else {
                lines.push(`formData.append('${field.key}', '${escJs(field.value)}');`);
            }
        }
        lines.push('');
    }

    lines.push(`const response = await fetch('${escJs(req.url)}', {`);
    lines.push(`  method: '${req.method}',`);

    // Headers (skip Content-Type for formData)
    const headerEntries = Object.entries(req.headers)
        .filter(([k]) => !(req.formData && k.toLowerCase() === 'content-type'));
    if (headerEntries.length > 0) {
        lines.push('  headers: {');
        for (const [key, value] of headerEntries) {
            lines.push(`    '${key}': '${escJs(value)}',`);
        }
        lines.push('  },');
    }

    if (req.formData && req.formData.length > 0) {
        lines.push('  body: formData,');
    } else if (req.bodyFile) {
        lines.push(`  // Body desde archivo: ${req.bodyFile}`);
        lines.push(`  body: fs.readFileSync('${escJs(req.bodyFile)}', 'utf-8'),`);
    } else if (req.body) {
        const contentType = req.headers['Content-Type'] || req.headers['content-type'] || '';
        if (contentType.includes('json')) {
            lines.push(`  body: JSON.stringify(${req.body}),`);
        } else {
            lines.push(`  body: '${escJs(req.body)}',`);
        }
    }

    lines.push('});');
    lines.push('');
    lines.push('const data = await response.json();');
    lines.push('console.log(response.status, data);');

    return lines.join('\n');
}

// ═══ Go (net/http) ═══

function toGo(req: ResolvedRequest): string {
    const lines: string[] = [
        'package main',
        '',
        'import (',
        '\t"fmt"',
        '\t"io"',
        '\t"net/http"',
    ];

    if (req.body || req.bodyFile) {
        lines.push('\t"strings"');
    }
    if (req.formData) {
        lines.push('\t"bytes"');
        lines.push('\t"mime/multipart"');
        if (req.formData.some(f => f.file)) {
            lines.push('\t"os"');
            lines.push('\t"path/filepath"');
        }
    }

    lines.push(')');
    lines.push('');
    lines.push('func main() {');

    if (req.formData && req.formData.length > 0) {
        lines.push('\tvar buf bytes.Buffer');
        lines.push('\tw := multipart.NewWriter(&buf)');
        for (const field of req.formData) {
            if (field.file) {
                lines.push('');
                lines.push(`\t// Archivo: ${field.file.path}`);
                lines.push(`\tfile, _ := os.Open("${escGo(field.file.path)}")`);
                lines.push('\tdefer file.Close()');
                lines.push(`\tpart, _ := w.CreateFormFile("${escGo(field.key)}", filepath.Base("${escGo(field.file.path)}"))`);
                lines.push('\tio.Copy(part, file)');
            } else {
                lines.push(`\tw.WriteField("${escGo(field.key)}", "${escGo(field.value)}")`);
            }
        }
        lines.push('\tw.Close()');
        lines.push('');
        lines.push(`\treq, _ := http.NewRequest("${req.method}", "${escGo(req.url)}", &buf)`);
        lines.push('\treq.Header.Set("Content-Type", w.FormDataContentType())');
    } else if (req.body) {
        lines.push(`\tbody := strings.NewReader(\`${req.body}\`)`);
        lines.push(`\treq, _ := http.NewRequest("${req.method}", "${escGo(req.url)}", body)`);
    } else {
        lines.push(`\treq, _ := http.NewRequest("${req.method}", "${escGo(req.url)}", nil)`);
    }

    for (const [key, value] of Object.entries(req.headers)) {
        if (req.formData && key.toLowerCase() === 'content-type') { continue; }
        lines.push(`\treq.Header.Set("${escGo(key)}", "${escGo(value)}")`);
    }

    lines.push('');
    lines.push('\tresp, err := http.DefaultClient.Do(req)');
    lines.push('\tif err != nil {');
    lines.push('\t\tpanic(err)');
    lines.push('\t}');
    lines.push('\tdefer resp.Body.Close()');
    lines.push('');
    lines.push('\tresBody, _ := io.ReadAll(resp.Body)');
    lines.push('\tfmt.Println(resp.StatusCode, string(resBody))');
    lines.push('}');

    return lines.join('\n');
}

// ═══ Dart (http package) ═══

function toDart(req: ResolvedRequest): string {
    const lines: string[] = [
        "import 'package:http/http.dart' as http;",
    ];

    if (req.formData?.some(f => f.file)) {
        lines.push("import 'package:http_parser/http_parser.dart';");
    }
    lines.push("import 'dart:convert';");
    lines.push('');
    lines.push('Future<void> main() async {');

    const url = `Uri.parse('${escDart(req.url)}')`;

    if (req.formData && req.formData.length > 0) {
        lines.push(`  final request = http.MultipartRequest('${req.method}', ${url});`);
        for (const field of req.formData) {
            if (field.file) {
                const mime = field.file.mime || 'application/octet-stream';
                const [type, subtype] = mime.split('/');
                lines.push(`  request.files.add(await http.MultipartFile.fromPath(`);
                lines.push(`    '${escDart(field.key)}',`);
                lines.push(`    '${escDart(field.file.path)}',`);
                lines.push(`    contentType: MediaType('${type}', '${subtype}'),`);
                lines.push('  ));');
            } else {
                lines.push(`  request.fields['${escDart(field.key)}'] = '${escDart(field.value)}';`);
            }
        }
        // Headers
        for (const [key, value] of Object.entries(req.headers)) {
            if (key.toLowerCase() === 'content-type') { continue; }
            lines.push(`  request.headers['${escDart(key)}'] = '${escDart(value)}';`);
        }
        lines.push('');
        lines.push('  final streamed = await request.send();');
        lines.push('  final response = await http.Response.fromStream(streamed);');
    } else {
        // Headers map
        const headerEntries = Object.entries(req.headers);
        let headersStr = '{}';
        if (headerEntries.length > 0) {
            const pairs = headerEntries.map(([k, v]) => `    '${escDart(k)}': '${escDart(v)}',`);
            headersStr = `{\n${pairs.join('\n')}\n  }`;
        }

        const method = req.method.toLowerCase();
        const methodMap: Record<string, string> = { get: 'get', post: 'post', put: 'put', delete: 'delete', patch: 'patch' };
        const dartMethod = methodMap[method] || 'get';

        if (req.body) {
            lines.push(`  final response = await http.${dartMethod}(`);
            lines.push(`    ${url},`);
            lines.push(`    headers: ${headersStr},`);
            lines.push(`    body: jsonEncode(${req.body}),`);
            lines.push('  );');
        } else {
            lines.push(`  final response = await http.${dartMethod}(`);
            lines.push(`    ${url},`);
            lines.push(`    headers: ${headersStr},`);
            lines.push('  );');
        }
    }

    lines.push('');
    lines.push("  print('Status: ${response.statusCode}');");
    lines.push('  print(response.body);');
    lines.push('}');

    return lines.join('\n');
}

// ═══ Helpers ═══

function escJs(s: string): string { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n'); }
function escGo(s: string): string { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n'); }
function escDart(s: string): string { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n'); }
function escPy(s: string): string { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n'); }

// ═══ Python (requests) ═══

function toPython(req: ResolvedRequest): string {
    const lines: string[] = ['import requests', ''];

    // Headers
    const headerEntries = Object.entries(req.headers)
        .filter(([k]) => !(req.formData && k.toLowerCase() === 'content-type'));
    if (headerEntries.length > 0) {
        lines.push('headers = {');
        for (const [key, value] of headerEntries) {
            lines.push(`    '${escPy(key)}': '${escPy(value)}',`);
        }
        lines.push('}');
        lines.push('');
    }

    const method = req.method.toLowerCase();

    if (req.formData && req.formData.length > 0) {
        // FormData
        const textFields = req.formData.filter(f => !f.file);
        const fileFields = req.formData.filter(f => f.file);

        if (textFields.length > 0) {
            lines.push('data = {');
            for (const f of textFields) {
                lines.push(`    '${escPy(f.key)}': '${escPy(f.value)}',`);
            }
            lines.push('}');
            lines.push('');
        }

        if (fileFields.length > 0) {
            lines.push('files = {');
            for (const f of fileFields) {
                lines.push(`    '${escPy(f.key)}': open('${escPy(f.file!.path)}', 'rb'),`);
            }
            lines.push('}');
            lines.push('');
        }

        const args: string[] = [`'${escPy(req.url)}'`];
        if (headerEntries.length > 0) args.push('headers=headers');
        if (textFields.length > 0) args.push('data=data');
        if (fileFields.length > 0) args.push('files=files');
        lines.push(`response = requests.${method}(${args.join(', ')})`);
    } else if (req.bodyFile) {
        lines.push(`with open('${escPy(req.bodyFile)}', 'r') as f:`);
        lines.push('    body = f.read()');
        lines.push('');
        const args = [`'${escPy(req.url)}'`, 'data=body'];
        if (headerEntries.length > 0) args.push('headers=headers');
        lines.push(`response = requests.${method}(${args.join(', ')})`);
    } else if (req.body) {
        const contentType = req.headers['Content-Type'] || req.headers['content-type'] || '';
        if (contentType.includes('json')) {
            lines.push('import json');
            lines.push('');
            lines.push(`payload = ${req.body}`);
            lines.push('');
            const args = [`'${escPy(req.url)}'`, 'json=payload'];
            if (headerEntries.length > 0) args.push('headers=headers');
            lines.push(`response = requests.${method}(${args.join(', ')})`);
        } else {
            const args = [`'${escPy(req.url)}'`, `data='${escPy(req.body)}'`];
            if (headerEntries.length > 0) args.push('headers=headers');
            lines.push(`response = requests.${method}(${args.join(', ')})`);
        }
    } else {
        const args = [`'${escPy(req.url)}'`];
        if (headerEntries.length > 0) args.push('headers=headers');
        lines.push(`response = requests.${method}(${args.join(', ')})`);
    }

    lines.push('');
    lines.push('print(response.status_code)');
    lines.push('print(response.text)');

    return lines.join('\n');
}
