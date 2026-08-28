/** Pure protocol/core for off-main-thread custom OBJ preparation. */
import {
  CUSTOM_MESH_SDF_RESOLUTION,
  prepareCustomMeshObj,
} from "../fractal/custom-mesh";
import {
  bakePreparedMeshSdf,
  prepareSerializedCustomMeshAsset,
  prepareSerializedMeshSdfBake,
  serializeMeshSdfBake,
  serializePreparedCustomMeshAsset,
  type SerializedMeshSdfBake,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";

export interface CustomMeshImportRequest {
  readonly type: "import";
  readonly jobId: number;
  readonly source: string;
  readonly fileName: string;
}

export interface CustomMeshHydrateRequest {
  readonly type: "hydrate";
  readonly jobId: number;
  readonly source: SerializedPreparedMeshAsset;
  readonly bake: SerializedMeshSdfBake;
}

export interface CustomMeshBakeRequest {
  readonly type: "bake";
  readonly jobId: number;
  readonly source: SerializedPreparedMeshAsset;
  readonly resolution: number;
}

export type CustomMeshWorkerRequest =
  CustomMeshImportRequest | CustomMeshHydrateRequest | CustomMeshBakeRequest;

export interface CustomMeshImportSuccess {
  readonly type: "result";
  readonly jobId: number;
  readonly source: SerializedPreparedMeshAsset;
  readonly bake: SerializedMeshSdfBake;
}

export interface CustomMeshImportFailure {
  readonly type: "error";
  readonly jobId: number;
  readonly message: string;
}

export type CustomMeshImportResponse =
  CustomMeshImportSuccess | CustomMeshImportFailure;

function displayNameFromFile(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).at(-1) ?? "Imported mesh";
  const withoutExtension = leaf.replace(/\.obj$/i, "").trim();
  return (withoutExtension || "Imported mesh").slice(0, 160);
}

function importRequest(value: unknown): CustomMeshImportRequest {
  const request = value as Partial<CustomMeshImportRequest> | null;
  if (
    request?.type !== "import" ||
    !Number.isSafeInteger(request.jobId) ||
    (request.jobId ?? -1) < 0 ||
    typeof request.source !== "string" ||
    typeof request.fileName !== "string"
  ) {
    throw new RangeError("invalid custom mesh import request");
  }
  return request as CustomMeshImportRequest;
}

function workerRequest(value: unknown): CustomMeshWorkerRequest {
  const request = value as Partial<CustomMeshWorkerRequest> | null;
  if (!Number.isSafeInteger(request?.jobId) || (request?.jobId ?? -1) < 0) {
    throw new RangeError("invalid custom mesh worker request");
  }
  if (request?.type === "import") return importRequest(value);
  if (
    request?.type === "hydrate" &&
    typeof request.source === "object" &&
    request.source !== null &&
    typeof request.bake === "object" &&
    request.bake !== null
  ) {
    return request as CustomMeshHydrateRequest;
  }
  if (
    request?.type === "bake" &&
    typeof request.source === "object" &&
    request.source !== null &&
    Number.isInteger(request.resolution) &&
    (request.resolution ?? 0) >= 8 &&
    (request.resolution ?? 0) <= 128
  ) {
    return request as CustomMeshBakeRequest;
  }
  throw new RangeError("invalid custom mesh worker request");
}

/** Parse, canonicalize, hash, solid-validate and conservatively bake one OBJ.
 * The browser worker calls this with the production resolution. Tests may use
 * a smaller valid resolution without weakening the wire contract. */
export async function prepareCustomMeshImport(
  requestValue: unknown,
  resolution = CUSTOM_MESH_SDF_RESOLUTION,
): Promise<CustomMeshImportSuccess> {
  const request = importRequest(requestValue);
  const prepared = await prepareCustomMeshObj(
    request.source,
    displayNameFromFile(request.fileName),
  );
  const bake = bakePreparedMeshSdf(prepared.asset, resolution);
  return {
    type: "result",
    jobId: request.jobId,
    source: serializePreparedCustomMeshAsset(prepared.asset),
    bake: serializeMeshSdfBake(bake),
  };
}

/** Validate durable source/cache wires or regenerate a missing derived bake,
 * always in the same terminating worker used by first import. */
export async function prepareCustomMeshWorkerRequest(
  requestValue: unknown,
): Promise<CustomMeshImportSuccess> {
  const request = workerRequest(requestValue);
  if (request.type === "import") return prepareCustomMeshImport(request);
  const source = prepareSerializedCustomMeshAsset(request.source);
  const bake =
    request.type === "hydrate"
      ? prepareSerializedMeshSdfBake(request.bake, source)
      : bakePreparedMeshSdf(source, request.resolution);
  return {
    type: "result",
    jobId: request.jobId,
    source: serializePreparedCustomMeshAsset(source),
    bake: serializeMeshSdfBake(bake),
  };
}

export function customMeshImportFailure(
  jobId: number,
  error: unknown,
): CustomMeshImportFailure {
  return {
    type: "error",
    jobId,
    message:
      error instanceof Error ? error.message : "Custom mesh import failed",
  };
}

export function customMeshImportTransfers(
  result: CustomMeshImportSuccess,
): Transferable[] {
  return [
    result.source.vertices.buffer,
    result.source.triangles.buffer,
    result.bake.values.buffer,
    result.bake.min.buffer,
    result.bake.max.buffer,
  ];
}
