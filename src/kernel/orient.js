// Pick the print orientation that needs the least support. Score the six
// axis-aligned face-down candidates by overhang area (tie-broken by bed contact,
// then height) on the model's mesh. Pure geometry — no kernel handle, no UI
// state — so the controller just feeds in a mesh and applies the result.
// Candidates are single-axis, so the score is independent of Euler order.

const D = Math.PI / 180;

function rotateVert(p, rx, ry, rz) {
  let [x, y, z] = p, c, s, t;
  c = Math.cos(rx * D); s = Math.sin(rx * D); t = y; y = c * t - s * z; z = s * t + c * z;
  c = Math.cos(ry * D); s = Math.sin(ry * D); t = x; x = c * t + s * z; z = -s * t + c * z;
  c = Math.cos(rz * D); s = Math.sin(rz * D); t = x; x = c * t - s * y; y = s * t + c * y;
  return [x, y, z];
}

const CANDIDATES = [[0, 0, 0], [90, 0, 0], [-90, 0, 0], [180, 0, 0], [0, 90, 0], [0, -90, 0]];

// mesh: a manifold getMesh() result — { vertProperties, triVerts, numProp }.
// Returns { rotation: [x, y, z] (deg), overhang, baseOverhang } for the best
// candidate (baseOverhang = the unrotated overhang, for reporting the gain), or
// null for an empty mesh.
export function scoreOrientations(mesh) {
  const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp;
  const nVert = vp.length / np;
  const metrics = (R) => {
    // pass 1: rotate the verts, find the bed level (min Z)
    const rv = new Array(nVert);
    let minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < nVert; k++) {
      const o = k * np;
      const p = rotateVert([vp[o], vp[o + 1], vp[o + 2]], R[0], R[1], R[2]);
      rv[k] = p;
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }
    // pass 2: a downward face is overhang only if it's ELEVATED above the bed;
    // downward faces sitting on the plate are bed contact, not overhang.
    const bedEps = 0.5;
    let overhang = 0, bed = 0;
    for (let i = 0; i < tv.length; i += 3) {
      const p0 = rv[tv[i]], p1 = rv[tv[i + 1]], p2 = rv[tv[i + 2]];
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      const area = len / 2, down = -nz / len;
      const elevated = Math.min(p0[2], p1[2], p2[2]) > minZ + bedEps;
      if (!elevated && down > 0.985) bed += area;            // resting on the plate
      else if (elevated && down > 0.7) overhang += area;     // steep floating overhang
      else if (elevated && down > 0.5) overhang += area * 0.4;
    }
    return { overhang, bed, height: maxZ - minZ };
  };

  let best = null, bestScore = Infinity, baseOverhang = 0;
  for (const R of CANDIDATES) {
    const m = metrics(R);
    if (!R[0] && !R[1] && !R[2]) baseOverhang = m.overhang;
    const score = m.overhang - m.bed * 0.1 + m.height * 0.02;
    if (score < bestScore - 1e-6) { bestScore = score; best = { R, m }; }
  }
  return best ? { rotation: best.R.slice(), overhang: best.m.overhang, baseOverhang } : null;
}
