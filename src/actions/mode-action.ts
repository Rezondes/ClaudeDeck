import type { SessionStore } from "../domain/session-store.js";
import { renderModeKey } from "../render/mode-key.js";
import { toDataUrl } from "../render/status-key.js";
import type { PendingApprovals } from "../server/pending-approvals.js";
import type { KeyView } from "./key-view.js";

/**
 * Modes the key may switch to. bypassPermissions is left out on purpose: one tap would switch off every
 * further permission prompt of the session (PLAN.md, Package 11).
 */
export const MODE_OPTIONS = ["acceptEdits", "plan", "default"] as const;
type Mode = (typeof MODE_OPTIONS)[number];

export type ModeSettings = { mode?: string };

const sanitize = (mode: string | undefined): Mode => (MODE_OPTIONS.includes(mode as Mode) ? (mode as Mode) : "acceptEdits");

/** "Allow + mode" keys: approve the oldest pending request and switch its session to the configured mode. */
export class ModeKeys {
	readonly #views = new Map<string, KeyView>();
	readonly #modes = new Map<string, Mode>();

	constructor(
		private readonly approvals: PendingApprovals,
		private readonly store: SessionStore,
	) {
		approvals.onChange(() => this.renderAll());
		store.onChange(() => this.renderAll());
	}

	appear(view: KeyView, settings: ModeSettings): void {
		this.#views.set(view.id, view);
		this.#modes.set(view.id, sanitize(settings.mode));
		this.#render(view.id);
	}

	disappear(id: string): void {
		this.#views.delete(id);
		this.#modes.delete(id);
	}

	settingsChanged(id: string, settings: ModeSettings): void {
		this.#modes.set(id, sanitize(settings.mode));
		this.#render(id);
	}

	press(view: KeyView): void {
		if (this.approvals.count === 0) return;
		this.approvals.approveWithMode(this.#modes.get(view.id) ?? "acceptEdits");
	}

	renderAll(): void {
		for (const id of this.#views.keys()) this.#render(id);
	}

	#render(id: string): void {
		const view = this.#views.get(id);
		if (!view) return;
		const latest = this.store.sessions().reduce<{ permissionMode?: string; lastEventAt: number } | undefined>(
			(best, s) => (s.permissionMode && (!best || s.lastEventAt >= best.lastEventAt) ? s : best),
			undefined,
		);
		const oldest = this.approvals.oldest();
		const project = oldest && (this.store.get(oldest.sessionId)?.title || oldest.project);
		view.setImage(toDataUrl(renderModeKey({ mode: this.#modes.get(id) ?? "acceptEdits", pending: this.approvals.count > 0, currentMode: latest?.permissionMode, project })));
	}
}
