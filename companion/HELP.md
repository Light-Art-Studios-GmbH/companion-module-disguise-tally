## Disguise: Live Input Tally

Read-only tally for disguise Designer. The module shows for every live input (video in, capture, NDI, ST 2110 …)
whether it is **PGM** (on air), **PVW** (coming up) or **OFF**.

**The module cannot control Designer.** It has no actions; it only reads through the session API:
`GET /api/session/transport/transports` and Live Update subscriptions with fixed, read-only expressions. Nothing has
to be set up in Designer and no plugin is needed – Designer only has to run and be reachable on port 80.

### Settings

| Setting             | Meaning                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Director IP         | The machine running Designer as Director. Another port than 80 as `ip:port`.                                                                                                                                                                                                                        |
| Backup IP           | Optional. Used while the Director does not answer.                                                                                                                                                                                                                                                  |
| Inputs              | **Empty: every live input of the project**, named as in Designer. Or list them yourself, one per line: `Resource name = Label`, e.g. `videoin_1.mov = Camera 1` (label optional). Names are compared without case, spaces, underscores and file extension, so `Video in 1` matches `videoin_1.mov`. |
| Transports to watch | Comma separated; empty = all transports. The variable `transports` lists every transport to copy names from.                                                                                                                                                                                        |
| Preview             | An input on a layer that starts within this many seconds is PVW. 0 = no preview.                                                                                                                                                                                                                    |

### When an input is PGM, PVW or OFF

- **PGM** – on a watched transport, an enabled layer at the playhead renders the input with a brightness of at least
  1 %. Keyframes, expressions and indirections are resolved by Designer itself. Engaged or not does not matter.
- **PVW** – not PGM, but on an enabled layer at the playhead that is faded below 1 % (it comes up with the fade), or
  keyed on an enabled video layer that starts within the preview time.
- **OFF** – everything else.

Muted layers are not seen by the tally (Designer does not tell the API which layers are muted). To take a live
layer off air, disable it (brightness 0 shows the input as PVW).

### Variables

Per input `n`: `input_n_name` (label) and `input_n_state` (`PGM`, `PVW`, `OFF`).
`transports`: every transport of the project.

With an empty input list `n` follows Designer's alphabetical order of the live inputs – list the inputs yourself if
buttons must keep their input when inputs are added or renamed.

### Feedbacks and presets

- **Input on air (PGM)** – red
- **Input coming up (PVW)** – green

Presets: one tally button per input (name and state).
