# Changelog

All notable changes to the **Rext HTTP** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.0.5] - 2025-02-23

### Added

- **Iconos para archivos de entorno** — `rext.env.json` ahora muestra una R verde en el explorador (light/dark)
- **Iconos para archivos de colección** — `.rext.collection.json` ahora muestra una R azul en el explorador (light/dark)
- **Categorías del Marketplace** — Se agregaron categorías: Programming Languages, Testing, Snippets

## [0.0.4] - 2025-02-23

### Added

- **File Icons** — Archivos `.rext` ahora muestran el ícono R de Rext en el explorador de VS Code (variantes light/dark)
- **⌘+Enter en macOS** — Ejecutar el request bajo el cursor con `Cmd+Enter` en macOS (además de `Ctrl+Enter` en Windows/Linux)

## [0.0.3] - 2025-02-23

### Added

- Extension icon (R logo) for VS Code Marketplace and Open VSX
- Repository field in package.json
- Complete README with full Rext specification documentation
- `.vscodeignore` optimized for smaller package size (~616 KB vs ~22 MB)

### Fixed

- Extension not activating when installed from marketplace (missing runtime dependencies)
- Package included unnecessary `webview-ui/` source files (65 MB)

## [0.0.2] - 2025-02-20

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

## [0.0.1] - 2025-02-15

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
