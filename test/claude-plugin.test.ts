import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { APPROVAL_TIMEOUT_SECONDS, HOOK_BASE_URL, HOOK_EVENTS, MODULE_BASE_URL, MODULE_EVENTS } from "../src/server/hook-contract";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const hooks = readJson("claude-plugin/hooks/hooks.json").hooks;
const plugin = readJson("claude-plugin/.claude-plugin/plugin.json");
const marketplace = readJson(".claude-plugin/marketplace.json");

type HookEntry = { hooks: { type: string; url: string; timeout: number }[] };

describe("claude code plugin", () => {
	it("hooks.json registers every required event once", () => {
		// Independent of HOOK_EVENTS: the events verified in docs/spike-results.md (AC0).
		const verified = ["UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop", "SessionEnd"];
		expect(Object.keys(hooks).sort()).toEqual(verified.sort());
		expect([...HOOK_EVENTS].sort()).toEqual(verified.sort());
		expect(hooks).not.toHaveProperty("SessionStart");
		for (const entries of Object.values(hooks) as HookEntry[][]) {
			expect(entries).toHaveLength(1);
			expect(entries[0].hooks).toHaveLength(1);
		}
	});

	it("every hook url matches its event and the shared contract", () => {
		for (const [event, entries] of Object.entries(hooks) as [string, HookEntry[]][]) {
			const hook = entries[0].hooks[0];
			expect(hook.type).toBe("http");
			expect(hook.url).toBe(`${HOOK_BASE_URL}/${event}`);
		}
	});

	it("timeouts are 65s for PermissionRequest and 5s otherwise", () => {
		for (const [event, entries] of Object.entries(hooks) as [string, HookEntry[]][]) {
			expect(entries[0].hooks[0].timeout).toBe(event === "PermissionRequest" ? APPROVAL_TIMEOUT_SECONDS + 5 : 5);
		}
	});

	it("plugin and marketplace manifests are consistent", () => {
		expect(plugin.name).toBe("claudedeck");
		expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(plugin.description).toBeTruthy();
		expect(marketplace.plugins).toHaveLength(1);
		expect(marketplace.plugins[0].name).toBe(plugin.name);
		expect(marketplace.plugins[0].source).toBe("./claude-plugin");
	});

	it("the plugin module posts to the module endpoints of the shared contract", () => {
		const source = readFileSync(new URL("../claude-module/hooks/register.ts", import.meta.url), "utf8");
		expect(source).toContain(`'${MODULE_BASE_URL}'`);
		for (const event of MODULE_EVENTS) expect(source).toContain(`'${event}'`);
	});
});
