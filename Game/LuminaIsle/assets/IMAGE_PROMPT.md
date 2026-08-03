# 画像生成記録

## キービジュアル実行方式

- 方式: built-in imagegen（通常生成、プロジェクト用）
- 分類: `stylized-concept`
- 参照画像: なし（P9地表は後段記載の世界オブジェクト画像を参照）
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

P7ではモデル出力を低解像度アトラスへ描き直していたが、視認性を損ねたためP8でこの方式を撤回した。P8は下記の生成結果を直接透過処理し、CanvasとUIへ表示する。

## P8 ゲーム内高精細アセット

### 実行方式と加工

- 方式: OpenAI built-in imagegen（通常生成）
- 用途分類: `stylized-concept`
- 主人公のみ参照画像あり: 直前に生成したヒナのデザイン画像を人物・衣装・画風の参照に使用
- その他の5シート: 新規生成。直前の画風を文章で固定し、画像参照なし
- 原本: `*-v3-source.png`
- ゲーム読込用: `*-v3.png`
- 透過処理: `remove_chroma_key.py --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill`
- 評価: 透過版を実ブラウザのCanvas、ホットバー、建築一覧、配置HUD、手帳、チュートリアルへ表示して目視確認

以下は生成サービスが返した最終プロンプトを改変せず記録したもの。

### 主人公 4×4

- 原本: `assets/hero-sheet-v3-source.png`
- 透過版: `assets/hero-sheet-v3.png`

```text
Use case: stylized-concept
Asset type: production player sprite sheet for a bright top-down survival crafting game
Primary request: Create a polished 4 by 4 sprite sheet of the exact same heroine Hina from the reference image. Preserve her identity exactly: fluffy chestnut bob and cowlick, gold star hair clip, warm brown skin, large dark eyes, sunflower-yellow scarf with trailing ends, teal overalls over ivory sleeves, cream cross-body satchel, coral boots.
Input image: reference image — identity, costume, palette, pixel-art rendering style, and proportions must match.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background; no floor, no shadows, no gradient, no texture.
Style/medium: crisp high-detail 2D pixel art matching the reference, modern 16-bit-inspired game sprite, hard square pixels, no antialiasing, no blur.
Composition/framing: exact 4 columns by 4 rows, evenly spaced equal cells, one full-body sprite centered in every cell, identical scale and baseline, generous padding, no overlap. Row 1: front idle, front walk, back idle, back walk. Row 2: left idle, left walk, right idle, right walk. Row 3: front-left idle, front-left walk, front-right idle, front-right walk. Row 4: back-left idle, back-left walk, back-right idle, back-right walk.
Lighting/mood: bright clear daylight, energetic and friendly.
Constraints: exactly 16 sprites; Hina only; all sprites fully visible; same character scale; readable face in front and diagonal views; scarf direction follows facing; no labels; no text; no grid lines; no frames; no weapons; no watermark. The #ff00ff background must be perfectly uniform and must not occur anywhere in Hina.
Avoid: low-resolution abstract blobs, vague silhouettes, tiny 16px icons, inconsistent costumes, extra characters, smooth vector art, cream background, cast shadow.
```

### 道具・素材 6×4

- 原本: `assets/items-tools-v3-source.png`
- 透過版: `assets/items-tools-v3.png`

```text
Use case: stylized-concept
Asset type: production inventory and hotbar item icon sprite sheet for a bright top-down survival crafting game
Primary request: Create exactly 24 large, instantly recognizable pixel-art item icons in an exact 6-column by 4-row grid. Match the crisp, polished, high-detail pixel-art style and warm bright palette of the reference sprite sheet, but include no character.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, no texture, shadow, frame, cell divider, or gradient.
Composition/framing: equal grid cells, one object centered per cell, same visual scale, generous separation, nothing crosses a cell boundary.
Exact order, left to right:
Row 1: stone axe; copper axe; stone pickaxe; copper pickaxe; wooden spear; crystal-tipped light spear.
Row 2: fishing rod with line and hook; round watering can with spout; wooden building mallet; ornate sun axe; ornate sun pickaxe; ornate sun spear.
Row 3: star-themed fishing rod; rainbow watering can; forked tree branch; cut wood log; gray field stone; bundle of green plant fiber.
Row 4: red-gold berry; raw copper ore; refined copper ingot; luminous blue crystal; clear water flask; woven rope coil.
Style/medium: high-detail 2D pixel art, clean dark-navy outline, hard square pixels, readable at 48px, no antialiasing or blur.
Lighting/mood: bright neutral inventory lighting, cheerful and practical.
Constraints: exactly 24 icons; especially make axe, pickaxe, spear, rod, watering can, and mallet unmistakable from silhouette alone; show full objects; no hands; no people; no text; no labels; no numbers; no watermark. The #ff00ff background must be uniform and absent from all objects.
Avoid: tiny low-resolution symbols, ambiguous crossed sticks, identical tool silhouettes, emoji styling, UI frames, photorealism, smooth vector art.
```

### 食料・作物・魚 6×4

- 原本: `assets/items-food-v3-source.png`
- 透過版: `assets/items-food-v3.png`

```text
Use case: stylized-concept
Asset type: production food, crop, and fish icon sprite sheet for a bright top-down survival crafting game
Primary request: Create exactly 24 polished, highly readable pixel-art item icons in an exact 6-column by 4-row grid, matching the reference sheet's scale, outline, lighting, and detail.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, no texture, shadow, frame, divider, or gradient.
Composition/framing: equal cells, one centered object per cell, consistent visual scale, generous separation.
Exact order, left to right:
Row 1: small golden seed pouch; orange sunroot vegetable with leafy top; purple moonbean seed pouch; cluster of purple moonbeans; aqua tide-melon seed pouch; sliced aqua-striped tide melon.
Row 2: roasted berries on a skewer; grilled fish on a plate; steaming orange vegetable soup; sparkling fish-and-vegetable skewer; explorer sandwich; warm purple moonbean tea cup.
Row 3: colorful island salad; rich three-color prism stew; plain silver-blue fish; golden sun fish; indigo crescent-marked moon fish; blue raindrop fish.
Row 4: sturdy gray rock fish; luminous cyan glow fish; green leaf-shaped fish; coral-orange reef fish; navy star-marked fish; rainbow prism fish.
Style/medium: high-detail 2D pixel art, crisp dark-navy outlines, hard square pixels, bright appetizing colors, readable at 48px, no antialiasing or blur.
Constraints: exactly 24 icons; every fish must have a clearly different silhouette, color, and marking; all objects fully visible; no people; no text; no labels; no numbers; no watermark; the #ff00ff background must be perfectly uniform and absent from objects.
Avoid: emoji styling, low-resolution blobs, repeated fish recolors with identical markings, UI frames, photorealism, smooth vector art.
```

### 資源・敵・作物 6×4

- 原本: `assets/world-objects-v3-source.png`
- 透過版: `assets/world-objects-v3.png`

```text
Use case: stylized-concept
Asset type: production world-object and creature sprite sheet for a bright top-down survival crafting game
Primary request: Create exactly 24 polished top-down/three-quarter pixel-art world sprites in an exact 6-column by 4-row grid, matching the reference icon sheet's crisp pixels, navy outlines, bright palette, and readable detail.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, no ground plane, no cast shadows, no texture, no dividers, no frames.
Composition/framing: equal cells, one centered sprite per cell, consistent world-game perspective, generous separation.
Exact order, left to right:
Row 1: lush round island tree; fallen forked branch; large gray mining rock; tuft of harvestable green fiber grass; berry bush with red-gold fruit; white spiral seashell.
Row 2: copper ore deposit; luminous blue crystal cluster; amber resin lump; tide-green herb sprig; circular fishing ripple with tiny fish shadow; dark tilled crop plot.
Row 3: cute green sprout slime; orange thorn-fruit creature; friendly aqua shore crab; chunky gray rockling creature; large ancient forest guardian with leaf antlers; large stone guardian with crystal horns.
Row 4: chopped tree stump; young leafy sapling; mature orange sunroot plant; mature purple moonbean plant; mature aqua tide-melon vine; floating diamond-shaped island memory relic.
Style/medium: high-detail 2D pixel art, modern 16-bit-inspired, hard square pixels, no antialiasing or blur, top-down three-quarter perspective, readable at 56–80px.
Lighting/mood: bright daylight, inviting; creatures look lively rather than frightening.
Constraints: exactly 24 sprites; each resource and creature unmistakable by silhouette; all fully visible; no text; no labels; no people; no weapons; no watermark; #ff00ff background perfectly uniform and absent from sprites.
Avoid: tiny abstract icons, low-resolution blobs, emoji style, realistic horror, UI cards, smooth vector art.
```

### 建築・ランドマーク 6×5

- 原本: `assets/buildings-v3-source.png`
- 透過版: `assets/buildings-v3.png`

```text
Use case: stylized-concept
Asset type: production building sprite sheet for a bright top-down survival crafting game
Primary request: Create exactly 30 polished top-down/three-quarter pixel-art building and landmark sprites in an exact 6-column by 5-row grid, matching the reference sheet's crisp pixels, navy outlines, bright palette, and readable material detail.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background; no ground plane, cast shadows, texture, frame, or dividers.
Composition/framing: equal cells, one centered complete structure per cell, consistent three-quarter game perspective, generous separation.
Exact order, left to right:
Row 1: stone-ring campfire; sturdy wooden workbench; stone-and-copper furnace; brass-trimmed wooden storage chest; cozy ivory-and-teal bed; stone well with hand pump.
Row 2: sunflower lantern; square tilled crop plot; wooden fence segment; wooden garden gate; small plank bridge; coral wind flag.
Row 3: wooden bench; glowing flowerpot; golden sun banner; shell wind chime; crystal prism arch; rain-collecting barrel.
Row 4: copper garden sprinkler; glass-and-wood greenhouse; wooden request notice board; luminous crystal waystone; medal trophy plinth; large flower-shaped sundial.
Row 5: magical three-color beacon garden; square wood floor tile; square stone floor tile; tall repaired coastal lighthouse; friendly wooden tutorial sign; small stone windmill monument.
Style/medium: high-detail 2D pixel art, modern 16-bit-inspired, hard square pixels, dark-navy outline, top-down three-quarter perspective, readable at 64–112px, no antialiasing or blur.
Lighting/mood: bright neutral daylight, handcrafted, inviting, visually distinct materials.
Constraints: exactly 30 sprites; every structure fully visible; silhouettes clearly different; no people; no text on signs or boards; no labels; no numbers; no watermark; #ff00ff background perfectly uniform and absent from sprites.
Avoid: tiny abstract icons, generic rectangles, emoji styling, photorealism, UI cards, smooth vector art, duplicated structures.
```

### UIアイコン 4×4

- 原本: `assets/ui-icons-v3-source.png`
- 透過版: `assets/ui-icons-v3.png`

```text
Use case: stylized-concept
Asset type: production UI icon sprite sheet for a bright top-down survival crafting game
Primary request: Create exactly 16 clear semantic pixel-art UI icons in an exact 4-column by 4-row grid, matching the reference sheet's crisp outline, bright palette, and high readability.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, no cards, frames, shadows, dividers, text, or gradient.
Composition/framing: equal square cells, one centered symbol per cell, uniform visual weight and generous padding.
Exact order:
Row 1: red anatomical heart for health; full meal bowl with bread for hunger; blue water droplet for hydration; yellow running boot with small motion marks for stamina.
Row 2: cream explorer backpack for inventory; wooden workbench with small hammer for crafting; small complete wooden house with roof for building; open illustrated field journal for journal.
Row 3: tutorial sign with a clear question mark shape made from wood (symbol only, no other text); pause symbol made from two carved wooden bars; open hand reaching toward a sparkle for interact/use; coral boots with wind trail for dodge.
Row 4: circular rotation arrow around a small chair; placement grid with a downward marker; dismantle tool removing one plank; map pin over a tiny island.
Style/medium: polished high-detail 2D pixel art, hard square pixels, dark-navy outline, readable at 28–40px, no antialiasing or blur.
Constraints: exactly 16 icons; meanings must be obvious without labels; full symbols visible; no emoji; no people; no extra text other than the single question-mark symbol; no letters; no numbers; no watermark; #ff00ff background perfectly uniform and absent from icons.
Avoid: abstract circles, diamonds, suits, generic runes, ambiguous crossed tools, thin line-only icons, smooth vector art, UI button backgrounds.
```

## P9 地表テクスチャ生成

- 方式: OpenAI built-in imagegen、通常生成（generate）
- 分類: `stylized-concept`
- スタイル参照: `assets/world-objects-v3.png`
- 生成原本: `assets/terrain-v4/*-source.png`
- 実行時版: `assets/terrain-v4/{meadow,sand,forest,rock,water}.png`
- 後処理: `tools/process_terrain.py` でNEAREST 512×512、192色、ディザなしへ最適化。生成原本は変更せず保存。

### 草原

```text
Create one seamless tileable top-down meadow ground texture for a bright, friendly survival-crafting game. Match the attached reference sheet's polished high-resolution pixel-art style: crisp hand-placed pixel clusters, warm outlines where appropriate, readable color grouping, cheerful high-key lighting, and moderately rich detail. Camera is perfectly orthographic top-down. Fill the entire square edge-to-edge with continuous short spring-green grass, subtle mint and yellow-green blade clusters, tiny neutral soil flecks, and very sparse miniature cream flower pixels. This is terrain only: no standalone plants, bushes, trees, stones, items, characters, paths, shadows, border, frame, grid, labels, text, UI, or empty transparent areas. Keep contrast gentle so foreground characters remain legible. All four edges must tile seamlessly with no visible seam. Pixel art, no blur, no anti-aliased painted look.
```

### 砂浜

```text
Create one seamless tileable top-down warm beach-sand ground texture for a bright, friendly survival-crafting game. Match the attached reference sheet's polished high-resolution pixel-art style: crisp hand-placed pixel clusters, warm cheerful palette, readable color grouping, high-key daylight, moderately rich but quiet terrain detail. Camera is perfectly orthographic top-down. Fill the entire square edge-to-edge with continuous pale honey-cream sand, fine ochre pixel stippling, subtle shallow wind ripples, and a few tiny coral-pink mineral flecks integrated into the ground. Terrain only: absolutely no shells, stones, plants, water, footprints, items, characters, shadows, border, frame, grid, labels, text, UI, or transparent areas. Keep contrast gentle so foreground objects remain legible. All four edges must tile seamlessly with no visible seam. Pixel art, no blur, no painted gradients.
```

### 林床

```text
Create one seamless tileable top-down sunlit forest-floor ground texture for a bright, friendly survival-crafting game. Match the attached reference sheet's polished high-resolution pixel-art style: crisp hand-placed pixel clusters, warm outlines, readable color grouping, high-key lighting, moderately rich detail. Camera is perfectly orthographic top-down. Fill the entire square edge-to-edge with continuous soft moss-green earth, muted teal grass fragments, warm brown leaf-litter pixels, a few tiny golden leaf flecks, and subtle exposed soil patches blended into the ground. Terrain only: no standalone plants, ferns, mushrooms, bushes, trees, rocks, roots, items, characters, cast shadows, border, frame, grid, labels, text, UI, or transparent areas. Keep contrast gentle and values slightly deeper than meadow grass so foreground objects remain clear. All four edges must tile seamlessly with no visible seam. Pixel art, no blur, no painterly gradients.
```

### 岩丘

```text
Create one seamless tileable top-down pale stone-plateau ground texture for a bright, friendly survival-crafting game. Match the attached reference sheet's polished high-resolution pixel-art style: crisp hand-placed pixel clusters, warm cheerful palette, readable shapes, high-key daylight, moderately rich but quiet detail. Camera is perfectly orthographic top-down. Fill the entire square edge-to-edge with continuous light blue-gray and warm ivory worn stone, small irregular interlocking mineral patches, extremely shallow hairline seams, and sparse muted lavender mineral flecks embedded in the surface. It must read as walkable natural stone ground, not separate rocks. Terrain only: no boulders, loose stones, crystals, grass, plants, cliffs, holes, items, characters, cast shadows, border, frame, grid, labels, text, UI, or transparent areas. Keep contrast gentle so foreground enemies and resources remain legible. All four edges must tile seamlessly with no visible seam. Pixel art, no blur, no realistic photo texture, no painted gradients.
```

### 水面

```text
Create one seamless tileable perfectly top-down shallow tropical seawater texture for a bright, friendly survival-crafting game. Match the attached reference sheet's polished high-resolution pixel-art style: crisp hand-placed pixel clusters, high-key luminous palette, readable color grouping, moderately rich but calm detail. Fill the entire square edge-to-edge with continuous turquoise and aqua water, small soft horizontal wavelet clusters, occasional pale cyan glints, and subtly darker teal depth patches. Terrain only: no shore, sand, foam border, fish, coral, shells, rocks, plants, boats, items, characters, cast shadows, border, frame, grid, labels, text, UI, or transparent areas. Keep contrast gentle so shoreline objects remain legible. All four edges must tile seamlessly with no visible seam. Pixel art, no blur, no realistic photo water, no large waves, no painted gradients.
```

## P9 シート分離（生成ではなく機械処理）

`tools/split_generated_assets.py` はP8透過シート6枚からアルファ連結成分を検出し、重心が属する意図セルへ割り当てる。出力時は割当外ラベルを透明化して隣セル混入を除き、5pxの余白を加える。主人公16枚だけは最大幅・高さの共通キャンバスへ足元中央揃えする。出力は `assets/generated-v4/` の134枚、パス台帳は `assets/generated-v4.js` / `.json`。
