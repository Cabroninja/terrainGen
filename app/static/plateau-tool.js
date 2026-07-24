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
