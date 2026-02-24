import { Component, Show, createSignal, createEffect, on } from "solid-js";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import { formatSize } from "../../shared/utils";
import { getVsCodeApi } from "../../shared/vscode";

interface DetailViewProps {
  request: any | null;
}

function detectContentType(req: any): string {
  const ct = (
    req?.headers?.["content-type"] ||
    req?.headers?.["Content-Type"] ||
    ""
  ).toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("xml") || ct.includes("svg")) return "xml";
  if (ct.includes("html")) return "html";
  if (ct.includes("css")) return "css";
  if (ct.includes("javascript") || ct.includes("ecmascript"))
    return "javascript";
  if (ct.includes("image/")) return "image";
  // Fallback: try to detect from data
  if (typeof req?.data === "object" && req?.data !== null) return "json";
  const raw = String(req?.data || "");
  if (raw.trim().startsWith("{") || raw.trim().startsWith("[")) return "json";
  if (raw.trim().startsWith("<?xml") || raw.trim().startsWith("<soap"))
    return "xml";
  if (raw.trim().startsWith("<!DOCTYPE") || raw.trim().startsWith("<html"))
    return "html";
  return "text";
}

function getPrismLang(fmt: string): string {
  switch (fmt) {
    case "json":
      return "json";
    case "xml":
    case "html":
      return "markup";
    case "css":
      return "css";
    case "javascript":
      return "javascript";
    default:
      return "plaintext";
  }
}

const DetailView: Component<DetailViewProps> = (props) => {
  const [currentTab, setCurrentTab] = createSignal("body");
  const [bodyFormat, setBodyFormat] = createSignal("auto");
  const [searchTerm, setSearchTerm] = createSignal("");
  const [wordWrap, setWordWrap] = createSignal(false);
  const [copyFeedback, setCopyFeedback] = createSignal("");
  const [showExportMenu, setShowExportMenu] = createSignal(false);
  let codeRef: HTMLElement | undefined;
  const vscodeApi = getVsCodeApi();

  const showFeedback = (msg: string) => {
    setCopyFeedback(msg);
    setTimeout(() => setCopyFeedback(""), 1500);
  };

  const copyBody = () => {
    const raw = getRawBody();
    navigator.clipboard.writeText(raw).then(() => showFeedback("Body copiado"));
  };

  const copyHeaders = () => {
    const req = props.request;
    if (!req?.headers) return;
    const text = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => showFeedback("Headers copiados"));
  };

  const saveToFile = () => {
    const raw = getRawBody();
    const fmt = resolvedFormat();
    vscodeApi.postMessage({ command: "saveResponse", body: raw, format: fmt });
  };

  const exportCode = (lang: string) => {
    const req = props.request;
    if (!req) return;
    vscodeApi.postMessage({
      command: "exportCode",
      language: lang,
      request: {
        method: req.method || "GET",
        url: req.url || "",
        headers: req.requestHeaders || {},
        body: req.requestBody,
      },
    });
    setShowExportMenu(false);
    showFeedback("Código copiado");
  };

  // Auto-detect format when request changes
  createEffect(
    on(
      () => props.request,
      () => {
        setBodyFormat("auto");
        setSearchTerm("");
      },
    ),
  );

  createEffect(
    on(
      () => [props.request, currentTab(), bodyFormat(), searchTerm()],
      () => {
        if (currentTab() === "body" && codeRef && props.request) {
          const fmt = resolvedFormat();
          if (fmt !== "preview" && fmt !== "image") {
            highlightCode();
          }
        }
      },
    ),
  );

  const resolvedFormat = () => {
    const fmt = bodyFormat();
    if (fmt !== "auto") return fmt;
    return detectContentType(props.request);
  };

  function getRawBody(): string {
    const req = props.request;
    if (!req) return "";
    if (typeof req.data === "string") return req.data;
    if (typeof req.data === "object" && req.data !== null)
      return JSON.stringify(req.data, null, 2);
    return String(req.data ?? "");
  }

  function highlightCode() {
    const req = props.request;
    if (!req || !codeRef) return;

    const raw = getRawBody();
    const fmt = resolvedFormat();
    const search = searchTerm().toLowerCase();

    let formatted = raw;
    let lang = getPrismLang(fmt);

    if (fmt === "json") {
      try {
        formatted = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        formatted = raw;
      }
    }

    codeRef.className = "language-" + lang;

    if (search) {
      const regex = new RegExp(
        "(" + search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")",
        "gi",
      );
      codeRef.innerHTML = formatted.replace(regex, "<mark>$1</mark>");
    } else {
      codeRef.textContent = formatted;
      if (lang !== "plaintext") {
        Prism.highlightElement(codeRef);
      }
    }
  }

  const availableFormats = () => {
    const detected = detectContentType(props.request);
    const formats = ["auto"];
    // Always offer these
    if (detected !== "json") formats.push("json");
    if (detected !== "xml") formats.push("xml");
    if (detected !== "text") formats.push("text");
    // Add detected at front after auto
    if (!formats.includes(detected)) formats.splice(1, 0, detected);
    // Preview for HTML
    if (detected === "html" || detected === "xml") formats.push("preview");
    return formats;
  };

  const formatLabel = (fmt: string) => {
    if (fmt === "auto") {
      const det = detectContentType(props.request);
      return `Auto (${det.toUpperCase()})`;
    }
    return fmt.toUpperCase();
  };

  return (
    <div class="main-content">
      <Show
        when={props.request}
        fallback={
          <div
            style={{ padding: "40px", "text-align": "center", opacity: 0.5 }}
          >
            Selecciona una petición
          </div>
        }
      >
        {(req) => (
          <>
            <div class="header-bar">
              <div class="url-display">
                <Show
                  when={req().name}
                  fallback={
                    <>
                      {req().method || "GET"} {req().url || "URL no disponible"}
                    </>
                  }
                >
                  <strong>{req().name}</strong>
                  <br />
                  <span style={{ "font-size": "0.8em", opacity: 0.7 }}>
                    {req().method || "GET"} {req().url || ""}
                  </span>
                </Show>
              </div>
              <div>
                <strong>Status:</strong> {req().status}
                <Show when={req().duration != null}>
                  <span
                    style={{
                      opacity: 0.6,
                      "margin-left": "10px",
                      display: "inline-flex",
                      "align-items": "center",
                      gap: "3px",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
                    </svg>
                    {req().duration}ms
                  </span>
                </Show>
                <Show when={req().size != null}>
                  <span
                    style={{
                      opacity: 0.6,
                      "margin-left": "10px",
                      display: "inline-flex",
                      "align-items": "center",
                      gap: "3px",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H4V4h16v16zm-8-6l4-4h-3V6h-2v4H8l4 4z" />
                    </svg>
                    {formatSize(req().size)}
                  </span>
                </Show>
                <Show when={req().attempts > 1}>
                  <span style={{ color: "#ff9800", "margin-left": "10px" }}>
                    ⟳ Intento {req().attempts}/{req().maxAttempts}
                  </span>
                </Show>
              </div>
              <div class="export-actions">
                <button
                  class="export-btn"
                  onClick={copyBody}
                  title="Copiar Body"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                  </svg>
                  Body
                </button>
                <button
                  class="export-btn"
                  onClick={copyHeaders}
                  title="Copiar Headers"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                  </svg>
                  Headers
                </button>
                <button
                  class="export-btn"
                  onClick={saveToFile}
                  title="Guardar como archivo"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z" />
                  </svg>
                  Save
                </button>
                <div style={{ position: "relative", display: "inline-block" }}>
                  <button
                    class="export-btn"
                    onClick={() => setShowExportMenu(!showExportMenu())}
                    title="Exportar como código"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                    </svg>
                    Export ▾
                  </button>
                  <Show when={showExportMenu()}>
                    <div class="export-dropdown">
                      <div
                        class="export-dropdown-item"
                        onClick={() => exportCode("curl")}
                      >
                        cURL
                      </div>
                      <div
                        class="export-dropdown-item"
                        onClick={() => exportCode("javascript")}
                      >
                        JavaScript (fetch)
                      </div>
                      <div
                        class="export-dropdown-item"
                        onClick={() => exportCode("go")}
                      >
                        Go (net/http)
                      </div>
                      <div
                        class="export-dropdown-item"
                        onClick={() => exportCode("dart")}
                      >
                        Dart (http)
                      </div>
                      <div
                        class="export-dropdown-item"
                        onClick={() => exportCode("python")}
                      >
                        Python (requests)
                      </div>
                    </div>
                  </Show>
                </div>
                <Show when={copyFeedback()}>
                  <span class="copy-feedback">{copyFeedback()}</span>
                </Show>
              </div>
            </div>

            {/* Assertions */}
            <Show when={req().assertions?.length > 0}>
              <div class="assertions-container">
                {req().assertions.map((a: any) => (
                  <div class={`assertion-item ${a.pass ? "pass" : "fail"}`}>
                    {a.pass ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="#4caf50"
                        style={{
                          "vertical-align": "middle",
                          "margin-right": "4px",
                        }}
                      >
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="#f44336"
                        style={{
                          "vertical-align": "middle",
                          "margin-right": "4px",
                        }}
                      >
                        <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
                      </svg>
                    )}{" "}
                    {a.label}
                  </div>
                ))}
              </div>
            </Show>

            <div class="viewer-area">
              {/* Tabs */}
              <div class="tabs">
                <div
                  class={`tab ${currentTab() === "body" ? "active" : ""}`}
                  onClick={() => setCurrentTab("body")}
                >
                  Body
                </div>
                <div
                  class={`tab ${currentTab() === "headers" ? "active" : ""}`}
                  onClick={() => setCurrentTab("headers")}
                >
                  Headers
                </div>
                <div
                  class={`tab ${currentTab() === "cookies" ? "active" : ""}`}
                  onClick={() => setCurrentTab("cookies")}
                >
                  Cookies
                </div>
              </div>

              {/* Body Tab */}
              <Show when={currentTab() === "body"}>
                <div class="body-toolbar">
                  <div class="search-box">
                    <input
                      type="text"
                      class="search-input"
                      placeholder="Filtrar en respuesta..."
                      value={searchTerm()}
                      onInput={(e) => setSearchTerm(e.currentTarget.value)}
                    />
                  </div>
                  <button
                    class={`wrap-toggle ${wordWrap() ? "active" : ""}`}
                    onClick={() => setWordWrap(!wordWrap())}
                    title={wordWrap() ? "Word Wrap: ON" : "Word Wrap: OFF"}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M4 19h6v-2H4v2zM20 5H4v2h16V5zm-3 6H4v2h13.25c1.1 0 2 .9 2 2s-.9 2-2 2H15v-2l-3 3 3 3v-2h2c2.21 0 4-1.79 4-4s-1.79-4-4-4z" />
                    </svg>
                  </button>
                </div>
                <div class="sub-tabs">
                  {availableFormats().map((fmt) => (
                    <div
                      class={`sub-tab ${resolvedFormat() === fmt || bodyFormat() === fmt ? "active" : ""}`}
                      classList={{ active: bodyFormat() === fmt }}
                      onClick={() => setBodyFormat(fmt)}
                    >
                      {formatLabel(fmt)}
                    </div>
                  ))}
                </div>

                {/* Preview mode: HTML in sandboxed iframe */}
                <Show when={resolvedFormat() === "preview"}>
                  <iframe
                    sandbox=""
                    srcdoc={getRawBody()}
                    style={{
                      width: "100%",
                      height: "400px",
                      border: "1px solid var(--vscode-panel-border, #333)",
                      "border-radius": "4px",
                      background: "#fff",
                    }}
                  />
                </Show>

                {/* Image preview */}
                <Show when={resolvedFormat() === "image"}>
                  <div style={{ padding: "10px", "text-align": "center" }}>
                    <div style={{ opacity: 0.6, "margin-bottom": "8px" }}>
                      Image response (
                      {req().headers?.["content-type"] || "image"})
                    </div>
                    <div style={{ opacity: 0.5 }}>
                      Image preview not available in webview
                    </div>
                  </div>
                </Show>

                {/* Code view */}
                <Show
                  when={
                    resolvedFormat() !== "preview" &&
                    resolvedFormat() !== "image"
                  }
                >
                  <pre
                    style={{
                      "white-space": wordWrap() ? "pre-wrap" : "pre",
                      "word-break": wordWrap() ? "break-all" : "normal",
                    }}
                  >
                    <code ref={codeRef} class="language-json" />
                  </pre>
                </Show>
              </Show>

              {/* Headers Tab */}
              <Show when={currentTab() === "headers"}>
                <table>
                  <Show when={req().headers}>
                    {Object.entries(req().headers || {}).map(([k, v]) => (
                      <tr>
                        <td>
                          <strong>{k}</strong>
                        </td>
                        <td>{String(v)}</td>
                      </tr>
                    ))}
                  </Show>
                </table>
              </Show>

              {/* Cookies Tab */}
              <Show when={currentTab() === "cookies"}>
                <table>
                  <Show
                    when={req().cookies?.length > 0}
                    fallback={
                      <tr>
                        <td style={{ opacity: 0.5 }}>No cookies in response</td>
                      </tr>
                    }
                  >
                    <tr>
                      <td>
                        <strong>Name</strong>
                      </td>
                      <td>
                        <strong>Value</strong>
                      </td>
                      <td>
                        <strong>Attributes</strong>
                      </td>
                    </tr>
                    {req().cookies.map((c: any) => (
                      <tr>
                        <td>
                          <strong>{c.name}</strong>
                        </td>
                        <td style={{ "word-break": "break-all" }}>{c.value}</td>
                        <td style={{ opacity: 0.6, "font-size": "0.85em" }}>
                          {c.attributes}
                        </td>
                      </tr>
                    ))}
                  </Show>
                </table>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

export default DetailView;
