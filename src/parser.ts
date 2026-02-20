export interface RextRequest {
  name?: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  captures: { scope: 'session' | 'collection' | 'env' | 'global'; variable: string; query: string }[];
  retry?: { count: number; delay: number };
  timeout?: number;
  startLine: number;
  endLine: number;
  assertions: { type: string; expected: string; actualPath?: string }[];
}

export function parseRext(content: string): RextRequest[] {
  const lines = content.split(/\r?\n/);
  const requests: RextRequest[] = [];

  // Cambiamos el tipo para que sea más explícito
  let currentRequest: RextRequest | null = null;
  let isParsingBody = false;
  const bodyBuffer: string[] = [];

  // Usamos entries() para tener el índice y la línea al mismo tiempo
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (trimmed.startsWith('###') || (currentRequest === null && trimmed !== '')) {
      if (currentRequest && currentRequest.url) {
        currentRequest.body = bodyBuffer.join('\n').trim();
        currentRequest.endLine = index - 1;
        requests.push(currentRequest);
      }

      currentRequest = {
        method: 'GET',
        url: '',
        headers: {},
        captures: [],
        assertions: [],
        startLine: index,
        endLine: index // Se actualizará al cerrar el bloque
      };
      isParsingBody = false;
      bodyBuffer.length = 0;

      if (trimmed.startsWith('###')) { continue; }
    }

    if (!currentRequest) { continue; }

    if (!isParsingBody && trimmed.startsWith('@name')) {
      const match = trimmed.match(/@name\s+(.+)/);
      if (match) {
        currentRequest.name = match[1].trim();
      }
      continue;
    }

    if (!isParsingBody && trimmed.startsWith('@retry')) {
      const match = trimmed.match(/@retry\s+(\d+)(?:\s+delay\s+(\d+))?/);
      if (match) {
        currentRequest.retry = {
          count: parseInt(match[1]),
          delay: match[2] ? parseInt(match[2]) : 500
        };
      }
      continue;
    }

    if (!isParsingBody && trimmed.startsWith('@timeout')) {
      const match = trimmed.match(/@timeout\s+(\d+)/);
      if (match) {
        currentRequest.timeout = parseInt(match[1]);
      }
      continue;
    }

    if (!isParsingBody && trimmed.startsWith('@capture')) {
      // Intentar formato con scope: @capture scope.variable.path = query
      const scopedMatch = trimmed.match(/@capture\s+(global|env|collection)\.([\w.]+)\s*=\s*(.+)/);
      if (scopedMatch) {
        currentRequest.captures.push({
          scope: scopedMatch[1] as 'global' | 'env' | 'collection',
          variable: scopedMatch[2],
          query: scopedMatch[3]
        });
        continue;
      }
      // Formato sin scope: @capture variable = query (sesión por defecto)
      const match = trimmed.match(/@capture\s+(\w+)\s*=\s*(.+)/);
      if (match) {
        currentRequest.captures.push({
          scope: 'session',
          variable: match[1],
          query: match[2]
        });
      }
      continue;
    }

    const methodMatch = trimmed.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+)$/i);
    if (!isParsingBody && methodMatch) {
      currentRequest.method = methodMatch[1].toUpperCase();
      currentRequest.url = methodMatch[2];
      continue;
    }

    if (!isParsingBody && trimmed.includes(':') && !trimmed.startsWith('http')) {
      const [key, ...valueParts] = trimmed.split(':');
      currentRequest.headers[key.trim()] = valueParts.join(':').trim();
      continue;
    }

    if (!isParsingBody && trimmed === '' && currentRequest.url !== '') {
      isParsingBody = true;
      continue;
    }

    if (isParsingBody) {
      bodyBuffer.push(line);
    }

    if (!isParsingBody && trimmed.startsWith('@assert')) {
      const statusMatch = trimmed.match(/@assert\s+status\s+==\s+(\d+)/);
      if (statusMatch) {
        currentRequest.assertions.push({ type: 'status', expected: statusMatch[1] });
      }

      const bodyMatch = trimmed.match(/@assert\s+body\.(\S+)\s+==\s+(.+)/);
      if (bodyMatch) {
        currentRequest.assertions.push({
          type: 'body',
          actualPath: bodyMatch[1],
          expected: bodyMatch[2].trim()
        });
      }
      continue;
    }
  }

  // Al usar for...of, TypeScript ahora sí entiende que currentRequest puede no ser null
  if (currentRequest && currentRequest.url) {
    currentRequest.body = bodyBuffer.join('\n').trim();
    currentRequest.endLine = lines.length - 1;
    requests.push(currentRequest);
  }

  return requests;
}