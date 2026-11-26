# Browser gates and harness sheets

The hand-run browser gates (not npm scripts: they drive a real build or dev
server in a real browser) and the harness-sheet conventions. These paragraphs
moved word for word out of `AGENTS.md`'s Commands section when the file was
split to fit smaller context windows. `AGENTS.md` keeps the npm commands, the
X-cookie and quiet-machine rules, and a one-line index of these gates.

The escape-time family's in-app gate (not an npm script — it drives a
real build in a real browser): `npm run build && npm run preview &` then
`node scripts/escape-family.verify.mjs --mode=x11::0`. It loads every preset in
the Escape-time menu group FROM THE MENU, enters Surface, waits on the
`?surfacestate` settle latch and checks four things no unit test reaches: that
each preset enters unaided; that the members of each trio render DIFFERENT
objects; that `PRESET_FINALS` installs and clears in both directions, read out
of the `#v1=` document hash rather than the panel; and WHICH ENGINE each
session takes — measured compute for all nine, which is what keeps the
`core:"bulb"` WGSL kernel from being dead code. It also gates the empty-set
toast, the `antialiasing pass k/8` disclosure, and that a TRUSTED CLICK lands
mid-settle. `--mode=sw` runs everything
but the engine question without a display.

The 4D lifts' gate and the nonlinear slab's reload/capture gate:
`node scripts/surface-4d-lift.verify.mjs --display=:0` and
`node scripts/surface-slab-4d.verify.mjs --display=:0`. Both drive real
builds in real browsers, enter Surface FROM THE UI, and gate the session
latch, DRAW and the compute engine; the lift gate's three cover-class
thickness phases must reproduce zero thickness BYTE FOR BYTE, and the slab
gate pins the share link's carried thickness, a real reload's byte-exact
frame and the thick export. Fixtures, measured rows and history:
`docs/4d-exploration.md`, `docs/surface-slice-thickness.md`.

The 4D explorer balloon gate is self-contained:
`node scripts/explorer-balloon-4d.verify.mjs`. It drives Pentatope through
Points, parks the tumble, enables the echo, reloads the app's own copied link,
then compares real SwiftShader canvas frames with the restored echo on/off.
That one path gates the non-flat controls, boot-time ball-uniform sync and the
project-then-invert shader compile/render together. IT COMPARES THE SCENE
REGION, NOT THE FRAME, at a radius the DOCUMENT carries and where the echo is
on screen. It still does NOT separate project-then-invert from
invert-then-project; that needs a rotor pose where they visibly disagree. The
wrong-radius correction and measured record live in the script header.

Sphere-inversion gates (built, `npm run preview`):
`node scripts/sphere-inversion-family.verify.mjs --mode=x11::0` (`--mode=sw`
subset): each preset FROM THE MENU through compute settle, distinct objects,
`#v1=` block, byte-exact link reload, tiled export, `?surfacegl` IoU,
Flame/Solid/4D refusals; `-glass.verify.mjs` the Glass starters + glass
backend, Classic control, 4D slice scrub. Record: the family doc.

The panel's exact-numeric-companion gate (not an npm script — it needs
layout and TRUSTED touch, neither of which jsdom has):
`npm run build && npm run preview &` then
`node scripts/panel-numeric-control.verify.mjs [--viewport=WxH]`. It walks
the states that MINT sliders — eleven families are hand-built at render
time, where the spec table's jsdom pin cannot see them — and gates
completeness, availability parity, 44px targets over unclipped domains,
trusted tap/scroll, and Tab/Arrow/Escape/refusal read out of the `#v1=`
hash rather than the panel, which can disagree with the document. The figures
and caught refusal defect live in the script header. Not verified on WebKit or
Firefox Android.

**Harness sheets** (`scripts/*.harness.ts`, run with
`npx vitest run --config scripts/vitest.harness.config.ts scripts/<name>`)
are this project's executable measurement records — the argument for a
decision, kept runnable rather than summarized. Two shared instruments
carry the rules. `scripts/de-preview.ts` is the SHARED renderer eight of
them import (`renderPreview`, `writeContactSheet`, `encodePng`, and the
`DistanceEstimator`/`PanelStats` vocabulary): a CPU sphere-marcher with
AO/shadow switches, a settable step budget and an always-counted
`exhausted`, so a new sheet writes its estimator and its panel list, NEVER
a ninth marcher. `de-preview-parallel.ts` schedules that SAME marcher
across worker threads behind a data factory — byte-identical tiles pinned
per adoption, 4.1x measured on chain-speckle (`docs/gate-velocity.md`) —
still not a marcher. `scripts/set-extent.ts` is the other: the ONE
definition of "how much of a ball does this set fill, and how far out does
it reach", against a MEMBERSHIP oracle the caller supplies and never a
threshold on a distance — the fill/reach mechanics and the five-copies
story they corrected are `docs/harness-sheets.md`'s. Output lands under
`scripts/out/`, which is gitignored —
regenerate rather than commit megabytes of PNG.

The catalogue of sheets and what each one's verdict was is in
`docs/harness-sheets.md`.

Reproduce the COOP/COEP first-visit reload locally:
`node scripts/isolation-reload.verify.mjs` —
serves the production build over a plain static server with no COOP/COEP
and a deliberately delayed `sw.js`, widening the reload window on demand;
`npm run preview` can trigger the same dance, but only at real localhost timing.

The post-deploy live-site gate: `node scripts/live-site.verify.mjs [url]`
boots the deployed origin (default https://fractal-4d.com) in headless
SwiftShader Chromium and asserts HTTP OK, app boot (`#pointCount` > 0,
`#error` empty), COOP/COEP (`crossOriginIsolated` true post-reload), a
controlling SW, no console errors; exit 2 is a CHECKING failure
(browser/network), not a verdict — rerun. `deploy.yml` runs it
automatically as `verify-live`; hand-run it for another origin, or outside
a deploy (DNS/Pages changes, diagnosing a report against production).

The post-deploy live 4D preset sweep: `node scripts/live-4d-presets.verify.mjs
--mode=sw --tier=fast` (deploy.yml's `verify-live-presets`) drives the six 4D
presets FROM THE MENU on the deployed origin and asserts entered-compute +
first frame; the settle is asserted on the real-driver arm
(`--mode=x11:<display>`) and disclosed on SwiftShader, whose wall is past any
CI window. Record: the script header.

The WebGPU compute-surface and flame teardown gates (not npm scripts — they
need a real Firefox build with WebGPU enabled on a display, and they gate
renderer LIFECYCLE rather than built output, so the dev server hosts them):
`npm run dev &` then `node scripts/surface-teardown.verify.mjs --lens
--toggleId=__modeExit --toggles=20` and `node
scripts/flame-teardown.verify.mjs --toggles=12` — each restarts or exits a
live session while a frame is still parked on submitted GPU work, which used
to take down the whole Firefox process rather than the tab. Exit codes, the
flame gate's INCONCLUSIVE channel, and the measured verdicts (regression
gates, not reproductions, on this stack) in
`docs/surface-compute-renderer.md`.

The flame Save-PNG gate (not an npm script — it asserts what a
downloaded IMAGE contains, which no unit test reaches):
`npm run build && npm run preview &` then
`node scripts/flame-export.verify.mjs https://localhost:4173`. Every saved
PNG is asked only which pinned reference it is closer to (the POINTS cloud
or the converged FLAME; SOLID's phase, the TRACE) and whether it landed only
once the accumulation FINISHED. Record and figures: `docs/architecture.md`.
