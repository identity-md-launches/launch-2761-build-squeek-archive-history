// Number, unit and time formatting shared by every panel.

/**
 * Format base units with the asset's decimals, e.g. 479151230077030429592 / 18 -> "479.1512".
 * @param {string | bigint} baseUnits
 * @param {number} decimals
 * @param {number} [maxFraction]
 */
export function formatUnits(baseUnits, decimals, maxFraction = 4) {
  let n = BigInt(baseUnits);
  const negative = n < 0n;
  if (negative) n = -n;
  const scale = 10n ** BigInt(decimals);
  const whole = n / scale;
  let fraction = (n % scale).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  if (whole === 0n && !fraction && n > 0n) return (negative ? '-' : '') + '<0.' + '0'.repeat(Math.max(0, maxFraction - 1)) + '1';
  const wholeText = whole.toLocaleString('en-US');
  return (negative ? '-' : '') + wholeText + (fraction ? '.' + fraction : '');
}

/** @param {string | number | bigint} n */
export function formatInt(n) {
  try {
    return BigInt(n).toLocaleString('en-US');
  } catch {
    return String(n);
  }
}

/**
 * Millimetres to a readable distance.
 * @param {string | number} mm
 */
export function formatMm(mm) {
  const v = Number(mm);
  if (!Number.isFinite(v)) return String(mm);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 3 })} km`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} m`;
  return `${v.toLocaleString('en-US')} mm`;
}

/** @param {string | number} mmPerSecond */
export function formatSpeed(mmPerSecond) {
  const v = Number(mmPerSecond);
  if (!Number.isFinite(v)) return String(mmPerSecond);
  return `${v.toLocaleString('en-US')} mm/s (${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} m/s)`;
}

/**
 * Human age for a number of seconds.
 * @param {number} seconds
 */
export function formatAge(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} days`;
}

/** @param {string} iso */
export function formatUtc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** @param {string} iso */
export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** @param {string} hostUrl */
export function hostOf(hostUrl) {
  try {
    return new URL(hostUrl).host;
  } catch {
    return hostUrl;
  }
}
