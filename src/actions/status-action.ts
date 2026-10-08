import os from "node:os";
import path from "node:path";

import type { DesktopSession } from "../desktop/session-catalog.js";
import type { HookEvent } from "../domain/hook-event.js";
import { normalizeCwd, type Pin, type Session, type SessionStore } from "../domain/session-store.js";
import { renderEmptyStatusKey, renderStatusKey, toDataUrl } from "../render/status-key.js";
import type { KeyView } from "./key-view.js";
import { SlotRegistry, type Coordinates } from "./slot-registry.js";

/** Property inspector settings of a status key. */
export type StatusSettings = {
	/** Project folder pinned to this key, e.g. "F:\Code\ClaudeDeck". */
	project?: string;
	/** The key always shows the pinned folder's session with the newest event. */
	latestOnly?: boolean;
};

export type ReadContext = (transcriptPath: string) => Promise<number | null>;

const FLASH_MS = 500;
const CONTEXT_THROTTLE_MS = 2000;
const CONTEXT_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
/** Holding a status key this long aborts the session's running turn instead of opening it (PLAN.md, Package 27). */
const LONG_PRESS_MS = 600;
const SEED_INTERVAL_MS = 60_000;
const SEED_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Claude Code transcript of a session: every non-alphanumeric character of cwd becomes "-". */
export function transcriptPathFor(cwd: string, cliSessionId: string, home = os.homedir()): string {
	return path.join(home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${cliSessionId}.jsonl`);
}

/** Non-archived sessions active in the last 12 h, plus the n newest non-archived sessions of each folder pinned to n keys. */
function sessionsToSeed(catalog: DesktopSession[], pinnedFolders: string[], now: number): DesktopSession[] {
	const live = catalog.filter((s) => !s.archived).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	const folders = pinnedFolders.map(normalizeCwd);
	const newestPinned = [...new Set(folders)].flatMap((folder) => {
		const keyCount = folders.filter((f) => f === folder).length;
		return live.filter((s) => normalizeCwd(s.cwd) === folder).slice(0, keyCount);
	});
	const recent = live.filter((s) => now - s.lastActivityAt <= SEED_MAX_AGE_MS);
	return [...new Set([...recent, ...newestPinned])];
}

/** Claude Status keys: one session per key, ordered by key position. */
export class StatusKeys {
	readonly #views = new Map<string, KeyView>();
	readonly #pins = new Map<string, Pin>();
	readonly #slots = new SlotRegistry();
	readonly #context = new Map<string, number>();
	readonly #lastRead = new Map<string, number>();
	/** Slot each session was last rendered on, to clear it when the session moves or ends. */
	readonly #renderedSlot = new Map<string, number>();
	readonly #flashTimers = new Map<string, ReturnType<typeof setInterval>>();
	readonly #flashOn = new Map<string, boolean>();
	/** Key id -> when it went down, to tell a short press from a long one on release. */
	readonly #downAt = new Map<string, number>();
	/** cliSessionId -> Desktop local id, from the last catalog read. */
	#localIds = new Map<string, string>();

	constructor(
		private readonly store: SessionStore,
		private readonly readContext: ReadContext,
		private readonly now: () => number = Date.now,
		/** Brings the session's window forward; resolves false when no window matched. */
		private readonly focusProject: (project: string) => Promise<boolean> = async () => false,
		/** Desktop session catalog, used to fill keys before a session sends its first hook event. */
		private readonly listDesktopSessions: () => Promise<DesktopSession[]> = async () => [],
		/** Opens a Desktop session by its local id; resolves false when that did not work. */
		private readonly openSession: (localId: string) => Promise<boolean> = async () => false,
		/** Opens "Sessions Waiting for You" in Claude Desktop; resolves false when that did not work. */
		private readonly openNeedsInput: () => Promise<boolean> = async () => false,
		/** Queues an abort of the turn for the session's module; `onExpired` runs when no module fetched it. */
		private readonly queueAbort: (sessionId: string, turnId: string, onExpired: () => void) => void = () => {},
	) {
		store.onChange((sessionId) => this.#sessionChanged(sessionId));
		setInterval(() => void this.seed(), SEED_INTERVAL_MS);
	}

	appear(view: KeyView, coordinates: Coordinates | undefined, settings: StatusSettings): void {
		this.#views.set(view.id, view);
		this.#slots.add(view.id, coordinates);
		this.#setPin(view.id, settings);
		this.#applyPins();
		this.renderAll();
		void this.seed();
	}

	/** Shows recent and pinned Desktop sessions as idle and reads their context once. A failing catalog changes nothing. */
	async seed(): Promise<void> {
		let catalog: DesktopSession[];
		try {
			catalog = await this.listDesktopSessions();
		} catch {
			return;
		}
		this.#localIds = new Map(catalog.map((s) => [s.cliSessionId, s.localId]));
		const selected = sessionsToSeed(catalog, [...this.#pins.values()].map((pin) => pin.cwd), this.now());
		// Idle catalog sessions that left the selection (aged out, archived, unpinned) free their slot; CLI sessions are not in the catalog.
		const keep = new Set(selected.map((s) => s.cliSessionId));
		const inCatalog = new Set(catalog.map((s) => s.cliSessionId));
		for (const session of this.store.sessions()) {
			if (session.state === "idle" && inCatalog.has(session.id) && !keep.has(session.id)) this.store.remove(session.id);
		}
		const entries = selected
			.filter((s) => !this.store.get(s.cliSessionId))
			.map((s) => ({ sessionId: s.cliSessionId, cwd: s.cwd, transcriptPath: transcriptPathFor(s.cwd, s.cliSessionId), lastActivityAt: s.lastActivityAt }));
		this.store.seed(entries);
		this.store.setTitles(new Map(catalog.map((s) => [s.cliSessionId, s.title])));
		for (const entry of entries) this.#readContext(entry.sessionId, entry.transcriptPath);
	}

	disappear(id: string): void {
		this.#views.delete(id);
		this.#slots.remove(id);
		this.#pins.delete(id);
		this.#stopFlash(id);
		this.#applyPins();
		this.renderAll();
	}

	settingsChanged(id: string, settings: StatusSettings): void {
		this.#setPin(id, settings);
		this.#applyPins();
		this.renderAll();
		void this.seed();
	}

	/** The session shown on this key, if any. */
	sessionOf(view: KeyView): Session | undefined {
		return this.#sessionOn(view.id);
	}

	press(view: KeyView): void {
		this.#downAt.set(view.id, this.now());
	}

	/** Short press opens the session, long press aborts its running turn. */
	release(view: KeyView): void {
		const downAt = this.#downAt.get(view.id);
		this.#downAt.delete(view.id);
		if (downAt === undefined) return;
		if (this.now() - downAt >= LONG_PRESS_MS) this.#abort(view);
		else this.#open(view);
	}

	#abort(view: KeyView): void {
		const session = this.sessionOf(view);
		if (session?.state !== "working" || !session.runningTurnId) {
			view.showAlert();
			return;
		}
		this.queueAbort(session.id, session.runningTurnId, () => view.showAlert());
	}

	#open(view: KeyView): void {
		const session = this.sessionOf(view);
		const attempt = (show: () => Promise<boolean>) => show().catch(() => false);
		if (!session) {
			// An empty key showing "N waiting" leads to the sessions without a key.
			if (this.#waitingWithoutKey() > 0) attempt(this.openNeedsInput).then((shown) => shown || view.showAlert()).catch(() => {});
			return;
		}
		this.store.keyPressed(session.id);
		const localId = this.#localIds.get(session.id);
		const focus = () => attempt(() => this.focusProject(session.projectName));
		// Deep link first for Desktop sessions, window focus as fallback (and for CLI sessions); alert only when both fail.
		(localId ? attempt(() => this.openSession(localId)).then((opened) => opened || focus()) : focus())
			.then((shown) => shown || view.showAlert())
			.catch(() => {});
	}

	/** Every hook event; refreshes the context percent after prompts, tool use and stops. */
	hookEvent(event: HookEvent): void {
		const known = this.#context.has(event.session_id);
		if (event.hook_event_name === "SessionEnd" || (known && !CONTEXT_EVENTS.has(event.hook_event_name))) return;
		// Stop always reads: it is the last event of a turn, a throttled skip would leave a stale value for hours.
		const last = this.#lastRead.get(event.session_id);
		if (event.hook_event_name !== "Stop" && last !== undefined && this.now() - last < CONTEXT_THROTTLE_MS) return;
		this.#readContext(event.session_id, event.transcript_path);
	}

	renderAll(): void {
		for (const id of this.#views.keys()) this.#render(id);
	}

	#readContext(sessionId: string, transcriptPath: string): void {
		// The module's exact value replaces the transcript estimate for this session.
		if (this.store.get(sessionId)?.moduleContext?.percent !== undefined) return;
		this.#lastRead.set(sessionId, this.now());
		this.readContext(transcriptPath).then((percent) => {
			const session = this.store.get(sessionId);
			if (percent === null || !session) return;
			this.#context.set(sessionId, percent);
			this.#renderSlot(session.slot);
		});
	}

	#setPin(id: string, settings: StatusSettings): void {
		const project = settings.project?.trim();
		if (project) this.#pins.set(id, { cwd: project, latestOnly: settings.latestOnly ?? false });
		else this.#pins.delete(id);
	}

	#applyPins(): void {
		const pins = new Map<number, Pin>();
		for (const [id, pin] of this.#pins) {
			const slot = this.#slots.slotOf(id);
			if (slot !== undefined) pins.set(slot, pin);
		}
		this.store.setPins(pins);
	}

	#sessionChanged(sessionId: string): void {
		const before = this.#renderedSlot.get(sessionId);
		const session = this.store.get(sessionId);
		if (!session) {
			this.#context.delete(sessionId);
			this.#lastRead.delete(sessionId);
			this.#renderedSlot.delete(sessionId);
		}
		if (before !== undefined && before !== session?.slot) this.#renderSlot(before);
		if (session) this.#renderSlot(session.slot);
		// The waiting count on empty keys depends on every session.
		for (const id of this.#views.keys()) if (!this.#sessionOn(id)) this.#render(id);
	}

	#sessionOn(id: string): Session | undefined {
		const slot = this.#slots.slotOf(id);
		return this.store.sessions().find((s) => s.slot === slot);
	}

	/** Sessions that need the user (input or approval) but sit on a slot beyond the last key. */
	#waitingWithoutKey(): number {
		const keyCount = this.#slots.ids().length;
		return this.store.sessions().filter((s) => s.slot >= keyCount && (s.state === "input" || s.state === "approval")).length;
	}

	#renderSlot(slot: number): void {
		const id = this.#slots.idAt(slot);
		if (id) this.#render(id);
	}

	#render(id: string): void {
		const view = this.#views.get(id);
		if (!view) return;
		const session = this.#sessionOn(id);
		if (!session) {
			this.#stopFlash(id);
			view.setImage(toDataUrl(renderEmptyStatusKey(this.#waitingWithoutKey())));
			return;
		}
		this.#renderedSlot.set(session.id, session.slot);
		if (session.state === "approval" || session.state === "input") this.#startFlash(id);
		else this.#stopFlash(id);
		const flash = this.#flashOn.get(id) ?? false;
		view.setImage(
			toDataUrl(renderStatusKey({ project: session.projectName, title: session.title, state: session.state, errorKind: session.errorKind, contextPercent: session.moduleContext?.percent ?? this.#context.get(session.id) ?? null, flash })),
		);
	}

	#startFlash(id: string): void {
		if (this.#flashTimers.has(id)) return;
		this.#flashTimers.set(
			id,
			setInterval(() => {
				this.#flashOn.set(id, !this.#flashOn.get(id));
				this.#render(id);
			}, FLASH_MS),
		);
	}

	#stopFlash(id: string): void {
		clearInterval(this.#flashTimers.get(id));
		this.#flashTimers.delete(id);
		this.#flashOn.delete(id);
	}
}
