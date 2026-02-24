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
  const showHistoryItem = (index: number) =>
    vscode.postMessage({ command: "showHistoryItem", index });
  const exportRequest = (file: string, idx: number) =>
    vscode.postMessage({
      command: "export",
      filePath: file,
      requestIndex: idx,
    });

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
          {(() => {
            type DirNode = {
              dirs: Record<string, DirNode>;
              files: any[];
            };

            const buildTree = () => {
              const allFiles = explorerData().files || [];
              if (allFiles.length === 0)
                return { root: { dirs: {}, files: [] }, prefix: "" };

              // Find common prefix
              const paths = allFiles.map((f: any) =>
                (f.path as string).replace(/\\/g, "/").split("/"),
              );
              let prefix = paths[0].slice(0, -1);
              for (const p of paths) {
                const dir = p.slice(0, -1);
                let i = 0;
                while (
                  i < prefix.length &&
                  i < dir.length &&
                  prefix[i] === dir[i]
                )
                  i++;
                prefix = prefix.slice(0, i);
              }
              const prefixLen = prefix.length;

              const root: DirNode = { dirs: {}, files: [] };
              for (const f of allFiles) {
                const parts = (f.path as string).replace(/\\/g, "/").split("/");
                const rel = parts.slice(prefixLen, -1); // relative dir segments
                let node = root;
                for (const seg of rel) {
                  if (!node.dirs[seg]) node.dirs[seg] = { dirs: {}, files: [] };
                  node = node.dirs[seg];
                }
                node.files.push(f);
              }
              return { root, prefix: prefix.join("/") };
            };

            const FolderIcon = () => (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                opacity="0.5"
                style={{ "flex-shrink": "0" }}
              >
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
            );

            const renderDir = (
              name: string,
              node: DirNode,
              depth: number,
            ): any => {
              // Compact single-child dirs: if only one subdir and no files, merge names
              let displayName = name;
              let current = node;
              while (
                Object.keys(current.dirs).length === 1 &&
                current.files.length === 0
              ) {
                const [childName] = Object.keys(current.dirs);
                displayName += "/" + childName;
                current = current.dirs[childName];
              }

              const totalFiles = countFiles(current);
              return (
                <div
                  class="file-group"
                  style={{ "padding-left": depth > 0 ? "12px" : "0" }}
                >
                  <div class="fh" onClick={(e) => toggleNext(e.currentTarget)}>
                    <span class="chv open">▶</span>
                    <FolderIcon />
                    <span class="fn">{escHtml(displayName)}</span>
                    <span class="rc">{totalFiles}</span>
                  </div>
                  <div class="fr">
                    <For
                      each={Object.entries(current.dirs).sort(([a], [b]) =>
                        a.localeCompare(b),
                      )}
                    >
                      {([childName, childNode]) =>
                        renderDir(childName, childNode, depth + 1)
                      }
                    </For>
                    <For each={current.files}>{(f: any) => renderFile(f)}</For>
                  </div>
                </div>
              );
            };

            const countFiles = (node: DirNode): number => {
              let count = node.files.length;
              for (const child of Object.values(node.dirs))
                count += countFiles(child);
              return count;
            };

            const renderFile = (f: any) => {
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
            };

            const { root } = buildTree();
            const topDirs = Object.entries(root.dirs).sort(([a], [b]) =>
              a.localeCompare(b),
            );
            const topFiles = root.files;
            const hasContent = topDirs.length > 0 || topFiles.length > 0;

            return (
              <Show
                when={hasContent}
                fallback={<div class="em">No .rext files found</div>}
              >
                <For each={topDirs}>
                  {([name, node]) => renderDir(name, node, 0)}
                </For>
                <For each={topFiles}>{(f: any) => renderFile(f)}</For>
              </Show>
            );
          })()}
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
            type ReqItem = { file: string; req: any; idx: number };
            const collections = () => {
              const map: Record<string, ReqItem[]> = {};
              const uncollected: ReqItem[] = [];
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
              const sorted: [string, ReqItem[]][] = Object.entries(map).sort(
                ([a], [b]) => a.localeCompare(b),
              );
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
                          it.req.method.toLowerCase().includes(ft()) ||
                          (it.req.group || "").toLowerCase().includes(ft()),
                      ),
                    ] as [string, typeof items],
                )
                .filter(([, items]) => items.length > 0);
            };

            const renderItem = (it: ReqItem) => (
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
                <span class={`mb b-${it.req.method}`}>{it.req.method}</span>
                <span class="rn">{escHtml(it.req.name)}</span>
                <Show when={it.req.tags}>
                  <For each={it.req.tags}>
                    {(tag: string) => <span class="tag-badge">{tag}</span>}
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
            );

            const GroupIcon = () => (
              <svg
                class="group-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                opacity="0.55"
              >
                <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7a2.5 2.5 0 010-5 2.5 2.5 0 010 5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z" />
              </svg>
            );

            type GroupNode = {
              items: ReqItem[];
              children: Record<string, GroupNode>;
            };

            const buildGroupTree = (
              items: ReqItem[],
            ): { tree: Record<string, GroupNode>; ungrouped: ReqItem[] } => {
              const tree: Record<string, GroupNode> = {};
              const ungrouped: ReqItem[] = [];
              for (const it of items) {
                if (it.req.group) {
                  const parts = (it.req.group as string).split("/");
                  let node = tree;
                  for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (!node[part]) node[part] = { items: [], children: {} };
                    if (i === parts.length - 1) {
                      node[part].items.push(it);
                    } else {
                      node = node[part].children;
                    }
                  }
                } else {
                  ungrouped.push(it);
                }
              }
              return { tree, ungrouped };
            };

            const renderGroupTree = (
              tree: Record<string, GroupNode>,
              depth: number = 0,
            ) => {
              const sorted = Object.entries(tree).sort(([a], [b]) =>
                a.localeCompare(b),
              );
              return (
                <For each={sorted}>
                  {([name, node]) => (
                    <div
                      class="group-section"
                      style={{ "padding-left": depth > 0 ? "8px" : "0" }}
                    >
                      <div
                        class="gh"
                        onClick={(e) => toggleNext(e.currentTarget)}
                      >
                        <span class="chv open">▶</span>
                        <GroupIcon />
                        <span class="gn">{escHtml(name)}</span>
                        <span class="rc">
                          {node.items.length +
                            Object.values(node.children).reduce(
                              (s, c) => s + c.items.length,
                              0,
                            )}
                        </span>
                      </div>
                      <div class="gr">
                        {Object.keys(node.children).length > 0 &&
                          renderGroupTree(node.children, depth + 1)}
                        <For each={node.items}>{renderItem}</For>
                      </div>
                    </div>
                  )}
                </For>
              );
            };

            const renderGroupedItems = (items: ReqItem[]) => {
              const { tree, ungrouped } = buildGroupTree(items);
              return (
                <>
                  {renderGroupTree(tree)}
                  <For each={ungrouped}>{renderItem}</For>
                </>
              );
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
                        {renderGroupedItems(items as ReqItem[])}
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
              {(h: any, idx) => {
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
                  <div class="hi" onClick={() => showHistoryItem(idx())}>
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
              <div class="ctx-sep" />
              <div
                class="ctx-item"
                onClick={() => {
                  exportRequest(menu().filePath, menu().idx);
                  setCtxMenu(null);
                }}
              >
                📋 Export as Code
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
