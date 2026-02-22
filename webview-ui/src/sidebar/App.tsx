import { createSignal, onMount, For, Show, Component } from "solid-js";
import { getVsCodeApi } from "../shared/vscode";

const App: Component = () => {
  const vscode = getVsCodeApi();
  const [activeTab, setActiveTab] = createSignal("explorer");
  const [filterText, setFilterText] = createSignal("");
  const [explorerData, setExplorerData] = createSignal<any>({ files: [] });
  const [data, setData] = createSignal<any>({
    history: [],
    envs: [],
    activeEnv: "",
    vars: {},
  });
  const [ctxMenu, setCtxMenu] = createSignal<any>(null);

  onMount(() => {
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "explorerData") setExplorerData(msg.data);
      if (msg.type === "init") setData(msg.data);
      if (msg.type === "updateData") setData(msg.data);
    });
    // Close context menu on click
    document.addEventListener("click", () => setCtxMenu(null));
  });

  const escHtml = (s: string) =>
    s?.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "";

  // --- Actions ---
  const runRequest = (file: string, idx: number) =>
    vscode.postMessage({ command: "run", filePath: file, requestIndex: idx });
  const openFile = (file: string, line: number) =>
    vscode.postMessage({ command: "open", filePath: file, line });
  const switchEnv = (env: string) =>
    vscode.postMessage({ command: "switchEnv", env });
  const refreshExplorer = () => vscode.postMessage({ command: "refresh" });
  const refreshVars = () => vscode.postMessage({ command: "refreshVars" });
  const renameRequest = (file: string, line: number, current: string) =>
    vscode.postMessage({
      command: "rename",
      filePath: file,
      line,
      currentName: current,
    });
  const moveToCollection = (file: string, line: number) =>
    vscode.postMessage({ command: "moveToCollection", filePath: file, line });
  const newRequest = (file: string) =>
    vscode.postMessage({ command: "newRequest", filePath: file });
  const runAllFile = (file: string) =>
    vscode.postMessage({ command: "runAllFile", filePath: file });

  // --- Context Menu ---
  const showContextMenu = (
    e: MouseEvent,
    type: "file" | "request",
    data: any,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, type, ...data });
  };

  // --- Toggle ---
  const toggleNext = (el: HTMLElement) => {
    const next = el.nextElementSibling as HTMLElement;
    const chv = el.querySelector(".chv");
    if (next) {
      const hidden = next.style.display === "none";
      next.style.display = hidden ? "" : "none";
      chv?.classList.toggle("open", hidden);
    }
  };

  const ft = () => filterText().toLowerCase();

  return (
    <>
      {/* Header */}
      <div class="header">
        <div class="header-top">
          <h3>REXT</h3>
          <Show when={data().activeEnv}>
            <span class="env-chip">{data().activeEnv}</span>
          </Show>
        </div>
        <div class="tab-bar">
          {["explorer", "collections", "history", "envs", "vars"].map(
            (tab, i) => (
              <div
                class={`tab ${activeTab() === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {["Files", "Collections", "Activity", "Env", "Vars"][i]}
              </div>
            ),
          )}
        </div>
        <div class="filter-bar">
          <span class="filter-icon">🔍</span>
          <input
            placeholder="Filter..."
            value={filterText()}
            onInput={(e) => setFilterText(e.currentTarget.value)}
          />
        </div>
      </div>

      {/* Content */}
      <div class="content">
        {/* Explorer Tab */}
        <div class={`panel-view ${activeTab() === "explorer" ? "active" : ""}`}>
          <div class="toolbar">
            <span class="toolbar-label">Files</span>
            <button class="tb" onClick={refreshExplorer}>
              ↻
            </button>
          </div>
          <For
            each={explorerData().files}
            fallback={<div class="em">No .rext files found</div>}
          >
            {(f: any) => {
              const reqs = () => {
                if (!ft()) return f.requests;
                return f.requests.filter(
                  (r: any) =>
                    r.name.toLowerCase().includes(ft()) ||
                    r.method.toLowerCase().includes(ft()),
                );
              };
              return (
                <Show when={!ft() || reqs().length > 0}>
                  <div class="file-group">
                    <div
                      class="fh"
                      onClick={(e) => toggleNext(e.currentTarget)}
                      onContextMenu={(e) =>
                        showContextMenu(e, "file", { filePath: f.path })
                      }
                    >
                      <span class="chv open">▶</span>
                      <span class="fn">{escHtml(f.name)}</span>
                      <span class="rc">{f.requests.length}</span>
                    </div>
                    <div class="fr">
                      <For each={reqs()}>
                        {(r: any, idx) => (
                          <div
                            class={`ri ${r.deprecated ? "dep" : ""}`}
                            draggable="true"
                            data-file={f.path}
                            data-line={r.line}
                            data-idx={idx()}
                            data-name={r.name}
                            onContextMenu={(e) =>
                              showContextMenu(e, "request", {
                                filePath: f.path,
                                line: r.line,
                                idx: idx(),
                                name: r.name,
                              })
                            }
                            onDblClick={() => openFile(f.path, r.line)}
                          >
                            <span class={`mb b-${r.method}`}>{r.method}</span>
                            <span class="rn">{escHtml(r.name)}</span>
                            <Show when={r.tags}>
                              <For each={r.tags}>
                                {(tag: string) => (
                                  <span class="tag-badge">{tag}</span>
                                )}
                              </For>
                            </Show>
                            <button
                              class="play-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                runRequest(f.path, idx());
                              }}
                            >
                              ▶
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              );
            }}
          </For>
        </div>

        {/* Collections Tab */}
        <div
          class={`panel-view ${activeTab() === "collections" ? "active" : ""}`}
        >
          <div class="toolbar">
            <span class="toolbar-label">Collections</span>
            <button class="tb" onClick={refreshExplorer}>
              ↻
            </button>
          </div>
          {(() => {
            const collections = () => {
              const map: Record<
                string,
                { file: string; req: any; idx: number }[]
              > = {};
              const uncollected: { file: string; req: any; idx: number }[] = [];
              for (const f of explorerData().files || []) {
                (f.requests || []).forEach((r: any, i: number) => {
                  if (r.collection) {
                    if (!map[r.collection]) map[r.collection] = [];
                    map[r.collection].push({ file: f.path, req: r, idx: i });
                  } else {
                    uncollected.push({ file: f.path, req: r, idx: i });
                  }
                });
              }
              const sorted: [string, typeof uncollected][] = Object.entries(
                map,
              ).sort(([a], [b]) => a.localeCompare(b));
              if (uncollected.length > 0) {
                sorted.push(["Uncollected", uncollected]);
              }
              return sorted;
            };
            const filtered = () => {
              if (!ft()) return collections();
              return collections()
                .map(
                  ([name, items]) =>
                    [
                      name,
                      items.filter(
                        (it) =>
                          name.toLowerCase().includes(ft()) ||
                          it.req.name.toLowerCase().includes(ft()) ||
                          it.req.method.toLowerCase().includes(ft()),
                      ),
                    ] as [string, typeof items],
                )
                .filter(([, items]) => items.length > 0);
            };
            return (
              <Show
                when={filtered().length > 0}
                fallback={<div class="em">No requests found</div>}
              >
                <For each={filtered()}>
                  {([colName, items]) => (
                    <div class="file-group">
                      <div
                        class="fh"
                        onClick={(e) => toggleNext(e.currentTarget)}
                      >
                        <span class="chv open">▶</span>
                        <span class="fn">{escHtml(colName as string)}</span>
                        <span class="rc">{(items as any[]).length}</span>
                      </div>
                      <div class="fr">
                        <For each={items as any[]}>
                          {(it) => (
                            <div
                              class={`ri ${it.req.deprecated ? "dep" : ""}`}
                              onDblClick={() => openFile(it.file, it.req.line)}
                              onContextMenu={(e) =>
                                showContextMenu(e, "request", {
                                  filePath: it.file,
                                  line: it.req.line,
                                  idx: it.idx,
                                  name: it.req.name,
                                })
                              }
                            >
                              <span class={`mb b-${it.req.method}`}>
                                {it.req.method}
                              </span>
                              <span class="rn">{escHtml(it.req.name)}</span>
                              <Show when={it.req.tags}>
                                <For each={it.req.tags}>
                                  {(tag: string) => (
                                    <span class="tag-badge">{tag}</span>
                                  )}
                                </For>
                              </Show>
                              <button
                                class="play-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runRequest(it.file, it.idx);
                                }}
                              >
                                ▶
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            );
          })()}
        </div>

        {/* History Tab */}
        <div class={`panel-view ${activeTab() === "history" ? "active" : ""}`}>
          <div class="toolbar">
            <span class="toolbar-label">Activity</span>
            <button class="tb" onClick={refreshExplorer}>
              ↻
            </button>
          </div>
          <Show
            when={data().history.length > 0}
            fallback={<div class="em">No requests yet</div>}
          >
            <For each={data().history}>
              {(h: any) => {
                if (
                  ft() &&
                  !(h.name || h.url).toLowerCase().includes(ft()) &&
                  !h.method.toLowerCase().includes(ft())
                )
                  return null;
                const sc = () =>
                  h.status >= 200 && h.status < 300
                    ? "s2"
                    : h.status >= 500
                      ? "s5"
                      : "s4";
                const nm = () => h.name || h.url?.split("/").pop() || h.url;
                const tm = () => new Date(h.timestamp).toLocaleTimeString();
                return (
                  <div class="hi">
                    <span class={`mb b-${h.method}`}>{h.method}</span>
                    <div class="hinfo">
                      <div class="hn">{escHtml(nm())}</div>
                      <div class="hm">{tm()}</div>
                    </div>
                    <span class={`sb ${sc()}`}>{h.status}</span>
                    <span class="hd">{h.duration}ms</span>
                    {/* Pre-results */}
                    <Show when={h.preResults?.length > 0}>
                      <PreResultsGroup preResults={h.preResults} />
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>

        {/* Environments Tab */}
        <div class={`panel-view ${activeTab() === "envs" ? "active" : ""}`}>
          <div class="toolbar">
            <span class="toolbar-label">Environments</span>
          </div>
          <Show
            when={data().envs.length > 0}
            fallback={<div class="em">No rext.env.json found</div>}
          >
            <For each={data().envs}>
              {(name: string) => {
                const isActive = () => name === data().activeEnv;
                return (
                  <div
                    class={`ei ${isActive() ? "ae" : ""}`}
                    onClick={() => switchEnv(name)}
                  >
                    <span class="ed" />
                    <span class="ename">{escHtml(name)}</span>
                    <Show when={isActive()}>
                      <span class="atag">ACTIVE</span>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>

        {/* Variables Tab */}
        <div class={`panel-view ${activeTab() === "vars" ? "active" : ""}`}>
          <div class="toolbar">
            <span class="toolbar-label">Variables</span>
            <button class="tb" onClick={refreshVars}>
              ↻
            </button>
          </div>
          <For
            each={[
              { k: "session", l: "Session" },
              { k: "collection", l: "Collection" },
              { k: "env", l: "Environment" },
              { k: "global", l: "Global" },
            ]}
          >
            {(scope) => {
              const vars = () => data().vars[scope.k] || {};
              const entries = () => Object.entries(vars());
              return (
                <div class="ss">
                  <div class="sh" onClick={(e) => toggleNext(e.currentTarget)}>
                    <span class="chv open">▶</span>
                    <span>{scope.l}</span>
                    <span class="sc">{entries().length}</span>
                  </div>
                  <div>
                    <Show
                      when={entries().length > 0}
                      fallback={<div class="em">Empty</div>}
                    >
                      <For each={entries()}>
                        {([k, v]) => {
                          const sv =
                            typeof v === "object"
                              ? JSON.stringify(v)
                              : String(v);
                          const d =
                            sv.length > 35 ? sv.substring(0, 35) + "…" : sv;
                          return (
                            <div class="vi">
                              <span class="vk">{escHtml(String(k))}</span>
                              <span class="ve">=</span>
                              <span class="vv">{escHtml(d)}</span>
                            </div>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      {/* Context Menu */}
      <Show when={ctxMenu()}>
        {(menu) => (
          <div
            class="ctx-menu"
            style={{ left: menu().x + "px", top: menu().y + "px" }}
          >
            <Show when={menu().type === "file"}>
              <div
                class="ctx-item"
                onClick={() => {
                  runAllFile(menu().filePath);
                  setCtxMenu(null);
                }}
              >
                ▶▶ Run All
              </div>
              <div
                class="ctx-item"
                onClick={() => {
                  openFile(menu().filePath, 0);
                  setCtxMenu(null);
                }}
              >
                📄 Open in Editor
              </div>
              <div class="ctx-sep" />
              <div
                class="ctx-item"
                onClick={() => {
                  newRequest(menu().filePath);
                  setCtxMenu(null);
                }}
              >
                ➕ New Request
              </div>
            </Show>
            <Show when={menu().type === "request"}>
              <div
                class="ctx-item"
                onClick={() => {
                  runRequest(menu().filePath, menu().idx);
                  setCtxMenu(null);
                }}
              >
                ▶ Run
              </div>
              <div
                class="ctx-item"
                onClick={() => {
                  openFile(menu().filePath, menu().line);
                  setCtxMenu(null);
                }}
              >
                📄 Open in Editor
              </div>
              <div class="ctx-sep" />
              <div
                class="ctx-item"
                onClick={() => {
                  renameRequest(menu().filePath, menu().line, menu().name);
                  setCtxMenu(null);
                }}
              >
                ✏️ Rename
              </div>
              <div
                class="ctx-item"
                onClick={() => {
                  moveToCollection(menu().filePath, menu().line);
                  setCtxMenu(null);
                }}
              >
                📁 Move to Collection…
              </div>
              <div class="ctx-sep" />
              <div
                class="ctx-item"
                onClick={() => {
                  newRequest(menu().filePath);
                  setCtxMenu(null);
                }}
              >
                ➕ New Request
              </div>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
};

// Pre-results sub-component
const PreResultsGroup: Component<{ preResults: any[] }> = (props) => {
  let groupRef: HTMLDivElement | undefined;
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    groupRef?.classList.toggle("collapsed");
  };
  const escHtml = (s: string) => s || "";

  return (
    <div
      ref={groupRef}
      class="pre-group collapsed"
      style={{ "margin-top": "4px", cursor: "pointer", width: "100%" }}
    >
      <div
        onClick={toggle}
        style={{
          "font-size": "0.7em",
          opacity: 0.5,
          "text-transform": "uppercase",
          "letter-spacing": "0.5px",
          padding: "2px 0",
        }}
      >
        <span
          class="chv open"
          style={{ "font-size": "8px", "margin-right": "4px" }}
        >
          ▶
        </span>
        ⚡ Pre-requests ({props.preResults.length})
      </div>
      <div class="pre-children" onClick={(e) => e.stopPropagation()}>
        <For each={props.preResults}>
          {(pr: any) => {
            const psc = () =>
              pr.status >= 200 && pr.status < 300 ? "s2" : "s5";
            return (
              <div
                style={{
                  "margin-left": "12px",
                  "border-left": "2px solid var(--vscode-button-background)",
                  padding: "2px 8px",
                  "font-size": "0.85em",
                  opacity: 0.8,
                }}
              >
                <span
                  class={`mb b-${pr.method}`}
                  style={{ "font-size": "0.8em" }}
                >
                  {pr.method}
                </span>{" "}
                <span>{escHtml(pr.name)}</span>{" "}
                <span class={`sb ${psc()}`} style={{ "font-size": "0.75em" }}>
                  {pr.status}
                </span>{" "}
                <span class="hd" style={{ "font-size": "0.75em" }}>
                  {pr.duration}ms
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default App;
