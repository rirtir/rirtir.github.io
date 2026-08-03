"""Create browser-sized terrain textures while preserving generated sources."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
TERRAIN = ROOT / "assets" / "terrain-v4"


def main() -> None:
    for name in ("meadow", "sand", "forest", "rock", "water"):
        source = TERRAIN / f"{name}-source.png"
        image = Image.open(source).convert("RGB")
        image = image.resize((512, 512), Image.Resampling.NEAREST)
        # A fixed adaptive palette keeps GitHub Pages payload small without adding
        # the blur or fringe artifacts that lossy formats introduce to pixel art.
        image = image.quantize(colors=192, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        image.save(TERRAIN / f"{name}.png", optimize=True)
        print(name, (TERRAIN / f"{name}.png").stat().st_size)


if __name__ == "__main__":
    main()
