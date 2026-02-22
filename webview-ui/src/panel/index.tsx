/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "./styles.css";
import "prismjs/themes/prism-tomorrow.css";

render(() => <App />, document.getElementById("app")!);
