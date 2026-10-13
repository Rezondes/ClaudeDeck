import { mostUrgentThread, PROJECT_ID, projectState, type ListProjects, type ProjectSummary } from "../projects/project-source.js";
import { renderProjectKey, renderProjectPlaceholder } from "../render/project-key.js";
import { toDataUrl } from "../render/status-key.js";
import type { KeyView } from "./key-view.js";

/** Property inspector settings of a Project key. */
export type ProjectSettings = {
	projectId?: string;
	/** The project's link or id as pasted by the user; only the chan_ id in it is used. */
	projectLink?: string;
};

/** The Claude Code project id in a pasted link or id, if there is a valid one. */
export function projectIdOf(link: string | undefined): string | undefined {
	const id = link?.match(/chan_\w+/)?.[0];
	return id && PROJECT_ID.test(id) ? id : undefined;
}

/** Item list for the property inspector's project dropdown (sdpi-select datasource). */
export type ProjectItems = { event: "getProjects"; items: { label: string; value: string }[] };

const POLL_MS = 30_000;

/**
 * "Claude Project" keys: one chosen project per key with its open thread count and most urgent state.
 * Polls the project source while any key is visible; a press opens the project in Claude Desktop.
 */
export class ProjectKeys {
	readonly #views = new Map<string, KeyView>();
	readonly #settings = new Map<string, ProjectSettings>();
	#projects: ProjectSummary[] | undefined;
	#stale = false;
	#timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly listProjects: ListProjects,
		/** Opens a Desktop session by its local id; resolves false when that did not work. */
		private readonly openSession: (localId: string) => Promise<boolean>,
		/** Opens a Desktop project, at a thread when given; resolves false when that did not work. */
		private readonly openProject: (projectId: string, threadId?: string) => Promise<boolean>,
		/** Brings the Claude Desktop window forward; resolves false when there is none. */
		private readonly focusDesktop: () => Promise<boolean>,
		private readonly log: (message: string) => void = () => {},
		private readonly timers = { setInterval, clearInterval },
	) {}

	appear(view: KeyView, settings: ProjectSettings): void {
		this.#views.set(view.id, view);
		this.#settings.set(view.id, settings);
		this.#timer ??= this.timers.setInterval(() => void this.reload(), POLL_MS);
		this.#render(view);
		void this.reload();
	}

	disappear(id: string): void {
		this.#views.delete(id);
		this.#settings.delete(id);
		if (this.#views.size > 0 || !this.#timer) return;
		this.timers.clearInterval(this.#timer);
		this.#timer = undefined;
	}

	/**
	 * Opens the project in Claude Desktop. Desktop's project link needs the server's project id, which is not stored
	 * locally; with the pasted project link it opens the project at its most urgent thread. Without it, or when that
	 * fails, it opens the most urgent thread as a session, or focuses Desktop when there is none.
	 */
	press(view: KeyView): void {
		const settings = this.#settings.get(view.id);
		const project = this.#projects?.find((p) => p.id === settings?.projectId);
		const projectId = projectIdOf(settings?.projectLink);
		if (!project && !projectId) return void view.showAlert();
		const attempt = (show: () => Promise<boolean>) => show().catch(() => false);
		const thread = project && mostUrgentThread(project.threads);
		const focus = () => attempt(this.focusDesktop);
		const openThread = () => (thread ? attempt(() => this.openSession(thread.localId)).then((opened) => opened || focus()) : focus());
		(projectId ? attempt(() => this.openProject(projectId, thread?.remoteId)).then((opened) => opened || openThread()) : openThread())
			.then((shown) => shown || view.showAlert())
			.catch(() => {});
	}

	settingsChanged(id: string, settings: ProjectSettings): void {
		this.#settings.set(id, settings);
		const view = this.#views.get(id);
		if (view) this.#render(view);
	}

	/** Answers the dropdown's request with all projects, sorted by name. */
	async items(): Promise<ProjectItems> {
		await this.reload();
		const projects = [...(this.#projects ?? [])].sort((a, b) => a.name.localeCompare(b.name));
		return { event: "getProjects", items: projects.map((p) => ({ label: `${p.name} (${p.threads.length})`, value: p.id })) };
	}

	/** Reads the source and redraws; resolves false when the source failed (keys keep the last values, marked offline). */
	async reload(): Promise<boolean> {
		let ok = true;
		try {
			this.#projects = await this.listProjects();
			this.#stale = false;
		} catch (error) {
			this.log(`reading projects failed: ${error}`);
			this.#stale = true;
			ok = false;
		}
		this.renderAll();
		return ok;
	}

	renderAll(): void {
		for (const view of this.#views.values()) this.#render(view);
	}

	#render(view: KeyView): void {
		const id = this.#settings.get(view.id)?.projectId;
		if (!id) return void view.setImage(toDataUrl(renderProjectPlaceholder("Select project")));
		const project = this.#projects?.find((p) => p.id === id);
		if (!project) {
			// Before the first successful read nothing is known yet; keep the key neutral instead of "Not found".
			if (this.#projects) view.setImage(toDataUrl(renderProjectPlaceholder("Not found")));
			return;
		}
		const { state, count } = projectState(project.threads);
		view.setImage(toDataUrl(renderProjectKey({ name: project.name, threads: project.threads.length, state, stateCount: count, stale: this.#stale })));
	}
}
