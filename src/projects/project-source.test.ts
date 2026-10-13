import { describe, expect, it } from "vitest";

import { mostUrgentThread, projectState } from "./project-source.js";

describe("projectState", () => {
	it("picks the most urgent state and counts its threads", () => {
		expect(projectState([{ state: "working" }, { state: "input" }, { state: "input" }, { state: "error" }])).toEqual({ state: "input", count: 2 });
		expect(projectState([{ state: "done" }, { state: "working" }])).toEqual({ state: "working", count: 1 });
		expect(projectState([{ state: "idle" }, { state: "done" }, { state: "error" }])).toEqual({ state: "error", count: 1 });
	});

	it("is idle without threads", () => {
		expect(projectState([])).toEqual({ state: "idle", count: 0 });
	});
});

describe("mostUrgentThread", () => {
	it("picks the most urgent state, the most recently active on a tie", () => {
		const threads = [
			{ id: "a", state: "working" as const, lastActivityAt: 9 },
			{ id: "b", state: "input" as const, lastActivityAt: 1 },
			{ id: "c", state: "input" as const, lastActivityAt: 5 },
		];
		expect(mostUrgentThread(threads)?.id).toBe("c");
		expect(mostUrgentThread(threads.slice(0, 1))?.id).toBe("a");
	});

	it("is undefined without threads", () => {
		expect(mostUrgentThread([])).toBeUndefined();
	});
});
