import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claudeDataDirs } from "./claude-data.js";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "claude-data-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("claudeDataDirs", () => {
	const env = () => ({ APPDATA: path.join(dir, "Roaming"), LOCALAPPDATA: path.join(dir, "Local") });

	it("lists APPDATA and every Claude MSIX package", async () => {
		await mkdir(path.join(dir, "Local", "Packages", "Claude_pzs8sxrjxfjjc"), { recursive: true });
		await mkdir(path.join(dir, "Local", "Packages", "Other_123"), { recursive: true });
		expect(await claudeDataDirs(env(), dir)).toEqual([
			path.join(dir, "Roaming", "Claude"),
			path.join(dir, "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude"),
		]);
	});

	it("lists only APPDATA without a Packages folder", async () => {
		expect(await claudeDataDirs(env(), dir)).toEqual([path.join(dir, "Roaming", "Claude")]);
	});
});
