#!/usr/bin/env python3
"""Convert event stills to PCE-friendly 224x136 indexed PNGs.

Default output uses at most 15 visible colors and leaves palette index 0 unused
as a reserved slot. Palette channels are snapped to PC Engine-like 3-bit RGB
levels. Dithering is disabled by default to keep large flat color areas clean.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image, ImageEnhance, ImageOps
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Pillowが必要です: python -m pip install Pillow") from exc

TARGET_SIZE = (224, 136)


def flat_pixels(image: Image.Image):
    getter = getattr(image, "get_flattened_data", None)
    return getter() if getter is not None else image.getdata()


PCE_LEVELS = (0, 36, 73, 109, 146, 182, 219, 255)


def snap_channel(value: int) -> int:
    return min(PCE_LEVELS, key=lambda level: abs(level - value))


def snap_color(color: tuple[int, int, int]) -> tuple[int, int, int]:
    return tuple(snap_channel(channel) for channel in color)  # type: ignore[return-value]


def fit_image(image: Image.Image, mode: str, background: tuple[int, int, int]) -> Image.Image:
    image = image.convert("RGB")
    if mode == "crop":
        return ImageOps.fit(image, TARGET_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    if mode == "contain":
        contained = ImageOps.contain(image, TARGET_SIZE, method=Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", TARGET_SIZE, background)
        x = (TARGET_SIZE[0] - contained.width) // 2
        y = (TARGET_SIZE[1] - contained.height) // 2
        canvas.paste(contained, (x, y))
        return canvas
    if mode == "stretch":
        return image.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
    raise ValueError(f"unknown fit mode: {mode}")


def quantize_pce(
    image: Image.Image,
    colors: int,
    dither: bool,
    contrast: float,
    saturation: float,
) -> tuple[Image.Image, list[tuple[int, int, int]]]:
    if not 1 <= colors <= 15:
        raise ValueError("colors must be in 1..15")

    prepared = ImageEnhance.Contrast(image).enhance(contrast)
    prepared = ImageEnhance.Color(prepared).enhance(saturation)
    dither_mode = Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE
    quantized = prepared.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=dither_mode)

    source_palette = quantized.getpalette() or []
    used_source_indices = sorted(set(flat_pixels(quantized)))

    # Merge colors that become equal after snapping to the PCE 3-bit channel grid.
    snapped_colors: list[tuple[int, int, int]] = []
    snapped_to_output: dict[tuple[int, int, int], int] = {}
    source_to_output: dict[int, int] = {}
    for source_index in used_source_indices:
        offset = source_index * 3
        raw = tuple(source_palette[offset : offset + 3])
        if len(raw) != 3:
            raw = (0, 0, 0)
        snapped = snap_color(raw)  # type: ignore[arg-type]
        if snapped not in snapped_to_output:
            # Output index 0 is reserved. Visible colors start at 1.
            snapped_to_output[snapped] = len(snapped_colors) + 1
            snapped_colors.append(snapped)
        source_to_output[source_index] = snapped_to_output[snapped]

    pixels = list(flat_pixels(quantized))
    remapped = bytes(source_to_output[index] for index in pixels)
    output = Image.frombytes("P", quantized.size, remapped)

    # Palette index 0 is reserved and intentionally unused.
    flat_palette: list[int] = [0, 0, 0]
    for color in snapped_colors:
        flat_palette.extend(color)
    flat_palette.extend([0] * (768 - len(flat_palette)))
    output.putpalette(flat_palette)
    return output, snapped_colors


def validate_output(path: Path) -> dict[str, object]:
    image = Image.open(path)
    if image.size != TARGET_SIZE:
        raise ValueError(f"unexpected output size: {image.size}")
    if image.mode != "P":
        raise ValueError(f"output is not indexed PNG: {image.mode}")
    used_indices = sorted(set(flat_pixels(image)))
    if 0 in used_indices:
        raise ValueError("palette index 0 is reserved but used by image pixels")
    if len(used_indices) > 15:
        raise ValueError(f"too many visible colors: {len(used_indices)}")
    palette = image.getpalette() or []
    colors: list[str] = []
    for index in used_indices:
        rgb = tuple(palette[index * 3 : index * 3 + 3])
        if len(rgb) != 3 or not all(channel in PCE_LEVELS for channel in rgb):
            raise ValueError(f"non-PCE palette color at index {index}: {rgb}")
        colors.append("#%02x%02x%02x" % rgb)
    return {
        "path": str(path),
        "size": list(image.size),
        "mode": image.mode,
        "visibleColorCount": len(used_indices),
        "reservedIndex": 0,
        "usedIndices": used_indices,
        "paletteColors": colors,
    }


def parse_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) != 6:
        raise argparse.ArgumentTypeError("RGBはRRGGBB形式で指定してください")
    try:
        return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("RGBは16進数で指定してください") from exc


def collect_jobs(args: argparse.Namespace) -> list[tuple[Path, Path]]:
    if args.input and args.output:
        return [(args.input, args.output)]
    if args.input_dir and args.output_dir:
        candidates = sorted(
            path for path in args.input_dir.iterdir() if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        )
        if not candidates:
            raise SystemExit(f"入力画像がありません: {args.input_dir}")
        jobs: list[tuple[Path, Path]] = []
        for offset, source in enumerate(candidates, start=args.start_index):
            if args.prefix:
                destination_name = f"{args.prefix}{offset:03d}.png"
            else:
                destination_name = source.stem + ".png"
            jobs.append((source, args.output_dir / destination_name))
        return jobs
    raise SystemExit("--input/--output または --input-dir/--output-dir を指定してください")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--prefix", default="", help="一括変換時の出力prefix。例: ep02_")
    parser.add_argument("--start-index", type=int, default=1)
    parser.add_argument("--fit", choices=("crop", "contain", "stretch"), default="crop")
    parser.add_argument("--background", type=parse_rgb, default=(0, 0, 0), help="contain時の余白色 RRGGBB")
    parser.add_argument("--colors", type=int, default=15, help="表示色数。最大15")
    parser.add_argument("--dither", action="store_true", help="Floyd-Steinbergを使う。通常は指定しない")
    parser.add_argument("--contrast", type=float, default=1.04)
    parser.add_argument("--saturation", type=float, default=1.08)
    parser.add_argument("--report", type=Path, help="変換レポートJSON")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    jobs = collect_jobs(args)
    results: list[dict[str, object]] = []

    for source, destination in jobs:
        if not source.exists():
            raise SystemExit(f"入力画像がありません: {source}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as opened:
            fitted = fit_image(opened, args.fit, args.background)
            converted, _ = quantize_pce(
                fitted,
                colors=args.colors,
                dither=args.dither,
                contrast=args.contrast,
                saturation=args.saturation,
            )
            converted.save(destination, format="PNG", bits=4, optimize=False)
        result = validate_output(destination)
        result["source"] = str(source)
        results.append(result)
        print(
            f"OK {destination}: 224x136, indexed PNG, "
            f"{result['visibleColorCount']} visible colors + 1 reserved slot"
        )

    report = {"ok": True, "targetSize": list(TARGET_SIZE), "outputs": results}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
