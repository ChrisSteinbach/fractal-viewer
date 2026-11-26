# AGENTS.md

**Fractal Explorer** — an interactive 3D/4D IFS (Iterated Function System) fractal
explorer. A set of affine transforms is rendered with the "chaos game" into a live
Three.js point cloud. Built with TypeScript + Vite, packaged as a PWA, deployed to
GitHub Pages. Reference docs in `docs/`.

**This is the canonical project-rules file for every agent.** Anything true
regardless of the harness lives here: invariants, refusals, frozen wire
constants, commands, and where the verdict of every settled question lives.
Harness-specific mechanics live in that harness's own file (`CLAUDE.md` imports
this one); nothing load-bearing may live there alone.

## What belongs here — rules here, records in `docs/`

**This file is the RULES**: invariants, refusals, frozen wire constants,
which gate verifies what, and where each subsystem's record lives. **Everything
else lives in `docs/` or the owning executable harness**: per-module verdicts,
measured numbers, measurement narratives, refuted hypotheses, the history of a
correction. The rule or gate links to it.

The reason is mechanical: every importing harness pays for this file in its
launch context, and some sessions run on a window of under 200K tokens. CI
guards the combined size of this file and its harness shims at 30,000 bytes.
**Do not grow it to fit a new finding.** The numbers go in the subsystem doc or
reproducing harness. A module's verdicts go in its `docs/modules/` entry
and its own header comment. Only a new cross-cutting rule comes back here, as
one line. A bullet here that grows a table, a figure or a paragraph opening
"MEASURED" belongs in a doc instead.

**Before changing a module, read its entry in `docs/modules/`** (the index
under Architecture says which file) and its subsystem doc. Those entries carry
the frozen layouts, refusals and measured verdicts that this file only names.

Where things live:

- `docs/modules/*.md` — one entry per module: what it owns, its invariants
  and settled verdicts (the old Architecture section, split by subsystem).
- `docs/gates.md` — the hand-run browser gates and the harness-sheet
  conventions.
- `docs/architecture.md` — how the whole thing works (narrative).
- `docs/surface-gpu-kernels.md` — `surface-de-gpu.ts`: the fifteen WGSL
  cores, the params wire, bench legs and classifiers.
- `docs/surface-compute-renderer.md` — `surface-compute.ts`: routing, the
  frame loop, supersampling, raster limits, teardown.
- `docs/surface-strip-pipeline.md` — `strip-planner.ts`: the WebGL strip
  pump, the cost evidence chain, the capture drains.
- `docs/surface-glsl-tracers.md` — `surface-material.ts` / `-4d.ts`:
  variant arms, the Mesa link cliff, the probe-width verdict.
- `docs/escape-time-family.md` — `escape-de.ts`: the formula chain,
  cycling vs chaining, the estimate form, the emptiness instruments.
- `docs/gpu-bench-surface.md` — `npm run bench:surface`: what it pins, the
  known SwiftShader false failure, the fixture rows.
- `docs/twisted-menger-family.md`, `docs/sphere-inversion-family.md`,
  `docs/sphairahedron-family.md` — the subject-block families' records.
- `docs/tiling-contract.md`, `docs/surface-dielectric-transport.md`,
  `docs/surface-slice-thickness.md` — tiling, glass/optics, 4D slabs.
- `docs/harness-sheets.md` — the `scripts/*.harness.ts` catalogue and each
  sheet's verdict.
- `docs/fold-de-performance-brief.md`, `docs/quaternion-julia-brief.md`,
  `docs/julia-sets.md`, `docs/4d-exploration.md`, `docs/flame-interop.md`,
  `docs/controls.md` — standing briefs.
- `docs/panel-ia.md` — the accepted control-family, applicability and edit-
  behavior contract for placing panel controls.

## Dimensional Parity — the 4D half is not a follow-up

**The site is fractal-4d.com. A capability that exists only in 3D is not
finished, and a session that leaves it that way is not done.**

The delayed escape-chain, ground-plane and balloon lifts established the
verdict: the algebra is usually shared; the later cost is structural — frozen
wire layout and independently re-derived definitions. The balloon Points lift
also fixed the dimensional-reduction-first rule: PROJECT THEN INVERT the point
actually displayed. The measurement history and why those decisions follow are
in `docs/4d-exploration.md`; the rules are below.

- **Both halves are scoped up front.** Work touching a twinned pair —
  `affine`/`affine4`, `chaos-game`/`chaos-game-4d`, `flame`/`flame-4d`,
  `flame-gpu`/`flame-gpu-4d`, `voxel`/`voxel-4d`, `variations`/`variations4`,
  `surface-de`/`surface-de-4d`, `surface-material`/`surface-material-4d`, or
  the WGSL `affine`/`fold` cores against `affine4`/`fold4` — carries the 4D
  twin in its own plan, its own estimate and its own PR. Say it in the plan,
  not in the retro.
- **3D-only is a decision that owes evidence, never a default.** It ships only
  with the reason written in the module doc AND a bead carrying the lift's
  ACTUAL shape (which params offset, which kernel core, which oracle) — the
  shape the ground plane's and the balloon's lifts both had, and the reason
  both were cheap to close when someone finally did. "3D first, 4D later" is
  not a reason. `surface-grid.ts` is the model REFUSAL (a live rotor/slice
  invalidates a grid per frame — stated, not implied), `bulb-de.ts` its
  sibling one family over (triplex numbers are R³ with a spherical-coordinate
  product and no fourth component to give meaning to, so `variations4.ts`'s
  `bulb` carries `w` through untouched — honest for the chaos game, useless to
  an estimator), and the quaternion Julia set's refused 4D lift the model
  WON'T-DO (closed on twenty measured panels, not on a hunch about cost).
- **The lift costs more later, and the cost is structural.** The 3D half
  freezes wire layout the 4D half must then append past — the ground plane's
  lift records a plane block appended at 4D offset 560 landing INSIDE lens4 and
  corrupting it — and a lift written months later re-derives shared algebra
  instead of importing it, which is how two renderers start drawing different
  objects from one document. `variations4.ts` importing `resolveFoldRadii`
  rather than restating it is the standing counter-example, and
  `escape-de-4d.ts` importing every constant, link code and estimate form from
  `escape-de.ts` is the second: what a chain IS has one definition across both
  dimensions, and only the maps' arithmetic is duplicated under the twin-file
  convention. `inversion.ts` (`inversionBallScale`) SHIPPED as the helper the
  4D slab work and the balloon lift agreed to share, before its second caller
  exists rather than after — the balloon lift did NOT need it
  (slice-then-invert keeps the inversion 3D and the slab rides both terms
  untouched), and the spherefold slab port that would consume it stays REFUSED
  on the slab work's own measurements (`slabExact4`), so what is still owed is
  that port, not the identity.
- **An unlifted gap is disclosed, not quietly filed.** A session that ends
  3D-only says so in the PR description and in its closing summary, as
  unfinished work. The bead is the tracking; it is not the disclosure.

## Panel information architecture — classify before placing

**Every panel control has one conceptual home — Scene / Look, Renderer,
View / Device, or Workflow — independent of consumers, lifetime, edit
behavior.** Keep the native exclusive-open accordion; sections own
applicability, shared sections survive renderer changes, dependent details
hide, dormant capabilities disable beside a reason, document status stays
outside mode gates, and visible edits disclose
live/restart/next-entry/refused timing. Active editing precedes output/library
controls; the record is in `docs/panel-ia.md`. Visible copy is gated (`npm
test`): hints ≤ 16 words, notes ≤ 24, disclosures ≤ 60, WCAG AA contrast in
Chromium+Firefox (`scripts/panel-contrast.verify.mjs`).

## Commands

```bash
npm test              # Tests only (vitest run)
npm run typecheck     # The three tsc programs lint type-checks
npm run test:watch    # Tests in watch mode
npm run test:coverage # Tests with coverage report
npm run lint          # Type-check + ESLint + Stylelint + Prettier check
npm run lint:fix      # Auto-fix ESLint + Stylelint + Prettier issues
npm run lint:eslint   # ESLint only (no type-check)
npm run lint:stylelint # Stylelint only
npm run format        # Prettier check only
npm run format:fix    # Prettier auto-fix only
npm run dev           # Start Vite dev server (HTTPS, binds 0.0.0.0 for phones)
npm run build         # Production build → dist/app/
npm run smoke         # Headless WebGL smoke test (SwiftShader) — boots the app, asserts it renders
npm run verify        # Warm gate runner (docs/gate-velocity.md): one build+preview+browser per gate batch
npm run bench:gpu     # Headless WebGPU flame agreement/bench (real Chrome) — pins the WGSL kernels to their CPU oracles; run after touching flame-gpu*.ts kernels (CI runs it on SwiftShader)
npm run bench:surface # WebGPU fold-DE kernel agreement/timing — pins surface-de-gpu.ts (all cores) to its CPU oracles; add --display=:0 for real-driver timing (WITHOUT it the run is headless SwiftShader). Run it QUIET (below), never beside the test suite: a contended software device corrupts mid-run readbacks; the canary reports verdict=device-unreliable (exit 2, rerun). JUDGE THE ESCAPE ROWS ON --display=:0 — escChainKaleido's known SwiftShader-only false failure is the realization-coin-flip class the forward legs' boundary rings exclude pre-hoc; the flip cap stays untouched. Fixtures, caps, rows: docs/gpu-bench-surface.md
npm run gpu:scratch   # Seconds-scale kernel-edit loop (docs/gate-velocity.md): one scene, one production frame + eval probe; never a gate
npm run bench:mesh-sdf # 64³ trefoil cold-bake vs its 2s budget, BVH-vs-exact agreement
npm run verify:pattern-release # Owner gate: drives the built app -> blinded owner deck; verify:pattern-release-review scores it, only "approve" passes
npm run gate:affected # Map a dirty tree or base diff onto the gates and sheets that exercise it (docs/gate-velocity.md)
```

**`--display=:0` NEEDS AN X COOKIE, and without it every gate that offers it
falls back to SwiftShader SILENTLY.** An agent/SSH shell arrives with a
forwarded `DISPLAY` (`localhost:10.0`) and no authorization for `:0`, so
`--display=:0` gets "Authorization required" and the run quietly measures a CPU
rasterizer instead. Nothing fails; the numbers are just not the ones you asked
for. The credential is Xwayland's, and its suffix changes every login, so glob
it rather than pasting a path:

```bash
export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
export DISPLAY=:0
glxinfo -B | grep "OpenGL renderer"   # MUST be a REAL hardware driver, never SwiftShader/llvmpipe
```

The development machine is WHATEVER MACHINE IS AVAILABLE (an Iris Xe before,
an AMD RX 7900 XTX now), so the check names no vendor: the renderer line must
name a real hardware driver, never SwiftShader/llvmpipe. The Iris/i915
figures quoted across the docs are records of the machines they were MEASURED
on, not expectations about the machine at hand; a claim a gate re-measures
here gets this machine's number beside the old one, never silently
substituted for it.

CHECK THAT LINE BEFORE BELIEVING A REAL-DRIVER ROW: one session shipped its
whole measurement set on software before noticing.

AND A CONTENDED MACHINE IS NOT A MEASUREMENT, so quiet is CHECKED rather than
asked for: `scripts/lib/machine-quiet.mjs` attributes GPU busy time PER
PROCESS off DRM
fdinfo (a global percentage cannot tell whose work it is), and EVERY gate
that measures a real driver — the bench, the shared browser launcher, the
direct-launching gates and probes, the browser harness sheet — takes the
baseline before its own GPU work and prints it; a contended run says so
(UNCERTIFIED) in its own output rather than being believed. UNKNOWN NEVER
READS AS QUIET.

Requires **Node.js 22+** (.nvmrc pins 22; the compile target is ES2022).

**Hand-run browser gates** (not npm scripts). Each one's invocation, what it
gates and its record are in `docs/gates.md`. Run the one that covers what you
touched; `npm run gate:affected` maps a diff onto them.

- `scripts/escape-family.verify.mjs` — escape-time presets from the menu:
  entry, distinct objects, `PRESET_FINALS`, which engine.
- `scripts/surface-4d-lift.verify.mjs`, `scripts/surface-slab-4d.verify.mjs`
  — the 4D lifts and the nonlinear slab's reload/capture.
- `scripts/explorer-balloon-4d.verify.mjs` — the 4D explorer balloon echo.
- `scripts/sphere-inversion-family.verify.mjs` (+ `-glass`) — the
  sphere-inversion presets, link reload, export, refusals.
- `scripts/panel-numeric-control.verify.mjs` — the panel's exact-numeric
  companions under trusted touch.
- `scripts/isolation-reload.verify.mjs` — the COOP/COEP first-visit reload.
- `scripts/live-site.verify.mjs`, `scripts/live-4d-presets.verify.mjs` —
  post-deploy checks of the live origin (also run by `deploy.yml`).
- `scripts/surface-teardown.verify.mjs`, `scripts/flame-teardown.verify.mjs`
  — WebGPU session teardown on real Firefox.
- `scripts/flame-export.verify.mjs` — what a flame Save-PNG actually contains.

**Harness sheets** (`scripts/*.harness.ts`) are the executable measurement
records. They share ONE CPU marcher (`scripts/de-preview.ts`, parallelised
by `de-preview-parallel.ts`), so never write a ninth. They share ONE
fill/reach definition (`scripts/set-extent.ts`), which tests against a
membership oracle and never a distance threshold. Output goes to the
gitignored `scripts/out/`. Conventions: `docs/gates.md`; catalogue:
`docs/harness-sheets.md`.

## Pre-commit Hooks

Husky runs lint-staged on every commit, auto-fixing ESLint + Prettier on staged
`src/` `.ts` files (a staged `scripts/*.ts` gets Prettier only — its lint waits
for `npm run lint`) and Stylelint + Prettier on staged `.css` files. Hooks are installed by
`npm install` (via the `prepare` script).

## Architecture

The codebase deliberately separates the **pure fractal core** from the **rendering
and UI**, so the interesting math is unit-tested without a browser:

- **`src/fractal/`** — Dependency-free core. No Three.js, no DOM.
- **`src/app/`** — Three.js + DOM glue. Vite root (`root: "src/app"`).
  Three.js is confined to `scene.ts`, `interactions.ts`,
  `voxel-material.ts`, `surface-material.ts` and `surface-material-4d.ts`.

Core algorithm: the chaos game on an IFS — repeatedly apply a randomly chosen
affine map to a moving point and plot where it lands; the cloud converges on the
system's attractor. See `docs/architecture.md`.

**Color management is disabled** (`THREE.ColorManagement.enabled = false` in
`scene.ts`) so authored sRGB colors render verbatim; `color.ts` produces sRGB.

### Cross-cutting rules

Each is stated in full, with its evidence, in the module entry named.

- **ABSENT MEANS CLASSIC, BYTE FOR BYTE.** Every optional document field
  (posts, fold lengths, finishes, balloon tint, backdrop shape, schedules)
  decodes absent to the shipped behavior. An editor writes a field only once
  its control moves, and removes it when the control returns to classic.
  Morphs keep a field absent when both ends lack it; mutations and the
  random generator never add one.
- **ONE DEFINITION, IMPORTED.** Shared algebra, resolvers and vocabulary
  (fold radii, palette ramps, background shape, sample offsets, software-
  renderer detection) live in one module and every consumer imports it.
  The 4D twin imports from the 3D twin; it never restates it.
- **EVERY GPU MIRROR HAS A CPU ORACLE.** WGSL kernels and GLSL tracers mirror
  a `src/fractal/` estimator term for term and are pinned to it:
  `npm run bench:gpu` for flame, `npm run bench:surface` for Surface.
  Re-verify Surface kernel changes on `--display=:0`, not SwiftShader alone.
- **FROZEN WIRES ARE APPEND-ONLY.** Flame slots (`SLOT_STRIDE_BYTES` 1232,
  `SLOT4_STRIDE_BYTES` 1296) and the Surface params wire never move an
  existing offset. Appending to the params wire blind once corrupted
  `lens4Fold` at 560. Read the offset map in
  `docs/modules/fractal-surface-gpu.md` first.
- **GLSL SIZE IS A CLIFF.** Mesa crashes linking around 80 KB of emitted
  source. Measure `surfaceFragmentFor(...).length` before adding text to a
  tracer (`docs/modules/app-surface-webgl.md`).
- **NO SUBMISSION MAY OUTRUN A WATCHDOG, AND NO AUTOMATIC GIVE-UP.** Every
  WebGL trace goes through the strip pump; its worst-case cap is applied LAST.
  Every compute dispatch is its own submission. Settles always arm and
  previews always complete, with honest progress disclosed.
- **WEBGPU TEARDOWN IS DEFERRED.** `destroy()` waits for in-flight work to
  unwind; never call `device.destroy()` twice (`surface-compute.ts`,
  `flame-gpu-backend.ts`).
- **THE SCENE DOCUMENT IS NOT THE BROWSER'S.** Per-browser preferences
  (`viewer-prefs.ts`) never ride the `#v1=` hash. Undo snapshots carry no
  camera or pose. A restore never rewrites the document it restored.
- **A MEMO KEY MUST KEY EVERYTHING IT GUARDS.** `surface-force-frame-key.ts`
  keys every spec field that repaints a hit, and defaults each absent field
  to the packer's default.

### Module index

Read the named file's entry before changing a module.

- `docs/modules/fractal-core.md` — `affine`, `affine4`, `chaos-game`,
  `chaos-game-4d`, `color`, `inversion`, `morph`, `mutate-system`, `palette`,
  `presets` (and its side tables), `project4`, `random-system`, `rng`,
  `shapes`, `types`, `variations`, `variations4`, `vec`.
- `docs/modules/fractal-flame-solid.md` — `flame`, `flame-4d`, `flame-gpu`,
  `flame-gpu-4d`, `voxel`, `voxel-4d`.
- `docs/modules/fractal-surface.md` — `background-shape`, `balloon-de`,
  `surface-de`, `surface-de-4d`, `surface-grid`, `tiling` (+ `tiling-de`,
  `lattice-march`), `surface-finish` (+ dielectric/optics/lighting),
  `finite-solid`.
- `docs/modules/fractal-surface-gpu.md` — `surface-de-gpu` (the fifteen
  WGSL cores and the frozen params wire).
- `docs/modules/fractal-subject-families.md` — `menger-twist`,
  `sphere-inversion`, `sphairahedron`, `escape-de`, `escape-de-4d`,
  `qjulia-de`, `bulb-de`.
- `docs/modules/app-surface-webgl.md` — `render-tier`, `strip-planner`,
  `surface-material`, `surface-material-4d`.
- `docs/modules/app-surface-compute.md` — `surface-compute`,
  `surface-grid-worker`/`-client`, `surface-slots`, `surface-eligibility`,
  `surface-force-frame-key`, `render-backend`.
- `docs/modules/app-document-ui.md` — `background`, `state`, `persist`,
  `viewer-prefs`, `history`, `edit-session`, `collection`, `timeline`,
  `timeline-player`, `scene-file`, `flame-file`, `ui`, `control-spec`,
  `range-number-control`, `legend-spec`, `describe`/`shorten-url`,
  `constants`, `interactions`, `slider-scroll-guard`.
- `docs/modules/app-runtime.md` — `scene`, `orbit`, `camera-tween`,
  `framing-bounds`, `morph-tween`, `morph-budget`, `mutation-thumbs`,
  `drift`, `drift-policy`, `build-replay`, `exposure`,
  `resolution-governor`, `capture-cost`, `export-progress`, `main`,
  `regen-scheduler`, the cloud/flame/voxel workers and clients,
  `flame-backdrop-generator`, `flame-gpu-backend`, `flame-perf`,
  `voxel-material`, `render-session`, `thumbnail-patch`, `four-d-view`,
  `rotor4`, `recorder`, `offline-export`, `motion-export`,
  `isolation-handoff`, `register-sw`, `sw/sw`.

A module with no entry has only its own header comment. When you add a
module, add its entry to the matching `docs/modules/` file and its name here.

## Testing

Vitest with globals — use `describe`, `it`, `expect` without imports. Tests live
alongside source as `*.test.ts`. DOM tests opt into jsdom with a
`// @vitest-environment jsdom` comment (see `src/app/ui.test.ts`).

- **Test behavior, not implementation.** Assert on outcomes.
- **A jsdom test file must let the event loop turn** (evidence:
  `docs/test-suite-memory.md`).
- **DAMP over DRY.** Inline setup so each test reads in isolation.
- **One behavior per test.** Each failure should name the exact scenario.
- **Pragmatic coverage.** Don't chase 100%. Every test should pay rent. The pure
  core (`src/fractal/`) and pure app helpers (`orbit`, `state`) carry the tests;
  the Three.js/DOM glue is verified by running the app.

## Issue Tracking

This project uses **beads** (`bd`) for issue tracking — never markdown TODO
files and never a harness's in-session task list, which dies with the session.

```bash
bd list               # View all issues
bd ready              # Find available work
bd show <id>          # View issue details
bd create "<title>"   # Create a new issue
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
```

Use `--json` for programmatic calls; link discovered work with
`--deps discovered-from:<parent-id>`; do not create a second tracker.
Tracker state syncs via the bd dolt remote (`bd dolt pull`/`bd dolt push`);
the `.beads` jsonl mirrors are git-ignored.
A bead's notes must STAND ALONE: never cite /tmp or session scratch —
digest it in or link a durable home.

**THE CODEBASE MUST NOT CITE THE TRACKER.** A bead id is not a stable
foreign key: the tracker has been corrupted before and may be replaced;
either event turns every `see fr-xxxx` into a pointer at nothing. So ids
are never written into `src/`, `docs/`, `scripts/`, the
build and workflow files, or the agent instruction files — nor may the
tracker be the CARRIER of a claim ("the bead expected", "per the
bead's ask", "the epic's figures"), which dangles as badly while
looking innocent.
What a decision, a measurement or a refutation WAS is written out in full
where it lives — rules here, evidence in `docs/`, per the split at the top
— and named in the project's own words ("the march-epsilon cutoff
contract", "the kernel-confirmed i915 preemption hang"). Writing ABOUT the
practice is fine — "filing a 4D-lift bead and closing the epic" names the
standing failure mode two sections up — but citing an item's contents is
not. The ONE exception is OPEN work: a comment may
name the id it waits on; deleting that reference is
part of closing it. Commit messages may cite freely — git history is
immutable and never loaded into a session's context. A sweep removed
~7,500 ids and ~130 citations, so
`grep -rE 'fr-[a-z0-9]{3,6}' src docs scripts AGENTS.md CLAUDE.md` finding
anything but open work is a regression.

## Branching & Deployment

**ALWAYS create a feature branch before making changes.** Deployment to GitHub
Pages is manual only (`workflow_dispatch`) — not triggered by merges to `main`.

**MERGE BY REBASE, NEVER BY SQUASH.** `gh pr merge <n> --rebase`, not
`--squash`. Merge commits are disabled on the repo, so the two buttons GitHub
offers are rebase and squash and the wrong one is one word away.

Not taste. A commit here is a DECISION RECORD — what was measured, what was
refuted, what a number cost — and per-item commits are the unit a later
reader bisects, blames and quotes. Squashing collapses them into one blob:
the messages survive, the ADDRESSABILITY does not, and `git log --oneline`
stops being a readable index of why the code is the way it is, which makes
the multi-item rule one section up pointless.

DO NOT infer the method from recent PRs: most of `main` landed squashed,
the mistake this note exists to stop, not the convention to copy.

**REBASE ONTO `main` BEFORE MERGING.** From behind, the branch replays onto a
moved base: the merged tree is content no sweep has seen, so the push run
pays a full GPU sweep. Rebased, it is a no-op replay, the tree survives and
the sweep is REUSED: 36s vs 61min.

**Merge, then WAIT for main's CI before dispatching a deploy.** A rebase merge
mints NEW SHAs, so the PR's green checks do not transfer: deploy.yml's gate
reads the dispatched commit's own check runs, and a dispatch fired straight
after `gh pr merge --rebase` is refused (measured at merge+14s). That is the
gate working — watch main's CI on the new tip (`gh run watch`), then
dispatch. The GPU sweep is keyed by TREE and does carry across.

## Session Completion

When ending a work session, work is NOT complete until `git push` succeeds.

1. **Check dimensional parity** — did this touch a 4D twin? A missing 4D half
   is unfinished: ship it, or disclose the gap (reason + shaped bead) in the
   PR description and closing summary. A PR carrying unshipped 4D work
   discloses it there too, with a shaped bead pre-push (see the top).
2. **File issues for remaining work** — capture follow-ups in `bd`.
3. **Run quality gates** (if code changed) — `npm test`, `npm run lint`, `npm run build`.
4. **Update issue status** — close finished work, update in-progress items.
5. **Push to remote** — rebase on its remote when one exists, push the feature
   branch and open a PR to `main`.
6. **Verify** — all changes committed and pushed, and `git status` reports the
   branch up to date with its remote.

If quality gates fail, fix them before pushing. Never push broken code.

## Non-Interactive Shell Commands

Use non-interactive flags for commands that can prompt: `cp -f`, `mv -f`,
`rm -f`, `ssh`/`scp -o BatchMode=yes`, and equivalent package-manager flags.
