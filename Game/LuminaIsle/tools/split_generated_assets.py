"""Split AI-generated contact sheets into stable, independent PNG assets.

The generated artwork is visually arranged in a grid, but individual drawings can
cross the mathematical grid boundaries.  Runtime grid cropping therefore causes
neighbouring heads/details to appear in the wrong frame.  This script groups alpha
connected components by their nearest intended cell, crops each drawing, and gives
all hero frames a common bottom-centred canvas for a stable foot anchor.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "generated-v4"

HERO = [
    ["hero_down_idle", "hero_down_walk", "hero_up_idle", "hero_up_walk"],
    ["hero_left_idle", "hero_left_walk", "hero_right_idle", "hero_right_walk"],
    ["hero_down_left_idle", "hero_down_left_walk", "hero_down_right_idle", "hero_down_right_walk"],
    ["hero_up_left_idle", "hero_up_left_walk", "hero_up_right_idle", "hero_up_right_walk"],
]
TOOLS = [
    ["axe", "copper_axe", "pickaxe", "copper_pickaxe", "spear", "light_spear"],
    ["rod", "watering_can", "hammer", "sun_axe", "sun_pickaxe", "sun_spear"],
    ["sun_rod", "sun_watering_can", "branch", "wood", "stone", "fiber"],
    ["berry", "ore", "copper_bar", "crystal", "water", "rope"],
]
FOOD = [
    ["seed", "sunroot", "moonbean_seed", "moonbean", "tide_seed", "tide_melon"],
    ["cooked_berry", "cooked_fish", "soup", "glow_skewer", "field_ration", "moon_tea"],
    ["tide_salad", "prism_stew", "fish", "fish_sun", "fish_moon", "fish_rain"],
    ["fish_rock", "fish_glow", "fish_leaf", "fish_coral", "fish_star", "fish_prism"],
]
WORLD = [
    ["tree", "branch", "rock", "fiber", "berry_bush", "shell"],
    ["ore", "crystal", "resin", "herb", "fishing", "plot"],
    ["slime", "thorn", "crab", "rockling", "forest_warden", "stone_warden"],
    ["stump", "sapling", "sunroot", "moonbean", "tide_melon", "relic"],
]
BUILDINGS = [
    ["campfire", "workbench", "furnace", "chest", "bed", "well"],
    ["lantern", "plot", "fence", "gate", "bridge", "flag"],
    ["bench", "flowerpot", "sun_banner", "shell_chime", "prism_arch", "rain_collector"],
    ["sprinkler", "greenhouse", "request_board", "waystone", "trophy_plinth", "sun_dial"],
    ["beacon_garden", "wood_floor", "stone_floor", "lighthouse", "guide", "windstone"],
]
UI = [
    ["health", "food", "water", "stamina"],
    ["bag", "craft", "build", "journal"],
    ["help", "pause", "interact", "dodge"],
    ["rotate", "place", "dismantle", "locate"],
]


def alpha_components(image: Image.Image) -> tuple[np.ndarray, list[dict[str, object]]]:
    """Return a label map plus significant 8-connected alpha components."""
    alpha = np.asarray(image.getchannel("A"))
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        (alpha > 0).astype(np.uint8), connectivity=8
    )
    components: list[dict[str, object]] = []
    for label in range(1, count):
        x, y, width, height, area = stats[label]
        if area >= 3:  # Ignore isolated chroma-removal dust, retain pixel sparkles.
            components.append(
                {
                    "label": label,
                    "area": int(area),
                    "bbox": (int(x), int(y), int(x + width), int(y + height)),
                    "center": (float(centroids[label][0]), float(centroids[label][1])),
                }
            )
    return labels, components


def extract_sheet(
    source: str, grid: list[list[str]], group: str, prefix: str, hero: bool = False
) -> dict[str, str]:
    image = Image.open(ROOT / "assets" / source).convert("RGBA")
    rows, cols = len(grid), len(grid[0])
    width, height = image.size
    assigned: dict[str, list[dict[str, object]]] = {
        key: [] for row in grid for key in row
    }
    labels, components = alpha_components(image)
    for component in components:
        cx, cy = component["center"]  # type: ignore[misc]
        col = min(cols - 1, max(0, int(cx * cols / width)))
        row = min(rows - 1, max(0, int(cy * rows / height)))
        assigned[grid[row][col]].append(component)

    extracted: dict[str, Image.Image] = {}
    for key, components in assigned.items():
        if not components:
            raise RuntimeError(f"No visible pixels assigned to {source}:{key}")
        boxes = [c["bbox"] for c in components]
        left = max(0, min(b[0] for b in boxes) - 5)  # type: ignore[index]
        top = max(0, min(b[1] for b in boxes) - 5)  # type: ignore[index]
        right = min(width, max(b[2] for b in boxes) + 5)  # type: ignore[index]
        bottom = min(height, max(b[3] for b in boxes) + 5)  # type: ignore[index]
        rgba = np.asarray(image).copy()[top:bottom, left:right]
        local_labels = labels[top:bottom, left:right]
        keep = np.isin(local_labels, [c["label"] for c in components])
        rgba[~keep] = 0
        extracted[key] = Image.fromarray(rgba, "RGBA")

    if hero:
        max_width = max(frame.width for frame in extracted.values()) + 12
        max_height = max(frame.height for frame in extracted.values()) + 12
        for key, frame in list(extracted.items()):
            canvas = Image.new("RGBA", (max_width, max_height), (0, 0, 0, 0))
            canvas.alpha_composite(frame, ((max_width - frame.width) // 2, max_height - frame.height - 6))
            extracted[key] = canvas

    target = OUT / group
    target.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, str] = {}
    for key, frame in extracted.items():
        filename = key.replace("_", "-") + ".png"
        frame.save(target / filename, optimize=True)
        manifest[f"{prefix}{key}"] = f"assets/generated-v4/{group}/{filename}"
    return manifest


def main() -> None:
    manifest: dict[str, str] = {}
    manifest.update(extract_sheet("hero-sheet-v3.png", HERO, "hero", "", hero=True))
    manifest.update(extract_sheet("items-tools-v3.png", TOOLS, "items", "item_"))
    manifest.update(extract_sheet("items-food-v3.png", FOOD, "items", "item_"))
    manifest.update(extract_sheet("world-objects-v3.png", WORLD, "world", "world_"))
    manifest.update(extract_sheet("buildings-v3.png", BUILDINGS, "buildings", "building_"))
    manifest.update(extract_sheet("ui-icons-v3.png", UI, "ui", "ui_"))
    payload = json.dumps(manifest, ensure_ascii=False, indent=2)
    (ROOT / "assets" / "generated-v4.json").write_text(payload + "\n", encoding="utf-8")
    (ROOT / "assets" / "generated-v4.js").write_text(
        "window.LI_GENERATED_ASSETS = " + payload + ";\n", encoding="utf-8"
    )
    print(f"Wrote {len(manifest)} independent assets to {OUT}")


if __name__ == "__main__":
    main()
