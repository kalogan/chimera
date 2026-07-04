/**
 * zone-registry — proof of the Wave 5 world map: the zone registry resolves
 * every id, each zone's portals form a connected travel graph (meadowmere <->
 * emberdeep <-> tidewrack, each also reachable back to the Sanctuary), and
 * `enterZone`/`travelPortal` actually walk that graph at the game.ts layer.
 * Also pins the rival-battle balance fix: both rivals field a full 3-creature
 * starting party rather than the old 1v3/2v3 opener.
 */
import { describe, it, expect } from "vitest";
import { ZONES, ZONE_IDS, zoneById, SANCTUARY_TARGET } from "./zone.js";
import { newGame, enterZone, travelPortal } from "./game.js";

describe("zone registry", () => {
  it("resolves every declared zone id to a descriptor with a matching id", () => {
    for (const id of ZONE_IDS) {
      const z = zoneById(id);
      expect(z.id).toBe(id);
      expect(ZONES[id]).toBe(z);
    }
  });

  it("falls back to Meadowmere for an unknown zone id", () => {
    expect(zoneById("nowhere").id).toBe("meadowmere");
  });

  it("every zone has at least one portal to the Sanctuary and one to another zone", () => {
    for (const id of ZONE_IDS) {
      const z = zoneById(id);
      const toSanctuary = z.portals.some((p) => p.to === SANCTUARY_TARGET);
      const toAnotherZone = z.portals.some((p) => p.to !== SANCTUARY_TARGET && ZONES[p.to]);
      expect(toSanctuary).toBe(true);
      expect(toAnotherZone).toBe(true);
    }
  });

  it("the travel graph connects every zone to every other zone (directly or via one hop)", () => {
    const reachableFrom = (start: string): Set<string> => {
      const seen = new Set<string>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const p of zoneById(cur).portals) {
          if (p.to !== SANCTUARY_TARGET && !seen.has(p.to)) {
            seen.add(p.to);
            queue.push(p.to);
          }
        }
      }
      return seen;
    };
    for (const id of ZONE_IDS) {
      const reachable = reachableFrom(id);
      for (const other of ZONE_IDS) expect(reachable.has(other)).toBe(true);
    }
  });
});

describe("enterZone / travelPortal (game.ts glue)", () => {
  it("enterZone defaults to Meadowmere and unlocks it", () => {
    const g = enterZone(newGame());
    expect(g.zone?.descriptor.id).toBe("meadowmere");
    expect(g.unlockedZones).toContain("meadowmere");
  });

  it("enterZone(g, zoneId) travels directly into a named zone and unlocks it", () => {
    const g = enterZone(newGame(), "emberdeep");
    expect(g.screen).toBe("zone");
    expect(g.zone?.descriptor.id).toBe("emberdeep");
    expect(g.unlockedZones).toContain("emberdeep");
  });

  it("travelPortal('sanctuary') leaves the overworld back to the Sanctuary", () => {
    const inZone = enterZone(newGame(), "meadowmere");
    const back = travelPortal(inZone, SANCTUARY_TARGET);
    expect(back.screen).toBe("party");
    expect(back.zone).toBeNull();
  });

  it("travelPortal(<zone id>) travels onward, staying in the zone screen", () => {
    const inZone = enterZone(newGame(), "meadowmere");
    const there = travelPortal(inZone, "emberdeep");
    expect(there.screen).toBe("zone");
    expect(there.zone?.descriptor.id).toBe("emberdeep");
  });

  it("travelPortal falls back to the Sanctuary for an unknown target", () => {
    const inZone = enterZone(newGame(), "meadowmere");
    const back = travelPortal(inZone, "nowhere");
    expect(back.screen).toBe("party");
    expect(back.zone).toBeNull();
  });
});

describe("rival balance fix — starting parties are ~3v3, not 1v3", () => {
  it("both rivals start with 3 starters (party length 3, not 1 or 2)", () => {
    const g = newGame();
    for (const p of g.rivals) {
      expect(p.rival.roster.party.length).toBe(3);
    }
  });
});
