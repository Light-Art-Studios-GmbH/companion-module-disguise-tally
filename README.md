# companion-module-disguise-tally

**Disguise: Live Input Tally** – Bitfocus Companion connection module for **disguise Designer** (module id
`disguise-tally`). It shows for every live input (video in, capture, NDI, ST 2110 …) whether it is **PGM** (on air at
the playhead), **PVW** (coming up) or **OFF**, so a camera operator, director or stage manager can have tally on
their own Companion.

The module is **read-only**: it has no actions and only reads from Designer through the session API (REST GET and
Live Update subscriptions with fixed expressions). It is safe to run in a Companion that must not be able to control
the media server. Nothing has to be set up in Designer and no Designer plugin is needed.

Developed and maintained by **Lucas Hoyer, Light Art Studios GmbH** (<lh@lightartstudios.de>).
Licensed under MIT.

User documentation lives in [companion/HELP.md](companion/HELP.md) and is shown inside Companion via the
connection's help button.

---

## Contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [How it works](#how-it-works)
5. [Troubleshooting](#troubleshooting)

---

## Requirements

|           |                                                                               |
| --------- | ----------------------------------------------------------------------------- |
| Companion | 5.0 or newer (module API `@companion-module/base` 2.x, Node 22 runtime)       |
| disguise  | Designer with the session API (verified against r34.2.4)                      |
| Network   | Companion must reach the Director (and optional backup) on the HTTP port (80) |

## Installation

The module is not in Companion's official module list yet. Until it is, download the package from the
[latest release](https://github.com/Light-Art-Studios-GmbH/companion-module-disguise-tally/releases/latest) and
import it in Companion (Modules → Import module package), or put the module into Companion's developer modules
folder.

## Configuration

| Setting             | Meaning                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| Director IP         | The machine running Designer as Director (`ip:port` for another port than 80).     |
| Backup IP           | Optional; used while the Director does not answer.                                 |
| Inputs              | Empty = every live input of the project. Or one per line: `Resource name = Label`. |
| Transports to watch | Comma separated; empty = all transports.                                           |
| Preview             | An input on a layer that starts within this many seconds is PVW (0 = no preview).  |

Per input the module provides the variables `input_n_name` and `input_n_state` (`PGM`, `PVW`, `OFF`), the
feedbacks _Input on air (PGM)_ and _Input coming up (PVW)_, and a layered tally preset. The variable `transports`
lists every transport of the project.

## How it works

- `GET /api/session/transport/transports` (every 10 s) finds the transports and decides between Director and backup.
- Per watched transport the Live Update websocket subscribes two read-only Python expressions on
  `transportmanager:<name>`:
  - **program** (100 ms): the enabled layers the player renders at the playhead and the clip their live module
    plays, with its brightness. An input on a layer with at least 1 % brightness is PGM; below 1 % (faded out,
    standing by) it is PVW.
  - **preview** (500 ms): enabled video layers that start within the preview time and the clips keyed on them.
- Once per connection the list of live inputs of the project (`VideoClip.isVideoIn`) is read every 5 s.

Keyframes, expressions and indirections are resolved by Designer itself, because the module reads what the layer's
live module actually renders.

## Troubleshooting

- **Connection status "Not found as live input"** – a name in the input list does not match a live input of the
  project, e.g. after a rename in Designer. Leave the list empty to use every live input with its Designer name.
- **An input stays OFF although it is on air** – check that its transport is watched (variable `transports`, setting
  _Transports to watch_) and that the layer is enabled. A layer faded below 1 % shows the input as PVW.
- **Muted layers** – Designer does not report which layers are muted, so a muted layer with a live input still shows
  PGM. Disable the layer to take the input off air.
