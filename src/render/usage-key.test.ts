import { describe, expect, it } from "vitest";

import { CONTEXT_COLORS, STATE_COLORS } from "./colors.js";
import { renderUsageKey, renderUsageResetKey, resetLabel } from "./usage-key.js";

function expectSvgTiny(svg: string): void {
	expect(svg).toContain('width="144" height="144"');
	expect(svg).not.toMatch(/<(filter|foreignObject|mask|clipPath|style)\b/);
	expect(svg).not.toContain("<g opacity");
	expect(svg).not.toContain(" opacity=");
	for (const [, size] of svg.matchAll(/font-size="(\d+)"/g)) expect(Number(size)).toBeGreaterThanOrEqual(14);
}

describe("renderUsageKey", () => {
	it("renders both limits with colored bars", () => {
		const svg = renderUsageKey({ fiveHour: 42, sevenDay: 85 });
		expect(svg).toContain(">USAGE<");
		expect(svg).toContain(">5h<");
		expect(svg).toContain(">7d<");
		expect(svg).toMatch(new RegExp(`fill="${CONTEXT_COLORS.low}">42%<`));
		expect(svg).toMatch(new RegExp(`fill="${CONTEXT_COLORS.high}">85%<`));
		expect(svg).toContain(`width="${(108 * 42) / 100}" height="6" rx="3" fill="${CONTEXT_COLORS.low}"`);
		expect(svg).toContain(`width="${(108 * 85) / 100}" height="6" rx="3" fill="${CONTEXT_COLORS.high}"`);
		expect(renderUsageKey({ fiveHour: 50, sevenDay: null })).toMatch(new RegExp(`fill="${CONTEXT_COLORS.mid}">50%<`));
		expectSvgTiny(svg);
	});

	it("shows placeholders without data", () => {
		const svg = renderUsageKey({ fiveHour: null, sevenDay: null });
		expect(svg.match(/>--</g)).toHaveLength(2);
		expect(svg).not.toContain("%<");
		expectSvgTiny(svg);
	});
});

describe("renderUsageKey with the limit marker", () => {
	it("turns title and both rows red", () => {
		const svg = renderUsageKey({ fiveHour: 99, sevenDay: null, limit: true });
		expect(svg).toContain(">LIMIT<");
		expect(svg).not.toContain(">USAGE<");
		expect(svg).toMatch(new RegExp(`fill="${STATE_COLORS.error}">LIMIT<`));
		expect(svg).toMatch(new RegExp(`fill="${STATE_COLORS.error}">99%<`));
		expect(svg).toMatch(new RegExp(`fill="${STATE_COLORS.error}">--<`));
		expect(svg).toContain(`width="${(108 * 99) / 100}" height="6" rx="3" fill="${STATE_COLORS.error}"`);
		expectSvgTiny(svg);
	});
});

describe("renderUsageResetKey", () => {
	it("lists the reset times per limit", () => {
		const svg = renderUsageResetKey({ fiveHour: "23:50", sevenDay: null });
		expect(svg).toContain(">RESET<");
		expect(svg).toContain(">23:50<");
		expect(svg).toContain(">--<");
		expectSvgTiny(svg);
	});
});

describe("resetLabel", () => {
	// Local dates, so the test does not depend on the time zone. 2026-10-08 is a Thursday.
	const now = new Date(2026, 9, 8, 14, 0);
	it("shows the time today and the German weekday plus time later", () => {
		expect(resetLabel(new Date(2026, 9, 8, 23, 50), now)).toBe("23:50");
		expect(resetLabel(new Date(2026, 9, 9, 7, 5), now)).toBe("Fr 07:05");
		expect(resetLabel(new Date(2026, 9, 12, 0, 0), now)).toBe("Mo 00:00");
		expect(resetLabel(new Date(2026, 9, 11, 9, 30), now)).toBe("So 09:30");
	});
});
