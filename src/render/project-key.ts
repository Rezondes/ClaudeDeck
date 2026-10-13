import type { ThreadState } from "../projects/project-source";
import { BAR_TRACK, KEY_BACKGROUND, STATE_COLORS } from "./colors";
import { escapeXml, svgDocument, wrapTitle } from "./status-key";

export interface ProjectKeyInput {
	name: string;
	/** Open (unresolved) threads. */
	threads: number;
	/** Most urgent thread state and how many threads are in it (see projectState). */
	state: ThreadState;
	stateCount: number;
	/** The source could not be read; the numbers are the last known ones. */
	stale?: boolean;
}

const LABELS: Record<ThreadState, string> = {
	input: "Input",
	error: "Error",
	working: "Working",
	done: "Done",
	idle: "Idle",
};

const KEY_RECT = `x="6" y="6" width="132" height="132" rx="20"`;

function frame(border: string): string[] {
	return [`<rect width="144" height="144" fill="#000000"/>`, `<rect ${KEY_RECT} fill="${KEY_BACKGROUND}" stroke="${border}" stroke-width="3"/>`];
}

export function renderProjectKey({ name, threads, state, stateCount, stale = false }: ProjectKeyInput): string {
	const color = STATE_COLORS[state];
	const lines = wrapTitle(name);
	const nameY = lines.length === 1 ? [40] : [32, 50];
	const label = state === "idle" ? LABELS.idle : `${stateCount} ${LABELS[state]}`;
	return svgDocument([
		...frame(stale ? BAR_TRACK : color),
		...lines.map((line, i) => `<text x="72" y="${nameY[i]}" text-anchor="middle" font-size="15" font-weight="700" fill="#FFFFFF">${escapeXml(line)}</text>`),
		`<text x="72" y="88" text-anchor="middle" font-size="30" font-weight="700" fill="#FFFFFF">${threads}</text>`,
		`<text x="72" y="104" text-anchor="middle" font-size="14" fill="${STATE_COLORS.idle}">${threads === 1 ? "Thread" : "Threads"}</text>`,
		`<text x="72" y="124" text-anchor="middle" font-size="15" font-weight="600" fill="${stale ? STATE_COLORS.idle : color}">${stale ? "Offline" : label}</text>`,
	]);
}

/** A Project key without a usable project: none chosen yet, or the chosen one is gone. */
export function renderProjectPlaceholder(text: "Select project" | "Not found"): string {
	const [first, second] = text.split(" ");
	return svgDocument([
		...frame(BAR_TRACK),
		`<text x="72" y="68" text-anchor="middle" font-size="16" font-weight="600" fill="${STATE_COLORS.idle}">${first}</text>`,
		`<text x="72" y="88" text-anchor="middle" font-size="16" font-weight="600" fill="${STATE_COLORS.idle}">${second}</text>`,
	]);
}
