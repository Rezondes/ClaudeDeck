import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDesktopSessions } from "./session-catalog.js";

const CLI_A = "11111111-2222-3333-4444-555555555555";
const CLI_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "session-catalog-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function put(rel: string, content: unknown): Promise<void> {
	const file = path.join(root, rel);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

describe("readDesktopSessions", () => {
	it("reads valid session files recursively", async () => {
		await put("acc/org/local_one.json", { sessionId: "local_one", cliSessionId: CLI_A, cwd: "C:\\a", title: "First", lastActivityAt: "1700000000000", isArchived: "true" });
		await put("acc/org2/deep/local_two.json", { sessionId: "local_two", cliSessionId: CLI_B, cwd: "C:\\b", lastActivityAt: 1700000000001, isArchived: false });
		await put("acc/org/other.json", { sessionId: "local_x", cliSessionId: CLI_A, cwd: "C:\\x" });

		const sessions = (await readDesktopSessions([root])).sort((a, b) => a.localId.localeCompare(b.localId));

		expect(sessions).toEqual([
			{ localId: "local_one", cliSessionId: CLI_A, cwd: "C:\\a", title: "First", lastActivityAt: 1700000000000, archived: true, projectThread: false },
			{ localId: "local_two", cliSessionId: CLI_B, cwd: "C:\\b", title: "", lastActivityAt: 1700000000001, archived: false, projectThread: false },
		]);
	});

	it("skips invalid ids", async () => {
		await put("a/local_bad1.json", { sessionId: "local_bad id!", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1 });
		await put("a/local_bad2.json", { sessionId: "remote_x", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1 });
		await put("a/local_bad3.json", { sessionId: "local_ok", cliSessionId: "not-a-uuid", cwd: "C:\\a", lastActivityAt: 1 });
		await put("a/local_good.json", { sessionId: "local_good", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1 });

		expect((await readDesktopSessions([root])).map((s) => s.localId)).toEqual(["local_good"]);
	});

	it("skips broken files", async () => {
		await put("a/local_json.json", "{ not json");
		await put("a/local_null.json", "null");
		await put("a/local_nocwd.json", { sessionId: "local_nocwd", cliSessionId: CLI_A, lastActivityAt: 1 });
		await put("a/local_notime.json", { sessionId: "local_notime", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: "soon" });
		await mkdir(path.join(root, "a", "local_dir.json"));
		await put("a/local_good.json", { sessionId: "local_good", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1 });

		expect((await readDesktopSessions([root])).map((s) => s.localId)).toEqual(["local_good"]);
	});

	it("drops the placeholder title of project thread sessions", async () => {
		await put("a/local_rc.json", {
			sessionId: "local_rc",
			cliSessionId: CLI_A,
			cwd: "F:\\Code\\ClaudeDeck",
			title: "Remote Control session (from a project)",
			lastActivityAt: 1,
			remoteControlSpawn: { ccrSessionId: "cse_01abc", folder: "F:\\Code\\ClaudeDeck", projectThreadChild: true, rcChild: true },
		});

		expect((await readDesktopSessions([root])).map((s) => [s.title, s.projectThread])).toEqual([["", true]]);
	});

	it("keeps a valid cloud session id of project threads", async () => {
		const spawn = (ccrSessionId: unknown) => ({ ccrSessionId, folder: "F:\\Code\\X", projectThreadChild: true, rcChild: true });
		await put("a/local_ok.json", { sessionId: "local_ok", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1, remoteControlSpawn: spawn("cse_019LkJtuDb8E") });
		await put("a/local_bad.json", { sessionId: "local_bad", cliSessionId: CLI_B, cwd: "C:\\a", lastActivityAt: 1, remoteControlSpawn: spawn("cse_x&y=1") });

		const sessions = (await readDesktopSessions([root])).sort((a, b) => a.localId.localeCompare(b.localId));

		expect(sessions.map((s) => [s.localId, s.remoteSessionId])).toEqual([
			["local_bad", undefined],
			["local_ok", "cse_019LkJtuDb8E"],
		]);
	});

	it("returns empty list when root is missing", async () => {
		expect(await readDesktopSessions([path.join(root, "missing")])).toEqual([]);
	});

	it("merges roots and keeps the newest copy of a session", async () => {
		await put("roaming/a/local_same.json", { sessionId: "local_same", cliSessionId: CLI_A, cwd: "C:\\a", title: "Old", lastActivityAt: 1 });
		await put("msix/a/local_same.json", { sessionId: "local_same", cliSessionId: CLI_A, cwd: "C:\\a", title: "New", lastActivityAt: 2 });
		await put("msix/a/local_other.json", { sessionId: "local_other", cliSessionId: CLI_B, cwd: "C:\\b", lastActivityAt: 1 });

		const sessions = await readDesktopSessions([path.join(root, "roaming"), path.join(root, "msix")]);

		expect(sessions.map((s) => [s.localId, s.title]).sort()).toEqual([
			["local_other", ""],
			["local_same", "New"],
		]);
	});
});
