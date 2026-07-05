/**
 * studio-logo — the WOVENWILD studio ident that plays BEFORE the CHIMERA title.
 *
 * The TIMING, skip affordance, audio cue, reduced-motion fade, and onDone
 * hand-off now come from the shared kit `<StudioIdent>` (game-kit/title/r3f);
 * this file supplies only the BRAND: the wordmark, the tagline, the "new life"
 * chime, and the woven-threads-into-a-goober SVG art (`WovenwildArt`, which
 * self-animates via studio-logo.css keyframes, so it runs even backgrounded).
 *
 * SMILE CHIME: fired via the kit's `onCue` at ~2.4s (see DEFAULT_IDENT_TIMING) —
 * a soft "newborn" twinkle as the goober's face reads as alive. Silent on a
 * stone-cold first load (AudioContext still suspended pre-gesture), which is
 * fine; it plays on any later visit once audio is unlocked.
 */
import { StudioIdent } from "game-kit/title/r3f";
import { audio } from "./audio.js";
import "./studio-logo.css";

// Six thread strands sweeping in from the edges to the goober's center — drawn
// on (stroke-dashoffset) then fading as the goober forms.
const THREADS = [
  "M18,44 Q130,150 200,158",
  "M382,40 Q270,150 200,158",
  "M20,268 Q120,200 200,158",
  "M380,272 Q280,200 200,158",
  "M200,14 Q206,90 200,158",
  "M366,158 Q280,150 200,158",
];

/** The WOVENWILD brand mark: threads weaving into a little goober. Pure SVG +
 *  CSS keyframes (studio-logo.css) — no timing/skip logic (the kit owns that). */
function WovenwildArt() {
  return (
    <svg className="studio-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g className="studio-threads">
        {THREADS.map((d, i) => (
          <path key={i} className="studio-thread" d={d} pathLength={100} style={{ animationDelay: `${i * 0.08}s` }} />
        ))}
      </g>
      <g className="studio-goober">
        <ellipse cx={200} cy={168} rx={62} ry={54} className="studio-body" />
        <circle cx={170} cy={132} r={30} className="studio-body" />
        <circle cx={232} cy={138} r={26} className="studio-body" />
        <circle cx={184} cy={158} r={9} className="studio-eye" />
        <circle cx={218} cy={158} r={9} className="studio-eye" />
        <circle cx={187} cy={155} r={3} className="studio-glint" />
        <circle cx={221} cy={155} r={3} className="studio-glint" />
      </g>
    </svg>
  );
}

export function StudioLogo({ onDone }: { onDone: () => void }) {
  return (
    <StudioIdent
      wordmark="WOVENWILD"
      tagline="games"
      onDone={onDone}
      onCue={() => audio().playNewborn()}
    >
      <WovenwildArt />
    </StudioIdent>
  );
}
