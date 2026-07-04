import { describe, it, expect } from "vitest";
import { createRng } from "game-kit/prng";
import { creatureFromToken, seedToken } from "game-kit/creature";
import { breed } from "game-kit/breeding";

// The CHIMERA thesis, headless: scout → battle → BREED yields a GENUINELY NEW
// generated creature — a new deterministic token → a new gooberSpec → a visibly
// distinct critter — and breeding is deterministic (same parents + seed → same
// child). This is the anti-sameness proof as testable fact, with zero 3D.

function shapeKey(spec: { plan: string; balls: { s: number; color: number[] }[] }): string {
  return `${spec.plan}|${spec.balls
    .map((b) => `${b.s.toFixed(2)}:${b.color.map((c) => c.toFixed(2)).join(",")}`)
    .join("|")}`;
}

describe("breeding produces a genuinely new creature", () => {
  it("the child differs from BOTH parents (name + body)", () => {
    const a = creatureFromToken(seedToken("ember-01"));
    const b = creatureFromToken(seedToken("brook-02"));
    const result = breed(a, b, createRng(1234));
    const child = creatureFromToken(result.childToken);

    // A new token woven from both parents.
    expect(child.token.parents).toEqual([a.token.id, b.token.id]);
    expect(child.token.generation).toBe(1);
    expect(child.token.id).not.toBe(a.token.id);
    expect(child.token.id).not.toBe(b.token.id);

    // A distinct name and a distinct BODY vs each parent (the visible proof).
    expect(child.name).not.toBe(a.name);
    expect(child.name).not.toBe(b.name);
    const childShape = shapeKey(child.gooberSpec);
    expect(childShape).not.toBe(shapeKey(a.gooberSpec));
    expect(childShape).not.toBe(shapeKey(b.gooberSpec));

    // It also has a distinct voice (the signature audio feature).
    expect(child.crySpec).not.toEqual(a.crySpec);
    expect(child.crySpec).not.toEqual(b.crySpec);
  });

  it("is deterministic: same parents + same seed → the same child", () => {
    const a = creatureFromToken(seedToken("gale-04"));
    const b = creatureFromToken(seedToken("cairn-05"));
    const c1 = creatureFromToken(breed(a, b, createRng(99)).childToken);
    const c2 = creatureFromToken(breed(a, b, createRng(99)).childToken);
    expect(c1).toStrictEqual(c2);
  });

  it("different seeds yield different siblings (breeding has variety)", () => {
    const a = creatureFromToken(seedToken("thistle-03"));
    const b = creatureFromToken(seedToken("gale-04"));
    const siblings = new Set<string>();
    for (let s = 0; s < 20; s++) {
      siblings.add(breed(a, b, createRng(s)).childToken.id);
    }
    expect(siblings.size).toBeGreaterThan(1);
  });

  it("rank-up: breeding climbs the +value and generation", () => {
    const a = creatureFromToken(seedToken("ember-01"));
    const b = creatureFromToken(seedToken("brook-02"));
    const gen1 = breed(a, b, createRng(7)).childToken;
    const c1 = creatureFromToken(gen1);
    const c2 = creatureFromToken(seedToken("thistle-03"));
    const gen2 = breed(c1, c2, createRng(7)).childToken;
    expect(gen2.generation).toBe(2);
    expect(gen2.plus).toBeGreaterThan(gen1.plus);
  });
});
