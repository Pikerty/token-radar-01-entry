// The radar model: one sealed snapshot in, one ranked board plus dashboard data out.
//
// A protocol is "pre-token" when the snapshot records no token for it (no market cap, no
// CoinGecko id, no symbol). The board ranks pre-token protocols by an implied value derived
// only from the snapshot's own figures:
//
//   implied value = TVL x category multiple x growth x maturity x reach
//
// The category multiple is calibrated from the snapshot itself: for each category, the
// median market-cap/TVL ratio of the protocols in that category whose token already
// trades, shrunk toward the global median when a category has few live peers, and clamped
// to a sane band. Growth damps the 7-day TVL change, maturity rewards time survived with
// no token, and reach gives a small capped bonus for chains already served. Every factor
// is printed on the row, so the arithmetic can be checked from board.json alone.
//
// The board applies the watchlist's own product rules at every size, not just above the
// $50M floor: an entry is ranked only when it records no token and is not a wrapped,
// staked, bridged or exchange product of something that already trades (the snapshot's
// WBTC and USDT0 record no token, but each is a bridged form of a token that trades, so
// neither is a launch still to come). Token-live protocols are never ranked; they are
// returned separately, at the market's own values, as the calibration set made visible.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document as the house froze it. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** One row of board.json: the gate's required fields plus the model's working. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  model: {
    base_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    growth_pct: number | null;
    category_peers: number;
    age_assumed: boolean;
  };
  farm_steps: string[];
}

/** A token-live protocol, shown at the market's own value and never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** How the category multiples came out of the snapshot, for the dashboard's model panel. */
export interface ModelInfo {
  global_multiple: number;
  multiples: { category: string; multiple: number; peers: number }[];
  product_categories: string[];
}

/** Everything data.js hands to the dashboard. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  rows: BoardRow[];
  live: LiveRow[];
  model_info: ModelInfo;
}

export const MODEL_VERSION = 'radar-2';

const DAY_MS = 86_400_000;

/** Whole days from listed_at to the snapshot's as_of; null when the date is unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** True when the snapshot records no token for the protocol. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// ------------------------------------------------------------ rankability

/**
 * Categories whose entries are products of an asset that already trades (a bridge holds
 * other protocols' tokens in transit; a staking product is a claim on a staked asset),
 * plus CEX, whose entries are an exchange's own books. The watchlist rule excludes the
 * same kinds above its floor; the board excludes them at every size.
 */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name ending in a version marker names a deployment of a protocol, not the protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking names a claim on an asset, not a launch. */
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name is that exchange's product (the house's list). */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** True when a pre-token record is a launch candidate in its own right. */
export function isRankable(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPER_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// ------------------------------------------------------------ the value model

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** The middle value of a non-empty list, taken on a sorted copy so callers keep their order. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface Calibration {
  global: number;
  byCategory: Map<string, { multiple: number; peers: number }>;
}

/**
 * Category multiples from the snapshot's own live set: the median mcap/TVL of the
 * token-live protocols in each category, shrunk toward the global median by the peer
 * count (four phantom peers at the global figure) and clamped to [0.05, 2]. A category
 * with no live peer prices at the global median.
 */
function calibrate(protocols: Protocol[]): Calibration {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    if (p.category !== null) {
      const list = perCategory.get(p.category);
      if (list === undefined) perCategory.set(p.category, [ratio]);
      else list.push(ratio);
    }
  }
  const global = clamp(median(ratios), 0.05, 2);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, list] of perCategory) {
    const shrunk = (list.length * median(list) + 4 * global) / (list.length + 4);
    byCategory.set(category, { multiple: clamp(shrunk, 0.05, 2), peers: list.length });
  }
  return { global, byCategory };
}

/** Damped 7-day momentum: half the move would be noise, so a third of it is priced. */
function growthMultiplier(change7d: number | null): number {
  if (change7d === null) return 1;
  return round4(1 + (clamp(change7d, -50, 100) / 100) * 0.35);
}

/** Survival with no token: full credit at two years, a 0.65 floor for a brand-new record. */
function maturityMultiplier(ageUsed: number): number {
  return round4(0.65 + 0.35 * (Math.min(ageUsed, 730) / 730));
}

/** Distribution already built: 2.5 points per extra chain, capped at eight extra chains. */
function reachMultiplier(chainCount: number): number {
  return round4(1 + 0.025 * Math.min(Math.max(chainCount - 1, 0), 8));
}

// ------------------------------------------------------------ farm plans

/** Working capital a plan suggests, tiered by the size of the protocol it farms. */
function capitalTier(tvlUsd: number): string {
  if (tvlUsd >= 1_000_000_000) return '$10,000-$50,000';
  if (tvlUsd >= 250_000_000) return '$5,000-$25,000';
  if (tvlUsd >= 50_000_000) return '$2,000-$10,000';
  if (tvlUsd >= 10_000_000) return '$500-$5,000';
  return '$100-$1,000';
}

/** A rough per-transaction gas figure for the chain a plan is worked on. */
function gasPerTx(chain: string): string {
  switch (chain) {
    case 'Ethereum':
      return '$6-$20';
    case 'Solana':
      return '$0.01-$0.05';
    case 'Binance':
      return '$0.10-$0.40';
    case 'Polygon':
      return '$0.01-$0.10';
    case 'Avalanche':
      return '$0.10-$0.80';
    case 'Arbitrum':
    case 'Base':
    case 'Optimism':
      return '$0.02-$0.50';
    default:
      return '$0.05-$1.00';
  }
}

/** The core farming action for a category, in words a reader can act on. */
function coreAction(category: string | null): string {
  switch (category) {
    case 'Dexs':
      return 'swap through the main markets every week and hold a two-sided position in the deepest pool';
    case 'Lending':
      return 'supply a blue-chip collateral asset and, if you borrow at all, keep the borrow under 40% of the supply value';
    case 'Yield':
    case 'Yield Aggregator':
      return 'deposit into the flagship vault and leave the position untouched between monthly reviews';
    case 'Risk Curators':
      return 'allocate into two or three curated vaults with different strategies, so no single curator holds the whole position';
    case 'Onchain Capital Allocator':
      return 'deposit into the main allocation vault and follow where the capital is deployed each week';
    case 'RWA':
      return 'complete the onboarding and identity checks the product requires, then buy the tokenised treasury or credit position on offer';
    case 'Derivatives':
      return 'trade the main perpetual markets at small size and keep margin far above the liquidation line';
    case 'CDP':
      return 'open a collateralised position and mint the stablecoin against it at a conservative ratio';
    case 'CDP Manager':
      return 'open a managed collateral position and let the manager keep its ratio inside the safe band';
    case 'Basis Trading':
      return 'hold the funded basis position and check every week that funding still pays in your favour';
    case 'Chain':
      return 'bridge funds in, keep a gas balance, and use the chain\'s main lending and swap venues every week';
    case 'Prediction Market':
      return 'take modest positions in the most liquid markets and let them settle as they resolve';
    case 'Payments':
      return 'route real payments through it and keep a working balance, so the activity is genuine use rather than churn';
    case 'Leveraged Farming':
      return 'open the leveraged position at the lowest loop offered and watch its health factor daily';
    default:
      return 'use the core product with real funds, at a size the whole position can be exited from in one session';
  }
}

/** The risk sentence a plan ends on, sharper for the categories that can hurt quickly. */
function riskNote(category: string | null): string {
  switch (category) {
    case 'Leveraged Farming':
      return 'Leveraged positions can unwind in minutes when the market gaps, so never farm this with funds that cannot be lost.';
    case 'Basis Trading':
      return 'A basis position bleeds when funding flips, so set a funding floor and close the position the week it is crossed.';
    case 'Derivatives':
      return 'Perpetuals liquidate without warning in a fast move, so size as if the position will be tested at the worst hour.';
    case 'RWA':
      return 'Real-world products redeem on their own windows and may gate withdrawals, so treat the position as locked until it settles.';
    case 'Uncollateralized Lending':
      return 'Uncollateralised lending carries borrower default risk, so split the position across borrowers and maturities.';
    default:
      return 'Points and rumoured rewards are never a promise of a token, so size the position as farming first and a launch as a bonus.';
  }
}

/** Six concrete steps for one protocol, each carrying its cost and its time. */
function farmPlan(p: Protocol, ageUsed: number, ageAssumed: boolean): string[] {
  const home = p.chains[0] ?? 'Ethereum';
  const gas = gasPerTx(home);
  const capital = capitalTier(p.tvl_usd);
  const action = coreAction(p.category);
  const ageText = ageAssumed
    ? 'an unreported age'
    : ageUsed >= 730
      ? `more than two years (${Math.floor(ageUsed / 365)}+ years)`
      : ageUsed >= 365
        ? 'over a year'
        : ageUsed >= 90
          ? 'several months'
          : 'only a few weeks';
  const holdWeeks = clamp(Math.round(ageUsed / 30), 8, 52);
  const second =
    p.chains.length > 1
      ? `Open a second front on ${p.chains[1]}: repeat the core action there at about a third of the size, so the footprint is multi-chain like the protocol itself. Cost: about ${gasPerTx(p.chains[1])} per transaction there. Time: 30 minutes, once.`
      : `Deepen the first position instead of spreading thin: add a second pool, market or asset inside ${p.name} so the activity is broad as well as large. Cost: about ${gas} per transaction on ${home}. Time: 20 minutes, once.`;
  return [
    `Do the homework first: read ${p.name}'s docs and any rewards or points page, confirm which chains and assets count, and set up a fresh wallet for the farm. Cost: $0. Time: 30-45 minutes, once.`,
    `Fund the position: move ${capital} of working capital to ${home} and keep a small spare balance for gas, at about ${gas} per transaction there. Cost: one bridge or exchange withdrawal plus one swap. Time: under an hour, once.`,
    `Work the core product on ${home}: ${action}. Cost: about ${gas} per transaction, plus the normal market spread. Time: 20-40 minutes to set up.`,
    second,
    `Hold and tend it: interact about once a week, review the position monthly, and plan to hold at least ${holdWeeks} weeks - ${p.name} has run with ${ageText} and no token, so patience counts for more than churn. Cost: about ${gas} per weekly visit. Time: 10 minutes a week.`,
    `Keep the exit open: ${riskNote(p.category)} Write down every deposit and interaction with dates and transaction hashes, so any future claim can be proved. Cost: exit gas of about ${gas} per transaction. Time: about 30 minutes to unwind in one session.`,
  ];
}

// ------------------------------------------------------------ the board

/** Build the ranked board and the dashboard's dataset from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; data: RadarData } {
  const calibration = calibrate(snapshot.protocols);
  const candidates = snapshot.protocols.filter(isRankable);

  const knownAges = candidates
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  const medianAge = knownAges.length > 0 ? Math.round(median(knownAges)) : 365;

  const scored = candidates.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const ageAssumed = age === null;
    const ageUsed = age ?? medianAge;
    const entry = p.category === null ? undefined : calibration.byCategory.get(p.category);
    const base = round4(entry === undefined ? calibration.global : entry.multiple);
    const growth = growthMultiplier(p.change_7d);
    const maturity = maturityMultiplier(ageUsed);
    const reach = reachMultiplier(p.chains.length);
    const implied = Math.max(1, Math.round(p.tvl_usd * base * growth * maturity * reach));
    return { p, age, ageAssumed, ageUsed, base, growth, maturity, reach, implied, peers: entry?.peers ?? 0 };
  });

  // Implied value decides; TVL, then the slug, break ties so two runs agree byte for byte.
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const watchlist = new Set(snapshot.watchlist);
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    implied_value_usd: s.implied,
    watchlist: watchlist.has(s.p.slug),
    model: {
      base_multiple: s.base,
      growth_multiplier: s.growth,
      maturity_multiplier: s.maturity,
      reach_multiplier: s.reach,
      growth_pct: s.p.change_7d,
      category_peers: s.peers,
      age_assumed: s.ageAssumed,
    },
    farm_steps: farmPlan(s.p, s.ageUsed, s.ageAssumed),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));

  const multiples = [...calibration.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: round4(v.multiple), peers: v.peers }))
    .sort((a, b) => (a.category < b.category ? -1 : 1));

  const data: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    rows: board,
    live,
    model_info: {
      global_multiple: round4(calibration.global),
      multiples,
      product_categories: [...PRODUCT_CATEGORIES].sort(),
    },
  };
  return { board, data };
}

/** Parse and shape-check the snapshot text; throws on anything the model cannot score. */
export function parseSnapshot(text: string): Snapshot {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || typeof o.source !== 'string') throw new Error('snapshot lacks as_of/source');
  if (typeof o.floor_usd !== 'number' || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) {
    throw new Error('snapshot lacks floor_usd/protocols/watchlist');
  }
  const protocols = (o.protocols as Record<string, unknown>[]).map((p) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: typeof p.tvl_usd === 'number' ? p.tvl_usd : 0,
    change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  }));
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: (o.watchlist as unknown[]).filter((s): s is string => typeof s === 'string'),
  };
}

/** A gate-shaped reason the board would be refused, or null when it passes locally. */
export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows; the gate wants 100 to 4,000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!known.has(row.slug)) return `row ${row.rank} names ${row.slug}, which the snapshot does not list`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.name.trim() === '') return `row ${row.rank} has an empty name`;
    if (!Number.isInteger(row.rank) || row.rank <= 0) return `row for ${row.slug} has a bad rank`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${row.slug} has a bad implied value`;
    if (row.implied_value_usd > 100_000_000_000_000) return `row ${row.slug} implies over the $100T cap`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters`;
    }
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `ranks are not exactly 1..N (rank ${i + 1} is ${byRank[i]!.rank})`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${i + 1}`;
    }
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every implied value is the same';
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  return null;
}
