// Pure place-op helpers (testable without booting the full app).

/** Reset rotation on solids; leave holes oriented (pin axes etc.). */
export function applyLevel(nodes, indices) {
  let skippedHoles = 0;
  indices.forEach((i) => {
    const n = nodes[i];
    if (!n) return;
    if (n.op === 'hole') { skippedHoles++; return; }
    n.rot = [0, 0, 0];
  });
  return skippedHoles;
}

/** Shift selection up so the lowest point rests on z=0 (build plate). */
export function seatOnPlate(nodes, sel, extentFor) {
  if (!sel?.length) return false;
  const rnd = (v) => Math.round(v * 100) / 100 || 0;
  let groupMinZ = Infinity;
  sel.forEach((i) => {
    const n = nodes[i];
    const ext = extentFor(i);
    if (!n || !ext) return;
    groupMinZ = Math.min(groupMinZ, n.pos[2] + ext.minZ);
  });
  if (groupMinZ === Infinity || Math.abs(groupMinZ) < 0.005) return false;
  const shift = -groupMinZ;
  sel.forEach((i) => { const n = nodes[i]; if (n) n.pos[2] = rnd(n.pos[2] + shift); });
  return true;
}

/** Bounding-box size [x, y, z] and minZ from a { min, max } box. */
export function bboxSize(bb) {
  if (!bb) return null;
  return {
    x: bb.max[0] - bb.min[0],
    y: bb.max[1] - bb.min[1],
    z: bb.max[2] - bb.min[2],
    minZ: bb.min[2],
  };
}

/** Print-readiness check against a cubic build envelope. */
export function printReadyReport(bb, volumeLimit) {
  const s = bboxSize(bb);
  if (!s) return { ok: false, message: 'Nothing to check' };
  const issues = [];
  if (s.minZ > 0.05) issues.push('not on bed');
  if (s.x > volumeLimit || s.y > volumeLimit || s.z > volumeLimit) issues.push('too big for plate');
  const dim = `${s.x.toFixed(0)}×${s.y.toFixed(0)}×${s.z.toFixed(1)} mm`;
  if (issues.length) return { ok: false, message: `⚠ ${issues.join(' · ')} — ${dim}`, size: s };
  return { ok: true, message: `✓ Print ready — ${dim} · on bed`, size: s };
}
