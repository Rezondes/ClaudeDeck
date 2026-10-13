// Renders the key images for the website in website/ with the plugin's own renderers.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDecisionKey } from "../src/render/decision-key";
import { renderEmptyStatusKey, renderStatusKey } from "../src/render/status-key";
import { renderUsageKey, renderUsageResetKey } from "../src/render/usage-key";
import { renderWindowKey } from "../src/render/window-key";

const out = join(import.meta.dirname, "..", "website", "img", "keys");
mkdirSync(out, { recursive: true });

const pending = { toolName: "Bash", toolInput: { command: "npm test" }, project: "MyApp" };
const keys: Record<string, string> = {
	"status-working": renderStatusKey({ project: "MyApp", title: "Login-Seite bauen", state: "working", contextPercent: 34 }),
	"status-approval": renderStatusKey({ project: "MyApp", title: "Tests reparieren", state: "approval", contextPercent: 58 }),
	"status-approval-flash": renderStatusKey({ project: "MyApp", title: "Tests reparieren", state: "approval", contextPercent: 58, flash: true }),
	"status-input": renderStatusKey({ project: "Website", title: "Farben wählen", state: "input", contextPercent: 21 }),
	"status-done": renderStatusKey({ project: "MyApp", title: "README schreiben", state: "done", contextPercent: 47 }),
	"status-limit": renderStatusKey({ project: "MyApp", title: "Refactoring", state: "error", errorKind: "rate_limit", contextPercent: 83 }),
	"status-idle": renderStatusKey({ project: "Notizen", state: "idle", contextPercent: 12 }),
	"status-waiting": renderEmptyStatusKey(2),
	"allow-active": renderDecisionKey({ kind: "allow", pending }),
	"always-active": renderDecisionKey({ kind: "always", pending }),
	"deny-active": renderDecisionKey({ kind: "deny", pending }),
	"allow-idle": renderDecisionKey({ kind: "allow", pending: null }),
	"always-idle": renderDecisionKey({ kind: "always", pending: null }),
	"deny-idle": renderDecisionKey({ kind: "deny", pending: null }),
	"usage": renderUsageKey({ fiveHour: 42, sevenDay: 67 }),
	"usage-reset": renderUsageResetKey({ fiveHour: "16:30", sevenDay: "Mo 09:00" }),
	"window-maximize": renderWindowKey("maximize"),
	"window-minimize": renderWindowKey("minimize"),
};

for (const [name, svg] of Object.entries(keys)) writeFileSync(join(out, `${name}.svg`), `${svg}\n`);
console.log(`${Object.keys(keys).length} keys written to ${out}`);
