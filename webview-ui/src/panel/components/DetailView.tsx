import { Component, Show, createSignal, createEffect, on } from "solid-js";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import { formatSize } from "../../shared/utils";

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
  let codeRef: HTMLElement | undefined;

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
                  <span style={{ opacity: 0.6, "margin-left": "10px" }}>
                    ⏱ {req().duration}ms
                  </span>
                </Show>
                <Show when={req().size != null}>
                  <span style={{ opacity: 0.6, "margin-left": "10px" }}>
                    📦 {formatSize(req().size)}
                  </span>
                </Show>
                <Show when={req().attempts > 1}>
                  <span style={{ color: "#ff9800", "margin-left": "10px" }}>
                    ⟳ Intento {req().attempts}/{req().maxAttempts}
                  </span>
                </Show>
              </div>
            </div>

            {/* Assertions */}
            <Show when={req().assertions?.length > 0}>
              <div class="assertions-container">
                {req().assertions.map((a: any) => (
                  <div class={`assertion-item ${a.pass ? "pass" : "fail"}`}>
                    {a.pass ? "✅" : "❌"} {a.label}
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
                <div class="search-box">
                  <input
                    type="text"
                    class="search-input"
                    placeholder="Filtrar en respuesta..."
                    value={searchTerm()}
                    onInput={(e) => setSearchTerm(e.currentTarget.value)}
                  />
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
                  <pre>
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
