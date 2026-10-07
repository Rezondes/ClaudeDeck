import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSetup } from "./module-setup.js";

const FLAG = "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS";
const DIRS = "CLAUDE_CODE_PLUGIN_DIRS";

describe("module-setup", () => {
	let dir: string;
	let settingsPath: string;
	let moduleDir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "claudedeck-setup-"));
		settingsPath = join(dir, "settings.json");
		moduleDir = join(dir, "repo", "claude-module");
		mkdirSync(moduleDir, { recursive: true });
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const write = (settings: unknown) => writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
	const read = () => JSON.parse(readFileSync(settingsPath, "utf8"));
	const run = (action: "install" | "remove") => runSetup(action, { settingsPath, moduleDir });

	it("install adds both keys idempotently and keeps other env entries", () => {
		const other = "C:/Other/plugin";
		write({ model: "opus", env: { ANTHROPIC_API_KEY: "sk-secret", [DIRS]: other }, hooks: { Stop: [] } });

		expect(run("install").ok).toBe(true);
		const once = read();
		expect(once.env[FLAG]).toBe("1");
		expect(once.env[DIRS]).toBe(`${other}${delimiter}${moduleDir}`);
		expect(once.env.ANTHROPIC_API_KEY).toBe("sk-secret");
		expect(Object.keys(once)).toEqual(["model", "env", "hooks"]);
		expect(once.hooks).toEqual({ Stop: [] });

		// A differently spelled path to the same dir counts as present.
		write({ ...once, env: { ...once.env, [DIRS]: `${other}${delimiter}${moduleDir.replaceAll("\\", "/").toUpperCase()}/` } });
		const before = readFileSync(settingsPath, "utf8");
		const second = run("install");
		expect(second.ok).toBe(true);
		expect(readFileSync(settingsPath, "utf8")).toBe(before);
		expect(second.lines).toContain(`${FLAG}: unchanged`);
		expect(second.lines).toContain(`${DIRS}: unchanged`);
	});

	it("remove deletes only ClaudeDeck entries", () => {
		const other = "C:/Other/plugin";
		const marker = join(moduleDir, ".claudedeck-enabled-function-hooks");

		// ClaudeDeck set the flag: remove drops both keys and the marker.
		write({ env: { KEEP: "x", [DIRS]: other } });
		run("install");
		expect(existsSync(marker)).toBe(true);
		const removed = run("remove");
		expect(removed.lines).toEqual([`${FLAG}: changed`, `${DIRS}: changed`]);
		expect(read()).toEqual({ env: { KEEP: "x", [DIRS]: other } });
		expect(existsSync(marker)).toBe(false);

		// The flag was already there: it stays, and an emptied dir list disappears.
		write({ env: { [FLAG]: "1" } });
		run("install");
		expect(existsSync(marker)).toBe(false);
		run("remove");
		expect(read()).toEqual({ env: { [FLAG]: "1" } });

		// No env before install: remove restores the file exactly.
		write({ model: "opus" });
		run("install");
		run("remove");
		expect(read()).toEqual({ model: "opus" });
	});

	it("refuses invalid JSON", () => {
		const broken = '{ "env": { "ANTHROPIC_API_KEY": "sk-secret" }, oops }';
		writeFileSync(settingsPath, broken);

		for (const action of ["install", "remove"] as const) {
			const result = run(action);
			expect(result.ok).toBe(false);
			expect(result.lines.join("\n")).toMatch(/position \d+/);
			expect(result.lines.join("\n")).toContain(settingsPath);
			expect(result.lines.join("\n")).not.toContain("sk-secret");
			expect(readFileSync(settingsPath, "utf8")).toBe(broken);
		}
		expect(existsSync(join(moduleDir, ".claudedeck-enabled-function-hooks"))).toBe(false);
	});

	it("refuses settings with the wrong shape", () => {
		const shapes = ["null", "[]", "5", '"sk-secret"', '{ "env": [] }', '{ "env": null }', `{ "env": { "${DIRS}": 5 } }`];
		for (const text of shapes) {
			writeFileSync(settingsPath, text);
			const result = run("install");
			expect(result.ok).toBe(false);
			expect(result.lines.join("\n")).toContain(settingsPath);
			expect(result.lines.join("\n")).not.toContain("sk-secret");
			expect(readFileSync(settingsPath, "utf8")).toBe(text);
		}
	});

	it("creates the settings directory if missing", () => {
		settingsPath = join(dir, "home", ".claude", "settings.json");
		expect(run("install").ok).toBe(true);
		expect(read().env[FLAG]).toBe("1");
	});

	it("output never contains other env values", () => {
		const secrets = ["sk-secret-value", "C:/Secret/plugin", "hidden-model"];
		write({ model: secrets[2], env: { ANTHROPIC_API_KEY: secrets[0], [DIRS]: secrets[1] } });
		const output = [...run("install").lines, ...run("remove").lines].join("\n");

		for (const secret of secrets) expect(output).not.toContain(secret);
		expect(output).toContain("New Claude sessions load the module; running sessions do not.");
	});
});
