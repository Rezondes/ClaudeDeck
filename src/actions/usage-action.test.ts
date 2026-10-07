import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimits } from "../domain/session-store.js";
import { toDataUrl } from "../render/status-key.js";
import { renderUsageKey, renderUsageResetKey } from "../render/usage-key.js";
import { UsageKeys } from "./usage-action.js";

const view = (id = "k1") => ({ id, setImage: vi.fn(), showAlert: vi.fn() });

/** A store whose rate limits the test sets; report() notifies like SessionStore.onRateLimits. */
function fakeStore() {
	let current: RateLimits | undefined;
	const listeners: ((r: RateLimits) => void)[] = [];
	return {
		rateLimits: () => current,
		onRateLimits: (l: (r: RateLimits) => void) => void listeners.push(l),
		report(limits: unknown[]) {
			current = { limits, at: 0 };
			for (const l of listeners) l(current);
		},
	};
}

const at = (h: number, m: number) => new Date(2026, 9, 8, h, m);

describe("UsageKeys", () => {
	let now: number;
	beforeEach(() => {
		vi.useFakeTimers();
		now = at(14, 0).getTime();
	});
	afterEach(() => vi.useRealTimers());

	it("shows placeholders without data or after reset", () => {
		const store = fakeStore();
		const keys = new UsageKeys(store, () => now);
		const v = view();
		keys.appear(v);
		expect(v.setImage).toHaveBeenLastCalledWith(toDataUrl(renderUsageKey({ fiveHour: null, sevenDay: null })));

		store.report([
			{ kind: "five_hour", percentUsed: 42.4, resetsAt: at(15, 0).toISOString() },
			{ kind: "seven_day", percentUsed: 85, resetsAt: new Date(2026, 9, 12, 9, 0).toISOString() },
			"junk",
		]);
		expect(v.setImage).toHaveBeenLastCalledWith(toDataUrl(renderUsageKey({ fiveHour: 42.4, sevenDay: 85 })));

		// The 5h window resets; the minute tick switches it to "--" without a new report.
		now = at(15, 1).getTime();
		vi.advanceTimersByTime(60_000);
		expect(v.setImage).toHaveBeenLastCalledWith(toDataUrl(renderUsageKey({ fiveHour: null, sevenDay: 85 })));

		keys.disappear("k1");
		v.setImage.mockClear();
		vi.advanceTimersByTime(120_000);
		expect(v.setImage).not.toHaveBeenCalled();
	});

	it("press shows reset times for 3 s", () => {
		const store = fakeStore();
		store.report([
			{ kind: "five_hour", percentUsed: 10, resetsAt: at(23, 50).toISOString() },
			{ kind: "seven_day", percentUsed: 60, resetsAt: new Date(2026, 9, 12, 9, 0).toISOString() },
		]);
		const keys = new UsageKeys(store, () => now);
		const v = view();
		keys.appear(v);
		keys.press(v);
		expect(v.setImage).toHaveBeenLastCalledWith(toDataUrl(renderUsageResetKey({ fiveHour: "23:50", sevenDay: "Mo 09:00" })));

		// A report during the reset view does not cut it short.
		store.report([{ kind: "five_hour", percentUsed: 11, resetsAt: at(23, 50).toISOString() }]);
		expect(v.setImage).toHaveBeenLastCalledWith(toDataUrl(renderUsageResetKey({ fiveHour: "23:50", sevenDay: null })));

		vi.advanceTimersByTime(2_999);
		expect(v.setImage).toHaveBeenLastCalledWith(toDataUrl(renderUsageResetKey({ fiveHour: "23:50", sevenDay: null })));
		vi.advanceTimersByTime(1);
		expect(v.setImage).toHaveBeenLastCalledWith(toDataUrl(renderUsageKey({ fiveHour: 11, sevenDay: null })));
	});
});
