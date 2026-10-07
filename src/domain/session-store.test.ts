import { describe, expect, it } from "vitest";
import type { HookEvent, ModuleEvent } from "./hook-event.js";
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

const pin = (cwd: string, latestOnly = false) => ({ cwd, latestOnly });

/** Fails the test as soon as a listener could see two sessions on one slot. */
function expectUniqueSlots(store: SessionStore): void {
	store.onChange(() => {
		const slots = store.sessions().map((s) => s.slot);
		expect(new Set(slots).size).toBe(slots.length);
	});
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

	it("AskUserQuestion permission request does not count as approval", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.input);
		store.handle(event("PermissionRequest", { tool_name: "AskUserQuestion" }));
		expect(store.get("s1")).toMatchObject({ state: "input", pendingApprovals: 0 });
		store.handle(enter.working);
		store.handle(event("PermissionRequest", { tool_name: "AskUserQuestion" }));
		expect(store.get("s1")).toMatchObject({ state: "input", pendingApprovals: 0 });
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

	it("Stop with running background tasks keeps working", () => {
		let now = 0;
		const store = new SessionStore(() => now);
		store.handle(event("UserPromptSubmit"));
		store.handle(event("Stop", { background_tasks: [{ id: "agent-1" }] }));
		expect(store.get("s1")?.state).toBe("working");
		now += 11 * 60 * 1000;
		store.tick();
		expect(store.get("s1")?.state).toBe("working");
	});

	it("Stop without background tasks is done", () => {
		const store = new SessionStore(() => 0);
		store.handle(event("Stop", { background_tasks: [] }));
		expect(store.get("s1")?.state).toBe("done");
		store.handle(event("UserPromptSubmit"));
		store.handle(event("Stop"));
		expect(store.get("s1")?.state).toBe("done");
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
		store.setPins(new Map([[0, pin("F:\\Code\\api-svc")]]));
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
		store.setPins(new Map([[0, pin("F:\\Code\\api-svc")]]));
		expect([store.get("api")?.slot, store.get("web")?.slot]).toEqual([0, 1]);
		expect(changed.sort()).toEqual(["api", "web"]);
	});

	it("distributes a folder's sessions over its pinned slots by recency", () => {
		let now = 0;
		const store = new SessionStore(() => now);
		const api = (id: string, at: number) => {
			now = at;
			store.handle(event("UserPromptSubmit", { session_id: id, cwd: "F:\\Code\\api-svc" }));
		};
		api("old", 100);
		api("newest", 300);
		api("middle", 200);
		expectUniqueSlots(store);
		store.setPins(new Map([[0, pin("F:\\Code\\api-svc")], [2, pin("f:/code/api-svc")]]));
		expect(["newest", "middle", "old"].map((id) => store.get(id)?.slot)).toEqual([0, 2, 1]);

		// A new session is the newest: it takes the first pinned slot, the one it pushed off the group gets a free slot.
		api("fresh", 400);
		expect(["fresh", "newest", "middle", "old"].map((id) => store.get(id)?.slot)).toEqual([0, 2, 3, 1]);

		// Without latestOnly an event does not reshuffle placed sessions.
		api("old", 500);
		expect(["fresh", "newest", "middle", "old"].map((id) => store.get(id)?.slot)).toEqual([0, 2, 3, 1]);
	});

	it("extra sessions of a pinned folder take free unpinned slots", () => {
		// Three keys (slots 0..2), two pinned to api-svc.
		let now = 0;
		const store = new SessionStore(() => now);
		expectUniqueSlots(store);
		store.setPins(new Map([[0, pin("F:\\Code\\api-svc")], [1, pin("F:\\Code\\api-svc")]]));
		const api = (id: string, at: number) => {
			now = at;
			store.handle(event("UserPromptSubmit", { session_id: id, cwd: "F:\\Code\\api-svc" }));
		};
		api("a", 100);
		api("b", 200);
		api("c", 300);
		expect(["c", "b", "a"].map((id) => store.get(id)?.slot)).toEqual([0, 1, 2]);
		// No free key left: the session pushed off the group lands beyond the keys and is not shown.
		api("d", 400);
		expect(["d", "c", "a", "b"].map((id) => store.get(id)?.slot)).toEqual([0, 1, 2, 3]);
	});

	it("latestOnly slot follows the most recently active session", () => {
		let now = 0;
		const store = new SessionStore(() => now);
		const changed: string[] = [];
		expectUniqueSlots(store);
		store.onChange((id) => changed.push(id));
		store.setPins(new Map([[1, pin("F:\\Code\\api-svc", true)]]));
		const send = (id: string, at: number, name: HookEvent["hook_event_name"] = "UserPromptSubmit") => {
			now = at;
			store.handle(event(name, { session_id: id, cwd: id === "web" ? "F:\\Code\\web-app" : "F:\\Code\\api-svc" }));
		};
		send("web", 100);
		send("a", 200);
		send("b", 300);
		expect(["web", "a", "b"].map((id) => store.get(id)?.slot)).toEqual([0, 2, 1]);

		// The switch happens on the event, the previous occupant takes the next free slot.
		changed.length = 0;
		send("a", 400, "PostToolUse");
		expect(["web", "a", "b"].map((id) => store.get(id)?.slot)).toEqual([0, 1, 2]);
		expect(changed.sort()).toEqual(["a", "b"]);
	});

	it("an ended session's pinned slot goes to the next newest session of its folder", () => {
		for (const latestOnly of [false, true]) {
			let now = 0;
			const store = new SessionStore(() => now);
			store.setPins(new Map([[0, pin("F:\\Code\\api-svc", latestOnly)], [1, pin("F:\\Code\\api-svc")]]));
			const send = (name: HookEvent["hook_event_name"], id: string, at: number) => {
				now = at;
				store.handle(event(name, { session_id: id, cwd: "F:\\Code\\api-svc" }));
			};
			send("UserPromptSubmit", "a", 100);
			send("UserPromptSubmit", "b", 200);
			send("UserPromptSubmit", "c", 300);
			expect(["c", "b", "a"].map((id) => store.get(id)?.slot)).toEqual([0, 1, 2]);
			const changed: string[] = [];
			expectUniqueSlots(store);
			store.onChange((id) => changed.push(id));
			send("SessionEnd", "c", 400);
			expect(["b", "a"].map((id) => store.get(id)?.slot)).toEqual([0, 1]);
			expect(changed).toEqual(["c", "a", "b"]);
		}
	});

	it("a displaced session takes its folder's free pinned slots in key order", () => {
		let now = 0;
		const store = new SessionStore(() => now);
		store.setPins(new Map([[2, pin("F:\\Code\\api-svc")], [1, pin("F:\\Code\\api-svc")], [0, pin("F:\\Code\\api-svc", true)]]));
		const send = (id: string, at: number) => {
			now = at;
			store.handle(event("UserPromptSubmit", { session_id: id, cwd: "F:\\Code\\api-svc" }));
		};
		send("s1", 100);
		send("s2", 200);
		expect(["s1", "s2"].map((id) => store.get(id)?.slot)).toEqual([1, 0]);
		send("s1", 300);
		expect(["s1", "s2"].map((id) => store.get(id)?.slot)).toEqual([0, 1]);
	});

	it("a new session does not move sessions of other folders", () => {
		let now = 0;
		const store = new SessionStore(() => now);
		store.setPins(new Map([[0, pin("F:\\Code\\api-svc")], [1, pin("F:\\Code\\api-svc")]]));
		const send = (id: string, at: number, cwd = "F:\\Code\\api-svc") => {
			now = at;
			store.handle(event("UserPromptSubmit", { session_id: id, cwd }));
		};
		send("a1", 100);
		send("a2", 200);
		send("a1", 300); // a1 is newest now, but keeps its slot
		send("b", 400, "F:\\Code\\web-app");
		expect(["a2", "a1", "b"].map((id) => store.get(id)?.slot)).toEqual([0, 1, 2]);
	});

	it("lists all sessions", () => {
		const store = new SessionStore(() => 0);
		store.handle(event("UserPromptSubmit", { session_id: "a" }));
		store.handle(event("UserPromptSubmit", { session_id: "b" }));
		expect(store.sessions().map((s) => s.id)).toEqual(["a", "b"]);
	});

	it("pinned cwd matches case-insensitively and ignores a trailing backslash", () => {
		const store = new SessionStore(() => 0);
		store.setPins(new Map([[2, pin("f:\\code\\API-SVC\\")]]));
		store.handle(event("UserPromptSubmit", { session_id: "api", cwd: "F:\\Code\\api-svc" }));
		expect(store.get("api")?.slot).toBe(2);
	});

	it("pinned cwd matches with forward slashes", () => {
		const store = new SessionStore(() => 0);
		store.setPins(new Map([[3, pin("F:/Code/api-svc")]]));
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

	it("tracks running turn, module context and rate limits", () => {
		let now = 100;
		const store = new SessionStore(() => now);
		const mod = (name: ModuleEvent["name"], extra: Partial<ModuleEvent> = {}): ModuleEvent => ({ name, sessionId: "s1", ...extra });
		const limits = [{ kind: "five_hour", percentUsed: 85, resetsAt: "2026-10-07T12:00:00Z" }];
		const reported: unknown[] = [];
		store.onRateLimits((rateLimits) => reported.push(rateLimits));

		// Unknown session: nothing is created, but rate limits are global.
		store.handleModule(mod("session-start", { cwd: "F:\\Code\\ClaudeDeck" }));
		store.handleModule(mod("turn-start", { turnId: "t0" }));
		store.handleModule(mod("usage", { context: { tokens: 1, window: 2, percent: 50 }, rateLimits: limits }));
		expect(store.sessions()).toEqual([]);
		expect(store.rateLimits()).toEqual({ limits, at: 100 });

		store.handle(enter.working);
		const changed: string[] = [];
		store.onChange((id) => changed.push(id));
		store.handleModule(mod("turn-start", { turnId: "t1" }));
		expect(store.get("s1")?.runningTurnId).toBe("t1");
		expect(store.get("s1")?.moduleContext).toBeUndefined();

		now = 200;
		store.handleModule(mod("usage", { context: { tokens: 92399, window: 1000000, percent: 9 }, rateLimits: [] }));
		store.handleModule(mod("usage", { context: { tokens: 92400, window: 1000000, percent: 9 } }));
		expect(store.get("s1")?.moduleContext).toEqual({ tokens: 92400, window: 1000000, percent: 9 });
		expect(store.rateLimits()).toEqual({ limits, at: 100 }); // empty or missing lists do not erase known limits
		expect(reported).toEqual([{ limits, at: 100 }]);
		expect(changed).toEqual(["s1"]); // percent changed once; turn id and token count alone do not redraw

		store.handle(event("Stop"));
		expect(store.get("s1")?.runningTurnId).toBeUndefined();
		expect(store.get("s1")?.moduleContext).toEqual({ tokens: 92400, window: 1000000, percent: 9 });
	});

	it("keeps a turn id that arrives before the session's first hook event", () => {
		const store = new SessionStore(() => 0);
		store.handleModule({ name: "turn-start", sessionId: "s1", turnId: "t1" });
		store.handleModule({ name: "turn-start", sessionId: "seeded", turnId: "t2" });
		store.handleModule({ name: "turn-start", sessionId: "done", turnId: "t3" });
		store.handleModule({ name: "usage", sessionId: "done" }); // its turn completed before any hook event
		expect(store.sessions()).toEqual([]);

		store.handle(enter.working);
		store.seed([
			{ sessionId: "seeded", cwd: "F:/Code/x", transcriptPath: "x.jsonl", lastActivityAt: 0 },
			{ sessionId: "done", cwd: "F:/Code/y", transcriptPath: "y.jsonl", lastActivityAt: 0 },
		]);
		expect(store.get("s1")?.runningTurnId).toBe("t1");
		expect(store.get("seeded")?.runningTurnId).toBe("t2");
		expect(store.get("done")?.runningTurnId).toBeUndefined();

		// Applied once: a later session with the same id starts without it.
		store.remove("s1");
		store.handle(enter.working);
		expect(store.get("s1")?.runningTurnId).toBeUndefined();
	});

	it("module usage ends the running turn, also for aborted turns without Stop", () => {
		const store = new SessionStore(() => 0);
		store.handle(enter.working);
		store.handleModule({ name: "turn-start", sessionId: "s1", turnId: "t1" });
		store.handleModule({ name: "usage", sessionId: "s1", rateLimits: [] });
		expect(store.get("s1")?.runningTurnId).toBeUndefined();
	});
});
