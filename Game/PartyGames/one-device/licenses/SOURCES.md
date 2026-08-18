# お題データの出典

生成したカテゴリの総当たりは使用せず、ライセンスが明示された公開データと、
このサイトに以前から収録されている ito・ボブジテンのデータを利用しています。

- ProtoQA crowdsourced questions / Boratko et al., UMass IESL（CC BY 4.0）
  - https://github.com/iesl/protoqa-data
  - 全員一致、ペアシンクロ、テレパシーワード、5秒で3つ。
  - 約100人の回答が実際に集まった質問から選び、日本語へ翻訳・表記調整。
- The Circa Dataset / Annie Louis, Dan Roth, Filip Radlinski, Google LLC（CC BY 4.0）
  - https://github.com/google-research-datasets/circa
  - 多数派を読め、少数派サバイバル。
  - 日常の好みに関する質問を選び、日本語へ翻訳。
- Longwave spectrum cards / Evan Bailey（MIT）
  - https://github.com/cynicaloptimist/longwave
  - ひみつの温度計。basicカードを選び、日本語へ翻訳。
- 日本語WordNet 1.1（WordNet License）
  - https://bond-lab.github.io/wnja/jpn/downloads.html
  - ワードウルフ、タブー説明、ウソ定義選手権。
- JMdict/EDICT / Electronic Dictionary Research and Development Group（CC BY-SA 4.0）
  - https://www.edrdg.org/edrdg/licence.html
  - ウソ定義選手権の読み。
- 既存の `Game/ito/` と `Game/bob/`、既存の `ito_online/topics.json`
  - 新フォーマットの ito・ボブジテン、NGワード、答えが先大喜利。

ProtoQA、CIRCA、Longwave の取得時元データは、Render版の
`minigame_online/source_data/` に保存しています。
