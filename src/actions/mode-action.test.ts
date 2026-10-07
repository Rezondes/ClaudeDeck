import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HookEvent } from "../domain/hook-event.js";
import { SessionStore } from "../domain/session-store.js";
import { renderModeKey } from "../render/mode-key.js";
import { toDataUrl } from "../render/status-key.js";
import { PendingApprovals, type PermissionRequestEvent } from "../server/pending-approvals.js";
import { MODE_OPTIONS, ModeKeys } from "./mode-action.js";

const request = (sessionId: string): PermissionRequestEvent => ({
	hook_event_name: "PermissionRequest",
	session_id: sessionId,
	transcript_path: "t",
	cwd: `F:\\Code\\${sessionId}`,
	tool_name: "Edit",
	tool_input: { file_path: "a.ts" },
});

const event = (sessionId: string, permission_mode: string): HookEvent => ({
	hook_event_name: "UserPromptSubmit",
	session_id: sessionId,
	transcript_path: "t",
	cwd: `F:\\Code\\${sessionId}`,
	permission_mode,
});

const view = (id: string) => ({ id, setImage: vi.fn(), showAlert: vi.fn() });

function setup() {
	let now = 0;
	const store = new SessionStore(() => now);
	const approvals = new PendingApprovals();
	const keys = new ModeKeys(approvals, store);
	return { store, approvals, keys, advance: (ms: number) => (now += ms) };
}

describe("ModeKeys", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("press with pending request allows it and switches the session to the configured mode", () => {
		const { approvals, keys } = setup();
		const respond = vi.fn();
		const key = view("k");
		keys.appear(key, { mode: "plan" });
		approvals.add(request("web"), respond);
		keys.press(key);
		expect(respond).toHaveBeenCalledWith({
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "allow", updatedPermissions: [{ type: "setMode", mode: "plan", destination: "session" }] },
			},
		});
	});

	it("defaults to acceptEdits and lights up while a request is pending", () => {
		const { approvals, keys } = setup();
		const key = view("k");
		keys.appear(key, {});
		approvals.add(request("web"), vi.fn());
		expect(key.setImage).toHaveBeenLastCalledWith(toDataUrl(renderModeKey({ mode: "acceptEdits", pending: true, currentMode: undefined, project: "web" })));
	});

	it("dim without pending and shows current mode of the most recently active session", () => {
		const { store, approvals, keys, advance } = setup();
		const respond = vi.fn();
		const key = view("k");
		keys.appear(key, {});
		store.handle(event("a", "default"));
		advance(1000);
		store.handle(event("b", "acceptEdits"));
		expect(key.setImage).toHaveBeenLastCalledWith(toDataUrl(renderModeKey({ mode: "acceptEdits", pending: false, currentMode: "acceptEdits" })));
		keys.press(key);
		expect(respond).not.toHaveBeenCalled();
		expect(approvals.count).toBe(0);
	});

	it("inspector offers no bypassPermissions", () => {
		expect(MODE_OPTIONS).toEqual(["acceptEdits", "plan", "default"]);
		const html = readFileSync(new URL("../../com.claudedeck.streamdeck.sdPlugin/ui/mode.html", import.meta.url), "utf8");
		const values = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
		expect(values).toEqual([...MODE_OPTIONS]);
	});

	it("ignores a bypassPermissions setting even if it was stored", () => {
		const { approvals, keys } = setup();
		const respond = vi.fn();
		const key = view("k");
		keys.appear(key, { mode: "bypassPermissions" });
		approvals.add(request("web"), respond);
		keys.press(key);
		expect(respond.mock.calls[0][0].hookSpecificOutput.decision.updatedPermissions[0].mode).toBe("acceptEdits");
	});

	it("settings change updates the mode", () => {
		const { approvals, keys } = setup();
		const respond = vi.fn();
		const key = view("k");
		keys.appear(key, {});
		keys.settingsChanged("k", { mode: "default" });
		approvals.add(request("web"), respond);
		keys.press(key);
		expect(respond.mock.calls[0][0].hookSpecificOutput.decision.updatedPermissions[0].mode).toBe("default");
	});
});
