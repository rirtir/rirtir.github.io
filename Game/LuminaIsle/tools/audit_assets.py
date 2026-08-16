"""生成済み画像の可視領域を監査し、実行時の描画補正メタデータを作る。

PNG 全体の大きさではなくアルファチャンネルの境界を記録することで、
透明余白が異なる画像でも、足元・中心・見かけの大きさをそろえて描画できる。
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets"
MANIFEST_PATH = ASSET_DIR / "generated-v4.json"
JSON_PATH = ASSET_DIR / "asset-metrics.json"
JS_PATH = ASSET_DIR / "asset-metrics.js"


def inspect_image(path: Path) -> dict[str, object]:
    with Image.open(path) as source:
        image = source.convert("RGBA")
        alpha = image.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            raise RuntimeError(f"可視ピクセルがありません: {path}")
        left, top, right, bottom = bbox
        visible_width = right - left
        visible_height = bottom - top
        opaque_pixels = sum(1 for value in alpha.getdata() if value > 8)
        coverage = opaque_pixels / max(1, image.width * image.height)
        return {
            "size": [image.width, image.height],
            "bbox": [left, top, visible_width, visible_height],
            "visibleCenter": [left + visible_width / 2, top + visible_height / 2],
            "footAnchor": [left + visible_width / 2, bottom],
            "coverage": round(coverage, 5),
        }


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    metrics: dict[str, dict[str, object]] = {}
    for key, relative_path in manifest.items():
        metrics[key] = inspect_image(ROOT / relative_path)

    payload = json.dumps(metrics, ensure_ascii=False, indent=2)
    JSON_PATH.write_text(payload + "\n", encoding="utf-8")
    JS_PATH.write_text("window.LI_ASSET_METRICS = " + payload + ";\n", encoding="utf-8")

    hero = {key: value for key, value in metrics.items() if key.startswith("hero_")}
    heights = [value["bbox"][3] for value in hero.values()]
    worst = sorted(metrics.items(), key=lambda item: item[1]["coverage"])[:8]
    print(f"監査完了: {len(metrics)}画像 / 主人公可視高 {min(heights)}..{max(heights)}px")
    for key, value in worst:
        print(f"  透明余白大: {key} coverage={value['coverage']:.1%} bbox={value['bbox']}")


if __name__ == "__main__":
    main()
