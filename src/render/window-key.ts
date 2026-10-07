import { svgDocument } from "./status-key";

/** What a press does next; "none" when there is no Claude Desktop window. */
export type WindowKind = "minimize" | "maximize" | "none";

const ACCENT = "#D97757";
const LABELS: Record<WindowKind, string> = { minimize: "Minimize", maximize: "Maximize", none: "No window" };
/** Per-element opacities; group opacity is not SVG Tiny 1.2 and Stream Deck ignores it. */
const stroke = (opacity: number) =>
	`fill="none" stroke="${ACCENT}" stroke-opacity="${opacity}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`;
const frame = (opacity: number) => `<rect x="44" y="30" width="56" height="44" rx="6" ${stroke(opacity)}/>`;

/** Window frame with a minimize bar, with corner arrows for maximize, or empty and dimmed. Strokes only, no glyphs. */
const SYMBOLS: Record<WindowKind, string> = {
	minimize: `${frame(1)}<path d="M56,62 L88,62" ${stroke(1)}/>`,
	maximize: `${frame(1)}<path d="M56,50 L56,42 L64,42 M88,54 L88,62 L80,62" ${stroke(1)}/>`,
	none: frame(0.25),
};

export function renderWindowKey(kind: WindowKind): string {
	const dim = kind === "none";
	return svgDocument([
		`<rect width="144" height="144" fill="#000000"/>`,
		`<rect x="6" y="6" width="132" height="132" rx="20" fill="#0B0C0E" stroke="${ACCENT}" stroke-width="3" stroke-opacity="${dim ? 0.25 : 0.6}"/>`,
		SYMBOLS[kind],
		`<text x="72" y="110" text-anchor="middle" font-size="20" font-weight="600" fill="${ACCENT}" fill-opacity="${dim ? 0.4 : 1}">${LABELS[kind]}</text>`,
	]);
}
