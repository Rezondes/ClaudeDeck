import { describe, expect, it } from "vitest";
import { CONTEXT_COLORS, DECISION_COLORS, STATE_COLORS, contextColor } from "./colors";
import { commandPreview, renderDecisionKey } from "./decision-key";
import { renderEmptyStatusKey, renderStatusKey, toDataUrl, type StatusState } from "./status-key";

const LABELS: Record<StatusState, string> = {
	working: "Working",
	approval: "Approve",
	input: "Input",
	done: "Done",
	idle: "Idle",
};

describe("render", () => {
	it.each(Object.keys(LABELS) as StatusState[])("status key renders each state (%s)", (state) => {
		const svg = renderStatusKey({ project: "ClaudeDeck", state, contextPercent: 42 });
		expect(svg).toMatch(/^<svg [^>]*width="144" height="144"/);
		expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
		expect(svg).toContain(">ClaudeDeck<");
		expect(svg).toContain(`>${LABELS[state]}<`);
		expect(svg).toContain(">42%<");
		expect(svg).toContain(STATE_COLORS[state]);
		expect(svg).toMatchSnapshot();
	});

	it("context color thresholds", () => {
		expect(contextColor(0)).toBe(CONTEXT_COLORS.low);
		expect(contextColor(49)).toBe(CONTEXT_COLORS.low);
		expect(contextColor(50)).toBe(CONTEXT_COLORS.mid);
		expect(contextColor(79)).toBe(CONTEXT_COLORS.mid);
		expect(contextColor(80)).toBe(CONTEXT_COLORS.high);
		expect(contextColor(100)).toBe(CONTEXT_COLORS.high);
		expect(renderStatusKey({ project: "p", state: "working", contextPercent: 85 })).toContain(`fill="${CONTEXT_COLORS.high}">85%<`);
	});

	it("null context shows placeholder", () => {
		const svg = renderStatusKey({ project: "p", state: "working", contextPercent: null });
		expect(svg).toContain(">--<");
		expect(svg).not.toContain('id="bar"');
		expect(renderStatusKey({ project: "p", state: "working", contextPercent: 10 })).toContain('id="bar"');
	});

	it("truncates and escapes project names", () => {
		expect(renderStatusKey({ project: "ClaudeDeckPlugin", state: "idle", contextPercent: 1 })).toContain(">ClaudeDec…<");
		expect(renderStatusKey({ project: "TenCharsOk", state: "idle", contextPercent: 1 })).toContain(">TenCharsOk<");
		const svg = renderStatusKey({ project: "a<b&c\"'", state: "idle", contextPercent: 1 });
		expect(svg).toContain(">a&lt;b&amp;c&quot;&apos;<");
		expect(svg).not.toContain("a<b");
	});

	it("empty status key has no text", () => {
		const svg = renderEmptyStatusKey();
		expect(svg).toMatch(/^<svg [^>]*width="144" height="144"/);
		expect(svg).not.toContain("<text");
		expect(svg).toMatchSnapshot();
	});

	it("decision key idle vs pending", () => {
		for (const kind of ["allow", "always", "deny"] as const) {
			const idle = renderDecisionKey({ kind, pending: null });
			expect(idle).toContain(DECISION_COLORS[kind]);
			expect(idle).not.toContain("Bash");
			expect(idle).toMatchSnapshot(`${kind} idle`);
			const pending = renderDecisionKey({ kind, pending: { toolName: "Bash", toolInput: { command: "npm test" } } });
			expect(pending).toContain(`fill="${DECISION_COLORS[kind]}"`);
			expect(pending).toContain(">Bash npm test<");
			expect(pending).toMatchSnapshot(`${kind} pending`);
		}
		const allow = renderDecisionKey({ kind: "allow", pending: null });
		const always = renderDecisionKey({ kind: "always", pending: null });
		const deny = renderDecisionKey({ kind: "deny", pending: null });
		expect(allow).toContain('class="check"');
		expect(always).toContain('class="check"');
		expect(always).toContain(">∞<");
		expect(deny).toContain('class="cross"');
		expect(deny).not.toContain('class="check"');
		expect(deny).toContain(">Deny<");
		for (const svg of [allow, always, deny]) expect(svg).not.toMatch(/[✓✕]/);
	});

	it("always pending uses dark foreground on amber", () => {
		const pending = { toolName: "Bash", toolInput: { command: "ls" } };
		expect(renderDecisionKey({ kind: "always", pending })).toContain('fill="#1A1A1A">Always<');
		expect(renderDecisionKey({ kind: "always", pending })).not.toContain("#FFFFFF");
		expect(renderDecisionKey({ kind: "allow", pending })).toContain('fill="#FFFFFF">Allow<');
		expect(renderDecisionKey({ kind: "deny", pending })).toContain('fill="#FFFFFF">Deny<');
	});

	it("small text lines are at least 14px", () => {
		const svgs = [
			renderDecisionKey({ kind: "allow", pending: { toolName: "Bash", toolInput: { command: "ls" }, project: "api" } }),
			renderDecisionKey({ kind: "allow", pending: null, offline: true }),
			renderStatusKey({ project: "ClaudeDeck", state: "approval", contextPercent: 100 }),
		];
		for (const svg of svgs) {
			for (const [, size] of svg.matchAll(/font-size="(\d+)"/g)) expect(Number(size)).toBeGreaterThanOrEqual(14);
		}
	});

	it("uses only SVG Tiny friendly features", () => {
		const svgs = [
			renderStatusKey({ project: "p", state: "working", contextPercent: 50 }),
			renderStatusKey({ project: "p", state: "working", contextPercent: 50, flash: true }),
			renderEmptyStatusKey(),
			...(["allow", "always", "deny"] as const).flatMap((kind) => [
				renderDecisionKey({ kind, pending: null, offline: true }),
				renderDecisionKey({ kind, pending: { toolName: "Bash", toolInput: { command: "ls" }, project: "x" } }),
			]),
		];
		for (const svg of svgs) {
			expect(svg).not.toMatch(/filter|feGaussianBlur|\sopacity=/);
		}
	});

	it("does not crash on emoji and strips control chars", () => {
		expect(() => toDataUrl(renderDecisionKey({ kind: "allow", pending: { toolName: "Bash", toolInput: { command: "echo 12345🎉 done" } } }))).not.toThrow();
		expect(() => toDataUrl(renderStatusKey({ project: "Projekt1🎉xy", state: "idle", contextPercent: 1 }))).not.toThrow();
		expect(renderStatusKey({ project: "Projekt1🎉xy", state: "idle", contextPercent: 1 })).toContain(">Projekt1🎉…<");
		expect(renderStatusKey({ project: "a\x01b\x1Fc", state: "idle", contextPercent: 1 })).toContain(">abc<");
	});

	it("project font size depends on name length", () => {
		expect(renderStatusKey({ project: "Deck", state: "idle", contextPercent: 1 })).toContain('font-size="21" font-weight="700" fill="#FFFFFF">Deck<');
		expect(renderStatusKey({ project: "ClaudeDeck", state: "idle", contextPercent: 1 })).toContain('font-size="17" font-weight="700" fill="#FFFFFF">ClaudeDeck<');
	});

	it("NaN context is treated as null", () => {
		const svg = renderStatusKey({ project: "p", state: "idle", contextPercent: Number.NaN });
		expect(svg).toContain(">--<");
		expect(svg).not.toContain('id="bar"');
	});

	it("decision key shows project line and escapes", () => {
		const svg = renderDecisionKey({ kind: "allow", pending: { toolName: "Bash", toolInput: { command: "a<b" }, project: "api-svc" } });
		expect(svg).toContain(">Bash a&lt;b<");
		expect(svg).toContain(">api-svc<");
		expect(svg).toMatchSnapshot();
	});

	it("decision key shows offline when idle", () => {
		expect(renderDecisionKey({ kind: "allow", pending: null, offline: true })).toContain(">offline<");
		expect(renderDecisionKey({ kind: "allow", pending: null })).not.toContain("offline");
	});

	it("command preview per tool", () => {
		expect(commandPreview("Bash", { command: "npm test" })).toBe("npm test");
		expect(commandPreview("Edit", { file_path: "F:\\Code\\ClaudeDeck\\src\\plugin.ts" })).toBe("plugin.ts");
		expect(commandPreview("Write", { file_path: "/home/x/notes.md" })).toBe("notes.md");
		expect(commandPreview("Read", { file_path: "C:\\a\\b.txt" })).toBe("b.txt");
		expect(commandPreview("Bash", { command: "npm run build:all" })).toBe("npm run bui…");
		expect(commandPreview("Bash", { command: "npm run bui" })).toBe("npm run bui");
		expect(commandPreview("Grep", { pattern: "x" })).toBe("");
		expect(commandPreview("Bash", {})).toBe("");
	});

	it("flash frame differs only in border", () => {
		const input = { project: "p", state: "approval", contextPercent: 30 } as const;
		const normal = renderStatusKey(input);
		const flash = renderStatusKey({ ...input, flash: true });
		expect(flash).not.toBe(normal);
		expect(flash).not.toContain('filter="url(#glow)"');
		expect(flash).toContain('stroke="#FFFFFF"');
		const withoutBorder = (svg: string) => svg.split("\n").filter((l) => !l.includes('class="border"')).join("\n");
		expect(withoutBorder(flash)).toBe(withoutBorder(normal));
	});

	it("toDataUrl encodes svg", () => {
		expect(toDataUrl("<svg a=\"1\"/>")).toBe("data:image/svg+xml;charset=utf8,%3Csvg%20a%3D%221%22%2F%3E");
	});
});
