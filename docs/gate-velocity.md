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
gates themselves are untouched. The BIG lever remains the frame cache
(the epic's next child): a settled frame is a pure function of its inputs,
and the legs that dominate these walls are exactly the work a cache skips.
