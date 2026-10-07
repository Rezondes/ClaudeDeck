import type { SessionStore } from "../domain/session-store.js";
import { toDataUrl } from "../render/status-key.js";
import { renderUsageKey, renderUsageResetKey, resetLabel } from "../render/usage-key.js";
import type { KeyView } from "./key-view.js";

type Store = Pick<SessionStore, "rateLimits" | "onRateLimits">;
type Limit = { percent: number; resetsAt: Date | null };

const RESET_VIEW_MS = 3_000;
const TICK_MS = 60_000;

/**
 * "Plan Usage" shows the 5h and 7d plan limits from the last module report.
 * A limit whose resetsAt has passed shows "--"; a press shows the reset times for 3 s.
 */
export class UsageKeys {
	readonly #views = new Map<string, KeyView>();
	readonly #resetTimers = new Map<string, ReturnType<typeof setTimeout>>();
	#tick: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly store: Store,
		private readonly now: () => number,
	) {
		store.onRateLimits(() => this.#renderAll());
	}

	appear(view: KeyView): void {
		this.#views.set(view.id, view);
		// Re-render once a minute so expired windows switch to "--".
		this.#tick ??= setInterval(() => this.#renderAll(), TICK_MS);
		this.#render(view);
	}

	disappear(id: string): void {
		this.#views.delete(id);
		clearTimeout(this.#resetTimers.get(id));
		this.#resetTimers.delete(id);
		if (this.#views.size === 0) {
			clearInterval(this.#tick);
			this.#tick = undefined;
		}
	}

	press(view: KeyView): void {
		clearTimeout(this.#resetTimers.get(view.id));
		this.#resetTimers.set(
			view.id,
			setTimeout(() => {
				this.#resetTimers.delete(view.id);
				this.#render(view);
			}, RESET_VIEW_MS),
		);
		this.#render(view);
	}

	#renderAll(): void {
		for (const view of this.#views.values()) this.#render(view);
	}

	#render(view: KeyView): void {
		const fiveHour = this.#limit("five_hour");
		const sevenDay = this.#limit("seven_day");
		if (this.#resetTimers.has(view.id)) {
			const now = new Date(this.now());
			const label = (limit: Limit | null) => (limit?.resetsAt ? resetLabel(limit.resetsAt, now) : null);
			view.setImage(toDataUrl(renderUsageResetKey({ fiveHour: label(fiveHour), sevenDay: label(sevenDay) })));
		} else view.setImage(toDataUrl(renderUsageKey({ fiveHour: fiveHour?.percent ?? null, sevenDay: sevenDay?.percent ?? null })));
	}

	/** The reported limit of this kind, or null when missing, malformed or already reset. */
	#limit(kind: string): Limit | null {
		const raw = this.store.rateLimits()?.limits.find((l) => (l as { kind?: unknown } | null)?.kind === kind) as
			| { percentUsed?: unknown; resetsAt?: unknown }
			| undefined;
		if (typeof raw?.percentUsed !== "number") return null;
		const resetsAt = typeof raw.resetsAt === "string" ? new Date(raw.resetsAt) : null;
		const valid = resetsAt && !Number.isNaN(resetsAt.getTime()) ? resetsAt : null;
		if (valid && valid.getTime() <= this.now()) return null;
		return { percent: raw.percentUsed, resetsAt: valid };
	}
}
