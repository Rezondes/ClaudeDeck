import os from "node:os";
import path from "node:path";

import type { DesktopSession } from "../desktop/session-catalog.js";
import type { HookEvent } from "../domain/hook-event.js";
import { normalizeCwd, type Session, type SessionStore } from "../domain/session-store.js";
import { renderEmptyStatusKey, renderStatusKey, toDataUrl } from "../render/status-key.js";
import type { KeyView } from "./key-view.js";
import { SlotRegistry, type Coordinates } from "./slot-registry.js";

/** Property inspector settings of a status key. */
export type StatusSettings = {
	/** Project folder pinned to this key, e.g. "F:\Code\ClaudeDeck". */
	project?: string;
};

export type ReadContext = (transcriptPath: string) => Promise<number | null>;

const FLASH_MS = 500;
const CONTEXT_THROTTLE_MS = 2000;
const CONTEXT_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
const SEED_INTERVAL_MS = 60_000;
const SEED_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Claude Code transcript of a session: every non-alphanumeric character of cwd becomes "-". */
export function transcriptPathFor(cwd: string, cliSessionId: string, home = os.homedir()): string {
	return path.join(home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${cliSessionId}.jsonl`);
}

/** Non-archived sessions active in the last 12 h, plus the newest non-archived session of each pinned folder. */
function sessionsToSeed(catalog: DesktopSession[], pinnedFolders: string[], now: number): DesktopSession[] {
	const live = catalog.filter((s) => !s.archived).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	const newestPinned = pinnedFolders.map((folder) => live.find((s) => normalizeCwd(s.cwd) === normalizeCwd(folder)));
	const recent = live.filter((s) => now - s.lastActivityAt <= SEED_MAX_AGE_MS);
	return [...new Set([...recent, ...newestPinned])].filter((s): s is DesktopSession => s !== undefined);
}

/** Claude Status keys: one session per key, ordered by key position. */
export class StatusKeys {
	readonly #views = new Map<string, KeyView>();
	readonly #pins = new Map<string, string>();
	readonly #slots = new SlotRegistry();
	readonly #context = new Map<string, number>();
	readonly #lastRead = new Map<string, number>();
	/** Slot each session was last rendered on, to clear it when the session moves or ends. */
	readonly #renderedSlot = new Map<string, number>();
	readonly #flashTimers = new Map<string, ReturnType<typeof setInterval>>();
	readonly #flashOn = new Map<string, boolean>();

	constructor(
		private readonly store: SessionStore,
		private readonly readContext: ReadContext,
		private readonly now: () => number = Date.now,
		/** Brings the session's window forward; resolves false when no window matched. */
		private readonly focusProject: (project: string) => Promise<boolean> = async () => false,
		/** Desktop session catalog, used to fill keys before a session sends its first hook event. */
		private readonly listDesktopSessions: () => Promise<DesktopSession[]> = async () => [],
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
		const selected = sessionsToSeed(catalog, [...this.#pins.values()], this.now());
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
		const slot = this.#slots.slotOf(view.id);
		return this.store.sessions().find((s) => s.slot === slot);
	}

	press(view: KeyView): void {
		const session = this.sessionOf(view);
		if (!session) return;
		this.store.keyPressed(session.id);
		this.focusProject(session.projectName)
			.catch(() => false)
			.then((focused) => focused || view.showAlert())
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
		if (project) this.#pins.set(id, project);
		else this.#pins.delete(id);
	}

	#applyPins(): void {
		const pins = new Map<number, string>();
		for (const [id, project] of this.#pins) {
			const slot = this.#slots.slotOf(id);
			if (slot !== undefined) pins.set(slot, project);
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
	}

	#renderSlot(slot: number): void {
		const id = this.#slots.idAt(slot);
		if (id) this.#render(id);
	}

	#render(id: string): void {
		const view = this.#views.get(id);
		if (!view) return;
		const slot = this.#slots.slotOf(id);
		const session = this.store.sessions().find((s) => s.slot === slot);
		if (!session) {
			this.#stopFlash(id);
			view.setImage(toDataUrl(renderEmptyStatusKey()));
			return;
		}
		this.#renderedSlot.set(session.id, session.slot);
		if (session.state === "approval" || session.state === "input") this.#startFlash(id);
		else this.#stopFlash(id);
		const flash = this.#flashOn.get(id) ?? false;
		view.setImage(
			toDataUrl(renderStatusKey({ project: session.projectName, title: session.title, state: session.state, contextPercent: this.#context.get(session.id) ?? null, flash })),
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
