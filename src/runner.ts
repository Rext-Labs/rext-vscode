import axios from 'axios';
import { RextRequest } from './parser';
import { VariableStore } from './variables';
import { EnvironmentManager } from './environment';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const finalUrl = VariableStore.replaceInString(request.url);
  const finalBody = request.body ? VariableStore.replaceInString(request.body) : undefined;

  const finalHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    finalHeaders[key] = VariableStore.replaceInString(value);
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
            value = trimmedQuery.split('.').reduce((obj, key) => {
              if (key === 'body') { return obj; }
              return obj && obj[key] !== undefined ? obj[key] : undefined;
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