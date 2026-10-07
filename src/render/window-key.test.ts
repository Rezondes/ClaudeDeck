import { describe, expect, it } from "vitest";

import { renderWindowKey } from "./window-key.js";

describe("renderWindowKey", () => {
	it("draws a labelled stroke symbol on a dark key", () => {
		const window = renderWindowKey("window");
		expect(window).toContain(">Window<");
		expect(window).toContain('width="144" height="144"');
		expect(window).toContain('stroke-linecap="round"');
		expect(renderWindowKey("maximize")).toContain(">Maximize<");
		expect(renderWindowKey("maximize")).not.toBe(window);
	});

	it("stays SVG-Tiny friendly with readable text", () => {
		for (const kind of ["window", "maximize"] as const) {
			const svg = renderWindowKey(kind);
			expect(svg).not.toMatch(/<(filter|foreignObject|mask|clipPath|style)\b/);
			for (const [, size] of svg.matchAll(/font-size="(\d+)"/g)) expect(Number(size)).toBeGreaterThanOrEqual(14);
		}
	});
});
