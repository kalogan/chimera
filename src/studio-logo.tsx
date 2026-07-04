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
 */
import { useEffect, useRef } from "react";
import { getReducedMotion } from "./quality.js";
import "./studio-logo.css";

const BRAND = "WOVENWILD";
const DURATION_MS = 2900;

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
