import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DesktopSession } from "../desktop/session-catalog.js";
import { localProjects, readProjectFolders, remoteControlStateFiles } from "./local-projects.js";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "rc-state-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("readProjectFolders", () => {
	it("lists the served folders of all identities once", async () => {
		const file = path.join(dir, "remote-control-state.json");
		await writeFile(
			file,
			JSON.stringify({
				version: 1,
				identities: {
					"org:acc1": { serve: "on", folders: { "F:\\Code\\ClaudeDeck": { environmentId: "env_1", keys: [] }, "F:\\Code\\Web": {} } },
					"org:acc2": { folders: { "F:\\Code\\Web": {} } },
					"org:acc3": { serve: "off" },
				},
			}),
		);
		expect(await readProjectFolders([file])).toEqual(["F:\\Code\\ClaudeDeck", "F:\\Code\\Web"]);
	});

	it("is empty when the file is missing or broken", async () => {
		const file = path.join(dir, "broken.json");
		await writeFile(file, "{ nope");
		expect(await readProjectFolders([path.join(dir, "missing.json"), file])).toEqual([]);
	});

	it("merges the roaming and the MSIX-virtualized file", async () => {
		const a = path.join(dir, "a.json");
		const b = path.join(dir, "b.json");
		await writeFile(a, JSON.stringify({ identities: { x: { folders: { "F:\\A": {} } } } }));
		await writeFile(b, JSON.stringify({ identities: { x: { folders: { "F:\\A": {}, "F:\\B": {} } } } }));
		expect(await readProjectFolders([a, b])).toEqual(["F:\\A", "F:\\B"]);
	});
});

describe("remoteControlStateFiles", () => {
	it("checks APPDATA and every Claude MSIX package", async () => {
		await mkdir(path.join(dir, "Local", "Packages", "Claude_pzs8sxrjxfjjc"), { recursive: true });
		await mkdir(path.join(dir, "Local", "Packages", "Other_123"), { recursive: true });
		const files = await remoteControlStateFiles({ APPDATA: path.join(dir, "Roaming"), LOCALAPPDATA: path.join(dir, "Local") }, dir);
		expect(files).toEqual([
			path.join(dir, "Roaming", "Claude", "remote-control-state.json"),
			path.join(dir, "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude", "remote-control-state.json"),
		]);
	});
});

const session = (cliSessionId: string, cwd: string, extra: Partial<DesktopSession> = {}): DesktopSession => ({
	localId: `local_${cliSessionId}`,
	cliSessionId,
	cwd,
	title: "",
	lastActivityAt: 0,
	archived: false,
	projectThread: true,
	...extra,
});

describe("localProjects", () => {
	it("counts the open project threads per folder with their live state", () => {
		const catalog = [
			session("a", "F:\\Code\\ClaudeDeck"),
			session("b", "f:/code/claudedeck/"),
			session("c", "F:\\Code\\ClaudeDeck", { archived: true }),
			session("d", "F:\\Code\\ClaudeDeck", { projectThread: false }),
			session("e", "F:\\Code\\Web"),
		];
		const states: Record<string, "approval" | "working"> = { a: "approval", e: "working" };
		const projects = localProjects(["F:\\Code\\ClaudeDeck", "F:\\Code\\Web\\", "F:\\Code\\Empty"], catalog, (id) => states[id]);
		expect(projects).toEqual([
			{
				id: "F:\\Code\\ClaudeDeck",
				name: "ClaudeDeck",
				threads: [
					{ id: "a", title: "", state: "input" },
					{ id: "b", title: "", state: "idle" },
				],
			},
			{ id: "F:\\Code\\Web\\", name: "Web", threads: [{ id: "e", title: "", state: "working" }] },
			{ id: "F:\\Code\\Empty", name: "Empty", threads: [] },
		]);
	});
});
