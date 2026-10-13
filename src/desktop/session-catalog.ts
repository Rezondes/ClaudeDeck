import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { claudeDataDirs } from "./claude-data.js";

export type DesktopSession = {
	localId: string;
	cliSessionId: string;
	cwd: string;
	title: string;
	lastActivityAt: number;
	archived: boolean;
	/** Started on this PC by a project thread via Remote Control (remoteControlSpawn.projectThreadChild). */
	projectThread: boolean;
};

/** Desktop local session id, same rule as the Desktop claude:// URL handler. */
export const LOCAL_ID = /^local_[A-Za-z0-9-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ponytail: hard cap on files read per scan; raise it or cache by mtime if someone really has more sessions.
const MAX_FILES = 2000;
/** Title Desktop gives a session a project thread starts on this PC via Remote Control, until it gets a real one. */
const PROJECT_PLACEHOLDER_TITLE = "Remote Control session (from a project)";

export async function catalogRoots(): Promise<string[]> {
	return (await claudeDataDirs()).map((dir) => path.join(dir, "claude-code-sessions"));
}

/** Sessions from all roots, one per localId; if a session is in several roots, the newest lastActivityAt wins. */
export async function readDesktopSessions(roots?: string[]): Promise<DesktopSession[]> {
	const files: string[] = [];
	for (const root of roots ?? (await catalogRoots())) await collectFiles(root, files);
	const sessions = new Map<string, DesktopSession>();
	for (const file of files) {
		try {
			const session = toDesktopSession(JSON.parse(await readFile(file, "utf8")));
			const known = session && sessions.get(session.localId);
			if (session && (!known || session.lastActivityAt > known.lastActivityAt)) sessions.set(session.localId, session);
		} catch {
			// internal Desktop format: unreadable or broken files are skipped
		}
	}
	return [...sessions.values()];
}

async function collectFiles(dir: string, files: string[]): Promise<void> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return; // missing root or unreadable directory
	}
	for (const entry of entries) {
		if (files.length >= MAX_FILES) return;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) await collectFiles(full, files);
		else if (entry.isFile() && entry.name.startsWith("local_") && entry.name.endsWith(".json")) files.push(full);
	}
}

function toDesktopSession(raw: unknown): DesktopSession | null {
	if (!raw || typeof raw !== "object") return null;
	const { sessionId, cliSessionId, cwd, title, lastActivityAt, isArchived, remoteControlSpawn } = raw as Record<string, unknown>;
	if (typeof sessionId !== "string" || !LOCAL_ID.test(sessionId)) return null;
	if (typeof cliSessionId !== "string" || !UUID.test(cliSessionId)) return null;
	if (typeof cwd !== "string" || !cwd) return null;
	const time = typeof lastActivityAt === "number" || (typeof lastActivityAt === "string" && lastActivityAt.trim()) ? Number(lastActivityAt) : NaN;
	if (!Number.isFinite(time)) return null;
	return {
		localId: sessionId,
		cliSessionId,
		cwd,
		title: typeof title === "string" && title !== PROJECT_PLACEHOLDER_TITLE ? title : "",
		lastActivityAt: time,
		archived: isArchived === true || isArchived === "true",
		projectThread: (remoteControlSpawn as { projectThreadChild?: unknown } | null)?.projectThreadChild === true,
	};
}
