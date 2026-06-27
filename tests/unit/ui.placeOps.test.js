import { describe, it, expect } from 'vitest';
import { applyLevel, printReadyReport, seatOnPlate } from '../../src/ui/placeOps.js';

describe('applyLevel', () => {
  it('resets solid rotation but skips holes', () => {
    const nodes = [
      { op: 'solid', rot: [45, 0, 0] },
      { op: 'hole', rot: [90, 0, 0] },
    ];
    const skipped = applyLevel(nodes, [0, 1]);
    expect(nodes[0].rot).toEqual([0, 0, 0]);
    expect(nodes[1].rot).toEqual([90, 0, 0]);
    expect(skipped).toBe(1);
  });
});

describe('seatOnPlate', () => {
  it('shifts nodes up so the lowest extent rests on z=0', () => {
    const nodes = [{ pos: [0, 0, 10] }, { pos: [5, 0, 8] }];
    const extents = { 0: { minZ: -4, maxZ: 4 }, 1: { minZ: -2, maxZ: 2 } };
    expect(seatOnPlate(nodes, [0, 1], (i) => extents[i])).toBe(true);
    expect(nodes[0].pos[2]).toBe(4);
    expect(nodes[1].pos[2]).toBe(2);
  });

  it('returns false when already seated', () => {
    const nodes = [{ pos: [0, 0, 4] }];
    expect(seatOnPlate(nodes, [0], () => ({ minZ: -4, maxZ: 4 }))).toBe(false);
    expect(nodes[0].pos[2]).toBe(4);
  });
});

describe('printReadyReport', () => {
  it('passes when on bed and within volume', () => {
    const r = printReadyReport({ min: [-40, -50, 0], max: [40, 50, 8] }, 180);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Print ready');
  });

  it('flags models floating above the bed', () => {
    const r = printReadyReport({ min: [0, 0, 5], max: [10, 10, 15] }, 180);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not on bed');
  });

  it('flags oversize models', () => {
    const r = printReadyReport({ min: [0, 0, 0], max: [200, 50, 10] }, 180);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('too big');
  });
});
