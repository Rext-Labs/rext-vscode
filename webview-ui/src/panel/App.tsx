import { createSignal, onMount, Component } from "solid-js";
import Timeline from "./components/Timeline";
import DetailView from "./components/DetailView";
import { getVsCodeApi } from "../shared/vscode";

const App: Component = () => {
  const [history, setHistory] = createSignal<any[]>([]);
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [selectedPreResult, setSelectedPreResult] = createSignal<any>(null);

  const vscodeApi = getVsCodeApi();

  onMount(() => {
    // Receive initial data and updates from extension host
    window.addEventListener("message", (event) => {
      const msg = event.data;
      switch (msg.type) {
        case "init":
          setHistory(msg.history || []);
          break;
        case "updateHistory":
          setHistory(msg.history || []);
          break;
        case "addPending": {
          setHistory((prev) => [{ ...msg.data, _pending: true }, ...prev]);
          setCurrentIndex(0);
          setSelectedPreResult(null);
          break;
        }
        case "updatePending": {
          setHistory((prev) => {
            const idx = prev.findIndex((r) => r._pending);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = msg.data;
              return updated;
            }
            return [msg.data, ...prev];
          });
          break;
        }
        case "display": {
          setHistory((prev) => [msg.data, ...prev]);
          setCurrentIndex(0);
          setSelectedPreResult(null);
          break;
        }
      }
    });
  });

  const currentRequest = () => {
    const pre = selectedPreResult();
    if (pre) return pre;
    return history()[currentIndex()] || null;
  };

  const handleSelectRequest = (index: number) => {
    setCurrentIndex(index);
    setSelectedPreResult(null);
  };

  const handleSelectPreResult = (parentIdx: number, preIdx: number) => {
    setCurrentIndex(parentIdx);
    const req = history()[parentIdx];
    if (req?.preResults?.[preIdx]) {
      setSelectedPreResult(req.preResults[preIdx]);
    }
  };

  const handleClear = () => {
    setHistory([]);
    setSelectedPreResult(null);
    vscodeApi.postMessage({ command: "clearHistory" });
  };

  return (
    <>
      <Timeline
        history={history()}
        currentIndex={currentIndex()}
        onSelectRequest={handleSelectRequest}
        onSelectPreResult={handleSelectPreResult}
        onClear={handleClear}
      />
      <DetailView request={currentRequest()} />
    </>
  );
};

export default App;
