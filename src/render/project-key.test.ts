import { describe, expect, it } from "vitest";

import { BAR_TRACK, STATE_COLORS } from "./colors.js";
import { renderProjectKey, renderProjectPlaceholder } from "./project-key.js";

function expectSvgTiny(svg: string): void {
	expect(svg).toContain('width="144" height="144"');
	expect(svg).not.toMatch(/<(filter|foreignObject|mask|clipPath|style)\b/);
	for (const [, size] of svg.matchAll(/font-size="(\d+)"/g)) expect(Number(size)).toBeGreaterThanOrEqual(14);
}

describe("renderProjectKey", () => {
	it("shows name, open thread count and the most urgent state", () => {
		const svg = renderProjectKey({ name: "ClaudeDeck", threads: 3, state: "input", stateCount: 2 });
		expect(svg).toContain(">ClaudeDeck<");
		expect(svg).toContain(">3<");
		expect(svg).toContain(">Threads<");
		expect(svg).toMatch(new RegExp(`fill="${STATE_COLORS.input}">2 Input<`));
		expect(svg).toContain(`stroke="${STATE_COLORS.input}"`);
		expectSvgTiny(svg);
	});

	it("says Thread for one and Idle without a count", () => {
		const svg = renderProjectKey({ name: "A", threads: 1, state: "idle", stateCount: 0 });
		expect(svg).toContain(">Thread<");
		expect(svg).toContain(">Idle<");
	});

	it("wraps long names and escapes them", () => {
		const svg = renderProjectKey({ name: "Tom & Jerry Website Relaunch", threads: 0, state: "idle", stateCount: 0 });
		expect(svg).toContain("Tom &amp; Jerry");
		expectSvgTiny(svg);
	});

	it("marks stale data as offline", () => {
		const svg = renderProjectKey({ name: "A", threads: 2, state: "working", stateCount: 2, stale: true });
		expect(svg).toContain(">Offline<");
		expect(svg).toContain(`stroke="${BAR_TRACK}"`);
	});
});

describe("renderProjectPlaceholder", () => {
	it("asks to select a project", () => {
		const svg = renderProjectPlaceholder("Select project");
		expect(svg).toContain(">Select<");
		expect(svg).toContain(">project<");
		expectSvgTiny(svg);
	});
});
