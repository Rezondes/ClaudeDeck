import type { HookEventName } from "../server/hook-contract.js";

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
}
