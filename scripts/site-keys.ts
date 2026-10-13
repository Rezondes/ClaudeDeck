// Renders the key images for the website in website/ with the plugin's own renderers.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDecisionKey } from "../src/render/decision-key";
import { renderProjectKey } from "../src/render/project-key";
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
	"project-input": renderProjectKey({ name: "MyApp", threads: 3, state: "input", stateCount: 1 }),
	"project-working": renderProjectKey({ name: "MyApp", threads: 3, state: "working", stateCount: 2 }),
	// The plugin shows a static image on this key; the site draws it in the same style as Claude Window.
	reload: [
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="Segoe UI, Arial, sans-serif">`,
		`<rect width="144" height="144" fill="#000000"/>`,
		`<rect x="6" y="6" width="132" height="132" rx="20" fill="#0B0C0E" stroke="#D97757" stroke-width="3" stroke-opacity="0.6"/>`,
		`<path d="M83,32.95 A22,22 0 1 1 57.86,35.15" fill="none" stroke="#D97757" stroke-width="6" stroke-linecap="round"/><path d="M67.5,27.05 L51.1,27.1 L64.6,43.2 Z" fill="#D97757"/>`,
		`<text x="72" y="110" text-anchor="middle" font-size="20" font-weight="600" fill="#D97757">Reload</text>`,
		`</svg>`,
	].join("\n"),
	// Live demo in the hero: the same session in every state
	"demo-a-working": renderStatusKey({ project: "MyApp", title: "Login-Seite bauen", state: "working", contextPercent: 34 }),
	"demo-a-working-2": renderStatusKey({ project: "MyApp", title: "Login-Seite bauen", state: "working", contextPercent: 41 }),
	"demo-a-approval": renderStatusKey({ project: "MyApp", title: "Login-Seite bauen", state: "approval", contextPercent: 38 }),
	"demo-a-approval-flash": renderStatusKey({ project: "MyApp", title: "Login-Seite bauen", state: "approval", contextPercent: 38, flash: true }),
	"demo-a-done": renderStatusKey({ project: "MyApp", title: "Login-Seite bauen", state: "done", contextPercent: 46 }),
	"demo-a-idle": renderStatusKey({ project: "MyApp", title: "Login-Seite bauen", state: "idle", contextPercent: 46 }),
	"demo-b-input": renderStatusKey({ project: "Website", title: "Farben wählen", state: "input", contextPercent: 21 }),
	"demo-b-input-flash": renderStatusKey({ project: "Website", title: "Farben wählen", state: "input", contextPercent: 21, flash: true }),
	"demo-b-working": renderStatusKey({ project: "Website", title: "Farben wählen", state: "working", contextPercent: 24 }),
	"status-empty": renderEmptyStatusKey(0),
	"demo-allow": renderDecisionKey({ kind: "allow", pending: { toolName: "Bash", toolInput: { command: "npm test" }, project: "Login-Seite" } }),
	"demo-always": renderDecisionKey({ kind: "always", pending: { toolName: "Bash", toolInput: { command: "npm test" }, project: "Login-Seite" } }),
	"demo-deny": renderDecisionKey({ kind: "deny", pending: { toolName: "Bash", toolInput: { command: "npm test" }, project: "Login-Seite" } }),
};

for (const [name, svg] of Object.entries(keys)) writeFileSync(join(out, `${name}.svg`), `${svg}\n`);
console.log(`${Object.keys(keys).length} keys written to ${out}`);
