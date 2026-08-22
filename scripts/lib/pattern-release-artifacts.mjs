import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createRunDirectory(root, runId) {
  const directory = path.resolve(root, runId);
  await mkdir(directory, { recursive: false });
  await mkdir(path.join(directory, "raw"));
  await mkdir(path.join(directory, "effects"));
  await mkdir(path.join(directory, "masks"));
  await mkdir(path.join(directory, "sheets"));
  await mkdir(path.join(directory, "review"));
  return directory;
}

export async function writeRunArtifact(runDirectory, relative, contents) {
  const file = path.join(runDirectory, relative);
  await writeFile(file, contents, { flag: "wx" });
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  return {
    file,
    relative,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

export async function readRunArtifact(runDirectory, relative) {
  return readFile(path.join(runDirectory, relative));
}

async function decodePngInPage(page, png) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D canvas context is unavailable");
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let binary = "";
    const chunk = 0x8000;
    for (let start = 0; start < rgba.length; start += chunk) {
      binary += String.fromCharCode(...rgba.subarray(start, start + chunk));
    }
    return {
      width: canvas.width,
      height: canvas.height,
      rgbaBase64: btoa(binary),
    };
  }, png.toString("base64"));
}

export async function decodePng(page, png) {
  const decoded = await decodePngInPage(page, png);
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(Buffer.from(decoded.rgbaBase64, "base64")),
  };
}

function bytesBase64(values) {
  return Buffer.from(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  ).toString("base64");
}

export async function encodeMetricPngs(page, analysis) {
  const payload = {
    width: analysis.width,
    height: analysis.height,
    object: bytesBase64(analysis.objectMask),
    interior: bytesBase64(analysis.interiorMask),
    effectMask: bytesBase64(analysis.effectMask),
    effect: bytesBase64(analysis.effect),
  };
  const encoded = await page.evaluate((input) => {
    const decodeBytes = (base64) => {
      const raw = atob(base64);
      const result = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) result[i] = raw.charCodeAt(i);
      return result;
    };
    const decodeFloats = (base64) => {
      const bytes = decodeBytes(base64);
      return new Float64Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / Float64Array.BYTES_PER_ELEMENT,
      );
    };
    const object = decodeBytes(input.object);
    const interior = decodeBytes(input.interior);
    const effectMask = decodeBytes(input.effectMask);
    const effect = decodeFloats(input.effect);
    const make = (pixel) => {
      const canvas = document.createElement("canvas");
      canvas.width = input.width;
      canvas.height = input.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas context is unavailable");
      const image = context.createImageData(input.width, input.height);
      for (let p = 0; p < input.width * input.height; p++) {
        const offset = p * 4;
        const color = pixel(p);
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    };
    return {
      object: make((p) => (object[p] ? [255, 255, 255] : [0, 0, 0])),
      interior: make((p) =>
        interior[p] ? [255, 255, 255] : object[p] ? [70, 70, 70] : [0, 0, 0],
      ),
      effectMask: make((p) =>
        effectMask[p]
          ? [255, 255, 255]
          : interior[p]
            ? [45, 45, 45]
            : [0, 0, 0],
      ),
      effect: make((p) => {
        if (!interior[p]) return [0, 0, 0];
        const value = Math.max(-1, Math.min(1, effect[p]));
        const magnitude = Math.round(Math.abs(value) * 255);
        return value >= 0
          ? [magnitude, Math.round(magnitude * 0.15), 0]
          : [0, Math.round(magnitude * 0.15), magnitude];
      }),
    };
  }, payload);
  return Object.fromEntries(
    Object.entries(encoded).map(([name, base64]) => [
      name,
      Buffer.from(base64, "base64"),
    ]),
  );
}

export async function makeLabeledSheet(page, cards, columns = 4) {
  if (cards.length === 0) throw new Error("cannot create an empty sheet");
  return page
    .evaluate(
      async ({ cards, columns }) => {
        const images = await Promise.all(
          cards.map(async (card) => {
            const image = new Image();
            image.src = `data:image/png;base64,${card.pngBase64}`;
            await image.decode();
            return image;
          }),
        );
        const imageWidth = images[0].naturalWidth;
        const imageHeight = images[0].naturalHeight;
        if (
          images.some(
            (image) =>
              image.naturalWidth !== imageWidth ||
              image.naturalHeight !== imageHeight,
          )
        ) {
          throw new Error("sheet images have different dimensions");
        }
        const header = 44;
        const rows = Math.ceil(cards.length / columns);
        const canvas = document.createElement("canvas");
        canvas.width = columns * imageWidth;
        canvas.height = rows * (imageHeight + header);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2D canvas context is unavailable");
        context.fillStyle = "#11151a";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.textBaseline = "top";
        cards.forEach((card, index) => {
          const column = index % columns;
          const row = Math.floor(index / columns);
          const x = column * imageWidth;
          const y = row * (imageHeight + header);
          context.fillStyle = "#f4f6f8";
          context.fillText(card.lines[0] ?? "", x + 8, y + 5);
          context.fillStyle = "#aeb8c4";
          context.fillText(card.lines[1] ?? "", x + 8, y + 23);
          context.drawImage(images[index], x, y + header);
        });
        return canvas.toDataURL("image/png").split(",")[1];
      },
      {
        columns,
        cards: cards.map((card) => ({
          lines: card.lines,
          pngBase64: card.png.toString("base64"),
        })),
      },
    )
    .then((base64) => Buffer.from(base64, "base64"));
}
