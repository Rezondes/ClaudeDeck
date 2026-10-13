/** State of one project thread as the project overview reports it. */
export type ThreadState = "input" | "error" | "working" | "done" | "idle";

/** A project with its open threads; resolved threads are never included. */
export interface ProjectSummary {
	id: string;
	name: string;
	/** id is the thread's Claude Code session id, localId its Desktop session id (for the claude:// deep link). */
	threads: { id: string; localId: string; title: string; state: ThreadState; lastActivityAt: number }[];
}

/** Where the Project action gets projects from. Rejects when the source is unreachable. */
export type ListProjects = () => Promise<ProjectSummary[]>;

/** Most urgent first: a thread waiting for you beats a failed one, which beats a running one. */
const PRIORITY: ThreadState[] = ["input", "error", "working", "done", "idle"];

/** The most urgent state among the threads and how many threads share it; idle with 0 when there are none. */
export function projectState(threads: { state: ThreadState }[]): { state: ThreadState; count: number } {
	for (const state of PRIORITY) {
		const count = threads.filter((t) => t.state === state).length;
		if (count > 0) return { state, count };
	}
	return { state: "idle", count: 0 };
}

/** The thread to open for a project: most urgent state first, the most recently active one on a tie. */
export function mostUrgentThread<T extends { state: ThreadState; lastActivityAt: number }>(threads: T[]): T | undefined {
	const rank = (t: T) => PRIORITY.indexOf(t.state);
	return [...threads].sort((a, b) => rank(a) - rank(b) || b.lastActivityAt - a.lastActivityAt)[0];
}
