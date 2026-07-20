# Structured Score Format

Use JSON `version: 1`. The composition script expands this authoring format into one PCE Game Editor `version: 2` PSG JSON file.

## Metadata

- `id`: ASCII letters, digits, `_`, or `-`; at most 48 characters.
- `name`: display name.
- `type`: `psg-song` or `psg-sfx`.
- `bpm`: integer 30–300.
- `timeSignature`: descriptive value; use `4/4` unless requested otherwise.
- `bars`: positive integer.
- `stepsPerBar`: positive integer. Use 16 for a 4/4 sixteenth-note grid.
- `volume`: master volume 0–100.
- `loop`: `true` for `psg-song`, `false` for `psg-sfx`.
- `sections`: optional ordered objects with `name`, `startBar`, and `endBar`.

## Tracks

Each track has one unique `channel` from 0 to 5, a descriptive `role`, an optional default `wave` from 0 to 45, and an `events` array.

Tone event:

```json
{ "bar": 1, "offset": 0, "duration": 4, "note": "E4", "volume": 18 }
```

Use `start` instead of `bar` plus `offset` when absolute steps are clearer. A tone may provide `period` 1–4095 instead of `note`. Note names accept MIDI-range notes such as `C-1`, `F#4`, and `Bb5`.

Noise event on channel 4 or 5:

```json
{ "bar": 1, "offset": 0, "duration": 1, "noise": 2, "volume": 6 }
```

`noise` is the HuC6280 5-bit noise frequency 1–31. An event can repeat without being copied:

```json
{ "bar": 1, "offset": 2, "duration": 1, "noise": 30, "volume": 3, "repeatEvery": 4, "repeatCount": 64 }
```

Events on the same track must be monophonic and non-overlapping. Back-to-back events change pitch without an inserted silence. A gap causes the script to insert a zero-volume event at the prior event's end.

## Generation Checks

The script checks the authoring shape, numeric ranges, channel allocation, event overlap, duplicate step/channel pairs, section coverage, and the 2048-event ceiling. These are construction safeguards only. They do not verify sound, musical quality, game integration, ROM builds, emulators, or hardware.
