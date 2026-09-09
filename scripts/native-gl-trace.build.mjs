#!/usr/bin/env node
/**
 * Build the opt-in native GL observer without EGL development headers.
 * Linux x86-64 + glibc + a C compiler are required; this never starts a browser.
 * node scripts/native-gl-trace.build.mjs [--outdir=scripts/out/native-gl-trace]
 * Add --emit-only to inspect the C without compiling. Generated output is ignored.
 * NATIVE_GL_TRACE is the absolute JSONL destination when the library is preloaded.
 * NATIVE_GL_TRACE_STACK_AFTER_MS is absent/disabled by default. A positive value
 * permits bounded caller evidence from existing native sync results; no GL call
 * is added. Private query recovery is tied to one exact Chromium GNU build ID,
 * machine-code signatures, and the verified frame sequence below.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function observerSpecs() {
  const specs = [];
  function add(name, ret, params, options = {}) {
    specs.push({
      name,
      ret,
      params,
      obj: "0",
      out: "0",
      has_out: "0",
      poll: false,
      context: null,
      display: null,
      create: false,
      resolver: false,
      attrs: null,
      ...options,
    });
  }
  for (const name of [
    "eglGetProcAddress",
    "glXGetProcAddress",
    "glXGetProcAddressARB",
  ])
    add(name, "void *", [["const char *", "name"]], { resolver: true });
  add(
    "glFenceSync",
    "void *",
    [
      ["uint32_t", "condition"],
      ["uint32_t", "flags"],
    ],
    { create: true },
  );
  add("glDeleteSync", "void", [["void *", "sync"]], { obj: "sync" });
  add(
    "glClientWaitSync",
    "uint32_t",
    [
      ["void *", "sync"],
      ["uint32_t", "flags"],
      ["uint64_t", "timeout"],
    ],
    { obj: "sync", poll: true },
  );
  add(
    "glWaitSync",
    "void",
    [
      ["void *", "sync"],
      ["uint32_t", "flags"],
      ["uint64_t", "timeout"],
    ],
    { obj: "sync" },
  );
  add(
    "glGetSynciv",
    "void",
    [
      ["void *", "sync"],
      ["uint32_t", "pname"],
      ["int32_t", "bufSize"],
      ["int32_t *", "length"],
      ["int32_t *", "values"],
    ],
    {
      obj: "sync",
      out: "values && bufSize > 0 && (!length || *length > 0) ? (uint64_t)(uint32_t)values[0] : 0",
      has_out: "values && bufSize > 0 && (!length || *length > 0)",
      poll: true,
    },
  );
  for (const name of ["glFlush", "glFinish"]) add(name, "void", []);
  for (const suffix of ["", "KHR"]) {
    const attrType = suffix ? "int32_t" : "intptr_t";
    add(
      `eglCreateSync${suffix}`,
      "void *",
      [
        ["void *", "display"],
        ["uint32_t", "type"],
        [`const ${attrType} *`, "attribs"],
      ],
      { create: true, display: "display", attrs: "attribs" },
    );
    add(
      `eglDestroySync${suffix}`,
      "uint32_t",
      [
        ["void *", "display"],
        ["void *", "sync"],
      ],
      { obj: "sync", display: "display" },
    );
    add(
      `eglClientWaitSync${suffix}`,
      "int32_t",
      [
        ["void *", "display"],
        ["void *", "sync"],
        ["int32_t", "flags"],
        ["uint64_t", "timeout"],
      ],
      { obj: "sync", display: "display", poll: true },
    );
    add(
      `eglWaitSync${suffix}`,
      "uint32_t",
      [
        ["void *", "display"],
        ["void *", "sync"],
        ["int32_t", "flags"],
      ],
      { obj: "sync", display: "display" },
    );
    add(
      `eglGetSyncAttrib${suffix}`,
      "uint32_t",
      [
        ["void *", "display"],
        ["void *", "sync"],
        ["int32_t", "attribute"],
        [`${attrType} *`, "value"],
      ],
      {
        obj: "sync",
        out: "result && value ? (uint64_t)*value : 0",
        has_out: "result && value",
        display: "display",
        poll: true,
      },
    );
  }
  add(
    "eglDupNativeFenceFDANDROID",
    "int32_t",
    [
      ["void *", "display"],
      ["void *", "sync"],
    ],
    { obj: "sync", display: "display" },
  );
  add(
    "eglMakeCurrent",
    "uint32_t",
    [
      ["void *", "display"],
      ["void *", "draw"],
      ["void *", "read"],
      ["void *", "context"],
    ],
    { context: "context", display: "display" },
  );
  add(
    "glXMakeCurrent",
    "int32_t",
    [
      ["void *", "display"],
      ["unsigned long", "drawable"],
      ["void *", "context"],
    ],
    { context: "context", display: "display" },
  );
  add(
    "glXMakeContextCurrent",
    "int32_t",
    [
      ["void *", "display"],
      ["unsigned long", "draw"],
      ["unsigned long", "read"],
      ["void *", "context"],
    ],
    { context: "context", display: "display" },
  );
  for (const name of ["eglGetCurrentContext", "glXGetCurrentContext"])
    add(name, "void *", [], { context: "result", poll: true });
  add(
    "eglCreateContext",
    "void *",
    [
      ["void *", "display"],
      ["void *", "config"],
      ["void *", "share"],
      ["const int32_t *", "attribs"],
    ],
    { display: "display", create: true },
  );
  add(
    "eglDestroyContext",
    "uint32_t",
    [
      ["void *", "display"],
      ["void *", "context"],
    ],
    { obj: "context", display: "display" },
  );
  for (const suffix of ["", "ARB", "EXT"]) {
    add(
      `glBeginQuery${suffix}`,
      "void",
      [
        ["uint32_t", "target"],
        ["uint32_t", "query"],
      ],
      { obj: "query" },
    );
    add(`glEndQuery${suffix}`, "void", [["uint32_t", "target"]]);
    for (const [ending, type] of [
      ["uiv", "uint32_t"],
      ["iv", "int32_t"],
    ]) {
      // A query-buffer binding makes this pointer an offset. Do not dereference it.
      add(
        `glGetQueryObject${ending}${suffix}`,
        "void",
        [
          ["uint32_t", "query"],
          ["uint32_t", "pname"],
          [`${type} *`, "value"],
        ],
        { obj: "query", poll: true },
      );
    }
  }
  for (const suffix of ["", "EXT"]) {
    for (const [ending, type] of [
      ["ui64v", "uint64_t"],
      ["i64v", "int64_t"],
    ])
      add(
        `glGetQueryObject${ending}${suffix}`,
        "void",
        [
          ["uint32_t", "query"],
          ["uint32_t", "pname"],
          [`${type} *`, "value"],
        ],
        { obj: "query", poll: true },
      );
    add(
      `glQueryCounter${suffix}`,
      "void",
      [
        ["uint32_t", "query"],
        ["uint32_t", "target"],
      ],
      { obj: "query" },
    );
  }
  return specs;
}

const header = String.raw`/*
 * Native GL fence observer. Generated by native-gl-trace.build.mjs.
 * x86-64 Linux/glibc only. No EGL/GL library linked and no GL calls added.
 * Every wrapper calls exactly its resolved original once, with unchanged args.
 * Symbols resolved by an explicit dlsym handle or a wrapped proc resolver are
 * eligible. Pseudo-handle dlsym calls tail-jump to libc with the original caller
 * address preserved, so RTLD_NEXT/RTLD_DEFAULT lookup scope is unchanged.
 *
 * NATIVE_GL_TRACE=/absolute/file.jsonl opens one O_APPEND file in each process.
 * Fixed 8 slots per symbol preserve distinct native/ANGLE implementations.
 * Poll output records first, changed result, and every 256th call for each
 * (function, slot, object, context, argument fingerprint). Intermediate calls
 * are counted, never inserted/retried. A final process kill can leave up to
 * 255 repeated polls after the last recorded count; terminal transitions log.
 * Recorder CPU/syscall overhead may affect races despite unchanged GL calls.
 * Optional NATIVE_GL_TRACE_STACK_AFTER_MS permits one long-pending stack and
 * one successfully validated query sample per process. Up to 64 successful
 * native results are considered; first/last failed candidate walks disclose why
 * validation was unavailable. Walks contain at most 32 frames. The pinned Chrome
 * omits unwind coverage at SyncGL, so a bounded self-read frame-pointer walk can
 * recover only the exact guarded ProcessQueries path. Private field reads use
 * process_vm_readv(self), never unchecked pointer dereferences. A successful
 * native result occurs before ProcessQueries publishes QuerySync.process_count;
 * an older count in that snapshot is expected and is not a failure verdict.
 * A native creation/deletion resets its matching thread-local watch slot.
 * Unknown cross-thread creation identity is reported as originCreateId=0.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <link.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <time.h>
#include <unwind.h>
#include <unistd.h>
#if !defined(__x86_64__) || !defined(__GLIBC__)
#error This observer needs x86-64 Linux glibc for its dlsym tail trampoline.
#endif
#define SLOTS 8
#define POLL_BUCKETS 1024
#define EXPORT __attribute__((visibility("default")))
#define HIDDEN __attribute__((visibility("hidden")))
typedef void *(*DlsymFn)(void *, const char *);
static DlsymFn libc_dlsym;
static int trace_fd = -1;
static pthread_mutex_t binding_lock = PTHREAD_MUTEX_INITIALIZER;
static uint64_t global_call_id;
static uint64_t stack_after_ns;
static int stack_captured;
static uintptr_t executable_base;
static char executable_buildid[41];
static int query_layout_valid;
static int frame_pointer_layout_valid;
static int query_sample_captured;
static unsigned query_sample_attempts;
static __thread uint64_t active_call_id;
static __thread uintptr_t current_context[2];
static __thread uintptr_t current_display[2];
static __thread int recorder_depth;
struct Binding { void *original; int layer; uintptr_t base; char module[320]; };
struct Poll { uint64_t key, total, result, out; int has_out; };
static __thread struct Poll polls[POLL_BUCKETS];
struct Call { uint64_t id, parent, start; uintptr_t context, display; void *caller; };
struct WaitWatch { uintptr_t object, context; uint64_t first_pending, origin; };
static __thread struct WaitWatch wait_watch[POLL_BUCKETS];

static uint64_t ns(clockid_t clock) {
    struct timespec ts;
    clock_gettime(clock, &ts);
    return (uint64_t)ts.tv_sec * UINT64_C(1000000000) + (uint64_t)ts.tv_nsec;
}
static void write_record(const char *s, size_t len) {
    if (trace_fd < 0 || recorder_depth) return;
    int saved_errno = errno;
    recorder_depth++;
    ssize_t n = syscall(SYS_write, trace_fd, s, len);
    (void)n; /* Never block on retry or change the GL caller's error state. */
    recorder_depth--;
    errno = saved_errno;
}
static const char *layer_name(int layer) { return layer ? "angle" : "native"; }
static void escape_path(char *dst, size_t size, const char *src) {
    size_t n = 0;
    if (!src) src = "unknown";
    for (; *src && n + 3 < size; ++src) {
        if (*src == '\\' || *src == '"') dst[n++] = '\\';
        if ((unsigned char)*src < 32) dst[n++] = '?';
        else dst[n++] = *src;
    }
    dst[n] = 0;
}
static void identify(struct Binding *b, void *p) {
    Dl_info info = {0};
    dladdr(p, &info);
    b->base = (uintptr_t)info.dli_fbase;
    b->layer = info.dli_fname &&
      (strstr(info.dli_fname, "/chrome-linux64/") ||
       strstr(info.dli_fname, "/chrome-headless-shell-linux64/") ||
       strstr(info.dli_fname, "/opt/google/chrome/"));
    escape_path(b->module, sizeof b->module, info.dli_fname);
}
static int safe_read(uintptr_t address, void *out, size_t size) {
    if (address < 4096 || address > UINT64_C(0x00007fffffffffff) - size) return 0;
    struct iovec local = { .iov_base=out, .iov_len=size };
    struct iovec remote = { .iov_base=(void *)address, .iov_len=size };
    return syscall(SYS_process_vm_readv,getpid(),&local,1,&remote,1,0) == (ssize_t)size;
}
static int validate_main(struct dl_phdr_info *info, size_t size, void *arg) {
    (void)size; (void)arg;
    if (info->dlpi_name && *info->dlpi_name) return 0;
    executable_base = (uintptr_t)info->dlpi_addr;
    for (unsigned i = 0; i < info->dlpi_phnum; ++i) {
        const ElfW(Phdr) *ph = &info->dlpi_phdr[i];
        if (ph->p_type != PT_NOTE || ph->p_memsz > 4096) continue;
        unsigned char note[4096];
        if (!safe_read(executable_base+ph->p_vaddr,note,(size_t)ph->p_memsz)) continue;
        for (size_t pos = 0; pos+sizeof(ElfW(Nhdr)) <= ph->p_memsz;) {
            ElfW(Nhdr) nh; memcpy(&nh,note+pos,sizeof nh); pos += sizeof nh;
            size_t namesz = (nh.n_namesz+3u)&~3u, descsz = (nh.n_descsz+3u)&~3u;
            if (pos+namesz+descsz > ph->p_memsz) break;
            if (nh.n_type == NT_GNU_BUILD_ID && nh.n_namesz == 4 && nh.n_descsz == 20 && !memcmp(note+pos,"GNU",4)) {
                static const char hex[]="0123456789abcdef";
                for (unsigned j=0;j<20;++j) { unsigned v=note[pos+namesz+j]; executable_buildid[j*2]=hex[v>>4]; executable_buildid[j*2+1]=hex[v&15]; }
            }
            pos += namesz+descsz;
        }
    }
    if (strcmp(executable_buildid,"5f6e1a6835b28b53be4483a0c48063fd3fcb3108")) return 1;
    const unsigned char call84f8[]={0xff,0x50,0x10,0x84,0xc0,0x75,0x93};
    const unsigned char stores[]={0x49,0x8b,0x4d,0x10,0x48,0x89,0x41,0x04,0x49,0x8b,0x45,0x10,0x41,0x8b,0x4d,0x18,0x89,0x08};
    const unsigned char call84f7[]={0xff,0x50,0x10,0x0f,0xb6,0xc0};
    unsigned char bytes[128];
    query_layout_valid = safe_read(executable_base+0xd18141d,bytes,sizeof call84f8) && !memcmp(bytes,call84f8,sizeof call84f8)
      && safe_read(executable_base+0xd18142f,bytes,sizeof stores) && !memcmp(bytes,stores,sizeof stores)
      && safe_read(executable_base+0xd1814e3,bytes,sizeof call84f7) && !memcmp(bytes,call84f7,sizeof call84f7);
    frame_pointer_layout_valid=query_layout_valid;
    /* SyncGL prologue: saves RBX only. */
    const unsigned char fp_guard_0[]={0x55,0x48,0x89,0xe5,0x53,0x50};
    if (!safe_read(executable_base+0x77d8da0,bytes,sizeof fp_guard_0) || memcmp(bytes,fp_guard_0,sizeof fp_guard_0)) frame_pointer_layout_valid=0;
    /* SyncGL native call and result store. */
    const unsigned char fp_guard_1[]={0xff,0x90,0x88,0x09,0x00,0x00,0x89,0x03};
    if (!safe_read(executable_base+0x77d8dba,bytes,sizeof fp_guard_1) || memcmp(bytes,fp_guard_1,sizeof fp_guard_1)) frame_pointer_layout_valid=0;
    /* Context prologue: R14 at RBP-16, no R13 save. */
    const unsigned char fp_guard_2[]={0x55,0x48,0x89,0xe5,0x41,0x57,0x41,0x56,0x41,0x54,0x53,0x48,0x83,0xec,0x10};
    if (!safe_read(executable_base+0x76eb040,bytes,sizeof fp_guard_2) || memcmp(bytes,fp_guard_2,sizeof fp_guard_2)) frame_pointer_layout_valid=0;
    /* Context sync call and return. */
    const unsigned char fp_guard_3[]={0xe8,0x9f,0x02,0x01,0x00,0x83,0xf8,0x01};
    if (!safe_read(executable_base+0x76eb07c,bytes,sizeof fp_guard_3) || memcmp(bytes,fp_guard_3,sizeof fp_guard_3)) frame_pointer_layout_valid=0;
    /* Sync::clientWait tail jump. */
    const unsigned char fp_guard_4[]={0x5d,0xff,0x60,0x20};
    if (!safe_read(executable_base+0x76fb34b,bytes,sizeof fp_guard_4) || memcmp(bytes,fp_guard_4,sizeof fp_guard_4)) frame_pointer_layout_valid=0;
    /* Entry point prologue: R14 at RBP-16, RBX at RBP-32. */
    const unsigned char fp_guard_5[]={0x55,0x48,0x89,0xe5,0x41,0x57,0x41,0x56,0x41,0x54,0x53,0x48,0x83,0xec,0x10};
    if (!safe_read(executable_base+0xbf7eca0,bytes,sizeof fp_guard_5) || memcmp(bytes,fp_guard_5,sizeof fp_guard_5)) frame_pointer_layout_valid=0;
    /* Entry point Context call and return. */
    const unsigned char fp_guard_6[]={0xe8,0x12,0xc3,0x76,0xfb,0x89,0xc3};
    if (!safe_read(executable_base+0xbf7ed29,bytes,sizeof fp_guard_6) || memcmp(bytes,fp_guard_6,sizeof fp_guard_6)) frame_pointer_layout_valid=0;
    /* GLFenceARB prologue: saves RBX only. */
    const unsigned char fp_guard_7[]={0x55,0x48,0x89,0xe5,0x53,0x50};
    if (!safe_read(executable_base+0xbf28330,bytes,sizeof fp_guard_7) || memcmp(bytes,fp_guard_7,sizeof fp_guard_7)) frame_pointer_layout_valid=0;
    /* GLFenceARB sync member load, zero args, wait call, return. */
    const unsigned char fp_guard_8[]={0x48,0x8b,0x73,0x08,0x31,0xd2,0x31,0xc9,0xff,0x90,0x80,0x01,0x00,0x00,0x3d,0x1d,0x91,0x00,0x00};
    if (!safe_read(executable_base+0xbf2836f,bytes,sizeof fp_guard_8) || memcmp(bytes,fp_guard_8,sizeof fp_guard_8)) frame_pointer_layout_valid=0;
    /* ProcessQueries shadow fence completion call. */
    const unsigned char fp_guard_9[]={0xff,0x50,0x10,0x84,0xc0,0x75,0x93};
    if (!safe_read(executable_base+0xd18141d,bytes,sizeof fp_guard_9) || memcmp(bytes,fp_guard_9,sizeof fp_guard_9)) frame_pointer_layout_valid=0;
    /* ProcessQueries commands fence completion call. */
    const unsigned char fp_guard_10[]={0xff,0x50,0x10,0x0f,0xb6,0xc0,0x89};
    if (!safe_read(executable_base+0xd1814e3,bytes,sizeof fp_guard_10) || memcmp(bytes,fp_guard_10,sizeof fp_guard_10)) frame_pointer_layout_valid=0;
    return 1;
}
__attribute__((constructor)) static void initialize_trace(void) {
    int saved_errno = errno;
    const char *stack_delay = getenv("NATIVE_GL_TRACE_STACK_AFTER_MS");
    if (stack_delay) {
        char *end = NULL;
        double ms = strtod(stack_delay, &end);
        if (end != stack_delay && end && !*end && ms > 0 && ms <= 3600000)
            stack_after_ns = (uint64_t)(ms * 1e6);
    }
    if (stack_after_ns) dl_iterate_phdr(validate_main,NULL);
    const char *path = getenv("NATIVE_GL_TRACE");
    if (path && path[0] == '/') {
        trace_fd = open(path, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0600);
        if (trace_fd >= 0) {
            char record[600];
            int n = snprintf(record, sizeof record,
              "{\"kind\":\"init\",\"pid\":%d,\"tid\":%ld,\"monoNs\":\"%" PRIu64 "\",\"wallMs\":%.3f,\"pollEvery\":256,\"slots\":8,\"stackAfterMs\":%.3f,\"executableBase\":\"0x%" PRIxPTR "\",\"executableBuildId\":\"%s\",\"queryLayoutValidated\":%s,\"framePointerLayoutValidated\":%s}\n",
              getpid(), syscall(SYS_gettid), ns(CLOCK_MONOTONIC), (double)ns(CLOCK_REALTIME)/1e6, (double)stack_after_ns/1e6,
              executable_base,executable_buildid,query_layout_valid ? "true" : "false",frame_pointer_layout_valid ? "true" : "false");
            if (n > 0 && n < (int)sizeof record) write_record(record, (size_t)n);
        }
    }
    errno = saved_errno;
}
HIDDEN __attribute__((noinline,used)) void *native_trace_real_dlsym(void) {
    DlsymFn p = __atomic_load_n(&libc_dlsym, __ATOMIC_ACQUIRE);
    if (!p) {
        p = (DlsymFn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.2.5");
        __atomic_store_n(&libc_dlsym, p, __ATOMIC_RELEASE);
    }
    return (void *)p;
}
static struct Call begin_call(struct Binding *b, void *caller) {
    struct Call c = {0};
    c.id = __atomic_add_fetch(&global_call_id, 1, __ATOMIC_RELAXED);
    c.parent = active_call_id;
    c.context = current_context[b->layer];
    c.display = current_display[b->layer];
    c.caller = caller;
    c.start = ns(CLOCK_MONOTONIC);
    active_call_id = c.id;
    return c;
}
struct QuerySnapshot {
    uintptr_t query, decoder, pc, sync, shadow_fence, commands_fence;
    uint32_t target, service_id, submit_count, process_count;
    uint64_t result;
    uintptr_t fence_object, angle_sync;
    int frame_found, read_ok, sync_read_ok, target_matches, fence_object_matches, angle_sync_read_ok;
    int recovery;
};
struct FramePointer { uintptr_t fp, previous, pc, return_pc, below[16]; int below_ok; };
struct StackWalk {
    uintptr_t frames[32]; unsigned count; struct QuerySnapshot query;
    uintptr_t fp_seed, fp_r13, fp_r14;
    struct FramePointer fp_frames[32]; unsigned fp_count; const char *fp_stop;
};
static _Unwind_Reason_Code stack_frame(struct _Unwind_Context *context, void *arg) {
    struct StackWalk *walk = arg;
    uintptr_t pc = (uintptr_t)_Unwind_GetIP(context);
    if (!pc || walk->count == 32) return _URC_END_OF_STACK;
    walk->frames[walk->count++] = pc;
    uintptr_t offset = pc-executable_base;
    if (query_layout_valid && offset == 0x77d8dc0 && !walk->fp_seed) {
        walk->fp_seed=(uintptr_t)_Unwind_GetGR(context,6);
        walk->fp_r13=(uintptr_t)_Unwind_GetGR(context,13);
        walk->fp_r14=(uintptr_t)_Unwind_GetGR(context,14);
    }
    if (query_layout_valid && !walk->query.frame_found && (offset == 0xd181420 || offset == 0xd1814e6)) {
        struct QuerySnapshot *q=&walk->query;
        q->frame_found=1; q->recovery=1; q->pc=pc;
        q->query=(uintptr_t)_Unwind_GetGR(context,13);
        q->decoder=(uintptr_t)_Unwind_GetGR(context,14);
        unsigned char bytes[0x50];
        if (!(q->query&7) && !(q->decoder&7) && q->decoder>=4096 && safe_read(q->query,bytes,sizeof bytes)) {
            q->read_ok=1;
            memcpy(&q->target,bytes,4); memcpy(&q->service_id,bytes+4,4);
            memcpy(&q->sync,bytes+0x10,8); memcpy(&q->submit_count,bytes+0x18,4);
            memcpy(&q->commands_fence,bytes+0x20,8); memcpy(&q->shadow_fence,bytes+0x48,8);
            q->target_matches=q->target==(offset==0xd181420 ? 0x84f8u : 0x84f7u);
            unsigned char sync[12];
            if (!(q->sync&3) && safe_read(q->sync,sync,sizeof sync)) {
                q->sync_read_ok=1; memcpy(&q->process_count,sync,4); memcpy(&q->result,sync+4,8);
            }
        }
    }
    return _URC_NO_REASON;
}


/* Only this exact guarded chain has a proved register-restoration rule. */
static void decode_frame_query(struct StackWalk *walk) {
    if (!frame_pointer_layout_valid || walk->fp_count<5 || walk->query.frame_found) return;
    const uintptr_t offsets[]={0x77d8dc0,0x76eb081,0xbf7ed2e,0xbf2837d};
    for (unsigned i=0;i<4;++i)
        if (walk->fp_frames[i].pc-executable_base != offsets[i]) return;
    uintptr_t pc=walk->fp_frames[4].pc;
    uintptr_t offset=pc-executable_base;
    if ((offset!=0xd181420 && offset!=0xd1814e6) || !walk->fp_frames[2].below_ok) return;
    struct QuerySnapshot *q=&walk->query;
    q->frame_found=1; q->recovery=2; q->pc=pc;
    /* All four intervening frames preserve R13. Entry point restores R14/RBX. */
    q->query=walk->fp_r13;
    q->decoder=walk->fp_frames[2].below[14]; /* RBP-16, saved R14. */
    q->fence_object=walk->fp_frames[2].below[12]; /* RBP-32, saved RBX. */
    unsigned char bytes[0x50];
    if (!(q->query&7) && !(q->decoder&7) && q->decoder>=4096 && q->decoder<=UINT64_C(0x00007fffffffffff)
        && safe_read(q->query,bytes,sizeof bytes)) {
        q->read_ok=1;
        memcpy(&q->target,bytes,4); memcpy(&q->service_id,bytes+4,4);
        memcpy(&q->sync,bytes+0x10,8); memcpy(&q->submit_count,bytes+0x18,4);
        memcpy(&q->commands_fence,bytes+0x20,8); memcpy(&q->shadow_fence,bytes+0x48,8);
        q->target_matches=q->target==(offset==0xd181420 ? 0x84f8u : 0x84f7u);
        q->fence_object_matches=q->fence_object && q->fence_object==(offset==0xd181420 ? q->shadow_fence : q->commands_fence);
        if (q->target_matches && q->fence_object_matches)
            q->angle_sync_read_ok=safe_read(q->fence_object+8,&q->angle_sync,sizeof q->angle_sync);
        unsigned char sync[12];
        if (!(q->sync&3) && safe_read(q->sync,sync,sizeof sync)) {
            q->sync_read_ok=1; memcpy(&q->process_count,sync,4); memcpy(&q->result,sync+4,8);
        }
    }
}
static void collect_frame_pointer_chain(struct StackWalk *walk) {
    if (!query_layout_valid || !walk->fp_seed) return;
    uintptr_t fp=walk->fp_seed,pc=executable_base+0x77d8dc0;
    walk->fp_stop="frame-limit";
    while (walk->fp_count<32) {
        if (fp<4096 || (fp&7)) { walk->fp_stop="unaligned-or-low-frame"; break; }
        if (fp<walk->fp_seed || fp-walk->fp_seed>262144) { walk->fp_stop="span-limit"; break; }
        uintptr_t pair[2];
        if (!safe_read(fp,pair,sizeof pair)) { walk->fp_stop="unreadable-frame"; break; }
        struct FramePointer *frame=&walk->fp_frames[walk->fp_count++];
        frame->fp=fp;frame->previous=pair[0];frame->pc=pc;frame->return_pc=pair[1];
        frame->below_ok=safe_read(fp-sizeof frame->below,frame->below,sizeof frame->below);
        if (!pair[0]) { walk->fp_stop="null-link"; break; }
        if (pair[0]<=fp) { walk->fp_stop="nonascending-link"; break; }
        fp=pair[0];pc=pair[1];
    }
    decode_frame_query(walk);
}
static void emit_frame_pointer_chain(struct StackWalk *walk, struct Call c) {
    if (!query_layout_valid || !walk->fp_seed) return;
    char record[2200];
    int n=snprintf(record,sizeof record,
      "{\"kind\":\"frame-pointer-chain\",\"pid\":%d,\"tid\":%ld,\"stackId\":\"%" PRIu64 "\",\"seedFp\":\"0x%" PRIxPTR "\",\"seedR13\":\"0x%" PRIxPTR "\",\"seedR14\":\"0x%" PRIxPTR "\",\"limitFrames\":32,\"limitSpanBytes\":262144,\"savedBelowOrder\":\"rbp-8,rbp-16,...,rbp-128\"}\n",
      getpid(),syscall(SYS_gettid),c.id,walk->fp_seed,walk->fp_r13,walk->fp_r14);
    if(n>0 && n<(int)sizeof record) write_record(record,(size_t)n);
    for (unsigned index=0;index<walk->fp_count;++index) {
        struct FramePointer *raw=&walk->fp_frames[index];
        char saved[450]=""; int used=0;
        if (raw->below_ok) for(unsigned i=0;i<16;++i)
            used+=snprintf(saved+used,sizeof saved-(size_t)used,"%s\"0x%" PRIxPTR "\"",i ? "," : "",raw->below[15-i]);
        struct Binding frame={0}; identify(&frame,(void *)raw->pc);
        n=snprintf(record,sizeof record,
          "{\"kind\":\"frame-pointer\",\"pid\":%d,\"tid\":%ld,\"stackId\":\"%" PRIu64 "\",\"index\":%u,\"fp\":\"0x%" PRIxPTR "\",\"previousFp\":\"0x%" PRIxPTR "\",\"pc\":\"0x%" PRIxPTR "\",\"returnPc\":\"0x%" PRIxPTR "\",\"module\":\"%s\",\"base\":\"0x%" PRIxPTR "\",\"offset\":\"0x%" PRIxPTR "\",\"belowReadOk\":%s,\"savedBelow\":[%s]}\n",
          getpid(),syscall(SYS_gettid),c.id,index,raw->fp,raw->previous,raw->pc,raw->return_pc,frame.module,frame.base,raw->pc-frame.base,
          raw->below_ok ? "true" : "false",saved);
        if(n>0 && n<(int)sizeof record) write_record(record,(size_t)n);
    }
    n=snprintf(record,sizeof record,
      "{\"kind\":\"frame-pointer-summary\",\"pid\":%d,\"stackId\":\"%" PRIu64 "\",\"frames\":%u,\"stop\":\"%s\"}\n",getpid(),c.id,walk->fp_count,walk->fp_stop ? walk->fp_stop : "unavailable");
    if(n>0 && n<(int)sizeof record) write_record(record,(size_t)n);
}

static void emit_stack(const char *name, int slot,
        struct Binding *b, struct Call c, struct WaitWatch *watch,
        uint64_t result, uint64_t out, int has_out, uint64_t now,
        const char *reason, struct StackWalk *walk) {
    char record[1600];
    int n = snprintf(record,sizeof record,
      "{\"kind\":\"stack\",\"pid\":%d,\"tid\":%ld,\"monoNs\":\"%" PRIu64 "\",\"wallMs\":%.3f,"
      "\"stackId\":\"%" PRIu64 "\",\"call\":\"%s\",\"slot\":%d,\"layer\":\"%s\","
      "\"object\":\"0x%" PRIxPTR "\",\"context\":\"0x%" PRIxPTR "\",\"display\":\"0x%" PRIxPTR "\","
      "\"caller\":\"%p\",\"result\":\"%" PRIu64 "\",\"out\":\"%" PRIu64 "\",\"hasOut\":%s,"
      "\"originCreateId\":\"%" PRIu64 "\",\"firstPendingMonoNs\":\"%" PRIu64 "\",\"frames\":%u,\"reason\":\"%s\",\"queryLayoutValidated\":%s}\n",
      getpid(),syscall(SYS_gettid),now,(double)ns(CLOCK_REALTIME)/1e6,c.id,name,slot,
      layer_name(b->layer),watch->object,c.context,c.display,c.caller,result,out,
      has_out ? "true" : "false",watch->origin,watch->first_pending,walk->count,reason,
      query_layout_valid ? "true" : "false");
    if (n > 0 && n < (int)sizeof record) write_record(record,(size_t)n);
    emit_frame_pointer_chain(walk,c);
    struct QuerySnapshot *q=&walk->query;
    n=snprintf(record,sizeof record,
      "{\"kind\":\"query-snapshot\",\"pid\":%d,\"tid\":%ld,\"stackId\":\"%" PRIu64 "\",\"frameFound\":%s,\"readOk\":%s,\"syncReadOk\":%s,\"targetMatches\":%s,"
      "\"pc\":\"0x%" PRIxPTR "\",\"query\":\"0x%" PRIxPTR "\",\"decoder\":\"0x%" PRIxPTR "\",\"target\":%u,\"serviceId\":%u,"
      "\"querySync\":\"0x%" PRIxPTR "\",\"submitCount\":%u,\"processCount\":%u,\"queryResult\":\"%" PRIu64 "\","
      "\"commandsFence\":\"0x%" PRIxPTR "\",\"shadowFence\":\"0x%" PRIxPTR "\",\"recovery\":\"%s\",\"fenceObject\":\"0x%" PRIxPTR "\",\"fenceObjectMatches\":%s,\"angleSyncReadOk\":%s,\"angleSync\":\"0x%" PRIxPTR "\"}\n",
      getpid(),syscall(SYS_gettid),c.id,q->frame_found ? "true" : "false",q->read_ok ? "true" : "false",q->sync_read_ok ? "true" : "false",q->target_matches ? "true" : "false",
      q->pc,q->query,q->decoder,q->target,q->service_id,q->sync,q->submit_count,q->process_count,q->result,q->commands_fence,q->shadow_fence,
      q->recovery==2 ? "verified-frame-pointer" : q->recovery==1 ? "unwind" : "none",q->fence_object,
      q->fence_object_matches ? "true" : "false",q->angle_sync_read_ok ? "true" : "false",q->angle_sync);
    if (n > 0 && n < (int)sizeof record) write_record(record,(size_t)n);
    for (unsigned i = 0; i < walk->count; ++i) {
        struct Binding frame = {0};
        identify(&frame,(void *)walk->frames[i]);
        n = snprintf(record,sizeof record,
          "{\"kind\":\"stack-frame\",\"pid\":%d,\"tid\":%ld,\"stackId\":\"%" PRIu64 "\","
          "\"index\":%u,\"pc\":\"0x%" PRIxPTR "\",\"module\":\"%s\",\"base\":\"0x%" PRIxPTR "\",\"offset\":\"0x%" PRIxPTR "\"}\n",
          getpid(),syscall(SYS_gettid),c.id,i,walk->frames[i],frame.module,frame.base,walk->frames[i]-frame.base);
        if (n > 0 && n < (int)sizeof record) write_record(record,(size_t)n);
    }
}
__attribute__((noinline)) static void capture_timeout_stack(const char *name, int slot,
        struct Binding *b, struct Call c, struct WaitWatch *watch,
        uint64_t result, uint64_t out, int has_out, uint64_t now) {
    if (__atomic_exchange_n(&stack_captured, 1, __ATOMIC_RELAXED)) return;
    struct StackWalk walk = {0};
    _Unwind_Backtrace(stack_frame,&walk);
    collect_frame_pointer_chain(&walk);
    emit_stack(name,slot,b,c,watch,result,out,has_out,now,"pending-timeout",&walk);
}
__attribute__((noinline)) static void capture_successful_query(const char *name, int slot,
        struct Binding *b, struct Call c, struct WaitWatch *watch,
        uint64_t result, uint64_t out, int has_out, uint64_t now) {
    if (!query_layout_valid || __atomic_load_n(&query_sample_captured,__ATOMIC_RELAXED) ||
        __atomic_load_n(&query_sample_attempts,__ATOMIC_RELAXED)>=64) return;
    unsigned attempt=__atomic_add_fetch(&query_sample_attempts,1,__ATOMIC_RELAXED);
    if (attempt>64) return;
    struct StackWalk walk={0};
    _Unwind_Backtrace(stack_frame,&walk);
    collect_frame_pointer_chain(&walk);
    struct QuerySnapshot *q=&walk.query;
    if (q->frame_found && q->read_ok && q->sync_read_ok && q->target_matches &&
        (q->recovery!=2 || q->fence_object_matches) &&
        !__atomic_exchange_n(&query_sample_captured,1,__ATOMIC_RELAXED))
        emit_stack(name,slot,b,c,watch,result,out,has_out,now,"successful-query",&walk);
    else if (attempt==1 || attempt==64) {
        emit_stack(name,slot,b,c,watch,result,out,has_out,now,
          attempt==1 ? "successful-query-candidate-first" : "successful-query-candidate-last",&walk);
    }
    if (attempt==64 && !__atomic_load_n(&query_sample_captured,__ATOMIC_RELAXED)) {
        char record[300];
        int n=snprintf(record,sizeof record,"{\"kind\":\"query-sample-exhausted\",\"pid\":%d,\"attempts\":64,\"identityValidated\":false}\n",getpid());
        if (n>0 && n<(int)sizeof record) write_record(record,(size_t)n);
    }
}
static void observe_pending(const char *name, int slot, struct Binding *b,
        struct Call c, uint64_t object, uint64_t result, uint64_t out,
        int has_out, uint64_t now) {
    if (!object) return;
    uint64_t key = object ^ (c.context >> 3);
    struct WaitWatch *watch = &wait_watch[(key ^ (key >> 32)) & (POLL_BUCKETS-1)];
    int created = !strcmp(name,"glFenceSync") || !strncmp(name,"eglCreateSync",13);
    int deleted = !strcmp(name,"glDeleteSync") || !strncmp(name,"eglDestroySync",14);
    if (created || deleted) {
        *watch = (struct WaitWatch){ .object=(uintptr_t)object,
          .context=c.context, .origin=created ? c.id : 0 };
        return;
    }
    int pending, succeeded;
    if (!strcmp(name,"glClientWaitSync")) { pending=result==0x911b; succeeded=result==0x911a || result==0x911c; }
    else if (!strcmp(name,"glGetSynciv")) { pending=has_out && out==0x9118; succeeded=has_out && out==0x9119; }
    else if (!strncmp(name,"eglClientWaitSync",17)) { pending=result==0x30f5; succeeded=result==0x30f6; }
    else if (!strncmp(name,"eglGetSyncAttrib",16)) { pending=has_out && out==0x30f3; succeeded=has_out && out==0x30f2; }
    else return;
    if (watch->object != object || watch->context != c.context)
        *watch = (struct WaitWatch){ .object=(uintptr_t)object, .context=c.context };
    if (!pending) {
        if (succeeded) capture_successful_query(name,slot,b,c,watch,result,out,has_out,now);
        watch->first_pending=0; return;
    }
    if (!watch->first_pending) watch->first_pending = now;
    if (!__atomic_load_n(&stack_captured,__ATOMIC_RELAXED) && now - watch->first_pending >= stack_after_ns)
        capture_timeout_stack(name,slot,b,c,watch,result,out,has_out,now);
}
static void finish_call(const char *name, int code, int slot, struct Binding *b,
                        struct Call c, const uint64_t *args, int nargs,
                        uint64_t object, uint64_t result, int pointer_result,
                        uint64_t out, int has_out, int poll,
                        const uint64_t *attrs, int nattrs) {
    uint64_t end = ns(CLOCK_MONOTONIC);
    active_call_id = c.parent;
    if (trace_fd < 0 || recorder_depth) return;
    if (stack_after_ns && (!__atomic_load_n(&stack_captured, __ATOMIC_RELAXED) ||
        (query_layout_valid && !__atomic_load_n(&query_sample_captured,__ATOMIC_RELAXED) &&
         __atomic_load_n(&query_sample_attempts,__ATOMIC_RELAXED)<64)))
        observe_pending(name,slot,b,c,object,result,out,has_out,end);
    uint64_t seen = 1;
    if (poll) {
        uint64_t key = object ^ (c.context >> 3) ^ ((uint64_t)(code * SLOTS + slot + 1) << 43);
        for (int i = 0; i < nargs; ++i) key = (key ^ args[i]) * UINT64_C(1099511628211);
        if (!key) key = 1;
        struct Poll *p = &polls[(key ^ (key >> 32)) & (POLL_BUCKETS - 1)];
        if (p->key != key) *p = (struct Poll){ .key = key };
        ++p->total;
        int emit = p->total == 1 || (p->total % 256) == 0 ||
                   p->result != result || p->out != out || p->has_out != has_out;
        p->result = result; p->out = out; p->has_out = has_out;
        seen = p->total;
        if (!emit) return;
    }
    char arg_text[240] = "", attr_text[400] = "", result_text[40], out_text[40];
    int n = 0;
    for (int i = 0; i < nargs && n + 30 < (int)sizeof arg_text; ++i)
        n += snprintf(arg_text+n, sizeof arg_text-(size_t)n, "%s\"%" PRIu64 "\"", i ? "," : "", args[i]);
    n = 0;
    for (int i = 0; i < nattrs && n + 30 < (int)sizeof attr_text; ++i)
        n += snprintf(attr_text+n, sizeof attr_text-(size_t)n, "%s\"%" PRIu64 "\"", i ? "," : "", attrs[i]);
    if (pointer_result) snprintf(result_text,sizeof result_text,"\"0x%" PRIx64 "\"",result);
    else snprintf(result_text,sizeof result_text,"\"%" PRIu64 "\"",result);
    if (has_out) snprintf(out_text,sizeof out_text,"\"%" PRIu64 "\"",out);
    else strcpy(out_text,"null");
    char record[1700];
    n = snprintf(record, sizeof record,
      "{\"kind\":\"call\",\"pid\":%d,\"tid\":%ld,\"monoNs\":\"%" PRIu64 "\",\"wallMs\":%.3f,"
      "\"id\":\"%" PRIu64 "\",\"parent\":\"%" PRIu64 "\",\"call\":\"%s\",\"slot\":%d,\"layer\":\"%s\","
      "\"context\":\"0x%" PRIxPTR "\",\"display\":\"0x%" PRIxPTR "\",\"caller\":\"%p\","
      "\"object\":\"0x%" PRIx64 "\",\"args\":[%s],\"result\":%s,\"out\":%s,\"attrs\":[%s],"
      "\"seen\":\"%" PRIu64 "\",\"durationNs\":\"%" PRIu64 "\"}\n",
      getpid(), syscall(SYS_gettid), end, (double)ns(CLOCK_REALTIME)/1e6,
      c.id,c.parent,name,slot,layer_name(b->layer),c.context,c.display,c.caller,
      object,arg_text,result_text,out_text,attr_text,seen,end-c.start);
    if (n > 0 && n < (int)sizeof record) write_record(record,(size_t)n);
}
static void *wrap_proc(const char *name, void *p, const char *via);
`;

const footer = String.raw`
static void *wrap_proc(const char *name, void *p, const char *via) {
    if (!p || !name || trace_fd < 0 || recorder_depth) return p;
    for (int code = 0; code < CALL_COUNT; ++code) {
        if (strcmp(name,specs[code].name)) continue;
        /* dladdr can take the loader lock; never hold binding_lock around it. */
        struct Binding candidate = {0};
        identify(&candidate,p);
        pthread_mutex_lock(&binding_lock);
        for (int slot = 0; slot < SLOTS; ++slot) {
            struct Binding *b = &bindings[code][slot];
            if (p == specs[code].wrappers[slot]) {
                pthread_mutex_unlock(&binding_lock); return p;
            }
            if (b->original == p) {
                pthread_mutex_unlock(&binding_lock); return specs[code].wrappers[slot];
            }
            if (b->original) continue;
            *b = candidate;
            b->original = p;
            char record[1000];
            int n = snprintf(record,sizeof record,
              "{\"kind\":\"resolve\",\"pid\":%d,\"tid\":%ld,\"monoNs\":\"%" PRIu64 "\",\"wallMs\":%.3f,"
              "\"call\":\"%s\",\"slot\":%d,\"layer\":\"%s\",\"via\":\"%s\",\"original\":\"%p\",\"module\":\"%s\",\"base\":\"0x%" PRIxPTR "\"}\n",
              getpid(),syscall(SYS_gettid),ns(CLOCK_MONOTONIC),(double)ns(CLOCK_REALTIME)/1e6,
              name,slot,layer_name(b->layer),via,p,b->module,b->base);
            if (n > 0 && n < (int)sizeof record) write_record(record,(size_t)n);
            pthread_mutex_unlock(&binding_lock);
            return specs[code].wrappers[slot];
        }
        pthread_mutex_unlock(&binding_lock);
        char record[240];
        int n = snprintf(record,sizeof record,
          "{\"kind\":\"slot-overflow\",\"pid\":%d,\"call\":\"%s\"}\n",getpid(),name);
        if (n > 0 && n < (int)sizeof record) write_record(record,(size_t)n);
        return p;
    }
    return p;
}
HIDDEN __attribute__((used)) void *native_trace_dlsym_handle(void *handle, const char *name) {
    DlsymFn original = (DlsymFn)native_trace_real_dlsym();
    void *p = original(handle,name);
    int saved_errno = errno;
    void *result = wrap_proc(name,p,"dlsym");
    errno = saved_errno;
    return result;
}
EXPORT __attribute__((naked)) void *dlsym(void *handle __attribute__((unused)), const char *name __attribute__((unused))) {
    __asm__ volatile(
      "push %rdi\n\t"
      "push %rsi\n\t"
      "sub $8, %rsp\n\t"
      "call native_trace_real_dlsym\n\t"
      "add $8, %rsp\n\t"
      "pop %rsi\n\t"
      "pop %rdi\n\t"
      "test %rdi, %rdi\n\t"
      "je 1f\n\t"
      "cmp $-1, %rdi\n\t"
      "je 1f\n\t"
      "jmp native_trace_dlsym_handle\n\t"
      "1: jmp *%rax\n\t");
}
`;

export function generateNativeTrace() {
  const specs = observerSpecs();
  const out = [header];
  out.push(
    `enum CallCode {\n${specs.map((s) => `    C_${s.name}`).join(",\n")},\n    CALL_COUNT\n};\n`,
  );
  out.push("static struct Binding bindings[CALL_COUNT][SLOTS];\n");
  for (const s of specs) {
    const { name, ret, params } = s;
    const decl = params.map(([t, v]) => `${t} ${v}`).join(", ") || "void";
    const types = params.map(([t]) => t).join(", ") || "void";
    const args = params.map(([, v]) => v).join(", ");
    for (let slot = 0; slot < 8; slot++) {
      out.push(`static ${ret} trace_${name}_${slot}(${decl}) {\n`);
      out.push(`    struct Binding *b = &bindings[C_${name}][${slot}];\n`);
      out.push("    int saved_errno = errno;\n");
      out.push(`    typedef ${ret} (*Fn)(${types});\n`);
      if (s.resolver) {
        out.push(
          "    errno = saved_errno;\n    void *result = ((Fn)b->original)(name);\n    saved_errno = errno;\n",
        );
        out.push(`    void *wrapped = wrap_proc(name, result, "${name}");\n`);
        out.push("    errno = saved_errno;\n    return wrapped;\n}\n");
        continue;
      }
      out.push(
        "    struct Call c = begin_call(b, __builtin_return_address(0));\n",
      );
      if (s.display) out.push(`    c.display = (uintptr_t)${s.display};\n`);
      out.push("    errno = saved_errno;\n");
      let result;
      if (ret === "void") {
        out.push(`    ((Fn)b->original)(${args});\n`);
        result = "0";
      } else {
        out.push(`    ${ret} result = ((Fn)b->original)(${args});\n`);
        result = ret.includes("*")
          ? "(uint64_t)(uintptr_t)result"
          : "(uint64_t)result";
      }
      out.push("    saved_errno = errno;\n");
      if (s.context) {
        const condition = s.context === "result" ? "1" : "result";
        out.push(
          `    if (${condition}) { current_context[b->layer] = (uintptr_t)${s.context}; c.context = (uintptr_t)${s.context};`,
        );
        if (s.display)
          out.push(` current_display[b->layer] = (uintptr_t)${s.display};`);
        out.push(" }\n");
      }
      const vals = params
        .map(([t, v]) =>
          t.includes("*") ? `(uint64_t)(uintptr_t)${v}` : `(uint64_t)${v}`,
        )
        .join(", ");
      out.push(`    const uint64_t call_args[] = {${vals || "0"}};\n`);
      let attrArgs = "NULL, 0";
      if (s.attrs) {
        out.push("    uint64_t attrs[17]; int nattrs = 0;\n");
        out.push(
          "    if (attribs) for (int i = 0; i < 17; ++i) { attrs[nattrs++] = (uint64_t)attribs[i]; if ((i % 2) == 0 && attribs[i] == 0x3038) break; }\n",
        );
        attrArgs = "attrs, nattrs";
      }
      const obj = s.create ? result : `(uint64_t)(uintptr_t)(${s.obj})`;
      out.push(
        `    finish_call("${name}", C_${name}, ${slot}, b, c, call_args, ${params.length}, ${obj}, ${result}, ${Number(ret.includes("*"))}, ${s.out}, ${s.has_out}, ${Number(s.poll)}, ${attrArgs});\n`,
      );
      out.push("    errno = saved_errno;\n");
      if (ret !== "void") out.push("    return result;\n");
      out.push("}\n");
    }
  }
  out.push(
    "struct Spec { const char *name; void *wrappers[SLOTS]; };\nstatic const struct Spec specs[CALL_COUNT] = {\n",
  );
  for (const s of specs)
    out.push(
      `    [C_${s.name}] = { "${s.name}", { ${Array.from({ length: 8 }, (_, i) => `(void *)trace_${s.name}_${i}`).join(", ")} } },\n`,
    );
  out.push("};\n", footer);
  return out.join("");
}

export function buildNativeTrace(options = {}) {
  const outdir = path.resolve(options.outdir || "scripts/out/native-gl-trace");
  fs.mkdirSync(outdir, { recursive: true });
  const source = path.join(outdir, "native-gl-trace.c");
  const library = path.join(outdir, "native-gl-trace.so");
  fs.writeFileSync(source, generateNativeTrace());
  if (!options.emitOnly) {
    // Atomic replacement keeps any currently loaded .so inode untouched.
    const temporary = `${library}.new-${process.pid}`;
    const cc = options.compiler || process.env.CC || "cc";
    const compiled = spawnSync(
      cc,
      [
        "-shared",
        "-fPIC",
        "-O2",
        "-g",
        "-fvisibility=hidden",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-o",
        temporary,
        source,
        "-ldl",
        "-pthread",
        "-lgcc_s",
      ],
      { encoding: "utf8" },
    );
    if (compiled.error || compiled.status !== 0) {
      fs.rmSync(temporary, { force: true });
      throw new Error(
        `Native GL observer compilation failed: ${compiled.error?.message || compiled.stderr || compiled.signal || compiled.status}`,
      );
    }
    fs.renameSync(temporary, library);
  }
  return { source, library, outdir };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const unknown = args.filter(
    (arg) => arg !== "--emit-only" && !arg.startsWith("--outdir="),
  );
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(" ")}`);
  const built = buildNativeTrace({
    outdir: args.find((arg) => arg.startsWith("--outdir="))?.slice(9),
    emitOnly: args.includes("--emit-only"),
  });
  console.log(JSON.stringify(built));
}
