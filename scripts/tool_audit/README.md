# ブラウザツールの点検

Python、Playwright、Google Chrome、Pillow、NumPyを使用します。ビルド工程は不要です。生成物は `.local/tool-audit/` に保存されます。OSの実マイクや画面共有を許可する操作は行いません。

WindowsのPowerShellでは、リポジトリの `AGENTS.md` にあるUTF-8設定を先に適用してください。

```powershell
# 最初の点検時だけ。共通の入力データを保存する
python scripts/tool_audit/capture_before.py

python scripts/tool_audit/verify_tools.py
python scripts/tool_audit/verify_media.py
python scripts/tool_audit/verify_controls.py
python scripts/tool_audit/verify_other_tools.py

# 全49ページの起動・PC/スマホ幅・ネットワークエラー
python scripts/tool_audit/scan.py --after
```

`verify_media.py` はテスト用のWebM・WAVを生成します。`verify_other_tools.py` はその後に実行してください。`capture_before.py` のPDF作成は既存CDNからpdf-libを読み込みます。JSONLグラフと一部のフォントも外部ライブラリを読み込むため、ネットワーク接続が必要です。

PDF・パレット・深度の検証では、操作中の外部リクエストがないことも確認します。マイクのライフサイクルと文字起こしのモデル呼出しは模擬し、実音声の認識精度やOSの許可ダイアログは検証しません。ゲームは起動時のみ点検します。

`capture_report.py` は同じ入力と画面幅で `HEAD` と作業ツリーを撮影します。実装コミット前の実行を想定しています。記録済みの比較は `docs/tool-audit-2026-10/comparison.html` から参照できます。
