# Gate velocity

The epic's question: why does the edit-to-verdict loop cost minutes of
orchestration around work the machine barely spends rendering, and what can be
amortized once instead of per gate? This doc owns the warm gate runner
(`npm run verify`) — its design, its registry, and the measured accounting of
what the shared session actually saves. The frame cache, fast tier, parallel
previews and the affected-gate map are later children of the same epic and
will be recorded here (or in their own docs) as they land.

## The problem, measured

The unit suite is healthy (~145s wall, parallel workers); the cost center is
the gate fleet around it:

- 65 browser verify gates. 52 expect the caller to leave
  `npm run build && npm run preview &` running (the built app is what they
  drive; `scripts/lib/dist-freshness.mjs` REFUSES to measure a stale dist),
  8 spawn their own dev server, and every gate launches its own browser with
  per-scenario contexts plus its own GPU-contention baseline — even gates run
  back-to-back against the same build.
- Each edit cycle pays a full production build again before any gate will
  run.
- Nothing is cached: every gate and sheet re-renders from scratch, even when
  build, scene document and pose are byte-identical to the previous run.

## The warm gate runner

`npm run verify -- [--mode=x11::0|sw] [--preview-port=N] [--fresh] [--watch]
gate [gate ...]` (scripts/verify.mjs) builds once, serves `dist/` once, takes
the machine-quiet baseline once, launches ONE Chromium per browser signature,
then runs the named gates SEQUENTIALLY as child processes that CONNECT to
that browser over CDP instead of launching their own. GPU work stays serial
per the quiet-machine rule; each gate's exit code and verdict output are
unchanged.

### How a gate joins the session — the runner's side

The handoff is two environment variables the orchestrator sets on every gate
it spawns (`GATE_BROWSER_CDP`, `GATE_BROWSER_SIG`), and
`scripts/lib/surface-browser-runner.mjs`'s `launchSurfaceBrowser` consults
them at its existing call site: a gate's own code does not change to join,
and with no orchestrator running the variables are absent and every gate
behaves exactly as before (standalone is untouched and remains the record's
shape — the orchestrator is opt-in).

`browserSignature(mode)` is the single gatekeeper: a SHA-1 fingerprint of the
display plus the exact launch arguments `surfaceLaunchOptions(mode)` builds.
The orchestrator advertises the signature of the browser it actually
launched; a gate whose desired signature differs — a different mode, or a
gate with private launch options — falls back to its own browser with a
one-line note, so mode semantics stay exact and the runner never has to know
a gate's private options. A malformed or stale variable likewise falls back
to standalone rather than failing the gate: the orchestrator's env is an
optimization, never a contract a gate must enforce with an exit code.

The gate's own quiet baseline STILL samples per run (cheap, and the
certification is per-run by design); in the shared session it is taken after
the connect — the browser is already up and idle, the connect adds no GPU
work, and a leaked busy page from a previous leg would name itself in the
per-process attribution. Standalone keeps the original sample-before-launch
order.

### Isolation: Chromium's, not ours

Measured directly (two throwaway probes, 2026-10-01, Playwright 1.63 over
CDP):

- A gate process that exits WITHOUT cleanup — `process.exit(1)` while holding
  a context with a live page — leaves the DevTools `/json/list` target list
  EMPTY: Chromium destroys the browser contexts a disconnected CDP client
  created within ~200ms. A crashed gate cannot leak contexts into the next
  leg's session.
- `browser.close()` on a `connectOverCDP` client only DISCONNECTS — a gate's
  ordinary cleanup cannot kill the shared browser (the launch process keeps
  serving `/json/version` after the client closes).
- A LIVE client's pages ARE visible to another client over the same
  connection (`contexts()` lists them), which is the monitoring surface a
  later child (pre-warm daemon) would use.

The orchestrator still recycles the browser (close + relaunch) after any gate
exits nonzero, as cheap insurance against a wedged GPU context a fresh page
might inherit — demonstrated end to end: a "gate" that joins, loads the app
in a fresh context and hard-exits (exit 1) does not stop the NEXT gate from
passing on the recycled session.

### The preview server and the port

The orchestrator serves the project's own vite preview programmatically on
the default port. If the port is already serving THIS build's exact entry
asset — the caller's leftover `npm run preview`, the muscle memory half the
gate headers teach — it is ADOPTED rather than fought; anything else on the
port is refused (exit 2) with `--preview-port` as the way out. vite preview
reads dist/ per request, so one server outlives any number of rebuilds.

### The registry

`scripts/lib/gate-registry.mjs` is the side table naming which gates the
orchestrator can drive and how each one wants to be told the mode and URL.
The update rule is the preset side tables' rule: adding a gate means adding
its entry in the SAME change — an unlisted gate still runs by explicit path
but silently forgoes flag forwarding, which only matches the defaults when
the preview server holds the default URL. Explicit paths always run with no
forwarded flags (their own defaults apply).

Registry entries for the shared-runner gates are in; gates that launch their
own dev server (the teardown gates), pin private launch options
(surface-repro's ANGLE-GL SwiftShader), or hardcode non-default URLs are
deliberately absent — they work standalone exactly as before and skip under a
contradicting orchestrator mode.

### The edit loop: `--watch`

`--watch` keeps a `vite build --watch` child running; its first build is the
run's build, and every completed rebuild re-runs the gate list against the
same warm server and browser. A gate leg overlapping the tail of a rebuild
can see a half-written dist/ and fail; the next rebuild re-runs it — the
loop's failure mode is a delayed re-verdict, never a false one.

## Measured accounting

Machine: AMD RX 7900 XTX (radeonsi), Chromium 153, Playwright 1.63,
production build at `gate-velocity-warm-runner` branch, 2026-10-01. All runs
machine-quiet per the per-process baseline.

- Cold `vite build`: 7.0s on this box (the ~40s figure in the epic's
  description is the CI/older-machine number; record both, the win scales
  with the machine).
- `vite build --watch` rebuild after a one-line source edit: 4.7s.
- Browser launch (SwiftShader headless): 116ms; headed real-driver boot in
  the warm session: 0.2-0.3s. The quiet baseline: ~1.4s per sample.
- Three gates back-to-back (`tiling-symmetry`, `surface-lighting-ui`,
  `final-swirl-radius`, all real-driver x11::0): warm session 155.4s
  (legs 56.5 + 19.9 + 77.4) vs the same three standalone 145.5s — the
  amortized overhead (2 boots + 2 baselines ≈ 5s) is REAL but smaller than
  the run-to-run noise of the legs themselves on this box; the gates' GPU
  work is identical either way. On this machine the per-gate saving is
  ~1.6s of boot+baseline, not minutes.
- The Mesa GLSL link cliff (~25s per gate, documented on the Iris/i915 box)
  does NOT reproduce on this box (swirl-glsl, which compiles the surface
  tracer programs: 5s per run). The shared browser's shader-cache
  amortization is a machine-dependent win — free where the cliff is real,
  nothing where it is not.
- SwiftShader class: `surface-light-guides` (69.5s) +
  `surface-lighting-ui` (21.4s) warm-session legs pass unchanged.
- Crash isolation through the orchestrator: demonstrated (see above).
- Watch edit cycle: edit → 4.7s rebuild → gates re-run automatically, no
  manual build/preview dance.

HONEST VERDICT: on THIS box the warm session's savings for compute-class
gates are modest — legs dominate, boots are ~0.2s, baselines ~1.4s. The
structural wins that hold on every machine: the edit loop is automatic and
incremental (no manual build+preview+wait), one session serves N gates (the
win scales with machine slowness and with WebGL-arm gates on drivers that pay
the link cliff), a leftover preview is adopted instead of re-done, and the
gates themselves are untouched. The BIG lever is the frame cache below: a
settled frame is a pure function of its inputs, and the legs that dominate
these walls are exactly the work a cache skips.

## The frame cache

The epic's enabling fact: byte-exact, deterministic rendering behind the
settle latch makes a settled frame a PURE FUNCTION of its inputs, so settled
render work is memoizable, and a failed gate's re-run can be a diff instead
of a re-render. The store lives in `scripts/lib/frame-cache.mjs` (the
library gates import) with a CLI at `scripts/frame-cache.mjs`
(put/lookup/list/prune/hash-bundle; `lookup` exits 0 on a hit, 1 on a miss,
2 on a misshapen key — the checking convention).

### The keying decision

**Candidate A — hash the built bundle's bytes — SHIPPED.** The key carries
the SHA-256 of every file under `dist/app/` (walked, sorted by path, hashed
as `<path>\n<bytes>` sequences — content only, no mtimes, so an identical
rebuild re-hashes identically). Any source edit produces a new bundle and
invalidates every entry; correct by construction, and the invalidation cost
is paid once per edit cycle, because the build is re-run anyway — the cache
never turns a stale-bundle run into a fake hit, which is the one way this
scheme could be WRONG rather than merely coarse. Measured on this box:
43 ms to hash the whole 3.5 MB `dist/app/` (negligible next to the 7.0 s
build it follows). One measured refinement: the build embeds `__BUILD_ID__`
(the git short SHA plus the date), so the granularity in practice is the
COMMIT — two rebuilds of one commit hash identically (verified byte for
byte), and every commit is a new key. That is the invalidation cadence the
decision expected, not a divergence from it.

**Candidate B — per-module source closures — DECLINED, with its trigger.**
Finer (a `surface-de.ts` edit keeps panel-contrast hits) but needs a
module-to-bundle map and risks the subtle misses the app-side memo key
already demonstrated. It stays a refinement ONLY IF the invalidation rate
measurably annoys — the measurable shape: watch-mode re-verdicts dominated
by cache misses whose bundles differ by one non-rendering module. The
affected-gate map (a later child) is the finer instrument that would make B
precise if ever needed; until then coarse-but-exact beats fine-but-lossy.

### The key — nine required fields, enforced

`deriveFrameKey(fields)` validates and canonicalizes the fields (recursive
key-sort → stable JSON → SHA-256), REQUIRING every field and REFUSING
unknown ones. This is the module-level enforcement of a lesson the project
already paid on the app side: the offline-export force-frame memo key
shipped without fog, envLight and the backdrop shape, and an atmosphere-only
leg exported the previous leg's frame — so an absent field is STATED as
absent (`null`/`{}`), never elided, and the list is owned here, not
improvised by each caller:

| field      | content                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bundle`   | `hashBundleDir(dist/app)`'s hash — the built bytes                                                                                                         |
| `document` | the full scene document string (the `#v1=` hash; the document carries its own camera/4D pose)                                                              |
| `pose`     | `null` when the document's own pose (or the deterministic auto-fit) governs; the gate-driven pose object when a gate moves the camera outside the document |
| `mode`     | render mode (`surface`, `flame`, ...)                                                                                                                      |
| `engine`   | `compute` vs `webgl` (or the flame/solid engine)                                                                                                           |
| `viewport` | `{width, height, scale}` — the capture geometry repaints every pixel                                                                                       |
| `raster`   | free-form: tier scale, depth, samples, budgets (the render-tier rung and antialias sample count live here)                                                 |
| `device`   | `{software: boolean, label: string}` + extras — the probe's backend disclosure, so SwiftShader and real-driver frames never share an entry                 |
| `env`      | flat gate env/URL flags that alter rendering (`surfacegl`, `surfacemaxrays`, `surfacesamples`, ...), `{}` when none                                        |

Gate and scenario names are entry METADATA, deliberately not key fields:
the same scene demanded by two gates is ONE entry — that is what makes the
cache shared rather than per-gate.

### The store

Content-addressed under the gitignored `scripts/out/frame-cache/`
(regenerated, never committed): `<hh>/<hash>.json` + `<hash>.png`, a
two-character shard fan-out mirroring a git object store. The entry json
carries the key hash, the canonical string, the fields, the verdict JSON and
provenance (`gate`, `scenario`, `buildHash`, `createdAtMs`, optional
`wallMs`/`notes`). Writes are atomic (tmp + rename); a re-put of an existing
key refreshes its timestamp (LRU recency) and reports `existed`.

**The eligibility boundary, enforced by shape rather than review:** the
store only accepts entries carrying a real PNG (the magic is checked), so it
records frame-pure verdicts — byte-exact reload, IoU, zero-thickness
byte-for-byte, distinct-objects, export identity, settle double-screenshot
equality — and structurally cannot record the ineligible ones (teardown,
fence cost, watchdog, staging ceiling, machine-quiet certification,
trusted-interaction timing), which measure the SESSION, not the frame, and
have no frame to put. What a hit may replay — the recorded verdict
wholesale, or only a re-diff against a fresh render — is the wiring child's
per-gate decision; the library hands back both the png bytes and the verdict
and takes no side.

**NOT golden files.** The repo refuses golden-image fixtures; this is
memoization keyed on exact input hashes. A hit is valid exactly while the
key is exact; nothing here substitutes a stale frame for a fresh render the
verdict logic could contradict. Identical bytes under two different keys
duplicates the png (dedupe is not the goal; exact keys are).

**Measured** (this box, 300 KB frame): put 0.8 ms, lookup 0.4 ms, entry
json ~1.1 KB.

### Prune — the bound

`frameCachePrune` runs after gate batches (the wiring child) or by hand
(`node scripts/frame-cache.mjs prune`): corrupt entries, orphans (png
without json or the reverse), debris (a crashed atomicWrite's tmp files)
and wrong-version entries are removed regardless of bounds; then everything
older than 45 days; then, greedy
newest-first, entries past 1 GiB of frames — the first overflow and
everything older goes, never keeping an older entry behind a refused newer
one. `--max-bytes`/`--max-age-days`/`--dry-run`/`--json` on the CLI;
`dryRun` reports without unlinking. Empty shard directories are cleaned up.

## Wiring the gates (the third child)

The wiring layer is ONE shared helper,
`scripts/lib/frame-cache-gate.mjs` (unit-tested in
`scripts/frame-cache-gate.test.ts`), so wiring gate N+1 is a lookup at its
frame-capture site and a record beside it — the de-preview lesson (five
sheets once grew the same wrong thing in five copies) applied to the cache.
What the helper owns:

- **The degradation contract** (borrowed from the warm runner's): a store
  error sets `disabled`, is noted ONCE, and every later lookup misses /
  record no-ops — the gate runs exactly as before the cache existed. The
  cache is an optimization, never a contract a gate enforces with an exit
  code.
- **`--force`** on every wired gate: lookups never hit; renders always
  record.
- **`readDeviceSignature(page, engine)`** — the key's `device` field asks
  the BROWSER (not the app) which adapter it renders with, from a page at
  the app's ORIGIN (WebGPU is secure-context-only, so `about:blank` has no
  `navigator.gpu`; the diff pages that must stay on `about:blank` for the
  blob decode get a separate probe page). Same sources as the app, same
  `requestAdapter({ powerPreference: "high-performance" })`, the same label
  construction as `webgpuAdapterStatus` and the same software regex — so
  the key derived pre-boot is the key the settled session would derive.
- **`gateKeyFields(...)`** — the nine-field builder with the
  stated-absence defaults (`pose: null`, `raster: {}`).
- **The put-gating rule**: entries carry frames of settled, stable captures
  only, and each wired gate records only when its scenario's checks passed
  — a failed scenario never replays as a pass.

### Per-gate hit semantics — what a hit may stand in for

The store deliberately takes no side on what a hit replays; the wired gates
choose, and the choices are the interesting part:

| gate                      | cached product(s)                                     | hit semantics                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `surface-repro`           | one settled frame per scenario (pinned pose only)     | RE-DIFF: a hit renders ONE fresh load and byte-diffs it against the recorded frame — cross-session determinism, stronger than the original within-run pairs. A collision (fresh ≠ cached under an exact key) is a miss: full runs, re-record.                                                                                                          |
| `finish`                  | both legs' captures per stage (stage rides `raster`)  | FULL REPLAY: both legs hit at a common stage → no boot, no settle; the verdict recomputes from the recorded bytes every run, so a replayed FAIL is as honest as a live one and `--floor`/`--stage` changes re-verdict from the same frames.                                                                                                            |
| `sphere-inversion-family` | menu frame, export, tiled export, gl frame per preset | REPLAY + LIVE MIX: the frame and the probe-derived metadata (engine, census, tile counts) replay; the menu/boot interactions, document checks, LINK HOPS' settles and toast/refusal phases stay live. The hops' byte-for-byte claims are fresh-hop-vs-recorded-menu compares, never cached-vs-cached.                                                  |
| `surface-4d-lift`         | the THICK frame of the three cover scenes             | SKIP ONE SETTLE: the drive machinery (row availability, landed, latch-clear) and the zero-thickness identity (fresh entry vs fresh reset) stay live; only the expensive h=0.2 cover settle is skipped. The reset drive's latch-clear, which a skipped h=0.2 settle would make vacuous, is carried by its completed h=0 settle plus the identity check. |

The self-consistency rule the table encodes: a verdict that compares two
renders of the SAME key (repro's determinism, the lift's zero-thickness
identity, si's link fixed-point) must keep at least one side FRESH — two
cached copies of one key compared to each other are a tautology, not a
verdict. Verdicts comparing DIFFERENT keys (finish's authored-vs-unauthored
floor, si's pairwise distinct, the tiled-vs-untiled export identity) are
sound recomputed entirely from cached bytes, because the keys are what make
the bytes comparable.

### Measured (AMD RX 7900 XTX, Chromium 153, real driver `x11::0`, production build, 2026-10-02; all runs machine-quiet)

- `surface-repro --scenario=all` (5 scenarios, `--runs=3`): cold 92.8s →
  warm 31.7s (2.9×). The warm run's verdict is the stronger cross-session
  claim. `--force` verified: full renders, re-records. A deliberately
  poisoned entry (sierpinski bytes under the boxfold3 key) was detected as
  a collision, fell through to the full 3-run pass, and re-recorded —
  16.7s, verdict DETERMINISTIC.
- `sphere-inversion-family --phases=presets` (10 presets): cold
  (`--force`) 9m51s → warm 3m31s (2.8×). The warm run's remaining wall is
  the 20 live link hops (two settles each, byte-identity max 0 on every
  one) — lifecycle the cache deliberately does not touch. One-preset smoke
  including tiled and gl legs: 47.8s cold → 21.2s warm; the gl leg's IoU
  recomputed identically (1.0000) from cached bytes.
- `finish --mode=x11::0 --arm=both` (lens3): cold 35.7s → warm **0.8s**
  (44×) — full-pair replay, the recomputed structural fractions identical
  to the live diff's (8.764%/8.776%). The documented ~20 min SwiftShader
  full run would collapse the same way on a warm store.
- `surface-4d-lift --display=:0`: cold 87.5s → warm 83.7s on THIS box —
  the honest number is that the cover settles it caches are 0.5–1.3s here;
  the wiring pays on the Iris-class machines the gate header documents
  (~60 s/sample), where the same hit skips the run's dominant term.
- `capture-drain` is REFUSED, on the eligibility boundary: its contract
  fields are timings measured against the live session (`settleMs`,
  `captureMs`, the drain outcome) and it is explicitly a measurement
  harness, not a pass/fail gate — there is no frame-pure verdict to
  record, and fabricating one would be the misuse the store's PNG-magic
  gate exists to prevent.

Not wired yet, with their hazards named: `surface-export-tile` (its arms
mutate live state — DoF and the background shape — before Save-PNG, so the
key must read the mutated document or encode the edits; the recon called
this the single most likely silent-key bug) and `surface-slab-4d` (its
share-link reload dance mixes lifecycle with byte-identity; wireable with
the repro shape). The helper makes either a focused follow-up.

### The stale-gate fix the wiring surfaced

`sphere-inversion-family.verify.mjs`'s gl leg had been failing since the
backdrop-premise rename (2026-09-27): the constant was named
`BACKDROP_PREMISE_MAX_COVERED` but the premise check still read
`BACKDROP_PREMISE_MAX` (undefined), so every gl-leg run threw a
ReferenceError into the phase's own catch and failed. Fixed in the same
change as the wiring (the wiring is what ran the leg again).
