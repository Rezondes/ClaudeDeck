import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../com.claudedeck.streamdeck.sdPlugin/manifest.json", import.meta.url), "utf8"));

describe("manifest", () => {
	it("declares all ClaudeDeck actions", () => {
		const uuids = manifest.Actions.map((a: { UUID: string }) => a.UUID);
		for (const name of ["allow", "always", "deny", "status", "mode"]) {
			expect(uuids).toContain(`com.claudedeck.streamdeck.${name}`);
		}
	});

	it("manifest declares window actions", () => {
		for (const [name, label] of [["window", "Claude Window"], ["maximize", "Claude Maximize"]]) {
			const action = manifest.Actions.find((a: { UUID: string }) => a.UUID === `com.claudedeck.streamdeck.${name}`);
			expect(action?.Name).toBe(label);
			expect(action?.Icon).toBe(`imgs/actions/${name}/icon`);
			expect(action?.States[0].Image).toBe(`imgs/actions/${name}/key`);
			for (const file of ["icon.png", "icon@2x.png", "key.png", "key@2x.png"]) {
				expect(existsSync(new URL(`../com.claudedeck.streamdeck.sdPlugin/imgs/actions/${name}/${file}`, import.meta.url))).toBe(true);
			}
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
