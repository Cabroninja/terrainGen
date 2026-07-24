const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeRoadRampSettings(input = {}) {
  const smoothSides = input.smoothSides === true || input.smoothSides === 'true' || input.smoothSides === 'on';
  const followTerrain = input.followTerrain === undefined
    ? true
    : input.followTerrain === true || input.followTerrain === 'true' || input.followTerrain === 'on';
  const shoulderWidth = Math.round(clamp(Number(input.shoulderWidth) || 0, 0, 64));
  const maxSideWidth = Math.round(clamp(Number(input.maxSideWidth) || 24, 1, 128));
  return {
    roadType: input.roadType === 'secondary' ? 'secondary' : 'primary',
    width: Math.round(clamp(Number(input.width) || 7, 1, 64)),
    shoulderWidth,
    slopeRatio: clamp(Number(input.slopeRatio) || 3, 1, 12),
    startLanding: Math.round(clamp(Number(input.startLanding) || 0, 0, 64)),
    endLanding: Math.round(clamp(Number(input.endLanding) || 0, 0, 64)),
    smoothSides,
    sideSlopeRatio: clamp(Number(input.sideSlopeRatio) || 2, 0.5, 8),
    maxSideWidth: Math.max(shoulderWidth, maxSideWidth),
    sideRoundness: Math.round(clamp(input.sideRoundness === undefined ? 65 : Number(input.sideRoundness), 0, 100)),
    followTerrain,
  };
}

export function roadRampPathLength(points = []) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  }
  return length;
}

export function analyzeRoadRamp(points = [], input = {}, sampleHeight = () => 0) {
  const settings = normalizeRoadRampSettings(input);
  if (points.length < 2) return { settings, valid: false, reason: 'Añade al menos dos puntos.', length: roadRampPathLength(points) };
  const length = roadRampPathLength(points);
  const startHeight = Number(sampleHeight(points[0]));
  const endHeight = Number(sampleHeight(points.at(-1)));
  const heightDifference = Math.abs(endHeight - startHeight);
  const availableRun = Math.max(0, length - settings.startLanding - settings.endLanding);
  const requiredRun = heightDifference * settings.slopeRatio;
  const requiredLength = requiredRun + settings.startLanding + settings.endLanding;
  const actualRatio = heightDifference > 1e-6 ? availableRun / heightDifference : Infinity;
  const valid = length > 0 && availableRun + 1e-6 >= requiredRun;
  const estimatedSideWidth = settings.smoothSides
    ? Math.min(settings.maxSideWidth, Math.max(settings.shoulderWidth, heightDifference * settings.sideSlopeRatio))
    : settings.shoulderWidth;
  return {
    settings,
    valid,
    reason: valid ? '' : `Necesita ${requiredLength.toFixed(1)} bloques para una pendiente 1:${settings.slopeRatio}.`,
    length,
    startHeight,
    endHeight,
    heightDifference,
    availableRun,
    requiredRun,
    requiredLength,
    actualRatio,
    estimatedSideWidth,
  };
}
