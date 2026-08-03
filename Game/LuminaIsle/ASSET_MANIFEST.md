# 陽だまりクラフト — アセット台帳

状態記号: `[x] 完了 / [ ] 未完了 / [-] 設計上不要`

## 1. 生成画像

- [x] `assets/key-art-source.png` — built-in imagegen原本、1536×1024、文字なし
- [x] `assets/title-art.webp` — タイトル背景用最適化版、267KB
- [x] `assets/og-image.jpg` — 1200×630共有用、334KB
- [x] `assets/character-concept-v2.png` — 主人公ヒナ再設計のimagegen原本、1536×1024
- [x] `assets/character-concept-v2.webp` — 初回案内用最適化版、80KB
- [x] `assets/sprites.png` — タイル、主人公、敵、資源、設備、アイテムのピクセルアトラス、22KB
- [x] `assets/sprites.json` — 273スプライトの座標とピボット
- [x] `assets/sprites.js` — `file://` 直接起動用の同一アトラス定義
- [x] `assets/ui-icons.svg` — UI操作アイコンスプライト
- [x] 文字、透かし、第三者ロゴ、暗部、不要UIの目視監査

## 2. タイル/環境

- [x] 草、花、林床、砂、浅瀬、海、岩、畑、木/石床、道
- [x] 海岸線、崖、地域境界、波、雨、水面反射（アトラス＋コード演出）
- [x] 木、岩、草、ベリー、貝、鉱床、光晶、釣り波紋
- [x] 灯台5段階、祭壇3種、井戸、風車石（固有形＋コード描画）

## 3. キャラクター/敵

- [x] 主人公ヒナ5衣装×8方向×4歩行フレーム＝160枚、顔・髪・星飾り・黄スカーフ・肩掛け鞄を小サイズでも識別
- [x] 道具・攻撃・回避は衣装と独立したコード演出で全衣装に対応
- [x] 芽スライム、トゲウリ、泡ガニ、石ころ獣
- [x] 森の番人、岩丘の番人
- [x] 影、危険予告、弱点、状態記号

## 4. アイテム/設備/UI

- [x] 全資源、料理、道具、プリズム、種、魚10種の16pxアイコン
- [x] 建築27種。主要設備はアトラス、連結物・農業設備・記念建築は統一パレットのコード描画
- [x] バッグ、クラフト、建築、地図、手帳、設定、保存、音、戻る、閉じる
- [x] 体力、満腹、潤い、スタミナ、時刻、天候、目的、制作可否

## 5. 音響

- [x] `assets/audio/bgm/meadow-day.ogg` — 27.69秒
- [x] `assets/audio/bgm/lantern-dusk.ogg` — 28.57秒
- [x] `assets/audio/bgm/guardian.ogg` — 23.61秒
- [x] `assets/audio/bgm/homecoming.ogg` — 21.82秒
- [x] UI、採集、伐採、採掘、制作、建築、釣り、攻撃、被弾、回避、料理、発見、就寝の効果音15種
- [x] ループ端フェード、OGGデコード、長さ、ピーク、音量差を監査

## 6. 生成元と権利

- [x] `assets/IMAGE_PROMPT.md` にbuilt-in imagegenの最終プロンプトと出力情報
- [x] `tools/generate_assets.py` に手続きアトラス生成元
- [x] `tools/generate_audio.py` にオリジナル音源生成元
- [x] 外部由来素材なし、生成物と自作コードのみ（READMEへ最終記載）

必須未完了: なし。
