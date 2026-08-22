#!/usr/bin/env node
/**
 * Declarative persisted-document fixtures for the fr-cmtl.8 pattern release
 * gate. This module deliberately contains no browser or renderer code. It owns
 * only exact audited scene inputs, engine-arm legality, immutable document
 * derivation, and the hero matrix coordinate contract.
 *
 * The three hero inputs are NOT release-ready yet. Their audited documents do
 * not carry a calibrated camera pose that can cover a true 1x/4x/16x/64x
 * ladder while OrbitCamera stays inside its persisted radius range [1, 100].
 * buildReleaseHeroMatrix therefore fails closed until callers supply a minted
 * status:ready baseHash for every hero. No synthetic zoomDE or guessed camera
 * is permitted here.
 */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const PATTERN_FAMILIES = Object.freeze([
  "none",
  "wood",
  "marble",
  "strata",
]);
export const ZOOM_FACTORS = Object.freeze([1, 4, 16, 64]);
export const HERO_SLICE_CENTERS = Object.freeze([0, 0.3]);
export const EXPECTED_HERO_CELL_COUNT = 128;
export const EXPECTED_CALIBRATION_PREFLIGHT_CELL_COUNT = 16;

const PATTERN_SCALE = Object.freeze({ wood: 3, marble: 1.35, strata: 2.6 });
const PATTERN_AXES = Object.freeze(["y", "z", "x"]);
const CAMERA_MIN_RADIUS = 1;
const CAMERA_MAX_RADIUS = 100;

function clone(value) {
  return structuredClone(value);
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertSceneDocument(document, label = "scene document") {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  ) {
    throw new TypeError(label + " must be an object");
  }
  if (!Array.isArray(document.transforms) || document.transforms.length === 0) {
    throw new TypeError(label + " must contain at least one transform");
  }
}

/** Decode #v1 or v1 base64url wire data and return a recursively frozen copy. */
export function decodeSceneHash(hash) {
  if (typeof hash !== "string")
    throw new TypeError("scene hash must be a string");
  const match = /^#?v1=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) throw new TypeError("scene hash must be #v1=<base64url>");
  let document;
  try {
    document = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  } catch (error) {
    throw new TypeError("scene hash payload is not valid JSON", {
      cause: error,
    });
  }
  assertSceneDocument(document);
  return deepFreeze(document);
}

/** Encode a detached document using the app's JSON plus base64url v1 wire. */
export function encodeSceneHash(document) {
  assertSceneDocument(document);
  return (
    "#v1=" +
    Buffer.from(
      JSON.stringify(clone(document), (_key, value) =>
        typeof value === "number" && Number.isFinite(value)
          ? round4(value)
          : value,
      ),
      "utf8",
    ).toString("base64url")
  );
}

/** Normalize prefix and JSON wire without changing decoded field order/values. */
export function canonicalSceneHash(hash) {
  return encodeSceneHash(decodeSceneHash(hash));
}

/**
 * Derive from a frozen source without exposing mutation of either source or
 * result. The callback receives an isolated mutable draft and may return a
 * replacement document or leave its edits on the draft.
 */
export function deriveSceneDocument(source, edit) {
  const base = typeof source === "string" ? decodeSceneHash(source) : source;
  assertSceneDocument(base);
  if (typeof edit !== "function")
    throw new TypeError("edit must be a function");
  const before = JSON.stringify(base);
  const draft = clone(base);
  const replacement = edit(draft);
  const result = replacement === undefined ? draft : replacement;
  assertSceneDocument(result, "derived scene document");
  if (JSON.stringify(base) !== before) {
    throw new Error("variant derivation mutated its source document");
  }
  return deepFreeze(clone(result));
}

export function deriveSceneHash(source, edit) {
  return encodeSceneHash(deriveSceneDocument(source, edit));
}

export function withGroundPlaneDisabled(source) {
  return deriveSceneHash(source, (document) => {
    document.groundPlane = false;
  });
}

export function withSurfaceColorSource(source, colorSource) {
  const allowed = [
    "transform",
    "palette",
    "height",
    "radius",
    "rings",
    "sheets",
  ];
  if (!allowed.includes(colorSource)) {
    throw new TypeError(
      "unsupported surface color source " + String(colorSource),
    );
  }
  return deriveSceneHash(source, (document) => {
    document.surface = { ...document.surface, colorSource };
  });
}

/** Author every base transform, which is mandatory for all 4D fixtures. */
export function withPatternFamily(source, family) {
  if (!PATTERN_FAMILIES.includes(family)) {
    throw new TypeError("unsupported pattern family " + String(family));
  }
  return deriveSceneHash(source, (document) => {
    for (const [index, transform] of document.transforms.entries()) {
      if (family === "none") {
        delete transform.surfacePattern;
        continue;
      }
      transform.surfacePattern = {
        kind: family,
        axis: PATTERN_AXES[index % PATTERN_AXES.length],
        scale: PATTERN_SCALE[family],
        strength: 1,
      };
    }
  });
}

export function withCameraPose(source, pose) {
  if (
    pose === null ||
    typeof pose !== "object" ||
    !Array.isArray(pose.target) ||
    pose.target.length !== 3 ||
    !pose.target.every(Number.isFinite) ||
    ![pose.radius, pose.theta, pose.phi].every(Number.isFinite)
  ) {
    throw new TypeError("camera pose is incomplete or non-finite");
  }
  if (pose.radius < CAMERA_MIN_RADIUS || pose.radius > CAMERA_MAX_RADIUS) {
    throw new RangeError("camera radius is outside [1, 100]");
  }
  return deriveSceneHash(source, (document) => {
    document.camera = clone(pose);
  });
}

export function withFourDSlice(source, sliceCenter) {
  if (!Number.isFinite(sliceCenter) || sliceCenter < -1 || sliceCenter > 1) {
    throw new RangeError("4D slice center is outside [-1, 1]");
  }
  return deriveSceneHash(source, (document) => {
    if (!document.fourD) {
      throw new Error(
        "cannot derive a 4D slice without a persisted fourD pose",
      );
    }
    document.fourD = { ...document.fourD, sliceCenter };
  });
}

function containsKey(value, key) {
  if (value === null || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((child) => containsKey(child, key));
}

function assertFourDecimalWire(value, path = "document") {
  if (typeof value === "number") {
    assert.equal(round4(value), value, path + " exceeds four decimal places");
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assertFourDecimalWire(child, path + "." + key);
  }
}

const dualArm = (preferredEngine) => ({
  legalEngines: ["compute", "webgl"],
  refusalEngines: [],
  preferredEngine,
});

/**
 * Exact production routing contract. surfacecompute is required to measure the
 * otherwise-WebGL affine3/LUT/by-transform compute arm; surfacegl is the
 * universal fragment fallback selector. fold4 and escape4 have no WebGL
 * renderer, although fold4 deliberately exposes a WebGL refusal arm.
 */
export const ENGINE_ROUTES = deepFreeze({
  affine3: { dimension: 3, ...dualArm("webgl") },
  fold3: { dimension: 3, ...dualArm("compute") },
  lens3: { dimension: 3, ...dualArm("compute") },
  escape3: { dimension: 3, ...dualArm("compute") },
  bulb3: { dimension: 3, ...dualArm("compute") },
  affine4: { dimension: 4, ...dualArm("compute") },
  kaleido4: { dimension: 4, ...dualArm("compute") },
  fold4: {
    dimension: 4,
    legalEngines: ["compute"],
    refusalEngines: ["webgl"],
    preferredEngine: "compute",
  },
  escape4: {
    dimension: 4,
    legalEngines: ["compute"],
    refusalEngines: [],
    preferredEngine: "compute",
  },
  balloon3: { dimension: 3, ...dualArm("compute") },
  lut3: { dimension: 3, ...dualArm("webgl") },
  byTransform3: { dimension: 3, ...dualArm("webgl") },
});

export function engineArm(routeId, engine) {
  const route = ENGINE_ROUTES[routeId];
  if (!route) throw new TypeError("unknown engine route " + String(routeId));
  if (route.legalEngines.includes(engine)) {
    return deepFreeze({
      engine,
      expectation: "render",
      queryFlag: engine === "compute" ? "surfacecompute" : "surfacegl",
    });
  }
  if (route.refusalEngines.includes(engine)) {
    return deepFreeze({
      engine,
      expectation: "refusal",
      queryFlag: "surfacegl",
    });
  }
  throw new Error(routeId + " has no legal " + engine + " arm");
}

// Exact source documents, copied byte-for-byte from their audited harnesses.
// Source hashes remain separate from derived measurement hashes so provenance
// is reviewable and no ground-plane edit can masquerade as an original mint.
export const AUDITED_SOURCE_HASHES = deepFreeze({
  affine3:
    "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMC44LDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlswLjc1LC0wLjQsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6Wy0wLjM3NSwtMC40LDAuNjVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNzUsLTAuNCwtMC42NV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMzE1NCwwLjMwNzQsMC4wMTA2XSwicmFkaXVzIjo0LjE3NDcsInRoZXRhIjowLjc4NTQsInBoaSI6MS4wNTZ9fQ",
  fold3:
    "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNywwLjcsMC43XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC4xOSwwLjE5LDAuMTldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoxLjJ9XX0seyJwb3NpdGlvbiI6WzAuNywwLjcsLTAuN10sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuMTksMC4xOSwwLjE5XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6Im1hbmRlbGJveCIsIndlaWdodCI6MS4yfV19LHsicG9zaXRpb24iOlswLjcsLTAuNywwLjddLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjE5LDAuMTksMC4xOV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJtYW5kZWxib3giLCJ3ZWlnaHQiOjEuMn1dfSx7InBvc2l0aW9uIjpbMC43LC0wLjcsLTAuN10sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuMTksMC4xOSwwLjE5XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6Im1hbmRlbGJveCIsIndlaWdodCI6MS4yfV19LHsicG9zaXRpb24iOlstMC43LDAuNywwLjddLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjE5LDAuMTksMC4xOV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJtYW5kZWxib3giLCJ3ZWlnaHQiOjEuMn1dfSx7InBvc2l0aW9uIjpbLTAuNywwLjcsLTAuN10sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuMTksMC4xOSwwLjE5XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6Im1hbmRlbGJveCIsIndlaWdodCI6MS4yfV19LHsicG9zaXRpb24iOlstMC43LC0wLjcsMC43XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC4xOSwwLjE5LDAuMTldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoxLjJ9XX0seyJwb3NpdGlvbiI6Wy0wLjcsLTAuNywtMC43XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC4xOSwwLjE5LDAuMTldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoxLjJ9XX0seyJwb3NpdGlvbiI6WzAuNjIsMC42MiwwLjYyXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC42NiwwLjY2LDAuNjZdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MX1dfSx7InBvc2l0aW9uIjpbMC42MiwtMC42MiwtMC42Ml0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNjYsMC42NiwwLjY2XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjF9XX0seyJwb3NpdGlvbiI6Wy0wLjYyLDAuNjIsLTAuNjJdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjY2LDAuNjYsMC42Nl0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC42MiwtMC42MiwwLjYyXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC42NiwwLjY2LDAuNjZdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MX1dfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxfQ",
  lens3:
    "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMzUsMC4zNSwwLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMzUsLTAuMzUsMC4zNV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6WzAuMzUsLTAuMzUsLTAuMzVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNSwwLjM1LC0wLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJmaW5hbFRyYW5zZm9ybSI6eyJwb3NpdGlvbiI6WzAuMTUsLTAuMSwwLjA1XSwicm90YXRpb24iOlswLjIsMC4zLDAuMV0sInNjYWxlIjpbMC45LDAuOSwwLjldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MC41NX1dfSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMDU2OSwtMC4wOTI1LC0wLjAzNDhdLCJyYWRpdXMiOjEuNDM5OCwidGhldGEiOjAuNzg1NCwicGhpIjoxLjA1Nn19",
  escape3:
    "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjEsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOnRydWV9",
  affine4:
    "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInciOnsicG9zaXRpb24iOjAuNSwicm90YXRpb24iOnsieHciOjAuM319fSx7InBvc2l0aW9uIjpbLTAuMjUsMC40MywwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMjUsLTAuNDMsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MX0",
  kaleido4:
    "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidyI6eyJwb3NpdGlvbiI6MC40LCJyb3RhdGlvbiI6eyJ4dyI6MC4zfX19LHsicG9zaXRpb24iOlstMC40LC0wLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidyI6eyJwb3NpdGlvbiI6LTAuNCwicm90YXRpb24iOnsieXciOjAuM319fV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjo2LCJwbGFuZSI6Inh6IiwidHdpc3QiOjF9LCJnbG93QnJpZ2h0bmVzcyI6MX0",
  fold4:
    "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjF9XSwidyI6eyJwb3NpdGlvbiI6MC4zLCJyb3RhdGlvbiI6eyJ4dyI6MC4zfX19LHsicG9zaXRpb24iOlstMC40LC0wLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjF9XSwidyI6eyJwb3NpdGlvbiI6LTAuMywicm90YXRpb24iOnsieXciOjAuMjV9fX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MX0",
  escape4:
    "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjotMS41fV0sInciOnsicm90YXRpb24iOnsieHciOjF9fX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiYmFsbG9vbkVjaG8iOmZhbHNlLCJiYWxsb29uUmFkaXVzIjoxLjYsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6ZmFsc2V9",
  boxfoldPair3:
    "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjQ1LDAuNDUsMC40NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC4zNSwtMC4yLDAuM10sInJvdGF0aW9uIjpbMCwwLjUsMC4xXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjowLjl9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwiYXhpcyI6InkifSwiZ2xvd0JyaWdodG5lc3MiOjF9",
});

// Mandelbulb Classic has no embedded reusable hash in the old browser gates.
// This is the exact preset recipe from presets.ts: one identity map whose only
// variation is bulb weight 1, encoded over the audited escape3 document shell.
const BULB3_SOURCE_HASH = deriveSceneHash(
  AUDITED_SOURCE_HASHES.escape3,
  (document) => {
    document.transforms = [
      {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "bulb", weight: 1 }],
      },
    ];
    document.groundPlane = false;
  },
);

function declareFixture({ id, routeId, sourceHash, provenance, derive }) {
  const canonicalSource = canonicalSceneHash(sourceHash);
  const measurementHash = deriveSceneHash(canonicalSource, (document) => {
    document.groundPlane = false;
    if (derive) derive(document);
  });
  const document = decodeSceneHash(measurementHash);
  return deepFreeze({
    id,
    routeId,
    dimension: ENGINE_ROUTES[routeId].dimension,
    sourceHash: canonicalSource,
    measurementHash,
    provenance,
    legalEngines: ENGINE_ROUTES[routeId].legalEngines,
    refusalEngines: ENGINE_ROUTES[routeId].refusalEngines,
    canonicalCamera: document.camera ? clone(document.camera) : null,
    canonicalFourD: document.fourD ? clone(document.fourD) : null,
  });
}

export const FIXTURES = deepFreeze({
  affine3: declareFixture({
    id: "affine3",
    routeId: "affine3",
    sourceHash: AUDITED_SOURCE_HASHES.affine3,
    provenance:
      "surface-repro.verify.mjs sierpinski3 pose pin; radius 4.1747 is canonical but not a 64x hero calibration",
  }),
  fold3: declareFixture({
    id: "fold3",
    routeId: "fold3",
    sourceHash: AUDITED_SOURCE_HASHES.fold3,
    provenance:
      "surface-fallback.verify.mjs FOLD_HASH; exact twelve-map Mandelbox KIFS, pose-less",
  }),
  lens3: declareFixture({
    id: "lens3",
    routeId: "lens3",
    sourceHash: AUDITED_SOURCE_HASHES.lens3,
    provenance:
      "pattern.compute.verify.mjs LENS3_HASH; canonical camera radius 1.4398",
  }),
  escape3: declareFixture({
    id: "escape3",
    routeId: "escape3",
    sourceHash: AUDITED_SOURCE_HASHES.escape3,
    provenance:
      "pattern.compute.verify.mjs ESCAPE3_HASH; single Mandelbox escape map, original floor removed for measurement",
  }),
  bulb3: declareFixture({
    id: "bulb3",
    routeId: "bulb3",
    sourceHash: BULB3_SOURCE_HASH,
    provenance:
      "exact mandelbulbClassic preset recipe from presets.ts encoded over the audited v1 document shell",
  }),
  affine4: declareFixture({
    id: "affine4",
    routeId: "affine4",
    sourceHash: AUDITED_SOURCE_HASHES.affine4,
    provenance:
      "surface-4d.verify.mjs PLAIN4_HASH; exact three-map affine4 scene, pose-less",
  }),
  kaleido4: declareFixture({
    id: "kaleido4",
    routeId: "kaleido4",
    sourceHash: AUDITED_SOURCE_HASHES.kaleido4,
    provenance:
      "surface-4d.verify.mjs KALEIDO4_HASH; exact order-6 twist-1 scene, pose-less",
  }),
  fold4: declareFixture({
    id: "fold4",
    routeId: "fold4",
    sourceHash: AUDITED_SOURCE_HASHES.fold4,
    provenance:
      "surface-4d.verify.mjs FOLD4_HASH; exact two-map 4D boxfold scene, compute-only",
  }),
  escape4: declareFixture({
    id: "escape4",
    routeId: "escape4",
    sourceHash: AUDITED_SOURCE_HASHES.escape4,
    provenance:
      "pattern.compute.verify.mjs ESCAPE4_HASH; dense Mandelbox Brick, original floor removed for measurement",
  }),
  balloon3: declareFixture({
    id: "balloon3",
    routeId: "balloon3",
    sourceHash: AUDITED_SOURCE_HASHES.boxfoldPair3,
    provenance:
      "surface-repro.verify.mjs BOXFOLD_BASE_HASH plus balloon-real-driver.verify.mjs radius 1.6",
    derive(document) {
      document.balloonEcho = true;
      document.balloonRadius = 1.6;
    },
  }),
  lut3: declareFixture({
    id: "lut3",
    routeId: "lut3",
    sourceHash: AUDITED_SOURCE_HASHES.affine3,
    provenance:
      "affine3 geometry with the persisted orbit-trap palette LUT source",
    derive(document) {
      document.surface = { ...document.surface, colorSource: "palette" };
    },
  }),
  byTransform3: declareFixture({
    id: "byTransform3",
    routeId: "byTransform3",
    sourceHash: AUDITED_SOURCE_HASHES.affine3,
    provenance: "affine3 geometry with persisted By Transform coloring",
    derive(document) {
      document.surface = { ...document.surface, colorSource: "transform" };
    },
  }),
});

/** Runnable compatibility inventory; every fixture uses its floor-off hash. */
export function buildCompatibilityFixtures() {
  return Object.values(FIXTURES).map((fixture) =>
    deepFreeze({
      id: fixture.id,
      routeId: fixture.routeId,
      documentHash: fixture.measurementHash,
      arms: [
        ...fixture.legalEngines.map((engine) =>
          engineArm(fixture.routeId, engine),
        ),
        ...fixture.refusalEngines.map((engine) =>
          engineArm(fixture.routeId, engine),
        ),
      ],
    }),
  );
}

export const HERO_DEFINITIONS = deepFreeze({
  affine3: {
    id: "affine3",
    fixtureId: "affine3",
    routeId: "affine3",
    sliceCenters: [null],
    calibration: {
      status: "uncalibrated",
      reusablePose: FIXTURES.affine3.canonicalCamera,
      reason:
        "canonical radius 4.1747 would clamp before 16x; mint an enlarged persisted 1x scene with radius >=64",
    },
  },
  fold3: {
    id: "fold3",
    fixtureId: "fold3",
    routeId: "fold3",
    sliceCenters: [null],
    calibration: {
      status: "uncalibrated",
      reusablePose: null,
      reason:
        "Mandelbox KIFS source is pose-less and nonlinear; calibrate coverage and a surface-targeted radius >=64",
    },
  },
  affine4: {
    id: "affine4",
    fixtureId: "affine4",
    routeId: "affine4",
    sliceCenters: HERO_SLICE_CENTERS,
    calibration: {
      status: "uncalibrated",
      reusablePose: null,
      reason:
        "plain4 source is pose-less; mint persisted camera and rotor before deriving its two slice variants",
    },
  },
});

function scaleVec3(values, factor) {
  return values.map((value) => round4(value * factor));
}

function clearMeasurementDecorations(document) {
  document.groundPlane = false;
  for (const transform of document.transforms) delete transform.surfacePattern;
  if (document.finalTransform) delete document.finalTransform.surfacePattern;
}

// Candidate A: a true homothety of the audited Sierpinski pin. Map scales and
// rotations stay bit-identical; only xyz translations, camera target, and the
// camera radius move into a range where 64x remains above OrbitCamera's floor.
const AFFINE3_CANDIDATE_HASH = deriveSceneHash(
  AUDITED_SOURCE_HASHES.affine3,
  (document) => {
    const factor = 96 / document.camera.radius;
    for (const transform of document.transforms) {
      transform.position = scaleVec3(transform.position, factor);
    }
    document.camera = {
      ...document.camera,
      target: scaleVec3(document.camera.target, factor),
      radius: 96,
    };
    clearMeasurementDecorations(document);
  },
);

// Candidate B: the audited Sierpinski tetrahedron with one pure spherefold on
// each base map. minRadius/fixedRadius 0.95/1 keeps every folded map contractive
// (0.5 * 1/0.95^2 ~= 0.554) while exercising a genuinely nonlinear BASE-fold
// route with 3 inverse branches per map instead of boxfold's 27. The former
// audited KIFS subsets were measured and refused: four maps missed the 5-minute
// settle bound, while two maps made the 64x fallback an impractical all-hit
// frame. Positions and fold radii share the same similarity scale. The camera
// targets a seeded view-facing attractor extremum, keeping the deep view outside
// the surface instead of in a bounds-centre void.
const FOLD3_SCALE = 16.7152;
const FOLD3_PINNED_CAMERA = deepFreeze({
  target: [9.5995, 14.704, 1.0181],
  radius: 96,
  theta: 0.7854,
  phi: 1.056,
});
const FOLD3_CANDIDATE_HASH = deriveSceneHash(
  AUDITED_SOURCE_HASHES.affine3,
  (document) => {
    const factor = FOLD3_SCALE;
    for (const transform of document.transforms) {
      transform.position = scaleVec3(transform.position, factor);
      transform.variations = [
        {
          type: "spherefold",
          weight: 1,
          minRadius: round4(0.95 * factor),
          fixedRadius: round4(factor),
        },
      ];
    }
    document.camera = {
      ...FOLD3_PINNED_CAMERA,
      target: [...FOLD3_PINNED_CAMERA.target],
      radius: FOLD3_PINNED_CAMERA.radius,
    };
    clearMeasurementDecorations(document);
  },
);

// Candidate C: PLAIN4's affine map layout expanded in xyz. Each spatial map is
// duplicated at w translations +/-0.15 with w scale 0.5. Because both w maps
// exist for every xyz map, the attractor is the spatial gasket times the full
// interval [-0.3, 0.3]: slices 0 and 0.3 therefore contain the SAME spatial
// period-3 target without moving the camera. This makes slice attachment a
// real production-render invariant instead of aiming one slice at empty 4D
// space. Rotor and every slice field are persisted explicitly.
const AFFINE4_CANDIDATE_HASH = deriveSceneHash(
  AUDITED_SOURCE_HASHES.affine4,
  (document) => {
    const expanded = [];
    for (const transform of document.transforms) {
      for (const wPosition of [-0.15, 0.15]) {
        expanded.push({
          ...transform,
          position: scaleVec3(transform.position, 67.2),
          w: { position: wPosition, scale: 0.5 },
        });
      }
    }
    document.transforms = expanded;
    document.camera = {
      target: [24, -8.256, 0],
      radius: 96,
      theta: 0.7854,
      phi: 1.056,
    };
    document.fourD = {
      p: [1, 0, 0, 0],
      q: [1, 0, 0, 0],
      sliceOn: false,
      sliceCenter: 0,
      sliceThickness: 0,
      sliceRelColor: false,
    };
    clearMeasurementDecorations(document);
  },
);

/**
 * Browser-preflight inputs only. Candidate status means no coverage, interior,
 * exhaustion, or parity claim has been made. buildReleaseHeroMatrix never
 * reads this inventory and still requires separately minted status:ready
 * calibration input.
 */
export const HERO_CALIBRATION_CANDIDATES = deepFreeze({
  affine3: {
    id: "affine3",
    heroId: "affine3",
    routeId: "affine3",
    status: "candidate",
    baseHash: AFFINE3_CANDIDATE_HASH,
    sliceCenters: [null],
    provenance:
      "audited Sierpinski3 pin, xyz-map and camera-target homothety to persisted radius 96",
  },
  fold3: {
    id: "fold3-spherefold-tetrahedron",
    heroId: "fold3",
    routeId: "fold3",
    status: "candidate",
    baseHash: FOLD3_CANDIDATE_HASH,
    sliceCenters: [null],
    provenance:
      "audited Sierpinski tetrahedron with contractive pure spherefold maps, similarity-scaled around a seeded view-facing attractor extremum",
  },
  affine4: {
    id: "affine4-balanced-slice",
    heroId: "affine4",
    routeId: "affine4",
    status: "candidate",
    baseHash: AFFINE4_CANDIDATE_HASH,
    sliceCenters: HERO_SLICE_CENTERS,
    provenance:
      "PLAIN4 spatial maps x67.2, independently duplicated across a w interval, period-3 attractor target, identity rotor, explicit persisted camera and slice pose",
  },
});

/**
 * The declarative Cartesian product, usable for scheduling and invariant
 * checks even while hero camera calibration is outstanding. It contains no
 * documentHash and is therefore not runnable by design.
 */
export function buildHeroMatrixPlan() {
  const cells = [];
  for (const hero of Object.values(HERO_DEFINITIONS)) {
    const route = ENGINE_ROUTES[hero.routeId];
    for (const sliceCenter of hero.sliceCenters) {
      for (const engine of route.legalEngines) {
        for (const family of PATTERN_FAMILIES) {
          for (const zoom of ZOOM_FACTORS) {
            cells.push(
              deepFreeze({
                id:
                  hero.id +
                  "/" +
                  engine +
                  "/" +
                  family +
                  "/" +
                  String(zoom) +
                  "x" +
                  (sliceCenter === null ? "" : "/slice-" + String(sliceCenter)),
                heroId: hero.id,
                routeId: hero.routeId,
                engine,
                arm: engineArm(hero.routeId, engine),
                family,
                zoom,
                sliceCenter,
                documentHash: null,
                calibrationStatus: hero.calibration.status,
              }),
            );
          }
        }
      }
    }
  }
  assert.equal(cells.length, EXPECTED_HERO_CELL_COUNT);
  return deepFreeze(cells);
}

function assertCalibrationPreflightCell(cell) {
  const document = decodeSceneHash(cell.documentHash);
  assert.equal(cell.status, "candidate");
  assert.equal(cell.family, "none");
  assert.equal(cell.measurementStatus, "unmeasured");
  assert.equal(document.groundPlane, false, cell.id + " retained a floor");
  assert.equal(
    containsKey(document, "surfacePattern"),
    false,
    cell.id + " unexpectedly authored a pattern",
  );
  assert.equal(
    containsKey(document, "zoomDE"),
    false,
    cell.id + " contains zoomDE",
  );
  assert.equal(document.camera.radius, round4(96 / cell.zoom));
  assert(ENGINE_ROUTES[cell.routeId].legalEngines.includes(cell.engine));
  if (ENGINE_ROUTES[cell.routeId].dimension === 4) {
    assert(document.fourD, cell.id + " lost its fourD pose");
    assert.equal(document.fourD.sliceCenter, cell.sliceCenter);
  }
}

/**
 * Bounded browser-census schedule for candidate calibration only: pattern-none
 * at 1x and 64x, on both legal engines, and both affine4 slices. Results from
 * these cells decide whether a candidate may later be minted as ready; merely
 * building them conveys no coverage or exhaustion evidence.
 */
export function buildHeroCalibrationPreflight() {
  const cells = [];
  for (const candidate of Object.values(HERO_CALIBRATION_CANDIDATES)) {
    const base = decodeSceneHash(candidate.baseHash);
    for (const sliceCenter of candidate.sliceCenters) {
      for (const engine of ENGINE_ROUTES[candidate.routeId].legalEngines) {
        for (const zoom of [1, 64]) {
          let documentHash = withGroundPlaneDisabled(candidate.baseHash);
          documentHash = withCameraPose(documentHash, {
            ...base.camera,
            target: [...base.camera.target],
            radius: round4(base.camera.radius / zoom),
          });
          if (sliceCenter !== null) {
            documentHash = withFourDSlice(documentHash, sliceCenter);
          }
          documentHash = withPatternFamily(documentHash, "none");
          const cell = deepFreeze({
            id:
              "candidate/" +
              candidate.id +
              "/" +
              engine +
              "/" +
              String(zoom) +
              "x" +
              (sliceCenter === null ? "" : "/slice-" + String(sliceCenter)),
            candidateId: candidate.id,
            heroId: candidate.heroId,
            routeId: candidate.routeId,
            status: candidate.status,
            measurementStatus: "unmeasured",
            engine,
            arm: engineArm(candidate.routeId, engine),
            family: "none",
            zoom,
            sliceCenter,
            documentHash,
            provenance: candidate.provenance,
          });
          assertCalibrationPreflightCell(cell);
          cells.push(cell);
        }
      }
    }
  }
  assert.equal(cells.length, EXPECTED_CALIBRATION_PREFLIGHT_CELL_COUNT);
  return deepFreeze(cells);
}

function assertReadyCalibration(hero, calibration) {
  if (!calibration || calibration.status !== "ready") {
    throw new Error(
      hero.id +
        " hero is uncalibrated: " +
        (calibration?.reason || hero.calibration.reason),
    );
  }
  const baseHash = canonicalSceneHash(calibration.baseHash);
  const document = decodeSceneHash(baseHash);
  if (!document.camera) {
    throw new Error(hero.id + " calibration has no persisted camera pose");
  }
  const radius = document.camera.radius;
  if (
    !Number.isFinite(radius) ||
    radius > CAMERA_MAX_RADIUS ||
    radius / Math.max(...ZOOM_FACTORS) < CAMERA_MIN_RADIUS
  ) {
    throw new Error(
      hero.id + " calibrated 1x radius cannot produce an unclamped 64x pose",
    );
  }
  if (ENGINE_ROUTES[hero.routeId].dimension === 4 && !document.fourD) {
    throw new Error(
      hero.id + " calibration has no persisted fourD rotor/slice pose",
    );
  }
  if (containsKey(document, "zoomDE")) {
    throw new Error(hero.id + " calibration illegally contains zoomDE");
  }
  return baseHash;
}

function assertReleaseCell(cell) {
  const document = decodeSceneHash(cell.documentHash);
  assert.equal(
    document.groundPlane,
    false,
    cell.id + " ground plane must be off",
  );
  assert.equal(
    containsKey(document, "zoomDE"),
    false,
    cell.id + " contains zoomDE",
  );
  assert(ENGINE_ROUTES[cell.routeId].legalEngines.includes(cell.engine));
  if (ENGINE_ROUTES[cell.routeId].dimension === 4 && cell.family !== "none") {
    assert(
      document.transforms.every((transform) =>
        Boolean(
          transform.surfacePattern &&
          transform.surfacePattern.kind === cell.family,
        ),
      ),
      cell.id + " does not author the pattern on every 4D transform",
    );
  }
}

/**
 * Expand runnable persisted documents. Each calibration must be an explicitly
 * minted status:ready baseHash with the 1x camera, and with a fourD pose for
 * affine4. Zoom changes only camera.radius; target/theta/phi and the 4D rotor
 * remain byte-identical, preventing camera or slice swimming.
 */
export function buildReleaseHeroMatrix({ calibrations = {} } = {}) {
  const baseByHero = {};
  for (const hero of Object.values(HERO_DEFINITIONS)) {
    baseByHero[hero.id] = assertReadyCalibration(hero, calibrations[hero.id]);
  }

  const cells = buildHeroMatrixPlan().map((planned) => {
    const baseHash = baseByHero[planned.heroId];
    const base = decodeSceneHash(baseHash);
    let documentHash = withGroundPlaneDisabled(baseHash);
    documentHash = withCameraPose(documentHash, {
      ...base.camera,
      target: [...base.camera.target],
      radius: base.camera.radius / planned.zoom,
    });
    if (planned.sliceCenter !== null) {
      documentHash = withFourDSlice(documentHash, planned.sliceCenter);
    }
    documentHash = withPatternFamily(documentHash, planned.family);
    const cell = deepFreeze({
      ...planned,
      documentHash,
      calibrationStatus: "ready",
    });
    assertReleaseCell(cell);
    return cell;
  });
  assert.equal(cells.length, EXPECTED_HERO_CELL_COUNT);
  return deepFreeze(cells);
}

export function runFixtureSelfCheck() {
  const normalizedSources = Object.values(AUDITED_SOURCE_HASHES).map((hash) => {
    const normalized = canonicalSceneHash(hash);
    assert.equal(
      normalized,
      hash.startsWith("#") ? hash : "#" + hash,
      "an audited source hash did not round-trip byte-for-byte",
    );
    return normalized;
  });
  assert.equal(new Set(normalizedSources).size, normalizedSources.length);

  for (const fixture of Object.values(FIXTURES)) {
    const document = decodeSceneHash(fixture.measurementHash);
    assert.equal(document.groundPlane, false, fixture.id + " retained a floor");
    assert.equal(containsKey(document, "zoomDE"), false);
    for (const engine of fixture.legalEngines) {
      assert.equal(engineArm(fixture.routeId, engine).expectation, "render");
    }
    for (const engine of fixture.refusalEngines) {
      assert.equal(engineArm(fixture.routeId, engine).expectation, "refusal");
    }
  }

  const original = decodeSceneHash(FIXTURES.affine4.measurementHash);
  const before = JSON.stringify(original);
  const patterned = decodeSceneHash(withPatternFamily(original, "marble"));
  assert.equal(JSON.stringify(original), before);
  assert(patterned.transforms.every((transform) => transform.surfacePattern));
  assert.equal(
    decodeSceneHash(FIXTURES.balloon3.measurementHash).balloonEcho,
    true,
  );
  assert.equal(
    decodeSceneHash(FIXTURES.lut3.measurementHash).surface.colorSource,
    "palette",
  );
  assert.equal(
    decodeSceneHash(FIXTURES.byTransform3.measurementHash).surface.colorSource,
    "transform",
  );

  for (const candidate of Object.values(HERO_CALIBRATION_CANDIDATES)) {
    assert.equal(candidate.status, "candidate");
    assert.notEqual(candidate.status, "ready");
    assert.equal(canonicalSceneHash(candidate.baseHash), candidate.baseHash);
    const document = decodeSceneHash(candidate.baseHash);
    assert.equal(document.camera.radius, 96);
    assert.equal(document.groundPlane, false);
    assert.equal(containsKey(document, "surfacePattern"), false);
    assert.equal(containsKey(document, "zoomDE"), false);
    assertFourDecimalWire(document, candidate.id);
  }

  const affine3Source = decodeSceneHash(AUDITED_SOURCE_HASHES.affine3);
  const affine3Candidate = decodeSceneHash(
    HERO_CALIBRATION_CANDIDATES.affine3.baseHash,
  );
  const affine3Factor = 96 / affine3Source.camera.radius;
  for (const [index, transform] of affine3Candidate.transforms.entries()) {
    assert.deepEqual(
      transform.rotation,
      affine3Source.transforms[index].rotation,
    );
    assert.deepEqual(transform.scale, affine3Source.transforms[index].scale);
    assert.deepEqual(
      transform.position,
      scaleVec3(affine3Source.transforms[index].position, affine3Factor),
    );
  }
  assert.deepEqual(
    affine3Candidate.camera.target,
    scaleVec3(affine3Source.camera.target, affine3Factor),
  );

  const fold3Source = decodeSceneHash(AUDITED_SOURCE_HASHES.affine3);
  const fold3Candidate = decodeSceneHash(
    HERO_CALIBRATION_CANDIDATES.fold3.baseHash,
  );
  const fold3Factor = FOLD3_SCALE;
  assert.equal(fold3Candidate.finalTransform, undefined);
  for (const [index, transform] of fold3Candidate.transforms.entries()) {
    const source = fold3Source.transforms[index];
    assert.deepEqual(transform.rotation, source.rotation);
    assert.deepEqual(transform.scale, source.scale);
    assert.deepEqual(
      transform.position,
      scaleVec3(source.position, fold3Factor),
    );
    assert.deepEqual(transform.variations, [
      {
        type: "spherefold",
        weight: 1,
        minRadius: round4(0.95 * fold3Factor),
        fixedRadius: round4(fold3Factor),
      },
    ]);
  }
  assert.deepEqual(fold3Candidate.camera.target, FOLD3_PINNED_CAMERA.target);

  const affine4Source = decodeSceneHash(AUDITED_SOURCE_HASHES.affine4);
  const affine4Candidate = decodeSceneHash(
    HERO_CALIBRATION_CANDIDATES.affine4.baseHash,
  );
  assert.equal(affine4Candidate.transforms.length, 6);
  for (const [index, transform] of affine4Candidate.transforms.entries()) {
    const source = affine4Source.transforms[Math.floor(index / 2)];
    assert.deepEqual(transform.position, scaleVec3(source.position, 67.2));
    assert.deepEqual(transform.w, {
      position: index % 2 === 0 ? -0.15 : 0.15,
      scale: 0.5,
    });
  }
  assert.deepEqual(affine4Candidate.camera, {
    target: [24, -8.256, 0],
    radius: 96,
    theta: 0.7854,
    phi: 1.056,
  });
  assert.deepEqual(affine4Candidate.fourD, {
    p: [1, 0, 0, 0],
    q: [1, 0, 0, 0],
    sliceOn: false,
    sliceCenter: 0,
    sliceThickness: 0,
    sliceRelColor: false,
  });

  const preflight = buildHeroCalibrationPreflight();
  assert.equal(preflight.length, EXPECTED_CALIBRATION_PREFLIGHT_CELL_COUNT);
  assert.equal(preflight.filter((cell) => cell.heroId === "affine3").length, 4);
  assert.equal(preflight.filter((cell) => cell.heroId === "fold3").length, 4);
  assert.equal(preflight.filter((cell) => cell.heroId === "affine4").length, 8);
  assert(preflight.every((cell) => cell.status === "candidate"));
  assert(preflight.every((cell) => [1, 64].includes(cell.zoom)));

  const plan = buildHeroMatrixPlan();
  assert.equal(plan.length, EXPECTED_HERO_CELL_COUNT);
  assert.equal(plan.filter((cell) => cell.heroId === "affine3").length, 32);
  assert.equal(plan.filter((cell) => cell.heroId === "fold3").length, 32);
  assert.equal(plan.filter((cell) => cell.heroId === "affine4").length, 64);
  assert(plan.every((cell) => cell.documentHash === null));

  assert.throws(
    () => buildReleaseHeroMatrix(),
    /uncalibrated/,
    "release expansion must fail while hero poses are uncalibrated",
  );
  assert.throws(
    () => buildReleaseHeroMatrix({ calibrations: HERO_CALIBRATION_CANDIDATES }),
    /uncalibrated/,
    "candidate preflight inputs must never enter the ready release builder",
  );

  const expectedLegality = {
    affine3: "compute,webgl",
    fold3: "compute,webgl",
    lens3: "compute,webgl",
    escape3: "compute,webgl",
    bulb3: "compute,webgl",
    affine4: "compute,webgl",
    kaleido4: "compute,webgl",
    fold4: "compute",
    escape4: "compute",
    balloon3: "compute,webgl",
    lut3: "compute,webgl",
    byTransform3: "compute,webgl",
  };
  const expectedRefusals = {
    affine3: "",
    fold3: "",
    lens3: "",
    escape3: "",
    bulb3: "",
    affine4: "",
    kaleido4: "",
    fold4: "webgl",
    escape4: "",
    balloon3: "",
    lut3: "",
    byTransform3: "",
  };
  for (const [routeId, engines] of Object.entries(expectedLegality)) {
    assert.equal(ENGINE_ROUTES[routeId].legalEngines.join(","), engines);
    assert.equal(
      ENGINE_ROUTES[routeId].refusalEngines.join(","),
      expectedRefusals[routeId],
    );
  }

  return deepFreeze({
    fixtureCount: Object.keys(FIXTURES).length,
    plannedHeroCells: plan.length,
    calibrationPreflightCells: preflight.length,
    blockedHeroes: Object.keys(HERO_DEFINITIONS),
  });
}

const directRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (directRun) {
  const result = runFixtureSelfCheck();
  console.log(
    "pattern-release-fixtures: ok (" +
      String(result.fixtureCount) +
      " fixtures, " +
      String(result.plannedHeroCells) +
      " planned hero cells, " +
      String(result.calibrationPreflightCells) +
      " candidate preflight cells; release build blocked on " +
      result.blockedHeroes.join(", ") +
      ")",
  );
}
