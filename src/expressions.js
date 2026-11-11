/**
 * @file The fixed, read-only Designer expressions the module subscribes.
 *
 * Live Update evaluates each property as a Python 2 expression with `object` bound to the subscribed object
 * (here `transportmanager:<name>`). Every expression below only reads: no assignment, no setattr, no method
 * that changes the project. Sources: developer.disguise.one Python API (d3.pyi r34.2) and the Live Update guide.
 *
 *   object.player                 TrackPlayer of the transport
 *   object.player.tCurrent        playhead in beats (documented)
 *   object.player.playHead        TrackPlayHead; getModuleForLayer(layer) gives the live Module of a layer – for
 *                                 active layers the render path writes the timeline values into it every frame,
 *                                 so `.video` / `.brightness` are what Designer renders right now (keyframes,
 *                                 expressions, indirections and sockpuppets already resolved)
 *   object.player.activeLayers    layers the player currently renders (undocumented, verified on r34.2.4)
 *   layer.tStart                  layer start in beats
 *   layer.enabledIncludingParents layer and all parent groups enabled
 *   track.beatToTime(beat)        beats → seconds (BPM can vary along a track)
 *   VideoClip.isVideoIn           the clip is a live input (capture, NDI, ST 2110 …)
 */

const D3 = "__import__('d3')"

/** Layer (module) types that have a `video` field of type VideoClip. */
const VIDEO_MODULES = ['VariableVideoModule', 'VideoModule', 'SockPuppetVideoModule', 'VideoTriggerModule']

/** Python: all leaf layers of `tr` whose module has a video field. */
function videoLayers(tr) {
	const names = `[${VIDEO_MODULES.map((n) => `'${n}'`).join(', ')}]`
	return `[x for n in ${names} if hasattr(${D3}, n) for x in ${tr}.getLeafLayers(getattr(${D3}, n))]`
}

/** Python: names of every resource keyed in the layer's video sequence (static value = key 0). */
function keyedResources(l) {
	return (
		`(lambda fs: (lambda s: [str(r.description) for r in [s.evalResource(s.t(i)) for i in range(s.nKeys())] if r is not None])(fs.sequence) if fs is not None else [])` +
		`(${l}.findSequence('video'))`
	)
}

/** Python: [layer, clip, brightness, isVideoIn] for a layer whose live module plays a clip. */
const PROGRAM_ROW =
	"[str(l.name), str(m.video.description), round(float(getattr(m, 'brightness', 1.0)), 3), bool(getattr(m.video, 'isVideoIn', False))]"
const HAS_VIDEO = "m is not None and getattr(m, 'video', None) is not None"

/**
 * What is on air: every enabled layer the player renders at the playhead (player.activeLayers, verified on r34.2.4)
 * and the clip its live module renders.
 */
const PROGRAM_EXPR =
	`(lambda p: [${PROGRAM_ROW} for l in p.activeLayers if getattr(l, 'enabledIncludingParents', False)` +
	` for m in [p.playHead.getModuleForLayer(l)] if ${HAS_VIDEO}] if p.track else [])(object.player)`

/**
 * Coming up: enabled video layers that start within the next `seconds` and the clips keyed on them.
 * @param {number} seconds
 */
function previewExpr(seconds) {
	const s = Math.max(0, Number(seconds) || 0)
	return (
		`(lambda p, b: [[str(l.name), ${keyedResources('l')}] for l in ${videoLayers('p.track')}` +
		` if l.enabledIncludingParents and b < l.tStart and p.track.beatToTime(l.tStart) - p.track.beatToTime(b) <= ${s}]` +
		` if p.track else [])(object.player, object.player.tCurrent)`
	)
}

/** Live input clips of the project (VideoClip resources with isVideoIn). */
const INPUTS_EXPR = `sorted([str(c.description) for c in ${D3}.resourceManager.allResources(${D3}.VideoClip) if getattr(c, 'isVideoIn', False)])`

/** "IMAG Screens" → "IMAG_Screens": Designer's object-path form of a resource name. */
function objectPathName(name) {
	return String(name ?? '')
		.trim()
		.replace(/\s+/g, '_')
}

module.exports = {
	D3,
	VIDEO_MODULES,
	videoLayers,
	keyedResources,
	PROGRAM_EXPR,
	previewExpr,
	INPUTS_EXPR,
	objectPathName,
}
