# 画像生成記録

## 実行方式

- 方式: built-in imagegen（通常生成、プロジェクト用）
- 分類: `stylized-concept`
- 参照画像: なし
- 出力: 生成後にこのフォルダへ保存し、WebP/JPEG派生版を制作する

## キービジュアル最終プロンプト

```text
Use case: stylized-concept
Asset type: title-screen key art for a browser pixel-art survival crafting game
Primary request: a bright, inviting top-down island where a small traveler gathers resources, farms, crafts, fishes, and restores a lighthouse
Scene/backdrop: one compact sunlit island surrounded by clear turquoise sea; meadow in front, leafy grove, sandy tide pools, pale rocky hill, a tiny farm, workbench and campfire; restored lighthouse as the central landmark
Subject: a small gender-neutral traveler with a straw-colored hood, white jacket, coral scarf, and teal boots, seen from a high three-quarter top-down angle
Style/medium: polished 2D pixel-art game key art, crisp chunky pixels, 16-bit-inspired but with an original modern palette, toy-like botanical shapes
Composition/framing: wide landscape composition; traveler in lower center; lighthouse near center; generous simple sky and cloud area across upper-left/upper-center for an HTML title overlay
Lighting/mood: high-key warm midday sunlight, cheerful, breezy, calm adventure; shadows are short blue-violet shapes, never dark
Color palette: cream, sun yellow, young green, mint, turquoise, sky blue, coral accents, lavender shadows; no black-dominant areas
Materials/textures: simplified readable pixel clusters, clear silhouettes, lightly animated-game feeling
Constraints: no text, no logo, no interface, no watermark; all four biomes readable; no copyrighted characters; dark areas below 15 percent; preserve an uncluttered title-safe area
Avoid: grim mood, night scene, muddy colors, photorealism, painterly blur, tiny noisy detail, heavy vignette, dramatic black shadows
```

## アトラス

ゲーム内アトラスは `ART_GUIDE.md` の色・寸法を固定し、`tools/generate_assets.py` で決定的に描画する。画像生成モデルの揺らぎを持ち込まず、ピクセル単位の当たり判定と8方向差分を一致させる。
