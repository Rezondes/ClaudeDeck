import type { HookEventName, ModuleEventName } from "../server/hook-contract.js";

/** Fields of a Claude Code hook payload that ClaudeDeck reads (docs/spike-results.md, AC5). */
export interface HookEvent {
	hook_event_name: HookEventName;
	session_id: string;
	transcript_path: string;
	cwd: string;
	/** Missing on SessionEnd. */
	permission_mode?: string;
	/** PreToolUse, PostToolUse, PermissionRequest. */
	tool_name?: string;
	/** Notification only. Not seen in the spike, read defensively. */
	notification_type?: string;
	/** Stop only: background agents/tasks still running when the main agent's turn ended. */
	background_tasks?: unknown[];
	/** StopFailure only: why the turn ended, e.g. "rate_limit", "overloaded", "server_error", "unknown". */
	error?: string;
}

/** Fields the plugin module (claude-module/hooks/register.ts) posts; only sessionId is checked by the hook server. */
export interface ModuleEvent {
	name: ModuleEventName;
	sessionId: string;
	/** session-start */
	cwd?: string;
	/** turn-start */
	turnId?: string;
	/** usage: $.session.usage().context */
	context?: { tokens?: number; window?: number; percent?: number };
	/** usage: $.session.usage().rateLimits, e.g. { kind: "five_hour", percentUsed: 85, resetsAt } */
	rateLimits?: unknown[];
	/** usage: true for the timed report (Package 29), which must not end the running turn. */
	periodic?: boolean;
}
