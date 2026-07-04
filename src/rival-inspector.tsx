/**
 * Rival brain inspector (`?rivals`) — a dev tool to watch AI rivals genuinely
 * decide, and to COMPARE the two brains on the SAME state: the deterministic
 * Utility AI vs the Grok LLM brain. Both read ONE `enumerateOptions` — the single
 * source of truth for the legal option space — so the comparison is always over
 * the identical, current content (add a zone/creature and both brains see it).
 *
 * Grok here has TWO sources, toggled live in the inspector:
 *   - mock: picks a legal goal by a different priority, with flavor text — the
 *     difference from utility is visible with no key.
 *   - live: `createProxyGrokProvider()` (src/rival-grok.ts) calls the REAL Grok
 *     through the `/api/grok` server-side proxy (dev: the Vite plugin in
 *     vite.config.ts; prod: api/grok.ts). No key in the browser, ever.
 * The firewall still guards both — an illegal pick, a thrown error, or a missing
 * XAI_API_KEY (proxy 503s) all degrade to the utility decision, and the source
 * badge shows it honestly (`GROK→FELL BACK`).
 */
import { useEffect, useMemo, useState } from "react";
import { seedToken } from "game-kit/creature";
import { dexCount } from "game-kit/roster";
import type { ReasoningProvider } from "game-kit/npc";
import { createProxyGrokProvider } from "./rival-grok";
import {
  createRival,
  enumerateOptions,
  HOARDER_PERSONALITY,
  BREEDER_PERSONALITY,
  COMPLETIONIST_PERSONALITY,
  type RivalState,
  type RivalCtx,
  type DecisionTrace,
  type RivalGoal,
} from "game-kit/rival";
import {
  utilityBrain,
  createGrokRivalBrain,
  stepRivalWithBrain,
  type RivalBrain,
} from "game-kit/rival/brain";

// The shared content both brains reason over. Adding a zone/creature here surfaces
// automatically for BOTH brains — no brain-code change (the sync invariant).
const CTX: RivalCtx = {
  zonePool: {
    meadowmere: ["w3", "w9", "w16"].map((id) => seedToken(id)),
    emberdeep: ["w25", "w56", "w70"].map((id) => seedToken(id)),
    tidewrack: ["w9", "w16", "w25"].map((id) => seedToken(id)),
  },
};

const MOCK_PRIORITY: RivalGoal[] = ["breed", "scout", "shop", "rank-up", "hunt", "explore"];
const MOCK_WHY: Record<RivalGoal, string> = {
  breed: "Two promising bloodlines — I'll weave something new before you can.",
  scout: "Every wild soul is worth saving. I'll befriend this one.",
  shop: "Stock the satchel; the deep zones punish the unprepared.",
  "rank-up": "I've earned my next rank. Time to prove it.",
  hunt: "Strength is a language — let me speak it a while.",
  explore: "The map has corners no one has touched. I'll go look.",
};
// A stand-in for a real LLM: it only gets the prompt text, finds the legal goals
// the brain listed, and picks by ITS OWN priority (diverging from utility's scores).
const mockGrok: ReasoningProvider = {
  name: "grok-mock",
  async respond() {
    return { intents: [] };
  },
  async complete(_system: string, user: string) {
    const goal = MOCK_PRIORITY.find((g) => user.includes(g)) ?? "explore";
    return JSON.stringify({ goal, why: MOCK_WHY[goal] });
  },
};
const mockGrokBrain: RivalBrain = createGrokRivalBrain(mockGrok, { label: "Grok (mock)" });
// Built once (not per-render) — the provider itself is stateless (each call just
// POSTs to the proxy), so there's nothing to invalidate across renders.
const liveGrokBrain: RivalBrain = createGrokRivalBrain(createProxyGrokProvider(), { label: "Grok (live)" });

type GrokSource = "mock" | "live";

function makeRivals(): RivalState[] {
  return [
    createRival({ id: "vesk", name: "Vesk", personality: HOARDER_PERSONALITY, currentZone: "emberdeep", seed: "vesk", gold: 90 }),
    createRival({ id: "lune", name: "Lune", personality: BREEDER_PERSONALITY, currentZone: "meadowmere", seed: "lune", gold: 60 }),
    createRival({ id: "orrin", name: "Orrin", personality: COMPLETIONIST_PERSONALITY, currentZone: "tidewrack", seed: "orrin", gold: 40 }),
  ];
}

function sourceBadge(t: DecisionTrace): { label: string; cls: string } {
  switch (t.source) {
    case "grok": return { label: "GROK", cls: "src-grok" };
    case "utility-fallback": return { label: "GROK→FELL BACK", cls: "src-fallback" };
    default: return { label: "UTILITY", cls: "src-utility" };
  }
}

function TracePane({ title, trace }: { title: string; trace: DecisionTrace | null }) {
  if (!trace) return <div className="ins-pane"><div className="ins-pane-h">{title}</div><div className="hint">…thinking…</div></div>;
  const max = Math.max(0.001, ...trace.options.map((o) => o.score));
  const badge = sourceBadge(trace);
  return (
    <div className="ins-pane">
      <div className="ins-pane-h">
        <span>{title}</span>
        <span className={`ins-badge ${badge.cls}`}>{badge.label}</span>
      </div>
      <div className="ins-intent">“{trace.intent}”</div>
      <div className="ins-opts">
        {trace.options.map((o) => (
          <div key={o.goal} className={`ins-opt ${o.goal === trace.chosen ? "chosen" : ""}`}>
            <div className="ins-opt-top">
              <span className="ins-goal">{o.goal === trace.chosen ? "▶ " : ""}{o.goal}</span>
              <span className="ins-score">{o.score.toFixed(2)}</span>
            </div>
            <div className="ins-bar"><i style={{ width: `${(o.score / max) * 100}%` }} /></div>
            <div className="ins-reason">{o.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RivalInspector() {
  const [rivals, setRivals] = useState<RivalState[]>(() => makeRivals());
  const [sel, setSel] = useState(0);
  const [driver, setDriver] = useState<"utility" | "grok">("utility");
  // mock = the deterministic stand-in (no key needed); live = the real Grok through
  // the /api/grok server-side proxy. Defaults to mock — the safe, always-on choice.
  const [grokSource, setGrokSource] = useState<GrokSource>("mock");
  const [utilTrace, setUtilTrace] = useState<DecisionTrace | null>(null);
  const [grokTrace, setGrokTrace] = useState<DecisionTrace | null>(null);

  const rival = rivals[sel]!;
  const optionCount = useMemo(() => enumerateOptions(rival, CTX).length, [rival]);
  const grokBrain = grokSource === "live" ? liveGrokBrain : mockGrokBrain;

  // Recompute BOTH brains' decisions on the current state whenever it (or the Grok
  // source) changes.
  useEffect(() => {
    let live = true;
    setUtilTrace(null);
    setGrokTrace(null);
    void Promise.all([utilityBrain.decide(rival, CTX), grokBrain.decide(rival, CTX)]).then(
      ([u, g]) => { if (live) { setUtilTrace(u); setGrokTrace(g); } },
    );
    return () => { live = false; };
  }, [rival, grokBrain]);

  const step = async (n: number) => {
    let r = rival;
    const brain = driver === "utility" ? utilityBrain : grokBrain;
    for (let i = 0; i < n; i++) {
      const { rival: next } = await stepRivalWithBrain(r, CTX, brain);
      r = next;
    }
    setRivals((rs) => rs.map((x, i) => (i === sel ? r : x)));
  };

  return (
    <div className="inspector">
      <div className="ins-top">
        <div className="ins-title">RIVAL BRAIN INSPECTOR</div>
        <div className="hint">Same state, both brains, one option space ({optionCount} legal now).</div>
        <div className="ins-controls">
          <span className="hint">Grok:</span>
          <button
            className={`ins-drv ${grokSource === "mock" ? "active" : ""}`}
            onClick={() => setGrokSource("mock")}
          >
            mock
          </button>
          <button
            className={`ins-drv ${grokSource === "live" ? "active" : ""}`}
            onClick={() => setGrokSource("live")}
          >
            live
          </button>
        </div>
      </div>

      <div className="ins-tabs">
        {rivals.map((r, i) => (
          <button key={r.id} className={`ins-tab ${i === sel ? "active" : ""}`} onClick={() => setSel(i)}>
            <b>{r.name}</b>
            <small>{r.personality.name} · {r.currentZone}</small>
            <small>party {r.roster.party.length} · dex {dexCount(r.roster)} · ◈{r.economy.gold} · step {r.step}</small>
          </button>
        ))}
      </div>

      <div className="ins-panes">
        <TracePane title="Utility AI (deterministic)" trace={utilTrace} />
        <TracePane title="Grok (LLM)" trace={grokTrace} />
      </div>

      <div className="ins-controls">
        <span className="hint">Drive the sim with:</span>
        <button className={`ins-drv ${driver === "utility" ? "active" : ""}`} onClick={() => setDriver("utility")}>Utility</button>
        <button className={`ins-drv ${driver === "grok" ? "active" : ""}`} onClick={() => setDriver("grok")}>Grok</button>
        <button className="act primary" onClick={() => void step(1)}>Step ▶</button>
        <button className="act" onClick={() => void step(5)}>Step ×5</button>
      </div>

      <div className="ins-history">
        {rival.history.length === 0 && <span className="hint">No decisions yet — Step to advance {rival.name}'s sim.</span>}
        {rival.history.map((h, i) => (
          <span key={i} className={`ins-hist ${h.source ?? "utility"}`}>{h.chosen}</span>
        ))}
      </div>
    </div>
  );
}
