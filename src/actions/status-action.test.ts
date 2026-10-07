import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopSession } from "../desktop/session-catalog.js";
import type { HookEvent } from "../domain/hook-event.js";
import { SessionStore } from "../domain/session-store.js";
import { renderEmptyStatusKey, renderStatusKey, toDataUrl } from "../render/status-key.js";
import { StatusKeys, transcriptPathFor } from "./status-action.js";

function event(name: HookEvent["hook_event_name"], sessionId: string, extra: Partial<HookEvent> = {}): HookEvent {
	return { hook_event_name: name, session_id: sessionId, transcript_path: `${sessionId}.jsonl`, cwd: `F:\\Code\\${sessionId}`, ...extra };
}

function view(id: string) {
	return { id, setImage: vi.fn(), showAlert: vi.fn() };
}

function setup(readContext = vi.fn(async () => null as number | null)) {
	let now = 0;
	const store = new SessionStore(() => now);
	const keys = new StatusKeys(store, readContext, () => now);
	const send = (e: HookEvent) => {
		store.handle(e);
		keys.hookEvent(e);
	};
	return { store, keys, send, readContext, advance: (ms: number) => (now += ms) };
}

/** A short key press: down and up at once. */
function tap(keys: StatusKeys, key: ReturnType<typeof view>): void {
	keys.press(key);
	keys.release(key);
}

const status = (project: string, state: Parameters<typeof renderStatusKey>[0]["state"], contextPercent: number | null = null, flash = false) =>
	toDataUrl(renderStatusKey({ project, state, contextPercent, flash }));

describe("StatusKeys", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("renders session or empty state", () => {
		const { keys, send } = setup();
		const k0 = view("k0");
		const k1 = view("k1");
		keys.appear(k0, { column: 0, row: 0 }, {});
		keys.appear(k1, { column: 1, row: 0 }, {});
		send(event("UserPromptSubmit", "web"));
		expect(k0.setImage).toHaveBeenLastCalledWith(status("web", "working"));
		expect(k1.setImage).toHaveBeenLastCalledWith(toDataUrl(renderEmptyStatusKey()));
	});

	it("updates only affected key", () => {
		const { keys, send } = setup();
		const k0 = view("k0");
		const k1 = view("k1");
		keys.appear(k0, { column: 0, row: 0 }, {});
		keys.appear(k1, { column: 1, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		send(event("UserPromptSubmit", "b"));
		k0.setImage.mockClear();
		k1.setImage.mockClear();
		send(event("Stop", "b"));
		expect(k0.setImage).not.toHaveBeenCalled();
		expect(k1.setImage).toHaveBeenLastCalledWith(status("b", "done"));
	});

	it("clears the key when its session ends", () => {
		const { keys, send } = setup();
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		send(event("SessionEnd", "a"));
		expect(k0.setImage).toHaveBeenLastCalledWith(toDataUrl(renderEmptyStatusKey()));
	});

	it("flashes only in approval and input", () => {
		const { keys, send, store } = setup();
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		k0.setImage.mockClear();
		vi.advanceTimersByTime(2000);
		expect(k0.setImage).not.toHaveBeenCalled();

		send(event("PermissionRequest", "a", { tool_name: "Bash" }));
		vi.advanceTimersByTime(500);
		expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "approval", null, true));
		vi.advanceTimersByTime(500);
		expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "approval", null, false));

		send(event("Stop", "a"));
		store.approvalDecided("a");
		expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "done"));
		const calls = k0.setImage.mock.calls.length;
		vi.advanceTimersByTime(2000);
		expect(k0.setImage.mock.calls.length).toBe(calls);
	});

	it("reads context after prompt, tool use and stop, at most every 2s per session", async () => {
		const readContext = vi.fn(async () => 42 as number | null);
		const { keys, send, advance } = setup(readContext);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		send(event("PostToolUse", "a"));
		send(event("PreToolUse", "a"));
		expect(readContext).toHaveBeenCalledTimes(1);
		expect(readContext).toHaveBeenCalledWith("a.jsonl");
		advance(2000);
		send(event("Stop", "a"));
		expect(readContext).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "done", 42)));
	});

	it("reads context on Stop with background tasks", async () => {
		const readContext = vi.fn(async () => 33 as number | null);
		const { keys, send } = setup(readContext);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		send(event("Stop", "a", { background_tasks: [{ id: "agent-1" }] }));
		expect(readContext).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "working", 33)));
	});

	it("always reads context on Stop, even inside the throttle window", () => {
		const readContext = vi.fn(async () => 42 as number | null);
		const { keys, send, advance } = setup(readContext);
		send(event("PostToolUse", "a"));
		advance(500);
		send(event("Stop", "a"));
		expect(readContext).toHaveBeenCalledTimes(2);
		keys.renderAll();
	});

	it("ignores context reads that finish after the session ended", async () => {
		const reads: ((value: number | null) => void)[] = [];
		const readContext = vi.fn(() => new Promise<number | null>((resolve) => reads.push(resolve)));
		const { keys, send, store } = setup(readContext);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		send(event("SessionEnd", "a"));
		reads[0](77);
		await Promise.resolve();
		// A new session with the same id must not inherit the dead session's value.
		store.handle(event("UserPromptSubmit", "a"));
		expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "working"));
	});

	it("keeps the last context value when a read returns null", async () => {
		const readContext = vi.fn<(path: string) => Promise<number | null>>().mockResolvedValueOnce(30).mockResolvedValueOnce(null);
		const { keys, send, advance } = setup(readContext);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		await vi.waitFor(() => expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "working", 30)));
		advance(2000);
		send(event("Stop", "a"));
		await Promise.resolve();
		expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "done", 30));
	});

	it("prefers the module's exact context", async () => {
		const readContext = vi.fn(async () => 30 as number | null);
		const { keys, send, store, advance } = setup(readContext);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		await vi.waitFor(() => expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "working", 30)));
		store.handleModule({ name: "usage", sessionId: "a", context: { percent: 12, window: 1_000_000, tokens: 120_000 } });
		expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "working", 12));
		advance(2000);
		send(event("Stop", "a"));
		expect(readContext).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "done", 12));
	});

	it("falls back to the transcript without module data", async () => {
		const readContext = vi.fn(async () => 30 as number | null);
		const { keys, send, store, advance } = setup(readContext);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("UserPromptSubmit", "a"));
		store.handleModule({ name: "usage", sessionId: "a", context: {} });
		advance(2000);
		send(event("Stop", "a"));
		expect(readContext).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "done", 30)));
	});

	it("pinned project survives restart", () => {
		// After a restart the key settings come back with onWillAppear; a running session must land on its pinned key.
		const { keys, send, store } = setup();
		send(event("UserPromptSubmit", "web"));
		send(event("UserPromptSubmit", "api"));
		const k0 = view("k0");
		const k1 = view("k1");
		keys.appear(k0, { column: 0, row: 0 }, {});
		keys.appear(k1, { column: 1, row: 0 }, { project: "F:\\Code\\web" });
		expect(store.get("web")?.slot).toBe(1);
		expect(k1.setImage).toHaveBeenLastCalledWith(status("web", "working"));
		expect(k0.setImage).toHaveBeenLastCalledWith(status("api", "working"));
	});

	it("settings change re-pins", () => {
		const { keys, send, store } = setup();
		const k0 = view("k0");
		const k1 = view("k1");
		keys.appear(k0, { column: 0, row: 0 }, {});
		keys.appear(k1, { column: 1, row: 0 }, {});
		send(event("UserPromptSubmit", "web"));
		keys.settingsChanged("k1", { project: "F:\\Code\\web" });
		expect(store.get("web")?.slot).toBe(1);
	});

	it("latestOnly setting reaches the store", () => {
		const { keys, send, store, advance } = setup();
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, { project: "F:\\Code\\api", latestOnly: true });
		keys.appear(view("k1"), { column: 1, row: 0 }, {});
		send(event("UserPromptSubmit", "a", { cwd: "F:\\Code\\api" }));
		advance(1);
		send(event("UserPromptSubmit", "b", { cwd: "F:\\Code\\api" }));
		advance(1);
		send(event("Stop", "a", { cwd: "F:\\Code\\api" }));
		expect([store.get("a")?.slot, store.get("b")?.slot]).toEqual([0, 1]);
		expect(k0.setImage).toHaveBeenLastCalledWith(status("api", "done"));
	});

	it("press on done sets idle", () => {
		const { keys, send, store } = setup();
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		send(event("Stop", "a"));
		tap(keys, k0);
		expect(store.get("a")?.state).toBe("idle");
		expect(k0.setImage).toHaveBeenLastCalledWith(status("a", "idle"));
	});

	it("press focuses window and clears done", async () => {
		let now = 0;
		const store = new SessionStore(() => now);
		const focusProject = vi.fn(async () => true);
		const keys = new StatusKeys(store, async () => null, () => now, focusProject);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		store.handle(event("Stop", "api"));
		tap(keys, k0);
		expect(focusProject).toHaveBeenCalledWith("api");
		expect(store.get("api")?.state).toBe("idle");
		await Promise.resolve();
		expect(k0.showAlert).not.toHaveBeenCalled();
	});

	it("press alerts when no window matches", async () => {
		const store = new SessionStore(() => 0);
		const keys = new StatusKeys(store, async () => null, () => 0, async () => false);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		store.handle(event("UserPromptSubmit", "api"));
		tap(keys, k0);
		await vi.waitFor(() => expect(k0.showAlert).toHaveBeenCalledOnce());
	});

	describe("press with the Desktop catalog", () => {
		const catalog = async (): Promise<DesktopSession[]> => [
			{ localId: "local_api-1", cliSessionId: "api", cwd: "F:\\Code\\api", title: "", lastActivityAt: 0, archived: true },
		];

		const flush = async () => {
			for (let i = 0; i < 10; i++) await Promise.resolve();
		};

		/** Presses the key of `sessionId` after one catalog read; the catalog marks "api" archived, so it is mapped but not seeded. */
		async function pressSession(sessionId: string, open: (localId: string) => Promise<boolean>, focus: (project: string) => Promise<boolean>) {
			const openSession = vi.fn(open);
			const focusProject = vi.fn(focus);
			const store = new SessionStore(() => 0);
			const keys = new StatusKeys(store, async () => null, () => 0, focusProject, catalog, openSession);
			const k0 = view("k0");
			keys.appear(k0, { column: 0, row: 0 }, {});
			await keys.seed();
			store.handle(event("Stop", sessionId));
			tap(keys, k0);
			const state = store.get(sessionId)?.state;
			await flush();
			return { openSession, focusProject, alert: k0.showAlert, state };
		}

		it("press opens desktop session when known", async () => {
			const { openSession, focusProject, alert, state } = await pressSession("api", async () => true, async () => true);
			expect(state).toBe("idle");
			expect(openSession).toHaveBeenCalledWith("local_api-1");
			expect(focusProject).not.toHaveBeenCalled();
			expect(alert).not.toHaveBeenCalled();
		});

		it("press falls back to window focus", async () => {
			const failed = await pressSession("api", async () => false, async () => true);
			expect(failed.focusProject).toHaveBeenCalledWith("api");
			expect(failed.alert).not.toHaveBeenCalled();

			const threw = await pressSession("api", () => Promise.reject(new Error("no desktop")), async () => true);
			expect(threw.focusProject).toHaveBeenCalledWith("api");
			expect(threw.alert).not.toHaveBeenCalled();

			const both = await pressSession("api", async () => false, async () => false);
			expect(both.alert).toHaveBeenCalledOnce();

			// A session the catalog does not know (CLI) never tries the deep link.
			const cli = await pressSession("cli", async () => true, async () => true);
			expect(cli.openSession).not.toHaveBeenCalled();
			expect(cli.focusProject).toHaveBeenCalledWith("cli");
		});
	});

	it("empty key shows sessions waiting without a key", () => {
		const { keys, send, store } = setup();
		const k0 = view("k0");
		const k1 = view("k1");
		keys.appear(k0, { column: 0, row: 0 }, {});
		keys.appear(k1, { column: 1, row: 0 }, { project: "F:\\Code\\none" }); // pinned to a folder without sessions: stays empty
		send(event("UserPromptSubmit", "a"));
		send(event("PreToolUse", "b", { tool_name: "AskUserQuestion" }));
		send(event("PermissionRequest", "c", { tool_name: "Bash" }));
		send(event("Stop", "d"));
		expect([store.get("b")?.slot, store.get("c")?.slot]).toEqual([2, 3]);
		expect(k1.setImage).toHaveBeenLastCalledWith(toDataUrl(renderEmptyStatusKey(2)));
		store.approvalDecided("c");
		expect(k1.setImage).toHaveBeenLastCalledWith(toDataUrl(renderEmptyStatusKey(1)));
		send(event("PostToolUse", "b"));
		expect(k1.setImage).toHaveBeenLastCalledWith(toDataUrl(renderEmptyStatusKey()));
	});

	it("pressing the waiting key opens needs-input", async () => {
		async function pressWaiting(open: () => Promise<boolean>) {
			const openNeedsInput = vi.fn(open);
			const store = new SessionStore(() => 0);
			const keys = new StatusKeys(store, async () => null, () => 0, async () => true, async () => [], async () => true, openNeedsInput);
			const k0 = view("k0");
			keys.appear(k0, { column: 0, row: 0 }, { project: "F:\\Code\\none" });
			tap(keys, k0); // nothing waiting yet
			expect(openNeedsInput).not.toHaveBeenCalled();
			store.handle(event("PreToolUse", "a", { tool_name: "AskUserQuestion" }));
			tap(keys, k0);
			for (let i = 0; i < 10; i++) await Promise.resolve();
			return { openNeedsInput, alert: k0.showAlert };
		}

		const opened = await pressWaiting(async () => true);
		expect(opened.openNeedsInput).toHaveBeenCalledOnce();
		expect(opened.alert).not.toHaveBeenCalled();
		expect((await pressWaiting(async () => false)).alert).toHaveBeenCalledOnce();
		expect((await pressWaiting(() => Promise.reject(new Error("no desktop")))).alert).toHaveBeenCalledOnce();
	});

	it("long press queues abort for the running turn", async () => {
		let now = 0;
		const store = new SessionStore(() => now);
		const focusProject = vi.fn(async () => true);
		const queueAbort = vi.fn<(sessionId: string, turnId: string, onExpired: () => void) => void>();
		const keys = new StatusKeys(store, async () => null, () => now, focusProject, async () => [], async () => true, async () => true, queueAbort);
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		const longPress = () => {
			keys.press(k0);
			now += 600;
			keys.release(k0);
		};

		// Working without a known turn (no module): nothing but an alert.
		store.handle(event("UserPromptSubmit", "a"));
		longPress();
		expect(queueAbort).not.toHaveBeenCalled();
		expect(k0.showAlert).toHaveBeenCalledOnce();

		store.handleModule({ name: "turn-start", sessionId: "a", turnId: "t1" });
		longPress();
		expect(queueAbort).toHaveBeenCalledWith("a", "t1", expect.any(Function));
		expect(focusProject).not.toHaveBeenCalled(); // a long press does not also open the session
		expect(store.get("a")?.state).toBe("working");
		queueAbort.mock.calls[0][2](); // nobody fetched it within 10 s
		expect(k0.showAlert).toHaveBeenCalledTimes(2);

		// Just under 600 ms is a short press: opens the session as before.
		keys.press(k0);
		now += 599;
		keys.release(k0);
		expect(focusProject).toHaveBeenCalledWith("a");
		expect(queueAbort).toHaveBeenCalledOnce();

		// Not working (done): a long press only alerts.
		store.handle(event("Stop", "a"));
		longPress();
		expect(queueAbort).toHaveBeenCalledOnce();
		expect(k0.showAlert).toHaveBeenCalledTimes(3);
		expect(store.get("a")?.state).toBe("done");

		// A release without a press (e.g. the key appeared while held) does nothing.
		keys.release(k0);
		await Promise.resolve();
		expect(k0.showAlert).toHaveBeenCalledTimes(3);
	});

	it("press on an empty key does nothing", () => {
		const { keys } = setup();
		const k0 = view("k0");
		keys.appear(k0, { column: 0, row: 0 }, {});
		expect(() => tap(keys, k0)).not.toThrow();
	});

	describe("seeding from the Desktop catalog", () => {
		const HOUR = 60 * 60 * 1000;
		const NOW = 100 * HOUR;
		const desktop = (cliSessionId: string, cwd: string, hoursAgo: number, archived = false): DesktopSession => ({
			localId: `local_${cliSessionId}`,
			cliSessionId,
			cwd,
			title: "",
			lastActivityAt: NOW - hoursAgo * HOUR,
			archived,
		});

		function seedSetup(catalog: () => Promise<DesktopSession[]>, readContext = vi.fn(async () => null as number | null)) {
			const store = new SessionStore(() => NOW);
			const listDesktopSessions = vi.fn(catalog);
			const keys = new StatusKeys(store, readContext, () => NOW, async () => false, listDesktopSessions);
			return { store, keys, listDesktopSessions, readContext };
		}

		it("seeds recent and pinned sessions", async () => {
			const { store, keys } = seedSetup(async () => [
				desktop("recent", "F:\\Code\\web", 1),
				desktop("stale", "F:\\Code\\web", 13),
				desktop("archived", "F:\\Code\\web", 0, true),
				desktop("pinned-new", "f:/code/api/", 48),
				desktop("pinned-old", "F:\\Code\\api", 72),
				desktop("pinned-archived", "F:\\Code\\api", 24, true),
			]);
			keys.appear(view("k0"), { column: 0, row: 0 }, { project: "F:\\Code\\api" });
			await keys.seed();
			expect(store.sessions().map((s) => s.id).sort()).toEqual(["pinned-new", "recent"]);
			expect(store.get("pinned-new")).toMatchObject({ slot: 0, state: "idle" });
		});

		it("seeds the newest session for each key pinned to a folder", async () => {
			const { store, keys } = seedSetup(async () => [desktop("newest", "F:\\Code\\api", 20), desktop("second", "F:\\Code\\api", 30), desktop("third", "F:\\Code\\api", 40)]);
			keys.appear(view("k0"), { column: 0, row: 0 }, { project: "F:\\Code\\api" });
			keys.appear(view("k1"), { column: 1, row: 0 }, { project: "F:\\Code\\api" });
			await keys.seed();
			expect(store.sessions().map((s) => [s.id, s.slot])).toEqual([["newest", 0], ["second", 1]]);
		});

		it("derives transcript path from cwd and cli session id", () => {
			const projects = path.join("C:\\Users\\Jane Doe", ".claude", "projects");
			expect(transcriptPathFor("F:\\Code\\ClaudeDeck", "abc", "C:\\Users\\Jane Doe")).toBe(path.join(projects, "F--Code-ClaudeDeck", "abc.jsonl"));
			expect(transcriptPathFor("C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\cdspike", "abc", "C:\\Users\\Jane Doe")).toBe(
				path.join(projects, "C--Users-Jane-Doe-AppData-Local-Temp-cdspike", "abc.jsonl"),
			);
		});

		it("reads context for seeded sessions", async () => {
			const readContext = vi.fn(async () => 55 as number | null);
			const { keys } = seedSetup(async () => [desktop("a", "F:\\Code\\web", 1)], readContext);
			const k0 = view("k0");
			keys.appear(k0, { column: 0, row: 0 }, {});
			await keys.seed();
			await keys.seed();
			expect(readContext).toHaveBeenCalledOnce();
			expect(readContext).toHaveBeenCalledWith(transcriptPathFor("F:\\Code\\web", "a"));
			await vi.waitFor(() => expect(k0.setImage).toHaveBeenLastCalledWith(status("web", "idle", 55)));
		});

		it("reseeds on appear, settings change and every 60s", async () => {
			const { keys, listDesktopSessions } = seedSetup(async () => []);
			keys.appear(view("k0"), { column: 0, row: 0 }, {});
			expect(listDesktopSessions).toHaveBeenCalledTimes(1);
			keys.settingsChanged("k0", { project: "F:\\Code\\api" });
			expect(listDesktopSessions).toHaveBeenCalledTimes(2);
			vi.advanceTimersByTime(59_999);
			expect(listDesktopSessions).toHaveBeenCalledTimes(2);
			vi.advanceTimersByTime(1);
			expect(listDesktopSessions).toHaveBeenCalledTimes(3);
		});

		it("drops idle catalog sessions that left the selection", async () => {
			let catalog = ["archived", "aged", "working", "done", "approval"].map((id) => desktop(id, `F:\\Code\\${id}`, 1));
			const { store, keys } = seedSetup(async () => catalog);
			const k0 = view("k0");
			keys.appear(k0, { column: 0, row: 0 }, {});
			await keys.seed();
			store.handle(event("UserPromptSubmit", "working"));
			store.handle(event("Stop", "done"));
			store.handle(event("PermissionRequest", "approval", { tool_name: "Bash" }));
			store.handle(event("UserPromptSubmit", "cli"));
			store.handle(event("Stop", "cli"));
			store.keyPressed("cli"); // idle, but not in the catalog
			catalog = [desktop("archived", "F:\\Code\\archived", 1, true), ...["aged", "working", "done", "approval"].map((id) => desktop(id, `F:\\Code\\${id}`, 13))];
			await keys.seed();
			expect(store.sessions().map((s) => s.id).sort()).toEqual(["approval", "cli", "done", "working"]);
			expect(k0.setImage).toHaveBeenLastCalledWith(toDataUrl(renderEmptyStatusKey(1))); // "approval" has no key
		});

		it("takes titles from the catalog, also for sessions started by hook events", async () => {
			const titled = (id: string, title: string) => ({ ...desktop(id, `F:\\Code\\${id}`, 1), title });
			let catalog = [titled("seeded", "Seeded Title"), titled("running", "Running Title")];
			const { store, keys } = seedSetup(async () => catalog);
			const k0 = view("k0");
			keys.appear(k0, { column: 0, row: 0 }, {});
			store.handle(event("UserPromptSubmit", "running"));
			await keys.seed();
			expect(store.get("seeded")?.title).toBe("Seeded Title");
			expect(store.get("running")?.title).toBe("Running Title");
			expect(k0.setImage).toHaveBeenLastCalledWith(toDataUrl(renderStatusKey({ project: "running", title: "Running Title", state: "working", contextPercent: null, flash: false })));
			catalog = [titled("running", "Renamed")];
			await keys.seed();
			expect(store.get("running")?.title).toBe("Renamed");
		});

		it("catalog failure keeps keys unchanged", async () => {
			const { store, keys } = seedSetup(async () => {
				throw new Error("EACCES");
			});
			const k0 = view("k0");
			keys.appear(k0, { column: 0, row: 0 }, {});
			store.handle(event("UserPromptSubmit", "a"));
			k0.setImage.mockClear();
			await expect(keys.seed()).resolves.toBeUndefined();
			expect(k0.setImage).not.toHaveBeenCalled();
			expect(store.get("a")?.state).toBe("working");
		});
	});
});
