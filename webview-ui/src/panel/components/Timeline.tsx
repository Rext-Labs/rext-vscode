import { Component, For, Show } from "solid-js";
import { formatSize, statusClass } from "../../shared/utils";

interface TimelineProps {
  history: any[];
  currentIndex: number;
  onSelectRequest: (index: number) => void;
  onSelectPreResult: (parentIdx: number, preIdx: number) => void;
  onClear: () => void;
}

const Timeline: Component<TimelineProps> = (props) => {
  let sidebarRef: HTMLDivElement | undefined;

  const toggleCollapse = () => {
    sidebarRef?.classList.toggle("collapsed");
  };

  return (
    <div class="sidebar" ref={sidebarRef}>
      <div class="history-header">
        <span>Timeline</span>
        <div style={{ display: "flex", gap: "4px" }}>
          <button class="btn-clear" onClick={props.onClear}>
            Clear
          </button>
          <button
            class="sidebar-toggle"
            onClick={toggleCollapse}
            title="Toggle Timeline"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
            </svg>
          </button>
        </div>
      </div>
      <div>
        <For each={props.history}>
          {(req, i) => (
            <>
              {/* Pre-results group */}
              <Show when={req.preResults?.length > 0}>
                <PreResultsGroup
                  preResults={req.preResults}
                  parentIndex={i()}
                  onSelect={props.onSelectPreResult}
                />
              </Show>
              {/* Main request */}
              <Show
                when={req._pending}
                fallback={
                  <div
                    class={`history-item ${i() === props.currentIndex ? "active" : ""}`}
                    onClick={() => props.onSelectRequest(i())}
                  >
                    <span class={`status-dot ${statusClass(req.status)}`} />
                    <span class="method">
                      {req.method?.toUpperCase() || "GET"}
                    </span>
                    <span style={{ opacity: 0.8 }}>
                      {req.name || req.url?.split("/").pop() || "req"}
                    </span>
                    <Show when={req.attempts > 1}>
                      <span
                        style={{
                          background: "#ff9800",
                          color: "#000",
                          "border-radius": "3px",
                          padding: "1px 5px",
                          "font-size": "0.7em",
                          "margin-left": "5px",
                        }}
                      >
                        ⟳ {req.attempts}/{req.maxAttempts}
                      </span>
                    </Show>
                    <div
                      style={{
                        "font-size": "0.75em",
                        opacity: 0.5,
                        "margin-top": "5px",
                      }}
                    >
                      {req.duration != null ? req.duration + "ms" : ""}
                      {req.size != null ? " · " + formatSize(req.size) : ""}
                    </div>
                  </div>
                }
              >
                <div
                  class={`history-item ${i() === props.currentIndex ? "active" : ""}`}
                  onClick={() => props.onSelectRequest(i())}
                >
                  <span class="status-dot status-pending" />
                  <span class="method">
                    {req.method?.toUpperCase() || "GET"}
                  </span>
                  <span style={{ opacity: 0.8 }}>
                    {req.name || req.url?.split("/").pop() || "req"}
                  </span>
                  <div
                    style={{
                      "font-size": "0.75em",
                      opacity: 0.7,
                      "margin-top": "5px",
                      color: "#2196f3",
                    }}
                  >
                    ⏳ En progreso...
                  </div>
                </div>
              </Show>
            </>
          )}
        </For>
        <Show when={props.history.length === 0}>
          <div
            style={{ padding: "20px", opacity: 0.5, "text-align": "center" }}
          >
            No requests yet
          </div>
        </Show>
      </div>
    </div>
  );
};

const PreResultsGroup: Component<{
  preResults: any[];
  parentIndex: number;
  onSelect: (parentIdx: number, preIdx: number) => void;
}> = (props) => {
  let groupRef: HTMLDivElement | undefined;

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    groupRef?.classList.toggle("collapsed");
  };

  return (
    <div ref={groupRef} class="pre-group collapsed">
      <div class="pre-label" onClick={toggle}>
        <span class="pre-chv">▶</span> ⚡ Pre-requests (
        {props.preResults.length})
      </div>
      <div class="pre-children" onClick={(e) => e.stopPropagation()}>
        <For each={props.preResults}>
          {(pr, pi) => (
            <div
              class={`history-item pre-item`}
              onClick={() => props.onSelect(props.parentIndex, pi())}
              style={{ cursor: "pointer" }}
            >
              <span class={`status-dot ${statusClass(pr.status)}`} />
              <span class="method">{pr.method?.toUpperCase() || "GET"}</span>
              <span style={{ opacity: 0.8 }}>{pr.name || "pre"}</span>
              <div
                style={{
                  "font-size": "0.7em",
                  opacity: 0.5,
                  "margin-top": "3px",
                }}
              >
                {pr.duration != null ? pr.duration + "ms" : ""}
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default Timeline;
