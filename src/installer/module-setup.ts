import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

const FLAG = "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS";
const DIRS = "CLAUDE_CODE_PLUGIN_DIRS";
const MARKER = ".claudedeck-enabled-function-hooks";

type Settings = Record<string, unknown> & { env?: Record<string, string> };
export type SetupResult = { ok: boolean; lines: string[] };

const samePath = (a: string, b: string) => {
	const norm = (p: string) => p.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
	return norm(a) === norm(b);
};

const splitDirs = (value: string | undefined) => (value ?? "").split(delimiter).filter((d) => d.trim() !== "");

/** Adds the flag and the module dir; returns which of the two keys changed. Mutates `settings`. */
export function applyInstall(settings: Settings, moduleDir: string): { flag: boolean; dirs: boolean } {
	const env = (settings.env ??= {});
	const flag = env[FLAG] !== "1";
	if (flag) env[FLAG] = "1";
	const dirs = splitDirs(env[DIRS]);
	const missing = !dirs.some((d) => samePath(d, moduleDir));
	if (missing) env[DIRS] = [...dirs, moduleDir].join(delimiter);
	return { flag, dirs: missing };
}

/** Drops the module dir (and the flag when `dropFlag`); returns which of the two keys changed. Mutates `settings`. */
export function applyRemove(settings: Settings, moduleDir: string, dropFlag: boolean): { flag: boolean; dirs: boolean } {
	const env = settings.env ?? {};
	const flag = dropFlag && FLAG in env;
	if (flag) delete env[FLAG];
	const before = splitDirs(env[DIRS]);
	const after = before.filter((d) => !samePath(d, moduleDir));
	const dirs = after.length !== before.length;
	if (dirs && after.length === 0) delete env[DIRS];
	else if (dirs) env[DIRS] = after.join(delimiter);
	if ((flag || dirs) && Object.keys(env).length === 0) delete settings.env;
	return { flag, dirs };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Names what is wrong with the parsed file's shape, without quoting any of its content. */
function shapeError(value: unknown): string | undefined {
	if (!isObject(value)) return "top level is not an object";
	if (value.env === undefined) return undefined;
	if (!isObject(value.env)) return "env is not an object";
	const dirs = value.env[DIRS];
	if (dirs !== undefined && typeof dirs !== "string") return `${DIRS} is not a string`;
	return undefined;
}

function readSettings(settingsPath: string): { settings: Settings } | { error: string } {
	if (!existsSync(settingsPath)) return { settings: {} };
	const text = readFileSync(settingsPath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		// Never echo the message itself: newer engines quote the file content in it.
		const position = /position (\d+)/.exec(String(e))?.[1] ?? "unknown";
		return { error: `${settingsPath}: invalid JSON at position ${position}, nothing written` };
	}
	const problem = shapeError(parsed);
	if (problem) return { error: `${settingsPath}: ${problem}, nothing written` };
	return { settings: parsed as Settings };
}

function writeAtomic(settingsPath: string, settings: Settings) {
	mkdirSync(dirname(settingsPath), { recursive: true });
	const temp = `${settingsPath}.claudedeck.tmp`;
	writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
	renameSync(temp, settingsPath);
}

const status = (key: string, changed: boolean) => `${key}: ${changed ? "changed" : "unchanged"}`;

export function runSetup(action: "install" | "remove", options: { settingsPath: string; moduleDir: string }): SetupResult {
	const read = readSettings(options.settingsPath);
	if ("error" in read) return { ok: false, lines: [read.error] };
	const { settings } = read;
	const marker = join(options.moduleDir, MARKER);
	const changes =
		action === "install" ? applyInstall(settings, options.moduleDir) : applyRemove(settings, options.moduleDir, existsSync(marker));
	if (changes.flag || changes.dirs) writeAtomic(options.settingsPath, settings);
	if (action === "install" && changes.flag) writeFileSync(marker, "");
	if (action === "remove") rmSync(marker, { force: true });
	const lines = [status(FLAG, changes.flag), status(DIRS, changes.dirs)];
	if (action === "install") lines.push("New Claude sessions load the module; running sessions do not.");
	return { ok: true, lines };
}
