import { VariableStore } from './variables';
import { RextRequest, RextConfig } from './parser';

export type ExportLanguage = 'curl' | 'javascript' | 'go' | 'dart' | 'python' | 'postman';

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

export function generateCode(lang: ExportLanguage, request: RextRequest, allRequests?: RextRequest[]): string {
    const resolved = resolveRequest(request);
    switch (lang) {
        case 'curl': return toCurl(resolved);
        case 'javascript': return toJavaScript(resolved);
        case 'go': return toGo(resolved);
        case 'dart': return toDart(resolved);
        case 'python': return toPython(resolved);
        case 'postman': {
            const item = toPostmanItem(request, allRequests);
            const collection = {
                info: {
                    name: request.name || `${request.method} ${request.url}`,
                    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
                },
                item: [item],
            };
            return JSON.stringify(collection, null, 2);
        }
    }
}

// ═══ Postman Collection v2.1 ═══

interface PostmanUrl {
    raw: string;
    protocol?: string;
    host: string[];
    path: string[];
    query?: { key: string; value: string }[];
}

function parseUrlForPostman(rawUrl: string): PostmanUrl {
    // Replace {{var}} with :var for Postman path variables
    let url = rawUrl;

    // Extract protocol
    let protocol: string | undefined;
    const protocolMatch = url.match(/^(https?):\/\//);
    if (protocolMatch) {
        protocol = protocolMatch[1];
        url = url.replace(/^https?:\/\//, '');
    }

    // Extract query string
    let query: { key: string; value: string }[] | undefined;
    const qIdx = url.indexOf('?');
    if (qIdx !== -1) {
        const qs = url.substring(qIdx + 1);
        url = url.substring(0, qIdx);
        query = qs.split('&').map(p => {
            const [k, ...v] = p.split('=');
            return { key: decodeURIComponent(k), value: decodeURIComponent(v.join('=')) };
        });
    }

    // Split host and path
    const parts = url.split('/');
    const hostStr = parts[0] || '';
    const host = hostStr.split('.');
    const path = parts.slice(1).filter(Boolean);

    const result: PostmanUrl = {
        raw: rawUrl,
        host,
        path,
    };
    if (protocol) result.protocol = protocol;
    if (query && query.length > 0) result.query = query;
    return result;
}

export function toPostmanItem(request: RextRequest, allRequests?: RextRequest[]): any {
    const resolved = resolveRequest(request);

    // Build header array
    const headers = Object.entries(resolved.headers).map(([key, value]) => ({
        key,
        value,
        type: 'text' as const,
    }));

    // Build body
    let body: any = undefined;
    if (resolved.formData && resolved.formData.length > 0) {
        body = {
            mode: 'formdata',
            formdata: resolved.formData.map(f => {
                if (f.file) {
                    return { key: f.key, type: 'file', src: f.file.path };
                }
                return { key: f.key, value: f.value, type: 'text' };
            }),
        };
    } else if (resolved.body) {
        const ct = resolved.headers['Content-Type'] || resolved.headers['content-type'] || '';
        body = {
            mode: 'raw',
            raw: resolved.body,
            options: {
                raw: {
                    language: ct.includes('json') ? 'json' : ct.includes('xml') ? 'xml' : 'text',
                },
            },
        };
    }

    // Build URL with @query params
    const url = parseUrlForPostman(resolved.url);
    if (request.queryParams && request.queryParams.length > 0) {
        const extraQuery = request.queryParams.map(q => ({
            key: VariableStore.replaceInString(q.key),
            value: VariableStore.replaceInString(q.value),
        }));
        url.query = [...(url.query || []), ...extraQuery];
    }

    // Build event scripts
    const events: any[] = [];

    // @pre → pm.sendRequest() in prerequest script
    const missingPreIds: string[] = [];
    if (request.preRequestIds && request.preRequestIds.length > 0 && allRequests) {
        const preLines: string[] = [];
        for (const preId of request.preRequestIds) {
            const preReq = allRequests.find(r => r.id === preId);
            if (preReq) {
                const preResolved = resolveRequest(preReq);
                const preName = preReq.name || `${preReq.method} ${preReq.url}`;
                preLines.push(`// @pre ${preId} → ${preName}`);

                // Build pm.sendRequest options
                const opts: string[] = [];
                opts.push(`    url: "${preResolved.url}"`);
                opts.push(`    method: "${preReq.method.toUpperCase()}"`);

                // Headers
                const preHeaders = Object.entries(preResolved.headers);
                if (preHeaders.length > 0) {
                    const hdrLines = preHeaders.map(([k, v]) => `        { key: "${k}", value: "${v}" }`);
                    opts.push(`    header: [\n${hdrLines.join(',\n')}\n    ]`);
                }

                // Body
                if (preResolved.body) {
                    const escaped = preResolved.body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
                    opts.push(`    body: {\n        mode: "raw",\n        raw: "${escaped}"\n    }`);
                }

                preLines.push(`pm.sendRequest({`);
                preLines.push(opts.join(',\n'));
                preLines.push(`}, function (err, res) {`);

                // Auto-set captures from the pre-request
                if (preReq.captures && preReq.captures.length > 0) {
                    for (const cap of preReq.captures) {
                        const pmScope = captureScopeToPm(cap.scope);
                        const accessor = captureQueryToAccessor(cap.query).replace('pm.response', 'res');
                        preLines.push(`    ${pmScope}("${cap.variable}", ${accessor});`);
                    }
                }

                preLines.push(`});`);
                preLines.push('');
            } else {
                missingPreIds.push(preId);
            }
        }

        if (preLines.length > 0) {
            events.push({
                listen: 'prerequest',
                script: {
                    type: 'text/javascript',
                    exec: preLines,
                },
            });
        }
    }

    // @capture + @assert → test script
    const testLines: string[] = [];

    // @capture → pm.environment.set / pm.collectionVariables.set / pm.globals.set
    if (request.captures && request.captures.length > 0) {
        for (const cap of request.captures) {
            const pmScope = captureScopeToPm(cap.scope);
            const accessor = captureQueryToAccessor(cap.query);
            testLines.push(`// @capture ${cap.scope}.${cap.variable} = ${cap.query}`);
            testLines.push(`${pmScope}("${cap.variable}", ${accessor});`);
            testLines.push('');
        }
    }

    // @assert → pm.test()
    if (request.assertions && request.assertions.length > 0) {
        for (const a of request.assertions) {
            const testScript = assertionToPmTest(a);
            if (testScript) testLines.push(testScript);
        }
    }

    if (testLines.length > 0) {
        events.push({
            listen: 'test',
            script: {
                type: 'text/javascript',
                exec: testLines,
            },
        });
    }

    const item: any = {
        name: request.name || `${request.method} ${request.url}`,
        request: {
            method: request.method.toUpperCase(),
            header: headers,
            url,
        },
    };

    if (body) item.request.body = body;
    if (events.length > 0) item.event = events;

    // Attach missing pre IDs for the caller to handle
    if (missingPreIds.length > 0) {
        item._missingPreIds = missingPreIds;
    }

    return item;
}

function captureScopeToPm(scope: string): string {
    switch (scope) {
        case 'env': return 'pm.environment.set';
        case 'global': return 'pm.globals.set';
        case 'collection': return 'pm.collectionVariables.set';
        default: return 'pm.variables.set'; // session → local
    }
}

function captureQueryToAccessor(query: string): string {
    // body.access_token → pm.response.json().access_token
    // body.data.items[0].id → pm.response.json().data.items[0].id
    // header.Authorization → pm.response.headers.get("Authorization")
    // status → pm.response.code
    if (query.startsWith('body.')) {
        const path = query.substring(5);
        return `pm.response.json().${path}`;
    }
    if (query.startsWith('header.')) {
        const headerName = query.substring(7);
        return `pm.response.headers.get("${headerName}")`;
    }
    if (query === 'status') {
        return 'pm.response.code';
    }
    return `pm.response.json().${query}`;
}

function assertionToPmTest(a: { target: string; path?: string; operator: string; expected?: string }): string {
    const desc = `${a.target}${a.path ? '.' + a.path : ''} ${a.operator}${a.expected ? ' ' + a.expected : ''}`;

    if (a.target === 'status') {
        if (a.operator === '==') return `pm.test("Status is ${a.expected}", function () { pm.response.to.have.status(${a.expected}); });`;
        return `pm.test("${desc}", function () { pm.expect(pm.response.code).to.${opToChaiMethod(a.operator, a.expected)}; });`;
    }
    if (a.target === 'body' && a.path) {
        const accessor = `pm.response.json().${a.path}`;
        if (a.operator === 'exists') return `pm.test("${desc}", function () { pm.expect(${accessor}).to.exist; });`;
        if (a.operator === '!exists') return `pm.test("${desc}", function () { pm.expect(${accessor}).to.be.undefined; });`;
        if (a.operator === 'isArray') return `pm.test("${desc}", function () { pm.expect(${accessor}).to.be.an('array'); });`;
        if (a.operator === 'contains') return `pm.test("${desc}", function () { pm.expect(${accessor}).to.include(${JSON.stringify(a.expected)}); });`;
        if (a.operator === '==') return `pm.test("${desc}", function () { pm.expect(${accessor}).to.eql(${JSON.stringify(a.expected)}); });`;
        return `pm.test("${desc}", function () { pm.expect(${accessor}).to.${opToChaiMethod(a.operator, a.expected)}; });`;
    }
    if (a.target === 'duration' && a.operator === '<' && a.expected) {
        return `pm.test("Response time < ${a.expected}ms", function () { pm.expect(pm.response.responseTime).to.be.below(${a.expected}); });`;
    }
    return `pm.test("${desc}", function () { /* TODO: manual assertion */ });`;
}

function opToChaiMethod(op: string, expected?: string): string {
    const val = expected !== undefined ? JSON.stringify(expected) : 'undefined';
    switch (op) {
        case '==': return `eql(${val})`;
        case '!=': return `not.eql(${val})`;
        case '>': return `be.above(${val})`;
        case '<': return `be.below(${val})`;
        case '>=': return `be.at.least(${val})`;
        case '<=': return `be.at.most(${val})`;
        default: return `eql(${val})`;
    }
}

export function toPostmanCollection(requests: RextRequest[], collectionName: string, configs?: RextConfig[]): any {
    // Group by @group for folders
    const rootItems: any[] = [];
    const folders = new Map<string, any[]>();

    for (const req of requests) {
        const item = toPostmanItem(req, requests);
        if (req.group) {
            if (!folders.has(req.group)) folders.set(req.group, []);
            folders.get(req.group)!.push(item);
        } else {
            rootItems.push(item);
        }
    }

    // Build folder items
    const allItems: any[] = [];
    for (const [groupName, groupItems] of folders) {
        // Support nested groups: "Auth/Login" → nested folders
        const parts = groupName.split('/');
        let current = allItems;
        for (let i = 0; i < parts.length; i++) {
            const name = parts[i].trim();
            let folder = current.find((f: any) => f.name === name && f.item);
            if (!folder) {
                folder = { name, item: [] };
                current.push(folder);
            }
            current = folder.item;
        }
        current.push(...groupItems);
    }
    allItems.push(...rootItems);

    // Extract variables from @config baseUrl
    const variables: any[] = [];
    if (configs) {
        for (const cfg of configs) {
            if (cfg.baseUrl) {
                variables.push({ key: 'baseUrl', value: cfg.baseUrl, type: 'string' });
                break;
            }
        }
    }

    return {
        info: {
            name: collectionName,
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: allItems,
        ...(variables.length > 0 ? { variable: variables } : {}),
    };
}

/**
 * Finds @pre IDs in `requests` that reference requests NOT present in the same array.
 * Returns the unique set of missing IDs.
 */
export function findMissingPreRequestIds(requests: RextRequest[]): string[] {
    const ids = new Set(requests.map(r => r.id).filter(Boolean));
    const missing = new Set<string>();
    for (const req of requests) {
        if (req.preRequestIds) {
            for (const preId of req.preRequestIds) {
                if (!ids.has(preId)) {
                    missing.add(preId);
                }
            }
        }
    }
    return Array.from(missing);
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
