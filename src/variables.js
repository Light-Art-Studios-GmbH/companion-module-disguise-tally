/**
 * @file Variable definitions. Every input gets `input_<n>_name` and `input_<n>_state` (PGM / PVW / OFF),
 * n = its position in the input list (1-based); plus `transports`, every transport of the project.
 */

/**
 * @param {{index:number, label:string}[]} inputs
 */
function getVariableDefinitions(inputs) {
	/** @type {Record<string, {name:string}>} */
	const defs = {}
	for (const i of inputs) {
		defs[`input_${i.index}_name`] = { name: `Input ${i.index}: name` }
		defs[`input_${i.index}_state`] = { name: `Input ${i.index} (${i.label}): state (PGM, PVW, OFF)` }
	}
	defs.transports = { name: 'Transports in the project' }
	return defs
}

module.exports = { getVariableDefinitions }
