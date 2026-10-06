# 苔灯の境 / MOSSLIGHT 開発コンテキスト

完全新規の、2D見下ろしサバイバルクラフト。既存のサバイバルクラフトのフォルダ・コード・画像は一切読まない。

## 開発規則

- GitHub Pagesの静的配信。ビルド不要、素のHTML/CSS/JS、Canvas 2DとWebGL2照明。外部CDN、サーバー依存なし。
- UI、コメント、ドキュメントは基本日本語。common-style.cssを../../css/common-style.cssから読み、ゲーム専用CSSで必要な見た目を上書き。
- 共通CSSのbodyはmargin:0、background:#f5f5f5、font-family:sans-serif。htmlのfont-size:16px。ゲームでは独自の暗い配色・画面レイアウトを定義。
- Claudeは指示されたファイルのみ変更する。DESIGN.mdとアセットはCodex管理。コマンド実行、外部通信、追加エージェント起動、他ゲーム参照は禁止。
- 設計Opus、実装Sonnet、アセット/統合/検証Codex。各工程の時間と使用量は.localに記録。残量20%以下で大作業を移し、5%以下は待機候補。欠損を0%と見なさない。
- 生成コードはブラウザで検証し、独立レビューの指摘を修正してから公開する。

## 体験と絵作り

森の小さな野営地から始め、採集・採掘・建築・栽培・料理で生活を整え、苔の洞窟と古い遺跡を探索して3つの灯を復元する。探索と拠点作りが互いに役立つ設計。終盤後も生活・建築を続けられる。

自然な彩度の苔緑・青緑・黄土、細かいピクセルの樹冠、奥行きのある根や岩、葉の陰影、暖かなランタン、冷たい水辺、発光する地下植物。ピクセル単位の質感を保つ整数倍率。大きい単色四角と単純な円だけで構成しない。ゲーム画面が主役の、余白と一貫性のあるHUD。

PixelWorkbenchでCodexが全アセットを制作する。tiles（32x32）、props（96x96、pivot48,80）、actors（32x48、pivot16,40）、icons（24x24）。PNGアトラスとJSONメタデータはassets/manifest.jsonから参照。スプライトはnameで取得し、pivotをゲーム座標に合わせて描画。実装担当は画像を生成せず、契約にあるnameのみ使用。

## 参考と判断

Core Keeperの探索・拠点・照明のまとまり、Romesteadの集落づくりと道具の自動選択を参考にする。意匠・キャラクター・ゲーム固有画像を複製しない。

レビューでは、進行の不明瞭さ・段階の噛み合わなさ・NPCの事故による進行不能・反復作業の重さが不満として挙がる。明確な目標、資源の再生、回収可能な死、理解できる制作条件、短い移動、見える成長を優先する。

参考URL:
- https://steamcommunity.com/app/1805320/reviews/?browsefilter=toprated
- https://store.steampowered.com/app/1621690/Core_Keeper/
- https://www.pcgamer.com/games/survival-crafting/core-keeper-review/
