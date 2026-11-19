# CoinDuel Blockly Editor (GitHub Pages)

This folder is the **permanent** web editor host.

After Pages is enabled, open:

**https://meyyds34555343.github.io/LiteProjects/**

Source of truth for edits: `CoinDuel2D/tools/blockly-public/` — copy into `docs/` before each publish, or edit `docs/index.html` directly then sync back.

---

## Also in this folder

| File | Page |
|---|---|
| [`index.html`](index.html) | Blockly Mod Editor (root) |
| [`art-checker.html`](art-checker.html) | **Art Checker** — https://meyyds34555343.github.io/LiteProjects/art-checker.html |
| [`art-core.js`](art-core.js) | The art pipeline engine, ported to JavaScript |

### Art Checker

A static page that runs the whole art pipeline in the browser: drag in a raw
AI-generated PNG, get white-background removal, deterministic QA, and the 2.5D
paper-cut finish (bevel + `+4/+6` shadow), then download the result.

- **Nothing is uploaded.** All pixels stay in the tab — there is no server call,
  no account, no API key. Safe to share publicly.
- **No install.** Works on any device with a browser, including phones and
  tablets; no Python, no `.exe`, no Google account.
- **Same algorithm as `coinduel_art_pipeline.py`.** `art-core.js` is a faithful
  port, including Pillow's triangle-filter resample geometry. Verified by
  `tools/art_pipeline/test_js_parity.js`, which runs both implementations over
  the same pixels and compares verdict, fill ratio, centering, solidity,
  clipping and the cutout method.

Thresholds come from `Style_Rules` in the Google Sheet and are mirrored in the
`PRESETS` table inside `art-core.js`. If you change a rule in the sheet, update
`PRESETS` and rerun the parity test — the two must not drift apart.

Known limits, stated plainly:

- Not a substitute for the n8n path when you need **Drive + Sheet write-back**.
  This page is pass/fail + a downloadable PNG; it does not touch your Drive.
- Chromium's image smoothing is used for the final downscale, so output PNG
  bytes are not identical to Pillow's — the *verdict* and *metrics* match, the
  encoder differs. Use the Python path for byte-reproducible assets.
- `board_frame` window punching is implemented, but a heavily-textured frame may
  need a threshold tweak that the page does not expose.
