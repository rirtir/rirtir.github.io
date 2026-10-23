# 同梱ライブラリ

- PDF.js 6.4.299 legacy ビルド（Apache-2.0）: npm `pdfjs-dist@6.4.299` の `legacy/build/pdf.min.mjs` と `pdf.worker.min.mjs`
  - `pdfjs/` … 同パッケージの `cmaps/`・`standard_fonts/`・`iccs/`・`wasm/`（PDFスクリプト用の `quickjs-eval` は使わないため除外）。各ライセンスは同じフォルダ内に保持
  - 4.2.67 未満にあった CVE-2024-4367（細工したPDFで任意のJavaScriptが動く）を避けるため更新した
- @cantoo/pdf-lib 2.11.1（MIT、`pdf-lib-LICENSE.txt`）: npm `@cantoo/pdf-lib@2.11.1` の `dist/pdf-lib.min.js`
  - pdf-lib 1.17.1 の互換フォーク。パスワード付きPDFの復号と、保存時の暗号化のために使う

どちらも npm レジストリの integrity（sha512）と一致することを確認してから配置しています。PDF.js のライセンス表記は各ファイル冒頭と `PDFJS-LICENSE.txt` に保持しています。入力ファイルを外部へ送信せず、ライブラリもこのサイトから配信します。
