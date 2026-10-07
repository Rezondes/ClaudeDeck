import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readContextUsage, readFileTail } from "./context-usage.js";

const fixture = fileURLToPath(new URL("../../test/fixtures/transcript-sample.jsonl", import.meta.url));

function assistant(tokens: number, opts: { sidechain?: boolean; model?: string } = {}): string {
	return JSON.stringify({
		type: "assistant",
		isSidechain: opts.sidechain ?? false,
		message: {
			model: opts.model ?? "claude-opus-5-5",
			usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 },
		},
	});
}

function writeTranscript(content: string): string {
	const path = join(mkdtempSync(join(tmpdir(), "claudedeck-")), "transcript.jsonl");
	writeFileSync(path, content);
	return path;
}

describe("context-usage", () => {
	it("computes percent from last assistant usage", async () => {
		expect(await readContextUsage(fixture)).toBe(30);
	});

	it("ignores sidechain entries", async () => {
		const path = writeTranscript(`${assistant(20_000)}\n${assistant(190_000, { sidechain: true })}\n`);
		expect(await readContextUsage(path)).toBe(10);
	});

	it("reads only the file tail", async () => {
		const filler = `${JSON.stringify({ type: "user", isSidechain: false })}
`.repeat(Math.ceil(1024 * 1024 / 36));
		const path = writeTranscript(`${filler}${assistant(60_000)}
`);
		let bytesRead = 0;
		const spy = async (file: string, maxBytes: number) => {
			const text = await readFileTail(file, maxBytes);
			bytesRead += Buffer.byteLength(text);
			return text;
		};
		expect(await readContextUsage(path, spy)).toBe(30);
		expect(bytesRead).toBeGreaterThan(0);
		expect(bytesRead).toBeLessThanOrEqual(262_144);
	});

	it("returns null for missing or empty files", async () => {
		expect(await readContextUsage(join(tmpdir(), "claudedeck-does-not-exist.jsonl"))).toBeNull();
		expect(await readContextUsage(writeTranscript(""))).toBeNull();
		expect(await readContextUsage(writeTranscript(`${JSON.stringify({ type: "user" })}\n`))).toBeNull();
	});

	it("skips a truncated last line", async () => {
		const path = writeTranscript(`${assistant(40_000)}\n${assistant(100_000).slice(0, 50)}`);
		expect(await readContextUsage(path)).toBe(20);
	});

	it("uses 1M limit for [1m] models and clamps to 100", async () => {
		expect(await readContextUsage(writeTranscript(`${assistant(150_000, { model: "claude-opus-5-5[1m]" })}\n`))).toBe(15);
		expect(await readContextUsage(writeTranscript(`${assistant(1_200_000, { model: "claude-opus-5-5[1m]" })}\n`))).toBe(100);
	});

	it("treats more than 200k tokens as a 1M session even without [1m] in the model id", async () => {
		// Real transcripts never carry "[1m]" in message.model.
		expect(await readContextUsage(writeTranscript(`${assistant(302_000, { model: "claude-opus-5-5" })}\n`))).toBe(30);
	});
});
