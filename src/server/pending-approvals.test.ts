import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PendingApprovals, type PermissionRequestEvent } from "./pending-approvals.js";

function request(sessionId: string, extra: Partial<PermissionRequestEvent> = {}): PermissionRequestEvent {
	return {
		hook_event_name: "PermissionRequest",
		session_id: sessionId,
		transcript_path: "t.jsonl",
		cwd: `F:\\Code\\${sessionId}`,
		tool_name: "Bash",
		tool_input: { command: "npm test" },
		...extra,
	};
}

const allow = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };

describe("PendingApprovals", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("resolves oldest request first", () => {
		const approvals = new PendingApprovals();
		const a = vi.fn();
		const b = vi.fn();
		approvals.add(request("a"), a);
		approvals.add(request("b"), b);
		approvals.approve();
		expect(a).toHaveBeenCalledWith(allow);
		expect(b).not.toHaveBeenCalled();
		expect(approvals.oldest()?.sessionId).toBe("b");
	});

	it("deny resolves with deny and message", () => {
		const approvals = new PendingApprovals();
		const respond = vi.fn();
		approvals.add(request("a"), respond);
		approvals.deny();
		expect(respond).toHaveBeenCalledWith({
			hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Denied via ClaudeDeck" } },
		});
	});

	it("always uses session-scoped suggestions but never setMode", () => {
		const approvals = new PendingApprovals();
		const withSuggestions = vi.fn();
		const without = vi.fn();
		approvals.add(
			request("a", {
				permission_suggestions: [
					{ type: "addDirectories", directories: ["C:\\tmp"], destination: "session" },
					{ type: "setMode", mode: "acceptEdits", destination: "session" },
					{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" },
				],
			}),
			withSuggestions,
		);
		approvals.add(request("b", { tool_name: "WebFetch", permission_suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] }), without);
		approvals.approveAlways();
		approvals.approveAlways();
		expect(withSuggestions.mock.calls[0][0].hookSpecificOutput.decision).toEqual({
			behavior: "allow",
			updatedPermissions: [
				{ type: "addDirectories", directories: ["C:\\tmp"], destination: "session" },
				{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "session" },
			],
		});
		expect(without.mock.calls[0][0].hookSpecificOutput.decision).toEqual({
			behavior: "allow",
			updatedPermissions: [{ type: "addRules", rules: [{ toolName: "WebFetch" }], behavior: "allow", destination: "session" }],
		});
	});

	it("approveWithMode adds session setMode", () => {
		const approvals = new PendingApprovals();
		const respond = vi.fn();
		approvals.add(request("a"), respond);
		approvals.approveWithMode("plan");
		expect(respond).toHaveBeenCalledWith({
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "allow", updatedPermissions: [{ type: "setMode", mode: "plan", destination: "session" }] },
			},
		});
	});

	it("times out after 60s with empty decision", () => {
		const approvals = new PendingApprovals();
		const respond = vi.fn();
		approvals.add(request("a"), respond);
		vi.advanceTimersByTime(59_999);
		expect(respond).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(respond).toHaveBeenCalledWith({});
		expect(approvals.oldest()).toBeUndefined();
	});

	it("cancel removes request without responding", () => {
		const approvals = new PendingApprovals();
		const respond = vi.fn();
		const id = approvals.add(request("a"), respond);
		approvals.cancel(id);
		expect(approvals.oldest()).toBeUndefined();
		vi.advanceTimersByTime(60_000);
		expect(respond).not.toHaveBeenCalled();
	});

	it("reports every settled request once, whatever ended it", () => {
		const approvals = new PendingApprovals();
		const settled = vi.fn();
		approvals.onSettled(settled);
		approvals.add(request("a"), vi.fn());
		approvals.add(request("b"), vi.fn());
		const c = approvals.add(request("c"), vi.fn());
		approvals.add(request("d"), vi.fn());
		approvals.approve();
		approvals.deny();
		approvals.cancel(c);
		vi.advanceTimersByTime(60_000);
		expect(settled.mock.calls.map((call) => call[0])).toEqual(["a", "b", "c", "d"]);
	});

	it("notifies change listeners on add and settle", () => {
		const approvals = new PendingApprovals();
		const changed = vi.fn();
		approvals.onChange(changed);
		approvals.add(request("a"), vi.fn());
		approvals.approve();
		expect(changed).toHaveBeenCalledTimes(2);
	});

	it("no-op on empty queue", () => {
		const approvals = new PendingApprovals();
		const changed = vi.fn();
		approvals.onChange(changed);
		expect(() => {
			approvals.approve();
			approvals.approveAlways();
			approvals.deny();
			approvals.cancel(42);
		}).not.toThrow();
		expect(changed).not.toHaveBeenCalled();
	});

	it("exposes tool, input, project and count of the oldest request", () => {
		const approvals = new PendingApprovals();
		approvals.add(request("api-svc", { tool_name: "Edit", tool_input: { file_path: "a.ts" } }), vi.fn());
		approvals.add(request("web"), vi.fn());
		expect(approvals.oldest()).toMatchObject({ sessionId: "api-svc", project: "api-svc", toolName: "Edit", toolInput: { file_path: "a.ts" } });
		expect(approvals.count).toBe(2);
	});
});
