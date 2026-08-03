# ANCHOR//VECTOR — 星環の残響

スマートフォン向けの一筆経路型3Dアクション・ローグライト。GitHub Pagesだけで完結し、サーバー、ログイン、外部API、ビルド工程を使用しない。

## 遊び方

- 画面を押し続けると時間が遅くなる。
- 指を青いアンカーノードや敵へ動かして経路を作り、離すと高速実行する。
- 危険予告から離れ、閉じた経路で敵を囲むとVECTOR SEAL。
- FLOW 100で右下のOVERTRACEを使うと直前の経路を逆走する。
- 二本指ドラッグ（PCは右ドラッグ）のカメラ回転は任意で、攻略には不要。

進行はlocalStorageへ自動保存される。設定の「セーブ管理」からJSON書き出し、貼付/ファイル読込、全消去が可能。

## 構成

- `SPEC.md` — ゲーム内容と開発方針の基準
- `ART_GUIDE.md` — 3D、画像、UI、VFX、音響の基準
- `ASSET_MANIFEST.md` — 最終素材台帳
- `ROADMAP.md` — 完了状態と検証記録
- `QA_CHECKLIST.md` — リリースゲートと解消済み不具合

Three.jsのES Modulesを使用するため、ローカル確認時はリポジトリルートを静的HTTPサーバーで配信する。公開URLは `https://rirtir.com/Game/AnchorVector/`。

`?test=1` を付けるとブラウザ内自動テスト結果を `window.__ANCHOR_VECTOR_TESTS__` に出力する。`?debug=1` は開発監査用で、アプリを `window.__anchorVectorApp` に公開する。
