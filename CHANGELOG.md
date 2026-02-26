# Changelog

All notable changes to the **Rext HTTP** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.0.8] - 2026-02-25

### Added

- **Postman Collection v2.1 Export** — Export individual requests or entire workspaces as Postman Collections via QuickPick menu or `Rext: Export All to Postman Collection` command
- **Sidebar Postman Export** — Export entire files, collections, or groups to Postman directly from the sidebar via 📦 buttons and right-click context menus
- **Postman export from Preview panel** — Added "📦 Postman Collection" option to the Export ▾ dropdown in the results panel
- **`@pre` → Postman pre-request scripts** — `@pre` directives are automatically translated to `pm.sendRequest()` pre-request scripts in Postman exports, including headers, body, and `@capture` variable extraction
- **Missing pre-request detection** — When exporting a request that depends on a `@pre` not in the export set, prompts the user to include it as a separate item in the collection or keep it as an inline `pm.sendRequest()` script
- **`@capture` → Postman scripts** — Captured variables are automatically converted to `pm.environment.set()`, `pm.globals.set()`, or `pm.collectionVariables.set()` test scripts in exported collections
- **`@assert` → Postman tests** — Assertions are converted to `pm.test()` with Chai assertions (`pm.response.to.have.status()`, `pm.expect().to.exist`, etc.)
- **Folder grouping** — Requests with `@group` are organized into nested Postman folders (supports `@group Auth/Login` sub-levels)
- **Array notation in `@capture`** — `body.data[0].id`, `body.items[2].name` now work correctly for extracting values from arrays
- **Timeline collapse button** — Hamburger menu button (☰) in the Timeline header to collapse/expand the sidebar for more viewing space

### Fixed

- **`@pre` inlay hints in doc comments** — `@pre` hints now show inside `/** */` comment blocks (previously only worked on standalone lines)
- **Preview panel scroll** — Fixed horizontal scrollbar always showing on JSON/text content; now respects Word Wrap toggle (`overflow-x: hidden` when wrap ON, `auto` when OFF)
- **Pre element overflow** — Added `max-width: 100%` and `box-sizing: border-box` to prevent content from exceeding panel width

### Changed

- **`@pre` autocomplete UX** — Now shows the request **name** prominently with the ID as secondary text (previously showed ID first). Searching works by both name and ID. Icon changed to Method (purple cube) for better visibility
- **Timeline width reduced** — Timeline sidebar reduced from 280px to 196px (~30% smaller) for more content space
- **Timeline collapse animation** — Smooth CSS transition when collapsing/expanding the timeline

## [0.0.7] - 2026-02-25

### Added

- **Embedded JSON highlighting** — JSON bodies inside `.rext` files now have full syntax coloring: keys (property names), string values, numbers, booleans (`true`/`false`/`null`), and punctuation
- **JSON grammar for `rext.env.json`** — Environment files now get proper JSON syntax highlighting, formatting, and autocompletion instead of being treated as an unknown language
- **JSON grammar for `*.rext.collection.json`** — Collection files also get full JSON support

### Fixed

- **Case-insensitive HTTP methods** — `get`, `post`, `Put`, `Delete` etc. are now recognized and highlighted correctly, not just uppercase `GET`, `POST`
- **`rext.env.json` language mode** — Previously showed as "Rext Environment" with no syntax highlighting; now properly highlights as JSON while keeping the custom language ID for the tab icon

### Changed

- **Differentiated file icons** — `rext.env.json` shows a `.env` label in teal; `*.rext.collection.json` shows stacked cards in violet (visible in editor tabs)

## [0.0.6] - 2026-02-24

### Added

- **`@query`** — Directiva para query parameters separados de la URL (`@query key = value`)
- **`---` delimiter** — Alternativa a `###` para separar requests
- **Double newline delimiter** — Dos líneas vacías consecutivas separan requests automáticamente
- **`@body` from file** — Enviar el contenido de un archivo como body (`@body ./data.json`)
- **Code Export** — Exportar requests como código en 5 lenguajes: cURL, JavaScript (fetch), Go (net/http), Dart (http), Python (requests)
- **Variable autocompletado** — Al escribir `{{` se muestran las variables disponibles con su scope y valor actual
- **Variable scope coloring** — Las variables `{{}}` se colorean según su scope (env=verde, session=azul, collection=naranja, global=púrpura, capture=teal, undefined=rojo)
- **Capture variable recognition** — Variables definidas por `@capture` en el archivo se muestran en teal con línea amarilla ondulada, indicando que están pendientes de ejecución. Aparecen en autocompletado con el request que las define
- **Directory tree** — El tab Files del sidebar muestra un árbol de directorios como el explorer nativo de VS Code
- **Group sub-levels** — `@group Auth/Login` crea niveles anidados en el sidebar de colecciones
- **Snippet `query`** — Autocompletado para `@query`

### Changed

- **CodeLens** — Ahora muestra `▶ Run {nombre}` en vez de solo `▶ {nombre}` para mayor claridad
- **Panel Export** — Corregido: ahora exporta el body del request (no el body de la respuesta)

## [0.0.5] - 2026-02-23

### Added

- **Iconos para archivos de entorno** — `rext.env.json` ahora muestra una R verde en el explorador (light/dark)
- **Iconos para archivos de colección** — `.rext.collection.json` ahora muestra una R azul en el explorador (light/dark)
- **Categorías del Marketplace** — Se agregaron categorías: Programming Languages, Testing, Snippets

## [0.0.4] - 2026-02-23

### Added

- **File Icons** — Archivos `.rext` ahora muestran el ícono R de Rext en el explorador de VS Code (variantes light/dark)
- **⌘+Enter en macOS** — Ejecutar el request bajo el cursor con `Cmd+Enter` en macOS (además de `Ctrl+Enter` en Windows/Linux)

## [0.0.3] - 2026-02-23

### Added

- Extension icon (R logo) for VS Code Marketplace and Open VSX
- Repository field in package.json
- Complete README with full Rext specification documentation
- `.vscodeignore` optimized for smaller package size (~616 KB vs ~22 MB)

### Fixed

- Extension not activating when installed from marketplace (missing runtime dependencies)
- Package included unnecessary `webview-ui/` source files (65 MB)

## [0.0.2] - 2026-02-20

### Added

- **Response Panel** — Dedicated webview panel showing response body, headers, status, timing, and size
- **Sidebar** — Activity bar panel with request history and workspace `.rext` files
- **IntelliSense** — Auto-completion for directives (`@name`, `@capture`, `@assert`, etc.), HTTP methods, and common headers
- **Inlay Hints** — Visual indicators for captured variables and auto-generated IDs
- **Diagnostics** — Warnings for duplicate `@id`, missing separators, and syntax issues
- **Quick Fixes** — Auto-generate missing `@id` directives
- **Snippets** — `get`, `post`, `name`, `cap`, `capcol`, `capenv`, `capglobal`, `flow`, `as`, `ab`, `retry`

### Changed

- Improved syntax highlighting grammar for `.rext` files

## [0.0.1] - 2026-02-15

### Added

- Initial release
- `.rext` language support with TextMate grammar
- Syntax highlighting for directives, methods, URLs, headers, variables, and JSON
- **CodeLens** — Inline Run buttons above each request
- **Request execution** with `Ctrl+Enter` / `⌘+Enter`
- **Variable interpolation** with `{{variable}}` syntax
- **`@capture`** — Extract values from responses (session, collection, env, global scopes)
- **`@assert`** — Inline response validations (status, body, header, duration, size, cookie)
- **`@pre`** — Pre-request execution chains with cycle protection
- **`@retry`** — Automatic retries with configurable delay
- **`@timeout`** — Per-request timeout
- **`@config`** — File-level shared configuration (baseUrl, headers, assertions)
- **Environment management** — Switch environments via command palette (`rext.env.json`)
- **`@collection`** and **`@group`** — Organize requests into collections and sub-groups
- **`@tags`** — Tag-based filtering
- **`@deprecated`** — Mark obsolete requests
