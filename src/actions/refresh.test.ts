import { describe, expect, it, vi } from "vitest";

import { REFRESH_MS, startRefresh } from "./refresh.js";

describe("startRefresh", () => {
	it("re-renders all visible keys every 30 s", () => {
		vi.useFakeTimers();
		try {
			const targets = [{ renderAll: vi.fn() }, { renderAll: vi.fn() }];
			const stop = startRefresh(targets);
			expect(REFRESH_MS).toBe(30_000);

			vi.advanceTimersByTime(REFRESH_MS - 1);
			expect(targets[0].renderAll).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			for (const target of targets) expect(target.renderAll).toHaveBeenCalledTimes(1);

			stop();
			vi.advanceTimersByTime(REFRESH_MS);
			for (const target of targets) expect(target.renderAll).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
