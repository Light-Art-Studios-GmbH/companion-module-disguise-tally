/**
 * @file Companion connection instance of the read-only disguise tally module.
 *
 * Data flow
 * ─────────
 * • REST GET /transport/transports (every POLL_MS): which transports exist; picks the host (Director, else backup).
 * • Live Update, per watched transport `transportmanager:<name>`:
 *     program  enabled layers at the playhead + the clip their live module renders + brightness   (UPDATE_MS)
 *     preview  video layers starting within previewSeconds + clips keyed on them                 (PREVIEW_MS)
 *   plus once (on the first transport) the live inputs of the project (INPUTS_MS).
 * • Every update recomputes the tally (tally.js: PGM / PVW / OFF) and publishes changed variables and feedbacks.
 *
 * Read-only: no actions, no REST POST, no Live Update `set`; the expressions are fixed (expressions.js).
 */
const { InstanceBase, InstanceStatus } = require('@companion-module/base')
const { getConfigFields } = require('./config.js')
const { getFeedbackDefinitions } = require('./feedbacks.js')
const { getVariableDefinitions } = require('./variables.js')
const { getPresetDefinitions } = require('./presets.js')
const { SessionApi } = require('./api.js')
const { LiveUpdate } = require('./liveupdate.js')
const ex = require('./expressions.js')
const tally = require('./tally.js')

const POLL_MS = 10000
const REQUEST_TIMEOUT_MS = 4000
/** Primary failed this many polls in a row → use the backup. */
const FAILS_BEFORE_BACKUP = 2
const UPDATE_MS = 100
const PREVIEW_MS = 500
const INPUTS_MS = 5000

class TallyInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.config = {}
		this.destroyed = false
		/** @type {import('./tally.js').InputDef[]} configured inputs (empty = all live inputs) */
		this.configured = []
		/** @type {import('./tally.js').InputDef[]} inputs shown */
		this.inputs = []
		/** @type {Map<number, import('./tally.js').TallyState>} */
		this.tally = new Map()
		/** @type {Map<string, import('./tally.js').TransportData>} transport name → data */
		this.data = new Map()
		/** @type {{uid:string, name:string}[]} */
		this.transportList = []
		/** @type {string[]|null} live inputs Designer reports (null = not known yet) */
		this.discovered = null
		this.live = null
		this.liveConnected = false
		this.liveHost = ''
		this.pollTimer = null
		this.primaryFails = 0
		this.lastStatus = ''
		this.definitionSignature = ''
		/** @type {Map<string, unknown>} */
		this.sentVariables = new Map()
		/** @type {Set<string>} */
		this.loggedErrors = new Set()
	}

	// ────────────────────────────────────────────────────────────── lifecycle

	async init(config) {
		this.config = config || {}
		this.destroyed = false
		await this.start()
	}

	async configUpdated(config) {
		this.teardown()
		this.config = config || {}
		await this.start()
	}

	async destroy() {
		this.destroyed = true
		this.teardown()
	}

	getConfigFields() {
		return getConfigFields()
	}

	teardown() {
		if (this.pollTimer) clearInterval(this.pollTimer)
		this.pollTimer = null
		if (this.live) this.live.stop()
		this.live = null
		this.liveConnected = false
		this.liveHost = ''
		this.data = new Map()
		this.transportList = []
		this.discovered = null
		this.primaryFails = 0
		this.lastStatus = ''
		this.loggedErrors = new Set()
	}

	async start() {
		this.configured = tally.parseInputs(this.config.inputs)
		this.inputs = this.configured.slice()
		this.tally = new Map()
		this.definitionSignature = ''
		this.rebuildDefinitions()
		this.recompute()
		this.setActionDefinitions({})
		const host = String(this.config.host || '').trim()
		if (!host) {
			this.setStatus(InstanceStatus.BadConfig, 'Director IP missing')
			return
		}
		this.setStatus(InstanceStatus.Connecting, `Connecting to ${host} …`)
		await this.poll()
		this.pollTimer = setInterval(() => this.guard('poll', () => this.poll()), POLL_MS)
	}

	/**
	 * Runs `fn` and turns exceptions into log lines instead of a crashed module process.
	 * @param {string} what
	 * @param {() => unknown} fn
	 */
	guard(what, fn) {
		if (this.destroyed) return undefined
		try {
			const r = fn()
			if (r && typeof r.then === 'function')
				r.catch((e) => this.log('error', `Internal error in ${what}: ${e?.stack || e}`))
			return r
		} catch (e) {
			this.log('error', `Internal error in ${what}: ${e?.stack || e?.message || e}`)
			return undefined
		}
	}

	setStatus(status, message) {
		const key = `${status}|${message}`
		if (key === this.lastStatus) return
		this.lastStatus = key
		this.updateStatus(status, message)
	}

	/** Logs a message once per connection (repeated Live Update errors). */
	logOnce(level, msg) {
		if (this.loggedErrors.has(msg)) return
		this.loggedErrors.add(msg)
		this.log(level, msg)
	}

	// ────────────────────────────────────────────────────────────── host + transports (REST GET)

	/** @param {string} address "ip" or "ip:port" */
	async readTransports(address) {
		const { host, port } = tally.splitHost(address)
		return new SessionApi({ host, port, timeoutMs: REQUEST_TIMEOUT_MS }).transports()
	}

	async poll() {
		if (this.destroyed) return
		const primary = String(this.config.host || '').trim()
		const backup = String(this.config.host2 || '').trim()
		let host = primary
		let list = null
		let error = ''
		try {
			list = await this.readTransports(primary)
			this.primaryFails = 0
		} catch (e) {
			error = String(e?.message || e)
			this.primaryFails++
			if (backup && backup !== primary && (this.primaryFails >= FAILS_BEFORE_BACKUP || this.liveHost === backup)) {
				try {
					list = await this.readTransports(backup)
					host = backup
				} catch (e2) {
					error = `${primary}: ${error}; ${backup}: ${e2?.message || e2}`
				}
			}
		}
		if (this.destroyed) return
		if (!list) {
			// keep an existing Live Update connection: it reconnects on its own and may still deliver
			if (!this.liveConnected) this.setStatus(InstanceStatus.ConnectionFailure, `Session API: ${error}`)
			return
		}
		if (host !== this.liveHost) this.useHost(host)
		this.transportList = list
		this.syncGroups()
		this.refreshStatus()
		this.publish()
	}

	/** @param {string} address */
	useHost(address) {
		if (this.live) this.live.stop()
		this.liveConnected = false
		this.data = new Map()
		this.discovered = null
		this.liveHost = address
		this.loggedErrors = new Set()
		const { host, port } = tally.splitHost(address)
		const live = new LiveUpdate({ host, port, updateMs: UPDATE_MS })
		this.live = live
		live.on('open', () =>
			this.guard('live open', () => {
				if (this.live !== live) return
				this.liveConnected = true
				this.log('info', `Live Update connected (${address})`)
				this.refreshStatus()
			}),
		)
		live.on('close', (reason) =>
			this.guard('live close', () => {
				if (this.live !== live) return
				const was = this.liveConnected
				this.liveConnected = false
				this.data = new Map()
				if (was) this.log('warn', `Live Update closed (${address}): ${reason}`)
				else this.logOnce('warn', `Live Update: ${address} does not answer (${reason}) – retrying`)
				this.recompute()
				this.refreshStatus()
			}),
		)
		live.on('error', (msg) => this.guard('live error', () => this.logOnce('warn', String(msg))))
		live.on('refused', (path) =>
			this.guard('live refused', () => this.log('debug', `Designer refused ${path} (project loading?) – retrying`)),
		)
		live.on('update', (u) => this.guard('live update', () => this.onLive(u)))
		this.log('info', `Reading tally from ${address}`)
		live.start()
	}

	/** Transports to watch: configured names (if any) that exist, else all. */
	watchedTransports() {
		const wanted = tally.parseList(this.config.transports).map(tally.norm)
		if (wanted.length === 0) return this.transportList
		return this.transportList.filter(
			(t) => wanted.includes(tally.norm(t.name)) || wanted.includes(tally.norm(ex.objectPathName(t.name))),
		)
	}

	/** Builds the Live Update groups for the watched transports. */
	syncGroups() {
		if (!this.live) return
		const watched = this.watchedTransports()
		const previewSeconds = Math.max(0, Number(this.config.previewSeconds ?? 10) || 0)
		const groups = []
		for (const t of watched) {
			const objectPath = `transportmanager:${ex.objectPathName(t.name)}`
			groups.push({ tag: `program:${t.name}`, objectPath, props: { program: ex.PROGRAM_EXPR }, updateMs: UPDATE_MS })
			if (previewSeconds > 0)
				groups.push({
					tag: `preview:${t.name}`,
					objectPath,
					props: { preview: ex.previewExpr(previewSeconds) },
					updateMs: PREVIEW_MS,
				})
		}
		const first = watched[0] || this.transportList[0]
		if (first)
			groups.push({
				tag: 'inputs',
				objectPath: `transportmanager:${ex.objectPathName(first.name)}`,
				props: { inputs: ex.INPUTS_EXPR },
				updateMs: INPUTS_MS,
			})
		// forget data of transports that are no longer watched
		const names = new Set(watched.map((t) => t.name))
		for (const n of [...this.data.keys()]) if (!names.has(n)) this.data.delete(n)
		this.live.setGroups(groups)
	}

	refreshStatus() {
		if (this.destroyed) return
		if (!this.liveConnected) {
			this.setStatus(InstanceStatus.Connecting, `Session API ok (${this.liveHost}), Live Update connecting …`)
			return
		}
		const watched = this.watchedTransports()
		if (watched.length === 0) {
			const wanted = tally.parseList(this.config.transports)
			this.setStatus(
				InstanceStatus.UnknownWarning,
				wanted.length ? `No transport named ${wanted.join(', ')}` : 'No transport in the session',
			)
			return
		}
		const missing = tally.missingInputs(this.configured, this.discovered)
		if (missing.length) {
			this.setStatus(
				InstanceStatus.UnknownWarning,
				`Not found as live input: ${missing.map((i) => i.resource).join(', ')}`,
			)
			return
		}
		if (this.discovered !== null && this.inputs.length === 0) {
			this.setStatus(InstanceStatus.UnknownWarning, 'No live input in the project')
			return
		}
		this.setStatus(
			InstanceStatus.Ok,
			`${this.liveHost}: ${this.inputs.length} input(s), ${watched.length} transport(s)`,
		)
	}

	// ────────────────────────────────────────────────────────────── Live Update data

	/** @param {{tag:string, objectPath:string, values:Record<string, unknown>}} u */
	onLive(u) {
		if (this.destroyed) return
		const sep = u.tag.indexOf(':')
		const kind = sep >= 0 ? u.tag.slice(0, sep) : u.tag
		const name = sep >= 0 ? u.tag.slice(sep + 1) : ''
		if (kind === 'inputs') {
			if (Array.isArray(u.values.inputs)) {
				this.discovered = u.values.inputs.map((x) => String(x))
				this.inputs = tally.effectiveInputs(this.configured, this.discovered)
				this.rebuildDefinitions()
			}
			this.refreshStatus()
			this.recompute()
			return
		}
		let d = this.data.get(name)
		if (!d) {
			d = { program: [], preview: [] }
			this.data.set(name, d)
		}
		if ('program' in u.values) d.program = u.values.program
		if ('preview' in u.values) d.preview = u.values.preview
		this.recompute()
	}

	// ────────────────────────────────────────────────────────────── tally + publishing

	/** @param {number} index */
	tallyOf(index) {
		return this.tally.get(index) ?? 'off'
	}

	recompute() {
		if (this.destroyed) return
		const watched = new Set(this.watchedTransports().map((t) => t.name))
		const transports = new Map([...this.data].filter(([n]) => watched.has(n)))
		const prev = this.tally
		this.tally = tally.computeTally({ inputs: this.inputs, transports: this.liveConnected ? transports : new Map() })
		const changed = prev.size !== this.tally.size || [...this.tally].some(([i, s]) => prev.get(i) !== s)
		this.publish()
		if (changed) this.checkFeedbacks('program', 'preview')
	}

	publish() {
		/** @type {Record<string, unknown>} */
		const values = {}
		for (const i of this.inputs) {
			values[`input_${i.index}_name`] = i.label
			values[`input_${i.index}_state`] = tally.STATE_TEXT[this.tallyOf(i.index)]
		}
		values.transports = this.transportList.map((t) => t.name).join(', ')
		this.sendVariables(values)
	}

	/** Sends only variables whose value changed. */
	sendVariables(values) {
		/** @type {Record<string, unknown>} */
		const changed = {}
		let any = false
		for (const [id, value] of Object.entries(values)) {
			if (this.sentVariables.has(id) && this.sentVariables.get(id) === value) continue
			this.sentVariables.set(id, value)
			changed[id] = value
			any = true
		}
		if (any) this.setVariableValues(changed)
	}

	/** Variable, feedback and preset definitions depend on the input list; rebuilt only when it changes. */
	rebuildDefinitions() {
		if (this.destroyed) return
		const sig = JSON.stringify([this.label, this.inputs.map((i) => [i.index, i.resource, i.label])])
		if (sig === this.definitionSignature) return
		this.definitionSignature = sig
		this.setVariableDefinitions(getVariableDefinitions(this.inputs))
		this.sentVariables = new Map()
		this.setFeedbackDefinitions(getFeedbackDefinitions(this))
		const { structure, presets } = getPresetDefinitions(this)
		this.setPresetDefinitions(structure, presets)
	}
}

module.exports = { TallyInstance }
