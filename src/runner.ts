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

export async function runRequest(request: RextRequest) {
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
      request.assertions.forEach(assertion => {
        if (assertion.type === 'status') {
          const pass = response.status.toString() === assertion.expected;
          results.push({ label: `Status is ${assertion.expected}`, pass });
        }

        if (assertion.type === 'body' && assertion.actualPath) {
          const actualValue = assertion.actualPath.split('.').reduce((obj, key) => obj?.[key], response.data);
          const pass = String(actualValue) === assertion.expected;
          results.push({ label: `Body ${assertion.actualPath} == ${assertion.expected}`, pass });
        }
      });

      return {
        name: request.name,
        method: request.method,
        url: finalUrl,
        status: response.status,
        duration: Date.now() - startTime,
        attempts: attempt,
        maxAttempts,
        data: response.data,
        headers: response.headers,
        assertions: results
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