"use strict";

(function (DT) {
  const DATA = DT.DATA;
  const E = DT.Engine;
  const SAVE_KEY = "dawnTrain_save_v1";
  const BACKUP_KEY = "dawnTrain_chapter_backup_v1";
  const SETTINGS_KEY = "dawnTrain_settings_v1";

  const app = document.getElementById("app");
  const topbar = document.getElementById("topbar");
  const headerLocation = document.getElementById("headerLocation");
  const headerResources = document.getElementById("headerResources");
  const modalRoot = document.getElementById("modalRoot");
  const toast = document.getElementById("toast");

  const ART = {
    key: "assets/art/key/title-train.webp",
    train: "assets/art/train/train-cutaway.webp",
    garage: "assets/art/backgrounds/garage.webp",
    chapters: [
      "assets/art/backgrounds/chapter-1-ash-yard.webp",
      "assets/art/backgrounds/chapter-2-canal.webp",
      "assets/art/backgrounds/chapter-3-iron-forest.webp",
      "assets/art/backgrounds/chapter-4-black-crystal.webp",
      "assets/art/backgrounds/chapter-5-ice-plain.webp",
      "assets/art/backgrounds/chapter-6-twin-capital.webp",
      "assets/art/backgrounds/chapter-7-lighthouse.webp"
    ],
    portraits: Object.fromEntries(["kureha", "gaku", "mina", "sui", "nagi", "teto", "rikka", "orun"].map(id => [id, `assets/art/portraits/${id}.webp`])),
    bosses: Object.fromEntries(["varga", "nereis", "ferroa", "mole", "isberg", "alba", "nox"].map(id => [id, `assets/art/bosses/${id}.webp`])),
    endings: Object.fromEntries(["ignite", "divide", "weave"].map(id => [id, `assets/art/endings/${id}.webp`]))
  };
  const SPEAKER_IDS = { "クレハ": "kureha", "ガク": "gaku", "ミナ": "mina", "スイ": "sui", "ナギ": "nagi", "テト": "teto", "リッカ": "rikka", "オルン": "orun" };
  const RESOURCE_ICONS = { fuel: "i-fuel", scrap: "i-scrap", medkits: "i-med", morale: "i-morale" };

  let game = null;
  let settings = loadSettings();
  let eventPage = 0;
  let selectedActor = null;
  let selectedAction = null;
  let toastTimer = null;
  let fxTimer = null;
  let currentView = "loading";
  let lastClock = Date.now();
  let routeSelection = null;
  let prologuePage = 0;
  let viewportFrame = 0;

  function syncViewportMetrics() {
    window.cancelAnimationFrame(viewportFrame);
    viewportFrame = window.requestAnimationFrame(() => {
      const visual = window.visualViewport;
      const viewportHeight = visual && Math.abs((visual.scale || 1) - 1) < 0.01
        ? visual.height
        : window.innerHeight;
      const topbarHeight = topbar.classList.contains("hidden") ? 0 : topbar.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--viewport-height", `${Math.max(1, Math.floor(viewportHeight))}px`);
      document.documentElement.style.setProperty("--topbar-height", `${Math.max(0, Math.ceil(topbarHeight))}px`);
    });
  }

  function icon(id, label = "") {
    return `<svg class="ui-icon" ${label ? `aria-label="${escapeHtml(label)}" role="img"` : "aria-hidden=\"true\""}><use href="#${id}"></use></svg>`;
  }

  function actionIcon(key) {
    if (key === "move") return icon("i-arrow");
    if (key === "attack") return icon("i-target");
    if (key === "repair") return icon("i-scrap");
    if (key === "operate") return icon("i-steam");
    return icon("i-skill");
  }

  function ensureGuidance(state) {
    if (!state) return null;
    const defaults = { prologue: false, route: 0, battle: 0, choice: false, garage: false, garageRepair: false, upgrade: false, bosses: {} };
    state.guidance = Object.assign(defaults, state.guidance || {});
    state.guidance.bosses = Object.assign({}, state.guidance.bosses || {});
    return state.guidance;
  }

  function chapterArt(number = 1) {
    return ART.chapters[Math.max(0, Math.min(6, number - 1))];
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadSettings() {
    const defaults = { sound: true, bgmVolume: 0.4, sfxVolume: 0.7, reduceMotion: false, confirmTurn: true };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (!saved || typeof saved !== "object") return defaults;
      const merged = Object.assign(defaults, saved);
      if (saved.sfxVolume === undefined && saved.volume !== undefined) merged.sfxVolume = saved.volume;
      delete merged.volume;
      return merged;
    } catch (_) {
      return defaults;
    }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
    DT.audio.configure(settings);
    document.body.classList.toggle("reduce-motion", settings.reduceMotion);
    updateSoundButton();
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const valid = E.validateGame(parsed);
      if (!valid.ok) throw new Error(valid.error);
      ensureGuidance(parsed);
      return parsed;
    } catch (error) {
      showToast(`セーブを読み込めません: ${error.message}`, "error", 5000);
      return null;
    }
  }

  function saveGame({ backup = false } = {}) {
    if (!game) return false;
    updatePlaytime();
    game.updatedAt = Date.now();
    try {
      const raw = JSON.stringify(game);
      localStorage.setItem(SAVE_KEY, raw);
      if (backup) localStorage.setItem(BACKUP_KEY, raw);
      return true;
    } catch (error) {
      showToast("セーブに失敗しました。空き容量を確認してください。", "error", 5000);
      return false;
    }
  }

  function updatePlaytime() {
    const now = Date.now();
    if (game && !document.hidden) game.stats.playSeconds += Math.max(0, Math.min(60, Math.floor((now - lastClock) / 1000)));
    lastClock = now;
  }

  function showToast(message, tone = "normal", duration = 2400) {
    toast.textContent = message;
    toast.className = `toast show ${tone === "error" ? "error" : ""}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.className = "toast"; }, duration);
  }

  function triggerFx(name) {
    window.clearTimeout(fxTimer);
    document.body.className = document.body.className.replace(/\bfx-[\w-]+\b/g, "").trim();
    void document.body.offsetWidth;
    document.body.classList.add(`fx-${name}`);
    fxTimer = window.setTimeout(() => document.body.classList.remove(`fx-${name}`), 620);
  }

  function updateSoundButton() {
    const button = document.getElementById("soundButton");
    if (!button) return;
    button.classList.toggle("muted", !settings.sound);
    button.setAttribute("aria-pressed", String(settings.sound));
    button.setAttribute("aria-label", settings.sound ? "音声設定（再生中）" : "音声設定（ミュート）");
  }

  function showTopbar(show = true) {
    topbar.classList.toggle("hidden", !show);
    syncViewportMetrics();
    if (!show || !game) return;
    const brandButton = document.getElementById("brandButton");
    const journeyUnavailable = ["battle", "result", "defeat", "epilogue"].includes(currentView);
    brandButton.disabled = journeyUnavailable;
    brandButton.setAttribute("aria-disabled", String(journeyUnavailable));
    const chapter = E.getChapter(game);
    document.body.dataset.chapter = String((chapter?.number) || 1);
    DT.audio.setChapter((chapter?.number) || 1);
    headerLocation.textContent = chapter ? `第${chapter.number}夜 ${chapter.name}` : "七夜の終着点";
    renderResources();
  }

  function renderResources() {
    if (!game) return;
    const items = [
      ["fuel", "燃料", game.resources.fuel], ["scrap", "部品", game.resources.scrap], ["medkits", "医療", game.resources.medkits], ["morale", "士気", game.resources.morale]
    ];
    headerResources.innerHTML = items.map(([key, label, value]) => `<div class="resource-chip resource-${key}">${icon(RESOURCE_ICONS[key])}<span><small>${label}</small><b>${value}</b></span></div>`).join("");
  }

  function setView(name) {
    currentView = name;
    app.dataset.view = name;
    document.body.dataset.view = name;
    const art = name === "title" || name === "prologue" ? ART.key : name === "garage" ? ART.garage : chapterArt(game ? E.getChapter(game)?.number : 1);
    document.body.style.setProperty("--world-art", `url('${art}')`);
    const scene = name === "title" || name === "prologue"
      ? "title"
      : name === "battle"
        ? (game?.battle && DATA.encounters[game.battle.encounterId]?.objective.type === "boss" ? "boss" : "battle")
        : name === "epilogue" || name === "complete"
          ? "ending"
          : "journey";
    DT.audio.setScene(scene);
    syncViewportMetrics();
    window.scrollTo({ top: 0, behavior: settings.reduceMotion ? "auto" : "smooth" });
    app.focus({ preventScroll: true });
  }

  function renderTitle() {
    setView("title");
    showTopbar(false);
    DT.audio.stopRail();
    const existing = loadGame();
    document.body.style.setProperty("--world-art", `url('${ART.key}')`);
    app.innerHTML = `
      <section class="title-screen cinematic-screen">
        <div class="title-lockup">
          <p class="title-kicker">A RAILWAY OPERA IN SEVEN NIGHTS</p>
          <h1>黎明列車<span>七夜の終着点</span></h1>
          <div class="title-rule"><i></i><span>人工太陽輸送計画・最終便</span><i></i></div>
          <p class="title-copy">太陽が消えて十九年。最後の暁核を運ぶ装甲列車は、<br>夜に呑まれる世界を七夜で横断する。</p>
        </div>
        <div class="title-ticket">
          <div class="ticket-meta"><span>全7章</span><span>戦術RPG</span><span>オートセーブ</span></div>
          <div class="title-actions">
          ${existing ? `<button id="continueButton" class="primary-button">つづきから</button>` : ""}
          <button id="newGameButton" class="${existing ? "secondary-button" : "primary-button"}">はじめから</button>
          <button id="titleSettingsButton" class="secondary-button">設定</button>
          <button id="titleImportButton" class="secondary-button">セーブ管理</button>
          </div>
          <p class="version-label">VERSION ${DATA.version} / SAVE ${DATA.saveVersion}</p>
        </div>
      </section>`;
    document.getElementById("continueButton")?.addEventListener("click", () => {
      DT.audio.play("confirm");
      game = loadGame();
      if (!game) return renderTitle();
      resumeGame();
    });
    document.getElementById("newGameButton").addEventListener("click", () => openNewGameModal(Boolean(existing)));
    document.getElementById("titleSettingsButton").addEventListener("click", openSettings);
    document.getElementById("titleImportButton").addEventListener("click", openSaveManager);
  }

  function openNewGameModal(hasSave) {
    openModal(`
      <h2>新しい旅を始める</h2>
      ${hasSave ? `<p>現在の進行は章バックアップを除いて上書きされます。</p>` : `<p>敵の強さを選んでください。物語と報酬は同じです。</p>`}
      <div class="choice-list">
        <button class="choice-button difficulty-choice" data-difficulty="normal"><b>標準</b><small>配置と設備を活用する基本難易度</small></button>
        <button class="choice-button difficulty-choice" data-difficulty="story"><b>物語</b><small>敵HP-20%、敵の攻撃-1</small></button>
      </div>
      <div class="modal-actions"><button class="secondary-button modal-close">戻る</button></div>`);
    modalRoot.querySelectorAll(".difficulty-choice").forEach(button => button.addEventListener("click", () => {
      game = E.createNewGame(button.dataset.difficulty);
      ensureGuidance(game);
      saveGame({ backup: true });
      closeModal();
      DT.audio.play("confirm");
      eventPage = 0;
      prologuePage = 0;
      renderPrologue();
    }));
  }

  function renderPrologue() {
    setView("prologue");
    showTopbar(false);
    DT.audio.stopRail();
    const pages = [
      { kicker: "NINETEEN YEARS WITHOUT SUN", title: "太陽は、十九年前に消えた。", text: "夜蝕は西から街を覆い、残された避難灯も七夜後には尽きる。暁核を東端灯台まで運び、空に朝を取り戻せるのは、もうこの列車しかない。", art: ART.key },
      { kicker: "THE LAST ARMORED TRAIN", title: "これが、あなたの列車だ。", text: "五両の車内は、三層の通路でつながっている。乗員を移動させながら、攻撃、修理、治療、車両の装置を使い分けよう。車両が受けた傷は、戦いが終わっても残る。", art: ART.train, cutaway: true },
      { kicker: "SEVEN NIGHTS TO THE LIGHTHOUSE", title: "道を選び、東へ進む。", text: "安全な遠回りには多くの燃料が、危険な近道には少ない燃料が必要になる。出発前に残量と危険を見比べよう。あなたが選んだ道が、七夜の結末を変える。", art: chapterArt(1) }
    ];
    const page = pages[prologuePage];
    app.innerHTML = `<section class="prologue-screen">
      <div class="prologue-art ${page.cutaway ? "cutaway" : ""}" style="background-image:url('${page.art}')"></div>
      <article class="prologue-caption"><p class="title-kicker">${page.kicker}</p><h1>${page.title}</h1><p>${page.text}</p>
        <div class="prologue-progress">${pages.map((_, i) => `<i class="${i <= prologuePage ? "on" : ""}"></i>`).join("")}</div>
        <button id="prologueNext" class="primary-button">${prologuePage === pages.length - 1 ? "暁核を積み、出発する" : "次へ"}</button>
      </article></section>`;
    document.getElementById("prologueNext").addEventListener("click", () => {
      DT.audio.play(prologuePage === pages.length - 1 ? "steam" : "story");
      if (prologuePage < pages.length - 1) { prologuePage += 1; return renderPrologue(); }
      game.guidance.prologue = true;
      saveGame({ backup: true });
      eventPage = 0;
      openCurrentStep();
    });
  }

  function resumeGame() {
    ensureGuidance(game);
    if (!game.guidance.prologue) { prologuePage = 0; return renderPrologue(); }
    showTopbar(true);
    DT.audio.startRail();
    if (game.completed) return renderEpilogue();
    if (game.battle) {
      if (game.battle.phase === "victory") return resolveVictory();
      if (game.battle.phase === "defeat") return renderDefeat();
      renderBattle();
    } else {
      renderJourney();
    }
  }

  function stepLabel(step) {
    if (!step) return ["旅の中断", "次の目的地を確認できません"];
    if (step.type === "event") return ["物語", DATA.events[step.id]?.title || "出来事"];
    if (step.type === "route") return ["路線選択", step.title];
    if (step.type === "garage") return ["車内整備", step.title || "列車を整える"];
    if (step.type === "upgrade") return ["列車強化", "新しい強化を選ぶ"];
    if (step.type === "boss") return ["決戦", DATA.encounters[step.id].name];
    if (step.type === "battle") return ["戦闘", DATA.encounters[step.id].name];
    if (step.type === "chapterEnd") return ["章の終わり", "次の夜へ進む"];
    if (step.type === "epilogue") return ["終着", "旅の結末を見る"];
    return ["次の予定", "先へ進む"];
  }

  function stepActionLabel(step) {
    if (!step) return "先へ進む";
    if (step.type === "event") return "話を聞く";
    if (step.type === "route") return "進路を選ぶ";
    if (step.type === "garage") return "整備を始める";
    if (step.type === "upgrade") return "列車を強化する";
    if (step.type === "battle" || step.type === "boss") return "戦闘を始める";
    if (step.type === "chapterEnd") return "次の夜へ";
    if (step.type === "epilogue") return "結末を見る";
    return "先へ進む";
  }

  function renderJourney() {
    routeSelection = null;
    setView("journey");
    showTopbar(true);
    DT.audio.startRail();
    const chapter = E.getChapter(game);
    const step = E.getStep(game);
    const [kind, title] = stepLabel(step);
    const progress = E.getProgress(game);
    const stops = DATA.chapters.map((item, index) => {
      const className = index < game.chapterIndex ? "done" : index === game.chapterIndex ? "current" : "";
      return `<div class="chapter-stop ${className}"><i>${index < game.chapterIndex ? "✓" : item.number}</i><span>${escapeHtml(item.short)}</span></div>`;
    }).join("");
    const crew = Object.values(game.crew).map(item => `<div class="crew-mini"><img src="${ART.portraits[item.id]}" alt=""><span><b>${escapeHtml(DATA.crew[item.id].name)}</b><small>${escapeHtml(DATA.crew[item.id].role)}　${item.hp}/${item.maxHp}</small></span></div>`).join("");
    app.innerHTML = `
      <section class="screen journey-screen">
        <header class="screen-heading chapter-heading"><div><p class="eyebrow">NIGHT ${chapter.number} / 7</p><h1>${escapeHtml(chapter.name)}</h1><p>${escapeHtml(chapter.summary)}</p></div><div class="chapter-count">今夜の進行 ${Math.min(game.stepIndex + 1, progress.steps)}<small>/ ${progress.steps}</small></div></header>
        <div class="journey-hero" style="--chapter-art:url('${chapterArt(chapter.number)}')">
          <div class="journey-horizon"></div>
          <img class="journey-train" src="${ART.train}" alt="横から見た黎明列車の車内断面">
          <div class="route-progress">${stops}</div>
        </div>
        <div class="journey-layout">
          <div class="dispatch-board">
            <div class="dispatch-pin">${icon("i-arrow")}</div>
            <article class="next-card">
              <small>${escapeHtml(kind)}</small>
              <h2>${escapeHtml(title)}</h2>
              <p>${escapeHtml(step?.type === "battle" || step?.type === "boss" ? DATA.encounters[step.id].intro : chapter.summary)}</p>
              <button id="proceedButton" class="primary-button" ${step ? "" : "disabled"}>${stepActionLabel(step)}</button>
            </article>
          </div>
          <aside class="side-stack">
            <div class="crew-roster"><h3>乗務員名簿</h3><div class="crew-mini-list">${crew}</div></div>
            <div class="side-actions">
              <button id="garageButton" class="secondary-button">車内整備</button>
              <button id="saveManageButton" class="secondary-button">セーブ管理</button>
            </div>
          </aside>
        </div>
      </section>`;
    document.getElementById("proceedButton")?.addEventListener("click", openCurrentStep);
    document.getElementById("garageButton").addEventListener("click", () => renderGarage(false));
    document.getElementById("saveManageButton").addEventListener("click", openSaveManager);
  }

  function openCurrentStep() {
    const step = E.getStep(game);
    if (!step) {
      showToast("次の目的地を読み込めませんでした", "error");
      return renderJourney();
    }
    DT.audio.play("confirm");
    if (step.type === "event") { eventPage = 0; return renderEvent(); }
    if (step.type === "route") return renderRouteChoice();
    if (step.type === "garage") return renderGarage(true);
    if (step.type === "upgrade") return renderUpgrade();
    if (step.type === "epilogue") return renderEpilogue();
    if (step.type === "battle" || step.type === "boss") {
      const result = E.startCurrentBattle(game);
      if (!result.ok) return showToast(result.error, "error");
      saveGame();
      selectedActor = game.battle.crew[0]?.uid || null;
      selectedAction = null;
      return renderBattle();
    }
    if (step.type === "chapterEnd") {
      const result = E.advanceChapter(game);
      saveGame({ backup: true });
      if (result.completed) return renderCampaignComplete();
      return renderJourney();
    }
  }

  function renderEvent() {
    setView("event");
    showTopbar(true);
    ensureGuidance(game);
    const step = E.getStep(game);
    const event = DATA.events[step.id];
    const page = event.pages[Math.min(eventPage, event.pages.length - 1)];
    const speakerId = SPEAKER_IDS[page.speaker];
    const finalPage = eventPage >= event.pages.length - 1;
    const choices = finalPage && event.choices ? `<div class="choice-list">${event.choices.map((choice, index) => {
      const availability = E.choiceAvailable(game, choice);
      return `<button class="choice-button event-choice" data-choice="${index}" ${availability.ok && game.guidance.choice ? "" : "disabled"}><b>${escapeHtml(choice.label)}</b><small>${escapeHtml(availability.ok ? choice.detail : `${choice.detail}（${availability.reason}）`)}</small></button>`;
    }).join("")}</div>` : "";
    app.innerHTML = `
      <section class="story-screen" style="--story-art:url('${chapterArt(E.getChapter(game).number)}')">
        <article class="story-stage">
          <div class="story-title"><span class="chapter-number">${escapeHtml(event.kicker)}</span><h1>${escapeHtml(event.title)}</h1></div>
          ${speakerId ? `<img class="story-portrait" src="${ART.portraits[speakerId]}" alt="${escapeHtml(page.speaker)}">` : `<div class="record-sigil">${icon("i-rail")}<span>旅の記録</span></div>`}
          <div class="story-body">
            <div class="story-speaker">${escapeHtml(page.speaker)}${speakerId ? `<small>${escapeHtml(DATA.crew[speakerId].role)}</small>` : ""}</div>
            <p class="story-text">${escapeHtml(page.text)}</p>
            ${finalPage && event.choices && !game.guidance.choice ? `<div class="field-guide choice-guide"><span>選択肢について</span><b>選ぶ前に、得られるものと失うものを比べよう。</b><p>ここでの選択は、後の物語や結末に影響します。一度選ぶと、章の最初からやり直さない限り変更できません。選べない項目には、その理由が表示されます。</p><button id="choiceLesson" class="guide-button">選び方を確認する</button></div>` : ""}
            ${choices}
            ${!choices ? `<button id="storyNextButton" class="primary-button">${finalPage ? "列車に戻る" : "次へ"}</button>` : ""}
          </div>
        </article>
      </section>`;
    document.getElementById("storyNextButton")?.addEventListener("click", () => {
      DT.audio.play("story");
      if (!finalPage) { eventPage += 1; renderEvent(); }
      else { E.completeEvent(game); saveGame(); renderJourney(); }
    });
    app.querySelectorAll(".event-choice").forEach(button => button.addEventListener("click", () => {
      const result = E.completeEvent(game, Number(button.dataset.choice));
      if (!result.ok) return showToast(result.error, "error");
      DT.audio.play("confirm");
      saveGame();
      renderJourney();
    }));
    document.getElementById("choiceLesson")?.addEventListener("click", () => {
      game.guidance.choice = true;
      DT.audio.play("paper");
      saveGame();
      renderEvent();
    });
  }

  function renderRouteChoice() {
    setView("route");
    showTopbar(true);
    const step = E.getStep(game);
    ensureGuidance(game);
    const selected = step.options.find(option => option.id === routeSelection) || null;
    const cost = selected?.cost?.fuel || 0;
    const afterFuel = Math.max(0, game.resources.fuel - cost);
    const shortfall = selected ? Math.max(0, cost - game.resources.fuel) : 0;
    const guideStage = game.guidance.route;
    app.innerHTML = `
      <section class="screen route-screen">
        <div class="route-skyline" style="--chapter-art:url('${chapterArt(E.getChapter(game).number)}')"><div><p class="eyebrow">ROUTE SELECT</p><h1>${escapeHtml(step.title)}</h1><p>${escapeHtml(step.text)}</p></div><button id="routeBack" class="secondary-button">列車に戻る</button></div>
        <div class="fuel-brief ${guideStage === 0 ? "tutorial-focus" : ""}">${icon("i-fuel")}<div><small>現在の燃料</small><b>${game.resources.fuel}</b></div><span class="fuel-arrow">→</span><div><small>出発後</small><b class="${shortfall ? "danger-text" : ""}">${selected ? afterFuel : "—"}</b></div><p>${selected ? (shortfall ? `燃料が ${shortfall} 足りません。強行すると全車両が損傷し、士気も下がります。` : `この路線を選ぶと、燃料は ${afterFuel} 残ります。`) : "路線を選んだだけでは燃料を使いません。出発するまでは何度でも選び直せます。"}</p></div>
        ${guideStage < 2 ? `<div class="field-guide route-guide"><span>進路選びガイド ${guideStage + 1}/2</span><b>${guideStage === 0 ? "安全な遠回りほど、多くの燃料が必要です。" : "出発後の燃料と危険度を確認しよう。"}</b><p>${guideStage === 0 ? "まず二つの路線を見比べて、どちらか一方を選んでください。まだ燃料は減りません。" : "もう一方の路線にも切り替えられます。決まったら、下のボタンで出発してください。"}</p></div>` : ""}
        <div class="route-choice-grid">${step.options.map(option => `
          <button class="route-choice-card ${routeSelection === option.id ? "selected" : ""}" data-route="${option.id}">
            <span class="tag ${option.danger.includes("高") ? "danger" : ""}">${escapeHtml(option.danger)}</span>
            <h2>${escapeHtml(option.title)}</h2>
            <p>${escapeHtml(option.detail)}</p>
            <div class="route-line">${icon("i-rail")}<i></i><span>${(option.cost?.fuel || 0) <= 1 ? "近道" : "遠回り"}</span></div>
            <div class="route-cost"><span class="tag">${icon("i-fuel")} −${option.cost?.fuel || 0}</span>${game.resources.fuel < (option.cost?.fuel || 0) ? `<span class="tag danger">燃料不足</span>` : ""}</div>
            <div class="route-reward"><span class="tag reward">${escapeHtml(routeRewardText(option.battle))}</span></div>
          </button>`).join("")}</div>
        <div class="dispatch-lever ${selected ? "ready" : ""}"><div><small>行き先</small><b>${selected ? escapeHtml(selected.title) : "路線を選んでください"}</b></div><button id="routeConfirm" class="primary-button" ${selected ? "" : "disabled"}>この路線で出発する ${icon("i-arrow")}</button></div>
      </section>`;
    document.getElementById("routeBack").addEventListener("click", renderJourney);
    app.querySelectorAll(".route-choice-card").forEach(button => button.addEventListener("click", () => {
      const option = step.options.find(item => item.id === button.dataset.route);
      routeSelection = option.id;
      if (game.guidance.route === 0) game.guidance.route = 1;
      DT.audio.play("lever");
      saveGame();
      renderRouteChoice();
    }));
    document.getElementById("routeConfirm")?.addEventListener("click", () => {
      const option = step.options.find(item => item.id === routeSelection);
      if (!option) return;
      const message = `燃料 ${game.resources.fuel} → ${Math.max(0, game.resources.fuel - (option.cost?.fuel || 0))}。${game.resources.fuel < (option.cost?.fuel || 0) ? "足りない分は、全車両への損傷と士気低下で補います。" : "出発すると、次の戦闘が終わるまで路線は変更できません。"}`;
      confirmModal(`${option.title}へ向かいますか？`, message, () => {
        const result = E.chooseRoute(game, routeSelection);
        if (!result.ok) return showToast(result.error, "error");
        game.guidance.route = 2;
        routeSelection = null;
        saveGame();
        selectedActor = game.guidance.battle === 0 ? null : game.battle.crew[0]?.uid || null;
        selectedAction = null;
        renderBattle();
      });
    });
  }

  function routeRewardText(encounterId) {
    const reward = DATA.encounters[encounterId].reward || {};
    const parts = [];
    if (reward.scrap) parts.push(`部品${reward.scrap}`);
    if (reward.medkits) parts.push(`医療品${reward.medkits}`);
    if (reward.fuel) parts.push(`燃料${reward.fuel}`);
    if (reward.record) parts.push("制御記録");
    return parts.join("・") || "報酬なし";
  }

  function renderBattle() {
    setView("battle");
    showTopbar(true);
    const battle = game.battle;
    if (!battle) return renderJourney();
    if (battle.phase === "victory") return resolveVictory();
    if (battle.phase === "defeat") return renderDefeat();
    const encounter = DATA.encounters[battle.encounterId];
    ensureGuidance(game);
    const isFirstLesson = ["c1_safe", "c1_risky"].includes(battle.encounterId) && game.guidance.battle < 12;
    const lesson = isFirstLesson ? game.guidance.battle : 12;
    if ([5, 6].includes(lesson)) selectedActor = battle.crew.find(unit => unit.id === "sui" && unit.hp > 0)?.uid || selectedActor;
    if ([10, 11].includes(lesson)) selectedActor = battle.crew.find(unit => unit.id === "gaku" && unit.hp > 0)?.uid || selectedActor;
    if ((!selectedActor || !battle.crew.some(unit => unit.uid === selectedActor && unit.hp > 0)) && lesson > 1) {
      selectedActor = battle.crew.find(unit => unit.hp > 0 && unit.ap > 0)?.uid || battle.crew.find(unit => unit.hp > 0)?.uid;
    }
    const actor = battle.crew.find(unit => unit.uid === selectedActor);
    if (lesson === 3 && actor && !selectedAction && E.getActions(battle, actor.uid).some(action => action.key === "move" && action.enabled)) selectedAction = "move";
    if (lesson === 6 && actor && !selectedAction && E.getActions(battle, actor.uid).some(action => action.key === "attack" && action.enabled)) selectedAction = "attack";
    if (lesson === 11 && actor && !selectedAction && E.getActions(battle, actor.uid).some(action => action.key === "operate" && action.enabled)) selectedAction = "operate";
    const actions = actor ? E.getActions(battle, actor.uid) : [];
    const targets = selectedAction && actor ? E.getTargets(battle, actor.uid, selectedAction) : [];
    const targetCells = new Set(targets.filter(item => item.type === "cell").map(item => `${item.pos.car}:${item.pos.lane}`));
    const targetEnemies = new Set(targets.filter(item => item.type === "enemy").map(item => item.id));
    const targetAllies = new Set(targets.filter(item => item.type === "ally").map(item => item.id));
    const targetCars = new Set(targets.filter(item => item.type === "car").map(item => item.index));
    const intentCells = new Set();
    const intentCars = new Set();
    battle.enemies.filter(unit => unit.hp > 0 && unit.intent).forEach(unit => {
      if (unit.intent.targetPos) intentCells.add(`${unit.intent.targetPos.car}:${unit.intent.targetPos.lane}`);
      if (Number.isInteger(unit.intent.targetCar)) intentCars.add(unit.intent.targetCar);
    });
    if (battle.hazardIntent?.targetLane !== undefined) {
      battle.cars.forEach((_, car) => intentCells.add(`${car}:${battle.hazardIntent.targetLane}`));
    }
    if (Number.isInteger(battle.hazardIntent?.targetCar)) intentCars.add(battle.hazardIntent.targetCar);
    let intentHtml = battle.enemies.filter(unit => unit.hp > 0).map(enemy => `<div class="intent-card">${icon("i-target")}<span><b>${escapeHtml(DATA.enemies[enemy.type].name)}：${escapeHtml(enemy.intent?.label || "待機")}</b><small>${escapeHtml(enemy.intent?.detail || "")}</small></span></div>`).join("");
    if (battle.hazardIntent) intentHtml += `<div class="intent-card hazard">${icon("i-target")}<span><b>環境：${escapeHtml(DATA.encounters[battle.encounterId].hazard?.text || "環境効果")}</b><small>${escapeHtml(battle.hazardIntent.text)}</small></span></div>`;
    const rows = [0, 1, 2].map(lane => `<div class="board-row">${battle.cars.map((car, carIndex) => {
      const pos = { car: carIndex, lane };
      const unit = E.unitAt(battle, pos, true);
      const key = `${carIndex}:${lane}`;
      let classes = "battle-cell";
      if (unit?.uid === selectedActor) classes += " selected";
      if (targetCells.has(key) || (unit && targetAllies.has(unit.uid))) classes += " selectable";
      if (unit && targetEnemies.has(unit.uid)) classes += " targetable";
      if (intentCells.has(key) || intentCars.has(carIndex)) classes += " intent-target";
      if (lesson === 1 && unit?.id === "kureha") classes += " tutorial-focus";
      if (lesson === 3 && targetCells.has(key)) classes += " tutorial-focus";
      if (lesson === 4 && unit?.id === "sui") classes += " tutorial-focus";
      if (lesson === 6 && unit && targetEnemies.has(unit.uid)) classes += " tutorial-focus";
      if (lesson === 9 && unit?.id === "gaku") classes += " tutorial-focus";
      if (lesson === 11 && unit && targetEnemies.has(unit.uid)) classes += " tutorial-focus";
      const unitHtml = unit ? renderUnit(unit, battle) : (battle.mines.some(mine => `${mine.pos.car}:${mine.pos.lane}` === key) ? `<span aria-label="設置爆薬">◆</span>` : "");
      const blocked = lesson < 12 && !((lesson === 1 && unit?.id === "kureha") || (lesson === 3 && targetCells.has(key)) || (lesson === 4 && unit?.id === "sui") || (lesson === 6 && unit && targetEnemies.has(unit.uid)) || (lesson === 9 && unit?.id === "gaku") || (lesson === 11 && unit && targetEnemies.has(unit.uid)));
      return `<button class="${classes}" data-car="${carIndex}" data-lane="${lane}" aria-label="${carIndex + 1}両目 ${DATA.lanes[lane]}" ${blocked ? "disabled" : ""}>${unitHtml}</button>`;
    }).join("")}</div>`).join("");
    const carLabels = battle.cars.map((car, index) => {
      const percent = Math.max(0, car.hp / car.maxHp * 100);
      return `<button class="car-label ${targetCars.has(index) ? "selectable" : ""}" data-car-target="${index}" style="--car-color:${DATA.cars[car.type].color}"><b>${escapeHtml(DATA.cars[car.type].name)}</b><span>${car.hp}/${car.maxHp}${car.barrier ? ` +壁${car.barrier}` : ""}</span><div class="hp-bar ${percent < 35 ? "low" : ""}"><i style="width:${percent}%"></i></div></button>`;
    }).join("");
    const steam = Array.from({ length: battle.maxSteam }, (_, index) => `<i class="steam-pip ${index < battle.steam ? "on" : ""}"></i>`).join("");
    const actorDef = actor ? DATA.crew[actor.id] : null;
    app.innerHTML = `
      <section class="screen battle-screen" style="--battle-art:url('${chapterArt(encounter.chapter)}')">
        <div class="battle-head">
          <div class="objective-box">${icon("i-target")}<span><small>勝利条件</small><b>${escapeHtml(encounter.objective.text)}</b></span></div>
          <div class="round-box"><small>ROUND</small><b>${battle.round}</b></div>
          <div class="steam-box ${lesson === 8 ? "tutorial-focus" : ""}" aria-label="蒸気 ${battle.steam}/${battle.maxSteam}">${icon("i-steam")}${steam}</div>
        </div>
        ${isFirstLesson ? renderBattleCoach(lesson) : ""}
        <div class="intent-strip ${lesson === 0 ? "tutorial-focus" : ""}" aria-label="敵の次行動">${intentHtml || `<div class="intent-card"><b>敵影なし</b><small>増援に備えよ</small></div>`}</div>
        ${battle.cars.length > 4 ? `<p class="board-scroll-hint">列車盤面は横にスワイプして確認できます →</p>` : ""}
        <div class="battle-field" style="--car-count:${battle.cars.length}">
          <div class="battle-landscape"></div>
          <img class="battle-train-art" src="${ART.train}" alt="黎明列車の三層車内">
          <div class="lane-labels">${DATA.lanes.map(label => `<span class="lane-label">${label}</span>`).join("")}</div>
          <div class="train-board">${rows}</div>
          <div class="car-labels">${carLabels}</div>
        </div>
        <div class="battle-bottom">
          <div class="unit-panel ${lesson === 1 ? "tutorial-focus" : ""}">
            ${actor ? `<img src="${ART.portraits[actor.id]}" alt=""><div><h3>${escapeHtml(actorDef.name)} <small>${escapeHtml(actorDef.role)}</small></h3><div class="unit-stats"><span>HP ${actor.hp}/${actor.maxHp}</span><span>AP ${actor.ap}/${actor.maxAp}</span><span>障壁 ${actor.shield}</span></div><p>${escapeHtml(actorDef.passive.name)}：${escapeHtml(actorDef.passive.text)}</p></div>` : `<div class="empty-unit">${icon("i-arrow")}<p>車内の乗員を選択してください</p></div>`}
          </div>
          <div class="action-panel">
            <div class="action-grid">${actions.map((action, index) => { const allowed = lesson >= 12 || (lesson === 2 && action.key === "move") || (lesson === 5 && action.key === "attack") || (lesson === 10 && action.key === "operate"); return `<button class="action-button ${selectedAction === action.key ? "active" : ""} ${(lesson === 2 && action.key === "move") || (lesson === 5 && action.key === "attack") || (lesson === 10 && action.key === "operate") ? "tutorial-focus" : ""}" data-action="${action.key}" ${(action.enabled && allowed) ? "" : "disabled"}><i>${index + 1}</i>${actionIcon(action.key)}<span>${escapeHtml(action.name)}<small>${action.cooldown ? `再使用 ${action.cooldown}R` : `${action.ap}AP${action.steam ? `・蒸気${action.steam}` : ""}`}</small></span></button>`; }).join("")}</div>
            <div class="battle-controls"><button id="cancelAction" class="secondary-button" ${selectedAction && lesson >= 12 ? "" : "disabled"}>選択解除</button><button id="undoMove" class="secondary-button" ${battle.undo && lesson >= 12 ? "" : "disabled"}>移動取消</button><button id="endTurn" class="primary-button ${lesson === 7 ? "tutorial-focus" : ""}" ${lesson < 12 && lesson !== 7 ? "disabled" : ""}>ターン終了 <kbd>E</kbd></button></div>
          </div>
        <div class="battle-log" aria-label="戦闘記録"><small>戦闘ログ</small>${battle.log.slice(0, 5).map(item => `<p>${escapeHtml(item.text)}</p>`).join("")}</div>
        </div>
      </section>`;
    app.querySelectorAll(".battle-cell").forEach(cell => cell.addEventListener("click", () => handleCellClick(Number(cell.dataset.car), Number(cell.dataset.lane))));
    app.querySelectorAll(".car-label").forEach(label => label.addEventListener("click", () => handleCarTarget(Number(label.dataset.carTarget))));
    app.querySelectorAll(".action-button").forEach(button => button.addEventListener("click", () => chooseAction(button.dataset.action)));
    document.getElementById("cancelAction").addEventListener("click", () => { selectedAction = null; renderBattle(); });
    document.getElementById("undoMove").addEventListener("click", () => {
      const result = E.undoMove(game.battle);
      if (!result.ok) return showToast(result.error, "error");
      DT.audio.play("cancel");
      saveGame();
      renderBattle();
    });
    document.getElementById("endTurn").addEventListener("click", requestEndTurn);
    document.getElementById("lessonAdvance")?.addEventListener("click", () => {
      game.guidance.battle = lesson === 0 ? 1 : 9;
      if (lesson === 0) selectedActor = null;
      saveGame();
      renderBattle();
    });
    revealBossIfNeeded(battle, encounter);
  }

  function renderBattleCoach(stage) {
    const content = [
      ["攻撃予告を見る", "赤く脈打つ車内区画が、敵が次に攻撃する場所です。敵はターン終了後、表示どおりに動きます。", "予告を確認した"],
      ["乗員を選ぶ", "光っているクレハを車内で押してください。選んだ乗員の顔、HP、AP、行動メニューが下に表示されます。", ""],
      ["移動を指示する", "行動にはAPを使います。まず「移動」を押すと、移れる区画だけが明るくなります。", ""],
      ["移動先を決める", "明るくなった空き区画を押してください。「移動」を選んだだけでは、まだAPを使いません。", ""],
      ["別の乗員へ指示する", "退避できました。次は右下の通路にいる医師スイを押してください。乗員は一手ごとに自由に切り替えられます。", ""],
      ["攻撃を選ぶ", "スイは敵の隣にいます。「攻撃」を押すと、届く範囲にいる敵だけが赤く表示されます。", ""],
      ["攻撃する敵を決める", "赤く光る敵を押してください。敵のHPは足元に、攻撃の結果は戦闘ログに表示されます。", ""],
      ["敵の行動を確認する", "今回は「ターン終了」を押してください。敵が予告どおりに動き、次のラウンドが始まります。", ""],
      ["蒸気は全員で共有する", "ラウンドが変わり、蒸気が3から5へ増えました。固有技と車両の装置は、この蒸気を共通で使います。必要な量は各ボタンに表示されます。", "車両の装置を試す"],
      ["ガクを選ぶ", "中央通路にいるガクを押してください。乗員がいる車両の装置は、その乗員の行動メニューに追加されます。", ""],
      ["砲台車の主砲を起動する", "ガクは砲台車にいます。「主砲」は1APと共有蒸気2を使い、距離に関係なく敵を狙えます。", ""],
      ["主砲で敵を狙う", "赤く表示された敵を押してください。蒸気が減り、敵にダメージが入れば操作ガイドは完了です。", ""]
    ][stage];
    return `<aside class="field-guide battle-guide"><span>操作ガイド ${Math.min(stage + 1, 12)}/12</span><b>${content[0]}</b><p>${content[1]}</p>${content[2] ? `<button id="lessonAdvance" class="guide-button">${content[2]}</button>` : ""}</aside>`;
  }

  function revealBossIfNeeded(battle, encounter) {
    if (encounter.objective.type !== "boss") return;
    const boss = battle.enemies.find(enemy => DATA.enemies[enemy.type]?.boss);
    if (!boss || game.guidance.bosses[boss.type]) return;
    game.guidance.bosses[boss.type] = true;
    saveGame();
    openModal(`<div class="boss-reveal"><img src="${ART.bosses[boss.type]}" alt="${escapeHtml(DATA.enemies[boss.type].name)}"><div><p class="title-kicker">NIGHT ${encounter.chapter} / MAJOR THREAT</p><h2>${escapeHtml(DATA.enemies[boss.type].name)}</h2><p>${escapeHtml(encounter.intro)}</p><button class="primary-button modal-close">戦闘を始める</button></div></div>`);
  }

  function renderUnit(unit, battle) {
    const isEnemy = unit.uid.startsWith("enemy_");
    const def = isEnemy ? DATA.enemies[unit.type] : DATA.crew[unit.id];
    const percent = Math.max(0, unit.hp / unit.maxHp * 100);
    const portrait = isEnemy && def.boss ? ART.bosses[unit.type] : !isEnemy ? ART.portraits[unit.id] : null;
    const figure = portrait ? `<img src="${portrait}" alt="">` : renderEnemyFigure(unit.type);
    return `<span class="unit ${isEnemy ? "enemy" : "crew"} ${unit.hp <= 0 ? "down" : ""}" style="--unit-color:${def.color}" title="${escapeHtml(def.name)}">${figure}<b>${escapeHtml(def.name)}</b><i class="unit-hp"><i style="width:${percent}%"></i></i>${!isEnemy && unit.hp > 0 ? `<i class="unit-ap">${unit.ap}<small>AP</small></i>` : ""}</span>`;
  }

  function renderEnemyFigure(type) {
    const figures = {
      raider: `<path d="M25 82 30 43l9-11 13 4 7 46-13 7-7-24-4 25Z"/><path class="enemy-tool" d="m50 48 18-27 5 5-13 31M31 31l-8-14"/>`,
      gunner: `<path d="M26 85 29 44l12-12 14 7 2 43-12 8-8-27-3 27Z"/><path class="enemy-tool" d="M12 47h54l7 6-37 3-19 12"/>`,
      saboteur: `<path d="m19 82 7-37 13-12 17 8 7 41-14 8-8-22-8 22Z"/><path class="enemy-tool" d="M49 52h20v21H49zM54 52v-8h10v8m-5-8v-9"/>`,
      leech: `<path d="M9 59c9-28 21-35 33-15 9-22 24-11 29 14-10 23-25 28-32 8-8 19-22 14-30-7Z"/><path class="enemy-tool" d="m17 48-11-9m17 31L9 82m48-31 15-9M56 70l13 13M33 43 28 23m20 22 3-21"/>`,
      armor: `<path d="m17 82 5-48 18-16 19 15 5 49-18 9-6-25-6 25Z"/><path class="enemy-tool" d="M41 38 63 27l10 14-6 34-25-13ZM26 35l-13-9v34"/>`,
      parasite: `<path d="M19 78c3-25 11-40 23-40s20 15 20 40l-20 12-23-12Z"/><path class="enemy-tool" d="M42 41V13m0 5L27 7m15 12L58 5M25 59 8 45m51 14 14-16M29 76 13 91m42-15 14 15"/><circle cx="42" cy="49" r="7"/>`,
      signaler: `<path d="m25 84 4-45 13-9 14 9 3 45-14 7-5-27-3 27Z"/><path class="enemy-tool" d="M43 30V8m-9 9 9-9 9 9M19 47 8 35m55 12 10-12"/><circle cx="43" cy="8" r="3"/>`,
      bomber: `<path d="M18 81 25 43l15-11 16 8 7 41-16 9-7-25-5 25Z"/><circle class="enemy-tool" cx="60" cy="57" r="15"/><path class="enemy-tool" d="m60 42 3-12 8-4m-7 31h-8m4-4v8"/>`
    };
    return `<svg class="enemy-figure enemy-${escapeHtml(type)}" viewBox="0 0 80 96" aria-hidden="true">${figures[type] || figures.raider}</svg>`;
  }

  function chooseAction(actionKey) {
    const battle = game.battle;
    const actor = battle.crew.find(unit => unit.uid === selectedActor);
    if (!actor) return;
    const action = E.getActions(battle, actor.uid).find(item => item.key === actionKey);
    if (!action?.enabled) return;
    const targets = E.getTargets(battle, actor.uid, actionKey);
    if (action.targetType === "none") return executeBattleAction(actionKey, null);
    if (!targets.length) return showToast("有効な対象がありません", "error");
    selectedAction = selectedAction === actionKey ? null : actionKey;
    if (["c1_safe", "c1_risky"].includes(battle.encounterId) && game.guidance?.battle === 2 && actionKey === "move" && selectedAction) game.guidance.battle = 3;
    if (["c1_safe", "c1_risky"].includes(battle.encounterId) && game.guidance?.battle === 5 && actionKey === "attack" && selectedAction) game.guidance.battle = 6;
    if (["c1_safe", "c1_risky"].includes(battle.encounterId) && game.guidance?.battle === 10 && actionKey === "operate" && selectedAction) game.guidance.battle = 11;
    DT.audio.play("confirm");
    saveGame();
    renderBattle();
  }

  function handleCellClick(car, lane) {
    const battle = game.battle;
    const pos = { car, lane };
    const unit = E.unitAt(battle, pos, true);
    if (selectedAction && selectedActor) {
      const action = E.getActions(battle, selectedActor).find(item => item.key === selectedAction);
      if (action?.targetType === "cell") return executeBattleAction(selectedAction, { type: "cell", pos });
      if (action?.targetType === "enemy" && unit?.uid.startsWith("enemy_")) return executeBattleAction(selectedAction, { type: "enemy", id: unit.uid });
      if (action?.targetType === "ally" && unit?.uid.startsWith("crew_")) return executeBattleAction(selectedAction, { type: "ally", id: unit.uid });
    }
    if (unit?.uid.startsWith("crew_") && unit.hp > 0) {
      selectedActor = unit.uid;
      selectedAction = null;
      if (["c1_safe", "c1_risky"].includes(battle.encounterId) && game.guidance?.battle === 1) game.guidance.battle = 2;
      if (["c1_safe", "c1_risky"].includes(battle.encounterId) && game.guidance?.battle === 4 && unit.id === "sui") game.guidance.battle = 5;
      if (["c1_safe", "c1_risky"].includes(battle.encounterId) && game.guidance?.battle === 9 && unit.id === "gaku") game.guidance.battle = 10;
      DT.audio.play("confirm");
      saveGame();
      renderBattle();
    } else if (unit?.uid.startsWith("enemy_")) {
      showToast(`${DATA.enemies[unit.type].name} HP ${unit.hp}/${unit.maxHp}・装甲${unit.armor || 0}・障壁${unit.shield || 0}`);
    }
  }

  function handleCarTarget(index) {
    if (!selectedAction || !selectedActor) return;
    const action = E.getActions(game.battle, selectedActor).find(item => item.key === selectedAction);
    if (action?.targetType === "car") executeBattleAction(selectedAction, { type: "car", index });
  }

  function executeBattleAction(actionKey, target) {
    const result = E.performAction(game.battle, selectedActor, actionKey, target);
    if (!result.ok) return showToast(result.error, "error");
    if (actionKey === "move") { DT.audio.play("move"); triggerFx("move"); }
    else if (actionKey === "repair" || actionKey.includes("overrepair")) { DT.audio.play("repair"); triggerFx("repair"); }
    else if (actionKey === "operate") { DT.audio.play("steam"); triggerFx("steam"); }
    else { DT.audio.play("attack"); triggerFx("attack"); }
    if (["c1_safe", "c1_risky"].includes(game.battle.encounterId) && game.guidance?.battle === 3 && actionKey === "move") game.guidance.battle = 4;
    if (["c1_safe", "c1_risky"].includes(game.battle.encounterId) && game.guidance?.battle === 6 && actionKey === "attack") game.guidance.battle = 7;
    if (["c1_safe", "c1_risky"].includes(game.battle.encounterId) && game.guidance?.battle === 11 && actionKey === "operate") game.guidance.battle = 12;
    selectedAction = null;
    const current = game.battle.crew.find(unit => unit.uid === selectedActor);
    if (!current || current.ap <= 0) selectedActor = game.battle.crew.find(unit => unit.hp > 0 && unit.ap > 0)?.uid || selectedActor;
    saveGame();
    if (game.battle.phase === "victory") return resolveVictory();
    if (game.battle.phase === "defeat") return renderDefeat();
    renderBattle();
  }

  function requestEndTurn() {
    if (["c1_safe", "c1_risky"].includes(game.battle.encounterId) && game.guidance?.battle === 7) return executeEndTurn();
    const remaining = game.battle.crew.reduce((sum, unit) => sum + (unit.hp > 0 ? unit.ap : 0), 0);
    if (settings.confirmTurn && remaining > 0) {
      confirmModal("ターンを終了しますか？", `未使用のAPが${remaining}残っています。`, executeEndTurn);
    } else executeEndTurn();
  }

  function executeEndTurn() {
    closeModal();
    const result = E.endPlayerTurn(game.battle);
    if (!result.ok) return showToast(result.error, "error");
    if (["c1_safe", "c1_risky"].includes(game.battle.encounterId) && game.guidance?.battle === 7) game.guidance.battle = 8;
    DT.audio.play("hit");
    triggerFx("hit");
    selectedAction = null;
    selectedActor = game.battle.crew.find(unit => unit.hp > 0 && unit.ap > 0)?.uid || null;
    saveGame();
    if (game.battle.phase === "victory") return resolveVictory();
    if (game.battle.phase === "defeat") return renderDefeat();
    renderBattle();
  }

  function resolveVictory() {
    DT.audio.play("victory");
    const result = E.completeBattle(game);
    if (!result.ok) return showToast(result.error, "error");
    saveGame();
    renderBattleResult(result.result);
  }

  function rewardLabel(item) {
    const labels = { scrap: "部品", fuel: "燃料", medkits: "医療品", morale: "士気" };
    if (item.key === "car") return `${DATA.cars[item.id].name}の設計図を解禁`;
    if (item.key === "record") return "制御記録を回収";
    return `${labels[item.key] || item.key} +${item.amount}`;
  }

  function renderBattleResult(result) {
    setView("result");
    showTopbar(true);
    const encounter = DATA.encounters[result.encounterId];
    app.innerHTML = `
      <section class="screen result-screen"><div class="result-backdrop"></div><div class="result-card">
        <div class="result-seal">戦闘<br>勝利</div><p class="title-kicker">MISSION COMPLETE</p>
        <h1>${escapeHtml(encounter.name)}</h1><p>${result.round}ラウンドで勝利</p>
        <div class="reward-list">${result.rewards.length ? result.rewards.map(item => `<div class="reward-item"><small>獲得</small><b>${escapeHtml(rewardLabel(item))}</b></div>`).join("") : `<div class="reward-item"><small>獲得</small><b>なし</b></div>`}</div>
        <button id="resultContinue" class="primary-button">列車に戻る</button>
      </div></section>`;
    document.getElementById("resultContinue").addEventListener("click", renderJourney);
  }

  function renderDefeat() {
    setView("defeat");
    showTopbar(true);
    DT.audio.play("defeat");
    const battle = game.battle;
    const retries = game.stats.retries[battle.encounterId] || 0;
    app.innerHTML = `
      <section class="screen result-screen"><div class="panel result-card">
        <div class="result-seal" style="border-color:var(--bad);color:#ffb5b8">敗</div>
        <p class="title-kicker">OPERATION FAILED</p><h1>走行不能</h1>
        <p>戦闘を始める直前の状態からやり直せます。旅の進み具合は失われません。</p>
        ${retries >= 2 ? `<p>一時支援を利用できます。この戦闘だけ敵の最大HPが15%下がります。物語や報酬は変わりません。</p>` : ""}
        <button id="retryButton" class="primary-button">この戦闘をやり直す</button>
        ${retries >= 2 ? `<button id="assistRetryButton" class="secondary-button" style="margin-top:9px">一時支援を使ってやり直す</button>` : ""}
        <button id="loadBackupButton" class="secondary-button" style="margin-top:9px">章開始バックアップへ戻る</button>
      </div></section>`;
    document.getElementById("retryButton").addEventListener("click", () => {
      const result = E.retryBattle(game, false);
      if (!result.ok) return showToast(result.error, "error");
      selectedActor = game.battle.crew[0]?.uid || null;
      selectedAction = null;
      saveGame();
      renderBattle();
    });
    document.getElementById("assistRetryButton")?.addEventListener("click", () => {
      const result = E.retryBattle(game, true);
      if (!result.ok) return showToast(result.error, "error");
      selectedActor = game.battle.crew[0]?.uid || null;
      selectedAction = null;
      saveGame();
      renderBattle();
      showToast("一時支援：敵の最大HP −15%");
    });
    document.getElementById("loadBackupButton").addEventListener("click", () => restoreBackup(true));
  }

  function renderGarage(asStep = false) {
    setView("garage");
    showTopbar(true);
    ensureGuidance(game);
    const lockedByLesson = !game.guidance.garage;
    const freeRepair = !game.guidance.garageRepair;
    const carCards = game.train.map((car, index) => {
      const def = DATA.cars[car.type];
      const upgradeCost = 4 + car.level * 3;
      return `<div class="garage-card"><div class="garage-icon" style="--card-color:${def.color}">${icon("i-rail")}</div><div><small>${String(index + 1).padStart(2, "0")} / CAR INSPECTION</small><h4>${escapeHtml(def.name)} <i>Lv.${car.level}</i></h4><p>耐久 ${car.hp}/${car.maxHp}　${escapeHtml(def.operation?.text || "")}</p><div class="garage-hp"><i style="width:${Math.max(0, car.hp / car.maxHp * 100)}%"></i></div></div><div class="garage-buttons"><button class="tiny-button car-left" data-uid="${car.uid}" ${lockedByLesson || index <= 1 || car.type === "engine" ? "disabled" : ""}>← 前へ</button><button class="tiny-button car-right" data-uid="${car.uid}" ${lockedByLesson || index >= game.train.length - 1 || car.type === "engine" ? "disabled" : ""}>後ろへ →</button><button class="tiny-button car-repair ${freeRepair && car.hp < car.maxHp ? "tutorial-focus" : ""}" data-uid="${car.uid}" ${lockedByLesson || car.hp >= car.maxHp || (!freeRepair && game.resources.scrap <= 0) ? "disabled" : ""}>${freeRepair ? "初回無料修理" : "部品1で修理"}</button><button class="tiny-button car-upgrade" data-uid="${car.uid}" ${lockedByLesson || car.level >= 3 || game.resources.scrap < upgradeCost ? "disabled" : ""}>強化 ${upgradeCost}</button><button class="tiny-button car-refit" data-uid="${car.uid}" ${lockedByLesson || car.type === "engine" ? "disabled" : ""}>換装</button></div></div>`;
    }).join("");
    const crewCards = Object.values(game.crew).map(member => {
      const def = DATA.crew[member.id];
      const active = game.activeCrew.includes(member.id);
      return `<div class="garage-card crew-card ${active ? "" : "inactive"}"><img class="garage-portrait" src="${ART.portraits[member.id]}" alt=""><div><small>${active ? "ACTIVE CREW" : "RESERVE"}</small><h4>${escapeHtml(def.name)} <i>Lv.${member.level}</i></h4><p>HP ${member.hp}/${member.maxHp}　${escapeHtml(def.role)}　${escapeHtml(def.passive.name)}</p></div><div class="garage-buttons"><button class="tiny-button crew-toggle" data-id="${member.id}" ${lockedByLesson ? "disabled" : ""}>${active ? "待機へ" : "出撃へ"}</button><button class="tiny-button crew-heal" data-id="${member.id}" ${lockedByLesson || member.hp >= member.maxHp || game.resources.medkits <= 0 ? "disabled" : ""}>医療1で治療</button></div></div>`;
    }).join("");
    app.innerHTML = `
      <section class="screen garage-screen">
        <div class="garage-hero"><div><p class="eyebrow">ROLLING WORKSHOP</p><h1>車内整備</h1><p>戦闘の傷は残る。部品で車両を、医療品で乗員を回復し、次の出撃編成を決める。</p></div><img src="${ART.train}" alt="黎明列車の車内断面"></div>
        ${lockedByLesson ? `<div class="field-guide garage-guide"><span>整備ガイド</span><b>車両と乗員のダメージは、次の戦闘にも持ち越されます。</b><p>車両は部品で修理し、乗員は医療品で治療します。車両の並びは戦闘画面と同じで、出撃できる乗員は最大4人です。${freeRepair ? "最初の修理だけは部品を使いません。損傷した車両を一度直してみましょう。" : "修理する前に、部品と医療品の残りを確認しましょう。"}</p><button id="garageLesson" class="guide-button">整備を始める</button></div>` : ""}
        <div class="garage-layout"><div class="garage-panel"><h3><span>01</span> 車両編成</h3><div class="car-list">${carCards}</div></div><div class="garage-panel"><h3><span>02</span> 乗員編成</h3><div class="crew-list">${crewCards}</div></div></div>
        <div class="garage-footer"><button id="garageBack" class="secondary-button">列車に戻る</button>${asStep ? `<button id="garageProceed" class="primary-button">整備を終える</button>` : ""}</div>
      </section>`;
    app.querySelectorAll(".car-left").forEach(button => button.addEventListener("click", () => garageAction(() => E.moveCar(game, button.dataset.uid, -1), asStep)));
    app.querySelectorAll(".car-right").forEach(button => button.addEventListener("click", () => garageAction(() => E.moveCar(game, button.dataset.uid, 1), asStep)));
    app.querySelectorAll(".car-repair").forEach(button => button.addEventListener("click", () => garageAction(() => repairCarWithLesson(button.dataset.uid), asStep, "repair")));
    app.querySelectorAll(".car-upgrade").forEach(button => button.addEventListener("click", () => garageAction(() => E.upgradeCar(game, button.dataset.uid), asStep, "repair")));
    app.querySelectorAll(".car-refit").forEach(button => button.addEventListener("click", () => openRefitModal(button.dataset.uid, asStep)));
    app.querySelectorAll(".crew-toggle").forEach(button => button.addEventListener("click", () => garageAction(() => E.toggleActiveCrew(game, button.dataset.id), asStep)));
    app.querySelectorAll(".crew-heal").forEach(button => button.addEventListener("click", () => garageAction(() => E.healPersistentCrew(game, button.dataset.id), asStep, "repair")));
    document.getElementById("garageBack").addEventListener("click", renderJourney);
    document.getElementById("garageProceed")?.addEventListener("click", () => {
      const result = E.completeGarage(game);
      if (!result.ok) return showToast(result.error, "error");
      saveGame();
      renderJourney();
    });
    document.getElementById("garageLesson")?.addEventListener("click", () => {
      game.guidance.garage = true;
      DT.audio.play("paper");
      saveGame();
      renderGarage(asStep);
    });
  }

  function garageAction(action, asStep, sound = "confirm") {
    const result = action();
    if (!result.ok) return showToast(result.error, "error");
    DT.audio.play(sound);
    if (sound === "repair") triggerFx("repair");
    if (result.free) showToast(`初回修理：耐久を${result.amount}回復しました（部品消費なし）`);
    saveGame();
    renderGarage(asStep);
  }

  function repairCarWithLesson(uid) {
    if (game.guidance.garageRepair) return E.repairPersistentCar(game, uid);
    const car = game.train.find(item => item.uid === uid);
    if (!car) return { ok: false, error: "車両がありません" };
    if (car.hp >= car.maxHp) return { ok: false, error: "損傷はありません" };
    const amount = Math.min(4, car.maxHp - car.hp);
    car.hp += amount;
    game.guidance.garageRepair = true;
    game.updatedAt = Date.now();
    return { ok: true, amount, free: true };
  }

  function openRefitModal(uid, asStep) {
    const car = game.train.find(item => item.uid === uid);
    if (!car) return;
    const choices = game.unlockedCars.filter(type => type !== "engine" && type !== car.type).map(type => {
      const def = DATA.cars[type];
      return `<button class="choice-button refit-choice" data-type="${type}" ${game.resources.scrap < 4 ? "disabled" : ""}><b>${escapeHtml(def.name)}</b><small>${escapeHtml(def.operation?.text || "")}・部品4</small></button>`;
    }).join("");
    openModal(`<h2>${escapeHtml(DATA.cars[car.type].name)}を換装</h2><p>車両レベルは1に戻り、現在の耐久割合を引き継ぎます。</p><div class="choice-list">${choices || `<p>ほかの設計図がありません。</p>`}</div><div class="modal-actions"><button class="secondary-button modal-close">戻る</button></div>`);
    modalRoot.querySelectorAll(".refit-choice").forEach(button => button.addEventListener("click", () => {
      const result = E.refitCar(game, uid, button.dataset.type);
      if (!result.ok) return showToast(result.error, "error");
      saveGame();
      closeModal();
      DT.audio.play("repair");
      renderGarage(asStep);
    }));
  }

  function renderUpgrade() {
    setView("upgrade");
    showTopbar(true);
    const step = E.getStep(game);
    ensureGuidance(game);
    const lockedByLesson = !game.guidance.upgrade;
    const cards = step.options.map(id => {
      const upgrade = DATA.upgrades[id];
      const level = game.upgrades.filter(item => item === id).length;
      const maxed = level >= 2;
      return `<button class="route-choice-card upgrade-choice" data-upgrade="${id}" ${maxed || lockedByLesson ? "disabled" : ""}><span class="tag reward">現在 Lv.${level}</span><h2>${escapeHtml(upgrade.name)}</h2><p>${escapeHtml(upgrade.text)}</p><div class="route-reward"><span class="tag">強化後 Lv.${Math.min(2, level + 1)}</span></div></button>`;
    }).join("");
    app.innerHTML = `<section class="screen upgrade-screen"><div class="screen-heading"><div><p class="eyebrow">PERMANENT UPGRADE</p><h1>列車強化</h1><p>旅の終わりまで有効な強化を一つ選びます。同じ強化は2段階まで選べます。</p></div></div>${lockedByLesson ? `<div class="field-guide"><span>列車強化ガイド</span><b>ここで選んだ効果は、旅の終わりまで続きます。</b><p>資源は使いませんが、一度選ぶと変更できません。「現在」と「強化後」を見比べて選びましょう。</p><button id="upgradeLesson" class="guide-button">強化内容を確認する</button></div>` : ""}<div class="route-choice-grid">${cards}</div></section>`;
    app.querySelectorAll(".upgrade-choice").forEach(button => button.addEventListener("click", () => {
      const upgrade = DATA.upgrades[button.dataset.upgrade];
      confirmModal(`${upgrade.name}を選びますか？`, upgrade.text, () => {
        const result = E.applyUpgrade(game, upgrade.id);
        if (!result.ok) return showToast(result.error, "error");
        saveGame();
        DT.audio.play("victory");
        renderJourney();
      });
    }));
    document.getElementById("upgradeLesson")?.addEventListener("click", () => {
      game.guidance.upgrade = true;
      DT.audio.play("paper");
      saveGame();
      renderUpgrade();
    });
  }

  function renderEpilogue() {
    game.completed = true;
    game.updatedAt = Date.now();
    saveGame();
    setView("epilogue");
    showTopbar(false);
    DT.audio.stopRail();
    DT.audio.play("victory");
    const endingData = {
      ignite: ["点火", "東端灯台から朝が放たれた。避難灯は一度消えたが、列車が結んだ地域から人々が互いを支え、朝は七夜かけて西へ広がった。"],
      divide: ["分灯", "暁核は七つの灯へ分けられた。世界は夜のままだが、孤立していた街は同じ時間を分け合い、次の解決を探す猶予を得た。"],
      weave: ["編光", "制御記録から新しい命令が送られた。夜蝕は光を奪う雲から、街と街をつなぐ薄明の網へ変わった。夜と朝の境界は、人々の手へ戻った。"]
    };
    const ending = endingData[game.ending] || endingData.ignite;
    const rescued = game.rescued.length;
    const crewNames = Object.keys(game.crew).map(id => DATA.crew[id].name).join("、");
    const time = formatTime(game.stats.playSeconds);
    const epilogues = buildEpilogueCards(game).map(card => `<article class="epilogue-card"><small>${escapeHtml(card.kicker)}</small><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.text)}</p></article>`).join("");
    app.innerHTML = `<section class="epilogue-screen" style="--ending-art:url('${ART.endings[game.ending] || ART.endings.ignite}')"><div class="ending-art"></div><article class="ending-ledger"><p class="title-kicker">JOURNEY COMPLETE</p><h1>${escapeHtml(ending[0])}</h1><p class="story-text">${escapeHtml(ending[1])}</p><div class="epilogue-grid">${epilogues}</div><div class="reward-list"><div class="reward-item"><small>同行者</small><b>${Object.keys(game.crew).length}人</b></div><div class="reward-item"><small>救助地域</small><b>${rescued}</b></div><div class="reward-item"><small>勝利</small><b>${game.stats.battlesWon}</b></div><div class="reward-item"><small>旅の時間</small><b>${time}</b></div></div><p>黎明列車の乗員：${escapeHtml(crewNames)}</p><p>列車は役目を終えたが、その車両は新しい路線の最初の駅になった。</p><button id="creditsButton" class="primary-button">旅の記録とクレジット</button><button id="epilogueTitle" class="secondary-button">タイトルへ戻る</button></article></section>`;
    document.getElementById("creditsButton").addEventListener("click", () => openModal(`<h2>旅の記録</h2><p>結末: ${escapeHtml(ending[0])}<br>同行者: ${Object.keys(game.crew).length}人<br>救助: ${rescued}地域<br>制御記録: ${game.records.length}<br>勝利した戦闘: ${game.stats.battlesWon}<br>敗北: ${game.stats.battlesLost}<br>倒した敵: ${game.stats.enemiesDefeated}<br>総ラウンド: ${game.stats.turns}<br>プレイ時間: ${time}</p><h2>制作</h2><p>企画・実装・文章・音響: rirtir.com / Codex<br>ビジュアル: OpenAI image generationによる本作専用アート、HTML/CSS/SVG演出<br>音楽・効果音: 外部素材を使わず、本作専用に設計・合成したオリジナル音源</p><div class="modal-actions"><button class="primary-button modal-close">閉じる</button></div>`));
    document.getElementById("epilogueTitle").addEventListener("click", renderTitle);
  }

  function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }

  function buildEpilogueCards(state) {
    return [
      state.flags.c1_rescue
        ? { kicker: "灰の始発駅", title: "消えなかった信号", text: "信号所から救われた保線員は、西へ届く最初の復旧列車を走らせた。" }
        : { kicker: "灰の始発駅", title: "定刻の出発", text: "残された燃料は後続の避難車へ渡り、灰の駅から最後の一編成が出発できた。" },
      state.flags.c2_hospital_saved
        ? { kicker: "運河都市", title: "水上診療所", text: "搬送された患者とスイの記録から、運河を巡る診療艇が生まれた。" }
        : { kicker: "運河都市", title: "水門を守る人々", text: "救われた作業員たちは水門を維持し、沈みかけた街に帰れる区画を増やした。" },
      state.flags.c3_recorded
        ? { kicker: "鉄喰いの森", title: "森との交信", text: "テトは回収した信号から、金属樹海を線路の補修へ導く方法を見つけた。" }
        : { kicker: "鉄喰いの森", title: "新しい苗床", text: "焼けた苗床の跡には、人の道を避けて育つ新しい金属樹が植えられた。" },
      state.flags.c4_truth_kept
        ? { kicker: "黒晶坑道", title: "公開された記録", text: "ガクの切断命令を含む全記録は公開され、塔の再建は一人で決められない仕組みに変わった。" }
        : { kicker: "黒晶坑道", title: "坑道の記憶", text: "残された記録庫を守るため、リッカたちは黒晶の奥に小さな資料館を作った。" },
      state.flags.c5_helped_alba
        ? { kicker: "白夜氷原", title: "二本の暖房線", text: "燃料を分けた二本の列車は、氷原の両端から避難灯を結ぶ定期線になった。" }
        : { kicker: "白夜氷原", title: "自立する灯", text: "氷原の集落は限られた燃料を共有し、どの列車にも依存しない暖房網を築いた。" },
      state.flags.c6_promise
        ? { kicker: "双子首都", title: "白線との協定", text: "イリヤは異なる答えを選んだ街の代表となり、黎明列車との共同評議会を開いた。" }
        : { kicker: "双子首都", title: "競争する二路線", text: "白線と黎明列車の後継線は、互いに監視し競いながらも首都を東西へつないだ。" }
    ];
  }

  function renderCampaignComplete() {
    setView("complete");
    showTopbar(false);
    document.body.style.setProperty("--world-art", `url('${ART.endings[game?.ending] || ART.key}')`);
    app.innerHTML = `<section class="title-screen"><div class="title-lockup"><p class="title-kicker">JOURNEY COMPLETE</p><h1>七夜を越えて<span>黎明列車</span></h1><p class="title-copy">七夜の旅を終えました。旅の記録は自動保存されています。</p><button id="completeTitle" class="primary-button">タイトルへ戻る</button></div></section>`;
    document.getElementById("completeTitle").addEventListener("click", renderTitle);
  }

  function openModal(content) {
    modalRoot.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
    modalRoot.classList.remove("hidden");
    modalRoot.querySelectorAll(".modal-close").forEach(button => button.addEventListener("click", closeModal));
  }

  function closeModal() {
    modalRoot.classList.add("hidden");
    modalRoot.innerHTML = "";
  }

  function confirmModal(title, message, onConfirm) {
    openModal(`<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><div class="modal-actions"><button class="secondary-button modal-close">戻る</button><button id="modalConfirm" class="primary-button">決定</button></div>`);
    document.getElementById("modalConfirm").addEventListener("click", () => { closeModal(); onConfirm(); });
  }

  function openHelp() {
    openModal(`<div class="help-sheet"><p class="eyebrow">CONDUCTOR'S FIELD NOTES</p><h2>車掌手帳</h2><div class="help-grid"><article>${icon("i-target")}<h3>攻撃をかわす</h3><p>赤い区画は、敵が次に攻撃する場所です。乗員を移動させるか、障壁や修理で備えましょう。</p></article><article>${icon("i-steam")}<h3>APと蒸気</h3><p>各乗員は毎ラウンド2APを使えます。蒸気は固有技と車両の装置で共有します。</p></article><article>${icon("i-scrap")}<h3>ダメージは持ち越す</h3><p>車両の損傷と乗員のHPは戦闘後も残ります。停車中に、部品と医療品で回復できます。</p></article><article>${icon("i-rail")}<h3>全7章の旅</h3><p>行動するたびに自動保存されます。各章の開始時には、やり直し用のバックアップも作られます。</p></article></div><p class="key-notes"><kbd>E</kbd> ターン終了　<kbd>Esc</kbd> 選択解除　<kbd>1–6</kbd> 行動選択　<kbd>WASD</kbd> 移動</p>${game ? `<button id="replayGuides" class="secondary-button">操作ガイドを最初から表示</button>` : ""}<div class="modal-actions"><button class="primary-button modal-close">手帳を閉じる</button></div></div>`);
    document.getElementById("replayGuides")?.addEventListener("click", () => {
      game.guidance.route = 0;
      game.guidance.battle = 0;
      game.guidance.choice = false;
      game.guidance.garage = false;
      game.guidance.upgrade = false;
      saveGame();
      closeModal();
      showToast("操作ガイドを最初から表示します");
      if (currentView === "battle") { selectedActor = null; selectedAction = null; renderBattle(); }
      else if (currentView === "garage") renderGarage(false);
      else if (currentView === "upgrade") renderUpgrade();
    });
  }

  function openSettings() {
    openModal(`<h2>設定</h2>
      <div class="settings-row"><label for="settingSound">音声</label><input id="settingSound" type="checkbox" ${settings.sound ? "checked" : ""}></div>
      <div class="settings-row"><label for="settingBgmVolume">BGM音量</label><input id="settingBgmVolume" type="range" min="0" max="1" step="0.05" value="${settings.bgmVolume}"></div>
      <div class="settings-row"><label for="settingSfxVolume">効果音量</label><input id="settingSfxVolume" type="range" min="0" max="1" step="0.05" value="${settings.sfxVolume}"></div>
      <div class="settings-row"><label for="settingMotion">演出を減らす</label><input id="settingMotion" type="checkbox" ${settings.reduceMotion ? "checked" : ""}></div>
      <div class="settings-row"><label for="settingConfirm">APを残してターンを終える時は確認</label><input id="settingConfirm" type="checkbox" ${settings.confirmTurn ? "checked" : ""}></div>
      <div class="modal-actions"><button class="secondary-button modal-close">閉じる</button><button id="saveSettingsButton" class="primary-button">保存</button></div>`);
    document.getElementById("saveSettingsButton").addEventListener("click", () => {
      settings.sound = document.getElementById("settingSound").checked;
      settings.bgmVolume = Number(document.getElementById("settingBgmVolume").value);
      settings.sfxVolume = Number(document.getElementById("settingSfxVolume").value);
      settings.reduceMotion = document.getElementById("settingMotion").checked;
      settings.confirmTurn = document.getElementById("settingConfirm").checked;
      saveSettings();
      closeModal();
      if (settings.sound && currentView !== "title") DT.audio.startRail();
      showToast("設定を保存しました");
    });
  }

  function openSaveManager() {
    const hasBackup = Boolean(localStorage.getItem(BACKUP_KEY));
    openModal(`<h2>セーブ管理</h2><p>進行は行動・選択・各ラウンド開始時に自動保存されます。</p>
      <div class="choice-list"><button id="exportSave" class="choice-button"><b>セーブを書き出す</b><small>JSONファイルとして端末へ保存</small></button><button id="importSave" class="choice-button"><b>セーブを読み込む</b><small>書き出したJSONファイルを選択</small></button><button id="restoreBackup" class="choice-button" ${hasBackup ? "" : "disabled"}><b>章開始バックアップへ戻る</b><small>この章で進めた分を取り消す</small></button></div>
      <input id="importFile" type="file" accept="application/json,.json" class="hidden">
      <div class="modal-actions"><button class="secondary-button modal-close">閉じる</button><button id="deleteSave" class="danger-button">進行を削除</button></div>`);
    document.getElementById("exportSave").addEventListener("click", exportSave);
    document.getElementById("importSave").addEventListener("click", () => document.getElementById("importFile").click());
    document.getElementById("importFile").addEventListener("change", importSave);
    document.getElementById("restoreBackup").addEventListener("click", () => restoreBackup(false));
    document.getElementById("deleteSave").addEventListener("click", () => confirmModal("進行を削除しますか？", "この操作は書き出したセーブがなければ元に戻せません。", () => {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(BACKUP_KEY);
      game = null;
      renderTitle();
    }));
  }

  function exportSave() {
    if (!game) return showToast("書き出せるセーブがありません", "error");
    saveGame();
    const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dawn-train-save-ch${game.chapterIndex + 1}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("セーブを書き出しました");
  }

  async function importSave(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const valid = E.validateGame(parsed);
      if (!valid.ok) throw new Error(valid.error);
      game = parsed;
      saveGame();
      closeModal();
      showToast("セーブを読み込みました");
      resumeGame();
    } catch (error) {
      showToast(`読み込み失敗: ${error.message}`, "error", 5000);
    }
  }

  function restoreBackup(fromDefeat) {
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (!raw) throw new Error("バックアップがありません");
      const parsed = JSON.parse(raw);
      const valid = E.validateGame(parsed);
      if (!valid.ok) throw new Error(valid.error);
      game = parsed;
      saveGame();
      closeModal();
      showToast("章開始時点へ戻りました");
      resumeGame();
    } catch (error) {
      showToast(error.message, "error");
      if (fromDefeat) renderDefeat();
    }
  }

  document.getElementById("brandButton").addEventListener("click", () => {
    if (!game || currentView === "battle") return;
    DT.audio.play("confirm");
    renderJourney();
  });
  document.getElementById("soundButton").addEventListener("click", () => {
    settings.sound = !settings.sound;
    saveSettings();
    if (settings.sound) { DT.audio.ensure(); DT.audio.play("confirm"); if (currentView !== "title") DT.audio.startRail(); }
    showToast(settings.sound ? "サウンド ON" : "サウンド OFF");
  });
  document.getElementById("helpButton").addEventListener("click", openHelp);
  modalRoot.addEventListener("click", event => { if (event.target === modalRoot) closeModal(); });

  window.addEventListener("keydown", event => {
    if (!modalRoot.classList.contains("hidden")) {
      if (event.key === "Escape") closeModal();
      return;
    }
    if (currentView !== "battle" || !game?.battle) return;
    if (event.key.toLowerCase() === "e") { event.preventDefault(); requestEndTurn(); }
    if (event.key === "Escape") { selectedAction = null; renderBattle(); }
    const directions = {
      ArrowLeft: { car: -1, lane: 0 }, a: { car: -1, lane: 0 },
      ArrowRight: { car: 1, lane: 0 }, d: { car: 1, lane: 0 },
      ArrowUp: { car: 0, lane: -1 }, w: { car: 0, lane: -1 },
      ArrowDown: { car: 0, lane: 1 }, s: { car: 0, lane: 1 }
    };
    const direction = directions[event.key] || directions[event.key.toLowerCase()];
    if (direction && selectedActor) {
      const actor = game.battle.crew.find(unit => unit.uid === selectedActor);
      const pos = { car: actor.pos.car + direction.car, lane: actor.pos.lane + direction.lane };
      const target = E.getTargets(game.battle, selectedActor, "move").find(item => item.pos.car === pos.car && item.pos.lane === pos.lane);
      if (target) {
        event.preventDefault();
        selectedAction = null;
        executeBattleAction("move", target);
      }
    }
    const index = Number(event.key) - 1;
    if (index >= 0 && selectedActor) {
      const actions = E.getActions(game.battle, selectedActor);
      if (actions[index]?.enabled) chooseAction(actions[index].key);
    }
  });

  document.addEventListener("visibilitychange", () => {
    updatePlaytime();
    if (game) saveGame();
  });
  window.addEventListener("beforeunload", () => { if (game) saveGame(); });
  window.addEventListener("resize", syncViewportMetrics, { passive: true });
  window.addEventListener("orientationchange", syncViewportMetrics, { passive: true });
  window.addEventListener("pageshow", syncViewportMetrics, { passive: true });
  window.visualViewport?.addEventListener("resize", syncViewportMetrics, { passive: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncViewportMetrics).observe(topbar);

  if (new URLSearchParams(location.search).has("test")) {
    DT.TestApp = {
      setGame(nextGame) {
        const valid = E.validateGame(nextGame);
        if (!valid.ok) throw new Error(valid.error);
        game = nextGame;
        saveGame();
        resumeGame();
      },
      getGame() { return E.clone(game); },
      getView() { return currentView; },
      openCurrentStep
    };
  }

  syncViewportMetrics();
  saveSettings();
  renderTitle();
})(window.DT);
