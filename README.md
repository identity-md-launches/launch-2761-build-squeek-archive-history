# Squeek Archive

The history layer for Squeekchain. Squeek Archive rebuilds the past from the chain and the API:

- each Squeek NFT's life story,
- its merge ancestry,
- an arithmetic audit, titled "Is the work real?", that checks whether the reported hamster work matches the wheel's distance.

It is one static page written in plain HTML, CSS and vanilla JavaScript (ES modules). It has no build step, no runtime dependencies, no analytics, no third-party fonts, no wallet connection and no backend.

## Install, preview, rebuild

You need Node 18 or newer. No packages are installed: `package.json` has no dependencies, and `package-lock.json` holds only the root entry.

```sh
npm run build      # copy src/ to dist/ and check that every local asset URL is relative and exists
npm run preview    # serve dist/ at http://localhost:8080 (needs python3; any static server works)
npm test           # node --test: ABI encoding/decoding, audit formulas, ancestry, wallet totals, event sentences
npm run typecheck  # tsc --noEmit over the JSDoc-typed sources (fetches typescript@5.6.3 through npx, not a dependency)
npm run check      # build, test and typecheck in order
```

`dist/` is the static export and is committed. Every asset URL is relative (`styles.css`, `app.js`, `lib/*.js`, `favicon.svg`, `og.png`), so the site works from any subpath, an IPFS gateway or an ENS name. Lookups use hash routes (`#/squeek/8936`, `#/wallet/0x…`), so no server rewrites are needed. Because ES modules do not load from `file://`, serve the folder over HTTP rather than opening it directly.

### Layout

| Path | What it is |
| --- | --- |
| `src/index.html` | The page: header, lookup, result panel, audit panel, history feed, share metadata |
| `src/styles.css` | All styles; tokens at the top (see `DESIGN.md`) |
| `src/app.js` | UI wiring: routing, rendering, polling, feed walking |
| `src/lib/abi.js` | Selectors, hand-built calldata, return decoding |
| `src/lib/api.js` | API endpoints, `eth_call` with RPC failover |
| `src/lib/audit.js` | The audit rows and their formulas, all pure functions |
| `src/lib/history.js` | Life story, ancestry, wallet activity and one sentence per event |
| `src/lib/format.js` | SQK amounts, distances, ages and dates |
| `src/favicon.svg`, `src/og.png` | Favicon and share image. The share image shows Squeek #8936 as rendered by the contract. |
| `scripts/build.mjs` | Copies `src/` to `dist/` and checks the asset references |
| `tests/*.test.mjs` | Node tests for the pure modules |
| `dist/` | The committed static export |

## Endpoints

| Endpoint | Used for |
| --- | --- |
| `GET https://api.squeekchain.com/v1/economy/state` | `identities`: the contract addresses, read at runtime. The Squeek collection is `identities.genesis`. If this request fails, the `identities` block on the events feed is used, and the request is retried every 10 s. |
| `GET https://api.squeekchain.com/v1/events?limit=100[&cursor=…]` | The history feed. The opaque `nextCursor` is passed back URL-encoded until it is empty. That is about 18 pages and about 1,800 events, reaching back to 2026-10-26. |
| `GET https://api.squeekchain.com/v1/status` | Wheel telemetry for the audit, polled every 15 s |
| `POST https://ethereum-sepolia-rpc.publicnode.com` | `eth_call`, tried first |
| `POST https://sepolia.drpc.org` | `eth_call` fallback. A revert counts as a final answer and does not fail over. |
| `https://sepolia.etherscan.io/tx/<hash>` | Link target for every event that has `source.transactionHash` |

Endpoints that are deliberately not used:

- `https://docs.squeekchain.com/assets/deployments/sepolia.json` is a previous deployment. It names core `0x74665dAe…`, while the live core is `0x980b4424…`.
- `https://rpc.sepolia.org` sends no CORS header.
- `?category=nft`, `?category=account` and `?type=` all return HTTP 400. Only `all` (the default) and `measurement` are accepted, so the site reads `all` and filters by type in the browser.

## Selectors

All calls are raw JSON-RPC `eth_call` with hand-built calldata: the selector followed by one 32-byte, left-padded word per argument. No web3 library is used.

| Selector | Signature | Contract |
| --- | --- | --- |
| `0x301bd28e` | `art()` | genesis collection |
| `0x5752a646` | `collectionSeed()` | genesis collection |
| `0x8ada6b0f` | `renderer()` | genesis collection |
| `0x18160ddd` | `totalSupply()` | genesis collection (the search range) |
| `0x6352211e` | `ownerOf(uint256)` | genesis collection |
| `0x4e026d42` | `renderSVG(address,bytes32,uint256)` | renderer, called with (art, seed, tokenId) |

`renderSVG` returns an ABI dynamic string. The decoder reads the offset word, then the length word at that offset, then that many bytes of UTF-8 (`src/lib/abi.js`, `decodeString`).

The SVG is parsed with `DOMParser`. Scripts, `foreignObject` and `on*` attributes are dropped, and the result is inlined into the page. It is not proxied, cached on a server, rasterised or fetched from IPFS. The caption names the renderer address, the call duration, the RPC host and the byte count.

## Audit formulas ("Is the work real?")

Every row prints the numbers it judged. The header ribbon reads IMPLAUSIBLE if any row fails, CHECK if any row needs a check, and CONSISTENT otherwise.

| Row | Formula | Verdict |
| --- | --- | --- |
| Sensor freshness | `age = now − measurement.observedAt` | Fresh while `age ≤ measurement.staleAfterSeconds`, else Stale (CHECK) |
| Attestation | Prints `signer.kind`, `signer.algorithm`, `signer.keySlot` and the age of `signer.lastVerifiedAt` | Verified while that age ≤ `staleAfterSeconds`, else Old (CHECK) |
| Lifetime work per revolution | `perRev = cumulativeWorkUnits ÷ (distanceMm ÷ circumference)`. The circumference is editable and defaults to 471 mm. `magnets = round(perRev)`. | CONSISTENT while `abs(perRev − magnets) ≤ 0.1`, else DRIFTING (CHECK) |
| Distance never decreases | `distanceMm(b) − distanceMm(a) ≥ 0` | Fail means IMPLAUSIBLE |
| Cumulative work never decreases | `work(b) − work(a) ≥ 0` | Fail means IMPLAUSIBLE |
| No work while the wheel is still | When `rpmMilli` is 0 in both samples, work must not rise | Fail means IMPLAUSIBLE |
| Distance fits the reported speed | `Δdistance ≤ max(speed(a), speed(b)) × Δt × 1.25 + circumference` | Fail means IMPLAUSIBLE |
| Hardware counter restarts | When `measurement.counterEpoch` differs between samples, the delta is discarded, not counted, and the row says so | Informational |

Delta rows compare consecutive distinct samples, so a poll that returns the same `observedAt` again is not counted twice. `Δt` is the difference between the two samples' `observedAt` times, in seconds. Samples are kept in memory for the session, up to 500.

## The two field-name traps

1. **Telemetry speed is `measurement.speedMmPerSecond`.** There is no `measurement.speed`, and reading it silently produces `NaN`. `toSample` in `src/lib/audit.js` rejects a status body without a numeric `speedMmPerSecond`, and a test covers this.
2. **`system.mining_checkpointed` has no `processedThroughRound`.** Its rounds are `afterRound → throughRound`. Assuming the other field prints an empty round number. `describe` in `src/lib/history.js` uses `afterRound` and `throughRound`, and a test checks that no `undefined` is printed.

## Behaviour notes

- Search accepts a Squeek number from 1 to `totalSupply` (9,987 when last checked) or a 0x address with 40 hex characters. Invalid input gets an inline instruction beside the field.
- A Squeek's life story is every event whose `tokenId`, `survivorTokenId` or `donorTokenId` matches in the genesis collection, oldest first. Ancestry follows survivor to donor recursively and indents each generation. Cycles are cut and labelled.
- A wallet's activity is every event where it is `account` or `recipient`. SQK amounts are formatted from `amountBaseUnits` using `asset.decimals` (18).
- The full feed is walked once per session with a progress count and kept in memory. Story and ancestry fill in as pages arrive.
- Failed requests never blank a panel. The feed keeps what it has read and offers "Resume reading the feed". The audit keeps the last sample and shows its age. A failed render keeps the facts and offers "Retry the render".
- Light and dark follow `prefers-color-scheme`.

## Validation results

Commands run on the final source (2026-10-31):

| Command | Result |
| --- | --- |
| `npm run build` | Passed: 10 files written to `dist/`, all 5 asset references relative and present |
| `npm test` | 18 of 18 tests passed |
| `npm run typecheck` | 0 errors with tsc 5.6.3, `strict` and `checkJs` |
| taste@1 probe (`.imd/reads/skills/design-critic/scripts/taste.mjs`) | 16 of 16 checks passed at 320, 390 and 1440 wide. The first run passed 13; the fixes are in `artifacts/validation.md`. |
| Playwright interaction script (Chromium, live network) | Passed at 390, 1440 and 320 wide: no horizontal scroll, no console errors. Covered: renderSVG art, life story, ancestry, both invalid-input errors, keyboard search, wallet totals, type filter, "Show more", circumference edit, dark mode at 1920. |
| Failure-state script (Chromium, blocked requests) | Passed. Feed 503: 200 events kept and the resume button finished the walk. Failed status poll: the last sample was kept with its age. Both RPCs down: retry shown. Burned token: the `ownerOf` revert is explained. |

Limitations:

- WebKit could not launch on this machine because system libraries are missing, so Safari rendering was not checked.
- No screen-reader session or native 200% zoom was run.
- With live data during these checks, lifetime work per revolution was about 2.75 to 2.82, so that row read DRIFTING and the ribbon read CHECK. The brief measured 3.015 earlier. The site reports what the API returns.

More detail, including the design review, is in `artifacts/validation.md`.
