# 残り火の深庭 — EMBERVEIL

独立した新作の見下ろし型ドット絵サバイバルクラフト。既存の陽だまりクラフトのコード・アセット・セーブは使用していません。

苔庭、結晶洞、灼熱遺跡を探検し、採掘・採集・建築・農業・釣り・料理で装備と拠点を整え、三体の守護者を攻略して炉心を再生します。クリア後も自由に建築と探索を続けられます。ワールドは128×128タイル、同じシードから同じ地形が生成されます。

HTML/CSS/ES modulesのみ。ビルド工程、サーバー側の処理、外部CDN、外部フォント、課金機能はありません。静的HTTPサーバーで配信してください。モジュールとアセットを読み込むため、`file://`での直接起動は対象外です。

## ドット絵

「ドット風」の画像は採用していません。原画は整数座標、固定40色、透明度0/255だけで直接描画したnative-resolutionのPNGです。写真や生成AI画像の縮小、補間、アンチエイリアスを使っていません。キャラクターと敵には0x72が制作した本来のドット絵を採用しています。

Canvas内は原画のドットを保ち、画面への拡大は整数倍率、`imageSmoothingEnabled=false`、`image-rendering:pixelated`で表示します。地形、戦闘予告、環境粒子、戦闘数字も同じピクセル格子上に描きます。照明のマスクはnative-resolutionのImageDataから生成します。日本語のメニューとHUDには読みやすいシステム字体を使用します。

- 原画生成: `dev/make_pixel_art.py`
- 原画とパレット: `assets/pixel-atlas.png`, `assets/pixel-atlas.json`
- 出典とライセンス: [assets/CREDITS.md](assets/CREDITS.md)
- 設計: [DESIGN.md](DESIGN.md)
- 担当間の契約: [CONTEXT.md](CONTEXT.md), [API.md](API.md)

## 保存

3スロット、自動保存、JSONの書き出し・読み込み、バックアップ、同時タブの操作権管理に対応。ブラウザのローカル保存を使用します。ブラウザデータを消す前にJSONを書き出してください。保存を拒否する環境でもプレイできますが、タブを閉じる前にJSONを保存してください。

## 協力開発

Claude Codeの認証済みCLIを使用。Opusが設計、Sonnetがデータ・シミュレーション・UIを実装、Codexがオリジナルのドット絵・照明・描画・合成音楽・統合・検証を担当しました。同じファイルを同時編集しないよう担当を分離しています。

呼び出しごとの開始・終了・実モデル名・取得できた使用量は `dev/*-usage.json` に記録しています。Codexの実測トークン数はこの環境で取得できないため未取得です。CLIのコスト表示はモデルのリスト価格換算であり、Teamの請求額を表すものではありません。単独開発との速度・精度・総使用量の比較測定は行っていません。

Sonnetの主要実装後、Claude Teamのセッション上限でCLI呼び出しが終了したため、残りの統合と修正はCodexが引き継ぎました。終了状態は使用量ログにそのまま残しています。完成後に3担当による独立レビューを行い、保存・進行・UI・描画の具体的指摘を修正し、それぞれ再レビューしました。記録は [dev/review-log.md](dev/review-log.md) にあります。

## 検証

`tests/art_check.py` は原画のパレットとアルファを検証します。`tests/render_probe.py` はChromeで素材読み込み・整数拡大・座標変換・実描画を確認します。`tests/generation_probe.py` は複数シードの再現性・資源保証・必須経路と定義データを検証します。ブラウザの検証にはPython PlaywrightとGoogle Chromeを使用します。

全検証: `python tests/run_checks.py`（Pillow / Playwright、Google Chromeが必要）。個別に `game_probe.py`、`storage_probe.py`、`progression_probe.py`、`smoke.py`、`review_*_probe.py` を実行できます。検証結果と実測時間は `dev/validation.json`。戦闘の段階遷移は実エンジンで進め、討伐判定を検証する箇所では固定ダメージを使います。手動の通し攻略時間の測定ではありません。

CC0フレームの梱包は `dev/pack_dungeon.py`。370枚の原PNGとアトラスのRGBA完全一致も検証します。ゲーム実行時は梱包したアトラスを読み込むため、大量の画像リクエストを発生させません。

push後の公開確認は `python tests/public_probe.py`。公開ファイルのSHA-256一致、実画面の開始・移動・メニュー・永続保存・再読み込みとポータルへの登録を確認し、ローカルの `dev/public-validation.json` に記録します。

保存データや認証情報はリポジトリに含めません。
