// Pure polling helper: waits until a target's measure fn is registered AND yields
// a valid on-screen rect, or resolves null after a timeout. Clock is injectable
// so it's unit-testable without real timers.

export type Rect = { x: number; y: number; width: number; height: number };
export type MeasureFn = () => Promise<Rect | null>;

export async function waitForTarget(
  id: string,
  getMeasure: (id: string) => MeasureFn | undefined,
  opts?: { timeout?: number; interval?: number; now?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<Rect | null> {
  const timeout = opts?.timeout ?? 2500;
  const interval = opts?.interval ?? 150;
  const now = opts?.now ?? (() => Date.now());
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const start = now();
  // Poll until the deadline; check-then-sleep so a target that's ready on the
  // first tick resolves immediately.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fn = getMeasure(id);
    if (fn) {
      const rect = await fn();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    }
    if (now() - start >= timeout) return null;
    await sleep(interval);
  }
}
