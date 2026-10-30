# 動画の無劣化トリミング

公開先: https://rirtir.com/Utility/VideoTrimmer/

MOV/MP4のH.264・HEVCをキーフレーム単位で切り出す、静的配信のブラウザツール。入力上限は10GiB。映像・音声の再エンコードやサーバーへの動画送信は行わない。

## 操作

1. 動画を選ぶ。iPhoneは「ファイル」から元ファイルを選ぶと、写真ライブラリ経由の取り込み変換を避けやすい。
2. プレビューと開始・終了のスライダーで範囲を指定する。時刻入力・再生位置からの指定は、開始を前、終了を後のキーフレームに合わせる。動画末尾も終了に指定できる。
3. 切り出す。PCの対応ブラウザでは選んだ保存先へ直接出力する。iPhoneは端末内の一時領域（OPFS）へ出力後、「共有して保存」→「ファイルに保存」、またはダウンロードを使う。共有先に「ビデオを保存」があれば「写真」にも保存できる。
4. 保存先で再生を確認してから、一時出力を削除する。

完成した一時出力はページの再読み込み後にも復元できる。ページの強制終了で残った未完成ファイルも削除できる。サイトデータが消去・退避される可能性があるため、OPFSを長期保存先にしない。

## 構成とメモリ

- `app.mjs`: 入力、プレビュー、キーフレーム範囲GUI、保存・復元・削除。
- `worker.mjs`: 部分読み込み、キーフレーム索引、無変換コピー、保存。重い処理とOPFSの同期アクセスは専用Workerで行う。
- `core.mjs`: MOV/MP4のヘッダー読み取り、映像形式情報と日時の保持、範囲補正。
- `vendor/`: Mediabunny 1.64.0とライセンス。CDN依存なし。

入力は`BlobSource`（キャッシュ8MiB）で部分読み込みし、出力は`StreamTarget`（2MiBチャンク・書き込みのバックプレッシャーあり）で順次保存する。`BufferTarget`や`fastStart: 'in-memory'`は使わない。出力は通常のMP4、管理情報`moov`は末尾。ファイル全体のサイズに等しいJSバッファは確保しないが、入力・出力のサンプル表やキーフレーム索引、ブラウザの動画プレビューには別途メモリを使う。入力`moov`の上限は128MiB。

コピーには`Conversion`の`copy.mode: 'forced'`を指定する。いずれかの映像・音声トラックをコピーできない場合は、トラックを黙って落とさず処理を中止する。入力は映像トラック1本に限定する。音声の境界は音声パケット単位になり、映像との差は通常1パケット程度。

出力後、末尾の`moov`にある映像の`stsd`を元のものに置き換える。映像本体を移動せず、H.264/HEVCの構成・色・HDR・Dolby Vision等のsample entryをそのまま維持する。映像の変換行列はライブラリのメタデータコピーで維持する。特殊形式すべての再生互換性を保証するものではない。

## 日時

元の`mvhd`から動画内の作成・更新日時を読み、出力の`mvhd`・`tkhd`・`mdhd`へ書き込む。読める撮影日時等のメタデータタグもコピーする。元の日時が0（不明）なら新しい日時を使用する。

ファイルシステムの作成日時・更新日時を元の値へ設定するブラウザAPIは使えない。共有用`File.lastModified`には入力の値を指定するが、ダウンロードや共有先での日時保持は保証しない。「写真」の並び順は保存先の解釈による。

## 対応範囲と実機確認

- 対象: 通常のMOV/MP4、H.264（`avc1`/`avc3`）、HEVC（`hvc1`/`hev1`）。VFRとBフレームありの動画も時刻情報を使ってコピーする。
- 対象外: ProRes、空間ビデオ等の複数映像トラック、暗号化、途中でsample descriptionが変わる動画、fragmented MP4。
- スローモーション・シネマティックの編集状態や、ライブラリが認識しない補助トラックの保持は保証しない。
- iPhoneは実機未検証。モバイルの画面幅と、PC用APIがない場合の処理分岐、共有APIへのファイル受け渡しをChromeで検証した。
- 9GiBの入力は、疎ファイルの大きな`free` boxと`co64`で4GB超の読み取り位置を検証した。9GiBの映像実データを処理・出力した試験ではない。
- iPhoneでの10GB級の実ファイル入力・ダウンロード・共有・「写真」でのHDR認識は利用者の実機検証が必要。一時出力と保存先のコピーを両方置ける空き容量を確保し、処理中は画面を開いたままにする。

## 検証

必要なもの: Python、Playwright、Chrome、FFmpeg/FFprobe（PATHに登録）。

```powershell
python Utility/VideoTrimmer/tests/verify_browser.py
```

H.264＋AAC、HEVC 10bit HDR、縦向きMOV、可変フレームレート、9GiB疎ファイルを生成して、ブラウザから切り出す。FFprobeで出力の圧縮パケットのSHA-256が元の連続部分と一致すること、キーフレーム開始、トラック数、日時、向き、色、元の映像sample entryを確認し、FFmpegでデコードする。さらに直接保存・OPFS復元・中止・保存枠不足・未完成ファイルの掃除・未対応音声の拒否を確認する。

生成した動画・スクリーンショット・検証JSONはリポジトリ直下の`.local/video-trimmer/`にだけ置き、コミットしない。

開発時の分担: Codex単独。Claudeは利用枠を確認できなかったため呼び出していない。検証結果と作業時間は同ディレクトリの検証記録に保存する。

## 参考

- https://mediabunny.dev/guide/converting-media-files
- https://mediabunny.dev/guide/reading-media-files
- https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/
- https://webkit.org/blog/14403/updates-to-storage-policy/
- https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker

ライセンスは[`vendor/README.md`](vendor/README.md)を参照。
