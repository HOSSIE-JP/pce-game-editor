---
name: compose-pce-psg
description: Compose and revise original PC Engine / TurboGrafx-16 PSG BGM, songs, sound effects, jingles, and looping music as one PCE Game Editor version 2 *.psg.json file. Use for requests mentioning PCE PSG composition, six-channel HuC6280 music, melody/chorus sections, loopable retro BGM, or an import-ready PSG JSON file.
---

# Compose PCE PSG

Create one original, import-ready PCE PSG JSON file from a natural-language brief. Stop after creating the file. The user is responsible for importing it into a project, building ROM or CD media, and checking playback in an emulator or on hardware.

## Workflow

1. Read [request-template.md](references/request-template.md). Ask only about missing conditions that materially change the composition; otherwise apply its defaults.
2. Copy [score-template.json](assets/score-template.json) outside the skill directory and adapt it into an original structured score. Follow [score-format.md](references/score-format.md).
3. Plan the sections, harmony, melody, accompaniment, bass, and optional noise percussion before filling the events. Allocate at most one track to each channel from 0 through 5.
4. Give adjacent sections audible musical contrast through register, rhythm, harmony, density, wave, or volume. For a loop, make the final harmony and phrase lead naturally back to the opening.
5. Generate the import file:

   ```powershell
   node "<skill-dir>\scripts\compose-pce-psg.js" --score "<score.json>" --out "<output-dir>"
   ```

6. Fix any generation error in the score. These checks only prevent structurally invalid output; they are not playback, emulator, or hardware verification.
7. Deliver only `<id>.psg.json` and a short note describing important musical assumptions.

## Construction Rules

- Write PCE Game Editor `version: 2` JSON containing exactly one `psg-song` or `psg-sfx` asset.
- Keep BPM at 30–300, total steps at 1–4096, pattern events at 2048 or fewer, channels at 0–5, period at 1–4095, event volume at 0–31, and wave at 0–45.
- Put noise only on channels 4 or 5. Never emit two events for the same step and channel.
- Use `psg-song` with `loop: true` for looping BGM. Use `psg-sfx` with `loop: false` for one-shot jingles and effects.
- Treat waves 0–44 as timbral selections and wave 45 as the user square wave.
- Do not imitate a copyrighted melody. Translate references into abstract traits such as tempo, register, texture, rhythm, and section behavior.

## Scope Boundary

This skill does not import the JSON into PCE Game Editor, modify a game project, create HuCARD or Super CD-ROM2 binaries, build ROM/CUE media, run Test Play or an emulator, inspect PSG hardware state, or write a validation report. Those integration and playback checks are completed by a human after delivery.

## Output Contract

Write exactly one deliverable to the chosen output directory:

- `<id>.psg.json`: PCE Game Editor version 2 PSG import file.
