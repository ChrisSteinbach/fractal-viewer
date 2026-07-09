# Investigation fr-2w5: why flame GPU/CPU selection was flaky

**Verdict: root-caused and fixed.** The "flakiness" was four separate,
individually deterministic mechanisms that interleaved into apparently random
behavior across browsers and machines. Every mechanism was reproduced
experimentally on real hardware (Iris Xe / Mesa 25.2.8 Vulkan, Chrome 148,
Firefox 151/152) before anything was changed; the probe tool used is kept as
`scripts/gpu-probe.mjs`.

Field symptoms this explains:

1. _WebGPU sometimes missing entirely_ (Chrome, Opera, Firefox).
2. _GPU selected, then falls back to CPU mid-render._
3. _Absurd inversions_: a phone renders on GPU while a powerful desktop drops
   instantly to CPU.

## Root causes (all confirmed experimentally)

### RC1 — Reported device limits are not allocation guarantees, and real ceilings move

`createGpuFlameBackend` guarded only `histBytes ≤ maxStorageBufferBindingSize`
and trusted the answer. Measured reality:

| Context                       | Reported mSBBS / maxBufferSize | Actually allocatable (create-time)                                                                                    |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Chrome 148, Iris Xe, Vulkan   | 4 GiB−4 / 4 GiB−4              | STORAGE ~1.5–3 GiB **varying run-to-run**; MAP_READ ~2 GiB hard (Dawn "Failed to allocate memory for buffer mapping") |
| Firefox 151/152               | 1 GiB / 1 GiB                  | STORAGE: 1 GiB ok; MAP_READ: 1 GiB **refused** ("Out of memory"), 768 MiB ok                                          |
| Android phone (fr-7su record) | 256 MiB                        | 126 MiB histogram ok                                                                                                  |

The Chrome storage ceiling moved between probe runs minutes apart
(`VK_ERROR_OUT_OF_DEVICE_MEMORY` at 1.5 GiB in one run; 2 GiB pairs fine in
another) — it depends on live memory pressure. **Any predictive scheme —
trusting limits, or even a boot-time probe — will flap between GPU and CPU
across sessions.** Recovery has to be reactive, per attempt.

### RC2 — Create-time allocation failure was invisible (no error scopes)

WebGPU's `createBuffer` never throws on allocation failure: it returns an
invalid-but-real-looking buffer, and the failure surfaces only when something
touches it. The backend used no error scopes, so an over-ceiling histogram
"created" fine, the warmup and accumulate dispatches "ran", the UI said
**GPU accumulation** — and the first snapshot readback then failed with
`[Invalid Buffer "flame-gpu hist staging"] is invalid due to a previous
error`, seconds into the render. That is symptom 2, reproduced end-to-end in
the real app at 4K × supersample 3 (2.39 GB staging ask). Both browsers
report these failures synchronously through `pushErrorScope("out-of-memory")`
at create time — the fix is to listen.

fr-e07's Firefox field report ("Not enough memory left" mid-render on a 24 GB
card) was this same mechanism: FF refuses ≥1 GiB MAP_READ staging allocations
that its own reported 1 GiB limit permits.

### RC3 — No supersample ladder: one oversized ask lost the GPU for the whole session

The histogram is 32 B/bucket at `displayW·displayH·ss²`. On any GPU failure
the session ratcheted `gpuFailed` permanently and restarted **on CPU at full
supersample**. So: phone (720×1440, ss2 → 126 MiB < its 256 MiB limit) renders
on GPU; 4K Firefox desktop (ss2 → 1.06 GiB > its 1 GiB limit) goes instantly
and permanently to CPU regardless of how big the GPU is. Symptom 3 is
deterministic arithmetic, not flakiness. Meanwhile ss1 at 4K is 265 MiB —
comfortably inside every regime measured — and a GPU render at 1× beats a CPU
render at 2× by an order of magnitude in converged iterations. (This is
exactly the "shrink and retry ON the same GPU" fix fr-e07's revert notes
prescribed and nobody implemented.)

### RC4 — The worker→main escalation re-ran size failures

`gpuUnavailable` carried no reason, so main.ts escalated **every** worker GPU
failure to the main-thread host — including size failures, which fail
identically there (same hardware, same allocator; fr-e07 watched both hosts
OOM back-to-back). The E3 trace showed the user-visible result: GPU→CPU
happens _twice_ per render before CPU sticks.

### RC5 — Chrome/Linux gates `navigator.gpu` independently of GPU capability

Measured via CDP `SystemInfo.getInfo`: headed default-flag Chrome 148 reports
`featureStatus.webgpu: "enabled"`, hardware Vulkan present — and the page
still has **no `navigator.gpu`** without `--enable-unsafe-webgpu` (Linux
exposure is flag/field-trial gated; automation also disables field trials).
Also relevant: `navigator.gpu` is `[SecureContext]`-only, and Playwright's
`headless: true` is Chrome's OLD headless mode with no GPU stack at all —
`scripts/gpu-flame-bench.mjs`'s headless path could never see WebGPU (fixed:
`--headless=new`). Symptom 1 is rollout/flag state, not capability; not
app-fixable, but the backend note + console breadcrumbs now make it
attributable.

### RC6 — After a GPU-process crash, Chrome silently hands out SwiftShader

Killing the GPU process mid-render (E4b) fires `device.lost`
(`reason: "unknown"`, "A valid external Instance reference no longer
exists"), and a fresh `requestAdapter()` **succeeds — with
`google/swiftshader`**, the software fallback, while the crashed hardware is
temporarily blocklisted. A naive retry-after-loss would silently continue
10–100× slower.

### RC7 — The GPU backend eagerly allocated a CPU-side accumulation histogram

`GpuFlameBackend` allocated its `snapshot()` conversion target (Float64
hits+sumRGB at accumulation resolution — up to ~2.4 GiB at 4K ss3) in its
constructor, though only the finish-time snapshot needs it. Per RC1, that
memory pressure directly shrinks what the GPU allocator will grant the same
render.

## The fix

- **Typed failure classes** (`FlameGpuSizeError`, `FlameGpuUnavailableError`)
  defined next to the backend seam in `flame-worker-core.ts`.
- **Error-scoped creation** (`flame-gpu-backend.ts`): all buffers, pipelines,
  and the warmup dispatch run under `out-of-memory` + `validation` scopes; a
  scoped OOM throws `FlameGpuSizeError` at create time. Added the missing
  `maxBufferSize` guard (staging is not a binding), `device.destroy()` on
  every failed create (was leaked), `powerPreference: "high-performance"`,
  fallback-adapter detection (`software` flag + "(software)" label), a lazy
  `outHistogram`, the missing `lost` check in `snapshot()`, and a one-line
  create breadcrumb (adapter, accumulation size, device limits).
- **Recovery ladder** (`FlameWorkerSession.handleGpuFailure`) replacing the
  one-way ratchet:
  - `FlameGpuUnavailableError` → permanent CPU, `gpuUnavailable` with
    `reason: "no-webgpu"` (the only escalatable class);
  - any other failure at supersample > 1 → learn
    `gpuMaxSupersample = ss − 1`, restart **still on GPU**;
  - mid-render failure at supersample 1 → one fresh-device retry
    (`gpuLossRetried`), refusing a `software` adapter when the session had
    real hardware (RC6);
  - only then permanent CPU (`reason: "error"`) — and the CPU restart
    recomputes supersample _without_ the GPU clamp, so CPU quality is never
    degraded by a GPU-learned ceiling.
- **Escalation gated on reason** (`main.ts`): only `"no-webgpu"` escalates a
  worker-hosted session to the main-thread host (fr-1ib's Firefox gap); size
  and device failures no longer double-fail. The CPU backend note now carries
  why ("CPU accumulation — GPU failed" / "— WebGPU unavailable").

## Verification

- 1300 unit tests incl. new ladder coverage (size-retry, unavailable-no-retry,
  CPU-regains-full-supersample, mid-render shrink, software-refusal,
  software-only-accepted).
- Real app, Chrome/Iris Xe, 4K ss3 (the reproduced failure): scoped OOM at
  create → retry at 2× → **completes 100% on GPU**, UI notes "GPU
  accumulation (intel gen-12lp)" + "Reduced to 2× (from 3×)".
- Real app, Firefox 151, 4K ss3 (limit-guard case): guard → retry at 2×
  (1013 MiB, just under FF's 1 GiB) → completes on worker GPU.
- Normal cases unchanged (1440p ss2 Chrome: straight to GPU, no notes).
- `scripts/gpu-flame-bench.mjs --duration=2` agreement: **pass**, now
  genuinely headless (`--headless=new` fix).

## Tools kept

- `scripts/gpu-probe.mjs` — the adapter-census + allocation-ladder probe.
  Run it on any machine/browser that misbehaves in the field:
  `node scripts/gpu-probe.mjs --browser=chrome-headed --flags="--enable-unsafe-webgpu" --out=probe.json`
