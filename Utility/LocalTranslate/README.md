# ポケット翻訳

PLaMo 3 Translate 0.8Bをブラウザで動かす、ビルド不要の翻訳ツール。
`index.html` をHTTPSまたはlocalhostから配信する。ルートの `links.js` に登録済み（`main: false`）。

## 実装

- 公式 `pfnet/plamo-3-translate-0.8b-GGUF` のQ4_0、547,539,584 bytesを直接取得する。
- リビジョン `dbeb0856cb0b004b484f190bb71dd65876297013` に固定。モデル本体はリポジトリに含めない。
- OPFSの専用ディレクトリへストリーム保存。サイズ・GGUFヘッダーを確認し、不完全な取得は削除する。暗号学的ハッシュ検証は実施していない。
- Web Locks対応環境では、保存・読み込み・削除の競合を防止する。ダウンロード中止後は最初から再取得する。
- wllama 3.13.0 / 同版のcompatビルドを同梱。llama.cpp b12211-7d7f028。PLaMo 3のトークナイザーと実推論を検証済み。
- WebAssembly / CPUの1スレッド、コンテキスト2,048、生成上限768トークン。GitHub Pagesに追加のCOOP/COEPヘッダーは不要。
- 公式PFML3で翻訳する。入力600文字、公式の53言語、ストリーミング表示、生成中止、コピー、言語入れ替えに対応。
- 入力文・訳文は通信・永続保存しない。モデル取得先はHugging Face。ページとエンジンは同一オリジンから配信。
- Service Workerのスコープはこのツールだけ。専用キャッシュにページとエンジンを保存し、モデルはOPFSだけに保存する。
- ページ更新時には `sw.js` のCACHEのバージョンを上げる。エンジンのURLにも版番号を付け、更新時のキャッシュ取得ではHTTPキャッシュを再検証する。ブラウザからのサイトデータ削除によりモデルとページのキャッシュは失われる。

## 配布物

`vendor/` は npm の公式レジストリから取得した `@wllama/wllama@3.13.0` と `@wllama/wllama-compat@3.13.0`。レジストリが公表するSHA-512 integrity値でアーカイブを照合し、改変せず同梱。MITライセンスは `vendor/WLLAMA-LICENSE`。llama.cppのライセンスは `vendor/LLAMA-LICENSE`。

モデルの利用には[PLaMoコミュニティライセンス](https://plamo.preferredai.jp/info/plamo-community-license)が適用される。本ツールはPFNの公式アプリではない。

## 検証

`tests/logic.test.mjs` はNodeで実行できる。PFML3生成、入力の拒否、言語コード、ストリーム保存の正常完了・途中切断・中止・HTTP失敗・タブ間排他を検証する。

```text
node --test Utility/LocalTranslate/tests/logic.test.mjs Utility/LocalTranslate/tests/offline.test.mjs
```

2026-11-17：`tests/verify_browser.py` をPlaywrightとPC版Chromeで実行し、次を確認した。

- 公式モデル547,539,584 bytesの実ダウンロード・OPFS保存・読み込み。
- 日→英：「会議は来週の月曜日に変更されました。」→「The meeting has been moved to next Monday.」
- 英→日：「Please open the window.」→「窓を開けてください。」
- ネットワークをオフラインにした後のページ再読み込み・モデル再読み込み・翻訳成功。
- 推論中のネットワーク要求なし。
- 翻訳生成の中止、その後の再翻訳成功、保存モデルの削除。
- 幅390pxで横スクロールなし。通常経路とSafari用互換経路の両方で実翻訳成功。ページのJavaScriptエラーなし。

PC上での検証であり、Android・iPhone実機の速度は未測定。

```text
python Utility/LocalTranslate/tests/verify_browser.py
python Utility/LocalTranslate/tests/verify_browser.py --compat
```

PythonのPlaywrightとChromeが必要。検証専用プロファイル・スクリーンショット・結果JSONは `.local/plamo/` に保存する。初回はモデルを実際にダウンロードする。通常経路のテストは最後に保存モデルを削除する。検証サーバーは127.0.0.1:8766を使用し、テスト終了時に閉じる。

ロジックテストの9項目、Service Workerのキャッシュ配信・他ツールのキャッシュ保護、JavaScript構文、53言語と公式モデルカードのコード一致、参照ファイル、マニフェスト、同梱WASMの形式検証は成功。固定した公式モデルURLの部分取得はHTTP 206・GGUFヘッダー・CORS許可・総バイト数一致を確認。localhostのページ配信はHTTP 200。

Safariは互換エンジンを使用するため、Chromeと速度が異なる。
