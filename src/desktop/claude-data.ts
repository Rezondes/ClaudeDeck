import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Folders where Claude Desktop keeps its data. The Store version is an MSIX app: files it creates after install may only
 * exist in its virtualized copy under %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude, not in %APPDATA%\Claude.
 */
export async function claudeDataDirs(env = process.env, home = os.homedir()): Promise<string[]> {
	const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
	const packages = path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Packages");
	let virtualized: string[] = [];
	try {
		virtualized = (await readdir(packages)).filter((name) => /^Claude_/i.test(name)).map((name) => path.join(packages, name, "LocalCache", "Roaming", "Claude"));
	} catch {
		// no Packages folder: not an MSIX install
	}
	return [path.join(roaming, "Claude"), ...virtualized];
}
