# Rext HTTP

**Smart HTTP Client for VS Code** — Write `.rext` files to define, execute, and test HTTP requests directly from your editor.

🌐 **Website**: [getrext.com](https://getrext.com)

---

## ¿Qué hace a Rext diferente?

A diferencia de los archivos `.http` tradicionales, Rext introduce directivas inteligentes para manejar **el ciclo de vida completo** de una petición: captura de datos, validaciones, pre-ejecución, configuración compartida, reintentos, colecciones y más.

---

## ✨ Features

### 📝 Human-Readable Syntax

Cada request se separa con `###`. La primera línea indica el método y la URL.

```rext
###
@name Get Users
GET https://api.example.com/users
Accept: application/json
Authorization: Bearer {{token}}
```

**Métodos soportados:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`

> **Orden de una request:** directivas → método + URL → headers → (línea vacía) → body → (línea vacía) → post-directivas (`@assert`, `@capture`)

### ⚡ One-Click Execution

Run any request with **`Ctrl+Enter`** (or **`⌘+Enter`** on Mac). Click the **▶ Run** CodeLens directly above each request.

---

## � Directivas

### `@name` — Nombre de la petición

```rext
@name Get Users
GET https://api.example.com/users
```

### `@id` — Identificador único

Auto-generado al guardar si no está presente. 6 caracteres alfanuméricos.

```rext
@id abc123
@name Login
POST https://api.example.com/auth/login
```

### `@collection` — Agrupa peticiones en colecciones

```rext
@collection Auth API
@name Login
POST https://api.example.com/auth/login
```

### `@group` — Sub-agrupación dentro de colecciones

Soporta niveles separados por `/`.

```rext
@collection Auth API
@group Users / Admin
@name Create Admin
POST https://api.example.com/admin/users
```

### `@tags` — Etiquetas para filtrado

```rext
@tags auth, critical, v2
@name Login
POST https://api.example.com/auth/login
```

### `@deprecated` — Marca una petición como obsoleta

```rext
@deprecated
@name Old Login
POST https://api.example.com/v1/login
```

---

## 🔗 Variables y Captura

### Variables con `{{}}`

Reemplaza valores dinámicamente usando variables de sesión, colección, entorno o globales.

```rext
GET {{baseUrl}}/users
Authorization: Bearer {{token}}
```

### `@capture` — Captura de datos de la respuesta

Extrae valores del response y los almacena en un scope.

```rext
@name Login
POST {{baseUrl}}/auth/login

@capture token = body.access_token
@capture env.userId = body.user.id
@capture collection.refreshToken = body.refresh_token
@capture global.apiVersion = body.version
```

### Variable Scopes

| Scope           | Prefix                        | Persistence             |
| --------------- | ----------------------------- | ----------------------- |
| **Session**     | `@capture varName`            | In-memory only          |
| **Collection**  | `@capture collection.varName` | `.rext.collection.json` |
| **Environment** | `@capture env.varName`        | `rext.env.json`         |
| **Global**      | `@capture global.varName`     | VS Code settings        |

**Valores literales:**

```rext
@capture session.status = "active"
@capture session.count = 42
@capture session.flag = true
```

---

## 🔄 Pre-Requests

### `@pre` — Ejecuta peticiones previas

Referencia un `@id` para ejecutar esa petición antes de la actual. Los `@capture` de la pre-request setean variables disponibles para la request principal.

```rext
###
@id abc123
@name Login
POST {{baseUrl}}/auth/login
@capture env.token = body.access_token

###
@name Get Profile
@pre abc123
GET {{baseUrl}}/profile
Authorization: Bearer {{token}}
```

Múltiples `@pre` permitidos (ejecución secuencial):

```rext
@pre abc123
@pre def456
@name Full Flow
GET {{baseUrl}}/dashboard
```

> **Protección contra ciclos:** si A tiene `@pre B` y B tiene `@pre A`, la cadena se detiene automáticamente.

---

## ✅ Assertions

### `@assert` — Validaciones de respuesta

Valida condiciones sobre la respuesta. Si falla, se muestra ❌ en el panel de resultados.

### Targets

| Target     | Descripción                 | Ejemplo                                                 |
| ---------- | --------------------------- | ------------------------------------------------------- |
| `status`   | Código HTTP                 | `@assert status == 200`                                 |
| `body`     | Cuerpo (JSON path)          | `@assert body.success == true`                          |
| `header`   | Headers de respuesta        | `@assert header.content-type contains application/json` |
| `duration` | Tiempo de respuesta (ms)    | `@assert duration < 2000`                               |
| `size`     | Tamaño de respuesta (bytes) | `@assert size < 10240`                                  |
| `cookie`   | Cookies del response        | `@assert cookie.sessionId exists`                       |

### Operadores de Comparación

| Operador   | Descripción    | Ejemplo                           |
| ---------- | -------------- | --------------------------------- |
| `==`       | Igual a        | `@assert status == 200`           |
| `!=`       | Diferente a    | `@assert status != 500`           |
| `>`        | Mayor que      | `@assert body.items.length > 0`   |
| `<`        | Menor que      | `@assert duration < 2000`         |
| `>=`       | Mayor o igual  | `@assert status >= 200`           |
| `<=`       | Menor o igual  | `@assert status <= 299`           |
| `contains` | Contiene texto | `@assert body.name contains John` |

### Operadores de Tipo y Existencia

| Operador      | Descripción                | Ejemplo                          |
| ------------- | -------------------------- | -------------------------------- |
| `exists`      | Existe (no null/undefined) | `@assert body.token exists`      |
| `!exists`     | No existe                  | `@assert body.error !exists`     |
| `isArray`     | Es un array                | `@assert body.data isArray`      |
| `isNumber`    | Es numérico                | `@assert body.count isNumber`    |
| `isNull`      | Es null                    | `@assert body.deletedAt isNull`  |
| `isUndefined` | Es undefined               | `@assert body.debug isUndefined` |
| `isEmpty`     | Está vacío                 | `@assert body.errors isEmpty`    |

### Ejemplo completo

```rext
###
@name Create User
POST {{baseUrl}}/users
Content-Type: application/json

{
  "name": "John",
  "email": "john@example.com"
}

@assert status == 201
@assert body.id exists
@assert body.name == John
@assert body.email contains @
@assert body.roles isArray
@assert header.content-type contains application/json
@assert duration < 3000
@assert size < 5120
```

---

## 🔁 Reintentos y Timeout

### `@retry` — Reintentos automáticos

Reintenta en caso de error 5xx. Opcionalmente con delay.

```rext
@retry 3
@name Flaky Request
GET {{baseUrl}}/unstable-endpoint

@retry 5 delay 1000
@name Critical Request
POST {{baseUrl}}/payment
```

### `@timeout` — Timeout de la petición (ms)

```rext
@timeout 5000
@name Slow Request
GET {{baseUrl}}/heavy-report
```

---

## ⚙️ Configuración

### `@config` — Configuración compartida

Define valores por defecto que aplican a todas las peticiones del archivo.

```rext
@config
baseUrl: https://api.example.com
timeout: 5000
retries: 2
headers:
  Content-Type: application/json
  Accept: application/json
assert:
  status == 200
```

#### Config por colección

```rext
@config
collection: Auth API
baseUrl: https://auth.example.com
headers:
  X-API-Key: {{apiKey}}
```

#### Herencia y Override

- **baseUrl:** se antepone a URLs relativas (que empiezan con `/`)
- **headers:** merge (request sobreescribe config)
- **timeout / retries:** se aplican si el request no los define
- **assertions:** se acumulan (config + request)

---

## 🌍 Environment Management

Cambia entre entornos (development, staging, production) seamlessly. Define variables en `rext.env.json`:

```json
{
  "Development": {
    "baseUrl": "http://localhost:3000",
    "apiKey": "dev-key-123"
  },
  "Production": {
    "baseUrl": "https://api.production.com",
    "apiKey": "prod-key-456"
  }
}
```

Cambia de entorno con `Rext: Switch Environment` desde el command palette o la barra de estado.

---

## 🧩 Editor Experience

- **Syntax Highlighting** — Full TextMate grammar for `.rext` files
- **IntelliSense** — Auto-completion for directives, methods, headers, and variables
- **CodeLens** — Run buttons inline above each request
- **Inlay Hints** — Visual feedback for captured variables and auto-generated IDs
- **Diagnostics** — Warnings for duplicate IDs, syntax errors, and more
- **Quick Fixes** — Auto-generate missing `@id` directives
- **Snippets** — Quick scaffolding for common patterns

### Response Panel

View responses in a dedicated panel with:

- Formatted JSON body with syntax highlighting
- Response headers
- Status code, timing, and size
- Assertion results (✅ pass / ❌ fail)
- Captured variables

### Sidebar

Dedicated activity bar panel showing your request history and workspace `.rext` files.

### 🔀 Git Friendly

`.rext` files are plain text — perfect for version control. Share request collections with your team via Git.

---

## 📋 Snippets

| Prefix      | Description                                 |
| ----------- | ------------------------------------------- |
| `get`       | GET request with name                       |
| `post`      | POST request with JSON body                 |
| `name`      | `@name` directive                           |
| `cap`       | Capture variable (session)                  |
| `capcol`    | Capture variable (collection)               |
| `capenv`    | Capture variable (environment)              |
| `capglobal` | Capture variable (global)                   |
| `flow`      | Complete login + authenticated request flow |
| `as`        | Assert status code                          |
| `ab`        | Assert body value                           |
| `retry`     | Retry with delay                            |

---

## ⌨️ Keyboard Shortcuts

| Shortcut                 | Action              |
| ------------------------ | ------------------- |
| `Ctrl+Enter` / `⌘+Enter` | Run current request |

---

## 🚀 Commands

| Command                          | Description                             |
| -------------------------------- | --------------------------------------- |
| `Rext: Run Current Request`      | Execute the request at cursor position  |
| `Rext: Run All Requests in File` | Execute all requests in the active file |
| `Rext: Switch Environment`       | Change the active environment           |

---

## 🔮 Ejemplo Completo

```rext
@config
baseUrl: https://api.example.com
headers:
  Content-Type: application/json
assert:
  status >= 200

###
@id a1b2c3
@collection Auth
@name Login
POST /auth/login

{
  "email": "{{email}}",
  "password": "{{password}}"
}

@capture env.token = body.access_token
@assert status == 200
@assert body.token exists
@assert duration < 2000

###
@collection Auth
@name Get Profile
@pre a1b2c3
GET /profile
Authorization: Bearer {{token}}

@assert status == 200
@assert body.email exists
@assert body.roles isArray
@assert header.content-type contains json
```

---

## 📦 Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for **"Rext HTTP"**
4. Click **Install**

Or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=rext-labs.rext).

---

## 📖 Specification

Rext is built on an open specification. Learn more at [github.com/Rext-Labs/rext-spec](https://github.com/Rext-Labs/rext-spec).

---

## 🔗 Links

- 🌐 **Website**: [getrext.com](https://getrext.com)
- 📖 **Spec**: [github.com/Rext-Labs/rext-spec](https://github.com/Rext-Labs/rext-spec)
- 🐛 **Issues**: [github.com/Rext-Labs/rext-vscode/issues](https://github.com/Rext-Labs/rext-vscode/issues)
- 🏢 **Organization**: [github.com/Rext-Labs](https://github.com/Rext-Labs)

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
