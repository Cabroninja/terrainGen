const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeElevationProfile(input = {}) {
  const coreRadius = clamp(Number(input.coreRadius) || 0, 0, 1024);
  const slopeWidth = clamp(Number(input.slopeWidth) || 0, 0, Math.max(0, 1024 - coreRadius));
  const baseEnabled = Boolean(input.baseEnabled);
  const baseWidth = baseEnabled ? clamp(Number(input.baseWidth) || 0, 0, Math.max(0, 1024 - coreRadius - slopeWidth)) : 0;
  const baseIntensity = baseEnabled ? clamp(Number(input.baseIntensity) / 100 || 0, 0, 1) : 0;
  const profile = ['linear', 'smooth', 'terraced'].includes(input.profile) ? input.profile : 'smooth';
  const terraceSteps = clamp(Math.round(Number(input.terraceSteps) || 6), 2, 32);
  const radius = coreRadius + slopeWidth + baseWidth;
  return { coreRadius, slopeWidth, baseEnabled, baseWidth, baseIntensity, profile, terraceSteps, radius };
}

function curve(t, profile) {
  const value = clamp(t, 0, 1);
  if (profile === 'smooth' || profile === 'terraced') return value * value * (3 - 2 * value);
  return value;
}

function terrace(value, steps) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Math.ceil(value * steps - 1e-9) / steps;
}

export function elevationProfileInfluence(distance, input = {}) {
  const settings = normalizeElevationProfile(input);
  const d = Math.max(0, Number(distance) || 0);
  if (d <= settings.coreRadius) return 1;
  if (d > settings.radius || settings.radius <= 0) return 0;

  let influence = 0;
  const slopeEnd = settings.coreRadius + settings.slopeWidth;
  const slopeTarget = settings.baseEnabled ? settings.baseIntensity : 0;

  if (settings.slopeWidth > 0 && d <= slopeEnd) {
    const t = curve((d - settings.coreRadius) / settings.slopeWidth, settings.profile);
    influence = 1 + (slopeTarget - 1) * t;
  } else if (settings.baseEnabled && settings.baseWidth > 0 && d <= settings.radius) {
    const t = curve((d - slopeEnd) / settings.baseWidth, settings.profile);
    influence = settings.baseIntensity * (1 - t);
  }

  if (settings.profile === 'terraced') influence = terrace(influence, settings.terraceSteps);
  return clamp(influence, 0, 1);
}
