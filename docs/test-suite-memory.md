# The test suite's memory — what a fork may hold, and what pinned one

The evidence behind CLAUDE.md's rule that a jsdom test file must let the
event loop turn. `npm test`'s vitest half ran 122 files across parallel
forks; one of them aborted partway through with a V8 heap-allocation
failure often enough that the crash read as flakiness. It was not
flakiness, and it was not the machine.

## The symptom

`npx vitest run` reported, on the development machine (8 cores, 15.7 GB,
node 22, V8 default old-space limit 4144 MB per process):

```
Error: [vitest-pool]: Worker forks emitted error.
Caused by: Error: Worker exited unexpectedly
 Test Files  121 passed (122)
      Tests  5677 passed (5746)
```

with `AllocateRawWithRetryOrFailSlowPath` in the aborting worker. The run
still exited having "passed" every test it reported, so the damage showed
up only as a file count one short of 122 and an unhandled-error line — the
same shape CI had already patched around once for its coverage job, whose
step comment names it: runner-contention OOMs "masquerading as a missing
test file".

Three instrumented runs, three crashes — 52.5s, 53.3s, 63.1s, each 121/122
files and 5676-5677/5746 tests. It reproduces on demand, which is what made
the rest measurable.

## Which file, and by how much

`npx vitest run --logHeapUsage --reporter=verbose` prints the worker's
`heapUsed` beside every test. Grouped by file, taking each file's maximum:

| file                                  | peak heap   |
| ------------------------------------- | ----------- |
| `src/app/ui.test.ts`                  | **4044 MB** |
| `src/app/flame-file.test.ts`          | 71 MB       |
| `src/app/persist.test.ts`             | 70 MB       |
| `src/app/surface-material.test.ts`    | 66 MB       |
| `src/app/voxel-worker-core.test.ts`   | 61 MB       |
| `src/app/surface-compute.test.ts`     | 60 MB       |
| `src/app/interactions.test.ts`        | 58 MB       |
| `src/app/surface-material-4d.test.ts` | 54 MB       |
| `src/fractal/surface-de-gpu.test.ts`  | 53 MB       |
| `src/app/slider-scroll-guard.test.ts` | 48 MB       |

One file, 57x the next. 4044 MB against a 4144 MB limit is not a file that
is merely expensive; it is a file that never gives anything back. Its
trajectory across its own 757 reported tests, sampled every fiftieth:

```
111  394  653  881 1209 1532 1826 2086 2344 2542 2800 3042 3239 3510 3771 4009
```

Monotonic, no sawtooth anywhere in 757 samples, ~5.2 MB per test. And it
reproduces ALONE on an idle machine — `npx vitest run src/app/ui.test.ts`
aborted at 756 of 826 tests — which is what retires the first hypothesis
outright.

## Two hypotheses the measurement refuted

**"Machine memory pressure from the heavy probes."** No. The file dies by
itself with the machine otherwise idle, and the heaviest of the other 121
files peaks at 71 MB. Nothing about 262k-point chains, fork count or load
average is involved; seven forks holding 71 MB apiece is half a gigabyte.

**"A specific heavy file should be isolated."** Also no, and the distinction
matters: `ui.test.ts` is not heavy. Its working set is one control panel.
Isolating it, giving it its own project, or serialising the pool would each
have hidden the leak behind a bigger budget while leaving 4 GB of live
objects accumulating inside it.

The growth is also uniform across the file's subject matter — every one of
its top-level groups grows between 4.3 and 6.7 MB per test, including groups
that assert against index.html without exercising the panel at all. A leak
that does not care what the test does is a leak in what every test shares:
the `beforeEach`.

## What was actually retained

The file's `beforeEach` clears `document.body` and deep-clones index.html
back into it, so each test gets a fresh panel. A `WeakRef` taken on every
test's `#panel`, counted after two forced full GCs:

```
test=100 aliveTrees=100/100 heapMB=647
test=200 aliveTrees=200/200 heapMB=1233
test=300 aliveTrees=300/300 heapMB=1866
test=400 aliveTrees=400/400 heapMB=2389
test=500 aliveTrees=500/500 heapMB=2915
test=600 aliveTrees=600/600 heapMB=3391
test=700 aliveTrees=700/700 heapMB=3942
```

Every panel the file ever built was still alive. The heap column is the
load-bearing half of that measurement and needs no weak-reference semantics
to read: those figures are what `heapUsed` reported IMMEDIATELY AFTER two
full collections, still climbing. The memory was live, not uncollected.

## The mechanism

Instrumenting the environment's globals around 30 rebuild-and-construct
cycles counted: 0 listeners added to `document`, 0 to `window`, 0
`requestAnimationFrame` callbacks — and exactly one `setTimeout` per cycle.
Its stack:

```
at HTMLDetailsElementImpl._attrModified (jsdom/living/nodes/HTMLDetailsElement-impl.js:27)
at exports.appendAttribute (jsdom/living/attributes.js:79)
at Object.exports.clone (jsdom/living/node.js:40)
at DocumentImpl.importNode (jsdom/living/nodes/Document-impl.js:874)
```

jsdom implements the `<details>` toggle event as a queued task:

```js
if (name === "open" && this._taskQueue === null) {
  this._taskQueue = setTimeout(this._dispatchToggleEvent.bind(this), 0);
}
```

That `bind(this)` is the retainer. index.html carries 27 `<details>`
elements of which exactly one is `open`, so cloning it queues one task per
test, and the accordion tests queue more by opening and closing sections.
A pending task holds its element; the element holds its parents and its
children; so one queued toggle task pins an entire panel tree.

The tasks would fire and release on the next turn of the event loop — but
between synchronous tests the runner awaits only MICROtasks, and a promise
job never advances the loop to its timer phase. The queue therefore only
grows. The same probe run with one real macrotask between iterations
retained 0 of 30 trees and stayed flat at 96 MB; run without it, all 30
survived.

## The fix, and the one that was rejected

`src/app/ui.test.ts` now carries

```ts
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});
```

one real macrotask turn per test, which drains whatever jsdom has queued.
Measured on the file alone: 826/826 tests pass where 756 had, peak heap
1097 MB in a healthy sawtooth instead of a monotonic 4044 MB, and the file
runs FASTER — 19.6s against 28.9s, because V8 had been collecting a 4 GB
live heap over and over.

The rejected alternative was a DOM teardown: emptying and removing every
`<details>` before rebuilding measures flat too (a probe held 90.4 -> 92.8 MB
across 125 cycles), because a pinned element that has been emptied and
detached pins nothing worth having. It was rejected for being the symptom's
shape rather than the cause's: it only reaches tasks queued by the clone,
knows nothing about the ones the accordion tests queue mid-test, and it
deletes DOM to work around an environment queue that simply needed to run.
`setTimeout(0)` is what the browser would have done between two frames.

## Why there is no per-fork heap cap

The issue's suggested lever — a vitest `poolOptions.forks` memory limit —
would only have moved the crash, not removed it. A cap chooses a smaller
abort point; it does not change what is alive. The file's live set was 4 GB
because nothing it built was ever released, and a limit of, say, 2048 MB
would have turned the flaky crash into a deterministic one while leaving the
same trees pinned and the same ~5.2 MB per test accumulating underneath. It
would also be a number tuned to one machine's RAM and one file's leak — a
test file's memory budget should describe what the test is allowed to hold,
not what the current bug happened to pin.

The drain needed no knob, only the loop the environment was waiting for:
`setTimeout(0)` is what a browser runs between two frames anyway, so the
file now does per test what a real page would do per frame. The cap stays
unset, and the file's peak is governed by its actual working set (~1.1 GB
with a healthy sawtooth instead of 4 GB never collected).

## The rule

A jsdom test file must let the event loop turn. If a file builds the DOM
(`ui.test.ts` rebuilds the whole panel per test) and runs long enough to
accumulate queued environment tasks, it needs one macrotask drain per test:

```ts
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});
```

jsdom's `<details>` toggle is scheduled as a 0ms `setTimeout` bound to the
element, and between synchronous tests vitest awaits only microtasks — a
promise job never advances the loop to its timer phase. A pending task pins
its element, and an element pins its whole tree. Any jsdom test that clones
or mutates elements with `open`/`closed` semantics can leak exactly like
this; if a file's heap grows monotonically with no sawtooth, suspect the
queue before the test logic.
