# 陽だまりクラフト — P8アセット台帳

状態記号: `[x] 完了 / [ ] 未完了 / [-] 保守用・実行時未使用`

## 1. 生成画像

- [x] `assets/key-art-source.png` — タイトル用imagegen原本、1536×1024、文字なし
- [x] `assets/title-art.webp` — タイトル表示用
- [x] `assets/og-image.jpg` — 1200×630共有用
- [x] `assets/character-concept-v2.png` / `.webp` — ヒナのデザイン基準
- [x] `assets/hero-sheet-v3-source.png` — 主人公4×4原本
- [x] `assets/hero-sheet-v3.png` — 透過処理済みゲーム読込用
- [x] `assets/items-tools-v3-source.png` / `items-tools-v3.png` — 道具・素材6×4
- [x] `assets/items-food-v3-source.png` / `items-food-v3.png` — 食料・作物・魚6×4
- [x] `assets/world-objects-v3-source.png` / `world-objects-v3.png` — 資源・敵・作物6×4
- [x] `assets/buildings-v3-source.png` / `buildings-v3.png` — 建築・ランドマーク6×5
- [x] `assets/ui-icons-v3-source.png` / `ui-icons-v3.png` — UIアイコン4×4
- [x] 全読込用PNGへクロマキー除去、ソフトマット、デスピル処理
- [x] 文字、透かし、第三者ロゴ、セル越境、欠落を目視監査

`*-source.png` は生成原本、末尾が `-v3.png` の同名ファイルは実行時の透過版。全シートの正確なセル順と最終プロンプトは `assets/IMAGE_PROMPT.md` に記録する。

## 2. ゲーム内適用

- [x] 主人公: 正面、背面、左右、4斜め方向、待機・歩行
- [x] 道具: 石/銅/最高級の斧・つるはし・槍、竿、じょうろ、木槌
- [x] 素材: 枝、木、石、繊維、ベリー、鉱石、銅、光晶、水、ロープ
- [x] 食料・作物: 種、3作物、料理8種
- [x] 魚: 通常と希少を含む10種
- [x] 世界: 木、枝、岩、草、ベリー、貝、鉱床、光晶、樹脂、薬草、釣り波紋
- [x] 敵: 通常4種、番人2種
- [x] 建築: 27種と灯台、案内板、風車石
- [x] UI: 生存値4、基本メニュー4、案内、休憩、行動、回避、回転、配置、解体、位置

## 3. 保守用アトラスとコード描画

- [x] `assets/sprites.png` / `.json` / `.js` — 地形、海岸線、補助物、旧セーブ互換用
- [x] `tools/generate_assets.py` — 上記決定的アトラスの生成元
- [x] Canvasコード演出 — 海、雨、影、危険予告、粒子、照明、配置枠
- [-] `assets/ui-icons.svg` — P7履歴用ソース。P8では読込も表示もしない

主要キャラクター、道具、資源、敵、建築、手帳アイコンは旧16pxスプライトへフォールバックさせず、生成PNGの対応セルを使用する。地形タイルは低密度の背景として残し、操作対象より主張しない。

## 4. UIでの現物表示

- [x] ホットバーとバッグ
- [x] クラフト素材・生成物
- [x] 建築一覧、配置HUD、フィールド、解体確認
- [x] 手帳の依頼、熟練、収集、魚図鑑
- [x] 生存HUD、下部メニュー、操作ガイド
- [x] SVGや絵文字に依存しないラスタ表示

## 5. 音響

- [x] `assets/audio/bgm/meadow-day.ogg` — 昼
- [x] `assets/audio/bgm/lantern-dusk.ogg` — 夕夜
- [x] `assets/audio/bgm/guardian.ogg` — 番人
- [x] `assets/audio/bgm/homecoming.ogg` — 灯台完成
- [x] UI、採集、伐採、採掘、制作、建築、釣り、攻撃、被弾、回避、料理、発見、就寝の効果音15種
- [x] `tools/generate_audio.py` に本作専用の生成元

## 6. 生成方式と権利

- [x] P8画像はOpenAI built-in imagegenの通常生成
- [x] `assets/IMAGE_PROMPT.md` に実行方式、参照有無、最終プロンプト、セル順を記録
- [x] 外部由来素材、第三者ロゴ、外部フォント、実行時素材通信なし
- [x] 生成原本と加工版をリポジトリ内へ同梱

必須未完了: なし。
