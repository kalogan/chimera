/**
 * studio-logo — the WOVENWILD studio ident that plays BEFORE the CHIMERA splash
 * (the Game-Freak-logo beat). A short, skippable brand moment: a few threads
 * tangle inward and resolve into a little goober, then the "WOVENWILD" wordmark
 * warms in — the studio's weave-wild-creatures motif in one breath.
 *
 * Built as SVG + CSS (no WebGL, no canvas): it loads instantly before anything
 * else warms up, and CSS keyframes keep animating even in a backgrounded tab.
 * The hand-off to the splash is driven by a wall-clock `setTimeout` (not rAF),
 * so it always advances on time; a tap anywhere skips it early.
 *
 * SMILE CUE: a soft, gentle twinkle fires as the goober's eyes appear (the
 * `studioEye` keyframe in studio-logo.css goes 0 -> 1 opacity across 60%-70% of
 * the 2.9s timeline, i.e. ~1.74s-2.03s in) — a tiny "aww" the instant the face
 * reads as alive. Fired once via a guarded wall-clock setTimeout (same reasoning
 * as the finish() hand-off: advances on time even backgrounded). AUTOPLAY
 * CAVEAT: on a stone-cold first load the AudioContext is still suspended (no
 * user gesture has happened yet), so this cue is silent that one time — that's
 * unavoidable and fine; it plays normally on any later visit once audio has
 * been unlocked (e.g. the studio ident replaying after a return to the title).
 */
import { useEffect, useRef } from "react";
import { getReducedMotion } from "./quality.js";
import { audio } from "./audio.js";
import "./studio-logo.css";

const BRAND = "WOVENWILD";
const DURATION_MS = 2900;
/** Matches studio-logo.css's studioEye keyframe (opacity 0->1 over 60%-70% of
 *  the 2.9s timeline) — fire the smile cue right as the eyes become visible. */
const SMILE_CUE_MS = 1850;

// Six thread strands sweeping in from the edges to the goober's center — drawn
// on (stroke-dashoffset) then fading as the goober forms. Slight curves so they
// read as woven filaments, not straight lines.
const THREADS = [
  "M18,44 Q130,150 200,158",
  "M382,40 Q270,150 200,158",
  "M20,268 Q120,200 200,158",
  "M380,272 Q280,200 200,158",
  "M200,14 Q206,90 200,158",
  "M366,158 Q280,150 200,158",
];

export function StudioLogo({ onDone }: { onDone: () => void }) {
  const doneRef = useRef(false);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // Wall-clock hand-off — fires even if the tab is backgrounded (rAF wouldn't).
  useEffect(() => {
    const t = window.setTimeout(finish, DURATION_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The smile cue — a soft twinkle timed to the eyes appearing (see the SMILE
  // CUE note above). Independent timeout from the finish() hand-off above so
  // it never affects the ident's duration or visuals; guarded so it can only
  // ever fire once (StrictMode double-effects, re-renders, etc). Safe no-op if
  // the AudioContext is still suspended (cold first load — see file header).
  const smiledRef = useRef(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (smiledRef.current) return;
      smiledRef.current = true;
      audio().playUi("confirm");
    }, SMILE_CUE_MS);
    return () => window.clearTimeout(t);
  }, []);

  const reduced = getReducedMotion();

  return (
    <div className={`studio-wrap${reduced ? " reduced" : ""}`} onPointerDown={finish}>
      <svg className="studio-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g className="studio-threads">
          {THREADS.map((d, i) => (
            <path key={i} className="studio-thread" d={d} pathLength={100} style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </g>
        <g className="studio-goober">
          {/* body + two bumps → a soft goober silhouette */}
          <ellipse cx={200} cy={168} rx={62} ry={54} className="studio-body" />
          <circle cx={170} cy={132} r={30} className="studio-body" />
          <circle cx={232} cy={138} r={26} className="studio-body" />
          {/* eyes */}
          <circle cx={184} cy={158} r={9} className="studio-eye" />
          <circle cx={218} cy={158} r={9} className="studio-eye" />
          <circle cx={187} cy={155} r={3} className="studio-glint" />
          <circle cx={221} cy={155} r={3} className="studio-glint" />
        </g>
      </svg>
      <div className="studio-brand">
        <div className="studio-wordmark">{BRAND}</div>
        <div className="studio-tag">games</div>
      </div>
      <button
        className="studio-skip"
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
      >
        skip ›
      </button>
    </div>
  );
}
