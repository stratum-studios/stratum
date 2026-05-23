/**
 * Schedules GPU-backed Pixi resource teardown after the next display frame.
 *
 * `queueMicrotask` can still run in the same turn as WebGPU `submit()` and race the
 * queue: Chrome reports `[Buffer] used in submit while destroyed`. One `requestAnimationFrame`
 * matches {@link LightingComposer.scheduleLightTexturesDestroy}.
 */
const pending: Array<() => void> = [];
let rafId: number | null = null;

function runPending(): void {
  rafId = null;
  const batch = pending.splice(0, pending.length);
  for (const fn of batch) {
    fn();
  }
}

export function deferGpuBufferDestroy(fn: () => void): void {
  pending.push(fn);
  if (rafId === null) {
    rafId = requestAnimationFrame(runPending);
  }
}

/** Run before destroying the WebGPU device so deferred work completes while the context is valid. */
export function flushGpuBufferDestroysNow(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  runPending();
}
