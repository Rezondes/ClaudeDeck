import type { HookEvent } from "./hook-event.js";

export type SessionState = "working" | "approval" | "input" | "done" | "idle";

export interface Session {
	id: string;
	/** Status key slot, 0-based. */
	slot: number;
	/** What the status key shows: "approval" while any approval is pending, else baseState. */
	state: SessionState;
	/** State from the latest events, ignoring pending approvals. */
	baseState: SessionState;
	/** Open PermissionRequests. Parallel subagents share the session_id, so there can be several. */
	pendingApprovals: number;
	cwd: string;
	/** Last segment of cwd, e.g. "ClaudeDeck". */
	projectName: string;
	transcriptPath: string;
	/** Desktop session title, undefined for CLI sessions and empty titles. */
	title?: string;
	/** Last permission_mode seen, undefined until an event carried one. */
	permissionMode?: string;
	/** now() of the last hook event. */
	lastEventAt: number;
}

/** A session known before its first hook event. */
export type SeedEntry = { sessionId: string; cwd: string; transcriptPath: string; lastActivityAt: number };

const DONE_TIMEOUT_MS = 10 * 60 * 1000;
const INPUT_NOTIFICATIONS = ["elicitation_dialog", "agent_needs_input"];

/** New state for an event, or undefined when the event does not change the state. */
function stateFor(event: HookEvent): SessionState | undefined {
	switch (event.hook_event_name) {
		case "UserPromptSubmit":
		case "PostToolUse":
			return "working";
		case "PreToolUse":
			return event.tool_name === "AskUserQuestion" ? "input" : "working";
		case "Notification":
			return INPUT_NOTIFICATIONS.includes(event.notification_type ?? "") ? "input" : undefined;
		case "PermissionRequest":
			return "working"; // shown as "approval" via pendingApprovals until decided
		case "Stop":
			return "done";
	}
}

/** Windows paths: case-insensitive, trailing separators do not matter. */
export function normalizeCwd(cwd: string): string {
	return cwd.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

/** Last segment of a path, e.g. "F:\Code\ClaudeDeck\" gives "ClaudeDeck". */
export function projectNameOf(cwd: string): string {
	return cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}

/** Translates hook events into one state per Claude Code session. Pure domain, no IO. */
export class SessionStore {
	readonly #sessions = new Map<string, Session>();
	/** Slot to normalized cwd. */
	#pins = new Map<number, string>();
	readonly #listeners: ((sessionId: string) => void)[] = [];
	readonly #now: () => number;

	constructor(now: () => number) {
		this.#now = now;
	}

	/** Called once per real change: session created or removed, state or permission mode changed. */
	onChange(listener: (sessionId: string) => void): void {
		this.#listeners.push(listener);
	}

	get(sessionId: string): Session | undefined {
		return this.#sessions.get(sessionId);
	}

	handle(event: HookEvent): void {
		if (event.hook_event_name === "SessionEnd") {
			this.remove(event.session_id);
			return;
		}
		let session = this.#sessions.get(event.session_id);
		const before = session && { state: session.state, permissionMode: session.permissionMode };
		session ??= this.#create({ sessionId: event.session_id, cwd: event.cwd, transcriptPath: event.transcript_path, lastActivityAt: 0 });
		if (event.hook_event_name === "PermissionRequest") {
			session.pendingApprovals++;
		}
		session.baseState = stateFor(event) ?? session.baseState;
		session.state = this.#visibleState(session);
		session.permissionMode = event.permission_mode ?? session.permissionMode;
		session.lastEventAt = this.#now();
		if (before?.state !== session.state || before.permissionMode !== session.permissionMode) {
			this.#notify(session.id);
		}
	}

	/** Called periodically by the plugin: done sessions without events for 10 min become idle. */
	tick(): void {
		for (const session of this.#sessions.values()) {
			if (session.state === "done" && this.#now() - session.lastEventAt >= DONE_TIMEOUT_MS) {
				session.baseState = session.state = "idle";
				this.#notify(session.id);
			}
		}
	}

	/** Called by the hook server once a pending PermissionRequest got an answer, timed out or was abandoned. */
	approvalDecided(sessionId: string): void {
		const session = this.#sessions.get(sessionId);
		if (session && session.pendingApprovals > 0) {
			session.pendingApprovals--;
			this.#update(session);
		}
	}

	/** Status key pressed: acknowledges a finished session. */
	keyPressed(sessionId: string): void {
		const session = this.#sessions.get(sessionId);
		if (session?.state === "done") {
			session.baseState = "idle";
			this.#update(session);
		}
	}

	/** Binds status key slots to project folders. Running sessions move into their pinned slot. */
	setPins(pins: Map<number, string>): void {
		this.#pins = new Map([...pins].map(([slot, cwd]) => [slot, normalizeCwd(cwd)]));
		// Running sessions move into their pinned slot; whoever sat there gets the next free slot.
		for (const [slot, cwd] of this.#pins) {
			const session = [...this.#sessions.values()].find((s) => normalizeCwd(s.cwd) === cwd);
			if (!session || session.slot === slot) continue;
			const occupant = [...this.#sessions.values()].find((s) => s.slot === slot);
			if (occupant) occupant.slot = -1; // vacate first so no listener ever sees two sessions on one slot
			session.slot = slot;
			if (occupant) occupant.slot = this.#freeSlot(occupant.cwd);
			this.#notify(session.id);
			if (occupant) this.#notify(occupant.id);
		}
	}

	sessions(): Session[] {
		return [...this.#sessions.values()];
	}

	/** Deletes a session; its slot is free for the next new session. Other sessions keep their slots. */
	remove(sessionId: string): void {
		if (this.#sessions.delete(sessionId)) {
			this.#notify(sessionId);
		}
	}

	/** Creates idle sessions known from outside (Desktop catalog) before their first hook event. Known sessions stay untouched. */
	seed(entries: SeedEntry[]): void {
		for (const entry of [...entries].sort((a, b) => b.lastActivityAt - a.lastActivityAt)) {
			if (this.#sessions.has(entry.sessionId)) continue;
			this.#notify(this.#create(entry).id);
		}
	}

	/** Sets titles of known sessions (Desktop catalog); an empty title means none. Notifies once per changed session. */
	setTitles(titles: Map<string, string>): void {
		for (const [sessionId, title] of titles) {
			const session = this.#sessions.get(sessionId);
			if (!session || session.title === (title || undefined)) continue;
			session.title = title || undefined;
			this.#notify(sessionId);
		}
	}

	#create(entry: SeedEntry): Session {
		const session: Session = {
			id: entry.sessionId,
			slot: this.#freeSlot(entry.cwd),
			state: "idle",
			baseState: "idle",
			pendingApprovals: 0,
			cwd: entry.cwd,
			projectName: projectNameOf(entry.cwd),
			transcriptPath: entry.transcriptPath,
			lastEventAt: entry.lastActivityAt,
		};
		this.#sessions.set(session.id, session);
		return session;
	}

	/** The pinned slot for this cwd if it is free, else the lowest slot that is neither taken nor pinned. */
	#freeSlot(cwd: string): number {
		const taken = new Set([...this.#sessions.values()].map((s) => s.slot));
		const wanted = normalizeCwd(cwd);
		for (const [slot, pinned] of this.#pins) {
			if (pinned === wanted && !taken.has(slot)) {
				return slot;
			}
		}
		let slot = 0;
		while (taken.has(slot) || this.#pins.has(slot)) {
			slot++;
		}
		return slot;
	}

	#visibleState(session: Session): SessionState {
		return session.pendingApprovals > 0 ? "approval" : session.baseState;
	}

	#update(session: Session): void {
		const before = session.state;
		session.state = this.#visibleState(session);
		if (session.state !== before) {
			this.#notify(session.id);
		}
	}

	#notify(sessionId: string): void {
		for (const listener of this.#listeners) {
			listener(sessionId);
		}
	}
}
