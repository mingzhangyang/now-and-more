# Sky Engine browser evidence (M4)

Chromium (Playwright 1.64), page served same-origin on 127.0.0.1 with
`text/javascript` for `.mjs`. Phone shots are 390×844. These are the pinned
scenes in `tests/fixtures/sky-scenes.json`, not a second ephemeris. Every
fixture scene matched the vendored bundle: sun/moon altitude and azimuth
within 0.02°, phase and visibility exact, provenance `clear`, 5070 stars.

The pictures were taken on 0.1.0 (`nam-v29`). Sky Engine 0.2.0 keeps the same
`stars.json` and the same seven scenes (the fixture test now runs against
0.2.0). The watercolor card was painted again from that bundle and still
matches these shots. The live cache is `nam-v31`. The circular chart and the
moon card now use `renderSkyChart` and `renderMoonPhase` (`17`, `18`, `19`).

| Shot | What it shows |
| --- | --- |
| 01 chart, Gaithersburg night | Planisphere, Cassiopeia across north (azimuths 342–13°), moon up, approximate-position line |
| 02 illustration, same instant | Same scene painted by the SDK. No approximate-position line. Cassiopeia, Milky Way, ridge |
| 03 day (forced noon) | Sunlit sky. Product cards still use 21:00 local; this only checks the daylight palette |
| 04 Reykjavik, sun on the horizon | Twilight. Summer Triangle. Moon below the horizon, so no moon disk |
| 05 Sydney, winter evening | Southern Cross |
| 06 Quito, midnight | Summer Triangle crossing north |
| 07 Anchorage, December | High latitude, Cassiopeia |
| 08 Johannesburg chart | Orion in the west, moon down, approximate-position line |
| 09 Singapore evening | Orion in the east, sun about −11° |
| 10 moon-glyph card | Synodic glyph, not the SDK |
| 11 keepsake | 1080×1700, painting plus the place and highlight lines |
| 12 landscape viewport | Card stays 3:4; the bitmap is not cropped away |
| 13 failed fetch | “The sky did not load this time.” and Try again. No second renderer |
| 14 after Try again | Same card, Cassiopeia, 5070 stars (473 ms from the click) |
| 15 offline reload | After the `nam-v29` precache, airplane mode, same night painting |
| 16 v0.2.0 night | Same Gaithersburg instant painted by `sky-engine.mjs` 0.2.0 |
| 17 SDK chart | `renderSkyChart`, midnight, Cassiopeia caption, calculated-position footer |
| 18 full moon | `renderMoonPhase`, NASA texture, 99% illuminated |
| 19 thin crescent | Johannesburg equinox evening, 4% illuminated, earthshine on the dark side |

Startup did not request `sky-engine.mjs` or `stars.json`. Only the 5 KB adapter
is a script tag. The module and catalog load with the first sky card, and the
service worker precaches that exact directory.

Measured on this machine, local server (no CDN):

- Cold chart, including parsing the module and the catalog: 268 ms
- Illustration once the catalog is resident: about 150–240 ms
- Repeat of the same minute: scene cache hit (0 ms, same object), paint about 154 ms
- JS heap about 3.4 MB at load, about 27 MB after several full scenes

`node --test tests/*.test.cjs` — 48 passed, 0 failed. The node suite checks the
published SHA-256, that every pattern id exists in `stars.json`, that the old
painter symbols are gone, and that these seven scenes still match.
