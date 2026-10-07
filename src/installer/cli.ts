import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup } from "./module-setup.js";

const action = process.argv[2];
if (action !== "install" && action !== "remove") {
	console.error("usage: cli.ts install | remove");
	process.exit(2);
}

const result = runSetup(action, {
	settingsPath: join(homedir(), ".claude", "settings.json"),
	moduleDir: fileURLToPath(new URL("../../claude-module", import.meta.url)),
});
for (const line of result.lines) (result.ok ? console.log : console.error)(line);
process.exit(result.ok ? 0 : 1);
