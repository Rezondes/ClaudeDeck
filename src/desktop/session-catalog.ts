import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type DesktopSession = {
	localId: string;
	cliSessionId: string;
	cwd: string;
	title: string;
	lastActivityAt: number;
	archived: boolean;
};

const LOCAL_ID = /^local_[A-Za-z0-9-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ponytail: hard cap on files read per scan; raise it or cache by mtime if someone really has more sessions.
const MAX_FILES = 2000;

export function defaultCatalogRoot(): string {
	return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude-code-sessions");
}

export async function readDesktopSessions(root = defaultCatalogRoot()): Promise<DesktopSession[]> {
	const files: string[] = [];
	await collectFiles(root, files);
	const sessions: DesktopSession[] = [];
	for (const file of files) {
		try {
			const session = toDesktopSession(JSON.parse(await readFile(file, "utf8")));
			if (session) sessions.push(session);
		} catch {
			// internal Desktop format: unreadable or broken files are skipped
		}
	}
	return sessions;
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
	const { sessionId, cliSessionId, cwd, title, lastActivityAt, isArchived } = raw as Record<string, unknown>;
	if (typeof sessionId !== "string" || !LOCAL_ID.test(sessionId)) return null;
	if (typeof cliSessionId !== "string" || !UUID.test(cliSessionId)) return null;
	if (typeof cwd !== "string" || !cwd) return null;
	const time = typeof lastActivityAt === "number" || (typeof lastActivityAt === "string" && lastActivityAt.trim()) ? Number(lastActivityAt) : NaN;
	if (!Number.isFinite(time)) return null;
	return {
		localId: sessionId,
		cliSessionId,
		cwd,
		title: typeof title === "string" ? title : "",
		lastActivityAt: time,
		archived: isArchived === true || isArchived === "true",
	};
}
