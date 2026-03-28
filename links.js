const data = [
    {
        category: "Game",
        links: [
            {
                title: "ito",
                url: "https://rirtir.com/Game/ito/",
                desc: "スマホ一台でみんなで遊べる"
            },
            {
                title: "ボブジテン",
                url: "https://rirtir.com/Game/bob/",
                desc: "スマホ一台でみんなで遊べる"
            },
            {
                title: "ito-online",
                url: "https://ito-online.onrender.com/",
                desc: "それぞれのスマホで遊べる"
            },
            {
                title: "ブレインビータ",
                url: "https://rirtir.com/Game/BrainBeater/",
                desc: "一人でやりこめるゲーム"
            },
            {
                title: "ぽっちゃりタイガー",
                url: "https://pochari-tiger.onrender.com/",
                desc: "制作中（ベータ版）"
            },
            {
                title: "インクリメンタルゲーム",
                url: "https://rirtir.com/Game/incremental/",
                desc: "制作中（デモ版）"
            }
        ]
    },
    {
        category: "ImageProcessing",
        links: [
            {
                title: "画像処理ツール",
                url: "https://rirtir.com/Image/ImageEffectLayerTool/",
                desc: "様々なエフェクトを重ねることができるツール。ベータ版"
            },{
                title: "輝度値→アルファ変換",
                url: "https://rirtir.com/Image/Line2AlphaConverter/",
                desc: "グレースケール画像を透過画像にする。線画を線だけにするなど。"
            },
            {
                title: "画像透過ツール",
                url: "https://rirtir.com/Image/AlphaTool/",
                desc: "画像の一部を透過する。透過したい箇所をタップして透過可能。"
            },
            {
                title: "動画から画像抽出",
                url: "https://rirtir.com/Image/Video2Image/",
                desc: "動画から任意のフレームを抜き出す。"
            },
            {
                title: "画像連番から動画作成",
                url: "https://rirtir.com/Image/Image2Video/",
                desc: "画像を複数入力して動画を作成"
            },
            {
                title: "画像からカラーパレット抽出",
                url: "https://rirtir.com/Image/CreateColorPalette/",
                desc: "画像から主要な色を抽出（調整中）"
            }
        ]
    },
    {
        category: "AudioProcessing",
        links: [
            {
                title: "動画から音声抽出",
                url: "https://rirtir.com/Audio/Video2Audio/",
                desc: "動画から音声ファイルを抽出する。オリジナル、mp3、wavから選べる。"
            },
            {
                title: "音声解析ツール",
                url: "https://rirtir.com/Audio/AudioInfo/",
                desc: "音声のサンプリング周波数やビット深度などを表示する。またFFTも表示。"
            },
            {
                title: "リアルタイム音声解析",
                url: "https://rirtir.com/Audio/RealTimeAudioAnalyzer/",
                desc: "マイク音声の波形とFFTを表示する"
            },
            {
                title: "リアルタイム文字起こし",
                url: "https://rirtir.com/Audio/RealTimeWhisper/",
                desc: "音声から文字起こしをする。調整中"
            }
        ]
    },
    {
        category: "Utility",
        links: [
            {
                title: "CSS重複削除ツール",
                url: "https://rirtir.com/Utility/CSSDiffRemovalTool/",
                desc: "【個人用】CSSの被りをなくすためのツール。"
            },
            {
                title: "jsonlをグラフ化",
                url: "https://rirtir.com/Utility/jsonl2graph/",
                desc: "【超個人用】jsonlの学習結果をグラフに起こすだけのツール。"
            }
        ]
    },
    {
        category: "Links",
        links: [
            {
                title: "GitHub",
                url: "https://github.com/rirtir/rirtir.github.io",
                desc: "このページのリポジトリ"
            }
        ]
    }
]

const container = document.getElementById("container")

data.forEach(cat => {
    const section = document.createElement("div")
    section.className = "category"

    const title = document.createElement("h2")
    title.textContent = cat.category
    section.appendChild(title)

    const grid = document.createElement("div")
    grid.className = "links"

    cat.links.forEach(link => {
        const a = document.createElement("a")
        a.href = link.url
        a.className = "card"
        a.target = "_blank"

        a.innerHTML = `
<strong>${link.title}</strong>
<p>${link.desc}</p>
`

        grid.appendChild(a)
    })

    section.appendChild(grid)
    container.appendChild(section)
})