// Bridge between the kernel's mesh format and three.js.
// Manifold gives us a flat vertProperties array (xyz + extras) and a triVerts
// index array. three.js wants a BufferGeometry. We compute *creased* normals so
// curved facets (cylinders, spheres) stay smooth while hard edges (box corners,
// hole rims) stay crisp — a plain computeVertexNormals() smooths across every
// shared vertex, which bleeds hole-rim slopes across flat faces as shading streaks.

import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export function manifoldToGeometry(manifold) {
  const mesh = manifold.getMesh();
  const { numProp, vertProperties, triVerts } = mesh;

  const geom = new THREE.BufferGeometry();

  // Pull just the xyz out of each vertex (props 0..2). vertProperties is
  // interleaved with numProp stride.
  const vertCount = vertProperties.length / numProp;
  const positions = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = vertProperties[i * numProp];
    positions[i * 3 + 1] = vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = vertProperties[i * numProp + 2];
  }

  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));

  // Split vertices at edges sharper than 30° and smooth the rest. Flat faces
  // keep a single up-normal (no fan-shaped shading streaks on booleaned tops);
  // gentle curves stay smooth. Returns a non-indexed geometry.
  const out = toCreasedNormals(geom, THREE.MathUtils.degToRad(30));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// Wireframe helper for showing edges over the shaded mesh.
export function edgesGeometry(geom, threshold = 25) {
  return new THREE.EdgesGeometry(geom, threshold);
}
