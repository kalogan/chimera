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
  TOWN_WORLD_PADS,
  TOWN_SPAWN,
  TOWN_TILES,
  TOWN_TREE_TILE,
  TOWN_VILLAGERS,
  TOWN_WIDTH,
  actionForVillager,
  isTownWalkable,
  worldPadAt,
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

describe("TOWN_WORLD_PADS (the unified 8-world pad model)", () => {
  it("has exactly 8 pads — one per world, all on walkable tiles, unique world+zone ids", () => {
    expect(TOWN_WORLD_PADS.length).toBe(8);
    const worldIds = TOWN_WORLD_PADS.map((p) => p.worldId);
    const zoneIds = TOWN_WORLD_PADS.map((p) => p.zoneId);
    expect(new Set(worldIds).size).toBe(8);
    expect(new Set(zoneIds).size).toBe(8);
    expect(new Set(zoneIds)).toEqual(
      new Set([
        "meadowmere",
        "skyreach",
        "tidewrack",
        "oozehollow",
        "verdanthush",
        "emberdeep",
        "stonewake",
        "hollowvale",
      ]),
    );
    for (const p of TOWN_WORLD_PADS) {
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
    for (const p of TOWN_WORLD_PADS) {
      const key = p.tile.join(",");
      expect(occupied.has(key)).toBe(false);
      expect(padTiles.has(key)).toBe(false);
      padTiles.add(key);
    }
  });

  it("worldPadAt finds the pad standing on its own tile and misses elsewhere", () => {
    const first = TOWN_WORLD_PADS[0]!;
    expect(worldPadAt(first.tile[0], first.tile[1])?.worldId).toBe(first.worldId);
    expect(worldPadAt(-1, -1)).toBeUndefined();
  });
});

describe("TOWN_HOME_TILE (the Home building)", () => {
  it("sits on a walkable tile, distinct from any villager, pad, or the spawn", () => {
    const [hx, hy] = TOWN_HOME_TILE;
    expect(isTownWalkable(hx, hy)).toBe(true);
    for (const v of TOWN_VILLAGERS) expect(v.tile).not.toEqual(TOWN_HOME_TILE);
    for (const p of TOWN_WORLD_PADS) expect(p.tile).not.toEqual(TOWN_HOME_TILE);
    expect(TOWN_SPAWN).not.toEqual(TOWN_HOME_TILE);
  });
});

describe("TOWN_TREE_TILE (the Aldercradle)", () => {
  it("sits on a walkable tile, distinct from any villager, pad, Home, or the spawn", () => {
    const [tx, ty] = TOWN_TREE_TILE;
    expect(isTownWalkable(tx, ty)).toBe(true);
    for (const v of TOWN_VILLAGERS) expect(v.tile).not.toEqual(TOWN_TREE_TILE);
    for (const p of TOWN_WORLD_PADS) expect(p.tile).not.toEqual(TOWN_TREE_TILE);
    expect(TOWN_SPAWN).not.toEqual(TOWN_TREE_TILE);
    expect(TOWN_HOME_TILE).not.toEqual(TOWN_TREE_TILE);
  });
});
