# 星の芽の庭 / STARSPROUT GARDEN

夜の温室で星の植物を育てる、ブラウザで遊べる放置・育成ゲーム。

`index.html` をブラウザで開くと遊べます。HTML / CSS / JavaScript と同梱SVGだけで動作し、ビルドや外部サービスへの接続は不要です。

## 遊び方

しずくを集めて、じょうろ・月光ランプ・星砂の鉢を強化します。累積獲得量に応じて、種が芽、若葉、つぼみ、星の花へ成長します。咲いた花から星を収穫すると、次の育成に永久ボーナスが付きます。

進行はブラウザの localStorage に保存します。オフライン育成は最大8時間、通常の50%の効率です。ブラウザや端末を変えると保存データは共有されません。

## 協力開発の記録

ユーザーの指定で、Codex がローカルの Claude Code CLI を呼び出して分担しました。VS Code の隣の Claude タブの会話を操作・共有する方式ではなく、Team アカウントの認証を使う別の CLI セッションです。

| 担当 | 成果物 |
| --- | --- |
| Claude Opus (`claude-opus-5-5`) | `DESIGN.md` の設計 |
| Claude Sonnet (`claude-sonnet-5-5`) | `index.html` / `style.css` / `game.js` の初期実装 |
| Codex | 植物5段階と温室のSVG、一覧登録、動作確認と必要な修正 |

Opus の設計中に Codex がアセットを作成し、その後 Sonnet に設計書とアセットの仕様を渡しました。Sonnet のファイル操作範囲はこのゲームのフォルダに限定し、コマンド実行・外部連携ツールは渡していません。

ゲームを起動しても Claude や Codex は呼び出されません。

## 検証

Codex が Chrome で、クリック収集・設備購入・5段階の成長・収穫と永久ボーナス・保存復元・8時間のオフライン上限・時刻の巻き戻し・壊れた保存データの退避・初期化の確認・保存不可の環境・複数タブの切り替えを確認しています。PCとスマホの表示、動き控えめの設定も確認し、JavaScriptのエラーや外部通信は発生しませんでした。

`tests/smoke.py` でブラウザ検証を再実行できます。Python の Playwright パッケージと Google Chrome が必要です。

```powershell
python Game/StarSproutGarden/tests/smoke.py
```

`CODING-NOTES.md` は Sonnet が実装終了時に書いた記録です。「未実行」の記載は、その後の Codex による検証より前の状態を指します。
