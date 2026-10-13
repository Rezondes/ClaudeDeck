import { describe, expect, it } from "vitest";

import { projectState } from "./project-source.js";

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
