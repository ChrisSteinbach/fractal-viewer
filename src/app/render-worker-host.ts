import type { RenderSessionHandle } from "./render-session";

/**
 * The Worker surface a render session needs. Kept structural so lifecycle
 * tests can use a plain fake without browser globals or a real module worker.
 */
export interface RenderWorkerLike<Command, Event> {
  onmessage: ((event: MessageEvent<Event>) => unknown) | null;
  onerror: ((event: ErrorEvent) => unknown) | null;
  postMessage(command: Command): void;
  terminate(): void;
}

/**
 * Adapt one Worker into a {@link RenderSessionHandle} and make its callback
 * identity the stale-event gate for that render session.
 *
 * Every render entry owns a fresh Worker. On teardown, handlers are detached
 * before termination so an event already queued on the main thread cannot be
 * dispatched through the dead host. The closure-level `live` check is the
 * second half of that contract: even a callback reference captured before
 * teardown is inert afterwards. This lets RenderSession re-entry reject the
 * old worker without adding generation fields to every render event.
 */
export function createRenderWorkerHost<Command, Event>(
  worker: RenderWorkerLike<Command, Event>,
  onEvent: (event: Event) => void,
  onError: (event: ErrorEvent) => void,
): RenderSessionHandle<Command> {
  let live = true;
  worker.onmessage = (event) => {
    if (live) onEvent(event.data);
  };
  worker.onerror = (event) => {
    if (live) onError(event);
  };

  return {
    post: (command) => worker.postMessage(command),
    terminate: () => {
      // Order is load-bearing: Worker.terminate() stops worker-side work but
      // cannot retract a MessageEvent already queued on this thread.
      live = false;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    },
  };
}
