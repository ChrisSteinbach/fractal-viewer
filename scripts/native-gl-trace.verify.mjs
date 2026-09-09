#!/usr/bin/env node
/**
 * No-GPU forwarding check for native-gl-trace.build.mjs.
 * Compiles fake GL libraries and invokes them in fresh processes, with and
 * without the observer. No browser, graphics context, display or GPU is used.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildNativeTrace } from "./native-gl-trace.build.mjs";

const mockNative = String.raw`#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <string.h>
#ifndef MOCK_VARIANT
#define MOCK_VARIANT 1
#endif
static int create_count, wait_count, get_count, delete_count;
int native_mock_anchor(void) { return MOCK_VARIANT; }
#if MOCK_VARIANT == 3
int native_mock_only_local(void) { return 3; }
int native_mock_local_default(void) {
    int (*fn)(void) = dlsym(RTLD_DEFAULT,"native_mock_only_local");
    return fn ? fn() : -1;
}
#endif
void *glFenceSync(uint32_t condition, uint32_t flags) {
    if (condition != 0x9117 || flags != 0) __builtin_trap();
    create_count++;
    errno = EINPROGRESS;
    return (void *)(uintptr_t)(0x1000 + MOCK_VARIANT);
}
uint32_t glClientWaitSync(void *sync, uint32_t flags, uint64_t timeout) {
    if (sync != (void *)(uintptr_t)(0x1000 + MOCK_VARIANT) || flags != 0 || timeout != UINT64_MAX) __builtin_trap();
    wait_count++;
    errno = EINPROGRESS;
    return wait_count < 300 ? 0x911B : 0x911C;
}
void glGetSynciv(void *sync, uint32_t pname, int32_t bufSize, int32_t *length, int32_t *values) {
    if (sync != (void *)(uintptr_t)(0x1000 + MOCK_VARIANT) || pname != 0x9114 || bufSize != 1) __builtin_trap();
    get_count++;
    if (length) *length = 1;
    *values = get_count < 300 ? 0x9118 : 0x9119;
    errno = EINPROGRESS;
}
void glDeleteSync(void *sync) {
    if (sync != (void *)(uintptr_t)(0x1000 + MOCK_VARIANT)) __builtin_trap();
    delete_count++;
    errno = EINPROGRESS;
}
void glGetQueryObjectuiv(uint32_t query, uint32_t pname, uint32_t *value) {
    /* A valid query-buffer offset; the observer must never dereference it. */
    if (query != 17 || pname != 0x8866 || value != (void *)4) __builtin_trap();
}
uint32_t eglMakeCurrent(void *d, void *draw, void *read, void *c) {
    if (d != (void *)0x2000 || draw != (void *)0x3000 || read != draw || c != (void *)0x4000) __builtin_trap();
    return 1;
}
void *eglGetProcAddress(const char *name) {
    if (!strcmp(name,"glFenceSync")) return glFenceSync;
    if (!strcmp(name,"glClientWaitSync")) return glClientWaitSync;
    if (!strcmp(name,"glGetSynciv")) return glGetSynciv;
    if (!strcmp(name,"glDeleteSync")) return glDeleteSync;
    if (!strcmp(name,"eglMakeCurrent")) return eglMakeCurrent;
    if (!strcmp(name,"glGetQueryObjectuiv")) return glGetQueryObjectuiv;
    return 0;
}
void *glXGetProcAddressARB(const char *name) { return eglGetProcAddress(name); }
int native_mock_next(void) {
    int (*next)(void) = dlsym(RTLD_NEXT,"native_mock_anchor");
    return next ? next() : -1;
}
int native_mock_default(void) {
    int (*fn)(void) = dlsym(RTLD_DEFAULT,"native_mock_anchor");
    return fn ? fn() : -1;
}
int native_mock_count(int which) {
    switch (which) { case 0: return create_count; case 1: return wait_count;
      case 2: return get_count; default: return delete_count; }
}
`;

const mockCheck = String.raw`#define _GNU_SOURCE
#include <assert.h>
#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
    assert(argc == 4);
    void *a = dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);
    if (!a) { puts(dlerror()); return 1; }
    void *b = dlopen(argv[2],RTLD_NOW|RTLD_GLOBAL);
    if (!b) { puts(dlerror()); return 1; }
    int (*next)(void) = dlsym(a,"native_mock_next");
    int (*def)(void) = dlsym(a,"native_mock_default");
    assert(next() == 2); /* Proves RTLD_NEXT retains its original library caller. */
    assert(def() == 1);
    void *local = dlopen(argv[3],RTLD_NOW|RTLD_LOCAL);
    assert(local);
    int (*local_default)(void) = dlsym(local,"native_mock_local_default");
    assert(local_default() == 3); /* RTLD_DEFAULT must retain caller-local scope. */
    dlerror();
    assert(!dlsym(RTLD_DEFAULT,"native_mock_only_local"));
    dlerror();
    for (int j = 0; j < 2; j++) {
        void *h = j ? b : a;
        void *(*proc)(const char *) = dlsym(h, j ? "glXGetProcAddressARB" : "eglGetProcAddress");
        void *(*fence)(uint32_t,uint32_t) = proc("glFenceSync");
        uint32_t (*wait)(void *,uint32_t,uint64_t) = proc("glClientWaitSync");
        void (*get)(void *,uint32_t,int32_t,int32_t *,int32_t *) = proc("glGetSynciv");
        void (*del)(void *) = dlsym(h,"glDeleteSync");
        void (*query)(uint32_t,uint32_t,uint32_t *) = proc("glGetQueryObjectuiv");
        query(17,0x8866,(void *)4);
        uint32_t (*make)(void *,void *,void *,void *) = proc("eglMakeCurrent");
        assert(make((void *)0x2000,(void *)0x3000,(void *)0x3000,(void *)0x4000) == 1);
        void *sync = fence(0x9117,0);
        assert(sync == (void *)(uintptr_t)(0x1001 + j));
        assert(errno == EINPROGRESS);
        for (int i = 1; i <= 600; i++) {
            if (i == 2 && getenv("NATIVE_GL_TRACE_MOCK_DELAY")) usleep(3000);
            assert(wait(sync,0,UINT64_MAX) == (i < 300 ? 0x911B : 0x911C));
            assert(errno == EINPROGRESS);
            int32_t value = 0;
            get(sync,0x9114,1,0,&value);
            assert(value == (i < 300 ? 0x9118 : 0x9119));
            assert(errno == EINPROGRESS);
        }
        del(sync);
        assert(errno == EINPROGRESS);
        int (*count)(int) = dlsym(h,"native_mock_count");
        assert(count(0)==1 && count(1)==600 && count(2)==600 && count(3)==1);
        dlerror();
        assert(!dlsym(h,"native_mock_missing_symbol"));
        assert(strstr(dlerror(),"native_mock_missing_symbol"));
    }
    puts("PASS: two original implementations, exact calls/args/results/errno, proc lookup, RTLD_NEXT/default, missing-symbol error");
    return 0;
}
`;

const args = process.argv.slice(2);
if (args.some((arg) => !arg.startsWith("--outdir=")))
  throw new Error("Only --outdir=PATH is supported");
const outdir = path.resolve(
  args.find((arg) => arg.startsWith("--outdir="))?.slice(9) ||
    "scripts/out/native-gl-trace-selftest",
);
fs.mkdirSync(outdir, { recursive: true });
const built = buildNativeTrace({ outdir: path.join(outdir, "observer") });
const cc = process.env.CC || "cc";
const mockSource = path.join(outdir, "mock-native.c");
const checkSource = path.join(outdir, "mock-check.c");
fs.writeFileSync(mockSource, mockNative);
fs.writeFileSync(checkSource, mockCheck);
function run(executable, args, env) {
  const result = spawnSync(executable, args, { encoding: "utf8", env });
  if (result.error || result.status !== 0)
    throw new Error(
      `${executable} failed: ${result.error?.message || result.stderr || result.signal || result.status}`,
    );
  return result.stdout;
}
const libraries = ["mock-a.so", "mock-b.so", "mock-local.so"].map((file) =>
  path.join(outdir, file),
);
for (const i of [1, 0, 2]) {
  const flags = [
    "-shared",
    "-fPIC",
    "-O2",
    "-Wl,-Bsymbolic-functions",
    `-DMOCK_VARIANT=${i + 1}`,
    "-o",
    libraries[i],
    mockSource,
    "-ldl",
  ];
  // The dependent B library must be in A's initial symbol lookup scope.
  if (i === 0) flags.push("-Wl,--no-as-needed", libraries[1]);
  run(cc, flags);
}
const check = path.join(outdir, "mock-check");
run(cc, [
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-o",
  check,
  checkSource,
  "-ldl",
]);
const baselineEnv = { ...process.env };
delete baselineEnv.NATIVE_GL_TRACE;
delete baselineEnv.LD_PRELOAD;
delete baselineEnv.NATIVE_GL_TRACE_STACK_AFTER_MS;
delete baselineEnv.NATIVE_GL_TRACE_MOCK_DELAY;
process.stdout.write(run(check, libraries, baselineEnv));
const tracePath = path.join(outdir, "mock-check.jsonl");
fs.writeFileSync(tracePath, "");
process.stdout.write(
  run(check, libraries, {
    ...baselineEnv,
    NATIVE_GL_TRACE: tracePath,
    LD_PRELOAD: built.library,
  }),
);
const rows = fs
  .readFileSync(tracePath, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert.equal(rows.filter((row) => row.kind === "init").length, 1);
const waits = rows.filter(
  (row) => row.kind === "call" && row.call === "glClientWaitSync",
);
assert.deepEqual([...new Set(waits.map((row) => row.slot))].sort(), [0, 1]);
for (const slot of [0, 1]) {
  const samples = waits.filter((row) => row.slot === slot);
  assert.deepEqual(
    samples.map((row) => row.seen),
    ["1", "256", "300", "512"],
  );
  assert.deepEqual(
    samples.map((row) => row.result),
    ["37147", "37147", "37148", "37148"],
  );
  assert(samples.every((row) => row.args[2] === "18446744073709551615"));
  assert(
    samples.every(
      (row) => row.context === "0x4000" && row.display === "0x2000",
    ),
  );
  assert(
    samples.every((row) => row.object === `0x${(0x1001 + slot).toString(16)}`),
  );
  const gets = rows.filter(
    (row) =>
      row.kind === "call" && row.call === "glGetSynciv" && row.slot === slot,
  );
  assert.deepEqual(
    gets.map((row) => row.out),
    ["37144", "37144", "37145", "37145"],
  );
}
const queries = rows.filter(
  (row) => row.kind === "call" && row.call === "glGetQueryObjectuiv",
);
assert.equal(queries.length, 2);
assert(queries.every((row) => row.args[2] === "4" && row.out === null));
assert(rows.every((row) => row.kind !== "slot-overflow"));
assert(rows.every((row) => row.kind !== "stack"));
const stackPath = path.join(outdir, "mock-stack.jsonl");
fs.writeFileSync(stackPath, "");
process.stdout.write(
  run(check, libraries, {
    ...baselineEnv,
    NATIVE_GL_TRACE: stackPath,
    LD_PRELOAD: built.library,
    NATIVE_GL_TRACE_STACK_AFTER_MS: "2",
    NATIVE_GL_TRACE_MOCK_DELAY: "1",
  }),
);
const stackRows = fs
  .readFileSync(stackPath, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const stacks = stackRows.filter((row) => row.kind === "stack");
assert.equal(stacks.length, 1);
assert.equal(stacks[0].reason, "pending-timeout");
assert.equal(stacks[0].object, "0x1001");
assert.equal(stacks[0].context, "0x4000");
assert.equal(stacks[0].result, "37147");
assert.equal(stacks[0].queryLayoutValidated, false);
assert.notEqual(stacks[0].originCreateId, "0");
assert(
  BigInt(stacks[0].monoNs) - BigInt(stacks[0].firstPendingMonoNs) >= 2_000_000n,
);
const frames = stackRows.filter((row) => row.kind === "stack-frame");
assert.equal(frames.length, stacks[0].frames);
assert(frames.length > 0 && frames.length <= 32);
assert(
  frames.every(
    (frame) => BigInt(frame.pc) - BigInt(frame.base) === BigInt(frame.offset),
  ),
);
const snapshot = stackRows.find((row) => row.kind === "query-snapshot");
assert(snapshot && !snapshot.frameFound && !snapshot.readOk);
assert(stackRows.every((row) => row.kind !== "query-sample-exhausted"));
console.log(
  JSON.stringify({
    verdict: "pass",
    trace: tracePath,
    rows: rows.length,
    bytes: fs.statSync(tracePath).size,
    stackTrace: stackPath,
    stackFrames: frames.length,
    checked: [
      "two original function slots",
      "exact call counts and arguments",
      "results and errno",
      "RTLD_NEXT caller",
      "RTLD_DEFAULT local scope",
      "missing-symbol dlerror",
      "proc lookup",
      "query-buffer offset safety",
      "first/change/256 poll sampling",
      "native context identity",
      "optional once-per-process pending stack",
      "wrong-browser query guard",
    ],
  }),
);
