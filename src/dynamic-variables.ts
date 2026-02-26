import { randomUUID } from 'crypto';

// ─── Catálogo de Variables Dinámicas ─────────────────────────────────
// Cada entrada: nombre → { generate(params), description, example }

export interface DynamicVarEntry {
    generate: (params?: string[]) => string;
    description: string;
    example: string;
    /** Si true, se muestra con snippet de parámetros en autocompletado */
    hasParams?: boolean;
    paramSnippet?: string;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n: number, len = 2): string {
    return String(n).padStart(len, '0');
}

// ─── Formateador de fechas ───────────────────────────────────────────

function formatDate(date: Date, fmt: string): string {
    return fmt
        .replace('YYYY', String(date.getFullYear()))
        .replace('MMMM', MONTH_FULL[date.getMonth()])
        .replace('MMM', MONTH_ABBR[date.getMonth()])
        .replace('MM', pad(date.getMonth() + 1))
        .replace('DD', pad(date.getDate()))
        .replace('HH', pad(date.getHours()))
        .replace('mm', pad(date.getMinutes()))
        .replace('ss', pad(date.getSeconds()))
        .replace('SSS', pad(date.getMilliseconds(), 3));
}

// ─── UUID v1 (timestamp-based, simplified) ───────────────────────────

function uuidV1(): string {
    const now = Date.now();
    const timeHex = now.toString(16).padStart(12, '0');
    const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-1${r().slice(1)}-${r()}-${r()}${r()}${r().slice(0, 4)}`;
}

// ─── Random helpers ──────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function randomHex(length: number): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Parse comma-separated values respecting double-quoted strings.
 * "hola, mundo","adiós",simple → ["hola, mundo", "adiós", "simple"]
 */
function parseEnumValues(raw: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.length > 0) {
        values.push(current.trim());
    }
    return values.filter(v => v.length > 0);
}

// ─── Registro de Variables ───────────────────────────────────────────

export const DYNAMIC_VARS: Record<string, DynamicVarEntry> = {
    // --- Timestamps ---
    '$timestamp': {
        generate: () => String(Math.floor(Date.now() / 1000)),
        description: 'Unix epoch en segundos',
        example: '1740583516',
    },
    '$timestampMs': {
        generate: () => String(Date.now()),
        description: 'Unix epoch en milisegundos',
        example: '1740583516000',
    },
    '$isoTimestamp': {
        generate: () => new Date().toISOString(),
        description: 'Fecha/hora ISO 8601 UTC',
        example: '2026-02-26T15:35:16.000Z',
    },
    '$localTimestamp': {
        generate: () => {
            const d = new Date();
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        },
        description: 'Fecha/hora local',
        example: '2026-02-26 11:35:16',
    },

    // --- Date formatting ---
    '$date': {
        generate: (params) => {
            let date = new Date();
            let format = 'YYYY-MM-DD';

            if (params && params.length > 0) {
                // Check for offset: first param starts with + or -
                let paramIdx = 0;
                const offsetMatch = params[0]?.match(/^([+-]\d+)$/);
                if (offsetMatch) {
                    const offsetDays = parseInt(offsetMatch[1], 10);
                    date = new Date(date.getTime() + offsetDays * 86400000);
                    paramIdx = 1;
                }
                // Rest is the format
                if (params.length > paramIdx) {
                    format = params.slice(paramIdx).join(':'); // rejoin with : since format may contain :
                }
            }

            return formatDate(date, format);
        },
        description: 'Fecha formateada (tokens: YYYY, MM, DD, HH, mm, ss, SSS, MMM, MMMM)',
        example: '2026-02-26',
        hasParams: true,
        paramSnippet: '$date:${1:YYYY-MM-DD}',
    },

    // --- UUIDs ---
    '$uuid': {
        generate: () => randomUUID(),
        description: 'UUID v4 (random)',
        example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    },
    '$guid': {
        generate: () => randomUUID(),
        description: 'Alias de $uuid (UUID v4)',
        example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    },
    '$uuidV1': {
        generate: () => uuidV1(),
        description: 'UUID v1 (timestamp-based)',
        example: '6fa459ea-ee8a-1a3e-5714-e6cdd17ab37c',
    },
    '$uuidV4': {
        generate: () => randomUUID(),
        description: 'UUID v4 (random, explícito)',
        example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    },

    // --- Random generators ---
    '$randomInt': {
        generate: (params) => {
            // Support both $randomInt:1:10 and $randomInt:1,10
            let min = 0, max = 1000;
            if (params && params.length >= 2) {
                min = parseInt(params[0], 10);
                max = parseInt(params[1], 10);
            } else if (params?.[0]?.includes(',')) {
                const parts = params[0].split(',');
                min = parseInt(parts[0], 10);
                max = parseInt(parts[1], 10);
            } else if (params?.[0]) {
                min = 0;
                max = parseInt(params[0], 10);
            }
            return String(randomInt(min, max));
        },
        description: 'Entero aleatorio (default: 0–1000)',
        example: '742',
        hasParams: true,
        paramSnippet: '$randomInt:${1:0}:${2:1000}',
    },
    '$randomFloat': {
        generate: (params) => {
            // Support both $randomFloat:1:100:4 and $randomFloat:1,100,4
            let min = 0, max = 1, precision = 2;
            if (params && params.length >= 2) {
                min = parseFloat(params[0]);
                max = parseFloat(params[1]);
                if (params[2]) { precision = parseInt(params[2], 10); }
            } else if (params?.[0]?.includes(',')) {
                const parts = params[0].split(',');
                min = parseFloat(parts[0]);
                max = parseFloat(parts[1]);
                if (parts[2]) { precision = parseInt(parts[2], 10); }
            }
            const value = Math.random() * (max - min) + min;
            return value.toFixed(precision);
        },
        description: 'Decimal aleatorio (default: 0–1, 2 decimales)',
        example: '0.73',
        hasParams: true,
        paramSnippet: '$randomFloat:${1:0}:${2:1}:${3:2}',
    },
    '$randomString': {
        generate: (params) => {
            const length = params?.[0] ? parseInt(params[0], 10) : 16;
            return randomString(length);
        },
        description: 'String alfanumérico aleatorio (default: 16 chars)',
        example: 'aB3xK9mP2qR7wT1s',
        hasParams: true,
        paramSnippet: '$randomString:${1:16}',
    },
    '$randomHex': {
        generate: (params) => {
            const length = params?.[0] ? parseInt(params[0], 10) : 8;
            return randomHex(length);
        },
        description: 'String hexadecimal aleatorio',
        example: 'a3f2b1c0',
        hasParams: true,
        paramSnippet: '$randomHex:${1:8}',
    },
    '$randomEmail': {
        generate: () => {
            return `user-${randomHex(5)}@rext.dev`;
        },
        description: 'Email aleatorio @rext.dev',
        example: 'user-a3f2b@rext.dev',
    },
    '$randomBoolean': {
        generate: () => Math.random() < 0.5 ? 'true' : 'false',
        description: '"true" o "false" aleatorio',
        example: 'true',
    },

    // --- Enum (pick from list) ---
    '$enum': {
        generate: (params) => {
            if (!params || params.length === 0) { return ''; }
            // params[0] is the raw comma-separated list (everything after $enum:)
            const rawList = params.join(':'); // rejoin in case values contained :
            const values = parseEnumValues(rawList);
            if (values.length === 0) { return ''; }
            return values[Math.floor(Math.random() * values.length)];
        },
        description: 'Valor aleatorio de una lista (soporta "comillas" para valores con comas)',
        example: 'pending',
        hasParams: true,
        paramSnippet: '$enum:${1:val1,val2,val3}',
    },

    // --- Metadata ---
    '$env': {
        generate: () => {
            // This will be overridden in variables.ts with actual env name
            return 'default';
        },
        description: 'Nombre del entorno activo',
        example: 'production',
    },
};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Check if a variable key is a dynamic built-in (starts with $).
 */
export function isDynamicVariable(key: string): boolean {
    if (!key.startsWith('$')) { return false; }
    const name = key.split(':')[0];
    return name in DYNAMIC_VARS;
}

/**
 * Resolve a dynamic variable. Input is the full key including params, e.g.:
 * "$timestamp", "$randomInt:1:100", "$date:+7:DD/MM/YYYY", "$enum:a,b,c"
 *
 * Returns the generated value, or undefined if not a known dynamic var.
 */
export function resolveDynamic(raw: string): string | undefined {
    if (!raw.startsWith('$')) { return undefined; }

    const parts = raw.split(':');
    const name = parts[0];
    const entry = DYNAMIC_VARS[name];
    if (!entry) { return undefined; }

    const params = parts.length > 1 ? parts.slice(1) : undefined;
    return entry.generate(params);
}

/**
 * Get all dynamic variable names (for autocomplete).
 */
export function getDynamicVarNames(): string[] {
    return Object.keys(DYNAMIC_VARS);
}

/**
 * Get info about a dynamic variable (for hover/docs).
 */
export function getDynamicVarInfo(name: string): DynamicVarEntry | undefined {
    const baseName = name.split(':')[0];
    return DYNAMIC_VARS[baseName];
}
