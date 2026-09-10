/** Actual emitted GLSL/WGSL transport agreement, with analytic obstacles.
 * No primary marcher: the shared lighting functions receive analytic hit
 * points/rays. This gates transport arithmetic and all seven production
 * WGSL cores and representative production GLSL programs' compilation;
 * it is not a timing benchmark or visual approval.
 * Run alone: npx vitest run --config scripts/vitest.harness.config.ts
 * scripts/surface-lighting-agreement.harness.ts
 * Defaults to SwiftShader. For the actual display driver, supply a verified
 * XAUTHORITY and SURFACE_LIGHTING_DISPLAY=:0; software fallback then fails.
 */
import { createServer } from "node:http";
import { chromium } from "playwright-core";
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
        // fifteen programs the driver refused.
        const compile = (type: number, source: string, name: string) => {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader) ?? "";
            const line = Number(/:(\d+):/.exec(log)?.[1] ?? 0);
            const quoted = source.split("\n")[line - 1] ?? "";
            throw new Error(`${name}: ${log || "(empty log)"} | ${quoted}`);
          }
          return shader;
        };
        const compiled = [];
        for (const row of programs) {
          const vertex = compile(
            gl.VERTEX_SHADER,
            row.vertex,
            `${row.name} vertex`,
          );
          const fragment = compile(
            gl.FRAGMENT_SHADER,
            `#version 300 es\nprecision highp int;\n#define SURFACE_FOLDS ${row.folds}\n${row.fragment}`,
            `${row.name} fragment`,
          );
          const linked = gl.createProgram();
          gl.attachShader(linked, vertex);
          gl.attachShader(linked, fragment);
          gl.linkProgram(linked);
          if (!gl.getProgramParameter(linked, gl.LINK_STATUS))
            throw new Error(`${row.name}: ${gl.getProgramInfoLog(linked)}`);
          compiled.push({ name: row.name, bytes: row.fragment.length });
          gl.deleteProgram(linked);
          gl.deleteShader(vertex);
          gl.deleteShader(fragment);
        }
        const program = gl.createProgram();
        gl.attachShader(
          program,
          compile(
            gl.VERTEX_SHADER,
            `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`,
            "transport vertex",
          ),
        );
        gl.attachShader(
          program,
          compile(gl.FRAGMENT_SHADER, glsl, "transport fragment"),
        );
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
        return { rows: out, compiled, renderer, adapter: adapterInfo };
      },
      {
        wgsl: sources("wgsl"),
        glsl: sources("glsl"),
        rows,
        cores,
        programs: productionGlslPrograms(),
        hardware: !!display,
        count: N,
      },
    );
    console.log(
      JSON.stringify({
        renderer: results.renderer,
        adapter: results.adapter,
        wgslPrograms: cores.length,
        glslPrograms: results.compiled,
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
