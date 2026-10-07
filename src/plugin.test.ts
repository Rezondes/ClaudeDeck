import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../com.claudedeck.streamdeck.sdPlugin/manifest.json", import.meta.url), "utf8"));

describe("manifest", () => {
	it("declares all ClaudeDeck actions", () => {
		const uuids = manifest.Actions.map((a: { UUID: string }) => a.UUID);
		for (const name of ["allow", "always", "deny", "status", "mode"]) {
			expect(uuids).toContain(`com.claudedeck.streamdeck.${name}`);
		}
	});

	it("has no interrupt action (Package 10 No-Go, docs/spike-results.md)", () => {
		expect(manifest.Actions.map((a: { UUID: string }) => a.UUID)).not.toContain("com.claudedeck.streamdeck.interrupt");
	});

	it("targets Windows and Stream Deck 7.1+", () => {
		expect(manifest.UUID).toBe("com.claudedeck.streamdeck");
		expect(manifest.OS).toEqual([{ Platform: "windows", MinimumVersion: "10" }]);
		expect(manifest.Software.MinimumVersion).toBe("7.1");
	});
});
