// Squeek Archive: wires the API, the chain and the pure modules into one page.
import { SELECTORS, calldata, decodeAddress, decodeBytes32, decodeString, decodeUint, uintWord, word } from './lib/abi.js';
import { ENDPOINTS, ethCall, eventsUrl, getJson } from './lib/api.js';
import { DEFAULT_CIRCUMFERENCE_MM, addSample, auditRows, summarise, toSample } from './lib/audit.js';
import { formatAge, formatDate, formatInt, formatMm, formatUtc, hostOf } from './lib/format.js';
import { ancestorCount, ancestry, consumedBy, describe, tokenStory, typeLabel, walletStory, walletSummary } from './lib/history.js';

/** @typedef {import('./lib/history.js').FeedEvent} FeedEvent */
/** @typedef {import('./lib/history.js').Segment} Segment */
/** @typedef {import('./lib/history.js').AncestryNode} AncestryNode */

const POLL_MS = 15000;
const FEED_BATCH = 50;
const EXAMPLE_TOKEN = '8936';

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * Small element builder. Strings become text nodes, so feed data is never parsed as HTML.
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...(Node | string | null | undefined | false)} children
 */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

/** Age text that ticks once a second. @param {number} since ms epoch */
function age(since) {
  return h('span', { 'data-since': since, class: 'num' }, formatAge((Date.now() - since) / 1000));
}

setInterval(() => {
  for (const el of document.querySelectorAll('[data-since]')) {
    el.textContent = formatAge((Date.now() - Number(/** @type {HTMLElement} */ (el).dataset.since)) / 1000);
  }
}, 1000);

/** @param {unknown} err */
const message = (err) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------- state

const state = {
  /** @type {{genesis: string} | null} */
  identities: null,
  identitiesSource: '',
  /** @type {FeedEvent[]} */
  events: [],
  feedPages: 0,
  /** @type {string | null} */
  feedCursor: null,
  feedDone: false,
  feedLoading: false,
  /** @type {string | null} */
  feedError: null,
  feedFinishedAt: 0,
  feedFilter: 'all',
  feedShown: FEED_BATCH,
  maxToken: 9987,
  /** @type {import('./lib/audit.js').Sample[]} */
  samples: [],
  polls: 0,
  lastPollOk: 0,
  /** @type {{at: number, error: string} | null} */
  lastPollError: null,
  /** @type {any} */
  lastStatus: null,
  circumference: DEFAULT_CIRCUMFERENCE_MM,
  /** @type {{kind: 'token', id: string} | {kind: 'wallet', address: string} | null} */
  query: null,
};

// ---------------------------------------------------------------- identities and collection

/** Contract addresses come from /v1/economy/state at runtime; the events feed carries the same block as a fallback. */
async function loadIdentities() {
  try {
    const body = await getJson(ENDPOINTS.economy);
    if (!body.identities?.genesis) throw new Error('economy state has no identities.genesis');
    state.identities = body.identities;
    state.identitiesSource = 'GET /v1/economy/state';
  } catch (err) {
    if (!state.identities) {
      $('lookup-status').textContent = `Unable to read contract addresses from /v1/economy/state (${message(err)}). Retrying in 10 s.`;
      setTimeout(loadIdentities, 10000);
      return;
    }
  }
  identitiesReady();
}

/** @type {Array<() => void>} */
let identityWaiters = [];
function identitiesReady() {
  $('lookup-status').textContent = '';
  $('genesis-address').textContent = /** @type {any} */ (state.identities).genesis;
  for (const w of identityWaiters) w();
  identityWaiters = [];
}
/** @returns {Promise<{genesis: string}>} */
function whenIdentities() {
  if (state.identities) return Promise.resolve(state.identities);
  return new Promise((resolve) => identityWaiters.push(() => resolve(/** @type {any} */ (state.identities))));
}

/** @type {Promise<{genesis: string, art: string, seed: string, renderer: string}> | null} */
let collectionPromise = null;
function collectionInfo() {
  if (!collectionPromise) {
    collectionPromise = (async () => {
      const { genesis } = await whenIdentities();
      const [art, seed, renderer, supply] = await Promise.all([
        ethCall(genesis, SELECTORS.art).then((r) => decodeAddress(r.result)),
        ethCall(genesis, SELECTORS.collectionSeed).then((r) => decodeBytes32(r.result)),
        ethCall(genesis, SELECTORS.renderer).then((r) => decodeAddress(r.result)),
        ethCall(genesis, SELECTORS.totalSupply).then((r) => decodeUint(r.result)),
      ]);
      state.maxToken = Number(supply);
      $('supply').textContent = formatInt(supply);
      return { genesis, art, seed, renderer };
    })();
    collectionPromise.catch(() => {
      collectionPromise = null;
    });
  }
  return collectionPromise;
}

// ---------------------------------------------------------------- the history feed

async function walkFeed() {
  if (state.feedLoading || state.feedDone) return;
  state.feedLoading = true;
  state.feedError = null;
  renderFeedStatus();
  try {
    while (!state.feedDone) {
      let body;
      let attempt = 0;
      for (;;) {
        try {
          body = await getJson(eventsUrl(state.feedCursor));
          break;
        } catch (err) {
          if (++attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      if (!state.identities && body.identities?.genesis) {
        state.identities = body.identities;
        state.identitiesSource = 'GET /v1/events (identities block)';
        identitiesReady();
      }
      const page = Array.isArray(body.events) ? body.events : [];
      const seen = new Set(state.events.map((e) => e.id));
      for (const e of page) if (!seen.has(e.id)) state.events.push(e);
      state.feedPages++;
      state.feedCursor = body.nextCursor || null;
      if (!state.feedCursor || page.length === 0) {
        state.feedDone = true;
        state.feedFinishedAt = Date.now();
      }
      renderFeedStatus();
      if (state.feedDone || state.feedPages % 3 === 0) {
        renderFeed();
        renderQueryHistory();
      }
    }
  } catch (err) {
    state.feedError = message(err);
  } finally {
    state.feedLoading = false;
    renderFeedStatus();
    renderFeed();
    renderQueryHistory();
  }
}

function oldestEvent() {
  let oldest = '';
  for (const e of state.events) if (!oldest || e.occurredAt < oldest) oldest = e.occurredAt;
  return oldest;
}

function feedProgressText() {
  const count = formatInt(state.events.length);
  if (state.feedDone) return `${count} events reaching back to ${formatDate(oldestEvent())}, read in ${state.feedPages} pages.`;
  if (state.feedLoading) return `Walking the feed: page ${state.feedPages + 1}, ${count} events so far (about 18 pages in all).`;
  return `${count} events read in ${state.feedPages} pages${state.events.length ? `, back to ${formatDate(oldestEvent())}` : ''}.`;
}

function renderFeedStatus() {
  const box = $('feed-status');
  box.replaceChildren(h('span', null, feedProgressText()));
  if (state.feedError) {
    box.append(
      h('span', { class: 'error' }, ` Stopped: ${state.feedError}. `),
      h('button', { type: 'button', class: 'button', onclick: () => walkFeed() }, 'Resume reading the feed'),
    );
  }
  const bar = /** @type {HTMLProgressElement} */ ($('feed-progress'));
  bar.hidden = state.feedDone;
  bar.value = Math.min(state.feedPages, 18);
}

function renderFeed() {
  const select = /** @type {HTMLSelectElement} */ ($('feed-filter'));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const e of state.events) counts.set(e.type, (counts.get(e.type) || 0) + 1);
  const options = [h('option', { value: 'all' }, `All types (${formatInt(state.events.length)})`)];
  for (const [type, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    options.push(h('option', { value: type }, `${typeLabel(type)} (${formatInt(n)})`));
  }
  select.replaceChildren(...options);
  select.value = counts.has(state.feedFilter) ? state.feedFilter : 'all';

  const filtered = state.events
    .filter((e) => select.value === 'all' || e.type === select.value)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const list = $('feed-list');
  if (!filtered.length) {
    list.replaceChildren(h('li', { class: 'empty' }, state.feedLoading ? 'Reading the first page…' : 'No events read yet.'));
  } else {
    list.replaceChildren(...filtered.slice(0, state.feedShown).map((e) => eventItem(e)));
  }
  const more = /** @type {HTMLButtonElement} */ ($('feed-more'));
  const left = filtered.length - Math.min(state.feedShown, filtered.length);
  more.hidden = left <= 0;
  more.textContent = `Show ${Math.min(FEED_BATCH, left)} more of ${formatInt(left)}`;
}

/**
 * @param {Segment[]} segments
 */
function sentence(segments) {
  const p = h('p', { class: 'event-text' });
  for (const s of segments) {
    if (s.t === 'token') p.append(h('a', { href: `#/squeek/${s.v}`, class: 'token' }, `Squeek #${s.v}`));
    else if (s.t === 'addr') p.append(h('a', { href: `#/wallet/${s.v.toLowerCase()}`, class: 'addr' }, s.v));
    else if (s.t === 'num') p.append(h('span', { class: 'num' }, s.v));
    else p.append(s.v);
  }
  return p;
}

/**
 * One feed row: when, what, the sentence and its transaction.
 * @param {FeedEvent} e
 */
function eventItem(e) {
  const hash = e.source?.transactionHash;
  return h(
    'li',
    { class: 'event' },
    h('div', { class: 'event-meta' }, h('time', { datetime: e.occurredAt, class: 'num' }, formatUtc(e.occurredAt)), h('span', { class: 'event-type' }, typeLabel(e.type))),
    sentence(describe(e)),
    hash
      ? h('a', { class: 'tx', href: `https://sepolia.etherscan.io/tx/${hash}`, target: '_blank', rel: 'noopener', title: hash }, `Transaction ${hash.slice(0, 10)}… on Etherscan`)
      : h('span', { class: 'tx muted' }, 'Off-chain measurement, no transaction'),
  );
}

// ---------------------------------------------------------------- lookup

/** @param {string} raw */
function parseQuery(raw) {
  const v = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { kind: /** @type {const} */ ('wallet'), address: v.toLowerCase() };
  const n = v.replace(/^#/, '').replace(/^squeek\s*#?/i, '');
  if (/^\d+$/.test(n)) {
    const id = Number(n);
    if (id >= 1 && id <= state.maxToken) return { kind: /** @type {const} */ ('token'), id: String(id) };
    return { error: `Use a Squeek number from 1 to ${formatInt(state.maxToken)}.` };
  }
  if (/^0x/i.test(v)) return { error: 'A wallet address is 0x followed by 40 hex characters.' };
  return { error: `Enter a Squeek number from 1 to ${formatInt(state.maxToken)} or a 0x wallet address.` };
}

function onSubmit(/** @type {SubmitEvent} */ ev) {
  ev.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($('q'));
  const parsed = parseQuery(input.value);
  const err = $('q-error');
  if ('error' in parsed) {
    input.setAttribute('aria-invalid', 'true');
    err.textContent = parsed.error || '';
    input.focus();
    return;
  }
  input.removeAttribute('aria-invalid');
  err.textContent = '';
  const target = parsed.kind === 'token' ? `#/squeek/${parsed.id}` : `#/wallet/${parsed.address}`;
  if (location.hash === target) route(true);
  else location.hash = target;
}

/** @param {boolean} [focus] */
function route(focus = false) {
  const m = location.hash.match(/^#\/(squeek|wallet)\/([^/]+)$/);
  const input = /** @type {HTMLInputElement} */ ($('q'));
  if (m && m[1] === 'squeek' && /^\d+$/.test(m[2])) {
    state.query = { kind: 'token', id: String(Number(m[2])) };
    input.value = state.query.id;
  } else if (m && m[1] === 'wallet' && /^0x[0-9a-fA-F]{40}$/.test(m[2])) {
    state.query = { kind: 'wallet', address: m[2].toLowerCase() };
    input.value = state.query.address;
  } else {
    state.query = { kind: 'token', id: EXAMPLE_TOKEN };
  }
  renderQuery(!m);
  const heading = document.querySelector('#result h2');
  if (focus && heading instanceof HTMLElement) heading.focus();
}

/** @param {boolean} isExample */
function renderQuery(isExample) {
  const result = $('result');
  const q = state.query;
  if (!q) return;
  if (q.kind === 'token') {
    result.replaceChildren(
      h(
        'div',
        { class: 'result-head' },
        h('h2', { tabindex: '-1' }, `Squeek #${q.id}`, isExample ? h('span', { class: 'muted' }, ' (example)') : null),
      ),
      h(
        'div',
        { class: 'token-grid' },
        h('figure', { class: 'art', id: 'art' }, h('div', { class: 'art-frame', id: 'art-frame' }, h('p', { class: 'art-wait' }, 'Calling renderSVG on the chain…')), h('figcaption', { id: 'art-caption' }, '')),
        h('div', { class: 'token-facts' }, h('dl', { class: 'facts', id: 'token-facts' }), h('div', { id: 'traits' })),
      ),
      h('section', { 'aria-labelledby': 'story-h' }, h('h3', { id: 'story-h' }, 'Life story'), h('div', { id: 'story' })),
      h('section', { 'aria-labelledby': 'tree-h' }, h('h3', { id: 'tree-h' }, 'Merge ancestry'), h('div', { id: 'tree' })),
    );
    renderArt(q.id);
  } else {
    result.replaceChildren(
      h('div', { class: 'result-head' }, h('h2', { tabindex: '-1' }, 'Wallet'), h('p', { class: 'addr big' }, q.address)),
      h('dl', { class: 'facts', id: 'wallet-facts' }),
      h('section', { 'aria-labelledby': 'activity-h' }, h('h3', { id: 'activity-h' }, 'Everything this wallet did'), h('div', { id: 'story' })),
    );
  }
  renderQueryHistory();
}

/** @param {string} id */
async function renderArt(id) {
  const frame = $('art-frame');
  const caption = $('art-caption');
  const facts = $('token-facts');
  try {
    const info = await collectionInfo();
    if (state.query?.kind !== 'token' || state.query.id !== id) return;
    const data = calldata(SELECTORS.renderSVG, word(info.art), word(info.seed), uintWord(id));
    const ownerCall = ethCall(info.genesis, calldata(SELECTORS.ownerOf, uintWord(id))).then(
      (r) => ({ ok: true, owner: decodeAddress(r.result) }),
      (err) => ({ ok: false, owner: message(err) }),
    );
    const call = await ethCall(info.renderer, data);
    if (state.query?.kind !== 'token' || state.query.id !== id) return;
    const markup = decodeString(call.result);
    const svg = sanitizeSvg(markup);
    frame.replaceChildren(svg);
    const bytes = new TextEncoder().encode(markup).length;
    caption.replaceChildren(
      'Drawn by the contract: renderSVG(address,bytes32,uint256) on renderer ',
      h('a', { class: 'addr', href: `https://sepolia.etherscan.io/address/${info.renderer}`, target: '_blank', rel: 'noopener' }, info.renderer),
      ` in `,
      h('span', { class: 'num' }, `${Math.round(call.ms)} ms`),
      ` via ${hostOf(call.endpoint)}, `,
      h('span', { class: 'num' }, `${formatInt(bytes)} bytes`),
      ' inlined as is. No proxy, cache, raster or IPFS.',
    );
    renderTraits(svg);
    const owner = await ownerCall;
    if (state.query?.kind !== 'token' || state.query.id !== id) return;
    const ownerRow = facts.querySelector('[data-owner]');
    if (ownerRow) ownerRow.replaceChildren(owner.ok ? h('a', { class: 'addr', href: `#/wallet/${owner.owner}` }, owner.owner) : h('span', { class: 'muted' }, /revert/i.test(owner.owner) ? 'No owner: ownerOf reverted, so the token is burned or not minted.' : `Unable to read ownerOf: ${owner.owner}`));
  } catch (err) {
    if (state.query?.kind !== 'token' || state.query.id !== id) return;
    frame.replaceChildren(
      h('div', { class: 'art-wait' }, h('p', { class: 'error' }, `Unable to render from the chain: ${message(err)}`), h('button', { type: 'button', class: 'button', onclick: () => renderArt(id) }, 'Retry the render')),
    );
  }
}

/**
 * Parse the renderer's SVG and drop anything executable before it joins the page.
 * @param {string} markup
 */
function sanitizeSvg(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.nodeName.toLowerCase() !== 'svg') throw new Error('Renderer returned something other than SVG');
  for (const bad of root.querySelectorAll('script, foreignObject')) bad.remove();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  }
  root.removeAttribute('width');
  root.removeAttribute('height');
  return /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.importNode(root, true)));
}

/** Traits the renderer writes into its <desc>. @param {SVGSVGElement} svg */
function renderTraits(svg) {
  const desc = svg.querySelector('desc')?.textContent || '';
  const pairs = desc
    .split(';')
    .map((part) => part.split(':').map((s) => s.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1]);
  if (!pairs.length) return;
  $('traits').replaceChildren(h('h3', null, 'Traits from the SVG'), h('dl', { class: 'traits' }, ...pairs.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
}

/** @param {string} what */
function feedNote(what) {
  if (state.feedDone) return null;
  return h('p', { class: 'note' }, `${what} fills in as the feed loads: ${formatInt(state.events.length)} events read so far.`);
}

function renderQueryHistory() {
  const q = state.query;
  const story = document.getElementById('story');
  if (!q || !story) return;
  const genesis = state.identities?.genesis || '';
  if (q.kind === 'token') {
    const events = tokenStory(state.events, q.id, genesis);
    const tree = ancestry(state.events, q.id, genesis);
    const eater = consumedBy(state.events, q.id, genesis);
    const facts = $('token-facts');
    const ownerNode = facts.querySelector('[data-owner]');
    const factNodes = [
      h('dt', null, 'Collection'), h('dd', null, h('span', { class: 'addr' }, genesis || 'loading…')),
      h('dt', null, 'Owner (ownerOf)'), ownerNode || h('dd', { 'data-owner': '' }, h('span', { class: 'muted' }, 'Reading the chain…')),
      h('dt', null, 'Merge level'), h('dd', { class: 'num' }, tree.level ? String(tree.level) : 'Never merged as survivor'),
      h('dt', null, 'Squeeks consumed'), h('dd', { class: 'num' }, String(ancestorCount(tree))),
      h('dt', null, 'Events in the feed'), h('dd', { class: 'num' }, formatInt(events.length)),
      eater ? h('dt', null, 'Fate') : null,
      eater ? h('dd', null, 'Consumed by ', h('a', { href: `#/squeek/${eater.payload.survivorTokenId}` }, `Squeek #${eater.payload.survivorTokenId}`), ` on ${formatUtc(eater.occurredAt)}`) : null,
    ];
    facts.replaceChildren(...factNodes.filter((n) => n !== null).map((n) => /** @type {HTMLElement} */ (n)));
    story.replaceChildren(
      ...[feedNote('This story')].filter(Boolean).map((n) => /** @type {Node} */ (n)),
      events.length
        ? h('ol', { class: 'events' }, ...events.map((e) => eventItem(e)))
        : h('p', { class: 'empty' }, state.feedDone ? `The feed has no events for Squeek #${q.id} since ${formatDate(oldestEvent())}.` : 'No events found yet.'),
    );
    const treeBox = $('tree');
    treeBox.replaceChildren(
      ...[state.feedDone ? null : h('p', { class: 'note' }, 'Ancestry so far.')].filter(Boolean).map((n) => /** @type {Node} */ (n)),
      tree.consumed.length
        ? h('ul', { class: 'tree' }, treeNode(tree, true))
        : h('p', { class: 'empty' }, `Squeek #${q.id} has not absorbed another Squeek in the feed's history.`),
    );
  } else {
    const events = walletStory(state.events, q.address);
    const s = walletSummary(events, q.address);
    $('wallet-facts').replaceChildren(
      h('dt', null, 'Events'), h('dd', { class: 'num' }, formatInt(s.events)),
      h('dt', null, `${s.symbol} claimed`), h('dd', { class: 'num' }, `${s.claimed} ${s.symbol}`),
      h('dt', null, 'Deposits / withdrawals'), h('dd', { class: 'num' }, `${s.deposits} / ${s.withdrawals}`),
      h('dt', null, 'Merges'), h('dd', { class: 'num' }, String(s.merges)),
      h('dt', null, 'Still deposited'),
      h('dd', { class: 'token-list' }, ...(s.stillDeposited.length ? s.stillDeposited.map((id) => h('a', { href: `#/squeek/${id}` }, `#${id}`)) : ['None'])),
    );
    story.replaceChildren(
      ...[feedNote('This activity list')].filter(Boolean).map((n) => /** @type {Node} */ (n)),
      events.length
        ? h('ol', { class: 'events' }, ...events.map((e) => eventItem(e)))
        : h('p', { class: 'empty' }, state.feedDone ? `No feed events name ${q.address} as account or recipient.` : 'No events found yet.'),
    );
  }
}

/**
 * One generation of the ancestry tree; donors indent under the survivor that consumed them.
 * @param {AncestryNode} node
 * @param {boolean} root
 * @returns {HTMLElement}
 */
function treeNode(node, root) {
  const label = h('div', { class: 'tree-label' }, root ? h('strong', null, `Squeek #${node.tokenId}`) : h('a', { href: `#/squeek/${node.tokenId}` }, `Squeek #${node.tokenId}`));
  if (root && node.level) label.append(h('span', { class: 'muted' }, ` level ${node.level} now`));
  if (node.cycle) label.append(h('span', { class: 'error' }, ' (repeats an ancestor, not followed)'));
  const li = h('li', null, label);
  if (node.consumed.length) {
    li.append(
      h(
        'ul',
        null,
        ...node.consumed.map((c) => {
          const child = treeNode(c.donor, false);
          child.querySelector('.tree-label')?.append(h('span', { class: 'muted' }, ` absorbed ${formatUtc(c.event.occurredAt)}, survivor reached level ${c.event.payload.level}`));
          return child;
        }),
      ),
    );
  }
  return li;
}

// ---------------------------------------------------------------- audit

async function poll() {
  state.polls++;
  try {
    const body = await getJson(ENDPOINTS.status, 12000);
    const sample = toSample(body, Date.now());
    addSample(state.samples, sample);
    state.lastStatus = body;
    state.lastPollOk = Date.now();
    state.lastPollError = null;
  } catch (err) {
    state.lastPollError = { at: Date.now(), error: message(err) };
  }
  renderAudit();
}

const VERDICT_MARK = { pass: '✓', check: '!', fail: '✕', waiting: '…', note: 'i' };

function renderAudit() {
  const rows = auditRows(state.samples, Date.now(), state.circumference);
  const verdict = summarise(rows);
  const ribbon = $('ribbon');
  ribbon.dataset.verdict = verdict || 'waiting';
  $('ribbon-word').textContent = verdict || 'Waiting';
  const meta = $('ribbon-meta');
  meta.replaceChildren(
    `${formatInt(state.samples.length)} distinct sample${state.samples.length === 1 ? '' : 's'} from ${formatInt(state.polls)} poll${state.polls === 1 ? '' : 's'}, every 15 s.`,
  );
  if (state.lastPollOk) meta.append(' Last good sample ', age(state.lastPollOk), ' ago.');
  if (state.lastPollError) meta.append(h('span', { class: 'error' }, ` Latest poll failed: ${state.lastPollError.error}. Showing the last known sample.`));

  const list = $('audit-rows');
  if (!rows.length) {
    list.replaceChildren(h('li', { class: 'empty' }, state.lastPollError ? `Unable to read /v1/status: ${state.lastPollError.error}. Retrying in 15 s.` : 'Reading the first sample…'));
  } else {
    list.replaceChildren(
      ...rows.map((r) =>
        h(
          'li',
          { class: 'audit-row', 'data-verdict': r.verdict },
          h('div', { class: 'audit-head' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, VERDICT_MARK[r.verdict]), h('h3', null, r.title), h('span', { class: 'verdict' }, r.label)),
          h('p', { class: 'audit-detail num-run' }, r.detail),
        ),
      ),
    );
  }

  const latest = state.samples[state.samples.length - 1];
  const m = state.lastStatus?.measurement;
  if (latest && m) {
    $('reading').replaceChildren(
      h('dt', null, 'Distance (distanceMm)'), h('dd', { class: 'num' }, `${formatInt(latest.distanceMm)} mm, ${formatMm(latest.distanceMm)}`),
      h('dt', null, 'Work (cumulativeWorkUnits)'), h('dd', { class: 'num' }, formatInt(latest.work)),
      h('dt', null, 'Speed (speedMmPerSecond)'), h('dd', { class: 'num' }, `${formatInt(latest.speed)} mm/s`),
      h('dt', null, 'rpmMilli'), h('dd', { class: 'num' }, formatInt(latest.rpmMilli)),
      h('dt', null, 'Observed'), h('dd', null, h('span', { class: 'num' }, formatUtc(m.observedAt)), ', ', age(latest.observedAt), ' ago'),
      h('dt', null, 'counterEpoch'), h('dd', { class: 'addr' }, latest.counterEpoch),
      h('dt', null, 'Provenance'), h('dd', null, `${m.provenance ?? 'unknown'}, core ${m.coreStatus ?? 'unknown'}`),
    );
  }
}

// ---------------------------------------------------------------- start

$('search').addEventListener('submit', onSubmit);
$('feed-filter').addEventListener('change', (ev) => {
  state.feedFilter = /** @type {HTMLSelectElement} */ (ev.target).value;
  state.feedShown = FEED_BATCH;
  renderFeed();
});
$('feed-more').addEventListener('click', () => {
  state.feedShown += FEED_BATCH;
  renderFeed();
});
$('circumference').addEventListener('input', (ev) => {
  const v = Number(/** @type {HTMLInputElement} */ (ev.target).value);
  const err = $('circumference-error');
  if (v > 0) {
    state.circumference = v;
    err.textContent = '';
    /** @type {HTMLInputElement} */ (ev.target).removeAttribute('aria-invalid');
    renderAudit();
  } else {
    err.textContent = 'Use a circumference above 0 mm. The audit keeps the last valid value.';
    /** @type {HTMLInputElement} */ (ev.target).setAttribute('aria-invalid', 'true');
  }
});
for (const btn of document.querySelectorAll('[data-example]')) {
  btn.addEventListener('click', () => {
    /** @type {HTMLInputElement} */ ($('q')).value = /** @type {HTMLElement} */ (btn).dataset.example || '';
    /** @type {HTMLFormElement} */ ($('search')).requestSubmit();
  });
}
window.addEventListener('hashchange', () => route(true));

loadIdentities();
collectionInfo().catch(() => {});
route();
walkFeed();
poll();
setInterval(poll, POLL_MS);
setInterval(() => {
  if (state.samples.length) renderAudit();
}, 5000);
