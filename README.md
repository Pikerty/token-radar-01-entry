# token-radar-01-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Pikerty/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Pikerty/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's **token-radar-01** bounty ("Build the best token launch
radar", $1,325 in USDC). The program reads one sealed DefiLlama snapshot of the
protocol universe (758 protocols at or above $5M TVL) and builds a **token
launch radar**: it ranks the protocols that record no token yet by an implied
value for a hypothetical future token, gives every ranked protocol a concrete
farm plan with costs and durations, and presents the board as a static
dashboard. The board carries 197 pre-token protocols and covers all 40
protocols on the snapshot's watchlist; protocols whose token already trades
are never ranked — they appear separately, as the market-priced comparison
set the model is calibrated against.

## The model — "radar-2"

Every figure comes from the snapshot itself; no protocol is named anywhere in
the model.

```
implied value = TVL × category multiple × growth × maturity × reach
```

- **Category multiple** — for each category, the median market-cap/TVL ratio
  of the protocols in that category whose token already trades: the market's
  own pricing of that kind of business. Categories with few live peers are
  shrunk toward the global median (four phantom peers at the global figure),
  and every multiple is clamped to [0.05, 2]. A category with no live peer
  prices at the global median.
- **Growth** — damped 7-day momentum: a third of the 7d TVL change, clamped
  to −50% / +100%; a missing change counts as neutral and is flagged on the
  row.
- **Maturity** — an age curve rising from 0.65 to 1.00 over about two years:
  a protocol that has run for years with no token is a stronger launch
  candidate than a two-week one. Unknown age uses the board's median age and
  is flagged on the row.
- **Reach** — a small bonus for multi-chain presence (distribution already
  built before launch), capped so it can never dominate.

Each row prints its full factor breakdown, rounded before use, so the
arithmetic on the row reproduces its implied value exactly. Bridged or
wrapped forms of trading tokens, staking wrappers, bridge and CEX categories,
and version-suffixed or exchange-prefixed names are excluded from ranking by
the watchlist's own product rules, applied at every size — otherwise the top
of the board would be occupied by bridged forms of tokens that already exist.

## Farm plans

Every ranked protocol gets a six-step farm plan generated from its own
record: category-specific core actions (19 templates), gas figures for its
chain (14 chain mappings plus a default), capital tiered by the protocol's
TVL, a second-front step for multi-chain protocols, a hold window scaled to
its age, and a category-specific risk note. Every step states a cost and a
duration.

## The dashboard

A static page in a dark "radar scope" design — sortable and filterable board
(search, category, chain, TVL band, watchlist-only toggle), a per-protocol
detail view with the factor equation and factor bars, the live-token view
that explains the calibration, and a model panel stating the formula, the
four factors, the rankability rules and the full calibrated multiples table.
No network, no framework.

## Layout

- `main.ts` — the entrypoint (Node 22, standard library only). Reads the
  snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/`
  and `dossier.json`.
- `lib/model.ts` — the value model, farm plans and board validation.
- `dashboard/` — the static page (no network, no framework).
- `screenshots/` — the board, a detail view and a filtered view, as the
  judge sees them.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored from
  the kit.

## Run it locally

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

Two runs over the same snapshot produce byte-identical output.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=mpwgq2aa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
