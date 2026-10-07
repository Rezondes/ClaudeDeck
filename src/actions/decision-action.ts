import { renderDecisionKey, type DecisionKind } from "../render/decision-key.js";
import { toDataUrl } from "../render/status-key.js";
import type { PendingApprovals } from "../server/pending-approvals.js";
import type { KeyView } from "./key-view.js";

/** Allow, Always or Deny keys: show the oldest pending request and decide it on press. */
export class DecisionKeys {
	readonly #views = new Map<string, KeyView>();

	constructor(
		private readonly kind: DecisionKind,
		private readonly approvals: PendingApprovals,
		private readonly isOnline: () => boolean,
		/** Project line for a session: its title when known, else the folder name. */
		private readonly labelFor: (sessionId: string, fallbackProject: string) => string = (_id, fallback) => fallback,
	) {
		approvals.onChange(() => this.renderAll());
	}

	appear(view: KeyView): void {
		this.#views.set(view.id, view);
		this.#render(view);
	}

	disappear(id: string): void {
		this.#views.delete(id);
	}

	press(_view: KeyView): void {
		if (this.approvals.count === 0) return;
		if (this.kind === "allow") this.approvals.approve();
		else if (this.kind === "always") this.approvals.approveAlways();
		else this.approvals.deny();
	}

	renderAll(): void {
		for (const view of this.#views.values()) this.#render(view);
	}

	#render(view: KeyView): void {
		const oldest = this.approvals.oldest();
		const pending = oldest && {
			toolName: oldest.toolName,
			toolInput: oldest.toolInput,
			...(this.approvals.count > 1 ? { project: this.labelFor(oldest.sessionId, oldest.project) } : {}),
		};
		view.setImage(toDataUrl(renderDecisionKey({ kind: this.kind, pending: pending ?? null, offline: !this.isOnline() })));
	}
}
