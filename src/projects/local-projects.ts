import { readFile } from "node:fs/promises";
import path from "node:path";

import { claudeDataDirs } from "../desktop/claude-data.js";
import type { DesktopSession } from "../desktop/session-catalog.js";
import { normalizeCwd, projectNameOf, type SessionState } from "../domain/session-store.js";
import type { ProjectSummary, ThreadState } from "./project-source.js";

const keysOf = (value: unknown) => (value && typeof value === "object" ? Object.keys(value) : []);

async function foldersIn(file: string): Promise<string[]> {
	try {
		const state = JSON.parse(await readFile(file, "utf8")) as { identities?: unknown } | null;
		const identities = state?.identities && typeof state.identities === "object" ? Object.values(state.identities) : [];
		return identities.flatMap((identity) => keysOf((identity as { folders?: unknown } | null)?.folders));
	} catch {
		return []; // internal Desktop format: missing or broken means no folders
	}
}

/**
 * Folders Claude Desktop serves to projects via Remote Control: remote-control-state.json keeps them per signed-in
 * identity under identities["<org>:<account>"].folders. Union of all candidate files, deduplicated.
 */
export async function readProjectFolders(files?: string[]): Promise<string[]> {
	const lists = await Promise.all((files ?? (await claudeDataDirs()).map((dir) => path.join(dir, "remote-control-state.json"))).map(foldersIn));
	return [...new Set(lists.flat())];
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
			.map((s) => ({ id: s.cliSessionId, localId: s.localId, title: s.title, state: THREAD_STATES[stateOf(s.cliSessionId) ?? "idle"], lastActivityAt: s.lastActivityAt, remoteId: s.remoteSessionId }));
		return { id: folder, name: projectNameOf(folder) || folder, threads };
	});
}
