import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DesktopSession } from "../desktop/session-catalog.js";
import { normalizeCwd, projectNameOf, type SessionState } from "../domain/session-store.js";
import type { ProjectSummary, ThreadState } from "./project-source.js";

export function defaultRemoteControlState(): string {
	return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "remote-control-state.json");
}

/** Folders Claude Desktop serves to projects via Remote Control (remote-control-state.json "folders"); [] when unreadable. */
export async function readProjectFolders(file = defaultRemoteControlState()): Promise<string[]> {
	try {
		const folders = (JSON.parse(await readFile(file, "utf8")) as { folders?: unknown } | null)?.folders;
		return folders && typeof folders === "object" ? Object.keys(folders) : [];
	} catch {
		return []; // internal Desktop format: missing or broken means no folders
	}
}

const THREAD_STATES: Record<SessionState, ThreadState> = {
	approval: "input",
	input: "input",
	error: "error",
	working: "working",
	done: "done",
	idle: "idle",
};

/**
 * One project per served folder, named after the folder. Its threads are the non-archived sessions project threads
 * started on this PC in that folder. Pure cloud threads and the "resolved" flag are not visible locally (PLAN.md, Package 32).
 */
export function localProjects(folders: string[], catalog: DesktopSession[], stateOf: (cliSessionId: string) => SessionState | undefined): ProjectSummary[] {
	return folders.map((folder) => {
		const key = normalizeCwd(folder);
		const threads = catalog
			.filter((s) => s.projectThread && !s.archived && normalizeCwd(s.cwd) === key)
			.map((s) => ({ id: s.cliSessionId, title: s.title, state: THREAD_STATES[stateOf(s.cliSessionId) ?? "idle"] }));
		return { id: folder, name: projectNameOf(folder) || folder, threads };
	});
}
