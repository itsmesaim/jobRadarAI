import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getInitialTheme, persistTheme } from "./utils/theme";
import "./index.css";

persistTheme(getInitialTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
