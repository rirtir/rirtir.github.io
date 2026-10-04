# Claude / Codex 協力開発の引き継ぎ

## ユーザーの希望と実証結果

ユーザーは Claude Team を利用しており、VS Code に Claude Code 拡張機能が入っています。新規ゲーム開発では、Opus に設計、Sonnet に実装、Codex にアセット作成・統合・検証を担当させる分担を希望しています。新しいユーザー指示を優先し、タスクの大きさに応じて必要な担当だけを使います。

2026-10-05 に、この分担で [星の芽の庭](../Game/StarSproutGarden/README.md) を制作・公開しました。Opus の設計中に Codex が植物5段階と温室のSVGを作成し、その後 Sonnet が HTML / CSS / JavaScript を実装しました。Codex がスマホで収集ボタンが固定メニューに重ならないように調整し、SVGの文字コードも修正しました。

- CLI は VS Code 拡張機能に同梱されていました。PATH 上の `claude` が見つからなくても利用できました。
- 実行時の CLI バージョンは `2.1.289`。認証状態は `loggedIn: true`、`authMethod: claude.ai`、`subscriptionType: team` でした。
- `opus` / `sonnet` エイリアスで指定し、応答の `modelUsage` に `claude-opus-5-5` / `claude-sonnet-5-5` が記録されました。これは今回の実行記録であり、次回のモデルを固定する指定ではありません。
- Chrome / Playwright で39項目に合格し、公開サイトでも操作・画像・ホームページのリンクを確認しました。
- 単独開発との比較実験はしていません。精度向上・高速化・Codex総トークン削減は未確認です。本文生成は Claude に移せましたが、Codex にも指示・レビュー・テストの消費があり、Claude 側の利用量も発生します。

## 1. CLI と認証を確認する

PowerShell で、まず PATH 上の CLI を探し、なければ拡張機能の同梱バイナリを探します。バージョン付きのパスを恒久的に固定しないでください。

```powershell
$claudeCommand = Get-Command claude -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
if ($claudeCommand) {
    $claudeExe = $claudeCommand.Source
} else {
    $extensionsDir = Join-Path $env:USERPROFILE '.vscode/extensions'
    $claudeExe = Get-ChildItem -LiteralPath $extensionsDir -Directory -Filter 'anthropic.claude-code-*-win32-x64' |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName 'resources/native-binary/claude.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
}
if (-not $claudeExe) { throw 'Claude Code CLI が見つかりません。' }
& $claudeExe --version
& $claudeExe --help
```

認証状態を読む場合は、必要な項目だけ表示します。認証ファイル、トークン、APIキーの内容をチャットやリポジトリへ書き出さないでください。

```powershell
$authText = & $claudeExe auth status --json
if ($LASTEXITCODE -ne 0) { throw 'Claude Code の認証確認に失敗しました。' }
$authState = ($authText -join [Environment]::NewLine) | ConvertFrom-Json
$authState | Select-Object loggedIn,authMethod,apiProvider,subscriptionType
```

Team ログイン済みの CLI を使う別セッションです。隣の Claude タブへの文字入力、会話履歴の共有、Codex 内蔵サブエージェントへの Claude モデル指定を行う方式ではありません。

今回はサンドボックス内の応答テストが長時間返らず、ネットワーク制限の外で同じテストを行うと成功しました。バイナリが起動することと推論の通信が通ることを区別してください。制限が原因なら実行環境の通常の承認手続きを使い、無制限の権限設定へ変更して解決しようとしないでください。既にあるユーザーの依頼・承認を確認し、同じ内容を再度確認する必要はありません。

## 2. 担当ごとの成果物と文脈を決める

| 担当 | 入力と成果物 |
| --- | --- |
| Opus | ユーザーの要望、リポジトリの制約、画面・操作・数式・保存・受け入れ条件を含む `DESIGN.md` |
| Sonnet | 設計書、共通CSSの情報、アセット仕様を受け取り、指定した実装ファイルだけを書き出す |
| Codex | アセット、仕様の整合、ブラウザ検証、必要な修正、一覧登録、依頼範囲内のコミット・公開 |

依存する作業は設計確定後に渡します。設計中には、寸法や名前を先に合意したアセット作成など独立した作業を進められます。本格開発で複数の実装担当を使う場合も、編集するファイルと受け渡すデータ形式を決めてください。同じファイルを並行して編集させないでください。

呼び出し側は `AGENTS.md`、`CLAUDE.md`、対象フォルダの追加指示を読み、必要な内容を渡します。今回の Sonnet は作業フォルダ外の `common-style.css` を読めませんでした。次回は Codex が必要部分を抜粋した `CONTEXT.md` などを作業フォルダに置き、継承・上書きするスタイルを明確にしてください。制限に合わせて文脈を渡せば、ルート全体への書き込み権限は不要です。

アセットは、用途に合わせてSVG・CSS・画像生成を選びます。今回の植物と温室は Codex が記述したSVGです。別の画像生成ツールが自動的に使われたと説明しないでください。

## 3. Claude を呼び出す

以下は `2.1.289` で使えたオプションです。次回も `--help` で確認し、取得した実際のモデル名を記録してください。今回使った `--bare` のヘルプには、OAuth / Team のログインを読まず APIキー等を使う旨がありました。Team 認証を使う今回の方式では `--safe-mode` を利用しました。

`--safe-mode` はカスタマイズや `CLAUDE.md` の自動読み込みを停止します。必要な指示は明示的に渡します。`--no-session-persistence` の実行は後からセッションを再開できないため、成果物や次の担当へ渡す情報はファイルとして残します。

### Opus：ツールなしで設計を返させる

要件を `$designPrompt` に用意してから実行します。PowerShell の空文字引数の扱いを避けるため、今回確認済みの「Read のみを列挙し、その Read も禁止する」指定を示しています。

```powershell
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$responseText = & $claudeExe --safe-mode --tools Read --disallowedTools Read --permission-mode dontAsk --no-session-persistence --model opus --effort medium --output-format json -p $designPrompt
$exitCode = $LASTEXITCODE
$watch.Stop()
if ($exitCode -ne 0) { throw 'Opus の設計依頼に失敗しました。' }
$response = ($responseText -join [Environment]::NewLine) | ConvertFrom-Json
if ($response.is_error -or -not $response.result) { throw '設計書が返りませんでした。' }
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'DESIGN.md'), $response.result, [System.Text.UTF8Encoding]::new($false))
# 所要時間: $watch.Elapsed / 使用量: $response.usage, $response.modelUsage
```

このコマンドの実行ディレクトリは対象ゲームのフォルダにします。設計時は具体的な価格・倍率・成長しきい値・保存構造・異常系を要求し、数値は Codex 側でも試算してください。

### Sonnet：フォルダ内の実装だけを許可する

`$codingPrompt` に設計書、対象ファイル、アセット仕様、参照文脈、完了条件を明示します。「ファイルを実際に書く」「設計書とアセットは変更しない」「コマンド実行・外部通信・他のエージェント起動を行わない」も渡します。今回の制限では検証は Codex が担当します。

```powershell
# 対象ゲームのフォルダで実行する
& $claudeExe --safe-mode --restricted --strict-mcp-config --tools 'Read,Glob,Grep,Edit,Write' --allowedTools 'Read,Glob,Grep,Edit,Write' --permission-mode acceptEdits --permission-prompts none --no-session-persistence --model sonnet --effort high --output-format stream-json --verbose -p $codingPrompt
```

実際の呼び出し側では、ストリームの各行を JSON として処理します。`system/init` のモデル名、`assistant` の `tool_use` 名、終了時の `result`・使用量・権限拒否を取り出してください。全文を毎回チャットへ流すと Codex のコンテキストを消費するため、進捗はモデル名・ツール名・作成ファイル程度に絞り、必要なコードをレビューします。

今回の呼び出しは最終JSONをまとめて受け取る方式だったため、数分間ファイルも応答も見えない時間がありました。次回は `stream-json --verbose` と逐次処理で、生成中・ツール使用中・エラー再試行を区別できるようにしてください。`$responseText = & ...` のように全出力を変数へまとめるだけでは、途中の進捗が見えません。

プロセス終了コードだけでなく、終了時の `result` イベントの `is_error` と `permission_denials` を確認してください。権限拒否があれば、必要な参照の不足か、禁止した操作の要求かを調べます。動作確認は実装担当の自己申告だけで完了にしません。停止が必要なときは、自分で起動した実行のセッションまたは追跡したPIDだけを対象にし、既存の Claude タブのプロセスを止めないでください。

## 4. Windows の文字コードと検証

PowerShell から Python などへ日本語をパイプするときは、入力と出力の UTF-8 を明示します。今回、一部SVGのタイトルが `?????` になり、修正しました。

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONIOENCODING = 'utf-8'
```

ファイルの読み取りは `Get-Content -Encoding UTF8`、書き込みは UTF-8 を明示するかパッチツールを使用してください。表示の文字化けと実ファイルの破損を区別し、SVGはXMLとしても確認します。

ブラウザで、仕様の受け入れ条件と実際の使いやすさを確認します。今回の [tests/smoke.py](../Game/StarSproutGarden/tests/smoke.py) は Python の Playwright と Google Chrome を使い、`file://` でも確認できます。新しいゲームでは、そのゲームに必要な検証を選んでください。

- 通常操作、設備購入、成長、周回と永久ボーナス。
- 保存復元、オフライン上限・効率・二重加算、未来の時刻、壊れた保存データ、保存不可の環境。
- 複数タブで一方だけが進行・保存し、明示的に操作タブを切り替えられること。
- PC・スマホのスクリーンショット、横はみ出し、固定メニューによる操作ボタンの遮蔽。
- キーボード操作、ダイアログのキャンセル・フォーカス移動と復帰、動き控えめ設定。
- JavaScriptのエラー、読み込めないアセット、仕様にない外部通信。

## 5. 使用量と時間を記録する

次回は各 Claude 呼び出しの開始・終了・モデル名・成功/失敗・`usage`・`modelUsage` を記録し、設計、実装、アセット、統合、検証、公開の時間を分けます。並行作業は担当時間の合計と全体の経過時間を区別してください。モデル・CLIによって項目が取れない場合は未取得と記録します。

Codex 側の消費量も、実行環境に実測値がある場合だけ記録してください。コード行数や Claude の消費量から Codex のトークンを推定したり、取得できなかった値を0として扱ったりしないでください。本文生成を別担当へ移すことと、指示・レビューを含む総消費量が減ることは別に評価します。

精度・速度・総トークンの改善を比較する場合は、同じ要件と受け入れ条件による単独実装との比較が必要です。今回の39項目の合格は、その試作が条件を満たした証拠であり、単独実装より高精度だった証拠ではありません。

## 6. コミット・公開を依頼されたとき

作業開始時の差分とリモート更新を確認し、担当したファイルだけをコミットします。新しいゲームは `links.js` に登録し、通常の「主要」一覧にも出す場合は `main: true` にします。コミットメッセージは日本語です。

今回、`origin` は旧URL `https://github.com/rirtir/rirusite.git` でしたが、プッシュは新リポジトリ `rirtir/rirtir.github.io` へ転送されて成功しました。作業時に `git remote -v` で確認し、旧URLへの警告だけで失敗と判断しないでください。GitHub CLI は未ログインでも Git のプッシュは成功しました。両者の認証を混同しないでください。

Git が所有者の違いを報告する場合、確認済みの対象パスだけをコマンド単位の `-c safe.directory=...` で指定する方法を使いました。必要なら実行環境の通常の承認手続きを使い、グローバルの信頼設定を広く変更しないでください。

`main` にプッシュ後、GitHub Pages のデプロイ成功と実際の公開URLの両方を確認します。今回、プッシュ直後はゲームが404、ホームページのリンクも未反映でしたが、デプロイ終了後に両方を確認できました。公開リポジトリの Actions 状態は、GitHub CLI へログインしなくても GitHub の公開 REST API から読めました。

公開サイトではHTTPステータスだけでなく、ゲームの操作・画像・エラー・ホームページのリンク表示も確認してから、遊べるURLを報告してください。
