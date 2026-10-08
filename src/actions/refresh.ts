/** Safety net against missed events: all visible keys redraw this often (PLAN.md, Package 29). */
export const REFRESH_MS = 30_000;

/** Calls renderAll() on every target each interval; returns stop(). */
export function startRefresh(targets: { renderAll(): void }[], every = REFRESH_MS, timers = { setInterval, clearInterval }): () => void {
	const timer = timers.setInterval(() => {
		for (const target of targets) target.renderAll();
	}, every);
	return () => timers.clearInterval(timer);
}
