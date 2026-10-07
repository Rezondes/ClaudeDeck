import { describe, expect, it } from "vitest";

import { renderModeKey } from "./mode-key.js";

describe("renderModeKey", () => {
	it("pending shows the target mode on a lit key", () => {
		const svg = renderModeKey({ mode: "plan", pending: true, currentMode: "default" });
		expect(svg).toContain("Allow +");
		expect(svg).toContain(">Plan<");
		expect(svg).toContain('fill="#2F7BFF"/>');
		expect(renderModeKey({ mode: "plan", pending: true, currentMode: undefined, project: "api-svc" })).toContain(">api-svc<");
	});

	it("idle shows the current mode dimmed and the target below", () => {
		const svg = renderModeKey({ mode: "acceptEdits", pending: false, currentMode: "default" });
		expect(svg).toContain(">Default<");
		expect(svg).toContain(">to Edits<");
		expect(svg).not.toContain("Allow +");
	});

	it("idle without a known mode shows a placeholder and escapes unknown modes", () => {
		expect(renderModeKey({ mode: "acceptEdits", pending: false, currentMode: undefined })).toContain(">--<");
		expect(renderModeKey({ mode: "acceptEdits", pending: false, currentMode: "<x>" })).toContain("&lt;x&gt;");
	});
});
