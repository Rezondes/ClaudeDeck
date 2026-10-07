// Runs `claude plugin test claude-module` with function hooks enabled (cross-platform env).
import { spawnSync } from "node:child_process";

const result = spawnSync("claude", ["plugin", "test", "claude-module", ...process.argv.slice(2)], {
	stdio: "inherit",
	shell: process.platform === "win32",
	env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1" },
});
process.exit(result.status ?? 1);
