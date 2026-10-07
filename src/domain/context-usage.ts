import { open } from "node:fs/promises";

// ponytail: a last line larger than this (huge tool result) yields null; callers keep the previous value.
const TAIL_BYTES = 256 * 1024;

export type ReadTail = (path: string, maxBytes: number) => Promise<string>;

export async function readContextUsage(path: string, readTail: ReadTail = readFileTail): Promise<number | null> {
	try {
		return contextPercentFromLines(await readTail(path, TAIL_BYTES));
	} catch {
		return null;
	}
}

export async function readFileTail(path: string, maxBytes: number): Promise<string> {
	const file = await open(path, "r");
	try {
		const { size } = await file.stat();
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await file.read(buffer, 0, length, size - length);
		return buffer.toString("utf8", 0, bytesRead);
	} finally {
		await file.close();
	}
}

export function contextPercentFromLines(text: string): number | null {
	const lines = text.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		let entry;
		try {
			entry = JSON.parse(lines[i]);
		} catch {
			continue; // truncated or partial line
		}
		const usage = entry?.message?.usage;
		if (entry?.type !== "assistant" || entry?.isSidechain || !usage) continue;
		const tokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0);
		// ponytail: transcripts do not say which context window a session has. More than 200k tokens proves 1M;
		// a 1M session below 200k is measured against 200k until it crosses that line.
		const limit = tokens > 200_000 || String(entry.message.model).includes("[1m]") ? 1_000_000 : 200_000;
		return Math.min(100, Math.round((tokens / limit) * 100));
	}
	return null;
}
