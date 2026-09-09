import { writeFile } from "node:fs/promises";

/** CPU task/submission events only: gpu.device enables GPUTracer timing queries
 * and would change the GL workload under investigation. These categories expose
 * task posting/execution and command-buffer Flush/OnAsyncFlush/PerformWork, but
 * do not directly expose WebGLSync or QueryTracker's per-query status.
 * Chromium source: base/task/common/task_annotator.{h,cc},
 * gpu/ipc/service/command_buffer_stub.cc and
 * gpu/command_buffer/service/gpu_tracer.cc at
 * https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/
 */
export async function captureSurfaceBrowserTrace(
  page,
  filename,
  settleDeadline,
) {
  const categories = ["gpu", "toplevel", "toplevel.flow", "scheduler"];
  // One wall-clock bound includes attach, tracing, every stream read, the file
  // write and cleanup. Per-request timeouts alone do not bound empty non-EOF
  // streams, nor a long series of slow but individually successful requests.
  const finalDeadline = Math.min(settleDeadline, Date.now() + 15_000);
  const workDeadline = finalDeadline - 2_000;
  if (!Number.isFinite(finalDeadline) || Date.now() + 3_000 >= workDeadline)
    throw new Error(
      "Insufficient settle time remains for the bounded 3s trace",
    );
  const bounded = async (operation, deadline = workDeadline) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("CDP trace deadline expired");
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("CDP trace deadline expired")),
            remainingMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  let started = false;
  let ended = false;
  let stream;
  let session;
  let closing = false;
  try {
    const attaching = page.context().newCDPSession(page);
    // A late attach cannot escape cleanup just because its await timed out.
    attaching.then(
      (attached) => {
        if (closing) void attached.detach().catch(() => {});
      },
      () => {},
    );
    session = await bounded(() => attaching);
    // A timed-out start may still have reached Chrome. Attempt an end during
    // cleanup even when its response never arrived.
    started = true;
    await bounded(() =>
      session.send("Tracing.start", {
        transferMode: "ReturnAsStream",
        traceConfig: {
          recordMode: "recordContinuously",
          traceBufferSizeInKb: 8_192,
          includedCategories: categories,
        },
      }),
    );
    if (Date.now() + 3_000 >= workDeadline)
      throw new Error("Insufficient time remains for a complete 3s trace");
    await bounded(() => new Promise((resolve) => setTimeout(resolve, 3_000)));
    const completed = new Promise((resolve) => {
      session.once("Tracing.tracingComplete", resolve);
    });
    await bounded(() => session.send("Tracing.end"));
    ended = true;
    const result = await bounded(() => completed);
    stream = result.stream;
    if (!stream) throw new Error("CDP returned no trace stream");
    const parts = [];
    let bytes = 0;
    for (let reads = 0; ; reads++) {
      if (reads >= 4_096)
        throw new Error("CDP trace exceeded the 4096-read bound");
      const part = await bounded(() =>
        session.send("IO.read", { handle: stream, size: 1024 * 1024 }),
      );
      const data = Buffer.from(
        part.data,
        part.base64Encoded ? "base64" : "utf8",
      );
      if (data.length > 0) parts.push(data);
      bytes += data.length;
      if (bytes > 64 * 1024 * 1024)
        throw new Error("CDP trace exceeded the 64 MiB output bound");
      if (part.eof) break;
    }
    await bounded(() => writeFile(filename, Buffer.concat(parts)));
    return { completed: true, filename, durationMs: 3_000, categories, bytes };
  } finally {
    closing = true;
    if (session) {
      const cleanup = [
        ...(started && !ended ? [() => session.send("Tracing.end")] : []),
        ...(stream ? [() => session.send("IO.close", { handle: stream })] : []),
        () => session.detach(),
      ];
      // Divide the remaining cleanup allowance so a lost response cannot
      // consume the time needed even to attempt the later close/detach.
      for (let index = 0; index < cleanup.length; index++) {
        const deadline =
          Date.now() +
          Math.max(0, (finalDeadline - Date.now()) / (cleanup.length - index));
        await bounded(cleanup[index], deadline).catch(() => {});
      }
    }
  }
}
