import type { HookEvent, ModuleEvent } from "./hook-event.js";

export type SessionState = "working" | "approval" | "input" | "done" | "error" | "idle";

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
	/** error of the last StopFailure, e.g. "rate_limit"; read only while baseState is "error". */
	errorKind?: string;
	/** now() of the last hook event. */
	lastEventAt: number;
	/** turnId of the running turn, from the plugin module (turn-start); cleared on Stop and on module usage (turn completed). */
	runningTurnId?: string;
	/** Exact context usage after the last turn, from the plugin module; undefined without module. */
	moduleContext?: ModuleContext;
}

export type ModuleContext = { percent?: number; window?: number; tokens?: number };

/** Plan usage limits as the plugin module reported them last (any session), e.g. { kind: "five_hour", percentUsed, resetsAt }. */
export type RateLimits = { limits: unknown[]; at: number };

/** resetsAt values this close belong to the same window (the API rounds them differently per response). */
const SAME_WINDOW_MS = 60_000;

type Limit = { kind?: unknown; percentUsed?: unknown; resetsAt?: unknown };
const kindOf = (limit: unknown) => (typeof (limit as Limit | null)?.kind === "string" ? ((limit as Limit).kind as string) : undefined);
const resetOf = (limit: unknown) => {
	const raw = (limit as Limit | null)?.resetsAt;
	const time = typeof raw === "string" ? Date.parse(raw) : NaN;
	return Number.isNaN(time) ? undefined : time;
};
const percentOf = (limit: unknown) => {
	const raw = (limit as Limit | null)?.percentUsed;
	return typeof raw === "number" ? raw : -Infinity;
};

/**
 * Each session reports the limits of its own last API response, so an idle session's report can be older than what is known.
 * Per kind: same window keeps the higher percent, a later window replaces, an earlier (stale) window is ignored.
 */
function mergeLimits(known: unknown[], reported: unknown[]): unknown[] {
	const merged = [...known];
	for (const limit of reported) {
		const kind = kindOf(limit);
		const index = kind === undefined ? -1 : merged.findIndex((k) => kindOf(k) === kind);
		if (index < 0) {
			merged.push(limit);
			continue;
		}
		const before = resetOf(merged[index]);
		const after = resetOf(limit);
		const delta = before === undefined || after === undefined ? Infinity : after - before;
		if (delta > SAME_WINDOW_MS || (Math.abs(delta) <= SAME_WINDOW_MS && percentOf(limit) >= percentOf(merged[index]))) merged[index] = limit;
	}
	return merged;
}

/** A status key slot bound to a project folder. latestOnly: the slot always shows the folder's session with the newest event. */
export type Pin = { cwd: string; latestOnly: boolean };

/** A session known before its first hook event. */
export type SeedEntry = { sessionId: string; cwd: string; transcriptPath: string; lastActivityAt: number };

const DONE_TIMEOUT_MS = 10 * 60 * 1000;
const INPUT_NOTIFICATIONS = ["elicitation_dialog", "agent_needs_input"];

const isQuestion = (event: HookEvent) => event.tool_name === "AskUserQuestion";

/** New state for an event, or undefined when the event does not change the state. */
function stateFor(event: HookEvent): SessionState | undefined {
	switch (event.hook_event_name) {
		case "UserPromptSubmit":
		case "PostToolUse":
			return "working";
		case "PreToolUse":
			return isQuestion(event) ? "input" : "working";
		case "Notification":
			return INPUT_NOTIFICATIONS.includes(event.notification_type ?? "") ? "input" : undefined;
		case "PermissionRequest":
			// Questions are answered in Claude, not queued (hook server); others show as "approval" via pendingApprovals until decided.
			return isQuestion(event) ? "input" : "working";
		case "Stop":
			// The main agent's turn ended, but background agents it started are still running.
			return Array.isArray(event.background_tasks) && event.background_tasks.length > 0 ? "working" : "done";
		case "StopFailure":
			// The turn ended with an API error (e.g. rate limit) instead of Stop.
			return "error";
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
	/** Slot to pin with normalized cwd. */
	#pins = new Map<number, Pin>();
	readonly #listeners: ((sessionId: string) => void)[] = [];
	readonly #rateLimitListeners: ((rateLimits: RateLimits) => void)[] = [];
	#rateLimits: RateLimits | undefined;
	/** When a turn last failed with error "rate_limit"; global like the limits. */
	#limitHitAt: number | undefined;
	/** turn-start of sessions no hook event created yet (the module can race ahead of UserPromptSubmit); applied by #create. */
	readonly #pendingTurnIds = new Map<string, string>();
	readonly #now: () => number;

	constructor(now: () => number) {
		this.#now = now;
	}

	/** Called once per real change: session created or removed, state or permission mode changed. */
	onChange(listener: (sessionId: string) => void): void {
		this.#listeners.push(listener);
	}

	/** Called whenever the plugin module reports a non-empty rate limit list and when the limit marker is set or cleared. */
	onRateLimits(listener: (rateLimits: RateLimits) => void): void {
		this.#rateLimitListeners.push(listener);
	}

	rateLimits(): RateLimits | undefined {
		return this.#rateLimits;
	}

	/** Set by a rate_limit StopFailure; cleared by a completed turn's usage report or once the earliest later reset has passed. */
	limitHitAt(): number | undefined {
		const hitAt = this.#limitHitAt;
		if (hitAt === undefined) return undefined;
		const resets = (this.#rateLimits?.limits ?? []).map(resetOf).filter((t): t is number => t !== undefined && t > hitAt);
		if (resets.length > 0 && Math.min(...resets) <= this.#now()) this.#limitHitAt = undefined;
		return this.#limitHitAt;
	}

	#notifyRateLimits(): void {
		const rateLimits = this.#rateLimits ?? { limits: [], at: this.#now() };
		for (const listener of this.#rateLimitListeners) listener(rateLimits);
	}

	get(sessionId: string): Session | undefined {
		return this.#sessions.get(sessionId);
	}

	handle(event: HookEvent): void {
		if (event.hook_event_name === "SessionEnd") {
			this.remove(event.session_id);
			return;
		}
		const known = this.#sessions.get(event.session_id);
		const before = known && { state: known.state, permissionMode: known.permissionMode };
		const session = known ?? this.#create({ sessionId: event.session_id, cwd: event.cwd, transcriptPath: event.transcript_path, lastActivityAt: this.#now() });
		if (event.hook_event_name === "PermissionRequest" && !isQuestion(event)) {
			session.pendingApprovals++;
		}
		session.baseState = stateFor(event) ?? session.baseState;
		session.state = this.#visibleState(session);
		session.permissionMode = event.permission_mode ?? session.permissionMode;
		if (event.hook_event_name === "Stop" || event.hook_event_name === "StopFailure") session.runningTurnId = undefined;
		if (event.hook_event_name === "StopFailure") session.errorKind = typeof event.error === "string" ? event.error : undefined;
		if (event.hook_event_name === "StopFailure" && event.error === "rate_limit") {
			this.#limitHitAt = this.#now();
			this.#notifyRateLimits();
		}
		session.lastEventAt = this.#now();
		const moved = known ? this.#followLatest(session) : this.#distribute(normalizeCwd(session.cwd));
		const changed = before?.state !== session.state || before.permissionMode !== session.permissionMode;
		for (const id of new Set([...(changed ? [session.id] : []), ...moved])) {
			this.#notify(id);
		}
	}

	/**
	 * An event of the plugin module. It never creates a session (hooks do); rate limits are global and kept for unknown sessions too.
	 * An empty list (before the session's first API call) does not erase known limits. Notifies only when the context percent changed.
	 */
	handleModule(event: ModuleEvent): void {
		const reported = event.name === "usage" && Array.isArray(event.rateLimits) && event.rateLimits.length > 0;
		if (reported) this.#rateLimits = { limits: mergeLimits(this.#rateLimits?.limits ?? [], event.rateLimits as unknown[]), at: this.#now() };
		// A completed turn's report (not the timed one, not an aborted or failed turn) means the limit no longer blocks; older modules send no outcome.
		const completed = event.name === "usage" && event.periodic !== true && (event.outcome === undefined || event.outcome === "completed");
		const cleared = completed && this.#limitHitAt !== undefined;
		if (cleared) this.#limitHitAt = undefined;
		if (reported || cleared) this.#notifyRateLimits();
		const session = this.#sessions.get(event.sessionId);
		if (event.name === "turn-start" && typeof event.turnId === "string") {
			if (session) session.runningTurnId = event.turnId;
			// ponytail: entries of sessions that never get a hook event stay until their usage arrives; cap if that ever matters.
			else this.#pendingTurnIds.set(event.sessionId, event.turnId);
		}
		if (event.name === "usage" && event.periodic !== true) {
			this.#pendingTurnIds.delete(event.sessionId);
			if (session) session.runningTurnId = undefined;
		}
		if (!session) return;
		// Esc fires neither Stop nor StopFailure (Package 30); pending approvals stay visible.
		if (event.name === "usage" && event.periodic !== true && event.outcome === "aborted" && session.baseState === "working") {
			session.baseState = "idle";
			this.#update(session);
		}
		if (event.name === "usage" && typeof event.context === "object" && event.context) {
			const number = (value: unknown) => (typeof value === "number" ? value : undefined);
			const before = session.moduleContext?.percent;
			session.moduleContext = { percent: number(event.context.percent), window: number(event.context.window), tokens: number(event.context.tokens) };
			if (session.moduleContext.percent !== before) this.#notify(session.id);
		}
	}

	/** Called periodically by the plugin: done and error sessions without events for 10 min become idle. */
	tick(): void {
		for (const session of this.#sessions.values()) {
			if ((session.state === "done" || session.state === "error") && this.#now() - session.lastEventAt >= DONE_TIMEOUT_MS) {
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
		if (session?.state === "done" || session?.state === "error") {
			session.baseState = "idle";
			this.#update(session);
		}
	}

	/** Binds status key slots to project folders and redistributes running sessions by recency. */
	setPins(pins: Map<number, Pin>): void {
		this.#pins = new Map([...pins].map(([slot, pin]) => [slot, { ...pin, cwd: normalizeCwd(pin.cwd) }]));
		for (const id of this.#distribute()) {
			this.#notify(id);
		}
	}

	sessions(): Session[] {
		return [...this.#sessions.values()];
	}

	/** Deletes a session. A pinned slot it leaves goes to the next newest session of its folder, other folders keep their slots. */
	remove(sessionId: string): void {
		const session = this.#sessions.get(sessionId);
		if (!session) return;
		this.#sessions.delete(sessionId);
		const moved = this.#distribute(normalizeCwd(session.cwd));
		this.#notify(sessionId);
		for (const id of moved) {
			this.#notify(id);
		}
	}

	/** Creates idle sessions known from outside (Desktop catalog) before their first hook event. Known sessions stay untouched. */
	seed(entries: SeedEntry[]): void {
		const created = [...entries]
			.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
			.filter((entry) => !this.#sessions.has(entry.sessionId))
			.map((entry) => this.#create(entry).id);
		if (created.length === 0) return;
		for (const id of new Set([...created, ...this.#distribute()])) {
			this.#notify(id);
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

	/** Adds a session without a slot (-1); the caller places it with #distribute before notifying. */
	#create(entry: SeedEntry): Session {
		const session: Session = {
			id: entry.sessionId,
			slot: -1,
			state: "idle",
			baseState: "idle",
			pendingApprovals: 0,
			cwd: entry.cwd,
			projectName: projectNameOf(entry.cwd),
			transcriptPath: entry.transcriptPath,
			lastEventAt: entry.lastActivityAt,
			runningTurnId: this.#pendingTurnIds.get(entry.sessionId),
		};
		this.#pendingTurnIds.delete(entry.sessionId);
		this.#sessions.set(session.id, session);
		return session;
	}

	/**
	 * Placement by recency: the sessions of each pinned folder (only the given one, if any), newest event first, fill that
	 * folder's pinned slots (latestOnly slots first, then key order). Sessions pushed off those slots, and unplaced ones (slot -1),
	 * take the next free slot; everyone else keeps their slot. Changes slots only, the caller notifies afterwards,
	 * so no listener ever sees two sessions on one slot. Returns the moved session ids.
	 */
	#distribute(onlyCwd?: string): string[] {
		const sessions = [...this.#sessions.values()];
		const before = new Map(sessions.map((s) => [s, s.slot]));
		const groups = [...this.#groups()].filter(([cwd]) => onlyCwd === undefined || cwd === onlyCwd);
		const groupSlots = new Set(groups.flatMap(([, slots]) => slots));
		const target = new Map<Session, number>();
		for (const [cwd, slots] of groups) {
			const newest = sessions.filter((s) => normalizeCwd(s.cwd) === cwd).sort((a, b) => b.lastEventAt - a.lastEventAt);
			slots.forEach((slot, i) => newest[i] && target.set(newest[i], slot));
		}
		for (const s of sessions) {
			if (target.has(s) || groupSlots.has(s.slot)) s.slot = -1;
		}
		for (const [s, slot] of target) s.slot = slot;
		for (const s of sessions) {
			if (s.slot === -1) s.slot = this.#freeSlot(s.cwd);
		}
		return sessions.filter((s) => s.slot !== before.get(s)).map((s) => s.id);
	}

	/** A session just had an event: on its folder's latestOnly slot it replaces the occupant, who takes the next free slot. Returns the moved session ids. */
	#followLatest(session: Session): string[] {
		const slot = this.#groups().get(normalizeCwd(session.cwd))?.[0];
		if (slot === undefined || !this.#pins.get(slot)?.latestOnly || session.slot === slot) return [];
		const occupant = this.sessions().find((s) => s.slot === slot);
		session.slot = slot; // frees its old slot for the occupant
		if (!occupant) return [session.id];
		occupant.slot = this.#freeSlot(occupant.cwd);
		return [session.id, occupant.id];
	}

	/** Pinned slots per normalized cwd, latestOnly slots first, then in key order. */
	#groups(): Map<string, number[]> {
		const groups = new Map<string, number[]>();
		const pins = [...this.#pins].sort(([a, pa], [b, pb]) => Number(pb.latestOnly) - Number(pa.latestOnly) || a - b);
		for (const [slot, pin] of pins) {
			groups.set(pin.cwd, [...(groups.get(pin.cwd) ?? []), slot]);
		}
		return groups;
	}

	/** The first free pinned slot of this cwd in group order, else the lowest slot that is neither taken nor pinned. */
	#freeSlot(cwd: string): number {
		const taken = new Set([...this.#sessions.values()].map((s) => s.slot));
		const pinned = this.#groups().get(normalizeCwd(cwd))?.find((slot) => !taken.has(slot));
		if (pinned !== undefined) {
			return pinned;
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
