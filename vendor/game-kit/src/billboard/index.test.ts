import { describe, it, expect } from 'vitest';
import { billboardYaw, billboardYawTo } from './index.js';

const HALF_PI = Math.PI / 2;

describe('billboardYaw — cardinal directions (front axis = +Z)', () => {
  it('camera directly +Z of the object → yaw 0 (front already faces it)', () => {
    expect(billboardYaw([0, 0, 5], [0, 0, 0])).toBeCloseTo(0);
  });

  it('camera at +X of the object → yaw +PI/2', () => {
    expect(billboardYaw([5, 0, 0], [0, 0, 0])).toBeCloseTo(HALF_PI);
  });

  it('camera at -X of the object → yaw -PI/2', () => {
    expect(billboardYaw([-5, 0, 0], [0, 0, 0])).toBeCloseTo(-HALF_PI);
  });

  it('camera directly behind (-Z) → yaw PI', () => {
    expect(Math.abs(billboardYaw([0, 0, -5], [0, 0, 0]))).toBeCloseTo(Math.PI);
  });
});

describe('billboardYaw — Y is ignored (stays upright/grounded)', () => {
  it('same XZ, very different camera height → identical yaw', () => {
    const low = billboardYaw([3, -10, 4], [0, 0, 0]);
    const high = billboardYaw([3, 100, 4], [0, 0, 0]);
    expect(low).toBeCloseTo(high);
  });

  it('object at a different Y than the camera does not affect yaw', () => {
    const a = billboardYaw([2, 5, 2], [0, 0, 0]);
    const b = billboardYaw([2, 5, 2], [0, 50, 0]);
    expect(a).toBeCloseTo(b);
  });

  it('ignores Y even when both camera and object are offset in Y', () => {
    const a = billboardYaw([1, 0, 1], [0, 0, 0]);
    const b = billboardYaw([1, 999, 1], [0, -999, 0]);
    expect(a).toBeCloseTo(b);
  });
});

describe('billboardYaw — diagonal cases with known angles', () => {
  it('camera at (+1, 0, +1) relative → yaw +PI/4', () => {
    expect(billboardYaw([1, 0, 1], [0, 0, 0])).toBeCloseTo(Math.PI / 4);
  });

  it('camera at (-1, 0, +1) relative → yaw -PI/4', () => {
    expect(billboardYaw([-1, 0, 1], [0, 0, 0])).toBeCloseTo(-Math.PI / 4);
  });

  it('camera at (+1, 0, -1) relative → yaw +3*PI/4', () => {
    expect(billboardYaw([1, 0, -1], [0, 0, 0])).toBeCloseTo((3 * Math.PI) / 4);
  });

  it('works correctly with a non-origin object position (translation invariance)', () => {
    const relative = billboardYaw([1, 0, 1], [0, 0, 0]);
    const translated = billboardYaw([11, 7, 21], [10, -3, 20]);
    expect(translated).toBeCloseTo(relative);
  });
});

describe('billboardYaw — determinism', () => {
  it('returns the exact same value for the same inputs across repeated calls', () => {
    const a = billboardYaw([3, 2, -4], [1, 0, 1]);
    const b = billboardYaw([3, 2, -4], [1, 0, 1]);
    const c = billboardYaw([3, 2, -4], [1, 0, 1]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('billboardYawTo — the XZ primitive billboardYaw builds on', () => {
  it('degenerate case (camera exactly at the object XZ) returns 0, not NaN', () => {
    expect(billboardYawTo([2, 3], [2, 3])).toBe(0);
  });

  it('matches billboardYaw when fed the same XZ projections', () => {
    const viaTo = billboardYawTo([0, 0], [4, -4]);
    const viaFull = billboardYaw([4, 99, -4], [0, -50, 0]);
    expect(viaTo).toBeCloseTo(viaFull);
  });
});
