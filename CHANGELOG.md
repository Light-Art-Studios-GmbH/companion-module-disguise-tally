# Changelog

## 1.0.0 – 2026-11-12

- First release: read-only tally for live inputs (video in, capture, NDI, ST 2110 …) used on the disguise Designer
  timeline. Every input is **PGM** (on air at the playhead), **PVW** (at the playhead but faded out, or on a layer that
  starts within the preview time) or **OFF**.
- Inputs: every live input of the project automatically, or an own list (`Resource name = Label`).
- Director and optional backup IP, transports to watch, preview time.
- Variables `input_n_name` / `input_n_state` and `transports`, PGM and PVW feedbacks, one layered preset per input.
- No actions: the module only reads from Designer (REST GET and Live Update subscriptions).
