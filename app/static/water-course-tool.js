const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

export function normalizeWaterSettings(input = {}) {
  return {
    mode: input.mode === 'river' ? 'river' : 'mass',
    action: input.action === 'erase' ? 'erase' : 'paint',
    width: Math.round(clamp(input.width, 1, 128)),
    depth: Math.round(clamp(input.depth, 1, 32)),
    shoreWidth: Math.round(clamp(input.shoreWidth, 0, 128)),
    shoreProfile: ['compact', 'natural', 'smooth'].includes(input.shoreProfile) ? input.shoreProfile : 'natural',
    roadPolicy: ['protect', 'ford', 'cut'].includes(input.roadPolicy) ? input.roadPolicy : 'protect',
    smoothing: Math.round(clamp(input.smoothing, 0, 100)),
    exitEnabled: Boolean(input.exitEnabled),
  };
}

function perpendicularDistance(point, start, end) {
  const vx = end.x - start.x; const vz = end.z - start.z;
  const denominator = vx * vx + vz * vz;
  if (denominator <= 1e-8) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * vx + (point.z - start.z) * vz) / denominator));
  return Math.hypot(point.x - (start.x + t * vx), point.z - (start.z + t * vz));
}

function rdp(points, epsilon) {
  if (points.length <= 2) return points.slice();
  let farthest = 0; let index = 0;
  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const distance = perpendicularDistance(points[cursor], points[0], points.at(-1));
    if (distance > farthest) { farthest = distance; index = cursor; }
  }
  if (farthest <= epsilon) return [points[0], points.at(-1)];
  const left = rdp(points.slice(0, index + 1), epsilon);
  const right = rdp(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}

function chaikin(points, passes) {
  let output = points.slice();
  for (let pass = 0; pass < passes && output.length < 512; pass += 1) {
    const next = [output[0]];
    for (let index = 0; index < output.length - 1; index += 1) {
      const a = output[index]; const b = output[index + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(output.at(-1)); output = next;
  }
  return output;
}

export function smoothFreehandCourse(points, smoothing = 60) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const cleaned = [];
  for (const raw of points) {
    const point = { x: Number(raw.x), z: Number(raw.z) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
    const previous = cleaned.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) >= 0.6) cleaned.push(point);
  }
  if (cleaned.length < 2) return [];
  const amount = clamp(smoothing, 0, 100);
  const epsilon = 0.35 + amount / 100 * 1.8;
  let result = rdp(cleaned, epsilon);
  const passes = amount >= 75 ? 2 : amount >= 30 ? 1 : 0;
  result = chaikin(result, passes);
  if (result.length > 512) {
    const step = (result.length - 1) / 511;
    result = Array.from({ length: 512 }, (_, index) => result[Math.min(result.length - 1, Math.round(index * step))]);
  }
  return result;
}

export function courseLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  return length;
}
