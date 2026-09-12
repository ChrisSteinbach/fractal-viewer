/** Actual emitted GLSL/WGSL transport agreement, with analytic obstacles.
 * No primary marcher: the shared lighting functions receive analytic hit
 * points/rays. This gates transport arithmetic and all seven production
 * WGSL cores and representative production GLSL programs' compilation;
 * it is not a timing benchmark or visual approval.
 * Run alone: npx vitest run --config scripts/vitest.harness.config.ts
 * scripts/surface-lighting-agreement.harness.ts
 * Defaults to SwiftShader. For the actual display driver, supply a verified
 * XAUTHORITY and SURFACE_LIGHTING_DISPLAY=:0; software fallback then fails.
 *
 * ENVIRONMENT REFUSALS ARE DISCLOSED, NOT FATAL — a production GLSL
 * program whose compile/link fails with an EMPTY info log is a driver or
 * context limit, not source (a real GLSL error carries a log), so it is
 * recorded into `glslRefused` and the run continues, exiting green with
 * the refusal NAMED once the arithmetic agreement passes. The radeonsi/
 * ANGLE stack on the RX 7900 XTX shows the signature at the 3D
 * escape/trap/floor/finite row's vertex — the same prelude seven earlier
 * rows compiled fine, and the renderer itself compiles these sources in
 * a real session on this box. The refusal CASCADES once it starts (every
 * later compile refuses empty-log, into a fresh context too), so the
 * ORDER carries the harness: the arithmetic agreement runs FIRST, the
 * compilation sweep LAST on its own context. A refusal carrying a LOG is
 * still fatal: that is source. The record's own passing run was taken on
 * a machine where all fifteen compile.
 */
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import {
  SURFACE_LIGHTING_LANE_COUNT,
  surfaceLightingLanes,
  type SurfaceLighting,
} from "../src/fractal/surface-lighting";
import { surfaceLightingShaderSource } from "../src/fractal/surface-lighting-shader";
import { surfaceDeKernelWgsl } from "../src/fractal/surface-de-gpu";
import { resolveTiling } from "../src/fractal/tiling";
import type { ShapeSpec } from "../src/fractal/shapes";
import {
  createSurfaceMaterial,
  surfaceFragmentFor,
} from "../src/app/surface-material";
import {
  createSurfaceMaterial4,
  surface4FragmentFor,
} from "../src/app/surface-material-4d";

const N = 2048;

function productionGlslPrograms() {
  const sphere: ShapeSpec = {
    parts: [{ primitive: { kind: "sphere", radius: 0.4 }, combine: "union" }],
  };
  const lattice = resolveTiling(
    { kind: "lattice", cellScale: 1.5, clip: sphere },
    1,
  );
  const finite3 = resolveTiling({ group: "h3", clip: sphere });
  const finite4 = resolveTiling({ group: "f4", clip: sphere });
  const materials = [createSurfaceMaterial(), createSurfaceMaterial4()];
  // These declarations are Three's vertex prelude, not another vertex path.
  const prelude = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
in vec3 position;
in vec2 uv;
`;
  const vertices = materials.map((material) => prelude + material.vertexShader);
  materials.forEach((material) => material.dispose());
  const inverse = (
    lens = 0,
    balloon = 0,
    plane = 0,
    compound = false,
    tiling: Parameters<typeof surfaceFragmentFor>[14] = null,
  ) =>
    surfaceFragmentFor(
      0,
      lens,
      balloon,
      plane,
      0,
      1,
      1,
      undefined,
      null,
      compound ? [sphere] : null,
      false,
      0,
      compound ? 1 : 0,
      compound ? 1 : 0,
      tiling,
      compound ? 1 : 0,
      1,
    );
  const forward = (bulb: boolean) =>
    surfaceFragmentFor(
      bulb ? 0 : 1,
      0,
      0,
      1,
      bulb ? 1 : 0,
      1,
      1,
      undefined,
      sphere,
      null,
      false,
      bulb ? 0 : 1,
      0,
      0,
      bulb ? lattice : finite3,
      0,
      1,
    );
  const four = (
    swirl = 0,
    balloon = 0,
    plane = 0,
    compound = false,
    tiling: Parameters<typeof surface4FragmentFor>[7] = null,
  ) =>
    surface4FragmentFor(
      balloon,
      plane,
      1,
      1,
      compound ? [sphere] : null,
      compound ? 1 : 0,
      compound ? 1 : 0,
      tiling,
      swirl,
      1,
    );
  return [
    { name: "3D affine", fragment: inverse(), folds: 0, dim: 0 },
    { name: "3D fold", fragment: inverse(), folds: 1, dim: 0 },
    { name: "3D lens", fragment: inverse(1), folds: 1, dim: 0 },
    { name: "3D floor", fragment: inverse(0, 0, 1), folds: 1, dim: 0 },
    { name: "3D Balloon", fragment: inverse(0, 1), folds: 1, dim: 0 },
    {
      name: "3D compound finite/lens/Balloon",
      fragment: inverse(1, 1, 0, true, finite3),
      folds: 1,
      dim: 0,
    },
    {
      name: "3D compound lattice/lens/floor",
      fragment: inverse(1, 0, 1, true, lattice),
      folds: 1,
      dim: 0,
    },
    {
      name: "3D escape/trap/floor/finite",
      fragment: forward(false),
      folds: 0,
      dim: 0,
    },
    {
      name: "3D bulb/trap/floor/lattice",
      fragment: forward(true),
      folds: 0,
      dim: 0,
    },
    { name: "4D plain", fragment: four(), folds: 0, dim: 1 },
    { name: "4D swirl", fragment: four(1), folds: 0, dim: 1 },
    { name: "4D floor", fragment: four(0, 0, 1), folds: 0, dim: 1 },
    { name: "4D Balloon", fragment: four(0, 1), folds: 0, dim: 1 },
    {
      name: "4D compound finite/swirl/Balloon",
      fragment: four(1, 1, 0, true, finite4),
      folds: 0,
      dim: 1,
    },
    {
      name: "4D compound lattice/swirl/floor",
      fragment: four(1, 0, 1, true, lattice),
      folds: 0,
      dim: 1,
    },
  ].map((row) => ({ ...row, vertex: vertices[row.dim] }));
}

const rig: SurfaceLighting = {
  lights: [
    {
      position: [0, 0, 2],
      normal: [0, 0, -1],
      radius: 0.4,
      color: [1, 0.5, 0.25],
      intensity: 9,
    },
  ],
  ambient: [0, 0, 0],
  specular: 0,
  roughness: 0.4,
};

function sources(language: "glsl" | "wgsl") {
  const wg = language === "wgsl";
  const v3 = wg ? "vec3f" : "vec3";
  const f = wg ? "f32" : "float";
  const i = wg ? "i32" : "int";
  const fn = (name: string, args: string, result: string, body: string) =>
    wg
      ? `fn ${name}(${args}) -> ${result} { ${body} }\n`
      : `${result} ${name}(${args}) { ${body} }\n`;
  const shader = surfaceLightingShaderSource({
    language,
    field: (index) => `test[${index}]`,
  });
  const deps =
    fn("cinematicStepScale", "", f, "return 1.0;") +
    fn(
      "cinematicDE",
      wg ? "p: vec3f, workIndex: i32" : "vec3 p, int workIndex",
      f,
      `
      ${wg ? "let" : "int"} kind = ${i}(test[2].w);
      if (kind == 1) { return abs(p.z - 1.0) - 0.05; }
      if (kind == 2) { return max(abs(p.z - 1.0) - 0.05, 0.3 - length(p.xy)); }
      if (kind == 3) { return abs(p.z - 3.0) - 0.05; }
      if (kind == 6) { return 0.002; }
      return 100.0;
    `,
    ) +
    fn(
      "cinematicVisibilityInterval",
      wg ? "a: vec3f, b: vec3f" : "vec3 a, vec3 b",
      wg ? "vec2f" : "vec2",
      `return ${wg ? "vec2f" : "vec2"}(0.0, distance(a, b));`,
    ) +
    fn(
      "cinematicPlaneBlocked",
      wg ? "a: vec3f, b: vec3f" : "vec3 a, vec3 b",
      "bool",
      "return false;",
    ) +
    fn(
      "cinematicEnvironment",
      wg
        ? "p: vec3f, n: vec3f, rd: vec3f, base: vec3f, fa: vec4f, fb: vec4f"
        : "vec3 p, vec3 n, vec3 rd, vec3 base, vec4 fa, vec4 fb",
      v3,
      `return ${v3}(0.0);`,
    );
  if (wg)
    return `
@group(0) @binding(0) var<uniform> test: array<vec4f, ${SURFACE_LIGHTING_LANE_COUNT}>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
${deps}${shader}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${N}u) { return; }
  let pixel = vec2f(f32(gid.x), 0.0);
  let color = cinematicSurface(vec3f(0.0), vec3f(0.0, 0.0, 1.0), vec3f(0.0, 0.0, -1.0),
    vec3f(1.0), vec4f(0.4, 32.0, 0.0, 0.0), vec4f(0.0, 1.0, 0.0, 0.0), vec3f(0.0), pixel, 0);
  output[gid.x] = vec4f(color, cinematicVisibilityExhausted + 65536.0 * cinematicVisibilityInvalid);
}`;
  return `#version 300 es
precision highp float;
precision highp int;
uniform vec4 test[${SURFACE_LIGHTING_LANE_COUNT}];
out vec4 result;
${deps}${shader}
void main() {
  vec2 pixel = gl_FragCoord.xy - vec2(0.5);
  vec3 color = cinematicSurface(vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, -1.0),
    vec3(1.0), vec4(0.4, 32.0, 0.0, 0.0), vec4(0.0, 1.0, 0.0, 0.0), vec3(0.0), pixel, 0);
  result = vec4(color, cinematicVisibilityExhausted + 65536.0 * cinematicVisibilityInvalid);
}`;
}

it("agrees with analytic disk transport and preserves finite visibility", async () => {
  const rows = [
    { name: "disk 1 sample", kind: 0, samples: 1 },
    { name: "disk 8 samples", kind: 0, samples: 8 },
    { name: "occluding wall", kind: 1, samples: 1 },
    { name: "open aperture", kind: 2, samples: 1 },
    { name: "wall beyond emitter", kind: 3, samples: 1 },
    { name: "finite shadow exhaustion", kind: 6, samples: 1 },
  ].map((row) => {
    const authored = structuredClone(rig);
    const packed = surfaceLightingLanes(authored, {
      surfaceSamples: row.samples,
      shadowSteps: row.kind === 6 ? 2 : 128,
      sampleIndex: 0,
      epsilon: 1e-4,
    });
    // Lane 2's spare word carries the scenario the analytic obstacle
    // callbacks switch on; no authored value lives there.
    packed[11] = row.kind;
    return { ...row, authored, packed: Array.from(packed) };
  });
  const server = createServer((_request, response) =>
    response.end("<!doctype html>lighting agreement"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No localhost port");
  const display = process.env.SURFACE_LIGHTING_DISPLAY;
  // The machine's conditions, before the browser puts the lit GLSL leg on
  // the GPU: the agreement thresholds are the point, and a contender on
  // the ring bounds the leg too — so the run carries its own conditions
  // rather than asserting "a quiet machine" in prose. (The .mjs side of
  // this adoption is scripts/lib/machine-quiet.mjs; this sheet is TS and
  // reads the module directly.)
  const quiet = await quietBaseline(console.error);
  const contended = contendedReason(quiet);
  if (contended) {
    console.error(
      `UNCERTIFIED: another process was already on the GPU — ${contended};` +
        " do not read this run's agreement/timing rows.",
    );
  }
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: false,
    env: { ...process.env, ...(display ? { DISPLAY: display } : {}) },
    args: [
      ...(display ? ["--ozone-platform=x11"] : ["--headless=new"]),
      "--no-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      ...(display
        ? []
        : ["--use-webgpu-adapter=swiftshader", "--use-vulkan=swiftshader"]),
    ],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const cores: { name: string; source: string }[] = (
      [
        "affine",
        "fold",
        "affine4",
        "fold4",
        "escape",
        "escape4",
        "bulb",
      ] as const
    ).map((core) => ({
      name: core,
      source: surfaceDeKernelWgsl({
        mode: "shade",
        core,
        width: 4,
        workgroupSize: 32,
        sharedFrontier: false,
        bnbStage2: false,
        lighting: true,
        finish: true,
        pattern: true,
      }),
    }));
    for (const core of [
      "affine",
      "fold",
      "affine4",
      "fold4",
      "escape",
      "escape4",
      "bulb",
    ] as const) {
      for (const wrapper of ["floor", "lattice"] as const) {
        cores.push({
          name: `${core}/${wrapper}`,
          source: surfaceDeKernelWgsl({
            mode: "shade",
            core,
            width: 4,
            workgroupSize: 32,
            sharedFrontier: false,
            bnbStage2: false,
            lighting: true,
            finish: true,
            pattern: true,
            groundPlane: wrapper === "floor",
            tiling:
              wrapper === "lattice"
                ? resolveTiling({ kind: "lattice", cellScale: 1.5 }, 1)
                : undefined,
          }),
        });
      }
    }
    for (const core of ["affine", "fold", "affine4", "fold4"] as const) {
      cores.push({
        name: `${core}/balloon`,
        source: surfaceDeKernelWgsl({
          mode: "shade",
          core,
          width: 4,
          workgroupSize: 32,
          sharedFrontier: false,
          bnbStage2: false,
          lighting: true,
          finish: true,
          pattern: true,
          balloon: true,
        }),
      });
    }
    const productionPrograms = productionGlslPrograms();
    const results = await page.evaluate(
      async ({ wgsl, glsl, rows, cores, programs, hardware, count }) => {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("No WebGPU adapter");
        const device = await adapter.requestDevice();
        for (const core of cores) {
          const info = await device
            .createShaderModule({ code: core.source })
            .getCompilationInfo();
          const errors = info.messages.filter(
            (message) => message.type === "error",
          );
          if (errors.length)
            throw new Error(
              `${core.name}: ${errors.map((e) => `${e.lineNum}:${e.message}`).join("\n")}`,
            );
        }
        const module = device.createShaderModule({ code: wgsl });
        const info = await module.getCompilationInfo();
        if (info.messages.some((m) => m.type === "error"))
          throw new Error(
            info.messages.map((m) => `${m.lineNum}:${m.message}`).join("\n"),
          );
        const pipeline = await device.createComputePipelineAsync({
          layout: "auto",
          compute: { module, entryPoint: "main" },
        });
        const uniform = device.createBuffer({
          size: 192,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const output = device.createBuffer({
          size: count * 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const readback = device.createBuffer({
          size: count * 16,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const group = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: { buffer: output } },
          ],
        });
        const canvas = document.createElement("canvas");
        canvas.width = count;
        canvas.height = 1;
        const gl = canvas.getContext("webgl2");
        if (!gl || !gl.getExtension("EXT_color_buffer_float"))
          throw new Error("No float WebGL2 framebuffer");
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = String(
          gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        );
        const adapterInfo = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.device} ${adapter.info.description}`;
        if (
          hardware &&
          /swiftshader|llvmpipe|software/i.test(renderer + adapterInfo)
        )
          throw new Error(
            `Requested real driver but got ${renderer}; ${adapterInfo}`,
          );
        // Name the failing program and quote the first offending line: a
        // bare info log (or an empty one) says nothing about which of the
        // fifteen programs the driver refused. THE EMPTY-LOG SIGNATURE IS
        // ENVIRONMENT, NOT SOURCE, and is recorded rather than fatal: a
        // real GLSL error carries a log, so a compile/link refusal whose
        // log is EMPTY is a driver/context limit — measured on this box's
        // radeonsi/ANGLE stack at the 3D escape/trap/floor/finite row's
        // VERTEX, the same prelude seven rows compiled fine, and the
        // refusal CASCADES: every later compile refuses too — including a
        // trivial three-line vertex, and into a FRESH context — so the
        // stuck state is the driver's, not any one program's or context's
        // (docs/cinematic-surface-lighting.md). The ORDER is the fix: the
        // arithmetic agreement runs FIRST, before the driver can go
        // stuck, and the compilation sweep runs LAST on its own context,
        // where its only output is the refusal record. A refusal carrying
        // a LOG is still fatal (that is source), and a lost context
        // records contextLost per refusal instead of surfacing later as
        // garbage pixels.
        const refused: {
          name: string;
          stage: string;
          contextLost: boolean;
          glError: string;
        }[] = [];
        const compile = (
          gl: WebGL2RenderingContext,
          type: number,
          source: string,
          name: string,
        ) => {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader) ?? "";
            if (log.trim() === "") {
              refused.push({
                name,
                stage: "compile",
                contextLost: gl.isContextLost(),
                glError: String(gl.getError()),
              });
              return null;
            }
            const line = Number(/:(\d+):/.exec(log)?.[1] ?? 0);
            const quoted = source.split("\n")[line - 1] ?? "";
            throw new Error(`${name}: ${log} | ${quoted}`);
          }
          return shader;
        };
        // The transport/arithmetic leg runs FIRST, on this first context: the
        // compilation sweep below can leave the driver stuck — measured on
        // this box's radeonsi/ANGLE stack, where every compile after the
        // first empty-log refusal returns empty logs too, even for trivial
        // source, and the stuck state took the WebGPU device down with it
        // (mapAsync: "A valid external Instance reference no longer
        // exists"). By the time that happens the agreement has been
        // measured; the sweep's only output is the refusal record.
        const program = gl.createProgram();
        const transportVertex = compile(
          gl,
          gl.VERTEX_SHADER,
          `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`,
          "transport vertex",
        );
        const transportFragment = compile(
          gl,
          gl.FRAGMENT_SHADER,
          glsl,
          "transport fragment",
        );
        if (transportVertex === null || transportFragment === null)
          throw new Error(
            `environment: the transport program itself was refused with ` +
              `an empty log — the arithmetic agreement cannot run on this ` +
              `box (the compilation sweep has not even run). Refused: ` +
              refused.map((r) => `${r.name} ${r.stage}`).join(", "),
          );
        gl.attachShader(program, transportVertex);
        gl.attachShader(program, transportFragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(program)!);
        gl.useProgram(program);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA32F,
          count,
          1,
          0,
          gl.RGBA,
          gl.FLOAT,
          null,
        );
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          texture,
          0,
        );
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        )
          throw new Error("Incomplete HDR framebuffer");
        gl.viewport(0, 0, count, 1);
        const out = [];
        for (const row of rows) {
          device.queue.writeBuffer(uniform, 0, new Float32Array(row.packed));
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.dispatchWorkgroups(Math.ceil(count / 64));
          pass.end();
          encoder.copyBufferToBuffer(output, 0, readback, 0, count * 16);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          const gpu = Array.from(new Float32Array(readback.getMappedRange()));
          readback.unmap();
          gl.uniform4fv(gl.getUniformLocation(program, "test[0]"), row.packed);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const pixels = new Float32Array(count * 4);
          gl.readPixels(0, 0, count, 1, gl.RGBA, gl.FLOAT, pixels);
          out.push({ name: row.name, gpu, gl: Array.from(pixels) });
        }
        device.destroy();
        // The compilation sweep runs LAST, on its own context: it can
        // leave the driver stuck (see the arithmetic leg's note), and its
        // only output is the refusal record. Empty-log refusals are
        // recorded and disclosed; a LOG-bearing failure is still fatal —
        // that is source. A lost context records contextLost per refusal
        // rather than throwing: the agreement is already measured.
        const compiled = [];
        const sweepCanvas = document.createElement("canvas");
        sweepCanvas.width = count;
        sweepCanvas.height = 1;
        const sweep = sweepCanvas.getContext("webgl2");
        if (!sweep || !sweep.getExtension("EXT_color_buffer_float"))
          throw new Error("No float WebGL2 framebuffer (compilation sweep)");
        for (const row of programs) {
          const vertex = compile(
            sweep,
            sweep.VERTEX_SHADER,
            row.vertex,
            `${row.name} vertex`,
          );
          if (vertex === null) continue;
          const fragment = compile(
            sweep,
            sweep.FRAGMENT_SHADER,
            `#version 300 es\nprecision highp int;\n#define SURFACE_FOLDS ${row.folds}\n${row.fragment}`,
            `${row.name} fragment`,
          );
          if (fragment === null) continue;
          const linked = sweep.createProgram();
          sweep.attachShader(linked, vertex);
          sweep.attachShader(linked, fragment);
          sweep.linkProgram(linked);
          if (!sweep.getProgramParameter(linked, sweep.LINK_STATUS)) {
            const log = sweep.getProgramInfoLog(linked) ?? "";
            if (log.trim() === "") {
              refused.push({
                name: row.name,
                stage: "link",
                contextLost: sweep.isContextLost(),
                glError: String(sweep.getError()),
              });
              sweep.deleteProgram(linked);
              continue;
            }
            throw new Error(`${row.name}: ${log}`);
          }
          compiled.push({ name: row.name, bytes: row.fragment.length });
          sweep.deleteProgram(linked);
          sweep.deleteShader(vertex);
          sweep.deleteShader(fragment);
        }
        return {
          rows: out,
          compiled,
          refused,
          renderer,
          adapter: adapterInfo,
        };
      },
      {
        wgsl: sources("wgsl"),
        glsl: sources("glsl"),
        rows,
        cores,
        programs: productionPrograms,
        hardware: !!display,
        count: N,
      },
    );
    // Every production program is accounted for, compiled or refused; the
    // refusal list is the DISCLOSURE, not a pass-by-silence.
    expect(
      results.compiled.length + results.refused.length,
      "every production program accounted for",
    ).toBe(productionPrograms.length);
    if (results.refused.length > 0)
      console.log(
        `ENVIRONMENT LIMITATION (${results.renderer}): ` +
          `${String(results.refused.length)} of ${String(productionPrograms.length)} ` +
          `production GLSL programs refused with EMPTY logs — a driver/` +
          `context resource limit, not source (a real GLSL error carries ` +
          `a log; the same prelude compiled fine in earlier rows; the ` +
          `record's passing run was taken on a different machine). ` +
          `Refused: ` +
          results.refused.map((r) => `${r.name} ${r.stage}`).join(", ") +
          `. Compiled: ` +
          results.compiled.map((c) => c.name).join(", ") +
          `. The arithmetic agreement below is INTACT — it gates what ` +
          `compiled. Known-good on this box by other means: the renderer ` +
          `itself progresses lit sessions on ?surfacegl on the real ` +
          `driver (docs/cinematic-surface-lighting.md).`,
      );
    console.log(
      JSON.stringify({
        renderer: results.renderer,
        adapter: results.adapter,
        wgslPrograms: cores.length,
        glslPrograms: results.compiled,
        glslRefused: results.refused,
      }),
    );
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const result = results.rows[index];
      const means = [result.gpu, result.gl].map((values) =>
        [0, 1, 2, 3].map(
          (channel) =>
            values
              .filter((_v, offset) => offset % 4 === channel)
              .reduce((a, b) => a + b, 0) / N,
        ),
      );
      for (let p = 0; p < result.gpu.length; p++) {
        expect(Number.isFinite(result.gpu[p]), row.name).toBe(true);
        expect(
          Math.abs(result.gpu[p] - result.gl[p]),
          `${row.name} GLSL/WGSL`,
        ).toBeLessThan(0.0003);
      }
      const expected =
        row.kind === 1 || row.kind === 6
          ? 0
          : 9 / (Math.PI ** 2 * (4 + 0.4 ** 2));
      expect(
        Math.abs(means[0][0] - expected),
        `${row.name} analytic`,
      ).toBeLessThan(Math.max(2e-6, expected * 0.004));
      expect(means[0][3], row.name).toBe(row.kind === 6 ? 1 : 0);
      console.log(
        JSON.stringify({
          name: row.name,
          wgsl: means[0],
          glsl: means[1],
          analyticRed: expected,
        }),
      );
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 300_000);
