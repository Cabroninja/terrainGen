const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value)));

export function normalizeStructureSettings(input = {}) {
  return {
    mode: ['populate', 'stamp', 'erase'].includes(input.mode) ? input.mode : 'populate',
    brushSize: clamp(input.brushSize || 60, 1, 1024),
    density: clamp(input.density || 100, 5, 200),
    spacing: clamp(input.spacing ?? 4, 0, 128),
    sink: Math.round(clamp(input.sink ?? 1, 0, 32)),
    randomRotation: Boolean(input.randomRotation),
    randomMirror: Boolean(input.randomMirror),
    avoidWater: input.avoidWater !== false,
    avoidRoads: input.avoidRoads !== false,
    avoidReserved: input.avoidReserved !== false,
  };
}

export function estimateStructureCount(settings) {
  const normalized = normalizeStructureSettings(settings);
  if (normalized.mode === 'stamp') return 1;
  if (normalized.mode === 'erase') return 0;
  const radius = normalized.brushSize / 2;
  const area = Math.PI * radius * radius;
  const footprint = Math.max(9, (normalized.spacing + 5) ** 2);
  return Math.max(1, Math.round(area / footprint * normalized.density / 100));
}

export function weightedMember(members, random = Math.random) {
  const valid = (members || []).filter((item) => Number(item.weight) > 0);
  if (!valid.length) return null;
  const total = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  let cursor = random() * total;
  for (const item of valid) {
    cursor -= Number(item.weight);
    if (cursor <= 0) return item;
  }
  return valid[valid.length - 1];
}

export function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x; const dz = end.z - start.z;
  const length2 = dx * dx + dz * dz;
  if (!length2) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / length2));
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}

export function pointInsideRamp(point, ramp) {
  const reach = Number(ramp.width || 1) / 2 + Number(ramp.shoulder_width ?? ramp.shoulderWidth ?? 0) + (ramp.smooth_sides ? Number(ramp.max_side_width || 0) : 0);
  for (let index = 1; index < (ramp.points || []).length; index += 1) {
    if (pointSegmentDistance(point, ramp.points[index - 1], ramp.points[index]) <= reach) return true;
  }
  return false;
}
