import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { setupKernel } from './_kernel.js';
import { box, sphere, cylinder, difference } from '../../src/kernel/manifold.js';
import { manifoldToGeometry, edgesGeometry } from '../../src/kernel/mesh.js';

// Covers the bridge from the kernel's mesh format into three.js BufferGeometry,
// plus the wireframe edge helper.
describe('manifoldToGeometry', () => {
  beforeAll(async () => {
    await setupKernel();
  }, 60000);

  it('returns a non-indexed BufferGeometry with positions and creased normals', () => {
    const m = box(10, 20, 30, true);
    const expectedTris = m.numTri();

    const geom = manifoldToGeometry(m);
    expect(geom).toBeInstanceOf(THREE.BufferGeometry);

    // Creasing splits vertices at hard edges, so the result is non-indexed:
    // three unique vertices per triangle.
    expect(geom.getIndex()).toBeNull();
    const pos = geom.getAttribute('position');
    expect(pos).toBeTruthy();
    expect(pos.itemSize).toBe(3);
    expect(pos.count).toBe(expectedTris * 3);

    // Normals exist and match the (split) vertex count.
    const normal = geom.getAttribute('normal');
    expect(normal).toBeTruthy();
    expect(normal.itemSize).toBe(3);
    expect(normal.count).toBe(pos.count);

    m.delete();
  });

  it('works for a curved solid and produces a finite bounding box', () => {
    const m = sphere(8);
    const expectedTris = m.numTri();

    const geom = manifoldToGeometry(m);
    expect(geom.getIndex()).toBeNull(); // non-indexed after creasing
    expect(geom.getAttribute('position').count).toBe(expectedTris * 3);

    // The bridge computes bounds; they should be present and finite.
    expect(geom.boundingBox).toBeTruthy();
    expect(Number.isFinite(geom.boundingBox.min.x)).toBe(true);
    expect(Number.isFinite(geom.boundingBox.max.x)).toBe(true);
    expect(geom.boundingSphere).toBeTruthy();
    expect(geom.boundingSphere.radius).toBeGreaterThan(0);

    m.delete();
  });

  it('keeps flat faces flat: a cut top face does not inherit the hole-rim slope', () => {
    // A slab with a through-hole: the top face is retriangulated around the
    // hole. With smooth normals the rim-adjacent top triangles tilt — the fan
    // of shading streaks seen in the result view. Creased normals keep every
    // top-face vertex pointing straight up.
    const slab = box(40, 20, 4, true);
    const hole = cylinder(20, 3, 48, true); // through the slab
    const cut = difference([slab, hole]);
    const geom = manifoldToGeometry(cut);

    const pos = geom.getAttribute('position').array;
    const nor = geom.getAttribute('normal').array;
    const topZ = geom.boundingBox.max.z;
    let topTris = 0;
    let tiltedTopVerts = 0;
    for (let t = 0; t < pos.length; t += 9) {
      // A triangle = 3 verts (9 floats). Pure top-face triangle?
      const onTop = [0, 3, 6].every((o) => Math.abs(pos[t + o + 2] - topZ) < 1e-3);
      if (!onTop) continue;
      topTris++;
      for (const o of [0, 3, 6]) {
        if (nor[t + o + 2] < 0.999) tiltedTopVerts++; // not straight up -> bled
      }
    }
    expect(topTris).toBeGreaterThan(0);
    expect(tiltedTopVerts).toBe(0);

    cut.delete();
  });
});

describe('edgesGeometry', () => {
  beforeAll(async () => {
    await setupKernel();
  }, 60000);

  it('returns an EdgesGeometry with a position attribute', () => {
    const m = box(10, 20, 30, true);
    const geom = manifoldToGeometry(m);

    const edges = edgesGeometry(geom);
    expect(edges).toBeInstanceOf(THREE.EdgesGeometry);

    const pos = edges.getAttribute('position');
    expect(pos).toBeTruthy();
    expect(pos.itemSize).toBe(3);
    expect(pos.array.length % 3).toBe(0);
    // A box has hard edges, so the wireframe must contain some segments.
    expect(pos.count).toBeGreaterThan(0);

    m.delete();
  });
});
