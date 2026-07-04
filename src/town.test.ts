/**
 * town.test — sanity checks for the TOWN data model: the tile map is
 * well-formed, every villager stands on a walkable tile, ids are unique, and
 * `actionForVillager` matches each villager's `opens` field. Pure data/logic
 * checks — no game.ts/App.tsx import (this module is decoupled by design).
 */
import { describe, expect, it } from "vitest";
import {
  TOWN_HEIGHT,
  TOWN_HOME_TILE,
  TOWN_PORTALS,
  TOWN_DORMANT_PADS,
  TOWN_SPAWN,
  TOWN_TILES,
  TOWN_TREE_TILE,
  TOWN_VILLAGERS,
  TOWN_WIDTH,
  actionForVillager,
  dormantPadAt,
  isTownWalkable,
  portalAt,
  villagerById,
} from "./town.js";

describe("town tile map", () => {
  it("has exactly width*height tiles", () => {
    expect(TOWN_TILES.length).toBe(TOWN_WIDTH * TOWN_HEIGHT);
  });

  it("is fully enclosed by walls on the outer ring except the spawn edge", () => {
    for (let x = 0; x < TOWN_WIDTH; x++) {
      expect(TOWN_TILES[x]).toBe("wall"); // top row
      expect(TOWN_TILES[(TOWN_HEIGHT - 1) * TOWN_WIDTH + x]).toBe("wall"); // bottom row
    }
  });

  it("has a walkable spawn tile", () => {
    const [sx, sy] = TOWN_SPAWN;
    expect(isTownWalkable(sx, sy)).toBe(true);
  });

  it("rejects out-of-bounds coordinates", () => {
    expect(isTownWalkable(-1, 0)).toBe(false);
    expect(isTownWalkable(0, -1)).toBe(false);
    expect(isTownWalkable(TOWN_WIDTH, 0)).toBe(false);
    expect(isTownWalkable(0, TOWN_HEIGHT)).toBe(false);
  });
});

describe("town villager roster", () => {
  it("has 5-6 villagers", () => {
    expect(TOWN_VILLAGERS.length).toBeGreaterThanOrEqual(5);
    expect(TOWN_VILLAGERS.length).toBeLessThanOrEqual(6);
  });

  it("has unique ids", () => {
    const ids = TOWN_VILLAGERS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every villager stands on a walkable tile", () => {
    for (const v of TOWN_VILLAGERS) {
      const [x, y] = v.tile;
      expect(isTownWalkable(x, y)).toBe(true);
    }
  });

  it("every villager has a rich persona and 3-5 fallback lines", () => {
    for (const v of TOWN_VILLAGERS) {
      expect(v.persona.length).toBeGreaterThan(40);
      expect(v.fallbackLines.length).toBeGreaterThanOrEqual(3);
      expect(v.fallbackLines.length).toBeLessThanOrEqual(5);
    }
  });

  it("covers each of the expected roles at least once", () => {
    const roles = new Set(TOWN_VILLAGERS.map((v) => v.role));
    for (const role of ["keeper", "shopkeeper", "loremaster", "quartermaster", "questgiver"]) {
      expect(roles.has(role as never)).toBe(true);
    }
  });

  it("villagerById finds a known id and misses an unknown one", () => {
    expect(villagerById("cradle-keeper")?.name).toBe("Mother Wren");
    expect(villagerById("nobody")).toBeUndefined();
  });
});

describe("actionForVillager", () => {
  it("returns an open action for villagers with `opens` set", () => {
    for (const v of TOWN_VILLAGERS) {
      const action = actionForVillager(v);
      if (v.opens) {
        expect(action).toEqual({ kind: "open", target: v.opens });
      } else {
        expect(action).toBeUndefined();
      }
    }
  });
});

describe("TOWN_PORTALS (zone teleporter pads)", () => {
  it("has one pad per zone id, all on walkable tiles", () => {
    const zoneIds = TOWN_PORTALS.map((p) => p.zoneId);
    expect(new Set(zoneIds)).toEqual(new Set(["meadowmere", "emberdeep", "tidewrack"]));
    for (const p of TOWN_PORTALS) {
      const [x, y] = p.tile;
      expect(isTownWalkable(x, y)).toBe(true);
    }
  });

  it("no pad shares a tile with a villager, the spawn, or another pad", () => {
    const occupied = new Set<string>([
      ...TOWN_VILLAGERS.map((v) => v.tile.join(",")),
      TOWN_SPAWN.join(","),
    ]);
    const padTiles = new Set<string>();
    for (const p of TOWN_PORTALS) {
      const key = p.tile.join(",");
      expect(occupied.has(key)).toBe(false);
      expect(padTiles.has(key)).toBe(false);
      padTiles.add(key);
    }
  });

  it("portalAt finds the pad standing on its own tile and misses elsewhere", () => {
    const first = TOWN_PORTALS[0]!;
    expect(portalAt(first.tile[0], first.tile[1])?.zoneId).toBe(first.zoneId);
    expect(portalAt(-1, -1)).toBeUndefined();
  });
});

describe("TOWN_HOME_TILE (the Home building)", () => {
  it("sits on a walkable tile, distinct from any villager, pad, or the spawn", () => {
    const [hx, hy] = TOWN_HOME_TILE;
    expect(isTownWalkable(hx, hy)).toBe(true);
    for (const v of TOWN_VILLAGERS) expect(v.tile).not.toEqual(TOWN_HOME_TILE);
    for (const p of TOWN_PORTALS) expect(p.tile).not.toEqual(TOWN_HOME_TILE);
    expect(TOWN_SPAWN).not.toEqual(TOWN_HOME_TILE);
  });
});

describe("TOWN_TREE_TILE (the Aldercradle)", () => {
  it("sits on a walkable tile, distinct from any villager, pad, Home, or the spawn", () => {
    const [tx, ty] = TOWN_TREE_TILE;
    expect(isTownWalkable(tx, ty)).toBe(true);
    for (const v of TOWN_VILLAGERS) expect(v.tile).not.toEqual(TOWN_TREE_TILE);
    for (const p of TOWN_PORTALS) expect(p.tile).not.toEqual(TOWN_TREE_TILE);
    expect(TOWN_SPAWN).not.toEqual(TOWN_TREE_TILE);
    expect(TOWN_HOME_TILE).not.toEqual(TOWN_TREE_TILE);
  });
});

describe("TOWN_DORMANT_PADS (the 5 roadmap worlds)", () => {
  it("has exactly 5 pads, each on a walkable tile with a unique world id", () => {
    expect(TOWN_DORMANT_PADS.length).toBe(5);
    const ids = TOWN_DORMANT_PADS.map((p) => p.worldId);
    expect(new Set(ids).size).toBe(5);
    for (const p of TOWN_DORMANT_PADS) {
      const [x, y] = p.tile;
      expect(isTownWalkable(x, y)).toBe(true);
    }
  });

  it("no dormant pad collides with a villager, live pad, Home, the tree, or the spawn", () => {
    const occupied = new Set<string>([
      ...TOWN_VILLAGERS.map((v) => v.tile.join(",")),
      ...TOWN_PORTALS.map((p) => p.tile.join(",")),
      TOWN_HOME_TILE.join(","),
      TOWN_TREE_TILE.join(","),
      TOWN_SPAWN.join(","),
    ]);
    const seen = new Set<string>();
    for (const p of TOWN_DORMANT_PADS) {
      const key = p.tile.join(",");
      expect(occupied.has(key)).toBe(false);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("dormantPadAt finds a pad on its own tile and misses elsewhere", () => {
    const first = TOWN_DORMANT_PADS[0]!;
    expect(dormantPadAt(first.tile[0], first.tile[1])?.worldId).toBe(first.worldId);
    expect(dormantPadAt(-1, -1)).toBeUndefined();
  });
});
