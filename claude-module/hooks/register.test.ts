import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const USAGE = {
	startedAt: 0,
	context: { tokens: 92399, window: 1000000, percent: 9 },
	rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-07T12:00:00Z' }],
}

/** The hooks post without awaiting: lets those posts finish before the test looks. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

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
