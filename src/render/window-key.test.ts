import { describe, expect, it } from "vitest";

import { renderWindowKey } from "./window-key.js";

describe("renderWindowKey", () => {
	it("draws the next action as a labelled stroke symbol on a dark key", () => {
		const minimize = renderWindowKey("minimize");
		const maximize = renderWindowKey("maximize");
		expect(minimize).toContain(">Minimize<");
		expect(maximize).toContain(">Maximize<");
		expect(minimize).toContain('width="144" height="144"');
		expect(minimize).toContain('stroke-linecap="round"');
		expect(minimize.replace("Minimize", "")).not.toBe(maximize.replace("Maximize", ""));
	});

	it("dims the key without a desktop window", () => {
		const none = renderWindowKey("none");
		expect(none).toContain(">No window<");
		expect(none).toContain('stroke-opacity="0.25"');
		expect(none).toContain('fill-opacity="0.4"');
		expect(renderWindowKey("maximize")).not.toContain('stroke-opacity="0.25"');
	});

	it("stays SVG-Tiny friendly with readable text", () => {
		for (const kind of ["minimize", "maximize", "none"] as const) {
			const svg = renderWindowKey(kind);
			expect(svg).not.toMatch(/<(filter|foreignObject|mask|clipPath|style)\b/);
			// Group and bare opacity are not SVG Tiny 1.2; Stream Deck ignores them.
			expect(svg).not.toContain("<g opacity");
			expect(svg).not.toContain(" opacity=");
			for (const [, size] of svg.matchAll(/font-size="(\d+)"/g)) expect(Number(size)).toBeGreaterThanOrEqual(14);
		}
	});
});
