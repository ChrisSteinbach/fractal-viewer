/**
 * THE FRAME CACHE — content-addressed memoization of settled gate frames.
 *
 * The epic's enabling fact (docs/gate-velocity.md): the project's settle-latch
 * discipline makes a settled frame a PURE FUNCTION of its inputs — the built
 * bundle, the scene document, the pose, the render mode and engine, the
 * raster settings, the device, and the gate's URL flags. So a settled frame
 * is memoizable, and a gate rerun whose inputs are unchanged can replay a
 * recorded verdict or re-diff a cached frame instead of re-rendering. This
 * module owns the key and the store; wiring gates to it is the next child's
 * work.
 *
 * THE KEYING DECISION — Candidate A, hash the built bundle's bytes — shipped;
 * Candidate B, per-module source closures, is declined with its measurable
 * trigger on record. Both the decision and the full nine-field key schema are
 * recorded in docs/gate-velocity.md; the field list is ENFORCED here:
 * `deriveFrameKey` requires every field and refuses unknown ones, because
 * this project has already paid the missing-field lesson once on the app side
 * (the offline-export force-frame memo key shipped without fog, envLight and
 * the backdrop shape, and an atmosphere-only leg exported the previous leg's
 * frame) — an absent field must be STATED as absent (null / {}), never
 * elided, or the key is a lie that reads as a hit.
 *
 * THE ELIGIBILITY BOUNDARY, enforced by shape rather than by review: the
 * store only accepts entries that carry a frame (a real PNG), so it records
 * FRAME-PURE verdicts — byte-exact reload, IoU, zero-thickness
 * byte-for-byte, distinct-objects, export identity, settle double-screenshot
 * equality — and structurally cannot record the ineligible ones (teardown,
 * fence cost, watchdog, staging ceiling, machine-quiet certification,
 * trusted-interaction timing), which measure the SESSION, not the frame, and
 * have no frame to put. A gate misusing the store for a timing verdict would
 * have to fabricate a PNG to do it. What a hit may REPLAY — the recorded
 * verdict wholesale, or only a re-diff against a fresh render — is the
 * wiring child's decision per gate; this module hands the caller both the
 * png bytes and the verdict and takes no side.
 *
 * NOT GOLDEN FILES. This is memoization keyed on exact input hashes. A hit
 * is valid exactly while the key is exact; nothing here substitutes a stale
 * frame for a fresh render the verdict logic could contradict.
 *
 * LAYOUT (under the gitignored scripts/out/, which is regenerated, never
 * committed):
 *
 *   <root>/<hh>/<64-hex>.json   the entry: key, canonical form, fields,
 *                               verdict, metadata
 *   <root>/<hh>/<64-hex>.png    the frame bytes
 *
 * The two-character directory fan-out mirrors a git object store; the hash
 * is over the CANONICAL JSON of the key fields, so the same frame demanded
 * by two different gates is ONE entry (gate and scenario names are entry
 * metadata, deliberately NOT key fields — that is what makes the cache
 * shared rather than per-gate).
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./dist-freshness.mjs";

/** The store's entry schema version. A bump invalidates every read of
 * older entries (lookup returns a miss) without touching the files. */
export const FRAME_CACHE_VERSION = 1;

/** Default root, relative to the repo — inside the gitignored scripts/out/. */
export const FRAME_CACHE_ROOT_DEFAULT = "scripts/out/frame-cache";

/** The nine key fields. See docs/gate-velocity.md for each one's contract. */
export const FRAME_CACHE_FIELDS = Object.freeze([
  "bundle",
  "document",
  "pose",
  "mode",
  "engine",
  "viewport",
  "raster",
  "device",
  "env",
]);

/** Bounded-store defaults: prune everything older than 45 days, and keep
 * the newest entries under 1 GiB of frames. A 960x540 settled PNG is
 * ~0.1-0.5 MB, so the byte bound holds a few thousand entries. */
export const FRAME_CACHE_MAX_BYTES_DEFAULT = 1024 * 1024 * 1024;
export const FRAME_CACHE_MAX_AGE_MS_DEFAULT = 45 * 24 * 60 * 60 * 1000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * The nine key fields, as a caller supplies them. See docs/gate-velocity.md
 * for each field's contract; `canonicalizeFields` enforces the shapes.
 *
 * @typedef {object} FrameCacheKeyFields
 * @property {string} bundle hashBundleDir(dist/app)'s hash
 * @property {string} document the full scene document string
 * @property {Record<string, unknown> | null} pose null when the document's
 *   own pose governs; the gate-driven pose object otherwise
 * @property {string} mode render mode ("surface", "flame", ...)
 * @property {string} engine "compute" vs "webgl" (or the flame/solid engine)
 * @property {{ width: number, height: number, scale: number }} viewport
 * @property {Record<string, unknown>} raster tier/samples/budget settings
 * @property {{ software: boolean, label: string }} device backend disclosure
 * @property {Record<string, string>} env flat gate env/URL flags
 */

/**
 * @typedef {object} FrameCacheEntryMeta
 * @property {string} gate
 * @property {string} scenario
 * @property {string} buildHash derived from fields.bundle
 * @property {number} createdAtMs
 * @property {number} [wallMs]
 * @property {string} [notes]
 */

/**
 * @typedef {object} FrameCacheEntry
 * @property {number} version
 * @property {string} key
 * @property {string} canonical
 * @property {Record<string, unknown>} fields
 * @property {unknown} verdict
 * @property {FrameCacheEntryMeta} meta
 */

/**
 * @typedef {object} FrameCachePutOptions
 * @property {FrameCacheKeyFields} fields
 * @property {Uint8Array | Buffer} png
 * @property {unknown} [verdict]
 * @property {{ gate: string, scenario: string, wallMs?: number, notes?: string }} meta
 */

/**
 * @typedef {object} FrameCacheHit
 * @property {string} hash
 * @property {FrameCacheEntry} entry
 * @property {Buffer} png
 * @property {string} entryPath
 * @property {string} pngPath
 */

/**
 * @typedef {object} FrameCachePruneRow
 * @property {string} hash
 * @property {string} reason "corrupt" | "orphan-json" | "orphan-png" |
 *   "expired" | "over-budget" | "debris"
 * @property {number} bytes
 */

/** The refusal class for a misshapen key or a bad put: exit 2, the project's
 * CHECKING-failure convention — the caller's input is wrong, not the thing
 * under test. */
export class FrameCacheCheckingError extends Error {
  constructor(message) {
    super(message);
    this.name = "FrameCacheCheckingError";
    this.exitCode = 2;
  }
}

/** PURE. The canonical form of one JSON-safe value: objects get recursively
 * key-sorted copies, arrays keep order, -0 collapses to 0, everything else
 * round-trips. Anything not representable exactly — undefined, functions,
 * symbols, bigints, NaN, Infinity, class instances like Date/Map whose own
 * semantics JSON.stringify would silently drop or mangle — REFUSES. The
 * canonical string is the hash's input, so this is the whole keying
 * contract: deterministic here means deterministic everywhere.
 *
 * @param {unknown} value
 * @returns {unknown} the canonicalized copy
 */
export function canonicalizeValue(value) {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value;
    case "boolean":
      return value;
    case "number": {
      if (!Number.isFinite(value)) {
        throw new FrameCacheCheckingError(
          `key contains a non-finite number: ${String(value)}`,
        );
      }
      return Object.is(value, -0) ? 0 : value;
    }
    case "object": {
      if (Array.isArray(value)) {
        return value.map((item) => canonicalizeValue(item));
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new FrameCacheCheckingError(
          `key contains a non-plain object (${proto?.constructor?.name ?? "unknown prototype"}): canonicalize to plain objects/strings first`,
        );
      }
      const out = {};
      const keys = Object.keys(value).sort();
      for (const key of keys) {
        out[key] = canonicalizeValue(value[key]);
      }
      return out;
    }
    default:
      throw new FrameCacheCheckingError(
        `key contains a ${typeof value}, which has no exact JSON form`,
      );
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/** PURE. Validate and canonicalize the nine key fields. Every field is
 * REQUIRED — an absent field is stated as `null` (pose) or `{}` (raster,
 * env) — and unknown fields refuse, so the key-field list stays a list this
 * module owns rather than whatever the latest caller improvised.
 *
 * @param {FrameCacheKeyFields} fields
 * @returns {Record<string, unknown>} the canonicalized copy stored in entries
 */
export function canonicalizeFields(fields) {
  if (!isPlainObject(fields)) {
    throw new FrameCacheCheckingError(
      "key fields must be a plain object of the nine named fields",
    );
  }
  const missing = FRAME_CACHE_FIELDS.filter((name) => !(name in fields));
  const unknown = Object.keys(fields).filter(
    (name) => !FRAME_CACHE_FIELDS.includes(name),
  );
  const problems = [
    ...(missing.length > 0
      ? [`missing: ${missing.join(", ")} — absence must be stated (null / {})`]
      : []),
    ...(unknown.length > 0 ? [`unknown: ${unknown.join(", ")}`] : []),
  ];
  if (problems.length > 0) {
    throw new FrameCacheCheckingError(
      `bad key fields (${problems.join("; ")}); expected exactly: ${FRAME_CACHE_FIELDS.join(", ")}`,
    );
  }

  const bundle = fields.bundle;
  if (typeof bundle !== "string" || bundle === "") {
    throw new FrameCacheCheckingError(
      "key.bundle must be a non-empty hash string (hashBundleDir's output)",
    );
  }
  const document_ = fields.document;
  if (typeof document_ !== "string") {
    throw new FrameCacheCheckingError(
      "key.document must be the full scene document string (the #v1= hash, possibly empty for a pose-less auto-fit boot)",
    );
  }
  for (const name of ["mode", "engine"]) {
    if (typeof fields[name] !== "string" || fields[name] === "") {
      throw new FrameCacheCheckingError(
        `key.${name} must be a non-empty string`,
      );
    }
  }
  const pose = fields.pose;
  if (pose !== null && !isPlainObject(pose)) {
    throw new FrameCacheCheckingError(
      "key.pose must be null (the document's own pose / deterministic auto-fit) or a plain object of the gate-driven pose",
    );
  }
  const viewport = fields.viewport;
  if (
    !isPlainObject(viewport) ||
    !Number.isInteger(viewport.width) ||
    viewport.width <= 0 ||
    !Number.isInteger(viewport.height) ||
    viewport.height <= 0 ||
    typeof viewport.scale !== "number" ||
    !(viewport.scale > 0) ||
    Object.keys(viewport).some(
      (name) => !["width", "height", "scale"].includes(name),
    )
  ) {
    throw new FrameCacheCheckingError(
      "key.viewport must be {width, height, scale} (positive integers, positive number) — the capture geometry repaints every pixel",
    );
  }
  const device = fields.device;
  if (
    !isPlainObject(device) ||
    typeof device.software !== "boolean" ||
    typeof device.label !== "string" ||
    device.label === ""
  ) {
    throw new FrameCacheCheckingError(
      "key.device must be {software: boolean, label: string} (the probe's backend disclosure; extra fields allowed)",
    );
  }
  const env = fields.env;
  if (!isPlainObject(env)) {
    throw new FrameCacheCheckingError(
      "key.env must be a flat object of gate env/URL flags ({} when none)",
    );
  }
  for (const [name, value] of Object.entries(env)) {
    if (name === "" || typeof value !== "string") {
      throw new FrameCacheCheckingError(
        `key.env.${name || "(empty)"} must be a string value in a flat object`,
      );
    }
  }
  const raster = fields.raster;
  if (!isPlainObject(raster)) {
    throw new FrameCacheCheckingError(
      "key.raster must be a plain object (tier/raster/samples/budget — {} when the renderer is fixed)",
    );
  }
  return /** @type {Record<string, unknown>} */ (
    canonicalizeValue({
      bundle,
      document: document_,
      pose,
      mode: fields.mode,
      engine: fields.engine,
      viewport,
      raster,
      device,
      env,
    })
  );
}

/** PURE. The key: canonical JSON of the validated fields, SHA-256'd. Same
 * inputs → same hash; changing ANY field's content changes the hash — that
 * is the whole memoization contract, pinned by tests field by field.
 *
 * @param {FrameCacheKeyFields} fields
 * @returns {{ hash: string, canonical: string, fields: Record<string, unknown> }}
 */
export function deriveFrameKey(fields) {
  const canonicalFields = canonicalizeFields(fields);
  const canonical = JSON.stringify(canonicalFields);
  const hash = crypto
    .createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");
  return { hash, canonical, fields: canonicalFields };
}

/**
 * Hash the built bundle's BYTES: every file under the bundle directory,
 * walked recursively, sorted by repo-relative path, hashed as
 * `<path>\n<bytes>` sequences. Content-only (no mtimes), so an identical
 * rebuild yields the same hash. Missing or empty directory REFUSES — there
 * is no bundle to memoize against, and a hash of emptiness would be a
 * silent lie.
 *
 * @param {string} dir the bundle directory (dist/app)
 * @returns {Promise<string>} the sha256 hex
 */
export async function hashBundleDir(dir) {
  const files = [];
  async function walk(relative) {
    let entries;
    try {
      entries = await fs.readdir(path.join(dir, relative), {
        withFileTypes: true,
      });
    } catch {
      return; // an unreadable subdirectory contributes nothing it has
    }
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const bytes = await fs.readFile(path.join(dir, rel));
        files.push([rel, bytes]);
      } catch {
        // A file that cannot be read is indistinguishable from one that is
        // not there — skip it, and let the emptiness refusal below catch a
        // wholly unreadable bundle.
      }
    }
  }
  await walk("");
  if (files.length === 0) {
    const exists = await fs
      .stat(dir)
      .then(() => true)
      .catch(() => false);
    throw new FrameCacheCheckingError(
      exists
        ? `bundle directory is empty: ${dir} — there is nothing to memoize against`
        : `bundle directory is missing: ${dir} — there is nothing to memoize against`,
    );
  }
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const digests = [];
  for (const [relPath, bytes] of files) {
    const hash = crypto.createHash("sha256");
    hash.update(relPath, "utf8");
    hash.update("\n");
    hash.update(bytes);
    digests.push(hash.digest());
  }
  return crypto
    .createHash("sha256")
    .update(Buffer.concat(digests))
    .digest("hex");
}

/** The entry paths for one hash: `<root>/<hh>/<hash>.json` and `.png`. */
export function frameCachePaths(root, hash) {
  if (!HASH_RE.test(hash)) {
    throw new FrameCacheCheckingError(
      `not a frame-cache hash: ${JSON.stringify(String(hash).slice(0, 20))}…`,
    );
  }
  const dir = path.join(root, hash.slice(0, 2));
  return {
    dir,
    entryPath: path.join(dir, `${hash}.json`),
    pngPath: path.join(dir, `${hash}.png`),
  };
}

async function atomicWrite(filePath, bytes) {
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
}

/**
 * Store one frame. `fields` is the nine-field key (validated), `png` the
 * frame bytes (validated against the PNG magic — the store records frames,
 * and anything else would be an entry the re-diff path could trust
 * wrongly), `verdict` optional JSON (the gate's frame-pure verdict shape),
 * `meta` the provenance: required non-empty `gate` and `scenario` names
 * (metadata, NOT key fields — the same frame demanded by two gates is one
 * entry), optional `wallMs`/`notes` disclosures. `buildHash` and
 * `createdAtMs` are DERIVED (fields.bundle / the store's clock), never
 * caller-supplied, so they cannot disagree with the key.
 *
 * Writes are atomic (tmp + rename) and idempotent per key except for the
 * fresh timestamp, which is what makes a re-put refresh the entry's
 * recency for the prune. Returns `existed` so a wiring can say whether
 * this was a first store or a refresh.
 *
 * @param {string} root
 * @param {FrameCachePutOptions} options
 * @returns {Promise<{ hash: string, entryPath: string, pngPath: string, existed: boolean, entry: FrameCacheEntry }>}
 */
export async function frameCachePut(root, { fields, png, verdict, meta }) {
  const { hash, canonical, fields: canonicalFields } = deriveFrameKey(fields);

  const pngBytes = Buffer.isBuffer(png) ? png : Buffer.from(png);
  if (pngBytes.length === 0) {
    throw new FrameCacheCheckingError("refusing to store an empty frame");
  }
  if (!pngBytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new FrameCacheCheckingError(
      "refusing to store a non-PNG frame — the store records frames",
    );
  }
  let canonicalVerdict = null;
  if (verdict !== undefined && verdict !== null) {
    canonicalVerdict = canonicalizeValue(verdict);
  }
  if (!isPlainObject(meta)) {
    throw new FrameCacheCheckingError("put meta must be a plain object");
  }
  const { gate, scenario, wallMs, notes } = meta;
  if (typeof gate !== "string" || gate === "") {
    throw new FrameCacheCheckingError("put meta.gate must name the gate");
  }
  if (typeof scenario !== "string" || scenario === "") {
    throw new FrameCacheCheckingError(
      "put meta.scenario must name the scenario",
    );
  }
  if (wallMs !== undefined && typeof wallMs !== "number") {
    throw new FrameCacheCheckingError("put meta.wallMs must be a number");
  }
  if (notes !== undefined && typeof notes !== "string") {
    throw new FrameCacheCheckingError("put meta.notes must be a string");
  }
  const unknownMeta = Object.keys(meta).filter(
    (name) => !["gate", "scenario", "wallMs", "notes"].includes(name),
  );
  if (unknownMeta.length > 0) {
    throw new FrameCacheCheckingError(
      `unknown put meta fields: ${unknownMeta.join(", ")}`,
    );
  }

  const entry = {
    version: FRAME_CACHE_VERSION,
    key: hash,
    canonical,
    fields: canonicalFields,
    verdict: canonicalVerdict,
    meta: {
      gate,
      scenario,
      buildHash: canonicalFields.bundle,
      createdAtMs: Date.now(),
      ...(wallMs === undefined ? {} : { wallMs }),
      ...(notes === undefined ? {} : { notes }),
    },
  };

  const { entryPath, pngPath } = frameCachePaths(root, hash);
  const existed = (await frameCacheLookupHash(root, hash)) !== null;
  await atomicWrite(pngPath, pngBytes);
  await atomicWrite(entryPath, Buffer.from(JSON.stringify(entry, null, 2)));
  return {
    hash,
    entryPath,
    pngPath,
    existed,
    entry,
  };
}

/**
 * Read one entry back by key fields, or `null` on any miss — including a
 * corrupt or hand-edited entry, which is re-derived from its stored fields
 * and dropped when it disagrees with its own hash. A miss is information,
 * never an error: the caller re-renders.
 *
 * @param {string} root
 * @param {FrameCacheKeyFields} fields
 * @returns {Promise<FrameCacheHit | null>}
 */
export async function frameCacheLookup(root, fields) {
  const { hash } = deriveFrameKey(fields);
  return frameCacheLookupHash(root, hash);
}

/**
 * Read one entry back by its hash directly (the CLI's --hash path).
 *
 * @param {string} root
 * @param {string} hash
 * @returns {Promise<FrameCacheHit | null>}
 */
export async function frameCacheLookupHash(root, hash) {
  const { entryPath, pngPath } = frameCachePaths(root, hash);
  let text;
  try {
    text = await fs.readFile(entryPath, "utf8");
  } catch {
    return null;
  }
  let entry;
  try {
    entry = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isPlainObject(entry) ||
    entry.version !== FRAME_CACHE_VERSION ||
    !isPlainObject(entry.fields)
  ) {
    return null;
  }
  try {
    const rederived = deriveFrameKey(entry.fields);
    if (rederived.hash !== hash || rederived.canonical !== entry.canonical) {
      return null;
    }
  } catch {
    return null;
  }
  let png;
  try {
    png = await fs.readFile(pngPath);
  } catch {
    return null;
  }
  return { hash, entry, png, entryPath, pngPath };
}

/**
 * Prune the store to its bounds and drop anything unreadable, so the
 * directory stays bounded forever:
 *
 *  - corrupt entries (unparseable json, wrong version, a json whose fields
 *    no longer re-derive to its own hash) — removed;
 *  - orphans (a png without its json, a json without its png) — removed;
 *  - debris (a crashed atomicWrite's `.tmp-*`, anything else that is not a
 *    well-formed entry name) — removed;
 *  - entries older than `maxAgeMs` — removed (the recency bound; a stale
 *    entry's only future is another miss);
 *  - the rest, newest first, kept until `maxBytes` of FRAME bytes is
 *    reached; every older entry than the first overflow is removed —
 *    greedily newest-first, never keeping an older entry after refusing a
 *    newer one.
 *
 * Empty shard directories are cleaned up. `dryRun` reports without
 * unlinking. Entries' json bytes count too (they are on disk), but the
 * budget is compared against the whole entry's footprint.
 *
 * @param {string} root
 * @param {{ maxBytes?: number, maxAgeMs?: number, nowMs?: number, dryRun?: boolean }} [options]
 * @returns {Promise<{ removed: FrameCachePruneRow[], kept: number, bytesBefore: number, bytesAfter: number }>}
 */
export async function frameCachePrune(
  root,
  {
    maxBytes = FRAME_CACHE_MAX_BYTES_DEFAULT,
    maxAgeMs = FRAME_CACHE_MAX_AGE_MS_DEFAULT,
    nowMs = Date.now(),
    dryRun = false,
  } = {},
) {
  const rows = [];
  let shards;
  try {
    shards = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return {
      removed: [],
      kept: 0,
      bytesBefore: 0,
      bytesAfter: 0,
    };
  }
  for (const shard of shards) {
    if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue;
    const shardDir = path.join(root, shard.name);
    const seenPngs = new Set();
    let names;
    try {
      names = await fs.readdir(shardDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const entryPath = path.join(shardDir, name);
      const hash = name.slice(0, -5);
      const pngPath = path.join(shardDir, `${hash}.png`);
      seenPngs.add(`${hash}.png`);
      let text;
      try {
        text = await fs.readFile(entryPath, "utf8");
      } catch {
        continue;
      }
      const jsonBytes = Buffer.byteLength(text);
      let entry = null;
      try {
        entry = JSON.parse(text);
      } catch {
        rows.push({
          hash,
          entryPath,
          pngPath,
          reason: "corrupt",
          bytes: jsonBytes,
        });
        continue;
      }
      const shapeOk =
        isPlainObject(entry) &&
        entry.version === FRAME_CACHE_VERSION &&
        entry.key === hash &&
        isPlainObject(entry.fields);
      if (!shapeOk) {
        rows.push({
          hash,
          entryPath,
          pngPath,
          reason: "corrupt",
          bytes: jsonBytes,
        });
        continue;
      }
      let pngStat = null;
      try {
        pngStat = await fs.stat(pngPath);
      } catch {
        rows.push({
          hash,
          entryPath,
          pngPath,
          reason: "orphan-json",
          bytes: jsonBytes,
        });
        continue;
      }
      let createdAtMs = entry?.meta?.createdAtMs;
      if (!Number.isFinite(createdAtMs)) createdAtMs = 0;
      const bytes = jsonBytes + pngStat.size;
      if (nowMs - createdAtMs > maxAgeMs) {
        rows.push({ hash, entryPath, pngPath, reason: "expired", bytes });
        continue;
      }
      rows.push({ hash, entryPath, pngPath, reason: null, bytes, createdAtMs });
    }
    for (const name of names) {
      if (!name.endsWith(".png") || seenPngs.has(name)) continue;
      const pngPath = path.join(shardDir, name);
      const hash = name.slice(0, -4);
      let stat = null;
      try {
        stat = await fs.stat(pngPath);
      } catch {
        continue;
      }
      rows.push({
        hash,
        entryPath: null,
        pngPath,
        reason: "orphan-png",
        bytes: stat.size,
      });
    }
    // Leftovers a crashed atomicWrite strands (`.tmp-*`) and anything else
    // that is neither a well-formed entry json nor its png — the store's
    // namespace is exactly those names, so anything else is debris.
    for (const name of names) {
      if (/^[0-9a-f]{64}\.(json|png)$/.test(name)) continue;
      const debrisPath = path.join(shardDir, name);
      let stat = null;
      try {
        stat = await fs.stat(debrisPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      rows.push({
        hash: name,
        entryPath: null,
        pngPath: debrisPath,
        reason: "debris",
        bytes: stat.size,
      });
    }
  }

  const removed = [];
  const removedHashes = new Set();
  const keep = [];
  let bytesBefore = 0;
  for (const row of rows) {
    bytesBefore += row.bytes;
    if (row.reason !== null) {
      removed.push({ ...row, reason: row.reason });
      removedHashes.add(row.hash);
    } else {
      keep.push(row);
    }
  }

  // Newest first; ties (same-millisecond puts) fall back to the hash so the
  // order is deterministic. Then greedy newest-first: keep while the running
  // total fits the budget; the FIRST entry that overflows it — and every
  // OLDER one after, since older is strictly less valuable — is removed.
  keep.sort(
    (a, b) => b.createdAtMs - a.createdAtMs || (a.hash < b.hash ? -1 : 1),
  );
  let total = 0;
  let overflowing = false;
  for (const row of keep) {
    if (overflowing) {
      removed.push({ ...row, reason: "over-budget" });
      removedHashes.add(row.hash);
      continue;
    }
    total += row.bytes;
    if (total > maxBytes) {
      overflowing = true;
      removed.push({ ...row, reason: "over-budget" });
      removedHashes.add(row.hash);
    }
  }
  const keptRows = keep.filter((row) => !removedHashes.has(row.hash));
  const bytesAfter = keptRows.reduce((sum, row) => sum + row.bytes, 0);

  if (!dryRun) {
    for (const row of removed) {
      if (row.entryPath !== null) {
        await fs.unlink(row.entryPath).catch(() => {});
      }
      await fs.unlink(row.pngPath).catch(() => {});
    }
    const shardDirs = new Set(
      removed
        .filter((row) => row.entryPath !== null || row.pngPath !== null)
        .map((row) => path.dirname(row.entryPath ?? row.pngPath)),
    );
    for (const dir of shardDirs) {
      await fs.rmdir(dir).catch(() => {});
    }
  }

  return {
    removed: removed.map(({ hash, reason, bytes }) => ({
      hash,
      reason,
      bytes,
    })),
    kept: keptRows.length,
    bytesBefore,
    bytesAfter,
  };
}

/** The default store root resolved against the repo. */
export function defaultFrameCacheRoot(root = REPO_ROOT) {
  return path.join(root, FRAME_CACHE_ROOT_DEFAULT);
}
