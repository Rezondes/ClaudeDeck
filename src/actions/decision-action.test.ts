import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderDecisionKey, type DecisionKind } from "../render/decision-key.js";
import { toDataUrl } from "../render/status-key.js";
import { PendingApprovals, type PermissionRequestEvent } from "../server/pending-approvals.js";
import { DecisionKeys } from "./decision-action.js";
import type { KeyView } from "./key-view.js";

function request(sessionId: string, tool_input: Record<string, unknown> = { command: "npm test" }): PermissionRequestEvent {
	return { hook_event_name: "PermissionRequest", session_id: sessionId, transcript_path: "t", cwd: `F:\\Code\\${sessionId}`, tool_name: "Bash", tool_input };
}

function view(id: string) {
	return { id, setImage: vi.fn(), showAlert: vi.fn() } satisfies KeyView;
}

const image = (kind: DecisionKind, pending: Parameters<typeof renderDecisionKey>[0]["pending"], offline = false) =>
	toDataUrl(renderDecisionKey({ kind, pending, offline }));

describe("DecisionKeys", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("dim when no pending approval", () => {
		const keys = new DecisionKeys("allow", new PendingApprovals(), () => true);
		const key = view("k1");
		keys.appear(key);
		expect(key.setImage).toHaveBeenLastCalledWith(image("allow", null));
	});

	it("lights up on new pending approval", () => {
		const approvals = new PendingApprovals();
		const allow = new DecisionKeys("allow", approvals, () => true);
		const deny = new DecisionKeys("deny", approvals, () => true);
		const a = view("a");
		const d = view("d");
		allow.appear(a);
		deny.appear(d);
		approvals.add(request("web"), vi.fn());
		expect(a.setImage).toHaveBeenLastCalledWith(image("allow", { toolName: "Bash", toolInput: { command: "npm test" } }));
		expect(d.setImage).toHaveBeenLastCalledWith(image("deny", { toolName: "Bash", toolInput: { command: "npm test" } }));
	});

	it.each<[DecisionKind, "approve" | "approveAlways" | "deny"]>([
		["allow", "approve"],
		["always", "approveAlways"],
		["deny", "deny"],
	])("key press maps to queue decision: %s", (kind, method) => {
		const approvals = new PendingApprovals();
		const spy = vi.spyOn(approvals, method);
		const keys = new DecisionKeys(kind, approvals, () => true);
		approvals.add(request("web"), vi.fn());
		keys.press(view("k"));
		expect(spy).toHaveBeenCalledOnce();
	});

	it("shows next pending after decision", () => {
		const approvals = new PendingApprovals();
		const keys = new DecisionKeys("allow", approvals, () => true);
		const key = view("k");
		keys.appear(key);
		approvals.add(request("web", { command: "first" }), vi.fn());
		approvals.add(request("web", { command: "second" }), vi.fn());
		keys.press(key);
		expect(key.setImage).toHaveBeenLastCalledWith(image("allow", { toolName: "Bash", toolInput: { command: "second" } }));
		keys.press(key);
		expect(key.setImage).toHaveBeenLastCalledWith(image("allow", null));
	});

	it("adds project name when multiple pending", () => {
		const approvals = new PendingApprovals();
		const keys = new DecisionKeys("allow", approvals, () => true);
		const key = view("k");
		keys.appear(key);
		approvals.add(request("api-svc"), vi.fn());
		approvals.add(request("web"), vi.fn());
		expect(key.setImage).toHaveBeenLastCalledWith(image("allow", { toolName: "Bash", toolInput: { command: "npm test" }, project: "api-svc" }));
	});

	it("uses session title as project line", () => {
		const approvals = new PendingApprovals();
		const labelFor = vi.fn((sessionId: string, fallback: string) => (sessionId === "api-svc" ? "API Title" : fallback));
		const keys = new DecisionKeys("allow", approvals, () => true, labelFor);
		const key = view("k");
		keys.appear(key);
		approvals.add(request("api-svc"), vi.fn());
		approvals.add(request("web"), vi.fn());
		expect(labelFor).toHaveBeenLastCalledWith("api-svc", "api-svc");
		expect(key.setImage).toHaveBeenLastCalledWith(image("allow", { toolName: "Bash", toolInput: { command: "npm test" }, project: "API Title" }));
	});

	it("press without pending is a no-op", () => {
		const approvals = new PendingApprovals();
		const spy = vi.spyOn(approvals, "approve");
		const keys = new DecisionKeys("allow", approvals, () => true);
		const key = view("k");
		keys.press(key);
		expect(spy).not.toHaveBeenCalled();
		expect(key.showAlert).not.toHaveBeenCalled();
	});

	it("shows offline when server down", () => {
		const keys = new DecisionKeys("deny", new PendingApprovals(), () => false);
		const key = view("k");
		keys.appear(key);
		expect(key.setImage).toHaveBeenLastCalledWith(image("deny", null, true));
	});

	it("stops rendering keys that disappeared", () => {
		const approvals = new PendingApprovals();
		const keys = new DecisionKeys("allow", approvals, () => true);
		const key = view("k");
		keys.appear(key);
		keys.disappear("k");
		key.setImage.mockClear();
		approvals.add(request("web"), vi.fn());
		expect(key.setImage).not.toHaveBeenCalled();
	});
});
