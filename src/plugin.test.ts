import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../com.claudedeck.streamdeck.sdPlugin/manifest.json", import.meta.url), "utf8"));

describe("manifest", () => {
	it("declares all ClaudeDeck actions", () => {
		const uuids = manifest.Actions.map((a: { UUID: string }) => a.UUID);
		for (const name of ["allow", "always", "deny", "status"]) {
			expect(uuids).toContain(`com.claudedeck.streamdeck.${name}`);
		}
	});

	it("manifest has one window action", () => {
		const action = manifest.Actions.find((a: { UUID: string }) => a.UUID === "com.claudedeck.streamdeck.window");
		expect(action?.Name).toBe("Claude Window");
		expect(action?.Icon).toBe("imgs/actions/window/icon");
		expect(action?.States[0].Image).toBe("imgs/actions/window/key");
		for (const file of ["icon.png", "icon@2x.png", "key.png", "key@2x.png"]) {
			expect(existsSync(new URL(`../com.claudedeck.streamdeck.sdPlugin/imgs/actions/window/${file}`, import.meta.url))).toBe(true);
		}
		expect(manifest.Actions.map((a: { UUID: string }) => a.UUID)).not.toContain("com.claudedeck.streamdeck.maximize");
		expect(existsSync(new URL("../com.claudedeck.streamdeck.sdPlugin/imgs/actions/maximize", import.meta.url))).toBe(false);
	});

	it("manifest has the plan usage action", () => {
		const action = manifest.Actions.find((a: { UUID: string }) => a.UUID === "com.claudedeck.streamdeck.usage");
		expect(action?.Name).toBe("Plan Usage");
		expect(action?.Controllers).toEqual(["Keypad"]);
		expect(action?.Icon).toBe("imgs/actions/usage/icon");
		expect(action?.States[0].Image).toBe("imgs/actions/usage/key");
		for (const file of ["icon.png", "icon@2x.png", "key.png", "key@2x.png"]) {
			expect(existsSync(new URL(`../com.claudedeck.streamdeck.sdPlugin/imgs/actions/usage/${file}`, import.meta.url))).toBe(true);
		}
	});

	it("manifest has the project action with its property inspector", () => {
		const action = manifest.Actions.find((a: { UUID: string }) => a.UUID === "com.claudedeck.streamdeck.project");
		expect(action?.Name).toBe("Claude Project");
		expect(action?.PropertyInspectorPath).toBe("ui/project.html");
		expect(existsSync(new URL("../com.claudedeck.streamdeck.sdPlugin/ui/project.html", import.meta.url))).toBe(true);
		for (const file of ["icon.png", "icon@2x.png", "key.png", "key@2x.png"]) {
			expect(existsSync(new URL(`../com.claudedeck.streamdeck.sdPlugin/imgs/actions/project/${file}`, import.meta.url))).toBe(true);
		}
	});

	it("manifest has the reload action", () => {
		const action = manifest.Actions.find((a: { UUID: string }) => a.UUID === "com.claudedeck.streamdeck.reload");
		expect(action?.Name).toBe("Claude Reload");
		expect(action?.Controllers).toEqual(["Keypad"]);
		expect(action?.Icon).toBe("imgs/actions/reload/icon");
		expect(action?.States[0].Image).toBe("imgs/actions/reload/key");
		for (const file of ["icon.png", "icon@2x.png", "key.png", "key@2x.png"]) {
			expect(existsSync(new URL(`../com.claudedeck.streamdeck.sdPlugin/imgs/actions/reload/${file}`, import.meta.url))).toBe(true);
		}
	});

	it("has no interrupt action (Package 10 No-Go, docs/spike-results.md)", () => {
		expect(manifest.Actions.map((a: { UUID: string }) => a.UUID)).not.toContain("com.claudedeck.streamdeck.interrupt");
	});

	it("has no permission mode action (Package 18)", () => {
		expect(manifest.Actions.map((a: { UUID: string }) => a.UUID)).not.toContain("com.claudedeck.streamdeck.mode");
	});

	it("targets Windows and Stream Deck 7.1+", () => {
		expect(manifest.UUID).toBe("com.claudedeck.streamdeck");
		expect(manifest.OS).toEqual([{ Platform: "windows", MinimumVersion: "10" }]);
		expect(manifest.Software.MinimumVersion).toBe("7.1");
	});
});
