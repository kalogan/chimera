import { createAudioManager, type AudioManager } from "game-kit/audio";
import { createSpatialAudio, type SpatialAudio } from "game-kit/spatial-audio";

// One shared procedural-audio rig for the whole game. ALL sound is synthesized
// (WebAudio) — no asset files, no samples, zero spend. The manager is a no-op
// until resume() runs on a user gesture (browser autoplay policy), so calls before
// that are safe. SpatialAudio adds cries + moment cues + buses over it.

let _mgr: AudioManager | null = null;
let _sa: SpatialAudio | null = null;

function ensure(): { mgr: AudioManager; sa: SpatialAudio } {
  if (!_mgr || !_sa) {
    _mgr = createAudioManager({ channels: ["master", "music", "sfx", "cries"] });
    _sa = createSpatialAudio(_mgr);
  }
  return { mgr: _mgr, sa: _sa };
}

/** The shared SpatialAudio rig (cries, moments, buses). */
export function audio(): SpatialAudio {
  return ensure().sa;
}

/** Unlock the AudioContext — call on the first user gesture (click/tap). Idempotent. */
export async function resumeAudio(): Promise<void> {
  try {
    await ensure().mgr.resume();
  } catch {
    // No AudioContext (headless / blocked) — degrade silently.
  }
}
