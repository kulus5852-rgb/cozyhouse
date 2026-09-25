# Rainy Day Cottage — a cozy house simulator

A first-person, walkable 3D cottage on a rainy evening, delivered as one self-contained HTML file: `cozy-house.html`.
Everything is procedural: geometry, canvas textures, rain, fire and WebAudio-synthesised sound. The only download is
three.js r170 from the jsDelivr CDN, so the first launch needs an internet connection.

## Play

Open `cozy-house.html` in a desktop browser (Chrome, Edge or Firefox) and click to step inside.

| Key | Action |
|---|---|
| W A S D / arrows | walk |
| Shift | run |
| C / Ctrl | crouch |
| Space | jump |
| E / left click | interact (sit, lamps, doors, fire, kettle, record player…) |
| Q / left click | sip your tea (while holding a mug); E sets it down |
| F | flashlight |
| T / R | time of day / rain intensity |
| M | mute |
| H / Esc | help / pause and settings |

Things to try: light the fire or add a log, put the kettle on and make a cup of tea, play a record, curl up on the
window seat, pet the cat, check the grandfather clock, climb to the loft, lie on the bed under the skylight, switch
the string lights, then open the front door and walk down the garden path in the rain.

## Build and test

```sh
node tools/build.mjs                  # inlines src/*.js into cozy-house.html
cd tools && npm ci && cd ..           # puppeteer-core for the headless tools
node tools/shot.mjs --views all       # screenshots + runtime error report (shots/)
node tools/walktest.mjs               # deterministic walking / collision tests
node tools/conformance.mjs            # core API conformance
```

The headless tools use an installed Chrome/Edge on Windows. Elsewhere, set `CHROME_PATH` or install Chrome for Testing
with `npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/cozy-chrome`. Machines without a GPU
fall back to SwiftShader, which is slow; use small shots such as `--w 640 --h 360 --params quality=low`.

`SPEC.md` is the module contract: file layout, core API, world layout, lighting budget and per-module ownership.
