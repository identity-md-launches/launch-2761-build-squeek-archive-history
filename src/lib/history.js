// Pure functions over the /v1/events feed: token stories, merge ancestry,
// wallet activity and one plain sentence per event.
import { formatInt, formatMm, formatSpeed, formatUnits } from './format.js';

/**
 * @typedef {object} FeedEvent
 * @property {string} id
 * @property {string} type
 * @property {string} occurredAt
 * @property {{transactionHash?: string, kind?: string}} source
 * @property {Record<string, any>} payload
 */

/** @typedef {{t: 'text', v: string} | {t: 'token', v: string} | {t: 'addr', v: string} | {t: 'num', v: string}} Segment */

const SQK_DECIMALS = 18;

/** @param {any} v */
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : '');

/**
 * Oldest first, ties broken by id so the order is stable.
 * @param {FeedEvent[]} events
 */
export function chronological(events) {
  return [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Token ids an event mentions, in the genesis collection.
 * @param {FeedEvent} e
 * @param {string} collection
 * @returns {string[]}
 */
export function tokenIdsOf(e, collection) {
  const p = e.payload || {};
  if (p.collection && collection && lower(p.collection) !== lower(collection)) return [];
  const ids = [p.tokenId, p.survivorTokenId, p.donorTokenId];
  if (p.claim && typeof p.claim === 'object') ids.push(p.claim.tokenId);
  return ids.filter((v) => v !== undefined && v !== null).map(String);
}

/**
 * Every event whose tokenId, survivorTokenId or donorTokenId matches, oldest first.
 * @param {FeedEvent[]} events
 * @param {string | number} tokenId
 * @param {string} collection
 */
export function tokenStory(events, tokenId, collection) {
  const id = String(tokenId);
  return chronological(events.filter((e) => tokenIdsOf(e, collection).includes(id)));
}

/**
 * @typedef {object} AncestryNode
 * @property {string} tokenId
 * @property {number | null} level     level reached by the merge that consumed it, or the root's highest level
 * @property {{event: FeedEvent, donor: AncestryNode}[]} consumed  merges where this token survived, oldest first
 * @property {boolean} [cycle]
 */

/**
 * Follow survivor -> donor recursively.
 * @param {FeedEvent[]} events
 * @param {string | number} tokenId
 * @param {string} collection
 * @returns {AncestryNode}
 */
export function ancestry(events, tokenId, collection) {
  const merges = chronological(
    events.filter((e) => e.type === 'nft.merged' && (!collection || !e.payload.collection || lower(e.payload.collection) === lower(collection))),
  );
  /** @type {Map<string, FeedEvent[]>} */
  const bySurvivor = new Map();
  for (const m of merges) {
    const key = String(m.payload.survivorTokenId);
    const list = bySurvivor.get(key) || [];
    list.push(m);
    bySurvivor.set(key, list);
  }
  /**
   * @param {string} id
   * @param {Set<string>} path
   * @param {number | null} level
   * @returns {AncestryNode}
   */
  const build = (id, path, level) => {
    if (path.has(id)) return { tokenId: id, level, consumed: [], cycle: true };
    const next = new Set(path).add(id);
    const own = bySurvivor.get(id) || [];
    const consumed = own.map((event) => ({
      event,
      donor: build(String(event.payload.donorTokenId), next, null),
    }));
    const reached = own.length ? Math.max(...own.map((m) => Number(m.payload.level))) : level;
    return { tokenId: id, level: reached, consumed };
  };
  return build(String(tokenId), new Set(), null);
}

/**
 * Count every token in an ancestry tree below the root.
 * @param {AncestryNode} node
 * @returns {number}
 */
export function ancestorCount(node) {
  return node.consumed.reduce((sum, c) => sum + 1 + ancestorCount(c.donor), 0);
}

/**
 * The merge that consumed this token as a donor, if any.
 * @param {FeedEvent[]} events
 * @param {string | number} tokenId
 * @param {string} collection
 */
export function consumedBy(events, tokenId, collection) {
  const id = String(tokenId);
  return events.find(
    (e) => e.type === 'nft.merged' && String(e.payload.donorTokenId) === id && (!e.payload.collection || lower(e.payload.collection) === lower(collection)),
  );
}

/**
 * Everything a wallet did: events where it is the account or the recipient.
 * @param {FeedEvent[]} events
 * @param {string} address
 */
export function walletStory(events, address) {
  const a = lower(address);
  return chronological(events.filter((e) => lower(e.payload?.account) === a || lower(e.payload?.recipient) === a));
}

/**
 * Totals for a wallet's activity.
 * @param {FeedEvent[]} story
 * @param {string} address
 */
export function walletSummary(story, address) {
  const a = lower(address);
  let claimed = 0n;
  let decimals = SQK_DECIMALS;
  let symbol = 'SQK';
  /** @type {Set<string>} */
  const deposited = new Set();
  let deposits = 0;
  let withdrawals = 0;
  let merges = 0;
  for (const e of story) {
    const p = e.payload;
    if (e.type === 'account.rewards_claimed' && lower(p.recipient ?? p.account) === a && p.amountBaseUnits) {
      claimed += BigInt(p.amountBaseUnits);
      if (p.asset?.decimals !== undefined) decimals = Number(p.asset.decimals);
      if (p.asset?.symbol) symbol = p.asset.symbol;
    }
    if (lower(p.account) !== a) continue;
    if (e.type === 'nft.deposited') {
      deposits++;
      deposited.add(String(p.tokenId));
    } else if (e.type === 'nft.withdrawn') {
      withdrawals++;
      deposited.delete(String(p.tokenId));
    } else if (e.type === 'nft.merged') {
      merges++;
      deposited.delete(String(p.donorTokenId));
    }
  }
  return {
    events: story.length,
    claimed: formatUnits(claimed, decimals),
    symbol,
    deposits,
    withdrawals,
    merges,
    stillDeposited: [...deposited].sort((x, y) => Number(x) - Number(y)),
  };
}

/** Plain labels for each event type. */
export const TYPE_LABELS = Object.freeze({
  'nft.deposited': 'Squeek deposited',
  'nft.withdrawn': 'Squeek withdrawn',
  'nft.merged': 'Squeeks merged',
  'nft.launch_claimed': 'Launch claim',
  'account.rewards_claimed': 'Rewards claimed',
  'account.claim_recipient_set': 'Claim recipient set',
  'account.sqk_staked': 'SQK staked',
  'account.sqk_unstaked': 'SQK unstaked',
  'account.rewards_staked': 'Rewards staked',
  'system.settlement_completed': 'Settlement',
  'system.mining_checkpointed': 'Mining checkpoint',
  'measurement.speed_record': 'Speed record',
  'measurement.speed_milestone': 'Speed milestone',
  'measurement.distance_milestone': 'Distance milestone',
  'measurement.daily_distance_milestone': 'Daily distance',
  'measurement.distance_streak': 'Distance streak',
});

/** @param {string} type */
export function typeLabel(type) {
  return /** @type {Record<string, string>} */ (TYPE_LABELS)[type] || type;
}

/**
 * Amount with the decimals named in the event's asset field.
 * @param {Record<string, any>} p
 */
function amount(p) {
  const decimals = p.asset?.decimals !== undefined ? Number(p.asset.decimals) : SQK_DECIMALS;
  const symbol = p.asset?.symbol || 'SQK';
  return `${formatUnits(p.amountBaseUnits ?? '0', decimals)} ${symbol}`;
}

/** @param {string} v @returns {Segment} */
const text = (v) => ({ t: 'text', v });
/** @param {any} v @returns {Segment} */
const token = (v) => ({ t: 'token', v: String(v) });
/** @param {any} v @returns {Segment} */
const addr = (v) => ({ t: 'addr', v: String(v) });
/** @param {any} v @returns {Segment} */
const num = (v) => ({ t: 'num', v: String(v) });

/**
 * One sentence per event, as segments the UI turns into text, token links and wallet links.
 * Field names are exactly those in the live payloads.
 * @param {FeedEvent} e
 * @returns {Segment[]}
 */
export function describe(e) {
  const p = e.payload || {};
  switch (e.type) {
    case 'nft.deposited':
      return [token(p.tokenId), text(' deposited by '), addr(p.account), text(', base power '), num(formatInt(p.basePower)), text('.')];
    case 'nft.withdrawn':
      return [token(p.tokenId), text(' withdrawn by '), addr(p.account), text(', base power '), num(formatInt(p.basePower)), text('.')];
    case 'nft.merged':
      return [
        token(p.survivorTokenId), text(' absorbed '), token(p.donorTokenId), text(' and reached level '), num(String(p.level)),
        text('. Power '), num('+' + formatUnits(p.nftPowerDelta ?? '0', 18)), text(', custody '), text(String(p.custody ?? 'unknown')),
        text(', next merge at height '), num(formatInt(p.nextMergeHeight)), text(' by '), addr(p.account), text('.'),
      ];
    case 'nft.launch_claimed': {
      const claim = p.claim && typeof p.claim === 'object' ? p.claim : p;
      /** @type {Segment[]} */
      const out = [text('Launch claim')];
      if (claim.tokenId !== undefined) out.push(text(' of '), token(claim.tokenId));
      if (claim.account || p.account) out.push(text(' by '), addr(claim.account || p.account));
      if (claim.amountBaseUnits) out.push(text(', '), num(amount(claim)));
      out.push(text('.'));
      return out;
    }
    case 'account.rewards_claimed': {
      /** @type {Segment[]} */
      const out = [addr(p.account), text(' claimed '), num(amount(p))];
      if (p.recipient && lower(p.recipient) !== lower(p.account)) out.push(text(' to '), addr(p.recipient));
      out.push(text('.'));
      return out;
    }
    case 'account.claim_recipient_set':
      return p.recipient
        ? [addr(p.account), text(' now sends claims to '), addr(p.recipient), text('.')]
        : [addr(p.account), text(' cleared its claim recipient, so claims go to the account itself.')];
    case 'account.sqk_staked':
    case 'account.sqk_unstaked':
    case 'account.rewards_staked': {
      const verb = e.type === 'account.sqk_staked' ? ' staked ' : e.type === 'account.sqk_unstaked' ? ' unstaked ' : ' restaked rewards of ';
      /** @type {Segment[]} */
      const out = [addr(p.account), text(verb), num(p.amountBaseUnits !== undefined ? amount(p) : 'an unreported amount of SQK')];
      out.push(text('.'));
      return out;
    }
    case 'system.settlement_completed':
      return [
        text('Settled rounds '), num(`${p.previousSettledThroughRound} → ${p.settledThroughRound}`), text(' ('), num(String(p.activeRoundCount)),
        text(' active). Work added '), num(formatInt(p.workAdded)), text(', '), num(formatInt(p.completedBlockCount)),
        text(' blocks completed, cumulative work '), num(formatInt(p.cumulativeWork)), text(', height '), num(formatInt(p.blockHeight)), text('.'),
      ];
    case 'system.mining_checkpointed':
      // There is no processedThroughRound here: the rounds are afterRound -> throughRound.
      return [
        text('Mining checkpoint, rounds '), num(`${p.afterRound} → ${p.throughRound}`), text(': '), num(formatInt(p.completedBlockCount)),
        text(' blocks completed, cumulative work '), num(formatInt(p.cumulativeWork)), text(', minted '), num(amount(p)), text('.'),
      ];
    case 'measurement.speed_record':
      return [text('New top speed '), num(formatSpeed(p.recordMmPerSecond)), text(', up from '), num(formatSpeed(p.previousRecordMmPerSecond)), text('.')];
    case 'measurement.speed_milestone':
      return [text('Passed '), num(formatSpeed(p.thresholdSpeedMmPerSecond)), text('.')];
    case 'measurement.distance_milestone':
      return [text('Lifetime distance passed '), num(formatMm(p.thresholdDistanceMm)), text(' (observed '), num(formatMm(p.observedLifetimeDistanceMm)), text(').')];
    case 'measurement.daily_distance_milestone':
      return [text('Ran '), num(formatMm(p.observedDayDistanceMm)), text(' on '), num(String(p.utcDate)), text(', past the '), num(formatMm(p.thresholdDistanceMm)), text(' mark.')];
    case 'measurement.distance_streak':
      return [num(String(p.days)), text(' days in a row of at least '), num(formatMm(p.minimumDailyDistanceMm)), text(', ending '), num(String(p.endingUtcDate)), text('.')];
    default:
      return [text(Object.entries(p).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') || 'No payload.')];
  }
}

/**
 * Plain-text version of describe(), for search and tests.
 * @param {FeedEvent} e
 */
export function describeText(e) {
  return describe(e).map((s) => (s.t === 'token' ? `Squeek #${s.v}` : s.v)).join('');
}
