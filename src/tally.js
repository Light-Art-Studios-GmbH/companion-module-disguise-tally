/**
 * @file Pure tally logic: parsing the connection settings and computing the state of every input from what the
 * Live Update subscriptions deliver. No I/O here, so everything is covered by test/logic.test.js.
 *
 * States: PGM (on air on a watched transport), PVW (at the playhead but faded out, or on a layer that starts within
 * the preview time), OFF.
 */

/**
 * @typedef {{index:number, resource:string, label:string}} InputDef
 * @typedef {{program:unknown, preview:unknown}} TransportData
 * @typedef {'program'|'preview'|'off'} TallyState
 */

/** A layer below this brightness (0..1) is not on air. */
const MIN_BRIGHTNESS = 0.01

/** Case- and whitespace-insensitive key for comparing transport names. */
function norm(s) {
	return String(s ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase()
}

/**
 * Key for comparing resource names. Designer names live input clips after their file (`videoin_1.mov`, path
 * objects/videoclip/videoin_1.mov.apx; seen on r34.2.4), while operators write "Video in 1": the key drops the
 * folder, the .apx and media extension and everything that is not a letter or digit, so both give "videoin1".
 * @param {unknown} s
 */
function resKey(s) {
	return String(s ?? '')
		.trim()
		.toLowerCase()
		.replace(/^.*[/\\]/, '')
		.replace(/\.apx$/, '')
		.replace(/\.(mov|mp4|m4v|avi|mxf|mkv|mpg|mpeg|png|jpg|jpeg|tif|tiff|exr|dds|tga)$/, '')
		.replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Parses the input list: one input per line (or separated by ";"), "Resource name = Label" or just the name.
 * Empty lines and lines starting with # are ignored; duplicates (same resource) are dropped.
 * @param {unknown} text
 * @returns {InputDef[]}
 */
function parseInputs(text) {
	/** @type {InputDef[]} */
	const out = []
	const seen = new Set()
	for (const raw of String(text ?? '').split(/[\r\n;]+/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const eq = line.indexOf('=')
		const resource = (eq >= 0 ? line.slice(0, eq) : line).trim()
		const label = (eq >= 0 ? line.slice(eq + 1) : '').trim() || resource
		if (!resource || seen.has(resKey(resource))) continue
		seen.add(resKey(resource))
		out.push({ index: out.length + 1, resource, label })
	}
	return out
}

/**
 * The inputs the module shows: the configured list, or – when the list is empty – every live input Designer
 * reports (in Designer's sorted order).
 * @param {InputDef[]} configured
 * @param {string[]|null} discovered
 * @returns {InputDef[]}
 */
function effectiveInputs(configured, discovered) {
	if (configured.length) return configured
	/** @type {InputDef[]} */
	const out = []
	const seen = new Set()
	for (const name of discovered || []) {
		const k = resKey(name)
		if (!k || seen.has(k)) continue
		seen.add(k)
		out.push({ index: out.length + 1, resource: String(name), label: String(name) })
	}
	return out
}

/**
 * Comma / semicolon / newline separated list (transport filter).
 * @param {unknown} text
 * @returns {string[]}
 */
function parseList(text) {
	const out = []
	const seen = new Set()
	for (const raw of String(text ?? '').split(/[,;\r\n]+/)) {
		const s = raw.trim()
		if (!s || seen.has(norm(s))) continue
		seen.add(norm(s))
		out.push(s)
	}
	return out
}

/**
 * "10.0.0.5" or "10.0.0.5:8080" → host and port (default 80).
 * @param {unknown} text
 * @returns {{host:string, port:number}}
 */
function splitHost(text) {
	const s = String(text ?? '').trim()
	const m = /^(.*[^:]):(\d{1,5})$/.exec(s)
	if (m && !m[1].includes(':')) return { host: m[1], port: Number(m[2]) || 80 }
	return { host: s, port: 80 }
}

/** @param {unknown} v */
const asArray = (v) => (Array.isArray(v) ? v : [])

/**
 * Computes the tally of every input.
 * program rows: [layer, clip, brightness, isVideoIn]; preview rows: [layer, clips[]].
 * @param {object} o
 * @param {InputDef[]} o.inputs
 * @param {Map<string, TransportData>|Record<string, TransportData>} o.transports name → data (watched only)
 * @returns {Map<number, TallyState>} input index → state
 */
function computeTally(o) {
	const entries = o.transports instanceof Map ? [...o.transports.values()] : Object.values(o.transports || {})
	const program = new Set()
	const preview = new Set()
	for (const d of entries) {
		if (!d) continue
		for (const r of asArray(d.program)) {
			if (!Array.isArray(r) || r.length < 2) continue
			const b = Number.isFinite(Number(r[2])) ? Number(r[2]) : 1
			// at the playhead but faded out: standing by, comes up with the fade → PVW
			if (b >= MIN_BRIGHTNESS) program.add(resKey(r[1]))
			else preview.add(resKey(r[1]))
		}
		for (const r of asArray(d.preview)) if (Array.isArray(r)) for (const c of asArray(r[1])) preview.add(resKey(c))
	}
	/** @type {Map<number, TallyState>} */
	const result = new Map()
	for (const i of o.inputs) {
		const k = resKey(i.resource)
		result.set(i.index, program.has(k) ? 'program' : preview.has(k) ? 'preview' : 'off')
	}
	return result
}

/**
 * Configured inputs whose resource does not exist among the live inputs Designer reports.
 * @param {InputDef[]} inputs
 * @param {string[]|null} discovered null = not known yet
 * @returns {InputDef[]}
 */
function missingInputs(inputs, discovered) {
	if (!discovered) return []
	const known = new Set(discovered.map(resKey))
	return inputs.filter((i) => !known.has(resKey(i.resource)))
}

/** State text for variables and buttons. */
const STATE_TEXT = { program: 'PGM', preview: 'PVW', off: 'OFF' }

module.exports = {
	MIN_BRIGHTNESS,
	norm,
	resKey,
	parseInputs,
	effectiveInputs,
	parseList,
	splitHost,
	computeTally,
	missingInputs,
	STATE_TEXT,
}
