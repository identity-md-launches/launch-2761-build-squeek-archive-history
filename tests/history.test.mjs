import test from 'node:test';
import assert from 'node:assert/strict';
import { ancestorCount, ancestry, consumedBy, describeText, tokenStory, walletStory, walletSummary } from '../src/lib/history.js';
import { formatUnits } from '../src/lib/format.js';

const G = '0xcb98349c134ab983da5bfd80527dfe2552bdb70f';
let n = 0;
const ev = (type, payload, at, hash = '0x' + 'ab'.repeat(32)) => ({
  id: `e${n++}`,
  type,
  occurredAt: at,
  source: { kind: 'chain', transactionHash: hash },
  payload: { collection: G, ...payload },
});
const merge = (s, d, level, at) => ev('nft.merged', { account: '0xaa', survivorTokenId: String(s), donorTokenId: String(d), level, nextMergeHeight: '7135', custody: 'staking', nftPowerDelta: '200000000000000000000' }, at);

// A level 4 Squeek: 1 consumed 2, 3 and 4; 2 had consumed 5; 5 had consumed 6.
const events = [
  merge(5, 6, 2, '2026-10-27T00:00:00Z'),
  merge(2, 5, 2, '2026-10-28T00:00:00Z'),
  merge(1, 2, 2, '2026-10-29T00:00:00Z'),
  merge(1, 3, 3, '2026-10-29T01:00:00Z'),
  merge(1, 4, 4, '2026-10-29T02:00:00Z'),
  ev('nft.deposited', { account: '0xAbC0000000000000000000000000000000000001', tokenId: '1', basePower: '1000' }, '2026-10-26T18:00:00Z'),
  ev('nft.deposited', { account: '0xabc0000000000000000000000000000000000001', tokenId: '9', basePower: '1000' }, '2026-10-26T19:00:00Z'),
  ev('nft.withdrawn', { account: '0xabc0000000000000000000000000000000000001', tokenId: '9', basePower: '1000' }, '2026-10-30T19:00:00Z'),
  ev('nft.deposited', { collection: '0x0000000000000000000000000000000000000001', account: '0xaa', tokenId: '1', basePower: '1' }, '2026-10-26T18:00:00Z'),
  { id: 'r', type: 'account.rewards_claimed', occurredAt: '2026-10-31T00:00:00Z', source: { transactionHash: '0x1' }, payload: { account: '0xabc0000000000000000000000000000000000001', recipient: '0xabc0000000000000000000000000000000000001', amountBaseUnits: '479151230077030429592', asset: { address: '0x55', symbol: 'SQK', decimals: 18 } } },
];

test('life story is chronological and matches tokenId, survivorTokenId or donorTokenId in the genesis collection', () => {
  const story = tokenStory(events, 1, G);
  assert.deepEqual(story.map((e) => e.type), ['nft.deposited', 'nft.merged', 'nft.merged', 'nft.merged']);
  assert.equal(tokenStory(events, 5, G).length, 2); // donor once, survivor once
});

test('ancestry follows survivor to donor recursively', () => {
  const tree = ancestry(events, 1, G);
  assert.equal(tree.level, 4);
  assert.deepEqual(tree.consumed.map((c) => c.donor.tokenId), ['2', '3', '4']);
  assert.equal(tree.consumed[0].donor.consumed[0].donor.tokenId, '5');
  assert.equal(tree.consumed[0].donor.consumed[0].donor.consumed[0].donor.tokenId, '6');
  assert.equal(ancestorCount(tree), 5);
  assert.equal(consumedBy(events, 2, G)?.payload.survivorTokenId, '1');
});

test('ancestry survives a cycle in bad data', () => {
  const loop = [merge(7, 8, 2, '2026-10-27T00:00:00Z'), merge(8, 7, 2, '2026-10-28T00:00:00Z')];
  const tree = ancestry(loop, 7, G);
  assert.equal(tree.consumed[0].donor.consumed[0].donor.cycle, true);
});

test('wallet story is case-insensitive and sums SQK with the asset decimals', () => {
  const story = walletStory(events, '0xABC0000000000000000000000000000000000001');
  assert.equal(story.length, 4);
  const s = walletSummary(story, '0xabc0000000000000000000000000000000000001');
  assert.equal(s.claimed, '479.1512');
  assert.deepEqual(s.stillDeposited, ['1']);
});

test('formatUnits uses 18 decimals', () => {
  assert.equal(formatUnits('479151230077030429592', 18), '479.1512');
  assert.equal(formatUnits('19790299556933607814226918', 18), '19,790,299.5569');
  assert.equal(formatUnits('0', 18), '0');
  assert.equal(formatUnits('1', 18), '<0.0001');
});

test('mining checkpoint prints afterRound → throughRound, never an empty round', () => {
  const text = describeText({ id: 'm', type: 'system.mining_checkpointed', occurredAt: '', source: {}, payload: { afterRound: '654', throughRound: '655', completedBlockCount: '0', cumulativeWork: '55902', amountBaseUnits: '0', asset: { symbol: 'SQK', decimals: 18 } } });
  assert.match(text, /rounds 654 → 655/);
  assert.doesNotMatch(text, /undefined/);
});

test('every live payload shape produces a sentence without undefined', () => {
  const samples = {
    'account.claim_recipient_set': { account: '0x31', recipient: null },
    'system.settlement_completed': { previousSettledThroughRound: '654', settledThroughRound: '655', activeRoundCount: '0', workAdded: '0', completedBlockCount: '0', cumulativeWork: '55902', blockHeight: '4973' },
    'measurement.speed_record': { previousRecordMmPerSecond: '1526', recordMmPerSecond: '1600' },
    'measurement.speed_milestone': { thresholdSpeedMmPerSecond: '833' },
    'measurement.distance_milestone': { thresholdDistanceMm: '40000000', observedLifetimeDistanceMm: '40005192' },
    'measurement.daily_distance_milestone': { thresholdDistanceMm: '5000000', observedDayDistanceMm: '5005478', utcDate: '2026-10-30' },
    'measurement.distance_streak': { days: 5, minimumDailyDistanceMm: '5000000', endingUtcDate: '2026-10-30' },
  };
  for (const [type, payload] of Object.entries(samples)) {
    const text = describeText({ id: type, type, occurredAt: '', source: {}, payload });
    assert.doesNotMatch(text, /undefined|NaN/, type);
  }
});
