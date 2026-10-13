/** State of one project thread as the project overview reports it. */
export type ThreadState = "input" | "error" | "working" | "done" | "idle";

/** A project with its open threads; resolved threads are never included. */
export interface ProjectSummary {
	id: string;
	name: string;
	threads: { id: string; title: string; state: ThreadState }[];
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
