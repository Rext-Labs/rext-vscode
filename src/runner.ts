import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { RextRequest } from './parser';
import { VariableStore } from './variables';
import { EnvironmentManager } from './environment';

const MIME_MAP: Record<string, string> = {
  '.json': 'application/json', '.xml': 'application/xml', '.html': 'text/html',
  '.txt': 'text/plain', '.csv': 'text/csv', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

const TEXT_MIMES = new Set(['application/json', 'application/xml', 'text/html', 'text/plain', 'text/csv', 'text/css', 'application/javascript']);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse access path supporting array notation:
 * "body.data[0].id" → ["body", "data", 0, "id"]
 * "body.items[2].name" → ["body", "items", 2, "name"]
 */
function parseAccessPath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  for (const part of path.split('.')) {
    const bracketMatch = part.match(/^([^\[]+)\[(\d+)\]$/);
    if (bracketMatch) {
      segments.push(bracketMatch[1]);
      segments.push(parseInt(bracketMatch[2], 10));
    } else {
      segments.push(part);
    }
  }
  return segments;
}

async function executeRequest(method: string, url: string, data: any, headers: Record<string, string>, timeout?: number) {
  return axios({
    method,
    url,
    data,
    headers,
    timeout,
    validateStatus: () => true
  });
}

export async function runRequest(request: RextRequest, allRequests?: RextRequest[], _executedIds?: Set<string>): Promise<any> {
  const preResults: any[] = [];

  // --- Pre-request execution ---
  if (request.preRequestIds && request.preRequestIds.length > 0 && allRequests) {
    const executed = _executedIds || new Set<string>();
    if (request.id) { executed.add(request.id); } // prevent cycles
    for (const preId of request.preRequestIds) {
      if (executed.has(preId)) { continue; } // skip already executed or cyclic
      const preReq = allRequests.find(r => r.id === preId);
      if (preReq) {
        executed.add(preId);
        const preResult = await runRequest(preReq, allRequests, executed);
        preResults.push(preResult);
      }
    }
  }

  // 1. Reemplazar variables antes de enviar
  let finalUrl = VariableStore.replaceInString(request.url);

  // Append @query params
  if (request.queryParams && request.queryParams.length > 0) {
    const params = request.queryParams.map(q => {
      const key = encodeURIComponent(VariableStore.replaceInString(q.key));
      const val = encodeURIComponent(VariableStore.replaceInString(q.value));
      return `${key}=${val}`;
    }).join('&');
    finalUrl += (finalUrl.includes('?') ? '&' : '?') + params;
  }

  const finalHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    finalHeaders[key] = VariableStore.replaceInString(value);
  }

  // Resolver body: formData > bodyFile > body inline
  let finalBody: any = undefined;
  const rextFilePath = (request as any)._filePath as string | undefined;
  const baseDir = rextFilePath ? path.dirname(rextFilePath) : undefined;

  if (request.formData && request.formData.length > 0) {
    // --- FormData ---
    const FormData = require('form-data');
    const form = new FormData();
    for (const field of request.formData) {
      const resolvedValue = VariableStore.replaceInString(field.value);
      if (field.file) {
        const filePath = baseDir
          ? path.resolve(baseDir, VariableStore.replaceInString(field.file.path))
          : VariableStore.replaceInString(field.file.path);
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          const mime = field.file.mime || MIME_MAP[ext] || 'application/octet-stream';
          form.append(field.key, fs.createReadStream(filePath), {
            filename: path.basename(filePath),
            contentType: mime
          });
        }
      } else {
        form.append(field.key, resolvedValue);
      }
    }
    finalBody = form;
    Object.assign(finalHeaders, form.getHeaders());
  } else if (request.bodyFile) {
    // --- Body desde archivo ---
    const resolvedPath = VariableStore.replaceInString(request.bodyFile);
    const filePath = baseDir ? path.resolve(baseDir, resolvedPath) : resolvedPath;
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      if (TEXT_MIMES.has(mime)) {
        finalBody = VariableStore.replaceInString(fs.readFileSync(filePath, 'utf-8'));
      } else {
        finalBody = fs.readFileSync(filePath);
      }
    }
  } else if (request.body) {
    finalBody = VariableStore.replaceInString(request.body);
  }

  const maxAttempts = request.retry ? request.retry.count + 1 : 1;
  const retryDelay = request.retry?.delay ?? 500;
  let lastError: any = null;

  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await executeRequest(request.method, finalUrl, finalBody, finalHeaders, request.timeout);

      // Si el status indica error del servidor y quedan reintentos, reintentar
      if (response.status >= 500 && attempt < maxAttempts) {
        lastError = { status: response.status, data: response.data };
        await sleep(retryDelay);
        continue;
      }

      // 2. Procesar Capturas (@capture) con scopes
      if (request.captures.length > 0) {
        request.captures.forEach(cap => {
          let value: any;
          const trimmedQuery = cap.query.trim();

          // Detectar valor literal entre comillas: "texto" o 'texto'
          const literalMatch = trimmedQuery.match(/^["'](.*)["']$/);
          if (literalMatch) {
            value = literalMatch[1];
          }
          // Detectar valor numérico literal
          else if (/^\d+(\.\d+)?$/.test(trimmedQuery)) {
            value = trimmedQuery;
          }
          // Detectar booleanos
          else if (trimmedQuery === 'true' || trimmedQuery === 'false') {
            value = trimmedQuery;
          }
          // Resolver path del response (body.path.to.value)
          else if (response.data) {
            // Parse path supporting array notation: body.data[0].id, body.items[2].name
            const segments = parseAccessPath(trimmedQuery);
            value = segments.reduce((obj: any, seg: string | number) => {
              if (seg === 'body') { return obj; }
              return obj != null ? obj[seg] : undefined;
            }, response.data);
          }

          if (value !== undefined) {
            VariableStore.setScoped(cap.scope, cap.variable, value);
            // Persistir en rext.env.json si el scope es env
            if (cap.scope === 'env') {
              const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
              EnvironmentManager.setEnvVariable(cap.variable, strValue);
            }
          }
        });
      }

      const results: { label: string; pass: boolean }[] = [];
      const duration = Date.now() - startTime;

      // Calculate response size early for assertions
      const rawData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const responseSize = rawData ? new TextEncoder().encode(rawData).length : 0;

      // Helper: resolve nested path
      const resolvePath = (obj: any, path: string): any => {
        return path.split('.').reduce((o: any, k: string) => o != null ? o[k] : undefined, obj);
      };

      request.assertions.forEach(a => {
        let actual: any;
        let label = `${a.target}${a.path ? '.' + a.path : ''} ${a.operator}${a.expected != null ? ' ' + a.expected : ''}`;

        // Resolve actual value based on target
        switch (a.target) {
          case 'status': actual = response.status; break;
          case 'body': actual = a.path ? resolvePath(response.data, a.path) : response.data; break;
          case 'header': actual = a.path ? response.headers[a.path.toLowerCase()] : response.headers; break;
          case 'duration': actual = duration; break;
          case 'size': actual = responseSize; break;
          case 'cookie': {
            const setCk = response.headers['set-cookie'];
            if (setCk && a.path) {
              const arr = Array.isArray(setCk) ? setCk : [setCk];
              const found = arr.find((c: string) => c.trim().startsWith(a.path + '='));
              actual = found ? found.split('=').slice(1).join('=').split(';')[0] : undefined;
            }
            break;
          }
        }

        let pass = false;
        const actualStr = String(actual);
        const expectedStr = a.expected || '';

        switch (a.operator) {
          case '==': pass = actualStr === expectedStr; break;
          case '!=': pass = actualStr !== expectedStr; break;
          case '>': pass = Number(actual) > Number(expectedStr); break;
          case '<': pass = Number(actual) < Number(expectedStr); break;
          case '>=': pass = Number(actual) >= Number(expectedStr); break;
          case '<=': pass = Number(actual) <= Number(expectedStr); break;
          case 'contains': pass = actualStr.includes(expectedStr); break;
          case 'exists': pass = actual !== undefined && actual !== null; break;
          case '!exists': pass = actual === undefined || actual === null; break;
          case 'isArray': pass = Array.isArray(actual); break;
          case 'isNumber': pass = typeof actual === 'number' || !isNaN(Number(actual)); break;
          case 'isNull': pass = actual === null; break;
          case 'isUndefined': pass = actual === undefined; break;
          case 'isEmpty': pass = actual === '' || actual === null || actual === undefined || (Array.isArray(actual) && actual.length === 0) || (typeof actual === 'object' && actual !== null && Object.keys(actual).length === 0); break;
        }

        results.push({ label, pass });
      });

      // responseSize and duration already calculated above for assertions

      // Extract cookies from set-cookie header
      const setCookie = response.headers['set-cookie'];
      const cookies: { name: string; value: string; attributes: string }[] = [];
      if (setCookie) {
        const cookieArr = Array.isArray(setCookie) ? setCookie : [setCookie];
        cookieArr.forEach((c: string) => {
          const parts = c.split(';');
          const [nameVal, ...attrs] = parts;
          const eqIdx = nameVal.indexOf('=');
          if (eqIdx > 0) {
            cookies.push({
              name: nameVal.substring(0, eqIdx).trim(),
              value: nameVal.substring(eqIdx + 1).trim(),
              attributes: attrs.map(a => a.trim()).join('; ')
            });
          }
        });
      }

      return {
        name: request.name,
        method: request.method,
        url: finalUrl,
        status: response.status,
        duration,
        attempts: attempt,
        maxAttempts,
        data: response.data,
        headers: response.headers,
        requestHeaders: finalHeaders,
        requestBody: typeof finalBody === 'string' ? finalBody : (finalBody ? '[binary]' : undefined),
        assertions: results,
        size: responseSize,
        cookies,
        preResults: preResults.length > 0 ? preResults : undefined
      };
    } catch (error: any) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(retryDelay);
        continue;
      }
      return {
        name: request.name,
        method: request.method,
        url: finalUrl,
        status: 0,
        duration: Date.now() - startTime,
        attempts: attempt,
        maxAttempts,
        data: lastError.message,
        headers: {}
      };
    }
  }

  // Fallback (no debería llegar aquí)
  return {
    name: request.name,
    method: request.method,
    url: finalUrl,
    status: 0,
    duration: Date.now() - startTime,
    attempts: maxAttempts,
    maxAttempts,
    data: lastError?.message || 'Error desconocido',
    headers: {}
  };
}