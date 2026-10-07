/** A command for the plugin module of one session, served by GET /module/commands (PLAN.md, Package 27). */
export type ModuleCommand = { kind: "abort"; turnId: string; at: number };

const EXPIRY_MS = 10_000;

type Entry = { command: ModuleCommand; onExpired: () => void };

/** Commands waiting for a session's module to fetch them; each is delivered once or expires after 10 s. */
export class CommandQueue {
	readonly #entries = new Map<string, Entry[]>();

	constructor(private readonly now: () => number) {}

	/** Queues an abort of `turnId`; `onExpired` runs when no module fetched it in time. */
	add(sessionId: string, turnId: string, onExpired: () => void): void {
		const entries = this.#entries.get(sessionId) ?? [];
		entries.push({ command: { kind: "abort", turnId, at: this.now() }, onExpired });
		this.#entries.set(sessionId, entries);
	}

	/** Removes and returns the session's unexpired commands. */
	take(sessionId: string): ModuleCommand[] {
		this.expire();
		const entries = this.#entries.get(sessionId) ?? [];
		this.#entries.delete(sessionId);
		return entries.map((entry) => entry.command);
	}

	/** Drops commands older than 10 s and tells their requesters. */
	expire(): void {
		for (const [sessionId, entries] of this.#entries) {
			const live = entries.filter((entry) => this.now() - entry.command.at < EXPIRY_MS);
			for (const entry of entries) if (!live.includes(entry)) entry.onExpired();
			if (live.length > 0) this.#entries.set(sessionId, live);
			else this.#entries.delete(sessionId);
		}
	}
}
