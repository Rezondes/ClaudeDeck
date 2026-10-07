import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCatalogRoot, readDesktopSessions } from "./session-catalog.js";

const CLI_A = "11111111-2222-3333-4444-555555555555";
const CLI_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "session-catalog-"));
});

afterEach(async () => {
	vi.unstubAllEnvs();
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

		const sessions = (await readDesktopSessions(root)).sort((a, b) => a.localId.localeCompare(b.localId));

		expect(sessions).toEqual([
			{ localId: "local_one", cliSessionId: CLI_A, cwd: "C:\\a", title: "First", lastActivityAt: 1700000000000, archived: true },
			{ localId: "local_two", cliSessionId: CLI_B, cwd: "C:\\b", title: "", lastActivityAt: 1700000000001, archived: false },
		]);
	});

	it("skips invalid ids", async () => {
		await put("a/local_bad1.json", { sessionId: "local_bad id!", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1 });
		await put("a/local_bad2.json", { sessionId: "remote_x", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1 });
		await put("a/local_bad3.json", { sessionId: "local_ok", cliSessionId: "not-a-uuid", cwd: "C:\\a", lastActivityAt: 1 });
		await put("a/local_good.json", { sessionId: "local_good", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1 });

		expect((await readDesktopSessions(root)).map((s) => s.localId)).toEqual(["local_good"]);
	});

	it("skips broken files", async () => {
		await put("a/local_json.json", "{ not json");
		await put("a/local_null.json", "null");
		await put("a/local_nocwd.json", { sessionId: "local_nocwd", cliSessionId: CLI_A, lastActivityAt: 1 });
		await put("a/local_notime.json", { sessionId: "local_notime", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: "soon" });
		await mkdir(path.join(root, "a", "local_dir.json"));
		await put("a/local_good.json", { sessionId: "local_good", cliSessionId: CLI_A, cwd: "C:\\a", lastActivityAt: 1 });

		expect((await readDesktopSessions(root)).map((s) => s.localId)).toEqual(["local_good"]);
	});

	it("returns empty list when root is missing", async () => {
		expect(await readDesktopSessions(path.join(root, "missing"))).toEqual([]);
	});

	it("defaults to APPDATA claude-code-sessions", () => {
		vi.stubEnv("APPDATA", path.join("X:", "AppData", "Roaming"));
		expect(defaultCatalogRoot()).toBe(path.join("X:", "AppData", "Roaming", "Claude", "claude-code-sessions"));
	});
});
