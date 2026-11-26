# V3.2 five-year ablation

Pinned V3.1 baseline: 74519fb4f70ef4a0ba1b71b13948e7c173e9e494. UTC 2026–2030, 21912 sign-days. Disabled model matches baseline stars; maximum raw error 6.6058269965196814e-15.

| Model | House scale | Pair scale | Changed overall stars | Weight HHI | Slow-body absolute share | Same-day overall SD |
|---|---:|---:|---:|---:|---:|---:|
| A | 0 | 0 | 0.00% | 0.3151 | 27.46% | 0.2505 |
| B | 0.2 | 0 | 3.77% | 0.2791 | 27.07% | 0.2375 |
| C | 0 | 0.5 | 0.47% | 0.3151 | 27.50% | 0.2506 |
| D | 0.2 | 0.5 | 3.81% | 0.2791 | 27.12% | 0.2376 |
| E | 0.5 | 0.5 | 8.49% | 0.2484 | 26.73% | 0.2247 |
| F | 1 | 1 | 14.56% | 0.2294 | 26.38% | 0.2138 |

D uses reduced house strength to limit domain convergence relative to E and F. Pair weights remain secondary. See JSON for domain distributions, correlations, streaks, body and pair contributions. These are internal entertainment-model metrics, not predictive validation.

Executed actual model source in V8, not Node or Chromium. Heap measurements unavailable. Reproduce with `TZ=UTC node scripts/horoscope-v3.2-backtest.cjs 2026-01-01 2031-01-01`. Full CI validation remains required.
