/**
 * fr-tmgf's "which engine, and is it software?" vocabulary: one regex, one
 * WebGPU adapter status derivation, one WebGL unmasked-renderer read, and one
 * pair of warning strings — so every place the app decides whether it is
 * silently running on a SOFTWARE renderer (SwiftShader / llvmpipe /
 * Microsoft's Basic Render Driver / Apple's software renderer) instead of
 * real hardware agrees on the answer and the wording.
 *
 * Three detectors grew independently before this module, none of which fed a
 * user-visible warning: `src/app/gpu-bench/main.ts`'s `SOFTWARE_ADAPTER_RE` +
 * `isSoftwareAdapter` (the WebGPU bench harness's adapter banner),
 * `src/app/public/gpuprobe.html`'s inline regex (the standalone acquisition
 * probe), and `src/app/flame-gpu-backend.ts`'s create-time derivation, which
 * checked only `info.isFallbackAdapter` and skipped the string tell
 * entirely. This module is the merge: `main.ts`, `scene.ts`,
 * `flame-gpu-backend.ts`, and `surface-compute.ts` get wired to it
 * separately, not by this change.
 *
 * `gpuprobe.html` stays a standalone inline `<script type="module">` with no
 * build step — it has to run before the app's own bundle can be trusted, so
 * it can't import this module — but its copy of the regex is deliberately
 * kept byte-identical to {@link SOFTWARE_RENDERER_RE} rather than drifting.
 *
 * @module
 */

/**
 * Matches the renderer/adapter strings browsers hand out for CPU rasterizers
 * standing in for a real GPU. Broader than any of the three detectors this
 * module replaces: `basic render` catches Windows' "Microsoft Basic Render
 * Driver" (a WebGL fallback the earlier `gpu-bench` regex missed), and the
 * bare `software` term catches Apple's "Apple Software Renderer" alongside
 * SwiftShader's and llvmpipe's own self-descriptions.
 */
export const SOFTWARE_RENDERER_RE =
  /swiftshader|llvmpipe|software|basic render/i;

/** Does `label` read as a software renderer/adapter string? */
export function isSoftwareRendererLabel(label: string): boolean {
  return SOFTWARE_RENDERER_RE.test(label);
}

/**
 * The subset of `GPUAdapterInfo` this module reads, loosened to plain
 * optional strings so callers can pass the real DOM type, the gpu-bench
 * harness's plucked-field copy, or a test stub without a cast.
 */
export interface GpuAdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}

/**
 * Derive whether a WebGPU adapter is software and the label to show for it,
 * reproducing `flame-gpu-backend.ts`'s pre-fr-tmgf label shape exactly while
 * broadening the software detection it fed.
 *
 * @param info WebGPU adapter info (`adapter.info`, or a bench/probe stand-in).
 * @param adapterFallback `adapter.isFallbackAdapter` — the OLDER spec home
 *   for the fallback flag. Some implementations expose it on the adapter
 *   itself rather than on `info`, so both homes are read.
 *
 * `software` is true when `info.isFallbackAdapter` or `adapterFallback` says
 * so, OR when any of `vendor`/`architecture`/`device`/`description` matches
 * {@link SOFTWARE_RENDERER_RE}. The string tell is the fr-tmgf addition:
 * Chrome has been seen handing out real-looking software stacks with
 * `isFallbackAdapter` false, reporting "swiftshader" in `architecture` with
 * an empty `description` — which is why all four fields are checked rather
 * than trusting the flag alone.
 *
 * `label` is built from `vendor`/`architecture` only (Firefox blanks both
 * rather than omitting them, so empties are filtered before joining — a
 * blank-but-present info still yields `undefined`, never a bare ""). A
 * software adapter with nothing to show falls back to "fallback adapter"
 * before the " (software)" suffix.
 */
export function webgpuAdapterStatus(
  info: GpuAdapterInfoLike,
  adapterFallback?: boolean,
): { label: string | undefined; software: boolean } {
  const stringTell = [
    info.vendor,
    info.architecture,
    info.device,
    info.description,
  ].some(
    (field) => typeof field === "string" && isSoftwareRendererLabel(field),
  );
  const software =
    info.isFallbackAdapter === true || adapterFallback === true || stringTell;
  const base = [info.vendor, info.architecture].filter(Boolean).join(" ");
  const label = software
    ? `${base || "fallback adapter"} (software)`
    : base || undefined;
  return { label, software };
}

/**
 * The subset of `WebGLRenderingContext`/`WebGL2RenderingContext` this module
 * reads, as a structural type so both real contexts and test stubs fit
 * without a cast.
 */
export interface WebglContextLike {
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
  readonly RENDERER: number;
}

/**
 * Read the real (unmasked) GPU/software renderer string out of a WebGL
 * context, or `null` if nothing usable is available.
 *
 * Prefers the `WEBGL_debug_renderer_info` extension's
 * `UNMASKED_RENDERER_WEBGL` parameter — the masked `RENDERER` parameter
 * normally reads back a generic string like "WebGL" rather than naming the
 * driver. Falls back to the masked `RENDERER` parameter when the extension
 * is unavailable: some browsers have dropped the extension and unmask
 * `RENDERER` itself instead, so a context with no extension isn't
 * necessarily a context with nothing to say.
 */
export function unmaskedWebglRenderer(gl: WebglContextLike): string | null {
  const ext = gl.getExtension("WEBGL_debug_renderer_info") as {
    UNMASKED_RENDERER_WEBGL: number;
  } | null;
  const raw = ext
    ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * A fold-shaped surface session's own compute-adapter outcome:
 * - `"flag"` — the user's own `?surfacegl` escape hatch forced WebGL. A
 *   deliberate choice, so {@link surfaceWebglDetail} adds no caveat.
 * - `"unavailable"` — WebGPU isn't available at all (no `navigator.gpu`, or
 *   `requestAdapter()` returned `null`).
 * - `"failed"` — device creation threw, or the device was lost, and the
 *   session fell back to WebGL mid-run.
 */
export type SurfaceComputeBlock = "flag" | "unavailable" | "failed";

/**
 * Why the current 3D surface session is tracing on WebGL rather than
 * `surface-compute.ts`'s WebGPU path — the trailing detail token for the
 * surface progress row, or `null` when nothing needs explaining.
 *
 * The wording keeps the ENGINE name prominent and API names out of
 * negations: "compute unavailable" reads at a glance, where "WebGPU
 * unavailable" was field-misread as WebGPU being the thing that's broken
 * (rather than the reason WebGL is doing the work) — the eye catches the API
 * name, not the negation in front of it. Same reasoning behind not saying
 * "WebGPU failed": "compute failed" names the ENGINE the session wanted and
 * couldn't get.
 *
 * @param foldShaped Whether the active system is fold-shaped — i.e. the
 *   class `surface-compute.ts` would prefer. Affine/escape/4D systems have
 *   nothing to explain: WebGL is their natural engine, not a fallback.
 * @param supported Whether WebGPU is even available (`navigator.gpu` exists
 *   and `requestAdapter()` returned an adapter, upstream of any session).
 * @param block The surface session's own compute-adapter outcome, or `null`
 *   before/without one.
 */
export function surfaceWebglDetail(args: {
  foldShaped: boolean;
  supported: boolean;
  block: SurfaceComputeBlock | null;
}): string | null {
  if (!args.foldShaped) return null;
  if (!args.supported || args.block === "unavailable")
    return "compute unavailable";
  if (args.block === "failed") return "compute failed";
  return null;
}

/**
 * The user-facing warning line for a detected software renderer/adapter,
 * shown once per session so a silent 10-50x slowdown doesn't read as "this
 * app is just slow". `label` is the {@link webgpuAdapterStatus} label or
 * {@link unmaskedWebglRenderer} string that triggered the warning.
 *
 * The leading token names the condition (engine first, so a skimmed banner
 * still says which stack is affected); the `chrome://gpu` hint is the bead's
 * requested breadcrumb — the field incident behind fr-tmgf was a browser
 * that had silently blocklisted the GPU, and "check its GPU settings" is the
 * one-line fix a user can act on without filing a bug.
 */
export function softwareWarningText(
  kind: "webgl" | "webgpu",
  label: string,
): string {
  if (kind === "webgl") {
    return (
      `Software WebGL renderer — ${label}. The browser is not using the ` +
      `GPU, so renders run 10–50× slower; check its GPU settings (e.g. ` +
      `chrome://gpu).`
    );
  }
  return (
    `Software WebGPU adapter — ${label}. Surface compute is rasterizing ` +
    `on the CPU instead of the GPU.`
  );
}
