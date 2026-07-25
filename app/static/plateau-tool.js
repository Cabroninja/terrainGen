const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

export function normalizePlateauSettings(input = {}) {
  const minHeight = Number(input.minHeight);
  const maxHeight = Number(input.maxHeight);
  const low = Number.isFinite(minHeight) ? minHeight : 0;
  const high = Number.isFinite(maxHeight) && maxHeight > low ? maxHeight : low + 1;
  const targetHeight = clamp(Number(input.targetHeight) || low, low, high);
  const plateauRadius = clamp(Number(input.plateauRadius) || 1, 1, 1024);
  const slopeWidth = clamp(Number(input.slopeWidth) || 0, 0, Math.max(0, 1024 - plateauRadius));
  const slopeEndRadius = plateauRadius + slopeWidth;
  const supportEnabled = Boolean(input.supportEnabled);
  const supportWidth = supportEnabled
    ? clamp(Number(input.supportWidth) || 0, 0, Math.max(0, 1024 - slopeEndRadius))
    : 0;
  const supportHeightPercent = supportEnabled ? clamp(Number(input.supportHeightPercent) || 0, 0, 100) : 0;
  const supportInfluence = supportHeightPercent / 100;
  const radius = slopeEndRadius + supportWidth;
  return {
    minHeight: low,
    maxHeight: high,
    targetHeight,
    plateauRadius,
    slopeWidth,
    slopeEndRadius,
    supportEnabled: supportEnabled && supportWidth > 0 && supportInfluence > 0,
    supportWidth,
    supportHeightPercent,
    supportInfluence,
    radius,
  };
}

export function plateauInfluence(distance, input = {}) {
  const settings = normalizePlateauSettings(input);
  const d = Math.max(0, Number(distance) || 0);
  if (d <= settings.plateauRadius) return 1;

  const slopeEndInfluence = settings.supportEnabled ? settings.supportInfluence : 0;
  if (settings.slopeWidth > 0 && d <= settings.slopeEndRadius) {
    const t = smoothstep((d - settings.plateauRadius) / settings.slopeWidth);
    return 1 + (slopeEndInfluence - 1) * t;
  }

  if (settings.supportEnabled && settings.supportWidth > 0 && d < settings.radius) {
    const t = smoothstep((d - settings.slopeEndRadius) / settings.supportWidth);
    return settings.supportInfluence * (1 - t);
  }

  return 0;
}

export function heightToLayerValue(height, minHeight, maxHeight) {
  const low = Number(minHeight);
  const high = Number(maxHeight);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return 128;
  const normalized = (clamp(Number(height), low, high) - low) / (high - low);
  return clamp(Math.round(normalized * 255), 0, 255);
}

export function layerValueToHeight(value, minHeight, maxHeight) {
  const low = Number(minHeight);
  const high = Number(maxHeight);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return Math.round(low || 0);
  return Math.round(low + clamp(Number(value), 0, 255) / 255 * (high - low));
}


function pointSegmentDistance(point, start, end) {
  const vx = end.x - start.x;
  const vz = end.z - start.z;
  const denominator = vx * vx + vz * vz;
  if (denominator <= 1e-8) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = clamp(((point.x - start.x) * vx + (point.z - start.z) * vz) / denominator, 0, 1);
  return Math.hypot(point.x - (start.x + t * vx), point.z - (start.z + t * vz));
}

export function normalizePlateauObject(input = {}, minHeight = 0, maxHeight = 255) {
  const supportEnabled = Boolean(input.support_enabled ?? input.supportEnabled);
  const rawSupportWidth = clamp(Number(input.support_width ?? input.supportWidth) || 0, 0, 1024);
  const rawSupportHeight = clamp(Number(input.support_height_percent ?? input.supportHeightPercent) || 0, 0, 100);
  const settings = normalizePlateauSettings({
    targetHeight: input.target_height ?? input.targetHeight,
    plateauRadius: input.plateau_radius ?? input.plateauRadius,
    slopeWidth: input.slope_width ?? input.slopeWidth,
    supportEnabled,
    supportWidth: rawSupportWidth,
    supportHeightPercent: rawSupportHeight,
    minHeight,
    maxHeight,
  });
  const points = Array.isArray(input.points)
    ? input.points
      .map((point) => ({ x: Number(point.x), z: Number(point.z) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
    : [];
  const rawBreaks = input.stroke_breaks ?? input.strokeBreaks;
  const strokeBreaks = Array.isArray(rawBreaks)
    ? [...new Set(rawBreaks
      .map((value) => Math.trunc(Number(value)))
      .filter((value) => Number.isInteger(value) && value > 0 && value < points.length))]
      .sort((a, b) => a - b)
    : [];
  return {
    id: String(input.id || ''),
    points,
    stroke_breaks: strokeBreaks,
    target_height: settings.targetHeight,
    plateau_radius: settings.plateauRadius,
    slope_width: settings.slopeWidth,
    support_enabled: supportEnabled,
    support_width: rawSupportWidth,
    support_height_percent: rawSupportHeight,
  };
}

export function plateauObjectStrokes(rawObject, minHeight = 0, maxHeight = 255) {
  const object = normalizePlateauObject(rawObject, minHeight, maxHeight);
  if (!object.points.length) return [];
  const starts = [0, ...object.stroke_breaks];
  const ends = [...object.stroke_breaks, object.points.length];
  return starts
    .map((start, index) => object.points.slice(start, ends[index]))
    .filter((stroke) => stroke.length > 0);
}

function samePlateauSettings(first, second, minHeight, maxHeight) {
  const a = normalizePlateauObject(first, minHeight, maxHeight);
  const b = normalizePlateauObject(second, minHeight, maxHeight);
  const close = (left, right) => Math.abs(Number(left) - Number(right)) <= 1e-6;
  return close(a.target_height, b.target_height)
    && close(a.plateau_radius, b.plateau_radius)
    && close(a.slope_width, b.slope_width)
    && a.support_enabled === b.support_enabled
    && close(a.support_width, b.support_width)
    && close(a.support_height_percent, b.support_height_percent);
}

function sampleStrokeForContact(stroke, maxStep = 0.65) {
  if (!stroke.length) return [];
  const samples = [{ ...stroke[0] }];
  for (let index = 1; index < stroke.length; index += 1) {
    const start = stroke[index - 1];
    const end = stroke[index];
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const steps = Math.max(1, Math.ceil(distance / maxStep));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      samples.push({ x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t });
    }
  }
  return samples;
}

function strokesTouch(firstStrokes, secondStrokes, contactDistance) {
  const cellSize = Math.max(1, contactDistance);
  const buckets = new Map();
  const key = (x, z) => `${x}:${z}`;
  for (const stroke of firstStrokes) {
    for (const point of sampleStrokeForContact(stroke)) {
      const cellX = Math.floor(point.x / cellSize);
      const cellZ = Math.floor(point.z / cellSize);
      const bucketKey = key(cellX, cellZ);
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(point);
    }
  }
  const thresholdSquared = contactDistance * contactDistance;
  for (const stroke of secondStrokes) {
    for (const point of sampleStrokeForContact(stroke)) {
      const cellX = Math.floor(point.x / cellSize);
      const cellZ = Math.floor(point.z / cellSize);
      for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
        for (const candidate of buckets.get(key(cellX + dx, cellZ + dz)) || []) {
          const deltaX = point.x - candidate.x;
          const deltaZ = point.z - candidate.z;
          if (deltaX * deltaX + deltaZ * deltaZ <= thresholdSquared) return true;
        }
      }
    }
  }
  return false;
}

export function plateauObjectsCanMerge(first, second, minHeight = 0, maxHeight = 255) {
  if (!samePlateauSettings(first, second, minHeight, maxHeight)) return false;
  const a = normalizePlateauObject(first, minHeight, maxHeight);
  const b = normalizePlateauObject(second, minHeight, maxHeight);
  const contactDistance = a.plateau_radius + b.plateau_radius + 0.75;
  const firstStrokes = plateauObjectStrokes(a, minHeight, maxHeight);
  const secondStrokes = plateauObjectStrokes(b, minHeight, maxHeight);
  return strokesTouch(firstStrokes, secondStrokes, contactDistance);
}

export function mergePlateauObjects(objects = [], minHeight = 0, maxHeight = 255) {
  const normalized = objects
    .map((object) => normalizePlateauObject(object, minHeight, maxHeight))
    .filter((object) => object.points.length > 0);
  if (!normalized.length) return null;
  const result = { ...normalized[0], points: [], stroke_breaks: [] };
  for (const object of normalized) {
    for (const stroke of plateauObjectStrokes(object, minHeight, maxHeight)) {
      if (result.points.length) result.stroke_breaks.push(result.points.length);
      result.points.push(...stroke.map((point) => ({ ...point })));
    }
  }
  return normalizePlateauObject(result, minHeight, maxHeight);
}

function plateauObjectSettings(object, minHeight, maxHeight) {
  return normalizePlateauSettings({
    targetHeight: object.target_height,
    plateauRadius: object.plateau_radius,
    slopeWidth: object.slope_width,
    supportEnabled: object.support_enabled,
    supportWidth: object.support_width,
    supportHeightPercent: object.support_height_percent,
    minHeight,
    maxHeight,
  });
}

function forEachStrokeSample(points, radius, callback) {
  if (!points.length) return;
  callback(points[0].x, points[0].z);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const steps = Math.max(1, Math.ceil(distance / Math.max(0.7, radius * 0.28)));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      callback(start.x + (end.x - start.x) * t, start.z + (end.z - start.z) * t);
    }
  }
}

export function rasterizePlateauObjects(baseLayer, width, length, objects = [], minHeight = 0, maxHeight = 255) {
  const expected = width * length;
  const source = baseLayer instanceof Uint8Array ? baseLayer : new Uint8Array(baseLayer || []);
  if (source.length !== expected) throw new Error('La capa base de mesetas no coincide con las dimensiones.');
  const output = source.slice();
  for (const rawObject of objects) {
    const object = normalizePlateauObject(rawObject, minHeight, maxHeight);
    if (!object.points.length) continue;
    const settings = plateauObjectSettings(object, minHeight, maxHeight);
    const targetValue = heightToLayerValue(settings.targetHeight, settings.minHeight, settings.maxHeight);
    const influence = new Float32Array(expected);
    const touched = [];
    for (const stroke of plateauObjectStrokes(object, minHeight, maxHeight)) {
      forEachStrokeSample(stroke, settings.radius, (cx, cz) => {
        const x0 = Math.max(0, Math.floor(cx - settings.radius));
        const x1 = Math.min(width - 1, Math.ceil(cx + settings.radius));
        const z0 = Math.max(0, Math.floor(cz - settings.radius));
        const z1 = Math.min(length - 1, Math.ceil(cz + settings.radius));
        for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) {
          const amount = plateauInfluence(Math.hypot(x - cx, z - cz), settings);
          if (amount <= influence[z * width + x] + 1e-6) continue;
          const cell = z * width + x;
          if (influence[cell] <= 0) touched.push(cell);
          influence[cell] = amount;
        }
      });
    }
    for (const cell of touched) {
      const amount = influence[cell];
      output[cell] = clamp(Math.round(output[cell] + (targetValue - output[cell]) * amount), 0, 255);
    }
  }
  return output;
}

export function plateauObjectContainsPoint(rawObject, point, minHeight = 0, maxHeight = 255) {
  const object = normalizePlateauObject(rawObject, minHeight, maxHeight);
  if (!object.points.length) return false;
  const settings = plateauObjectSettings(object, minHeight, maxHeight);
  for (const stroke of plateauObjectStrokes(object, minHeight, maxHeight)) {
    if (stroke.length === 1 && Math.hypot(point.x - stroke[0].x, point.z - stroke[0].z) <= settings.radius) return true;
    for (let index = 1; index < stroke.length; index += 1) {
      if (pointSegmentDistance(point, stroke[index - 1], stroke[index]) <= settings.radius) return true;
    }
  }
  return false;
}
