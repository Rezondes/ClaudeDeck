import { DECISION_COLORS } from "./colors";
import { escapeXml, svgDocument, truncate } from "./status-key";

export type DecisionKind = "allow" | "always" | "deny";

export interface PendingView {
	toolName: string;
	toolInput: Record<string, unknown>;
	project?: string;
}

export interface DecisionKeyInput {
	kind: DecisionKind;
	pending: PendingView | null;
	offline?: boolean;
}

const LABELS: Record<DecisionKind, string> = { allow: "Allow", always: "Always", deny: "Deny" };
const DARK_FOREGROUND = "#1A1A1A";

export function commandPreview(toolName: string, toolInput: Record<string, unknown>): string {
	const key = toolName === "Bash" ? "command" : ["Edit", "Write", "Read"].includes(toolName) ? "file_path" : null;
	const value = key ? toolInput[key] : undefined;
	if (typeof value !== "string") return "";
	const text = key === "file_path" ? value.split(/[\\/]/).pop()! : value;
	return truncate(text, 12);
}

/** Symbols are drawn as strokes because Segoe UI has no check or cross glyph. */
function symbol(kind: DecisionKind, color: string, opacity: number, cy: number): string {
	const stroke = `fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"`;
	const check = (cx: number) => `<polyline class="check" transform="translate(${cx} ${cy})" points="-16,0 -5,11 16,-12" ${stroke}/>`;
	if (kind === "allow") return check(72);
	if (kind === "deny") return `<path class="cross" transform="translate(72 ${cy})" d="M-13,-13 L13,13 M13,-13 L-13,13" ${stroke}/>`;
	return `${check(54)}<text x="92" y="${cy + 12}" text-anchor="middle" font-size="36" font-weight="700" fill="${color}" fill-opacity="${opacity}">∞</text>`;
}

export function renderDecisionKey({ kind, pending, offline = false }: DecisionKeyInput): string {
	const accent = DECISION_COLORS[kind];
	if (!pending) {
		return svgDocument([
			`<rect width="144" height="144" fill="#000000"/>`,
			`<rect x="6" y="6" width="132" height="132" rx="20" fill="#0B0C0E" stroke="${accent}" stroke-width="3" stroke-opacity="0.6"/>`,
			symbol(kind, accent, 0.55, 56),
			`<text x="72" y="102" text-anchor="middle" font-size="20" font-weight="600" fill="${accent}" fill-opacity="0.55">${LABELS[kind]}</text>`,
			...(offline ? [`<text x="72" y="124" text-anchor="middle" font-size="14" fill="#8A8F98">offline</text>`] : []),
		]);
	}
	const fg = kind === "always" ? DARK_FOREGROUND : "#FFFFFF";
	const preview = commandPreview(pending.toolName, pending.toolInput);
	const detail = preview ? `${truncate(pending.toolName, 10)} ${preview}` : truncate(pending.toolName, 18);
	return svgDocument([
		`<rect width="144" height="144" fill="#000000"/>`,
		`<rect x="6" y="6" width="132" height="132" rx="20" fill="${accent}"/>`,
		symbol(kind, fg, 1, 40),
		`<text x="72" y="80" text-anchor="middle" font-size="20" font-weight="700" fill="${fg}">${LABELS[kind]}</text>`,
		`<text x="72" y="104" text-anchor="middle" font-size="14" fill="${fg}">${escapeXml(detail)}</text>`,
		...(pending.project
			? [`<text x="72" y="124" text-anchor="middle" font-size="14" fill="${fg}" fill-opacity="0.85">${escapeXml(truncate(pending.project, 14))}</text>`]
			: []),
	]);
}
