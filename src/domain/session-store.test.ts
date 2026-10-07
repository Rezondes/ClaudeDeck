import { describe, expect, it } from "vitest";
import type { HookEvent } from "./hook-event.js";
import { SessionStore, type SessionState } from "./session-store.js";

function event(hook_event_name: HookEvent["hook_event_name"], extra: Partial<HookEvent> = {}): HookEvent {
	return {
		hook_event_name,
		session_id: "s1",
		transcript_path: "C:\\Users\\me\\.claude\\projects\\x\\s1.jsonl",
		cwd: "F:\\Code\\ClaudeDeck",
		permission_mode: "default",
		...extra,
	};
}

/** Brings session s1 into the given state. */
const enter: Record<Exclude<SessionState, "idle">, HookEvent> = {
	working: event("UserPromptSubmit"),
	approval: event("PermissionRequest", { tool_name: "Bash" }),
	input: event("PreToolUse", { tool_name: "AskUserQuestion" }),
	done: event("Stop"),
};

describe("SessionStore", () => {
	it.each<[Exclude<SessionState, "idle">, HookEvent, SessionState]>([
		["done", event("UserPromptSubmit"), "working"],
		["done", event("PreToolUse", { tool_name: "Bash" }), "working"],
		["input", event("PostToolUse", { tool_name: "Bash" }), "working"],
		["working", event("PreToolUse", { tool_name: "AskUserQuestion" }), "input"],
		["working", event("Notification", { notification_type: "elicitation_dialog" }), "input"],
		["working", event("Notification", { notification_type: "agent_needs_input" }), "input"],
		["working", event("PermissionRequest", { tool_name: "Bash" }), "approval"],
		["working", event("Stop"), "done"],
	])("maps each hook event to its session state: %s + %o", (from, e, expected) => {
		const store = new SessionStore(() => 0);
		store.handle(enter[from]);
		expect(store.get("s1")?.state).toBe(from);
		store.handle(e);
		expect(store.get("s1")?.state).toBe(expected);
	});

	it("maps approval decided from approval to working", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.approval);
		store.approvalDecided("s1");
		expect(store.get("s1")?.state).toBe("working");
	});

	it("approval stays while other tools of the same session report events", () => {
		// Parallel subagents share the parent session_id.
		const store = new SessionStore(() => 0);
		store.handle(enter.approval);
		for (const e of [event("PreToolUse", { tool_name: "Read" }), event("PostToolUse", { tool_name: "Read" }), event("Stop")]) {
			store.handle(e);
			expect(store.get("s1")?.state).toBe("approval");
		}
		store.approvalDecided("s1");
		expect(store.get("s1")?.state).toBe("done");
	});

	it("needs one decision per pending approval", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.approval);
		store.handle(enter.approval);
		store.approvalDecided("s1");
		expect(store.get("s1")?.state).toBe("approval");
		store.approvalDecided("s1");
		expect(store.get("s1")?.state).toBe("working");
	});

	it("maps key pressed from done to idle", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.done);
		store.keyPressed("s1");
		expect(store.get("s1")?.state).toBe("idle");
	});

	it("key pressed leaves other states alone", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.approval);
		store.keyPressed("s1");
		expect(store.get("s1")?.state).toBe("approval");
	});

	it("SessionEnd removes the session", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.working);
		store.handle(event("SessionEnd", { permission_mode: undefined }));
		expect(store.get("s1")).toBeUndefined();
	});

	it("assigns slots in start order and reuses freed slots", () => {
		const store = new SessionStore(() => 0);
		for (const id of ["A", "B", "C"]) {
			store.handle(event("UserPromptSubmit", { session_id: id }));
		}
		store.handle(event("SessionEnd", { session_id: "B" }));
		store.handle(event("UserPromptSubmit", { session_id: "D" }));
		expect([store.get("A")?.slot, store.get("C")?.slot, store.get("D")?.slot]).toEqual([0, 2, 1]);
	});

	it("pinned cwd always gets its slot", () => {
		const store = new SessionStore(() => 0);
		store.setPins(new Map([[0, "F:\\Code\\api-svc"]]));
		store.handle(event("UserPromptSubmit", { session_id: "web", cwd: "F:\\Code\\web-app" }));
		store.handle(event("UserPromptSubmit", { session_id: "api", cwd: "F:\\Code\\api-svc" }));
		expect([store.get("web")?.slot, store.get("api")?.slot]).toEqual([1, 0]);
	});

	it("setPins moves running sessions into their pinned slot and the occupant out of it", () => {
		// The status key settings arrive after the hook server already created sessions.
		const store = new SessionStore(() => 0);
		const changed: string[] = [];
		store.onChange((id) => changed.push(id));
		store.handle(event("UserPromptSubmit", { session_id: "web", cwd: "F:\\Code\\web-app" }));
		store.handle(event("UserPromptSubmit", { session_id: "api", cwd: "F:\\Code\\api-svc" }));
		changed.length = 0;
		store.setPins(new Map([[0, "F:\\Code\\api-svc"]]));
		expect([store.get("api")?.slot, store.get("web")?.slot]).toEqual([0, 1]);
		expect(changed.sort()).toEqual(["api", "web"]);
	});

	it("lists all sessions", () => {
		const store = new SessionStore(() => 0);
		store.handle(event("UserPromptSubmit", { session_id: "a" }));
		store.handle(event("UserPromptSubmit", { session_id: "b" }));
		expect(store.sessions().map((s) => s.id)).toEqual(["a", "b"]);
	});

	it("pinned cwd matches case-insensitively and ignores a trailing backslash", () => {
		const store = new SessionStore(() => 0);
		store.setPins(new Map([[2, "f:\\code\\API-SVC\\"]]));
		store.handle(event("UserPromptSubmit", { session_id: "api", cwd: "F:\\Code\\api-svc" }));
		expect(store.get("api")?.slot).toBe(2);
	});

	it("pinned cwd matches with forward slashes", () => {
		const store = new SessionStore(() => 0);
		store.setPins(new Map([[3, "F:/Code/api-svc"]]));
		store.handle(event("UserPromptSubmit", { session_id: "api", cwd: "F:\\Code\\api-svc" }));
		expect(store.get("api")?.slot).toBe(3);
	});

	it("creates unknown session implicitly", () => {
		const store = new SessionStore(() => 0);
		store.handle(event("PreToolUse", { session_id: "x", tool_name: "Bash", permission_mode: "acceptEdits" }));
		expect(store.get("x")).toMatchObject({
			id: "x",
			state: "working",
			cwd: "F:\\Code\\ClaudeDeck",
			transcriptPath: "C:\\Users\\me\\.claude\\projects\\x\\s1.jsonl",
			permissionMode: "acceptEdits",
		});
	});

	it("keeps the last known permission mode when an event has none", () => {
		const store = new SessionStore(() => 0);
		store.handle(event("UserPromptSubmit", { permission_mode: "plan" }));
		store.handle(event("Notification", { permission_mode: undefined, notification_type: "idle_prompt" }));
		expect(store.get("s1")?.permissionMode).toBe("plan");
	});

	it("done turns idle after 10 minutes", () => {
		let now = 0;
		const store = new SessionStore(() => now);
		store.handle(enter.done);
		now = 599_999;
		store.tick();
		expect(store.get("s1")?.state).toBe("done");
		now = 600_000;
		store.tick();
		expect(store.get("s1")?.state).toBe("idle");
	});

	it("done timer counts from the Stop event, not from earlier events", () => {
		let now = 0;
		const store = new SessionStore(() => now);
		store.handle(enter.working);
		now = 500_000;
		store.handle(enter.done);
		now = 1_000_000;
		store.tick();
		expect(store.get("s1")?.state).toBe("done");
	});

	it.each(["F:\\Code\\ClaudeDeck", "F:\\Code\\ClaudeDeck\\"])("project name is last cwd segment: %s", (cwd) => {
		const store = new SessionStore(() => 0);
		store.handle(event("UserPromptSubmit", { cwd }));
		expect(store.get("s1")?.projectName).toBe("ClaudeDeck");
	});

	it("notifies listener once per real change", () => {
		const store = new SessionStore(() => 0);
		const changed: string[] = [];
		store.onChange((id) => changed.push(id));
		store.handle(event("PreToolUse", { tool_name: "Bash" }));
		store.handle(event("PreToolUse", { tool_name: "Bash" }));
		expect(changed).toEqual(["s1"]);
	});

	it("notifies for approval decided, key pressed, timeout and SessionEnd, not for no-ops", () => {
		let now = 0;
		const store = new SessionStore(() => now);
		const changed: string[] = [];
		store.handle(enter.approval);
		store.onChange((id) => changed.push(id));
		store.keyPressed("s1");
		store.approvalDecided("s1");
		store.handle(enter.done);
		store.keyPressed("s1");
		store.handle(enter.done);
		now = 600_000;
		store.tick();
		store.tick();
		store.handle(event("SessionEnd"));
		store.handle(event("SessionEnd"));
		expect(changed).toHaveLength(6);
	});

	it("remove deletes a session and notifies once", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.done);
		const changed: string[] = [];
		store.onChange((id) => changed.push(id));
		store.remove("s1");
		store.remove("s1");
		expect(store.get("s1")).toBeUndefined();
		expect(changed).toEqual(["s1"]);
	});

	it("seed creates idle sessions newest first and keeps known ones", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.done);
		const changed: string[] = [];
		store.onChange((id) => changed.push(id));
		const entry = (sessionId: string, lastActivityAt: number) => ({ sessionId, cwd: `F:\\Code\\${sessionId}`, transcriptPath: `${sessionId}.jsonl`, lastActivityAt });
		store.seed([entry("old", 100), entry("s1", 300), entry("new", 200)]);
		expect(store.get("new")).toMatchObject({ slot: 1, state: "idle", baseState: "idle", projectName: "new", transcriptPath: "new.jsonl", lastEventAt: 200 });
		expect(store.get("old")).toMatchObject({ slot: 2, state: "idle" });
		expect(store.get("s1")).toMatchObject({ slot: 0, state: "done", cwd: "F:\\Code\\ClaudeDeck" });
		expect(changed).toEqual(["new", "old"]);

		// A later hook event of a seeded session updates that same session.
		store.handle(event("UserPromptSubmit", { session_id: "new", cwd: "F:\\Code\\new" }));
		expect(store.sessions()).toHaveLength(3);
		expect(store.get("new")).toMatchObject({ slot: 1, state: "working" });
	});

	it("setTitles updates titles and notifies", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.working);
		store.handle(event("UserPromptSubmit", { session_id: "s2" }));
		const changed: string[] = [];
		store.onChange((id) => changed.push(id));
		store.setTitles(new Map([["s1", "ClaudeDeck Plugin"], ["s2", ""], ["unknown", "x"]]));
		store.setTitles(new Map([["s1", "ClaudeDeck Plugin"]]));
		expect(store.get("s1")?.title).toBe("ClaudeDeck Plugin");
		expect(store.get("s2")?.title).toBeUndefined();
		expect(changed).toEqual(["s1"]);
	});
});
