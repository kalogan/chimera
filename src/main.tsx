import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { RivalInspector } from "./rival-inspector.js";
import "./styles.css";

// `?rivals` opens the dev brain inspector (Utility vs Grok on the same state);
// everything else boots the game.
const debugRivals = new URLSearchParams(window.location.search).has("rivals");
const el = document.getElementById("root");
if (el) createRoot(el).render(<StrictMode>{debugRivals ? <RivalInspector /> : <App />}</StrictMode>);
