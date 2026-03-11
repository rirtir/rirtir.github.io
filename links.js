const data = [
    {
        category: "Game",
        links: [
            {
                title: "ito",
                url: "https://rirtir.com/ito/",
                desc: "スマホ一台でみんなで遊べる"
            },
            {
                title: "ボブジテン",
                url: "https://rirtir.com/bob/",
                desc: "スマホ一台でみんなで遊べる"
            },
            {
                title: "ito-online",
                url: "https://ito-online.onrender.com/",
                desc: "それぞれのスマホで遊べる"
            },
            {
                title: "ぽっちゃりタイガー",
                url: "https://pochari-tiger.onrender.com/",
                desc: "制作中（ベータ版）"
            },
            {
                title: "インクリメンタルゲーム",
                url: "https://rirtir.com/incremental/",
                desc: "制作中（デモ版）"
            }
        ]
    },
    {
        category: "ImageProcessing",
        links: [
            {
                title: "輝度値→アルファ変換",
                url: "https://rirtir.com/Line2AlphaConverter/",
                desc: "グレースケール画像を透過画像にする。線画を線だけにするなど。"
            },
            {
                title: "動画から画像抽出",
                url: "https://rirtir.com/Video2Image/",
                desc: "動画から任意のフレームを抜き出す。"
            }
        ]
    },
    {
        category: "AudioProcessing",
        links: [
            {
                title: "音声解析ツール",
                url: "https://rirtir.com/AudioInfo/",
                desc: "音声のサンプリング周波数やビット深度などを表示する。またFFTも表示。"
            },
            {
                title: "リアルタイム文字起こし",
                url: "https://rirtir.com/RealTimeWhisper/",
                desc: "音声から文字起こしをする。調整中"
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