# Horoscope V3.3 — three time scales

**Scope:** editorial entertainment scores; no prediction accuracy is claimed. V3.0 local civil-day quadrature, V3.1 aspect dynamics and event ownership, and V3.2 traditional solar houses, normalized roles, symmetric pair weights and existing placements remain unchanged. No new planets or ephemeris.

## Definition

After applying V3.2 roles and the original signed aspect cap, classify each non-aspect factor and each capped endpoint aspect exactly once:

| Factor | Layer |
|---|---|
| Jupiter/Saturn relation, dignity, retrograde, domain-house bonus | Background |
| Jupiter–Saturn aspect | Background |
| Moon placement or any aspect involving Moon | Daily |
| Solar condition (including combustion/cazimi), nonlunar remaining aspects, other placements/retrograde | Trend |

A pair is classified by the pair, not by its endpoint or instantaneous relative speed; stations do not switch a pair's layer. Cazimi and combustion use the same solar-condition layer. Exact events retain their existing explanatory role and add no points.

The sample ledger stores body, partner, factor, angle, domain, layer, original V3.2 capped/normalized contribution, coefficient, any extra cap scale, adjusted contribution and actual sample epoch. The daily sample list retains the seven positions. Day weights are actual elapsed interval durations. Original and adjusted layer totals sum to the corresponding raw score (roundoff aside). Absolute contributions are sums of absolute atom values, not absolute net totals. Overall totals are the arithmetic mean of the four domains. Stars are converted once, using the unchanged conversion.

Gain configuration (provisional): background 0.95, trend 0.95, daily 1.20; existing V3.2 role scale 0.2 and pair scale 0.5 remain. The explicit V3.2 model remains callable. All time gains 1 restore the original calculation exactly, including the original aspect component. No per-sign compensation and no rescaling of missing layers.

If mixed gains unmask signed cancellation or exceed the original endpoint net aspect cap, multiply all of that endpoint's adjusted aspect atoms by the same nonnegative factor to keep the net within ±0.9 before role normalization (equivalently ±0.9 times the domain share). This is the only nonlinear exception to the linear three-layer sum. Solar conjunction exclusion, caps and pair weights remain before layer gains; no event bonus.

The full reader retains existing four domain ratings and shared evidence. It adds layer totals in raw units, significant integrated representative contributors with their actual sample, and net change from yesterday by layer. Representative contributors are grouped by domain/endpoint/factor/angle; the selected sample has the direction of the integrated contribution. Yesterday is computed deterministically, reusing it in advice replay where needed; no rolling window and no visit history. The advice library and its seven-day uniqueness mechanism are unchanged. The main card adds no star ratings.

## Parameter experiment and audit

Use a full Git checkout with the independently pinned V3.2 commit:
```sh
TZ=UTC node scripts/horoscope-v3.3-backtest.cjs > horoscope-v3.3-backtest-full.json
node --test tests/horoscope-v3.3.test.cjs
node --test tests/*.test.cjs
python tests/card-focus.browser.py
```

Train on 2021–2025; hold out 2026–2030. The grid contains 75 gain triplets. Selection requires nonneutral background/trend/daily gains and preserves overall sign low-share gap < 0.09, central-star share < 0.55, nonzero 1-star share, 5-star share > 0.015, mean-star drift <= 0.10, same-day separation >= 95% of baseline, adjacent raw change 99–120% of baseline, jump rate no more than baseline + 0.025 and domain-correlation differences < 0.06. Among eligible candidates minimize squared distance to the reference absolute shares 20/45/35 with coefficient regularization and mean-star drift penalty. These are design constraints, not evidence of predictive validity. The all-neutral case was also tested; background is already damped, so the provisional selected adjustment is deliberately mild. The held-out runner reports A (neutral), B (background only), C (daily only), D (shipped three gains), E (trend only), detailed per-sign/domain distributions, changes, streaks, lag correlations, layer net/absolute/delta/dominance, role concentration and timed production sampling.

[Local numerical experiment](horoscope-v3.3-backtest.json): 3,652 days in two disjoint intervals, 12 signs and four domains. The selected 2026–2030 candidate changed the overall daily raw difference from 0.1540 to 0.1745, adjacent star change from 30.39% to 34.01%, same-star mean run from 3.29 to 2.94 days, and slow-body absolute factor share from 27.36% to 26.46%. The 2+ star jump rate rose from 0.35% to 0.68%; longest unchanged run stayed 38 days. Low-share sign gap fell from 5.31 to 4.82 percentage points. Daily layer contributes 74.88% of absolute net day-to-day layer changes vs 70.97%. No requirement to force target shares.

**Verification limit:** the environment could read GitHub through its connector but could not clone it into Node. The supplied experimental data and direct 109,560-item neutral check use a locally transcribed subset of the current scoring and ephemeris source, not a byte-identical checkout. The local V3.2 baseline overall counts (225/3362/11575/6304/446) differ slightly from the previous committed report (227/3353/11591/6293/448). The selected gains are consequently provisional pending the pinned-checkout runner and CI. The runner obtains the actual old Git objects, compares its compact evaluator with the production scorer and reports whether the training selection matches the shipped candidate. Local direct scoring averaged about 0.382 vs 0.622 ms per sign-day; the largest observed serialized scoring snapshots were 355,379 vs 517,401 characters. These measurements omit full advice, browser and mobile behavior; the repository runner includes full makeHoroscope, warm cache, batch and serialization benchmarks. Do not interpret the local subset as a full Node/browser/PWA pass. The added real-browser regression uses the production scripts and actual stage/reader modal in the existing browser CI job.
