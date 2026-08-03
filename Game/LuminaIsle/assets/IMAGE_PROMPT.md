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

## P7主人公デザインシート

- 方式: built-in imagegen（通常生成、プロジェクト用）
- 分類: `stylized-concept`
- 参照画像: なし
- 生成原本: `assets/character-concept-v2.png`
- ゲーム読込用: `assets/character-concept-v2.webp`

```text
Use case: stylized-concept
Asset type: production character design sheet and pixel-art reference for a bright top-down survival crafting game
Primary request: Redesign the single playable protagonist so they are instantly recognizable, appealing, adventurous, and exciting to control. Create one consistent young island explorer named Hina, shown as a polished large pixel-art character design plus a clear 8-direction miniature sprite reference and four expressive portrait poses.
Scene/backdrop: clean warm cream character-sheet background with simple mint and sunny-yellow framing shapes; no environment scene
Subject: Hina, a cheerful island craftsperson with warm brown skin, large readable dark eyes, a fluffy chestnut bob with one upward cowlick, a short sunflower-yellow neck scarf with two distinct trailing ends, teal utility overalls over an ivory shirt, coral-orange ankle boots, a small cream cross-body tool satchel, and a star-shaped brass hair clip. The silhouette must read at tiny size: rounded hair mass, bright triangular scarf, teal body block, coral boots. Practical and charming, not generic.
Style/medium: high-quality hand-authored 2D pixel art, crisp square pixels, 16-bit-inspired modern indie game aesthetic, no blur, no antialiasing, consistent proportions and palette
Composition/framing: one large full-body three-quarter view on the left; on the right, an orderly 8-direction miniature turnaround row and four small bust expressions: happy, focused, surprised, determined. Keep every depiction of Hina consistent.
Lighting/mood: bright daytime, optimistic, energetic, welcoming
Color palette: sunflower #FFD166, teal #2CB9A8, coral #F06B5A, ivory #FFF2D0, chestnut #7A4934, navy outline #26334A; high value contrast
Constraints: exactly one character design repeated as reference views; no weapons; no text or labels; no watermark; hands and face readable; all sprite views fully visible with generous padding
Avoid: dark grim palette, vague human silhouette, photorealism, anime line art, smooth vector art, muddy shading, oversized armor, extra characters, illegible micro-detail
```

モデル出力をそのまま当たり判定用スプライトには使わず、髪・星形ピン・スカーフ・服・靴の識別子を `tools/generate_assets.py` へ移植した。これにより5衣装×8方向×4フレームを再生成可能に保つ。
