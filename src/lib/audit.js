// "Is the work real?" — arithmetic checks on /v1/status samples.
// Every row returns the numbers it judged, never a bare colour.

/**
 * @typedef {object} Sample
 * @property {number} fetchedAt      ms epoch when the poll returned
 * @property {number} observedAt     ms epoch of measurement.observedAt
 * @property {number} staleAfterSeconds
 * @property {string} counterEpoch
 * @property {number} work           measurement.cumulativeWorkUnits
 * @property {number} distanceMm     measurement.distanceMm
 * @property {number} rpmMilli       measurement.rpmMilli
 * @property {number} speed          measurement.speedMmPerSecond (not measurement.speed)
 * @property {{kind?: string, algorithm?: string, keySlot?: string, lastVerifiedAt?: string} | null} signer
 */

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} title
 * @property {'pass' | 'check' | 'fail' | 'waiting' | 'note'} verdict
 * @property {string} label
 * @property {string} detail
 */

export const DEFAULT_CIRCUMFERENCE_MM = 471;
export const WHOLE_NUMBER_TOLERANCE = 0.1;
export const DISTANCE_MARGIN = 0.25;

const n0 = (/** @type {number} */ v, digits = 0) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Turn one /v1/status body into a sample. Throws when a required field is missing.
 * @param {any} status
 * @param {number} fetchedAt
 * @returns {Sample}
 */
export function toSample(status, fetchedAt) {
  const m = status && status.measurement;
  if (!m) throw new Error('Status has no measurement block');
  const speed = Number(m.speedMmPerSecond);
  const sample = {
    fetchedAt,
    observedAt: Date.parse(m.observedAt),
    staleAfterSeconds: Number(m.staleAfterSeconds),
    counterEpoch: String(m.counterEpoch ?? ''),
    work: Number(m.cumulativeWorkUnits),
    distanceMm: Number(m.distanceMm),
    rpmMilli: Number(m.rpmMilli),
    speed,
    signer: status.signer || null,
  };
  for (const key of /** @type {const} */ (['observedAt', 'work', 'distanceMm', 'rpmMilli', 'speed'])) {
    if (!Number.isFinite(sample[key])) throw new Error(`measurement field for ${key} is not a number`);
  }
  return sample;
}

/**
 * Sensor freshness: age of measurement.observedAt against staleAfterSeconds.
 * @param {Sample} s
 * @param {number} now
 * @returns {Row}
 */
export function freshnessRow(s, now) {
  const age = (now - s.observedAt) / 1000;
  const ok = age <= s.staleAfterSeconds;
  return {
    id: 'freshness',
    title: 'Sensor freshness',
    verdict: ok ? 'pass' : 'check',
    label: ok ? 'Fresh' : 'Stale',
    detail: `Last reading is ${n0(age, 0)} s old; the feed calls it stale after ${n0(s.staleAfterSeconds)} s.`,
  };
}

/**
 * Attestation: who signs the readings and how recently the signature verified.
 * @param {Sample} s
 * @param {number} now
 * @returns {Row}
 */
export function attestationRow(s, now) {
  const signer = s.signer;
  if (!signer || !signer.lastVerifiedAt) {
    return {
      id: 'attestation',
      title: 'Attestation',
      verdict: 'check',
      label: 'Unsigned',
      detail: 'The status response names no signer or no lastVerifiedAt time.',
    };
  }
  const age = (now - Date.parse(signer.lastVerifiedAt)) / 1000;
  const ok = Number.isFinite(age) && age <= s.staleAfterSeconds;
  return {
    id: 'attestation',
    title: 'Attestation',
    verdict: ok ? 'pass' : 'check',
    label: ok ? 'Verified' : 'Old',
    detail: `Signed by ${signer.kind ?? 'unknown'} using ${signer.algorithm ?? 'unknown'}, key slot ${signer.keySlot ?? 'unknown'}; last verified ${n0(age)} s ago (limit ${n0(s.staleAfterSeconds)} s).`,
  };
}

/**
 * Lifetime work per revolution = cumulativeWorkUnits / (distanceMm / circumference).
 * @param {Sample} s
 * @param {number} circumferenceMm
 */
export function workPerRevolution(s, circumferenceMm) {
  const revolutions = s.distanceMm / circumferenceMm;
  const perRev = revolutions > 0 ? s.work / revolutions : NaN;
  const magnets = Math.round(perRev);
  const deviation = Math.abs(perRev - magnets);
  return { revolutions, perRev, magnets, deviation };
}

/**
 * @param {Sample} s
 * @param {number} circumferenceMm
 * @returns {Row}
 */
export function workPerRevolutionRow(s, circumferenceMm) {
  const { revolutions, perRev, magnets, deviation } = workPerRevolution(s, circumferenceMm);
  if (!(circumferenceMm > 0) || !Number.isFinite(perRev)) {
    return {
      id: 'per-rev',
      title: 'Lifetime work per revolution',
      verdict: 'waiting',
      label: 'Waiting',
      detail: 'Needs a positive rim circumference and a distance above zero.',
    };
  }
  const ok = magnets >= 1 && deviation <= WHOLE_NUMBER_TOLERANCE;
  return {
    id: 'per-rev',
    title: 'Lifetime work per revolution',
    verdict: ok ? 'pass' : 'check',
    label: ok ? 'CONSISTENT' : 'DRIFTING',
    detail: `${n0(s.work)} work ÷ (${n0(s.distanceMm)} mm ÷ ${n0(circumferenceMm, circumferenceMm % 1 ? 1 : 0)} mm = ${n0(revolutions, 1)} revolutions) = ${n0(perRev, 3)} per revolution. That implies ${magnets} magnet${magnets === 1 ? '' : 's'} per revolution, ${n0(deviation, 3)} from a whole number (limit ${WHOLE_NUMBER_TOLERANCE}).`,
  };
}

/**
 * @typedef {object} Pair
 * @property {Sample} a
 * @property {Sample} b
 * @property {boolean} discarded  counterEpoch changed: hardware counter restarted
 * @property {number} dt          seconds between observations
 * @property {number} dDistance
 * @property {number} dWork
 * @property {boolean} idle       rpmMilli is zero in both samples
 * @property {number} bound       max distance the speeds allow
 */

/**
 * @param {Sample[]} samples
 * @param {number} circumferenceMm
 * @returns {Pair[]}
 */
export function pairs(samples, circumferenceMm) {
  /** @type {Pair[]} */
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dt = (b.observedAt - a.observedAt) / 1000;
    out.push({
      a,
      b,
      discarded: a.counterEpoch !== b.counterEpoch,
      dt,
      dDistance: b.distanceMm - a.distanceMm,
      dWork: b.work - a.work,
      idle: a.rpmMilli === 0 && b.rpmMilli === 0,
      bound: Math.max(a.speed, b.speed) * Math.max(0, dt) * (1 + DISTANCE_MARGIN) + circumferenceMm,
    });
  }
  return out;
}

const signed = (/** @type {number} */ v) => (v >= 0 ? '+' : '−') + n0(Math.abs(v));

/**
 * The four delta rules plus the counter-restart note.
 * @param {Sample[]} samples
 * @param {number} circumferenceMm
 * @returns {Row[]}
 */
export function deltaRows(samples, circumferenceMm) {
  const all = pairs(samples, circumferenceMm);
  const judged = all.filter((p) => !p.discarded);
  const restarts = all.filter((p) => p.discarded);

  /**
   * @param {string} id
   * @param {string} title
   * @param {(p: Pair) => boolean} fails
   * @param {(p: Pair) => string} describe
   * @param {(p: Pair) => boolean} [applies]
   * @returns {Row}
   */
  const rule = (id, title, fails, describe, applies = () => true) => {
    const relevant = judged.filter(applies);
    if (!judged.length) {
      return { id, title, verdict: 'waiting', label: 'Waiting', detail: 'Needs two samples from the same counter epoch; a new one arrives every 15 s.' };
    }
    const failed = relevant.filter(fails);
    const shown = failed.length ? failed[failed.length - 1] : relevant[relevant.length - 1];
    const tally = `${relevant.length - failed.length} of ${relevant.length} sample pair${relevant.length === 1 ? '' : 's'} passed.`;
    if (!shown) {
      return { id, title, verdict: 'pass', label: 'Pass', detail: `Not triggered yet: no pair had the wheel at 0 rpm in both samples. ${judged.length} pair${judged.length === 1 ? '' : 's'} judged.` };
    }
    return {
      id,
      title,
      verdict: failed.length ? 'fail' : 'pass',
      label: failed.length ? 'Fail' : 'Pass',
      detail: `${failed.length ? 'Failing' : 'Latest'} pair: ${describe(shown)} ${tally}`,
    };
  };

  /** @type {Row[]} */
  const rows = [
    rule(
      'distance-monotonic',
      'Distance never decreases',
      (p) => p.dDistance < 0,
      (p) => `${n0(p.a.distanceMm)} → ${n0(p.b.distanceMm)} mm (${signed(p.dDistance)} mm) over ${n0(p.dt, 1)} s.`,
    ),
    rule(
      'work-monotonic',
      'Cumulative work never decreases',
      (p) => p.dWork < 0,
      (p) => `${n0(p.a.work)} → ${n0(p.b.work)} work (${signed(p.dWork)}) over ${n0(p.dt, 1)} s.`,
    ),
    rule(
      'idle-work',
      'No work while the wheel is still',
      (p) => p.dWork > 0,
      (p) => `rpmMilli ${n0(p.a.rpmMilli)} and ${n0(p.b.rpmMilli)}, work ${signed(p.dWork)}.`,
      (p) => p.idle,
    ),
    rule(
      'distance-bound',
      'Distance fits the reported speed',
      (p) => p.dDistance > p.bound,
      (p) =>
        `${signed(p.dDistance)} mm added; limit max(${n0(p.a.speed)}, ${n0(p.b.speed)}) mm/s × ${n0(p.dt, 1)} s × 1.25 + ${n0(circumferenceMm)} mm = ${n0(p.bound)} mm.`,
    ),
  ];

  rows.push(
    restarts.length
      ? {
          id: 'epoch',
          title: 'Hardware counter restarts',
          verdict: 'note',
          label: 'Restart',
          detail: `counterEpoch changed ${restarts.length} time${restarts.length === 1 ? '' : 's'} (latest ${restarts[restarts.length - 1].a.counterEpoch.slice(0, 8)} → ${restarts[restarts.length - 1].b.counterEpoch.slice(0, 8)}). Those ${restarts.length === 1 ? 'delta was' : 'deltas were'} discarded, not counted.`,
        }
      : {
          id: 'epoch',
          title: 'Hardware counter restarts',
          verdict: samples.length > 1 ? 'pass' : 'waiting',
          label: samples.length > 1 ? 'None' : 'Waiting',
          detail: samples.length
            ? `counterEpoch ${samples[samples.length - 1].counterEpoch.slice(0, 8)} held across ${samples.length} sample${samples.length === 1 ? '' : 's'}; no delta discarded.`
            : 'No samples yet.',
        },
  );
  return rows;
}

/**
 * All rows for the latest state.
 * @param {Sample[]} samples
 * @param {number} now
 * @param {number} circumferenceMm
 * @returns {Row[]}
 */
export function auditRows(samples, now, circumferenceMm) {
  const latest = samples[samples.length - 1];
  if (!latest) return [];
  return [
    freshnessRow(latest, now),
    attestationRow(latest, now),
    workPerRevolutionRow(latest, circumferenceMm),
    ...deltaRows(samples, circumferenceMm),
  ];
}

/**
 * One word for the header ribbon.
 * @param {Row[]} rows
 * @returns {'CONSISTENT' | 'CHECK' | 'IMPLAUSIBLE' | null}
 */
export function summarise(rows) {
  if (!rows.length) return null;
  if (rows.some((r) => r.verdict === 'fail')) return 'IMPLAUSIBLE';
  if (rows.some((r) => r.verdict === 'check')) return 'CHECK';
  return 'CONSISTENT';
}

/**
 * Add a polled sample. A repeat of the same observation only refreshes fetchedAt,
 * so pairs compare distinct readings.
 * @param {Sample[]} samples
 * @param {Sample} sample
 * @param {number} [max]
 */
export function addSample(samples, sample, max = 500) {
  const last = samples[samples.length - 1];
  if (last && last.observedAt === sample.observedAt && last.counterEpoch === sample.counterEpoch) {
    samples[samples.length - 1] = { ...sample };
    return false;
  }
  samples.push(sample);
  if (samples.length > max) samples.splice(0, samples.length - max);
  return true;
}
