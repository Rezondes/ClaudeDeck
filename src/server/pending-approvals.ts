import { projectNameOf } from "../domain/session-store.js";
import type { HookEvent } from "../domain/hook-event.js";
import { APPROVAL_TIMEOUT_SECONDS } from "./hook-contract.js";

/** A permission suggestion from Claude Code, e.g. addRules, addDirectories or setMode (docs/spike-results.md). */
export interface PermissionUpdate {
	type: string;
	destination?: string;
	[key: string]: unknown;
}

export interface PermissionRequestEvent extends HookEvent {
	hook_event_name: "PermissionRequest";
	tool_name: string;
	tool_input: Record<string, unknown>;
	permission_suggestions?: PermissionUpdate[];
}

export interface PendingApproval {
	id: number;
	sessionId: string;
	project: string;
	toolName: string;
	toolInput: Record<string, unknown>;
}

/** JSON body for the hook response. `{}` means "no decision": Claude Code shows its normal prompt. */
export type HookResponse = object;

interface Entry extends PendingApproval {
	suggestions: PermissionUpdate[];
	respond: (response: HookResponse) => void;
	timer: ReturnType<typeof setTimeout>;
}

const decision = (value: object): HookResponse => ({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: value } });

/** Permission requests waiting for a key press, oldest first. */
export class PendingApprovals {
	readonly #entries: Entry[] = [];
	readonly #changeListeners: (() => void)[] = [];
	readonly #settledListeners: ((sessionId: string) => void)[] = [];
	#nextId = 1;

	get count(): number {
		return this.#entries.length;
	}

	oldest(): PendingApproval | undefined {
		const entry = this.#entries[0];
		return entry && { id: entry.id, sessionId: entry.sessionId, project: entry.project, toolName: entry.toolName, toolInput: entry.toolInput };
	}

	/** Fires after any add or settle, for re-rendering keys. */
	onChange(listener: () => void): void {
		this.#changeListeners.push(listener);
	}

	/** Fires once per request when it ends: decided, timed out or cancelled. */
	onSettled(listener: (sessionId: string) => void): void {
		this.#settledListeners.push(listener);
	}

	add(event: PermissionRequestEvent, respond: (response: HookResponse) => void): number {
		const id = this.#nextId++;
		this.#entries.push({
			id,
			sessionId: event.session_id,
			project: projectNameOf(event.cwd),
			toolName: event.tool_name,
			toolInput: event.tool_input ?? {},
			suggestions: event.permission_suggestions ?? [],
			respond,
			timer: setTimeout(() => this.#settle(id, {}), APPROVAL_TIMEOUT_SECONDS * 1000),
		});
		this.#emitChange();
		return id;
	}

	approve(): void {
		this.#settleOldest(() => decision({ behavior: "allow" }));
	}

	/** Allow and keep allowing this kind of request for the rest of the session. Never forwards setMode. */
	approveAlways(): void {
		this.#settleOldest((entry) => {
			const updates: PermissionUpdate[] = entry.suggestions
				.filter((s) => s.type === "addRules" || s.type === "addDirectories")
				.map((s) => ({ ...s, destination: "session" }));
			if (updates.length === 0) {
				updates.push({ type: "addRules", rules: [{ toolName: entry.toolName }], behavior: "allow", destination: "session" });
			}
			return decision({ behavior: "allow", updatedPermissions: updates });
		});
	}

	/** Allow and switch the session's permission mode (Package 11, docs/spike-results.md). */
	approveWithMode(mode: string): void {
		this.#settleOldest(() => decision({ behavior: "allow", updatedPermissions: [{ type: "setMode", mode, destination: "session" }] }));
	}

	deny(): void {
		this.#settleOldest(() => decision({ behavior: "deny", message: "Denied via ClaudeDeck" }));
	}

	/** The client gave up (connection closed): drop the request without answering. */
	cancel(id: number): void {
		this.#settle(id, undefined);
	}

	#settleOldest(build: (entry: Entry) => HookResponse): void {
		const entry = this.#entries[0];
		if (entry) {
			this.#settle(entry.id, build(entry));
		}
	}

	#settle(id: number, response: HookResponse | undefined): void {
		const index = this.#entries.findIndex((e) => e.id === id);
		if (index < 0) {
			return;
		}
		const [entry] = this.#entries.splice(index, 1);
		clearTimeout(entry.timer);
		if (response) {
			entry.respond(response);
		}
		for (const listener of this.#settledListeners) {
			listener(entry.sessionId);
		}
		this.#emitChange();
	}

	#emitChange(): void {
		for (const listener of this.#changeListeners) {
			listener();
		}
	}
}
