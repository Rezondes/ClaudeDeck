import { svgDocument } from "./status-key";

export type WindowKind = "window" | "maximize";

const ACCENT = "#D97757";
const LABELS: Record<WindowKind, string> = { window: "Window", maximize: "Maximize" };
const STROKE = `fill="none" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`;

/** Window frame with a minimize bar, or with corner arrows for maximize. Strokes only, no glyphs. */
const SYMBOLS: Record<WindowKind, string> = {
	window: `<rect x="44" y="30" width="56" height="44" rx="6" ${STROKE}/><path d="M56,62 L88,62" ${STROKE}/>`,
	maximize: `<rect x="44" y="30" width="56" height="44" rx="6" ${STROKE}/><path d="M56,50 L56,42 L64,42 M88,54 L88,62 L80,62" ${STROKE}/>`,
};

export function renderWindowKey(kind: WindowKind): string {
	return svgDocument([
		`<rect width="144" height="144" fill="#000000"/>`,
		`<rect x="6" y="6" width="132" height="132" rx="20" fill="#0B0C0E" stroke="${ACCENT}" stroke-width="3" stroke-opacity="0.6"/>`,
		SYMBOLS[kind],
		`<text x="72" y="110" text-anchor="middle" font-size="20" font-weight="600" fill="${ACCENT}">${LABELS[kind]}</text>`,
	]);
}
