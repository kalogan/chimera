/**
 * difficulty-ramp — proof of the Aldercradle progression's difficulty curve:
 * every one of the 8 worlds (worldtree.ts's WORLD_ORDER) resolves to a real
 * zone + a family-correct Guardian, and the roamer/Guardian tiering (zone.ts's
 * tieredRoamerToken/guardianToken — `plus`/`generation` keyed off chain
 * index) is MONOTONIC: a world later in the chain is never easier than one
 * earlier in it. "Easier/harder" is measured via a FAMILY-INDEPENDENT tier
 * scale mirroring the kit's own rank/stat-scaling formula (`tierScale`
 * below), not a raw sum of a creature's 6 stats — different families trade
 * those stats off too differently (a golem's huge HP/DEF vs. tiny AGI/WIS)
 * for a cross-family stat-sum comparison to be a fair monotonicity check.
 * This also proves rank saturating at S partway up the chain doesn't stall
 * the actual difficulty climb (the scale keeps climbing with raw `plus` past
 * that point, exactly like the kit's real stat scaling does).
 *
 * ZoneScene.tsx's per-zone THEME registration is checked separately by
 * inspection (see zone.ts's ZONE_THEMES) rather than imported here — that
 * file pulls in `three`/`@react-three/fiber`, which this headless suite
 * (like every other `.test.ts` in this repo) never loads.
 */
import { describe, it, expect } from "vitest";
import { creatureFromToken, RANKS, type CreatureToken } from "game-kit/creature";
import { WORLD_ORDER, chainIndexOf, worldForZone } from "./worldtree.js";
import { ZONE_IDS, ZONE_LABELS, ZONES, GUARDIAN_TOKEN, GUARDIAN_TITLE, zoneById } from "./zone.js";

/**
 * A FAMILY-INDEPENDENT "how strong is this tier" scalar, mirroring the kit's
 * own `creatureFromToken` -> `rankFor`/`scaleStats` formula
 * (`vendor/game-kit/src/creature/index.ts`): rank index from
 * `floor(plus/5) + min(generation,3)` (clamped 0..6), then
 * `(1 + rankIdx*0.32) * (1 + plus*0.05)`. Deliberately does NOT sum a
 * creature's raw per-stat totals — different families trade stats off very
 * differently (a golem's huge HP/DEF vs. tiny AGI/WIS, a spirit's huge MP/WIS
 * vs. modest HP), so raw stat sums aren't a fair CROSS-family comparison and
 * can dip between two adjacent worlds even though both worlds' `plus`/
 * `generation` inputs climbed correctly. This scalar isolates exactly the
 * ramp's own tunable inputs, independent of which family happens to sit at
 * that chain position.
 */
function tierScale(token: CreatureToken): number {
  const base = 0; // fresh-seed base draw varies 0..3 per token; ignored here —
  // this scalar checks the DELIBERATE plus/generation tiering, not per-token
  // rng jitter, which is why it reproduces rankFor's non-random half exactly.
  const rankIdx = Math.max(0, Math.min(6, base + Math.floor(token.plus / 5) + Math.min(token.generation, 3)));
  return (1 + rankIdx * 0.32) * (1 + token.plus * 0.05);
}

const CHAIN_ZONE_IDS = [
  "meadowmere",
  "skyreach",
  "tidewrack",
  "oozehollow",
  "verdanthush",
  "emberdeep",
  "stonewake",
  "hollowvale",
] as const;

describe("all 8 worlds resolve to a zone + theme + Guardian", () => {
  it("WORLD_ORDER has exactly 8 entries, matching ZONE_IDS 1:1 via worldForZone", () => {
    expect(WORLD_ORDER.length).toBe(8);
    expect(ZONE_IDS.length).toBe(8);
    const worldIdsFromZones = ZONE_IDS.map((id) => worldForZone(id)!.id).sort();
    expect(worldIdsFromZones).toEqual([...WORLD_ORDER].sort());
  });

  it("every ZONE_IDS entry has a matching ZONE_LABELS entry and resolves via zoneById", () => {
    expect(ZONE_IDS.length).toBe(8);
    for (const id of ZONE_IDS) {
      expect(ZONE_LABELS[id]).toBeTruthy();
      expect(zoneById(id).id).toBe(id);
      expect(ZONES[id]).toBeDefined();
    }
  });

  it("every zone has exactly one Guardian token + title, family-correct for its world", () => {
    for (const id of ZONE_IDS) {
      const token = GUARDIAN_TOKEN[id];
      const title = GUARDIAN_TITLE[id];
      expect(token).toBeDefined();
      expect(title).toBeTruthy();
      const world = worldForZone(id)!;
      expect(world).toBeDefined();
      expect(token!.family).toBe(world.family);
    }
  });

  it("worldForZone resolves every zone id back to a world whose own zoneId round-trips", () => {
    for (const id of ZONE_IDS) {
      const world = worldForZone(id)!;
      expect(world.zoneId).toBe(id);
    }
  });
});

describe("chain-tiered Guardian difficulty is monotonic in WORLD_ORDER position", () => {
  it("chainIndexOf assigns every zone's world a distinct 0..7 position", () => {
    const indices = ZONE_IDS.map((id) => chainIndexOf(worldForZone(id)!.id));
    expect(new Set(indices).size).toBe(8);
    for (const idx of indices) expect(idx).toBeGreaterThanOrEqual(0);
  });

  it("Guardian tier scale strictly increases from chain position 0 to 7", () => {
    // Order zone ids by their world's chain index, then assert the Guardian's
    // tier scale (plus/generation -> rankMult*plusMult, family-independent)
    // climbs at every single step — the one formula in zone.ts
    // (guardianPlus/guardianGeneration keyed off chainIndexOf) must produce a
    // strictly increasing curve across all 8 worlds.
    const ordered = [...ZONE_IDS].sort(
      (a, b) => chainIndexOf(worldForZone(a)!.id) - chainIndexOf(worldForZone(b)!.id),
    );
    expect(ordered).toEqual([...CHAIN_ZONE_IDS]);

    const scales = ordered.map((id) => tierScale(GUARDIAN_TOKEN[id]!));
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]!).toBeGreaterThan(scales[i - 1]!);
    }
  });

  it("Guardian raw plus/generation inputs are also non-decreasing across the chain (the tunable knobs themselves)", () => {
    const ordered = [...CHAIN_ZONE_IDS];
    const plusValues = ordered.map((id) => GUARDIAN_TOKEN[id]!.plus);
    const genValues = ordered.map((id) => GUARDIAN_TOKEN[id]!.generation);
    for (let i = 1; i < ordered.length; i++) {
      expect(plusValues[i]!).toBeGreaterThan(plusValues[i - 1]!);
      expect(genValues[i]!).toBeGreaterThanOrEqual(genValues[i - 1]!);
    }
  });

  it("world 0's Guardian (Meadowmere) is a real fight, not a formality — at least rank C", () => {
    const c = creatureFromToken(GUARDIAN_TOKEN.meadowmere!);
    expect(RANKS.indexOf(c.rank)).toBeGreaterThanOrEqual(RANKS.indexOf("C"));
  });

  it("world 7's Guardian (The Hollow Vale) lands at the top rank, S", () => {
    const c = creatureFromToken(GUARDIAN_TOKEN.hollowvale!);
    expect(c.rank).toBe("S");
  });

  it("every zone's roamers are tiered no harder than that zone's own Guardian", () => {
    // Sanity: within a single zone, ordinary roamers should never out-tier
    // the zone's own boss (roamers climb gently, the Guardian is the spike).
    // Compared via `tierScale` (family-independent) since a roamer and its
    // zone's Guardian are usually different families.
    for (const id of ZONE_IDS) {
      const guardianScale = tierScale(GUARDIAN_TOKEN[id]!);
      const zone = zoneById(id);
      for (const roamer of zone.roamers) {
        if (roamer.id === "guardian") continue;
        expect(tierScale(roamer.token)).toBeLessThan(guardianScale);
      }
    }
  });
});
