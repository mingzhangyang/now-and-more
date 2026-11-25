# Sky Engine in Now, and More (M4)

now-and-more does not keep its own copy of the sky algorithms. Star positions
and the watercolour illustration come from one pinned build of the Sky Engine
SDK. Elsewhere (`mingzhangyang/elsewhere`, `packages/sky-engine`) is the only
place those algorithms are edited. This repo owns the card, the evening-time
rule, the place guess, the clear-sky disclosure, and the signature asterisms.

## Pinned release

| | |
| --- | --- |
| Version | 0.2.0 |
| Tag | `sky-engine-v0.2.0` |
| Source commit | `c177b659cf1bc5200698c11d3ec408890fbcc297` (Elsewhere `main`) |
| Release | https://github.com/mingzhangyang/elsewhere/releases/tag/sky-engine-v0.2.0 |
| Files | `vendor/sky-engine/0.2.0/` |

Those five files are the release artifacts, byte for byte. Do not reformat or
patch `sky-engine.mjs` or `stars.json`. Licences travel with them:
`sky-engine-NOTICES.txt` (MIT source, CC BY-SA 4.0 HYG catalog, dependency
notices). The page never fetches Elsewhere, GitHub, or an npm CDN at runtime.

Check a checkout:

```sh
cd vendor/sky-engine/0.2.0
sha256sum -c SHA256SUMS --ignore-missing
```

`SHA256SUMS` also lists the npm tarball, the optional landscape archive, the
optional Moon-texture archive, and `moon-lroc.jpg`. This site does not vendor
those. Illustrations use the procedural `ridge` landscape. The moon card is
still the synodic glyph, not `renderMoonPhase`, so the NASA texture stays out
of the precache. `stars.json` is the same bytes as 0.1.0.

## Who does what

`js/sky-engine-adapter.js` loads the ESM and `stars.json` once, joins concurrent
catalog loads, caches a handful of scenes (keyed by place and minute), and
paints a canvas. A failed load is cleared so the card can retry. It does not
fall back to a second engine.

`js/app.js` still decides:

- Chart: the visitor's time zone, the matching city among the 42, or latitude
  35° and the zone's longitude. The card still says the position is estimated.
- Illustration: a session geolocation fix if one was already granted, otherwise
  one of the 42 cities at that city's own 21:00. No new permission is requested
  beyond the existing illustration prompt. The paper names a city or "where you
  are", never coordinates.
- Evening rule: 21:00 local, or the current time once 21:00 has passed.
- Weather: clear-sky assumption (`weather: "clear"`), not a forecast.
- Signature asterism: `SKY_PATTERNS` in `js/data.js`. Edges are real `hyg-N`
  ids. The choice (in season, mostly above the horizon, vector average so a
  pattern can cross azimuth 0°) stays here. If none qualifies, the illustration
  keeps a fixed view (south in the north, north in the south, altitude 30°,
  fov 66°) instead of Elsewhere's automatic framing.
- The circular chart is a product planisphere. It plots SDK altitudes and
  azimuths. It does not recompute them.
- Moon-glyph card, sunrise/sunset on world cards, solar terms, and tropical
  astrology are unchanged and are not the SDK.

Chart and illustration for one draw share one `createSkyScene` result, so the
Sun, Moon, planets and stars cannot disagree between those surfaces.

## Service worker

Cache name `nam-v30` precaches `sky-engine.mjs` and `stars.json` for this exact
directory, plus the adapter. Activating the worker deletes every other cache
name, so an older shell cannot pair a new module with an old catalog. The
version lives in the path (`0.2.0`), not in `latest`. 0.1.0 was never on
`main`; this branch replaces that directory instead of keeping both.

## Upgrade

1. Confirm the Elsewhere release workflow is green and the tag is on `main`.
2. `node scripts/update-sky-engine.mjs sky-engine-vX.Y.Z`
3. Point `BASE` in `js/sky-engine-adapter.js` and the precache URLs in `sw.js`
   at `vendor/sky-engine/X.Y.Z/`. Record the new source commit in the adapter
   and in this file.
4. Bump `nam-vN` and every `?v=N` in the same commit.
5. Re-pin `tests/fixtures/sky-scenes.json` only if the new engine is supposed
   to move those positions; otherwise the fixture test should stay green.
6. `node --check` the scripts listed in `.github/workflows/dedup.yml`, then
   `node --test tests/*.test.cjs`.
7. In a browser: day, twilight and night; both hemispheres; a pattern that
   crosses north; moon up and moon down; illustration and chart; offline reload
   after one online load; a failed fetch then retry.

## Rollback

Keep the previous `vendor/sky-engine/<old>/` directory (or restore it from the
old commit). Point the adapter and the service worker back at it and bump
`nam-vN` again so clients do not mix directories. Do not point runtime URLs at
`main`.

## What M5 can reuse

`tests/fixtures/sky-scenes.json` is seven fixed observers (night, twilight,
high latitude summer, both hemispheres, the equator) with sun, moon, five
bright stars and the five naked-eye planets, checked against this exact SDK
build in `tests/sky-sdk.test.cjs`.

Screenshots from the 0.1.0 browser pass (day, twilight, night, both
hemispheres, a pattern across north, moon up and down, chart, illustration,
keepsake, offline reload, failed fetch then retry) are in
`docs/sky-engine/evidence/`. The 0.2.0 bundle keeps the same catalog and the
same fixed-scene positions; those pictures still show this card. A later
switch to `renderMoonPhase` would need `moon-lroc.jpg` and a new pass.

