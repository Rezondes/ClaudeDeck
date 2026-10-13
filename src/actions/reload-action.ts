import type { KeyView } from "./key-view.js";

/** Holding the key this long restarts the plugin process instead of reloading (same threshold as the status key). */
const LONG_PRESS_MS = 600;

/**
 * "Claude Reload": a short press rereads everything (Desktop catalog, projects, context) and redraws all keys,
 * then shows a check mark or an alert. A long press restarts the plugin process; Stream Deck starts it again.
 */
export class ReloadKeys {
	/** Key id -> when it went down, to tell a short press from a long one on release. */
	readonly #downAt = new Map<string, number>();

	constructor(
		/** Rereads and redraws everything; resolves false when a part failed. */
		private readonly reload: () => Promise<boolean>,
		private readonly restart: () => void,
		private readonly now: () => number = Date.now,
	) {}

	appear(): void {}

	disappear(id: string): void {
		this.#downAt.delete(id);
	}

	press(view: KeyView): void {
		this.#downAt.set(view.id, this.now());
	}

	release(view: KeyView): void {
		const downAt = this.#downAt.get(view.id);
		this.#downAt.delete(view.id);
		if (downAt === undefined) return;
		if (this.now() - downAt >= LONG_PRESS_MS) return this.restart();
		this.reload()
			.catch(() => false)
			.then((ok) => (ok ? view.showOk?.() : view.showAlert()));
	}
}
