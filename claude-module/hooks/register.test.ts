import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const USAGE = {
	startedAt: 0,
	context: { tokens: 92399, window: 1000000, percent: 9 },
	rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-07T12:00:00Z' }],
}

// The test runtime has timers; the module typings (lib es2023, no DOM or node) do not declare them.
declare const setTimeout: (callback: () => void, ms: number) => unknown

/** The hooks post without awaiting: lets those posts finish before the test looks. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** The engine beneath the plugin: a session s1 whose events just pass. */
function engine(on: On, id: () => Promise<{ value: string }> = async () => ({ value: 's1' })): void {
	on('session.id', id)
	on('session.usage', async () => ({ value: USAGE }))
	on('session.start', async (_$, e) => ({ cwd: e.cwd }))
	on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
	on('turn.complete', async (_$, e) => ({ text: e.answer }))
}

test('reports session start, turn start and usage', async ($, on) => {
	const requests: { url: string; init: unknown }[] = []
	on('http.fetch', async (_$, e) => {
		requests.push({ url: e.url, init: e.init })
		return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
	})
	engine(on)
	const sessionId = 's1'

	await $.session.start({ cwd: 'F:\\Code\\ClaudeDeck', surface: null, isInteractive: false })
	await $.turn.start({ text: 'hi', turnId: 't1' })
	await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
	await settle()

	const post = (event: string, body: object) => ({
		url: `http://127.0.0.1:37419/module/${event}`,
		init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
	})
	expect(requests).toEqual([
		post('session-start', { sessionId, cwd: 'F:\\Code\\ClaudeDeck' }),
		post('turn-start', { sessionId, turnId: 't1' }),
		post('usage', { sessionId, context: USAGE.context, rateLimits: USAGE.rateLimits }),
	])
})

test('ignores a missing ClaudeDeck', async ($, on) => {
	let attempts = 0
	on('http.fetch', async () => {
		attempts++
		throw new Error('connect ECONNREFUSED 127.0.0.1:37419')
	})
	engine(on)
	const statuses: unknown[] = []
	on('ui.status', async (_$, e) => {
		statuses.push(e)
		return { value: undefined }
	})

	await $.session.start({ cwd: 'F:\\Code\\ClaudeDeck', surface: null, isInteractive: false })
	expect(await $.turn.start({ text: 'hi', turnId: 't1' })).toEqual({ turnId: 't1' })
	await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
	await settle()
	expect(attempts).toBe(3)
	expect(statuses).toEqual([])
})

test('ignores a failing session id', async ($, on) => {
	let attempts = 0
	on('http.fetch', async () => {
		attempts++
		return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
	})
	engine(on, async () => {
		throw new Error('no session')
	})

	expect(await $.session.start({ cwd: 'F:/Code/ClaudeDeck', surface: null, isInteractive: false })).toEqual({ cwd: 'F:/Code/ClaudeDeck' })
	expect(await $.turn.start({ text: 'hi', turnId: 't1' })).toEqual({ turnId: 't1' })
	expect(await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).toEqual({ text: 'ok' })
	await settle()
	expect(attempts).toBe(0)
})

test('does not hold the turn while ClaudeDeck is slow', async ($, on) => {
	on('http.fetch', () => new Promise(() => {}))
	engine(on)

	expect(await $.turn.start({ text: 'hi', turnId: 't1' })).toEqual({ turnId: 't1' })
})

test('polls commands and aborts only the matching turn', async ($, on) => {
	const clock = mock.clock(on)
	const answers: string[][] = [['t0', 't1']]
	const polls: string[] = []
	on('http.fetch', async (_$, e) => {
		if (!e.url.endsWith('/commands?session=s1')) return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
		polls.push(e.url)
		const commands = (answers.shift() ?? []).map(turnId => ({ kind: 'abort', turnId, at: 0 }))
		return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ commands }) } }
	})
	const aborted: string[] = []
	on('turn.abort', async (_$, e) => {
		aborted.push(e.turnId)
		return { value: undefined }
	})
	engine(on)

	await $.session.start({ cwd: 'F:/Code/ClaudeDeck', surface: null, isInteractive: false })
	await $.turn.start({ text: 'hi', turnId: 't1' })
	await clock.advance(999)
	expect(polls).toEqual([])
	await clock.advance(1)
	expect(polls).toEqual(['http://127.0.0.1:37419/module/commands?session=s1'])
	expect(aborted).toEqual(['t1'])

	// After the turn ended there is nothing to interrupt: no polling while idle.
	await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: true, turnId: 't1', reason: 'answer' })
	answers.push(['t1'])
	await clock.advance(1000)
	expect(polls.length).toBe(1)

	// A new turn polls again; the stale abort for t1 is ignored.
	await $.turn.start({ text: 'again', turnId: 't2' })
	await clock.advance(1000)
	expect(polls.length).toBe(2)
	expect(aborted).toEqual(['t1'])
})

test('reports usage every 60 s without ending the turn', async ($, on) => {
	const clock = mock.clock(on)
	const usages: unknown[] = []
	const polls: string[] = []
	on('http.fetch', async (_$, e) => {
		if (e.url.endsWith('/module/usage')) usages.push(JSON.parse(String(e.init?.body)))
		if (e.url.includes('/commands')) polls.push(e.url)
		return { value: { status: 200, ok: true, headers: {}, text: '{"commands":[]}' } }
	})
	engine(on)
	const periodic = { sessionId: 's1', context: USAGE.context, rateLimits: USAGE.rateLimits, periodic: true }

	// Also without a running turn.
	await $.session.start({ cwd: 'F:/Code/ClaudeDeck', surface: null, isInteractive: false })
	await clock.advance(59_999)
	expect(usages).toEqual([])
	await clock.advance(1)
	await settle()
	expect(usages).toEqual([periodic])

	// During a turn the report does not end it: polling for aborts goes on.
	await $.turn.start({ text: 'hi', turnId: 't1' })
	await clock.advance(60_000)
	await settle()
	expect(usages).toEqual([periodic, periodic])
	const before = polls.length
	await clock.advance(1000)
	expect(polls.length).toBe(before + 1)
})

test('ignores failing polls', async ($, on) => {
	const clock = mock.clock(on)
	let polls = 0
	on('http.fetch', async (_$, e) => {
		if (!e.url.includes('/commands')) return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
		polls++
		if (polls === 1) throw new Error('connect ECONNREFUSED 127.0.0.1:37419')
		return { value: { status: 200, ok: true, headers: {}, text: 'not json' } }
	})
	engine(on)
	const statuses: unknown[] = []
	on('ui.status', async (_$, e) => {
		statuses.push(e)
		return { value: undefined }
	})

	await $.session.start({ cwd: 'F:/Code/ClaudeDeck', surface: null, isInteractive: false })
	await $.turn.start({ text: 'hi', turnId: 't1' })
	await clock.advance(2000)
	expect(polls).toBe(2)
	expect(statuses).toEqual([])
})
