export interface RextConfig {
  collection?: string;
  baseUrl?: string;
  headers: Record<string, string>;
  timeout?: number;
  retries?: number;
  assertions: RextAssertion[];
  startLine: number;
  endLine: number;
  filePath?: string; // set externally for cross-file resolution
}

export interface RextRequest {
  id?: string;
  hasMissingId?: boolean;
  name?: string;
  collection?: string;
  group?: string;
  tags?: string[];
  deprecated?: boolean;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  captures: { scope: 'session' | 'collection' | 'env' | 'global'; variable: string; query: string }[];
  retry?: { count: number; delay: number };
  timeout?: number;
  startLine: number;
  endLine: number;
  assertions: RextAssertion[];
  preRequestIds?: string[];
  resolvedConfig?: RextConfig;
};

export interface RextAssertion {
  target: 'status' | 'body' | 'header' | 'duration' | 'size' | 'cookie';
  path?: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'exists' | '!exists' | 'isArray' | 'isNumber' | 'isNull' | 'isUndefined' | 'isEmpty';
  expected?: string;
}

function splitTargetPath(input: string): [string, string | undefined] {
  const dot = input.indexOf('.');
  if (dot === -1) { return [input, undefined]; }
  return [input.substring(0, dot), input.substring(dot + 1)];
}

export interface ParseResult {
  requests: RextRequest[];
  configs: RextConfig[];
}

export function parseRextFull(content: string): ParseResult {
  const result = parseRextInternal(content);
  return { requests: result.requests, configs: result.configs };
}

export function parseRext(content: string): RextRequest[] {
  return parseRextInternal(content).requests;
}

function parseConfigBlock(lines: string[], startIdx: number): { config: RextConfig; endIdx: number } {
  const config: RextConfig = { headers: {}, assertions: [], startLine: startIdx, endLine: startIdx };
  let i = startIdx + 1; // skip @config line
  let parsingHeaders = false;
  let parsingAsserts = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // End of config block
    if (trimmed.startsWith('###') || trimmed === '@config' || (trimmed.startsWith('@') && !trimmed.startsWith('@config'))) {
      break;
    }
    // Skip empty lines at end
    if (trimmed === '' && i + 1 < lines.length && (lines[i + 1].trim().startsWith('###') || lines[i + 1].trim() === '@config' || lines[i + 1].trim() === '')) {
      config.endLine = i;
      i++;
      continue;
    }

    // Indented line = part of headers or asserts block
    if ((line.startsWith('  ') || line.startsWith('\t')) && (parsingHeaders || parsingAsserts)) {
      if (parsingHeaders && trimmed.includes(':')) {
        const [key, ...vp] = trimmed.split(':');
        config.headers[key.trim()] = vp.join(':').trim();
      }
      if (parsingAsserts) {
        const statusM = trimmed.match(/^status\s+==?\s+(\d+)/);
        if (statusM) { config.assertions.push({ target: 'status', operator: '==', expected: statusM[1] }); }
        const bodyM = trimmed.match(/^body\.(\S+)\s+==?\s+(.+)/);
        if (bodyM) { config.assertions.push({ target: 'body', path: bodyM[1], operator: '==', expected: bodyM[2].trim() }); }
      }
    } else {
      parsingHeaders = false;
      parsingAsserts = false;
      // Top-level keys
      if (trimmed === 'headers:') { parsingHeaders = true; }
      else if (trimmed === 'assert:') { parsingAsserts = true; }
      else if (trimmed.startsWith('baseUrl:')) { config.baseUrl = trimmed.replace('baseUrl:', '').trim(); }
      else if (trimmed.startsWith('collection:')) { config.collection = trimmed.replace('collection:', '').trim(); }
      else if (trimmed.startsWith('timeout:')) { config.timeout = parseInt(trimmed.replace('timeout:', '').trim()); }
      else if (trimmed.startsWith('retries:')) { config.retries = parseInt(trimmed.replace('retries:', '').trim()); }
    }
    config.endLine = i;
    i++;
  }
  return { config, endIdx: i };
}

function parseRextInternal(content: string): { requests: RextRequest[]; configs: RextConfig[] } {
  const lines = content.split(/\r?\n/);
  const requests: RextRequest[] = [];
  const configs: RextConfig[] = [];
  let fileCollection: string | undefined;
  let fileTags: string[] | undefined;
  let currentRequest: RextRequest | null = null;
  let isParsingBody = false;
  let bodyBuffer: string[] = [];

  let inDocBlock = false;

  // Usamos entries() para tener el índice y la línea al mismo tiempo
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    // Detectar bloque @config
    if (trimmed === '@config') {
      // Flush current request if any
      if (currentRequest && currentRequest.url) {
        currentRequest.body = bodyBuffer.join('\n').trim();
        currentRequest.endLine = index - 1;
        requests.push(currentRequest);
        currentRequest = null;
        isParsingBody = false;
        bodyBuffer.length = 0;
      }
      const { config, endIdx } = parseConfigBlock(lines, index);
      configs.push(config);
      index = endIdx - 1; // -1 because for loop increments
      continue;
    }

    // Detectar bloque JSDoc /** ... */ para directivas file-level
    if (trimmed.startsWith('/**')) { inDocBlock = true; continue; }
    if (inDocBlock) {
      if (trimmed === '*/' || trimmed.endsWith('*/')) { inDocBlock = false; continue; }
      const clean = trimmed.replace(/^\*\s*/, ''); // quitar * prefix
      const collMatch = clean.match(/^@collection\s+(.+)/);
      if (collMatch) { fileCollection = collMatch[1].trim(); }
      const tagsMatch = clean.match(/^@tags\s+(.+)/);
      if (tagsMatch) { fileTags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean); }
      continue;
    }

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
        endLine: index
      };
      isParsingBody = false;
      bodyBuffer.length = 0;

      if (trimmed.startsWith('###')) { continue; }
    }

    // @collection dentro de un request = override individual
    if (currentRequest && !isParsingBody && trimmed.startsWith('@collection')) {
      const match = trimmed.match(/@collection\s+(.+)/);
      if (match) { currentRequest.collection = match[1].trim(); }
      continue;
    }

    if (!currentRequest) { continue; }

    if (!isParsingBody && trimmed.startsWith('@id')) {
      const idMatch = trimmed.match(/@id\s+([a-zA-Z0-9]{6})/);
      if (idMatch) {
        currentRequest.id = idMatch[1];
      }
      continue;
    }

    if (!isParsingBody && trimmed.startsWith('@group')) {
      const match = trimmed.match(/@group\s+(.+)/);
      if (match) { currentRequest.group = match[1].trim(); }
      continue;
    }

    if (!isParsingBody && trimmed.startsWith('@tags')) {
      const match = trimmed.match(/@tags\s+(.+)/);
      if (match) {
        currentRequest.tags = match[1].split(',').map(t => t.trim()).filter(Boolean);
      }
      continue;
    }

    if (!isParsingBody && trimmed.startsWith('@pre')) {
      const match = trimmed.match(/@pre\s+([a-zA-Z0-9]{6})/);
      if (match) {
        if (!currentRequest.preRequestIds) { currentRequest.preRequestIds = []; }
        currentRequest.preRequestIds.push(match[1]);
      }
      continue;
    }

    if (!isParsingBody && trimmed === '@deprecated') {
      currentRequest.deprecated = true;
      continue;
    }

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

    if (trimmed.startsWith('@header')) {
      const match = trimmed.match(/@header\s+([^:]+):\s*(.+)/);
      if (match) {
        currentRequest.headers[match[1].trim()] = match[2].trim();
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
      // Check if body should end: empty line followed by @ directive, or direct @ directive after body
      if (trimmed.startsWith('@')) {
        // Directive found — terminate body, reprocess this line as directive
        isParsingBody = false;
        currentRequest.body = bodyBuffer.join('\n').trim();
        bodyBuffer = [];
        // Fall through to directive processing below
      } else {
        bodyBuffer.push(line);
        continue;
      }
    }

    if (!isParsingBody && trimmed.startsWith('@assert')) {
      const assertStr = trimmed.replace('@assert', '').trim();

      // Unary operators: target.path operator (no expected value)
      const unaryMatch = assertStr.match(/^(\S+)\s+(exists|!exists|isArray|isNumber|isNull|isUndefined|isEmpty)$/);
      if (unaryMatch) {
        const [target, path] = splitTargetPath(unaryMatch[1]);
        currentRequest.assertions.push({ target: target as any, path, operator: unaryMatch[2] as any });
      } else {
        // Binary operators: target.path operator expected
        const binaryMatch = assertStr.match(/^(\S+)\s+(==|!=|>=|<=|>|<|contains)\s+(.+)$/);
        if (binaryMatch) {
          const [target, path] = splitTargetPath(binaryMatch[1]);
          currentRequest.assertions.push({ target: target as any, path, operator: binaryMatch[2] as any, expected: binaryMatch[3].trim() });
        }
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

  // Asignar file-level collection/tags (si no tiene override) y marcar sin @id
  requests.forEach(req => {
    if (fileCollection && !req.collection) { req.collection = fileCollection; }
    if (fileTags) {
      const reqTags = req.tags || [];
      req.tags = [...new Set([...fileTags, ...reqTags])];
    }
    if (!req.id) { req.hasMissingId = true; }
  });

  // Resolver config para cada request
  const fileConfig = configs.find(c => !c.collection); // config sin collection = file-level
  requests.forEach(req => {
    // Buscar config específica de la collection del request
    const collConfig = req.collection ? configs.find(c => c.collection === req.collection) : undefined;
    const cfg = collConfig || fileConfig;
    if (cfg) {
      req.resolvedConfig = cfg;
      // Aplicar baseUrl a URLs relativas
      if (cfg.baseUrl && req.url.startsWith('/')) {
        req.url = cfg.baseUrl.replace(/\/$/, '') + req.url;
      }
      // Merge headers: config como base, request overrides
      req.headers = { ...cfg.headers, ...req.headers };
      // Timeout y retries: solo si request no los tiene
      if (cfg.timeout && !req.timeout) { req.timeout = cfg.timeout; }
      if (cfg.retries && !req.retry) { req.retry = { count: cfg.retries, delay: 500 }; }
      // Assertions: acumular
      if (cfg.assertions.length) {
        req.assertions = [...cfg.assertions, ...req.assertions];
      }
    }
  });

  return { requests, configs };
}