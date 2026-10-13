import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "../projects/project-source.js";
import { ProjectKeys, projectIdOf } from "./project-action.js";

const PROJECTS: ProjectSummary[] = [
	{ id: "p2", name: "Website", threads: [] },
	{
		id: "p1",
		name: "ClaudeDeck",
		threads: [
			{ id: "t1", localId: "local_t1", title: "README", state: "working", lastActivityAt: 2 },
			{ id: "t2", localId: "local_t2", title: "Projects", state: "input", lastActivityAt: 1, remoteId: "cse_01thread2" },
		],
	},
];

const timers = { setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>), clearInterval: vi.fn() };
const open = vi.fn(async (_localId: string) => true);
const focus = vi.fn(async () => true);
const openProject = vi.fn(async (_projectId: string, _threadId?: string) => true);

beforeEach(() => {
	open.mockReset().mockResolvedValue(true);
	openProject.mockReset().mockResolvedValue(true);
	focus.mockReset().mockResolvedValue(true);
});

function view(id = "k1") {
	const images: string[] = [];
	return { id, images, last: () => decodeURIComponent(images.at(-1) ?? ""), setImage: (i: string) => images.push(i), showAlert: vi.fn() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ProjectKeys", () => {
	it("shows the chosen project's open threads and most urgent state", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "p1" });
		await flush();
		expect(v.last()).toContain(">ClaudeDeck<");
		expect(v.last()).toContain(">2<");
		expect(v.last()).toContain(">1 Input<");
	});

	it("asks for a project until one is chosen", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		const v = view();
		keys.appear(v, {});
		await flush();
		expect(v.last()).toContain(">Select<");
		keys.settingsChanged("k1", { projectId: "p2" });
		expect(v.last()).toContain(">Website<");
		expect(v.last()).toContain(">0<");
	});

	it("says not found when the project is gone", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "gone" });
		await flush();
		expect(v.last()).toContain(">Not<");
	});

	it("keeps the last values marked offline when the source fails", async () => {
		let fail = false;
		const keys = new ProjectKeys(async () => (fail ? Promise.reject(new Error("down")) : PROJECTS), open, openProject, focus, undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "p1" });
		await flush();
		fail = true;
		expect(await keys.reload()).toBe(false);
		expect(v.last()).toContain(">Offline<");
		expect(v.last()).toContain(">ClaudeDeck<");
	});

	it("takes the project id from a pasted link or the bare id", () => {
		expect(projectIdOf("https://claude.ai/code/project/chan_01TAmEmy6Q8hhJ5n1vkF8Upu?thread=x")).toBe("chan_01TAmEmy6Q8hhJ5n1vkF8Upu");
		expect(projectIdOf("  chan_01TAmEmy6Q8hhJ5n1vkF8Upu ")).toBe("chan_01TAmEmy6Q8hhJ5n1vkF8Upu");
		expect(projectIdOf("chan_x")).toBeUndefined();
		expect(projectIdOf("")).toBeUndefined();
		expect(projectIdOf(undefined)).toBeUndefined();
	});

	it("press with a project link opens the project at its most urgent thread", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "p1", projectLink: "chan_01TAmEmy6Q8hhJ5n1vkF8Upu" });
		await flush();
		keys.press(v);
		await flush();
		expect(openProject).toHaveBeenCalledWith("chan_01TAmEmy6Q8hhJ5n1vkF8Upu", "cse_01thread2");
		expect(open).not.toHaveBeenCalled();
	});

	it("press with a project link falls back to the thread when the project link fails", async () => {
		openProject.mockResolvedValue(false);
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "p1", projectLink: "chan_01TAmEmy6Q8hhJ5n1vkF8Upu" });
		await flush();
		keys.press(v);
		await flush();
		expect(open).toHaveBeenCalledWith("local_t2");
		expect(v.showAlert).not.toHaveBeenCalled();
	});

	it("press opens the most urgent thread in Claude Desktop", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "p1" });
		await flush();
		keys.press(v);
		await flush();
		expect(open).toHaveBeenCalledWith("local_t2");
		expect(focus).not.toHaveBeenCalled();
		expect(v.showAlert).not.toHaveBeenCalled();
	});

	it("press focuses Claude Desktop when the project has no threads or the link fails", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		const empty = view("k1");
		keys.appear(empty, { projectId: "p2" });
		await flush();
		keys.press(empty);
		await flush();
		expect(open).not.toHaveBeenCalled();
		expect(focus).toHaveBeenCalledTimes(1);

		open.mockResolvedValue(false);
		const busy = view("k2");
		keys.appear(busy, { projectId: "p1" });
		await flush();
		keys.press(busy);
		await flush();
		expect(focus).toHaveBeenCalledTimes(2);
		expect(busy.showAlert).not.toHaveBeenCalled();
	});

	it("press alerts when nothing could be shown or no project is known", async () => {
		open.mockRejectedValue(new Error("no handler"));
		focus.mockResolvedValue(false);
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		const v = view("k1");
		const unset = view("k2");
		keys.appear(v, { projectId: "p1" });
		keys.appear(unset, {});
		await flush();
		keys.press(v);
		keys.press(unset);
		await flush();
		expect(v.showAlert).toHaveBeenCalled();
		expect(unset.showAlert).toHaveBeenCalled();
	});

	it("lists projects for the dropdown sorted by name", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, timers);
		expect(await keys.items()).toEqual({
			event: "getProjects",
			items: [
				{ label: "ClaudeDeck (2)", value: "p1" },
				{ label: "Website (0)", value: "p2" },
			],
		});
	});

	it("polls only while a key is visible", () => {
		const t = { setInterval: vi.fn(() => 7 as unknown as ReturnType<typeof setInterval>), clearInterval: vi.fn() };
		const keys = new ProjectKeys(async () => PROJECTS, open, openProject, focus, undefined, t);
		keys.appear(view("a"), {});
		keys.appear(view("b"), {});
		expect(t.setInterval).toHaveBeenCalledTimes(1);
		keys.disappear("a");
		expect(t.clearInterval).not.toHaveBeenCalled();
		keys.disappear("b");
		expect(t.clearInterval).toHaveBeenCalledWith(7);
	});
});
