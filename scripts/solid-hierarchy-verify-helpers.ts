export type SolidHierarchyDriver = "swiftshader" | "hardware";

export interface SolidHierarchyVerifyArgs {
  url: string;
  captures: number;
  warmups: number;
  resolution: number;
  driver: SolidHierarchyDriver;
  display: string;
  chrome?: string;
  outdir: string;
  fixtures: string[];
  timeoutMs: number;
}

function positiveInteger(flag: string, value: string, minimum = 1): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new RangeError(`${flag} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

/** Parse the verifier CLI without browser or filesystem side effects. */
export function parseSolidHierarchyVerifyArgs(
  argv: readonly string[],
): SolidHierarchyVerifyArgs {
  const args: SolidHierarchyVerifyArgs = {
    url: "https://localhost:5173",
    captures: 5,
    warmups: 2,
    resolution: 192,
    driver: "swiftshader",
    display: process.env.DISPLAY ?? ":0",
    outdir: ".playwright-mcp/solid-hierarchy",
    fixtures: ["default"],
    timeoutMs: 120_000,
  };
  const fixtures: string[] = [];
  for (const raw of argv) {
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (!match) throw new Error(`Unknown argument: ${raw}`);
    const [, key, value] = match;
    switch (key) {
      case "url":
        args.url = value.replace(/\/+$/, "");
        break;
      case "captures":
        args.captures = positiveInteger("--captures", value);
        break;
      case "warmups":
        args.warmups = positiveInteger("--warmups", value, 0);
        break;
      case "resolution":
        args.resolution = positiveInteger("--resolution", value, 64);
        if (args.resolution > 512) {
          throw new RangeError("--resolution must not exceed 512");
        }
        break;
      case "driver":
        if (value !== "swiftshader" && value !== "hardware") {
          throw new RangeError(
            "--driver must be either swiftshader or hardware",
          );
        }
        args.driver = value;
        break;
      case "display":
        if (value.length === 0) throw new RangeError("--display is empty");
        args.display = value;
        break;
      case "chrome":
        if (value.length === 0) throw new RangeError("--chrome is empty");
        args.chrome = value;
        break;
      case "outdir":
        if (value.length === 0) throw new RangeError("--outdir is empty");
        args.outdir = value;
        break;
      case "fixture":
        if (value.length === 0) throw new RangeError("--fixture is empty");
        fixtures.push(value);
        break;
      case "fixtures":
        fixtures.push(...value.split(",").filter(Boolean));
        break;
      case "timeout":
        args.timeoutMs = positiveInteger("--timeout", value);
        break;
      default:
        throw new Error(`Unknown argument: ${raw}`);
    }
  }
  if (fixtures.length > 0) args.fixtures = [...new Set(fixtures)];
  return args;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median needs a sample");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/** Original index of the measured capture nearest the median duration. */
export function medianSampleIndex(values: readonly number[]): number {
  const target = median(values);
  let best = 0;
  for (let index = 1; index < values.length; index++) {
    if (Math.abs(values[index] - target) < Math.abs(values[best] - target)) {
      best = index;
    }
  }
  return best;
}

export interface PixelComparison {
  changedChannels: number;
  maxChannelDelta: number;
  meanChannelDelta: number;
}

export function comparePixelChannels(
  accelerated: readonly number[],
  reference: readonly number[],
): PixelComparison {
  if (accelerated.length !== reference.length || accelerated.length === 0) {
    throw new RangeError("pixel buffers must be non-empty and equally sized");
  }
  let changedChannels = 0;
  let maxChannelDelta = 0;
  let sumChannelDelta = 0;
  for (let index = 0; index < accelerated.length; index++) {
    const delta = Math.abs(accelerated[index] - reference[index]);
    if (delta !== 0) changedChannels++;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    sumChannelDelta += delta;
  }
  return {
    changedChannels,
    maxChannelDelta,
    meanChannelDelta: sumChannelDelta / accelerated.length,
  };
}

/** Reject the common software GL adapters before publishing hardware data. */
export function rendererIsSoftware(renderer: string | null): boolean {
  return (
    renderer === null ||
    /swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|mesa offscreen/i.test(
      renderer,
    )
  );
}
