import { AudioEngine } from './audio.js';
import {
  ACHIEVEMENTS,
  BOSSES,
  CHASSIS,
  DEPTHS,
  GAME_VERSION,
  MODES,
  MODULES,
  MODULE_CATEGORIES,
  RECORDS,
  SKINS,
  TUTORIAL_STEPS,
  moduleDescription,
} from './data.js';
import { GameEngine } from './game.js';
import {
  chooseModuleCandidates,
  createRunSeed,
  generateArena,
  generateEndlessEncounter,
  generateRun,
  localDateKey,
} from './logic.js';
import { SaveManager } from './save.js';

const MODULE_MAP = new Map(MODULES.map((moduleData) => [moduleData.id, moduleData]));

class AnchorVectorApp {
  constructor() {
    this.canvas = document.querySelector('#game-canvas');
    this.screenLayer = document.querySelector('#screen-layer');
    this.hud = document.querySelector('#battle-hud');
    this.modal = document.querySelector('#modal-layer');
    this.toastStack = document.querySelector('#toast-stack');
    this.contextMessage = document.querySelector('#context-message');
    this.audio = new AudioEngine();
    this.saveManager = new SaveManager((message, type) => this.notice(message, type));
    const loadResult = this.saveManager.load();
    this.save = loadResult.data;
    this.game = null;
    this.run = null;
    this.currentEncounter = null;
    this.selection = {
      mode: 'expedition',
      chassis: this.save.progress.unlockedChassis[0] || 'lancer',
      depth: Math.min(this.save.progress.maxDepthUnlocked, Math.max(0, this.save.progress.maxDepthCleared)),
    };
    this.tutorialIndex = 0;
    this.tutorialTimer = 0;
    this.pendingResult = null;
    this.lastHud = null;
    this.startedAt = performance.now();
    this.playTimer = 0;
    this.bindUi();
    this.applySettings();
  }

  async boot() {
    try {
      this.game = new GameEngine({
        canvas: this.canvas,
        audio: this.audio,
        onHud: (data) => this.updateHud(data),
        onBattleEnd: (result) => this.handleBattleEnd(result),
        onDefeat: (result) => this.handleDefeat(result),
        onTutorialGoal: (goal) => this.handleTutorialGoal(goal),
        onNotice: (message, type) => this.notice(message, type),
        onContext: (state) => this.handleContext(state),
      });
      this.game.setSettings(this.save.settings);
      window.setTimeout(() => this.showTitle(), 320);
      this.playTimer = window.setInterval(() => {
        this.save.stats.playSeconds += 5;
        this.saveManager.markDirty();
      }, 5000);
    } catch (error) {
      this.showWebglError(error);
    }
  }

  bindUi() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || button.disabled) return;
      this.handleAction(button.dataset.action, button.dataset);
    });
    document.addEventListener('change', (event) => this.handleChange(event));
    document.addEventListener('input', (event) => this.handleInput(event));
    window.addEventListener('beforeunload', () => this.saveManager.writeNow());
    window.addEventListener('pagehide', () => this.saveManager.writeNow());
  }

  async handleAction(action, data) {
    switch (action) {
      case 'start':
        await this.audio.unlock();
        if (!this.save.progress.tutorialCompleted) this.showIntro();
        else this.showHangar();
        break;
      case 'continue-saved-run':
        await this.audio.unlock();
        this.resumeSavedRun();
        break;
      case 'intro-start':
        this.startTutorial(0);
        break;
      case 'skip-tutorial':
        this.completeTutorial(true);
        break;
      case 'hangar':
        this.closeModal();
        this.showHangar();
        break;
      case 'modes':
        this.showModeSelect();
        break;
      case 'chassis':
        this.showChassisSelect();
        break;
      case 'archive':
        this.showArchive();
        break;
      case 'achievements':
        this.showAchievements();
        break;
      case 'settings':
        this.showSettings();
        break;
      case 'save-management':
        this.showSaveManagement();
        break;
      case 'select-mode':
        if (this.save.progress.unlockedModes.includes(data.id)) {
          this.selection.mode = data.id;
          this.audio.sfx('confirm', 0.55);
          this.showModeSelect();
        }
        break;
      case 'select-chassis':
        if (this.save.progress.unlockedChassis.includes(data.id)) {
          this.selection.chassis = data.id;
          this.audio.sfx('confirm', 0.55);
          this.showChassisSelect();
        }
        break;
      case 'launch':
        await this.audio.unlock();
        this.requestNewRun();
        break;
      case 'pause':
        this.pauseBattle();
        break;
      case 'resume':
        this.closeModal();
        this.game.resume();
        break;
      case 'overtrace':
        if (this.game.activateOvertrace()) this.notice('OVERTRACE — 経路を逆走します。', 'success');
        break;
      case 'choose-module':
        this.chooseModule(data.id);
        break;
      case 'continue-run':
        this.afterEncounterContinue();
        break;
      case 'go-deeper':
        this.run.pendingGate = false;
        this.run.risk += 0.25;
        this.persistRun();
        this.beginEncounter();
        break;
      case 'retreat':
        this.finishRun('retreat');
        break;
      case 'retry':
        this.retryEncounter();
        break;
      case 'abandon':
        this.closeModal();
        this.finishRun('defeat');
        break;
      case 'event-continue':
        this.afterEncounterContinue();
        break;
      case 'result-hangar':
        this.pendingResult = null;
        this.showHangar();
        break;
      case 'ending-next':
        this.showRunResult(this.pendingResult);
        break;
      case 'equip-skin':
        this.equipOrBuySkin(data.id);
        break;
      case 'download-save':
        this.saveManager.download();
        this.notice('セーブファイルを書き出しました。', 'success');
        break;
      case 'copy-save':
        this.copySaveText();
        break;
      case 'import-save':
        this.importSaveText();
        break;
      case 'reset-save':
        this.confirmReset();
        break;
      case 'reset-save-confirmed':
        this.save = this.saveManager.reset();
        this.selection = { mode: 'expedition', chassis: 'lancer', depth: 0 };
        this.closeModal();
        this.applySettings();
        this.notice('セーブデータを初期化しました。', 'warning');
        this.showTitle();
        break;
      case 'close-modal':
        this.closeModal();
        break;
      case 'fullscreen':
        this.toggleFullscreen();
        break;
      case 'restart-tutorial':
        this.startTutorial(0);
        break;
      default:
        break;
    }
  }

  handleChange(event) {
    const target = event.target;
    if (target.matches('[data-setting]')) {
      const key = target.dataset.setting;
      let value;
      if (target.type === 'checkbox') value = target.checked;
      else if (target.type === 'range' || target.dataset.number === 'true') value = Number(target.value);
      else value = target.value;
      this.save.settings[key] = value;
      this.applySettings();
      this.saveManager.markDirty(true);
      return;
    }
    if (target.id === 'save-file-input' && target.files?.[0]) {
      target.files[0].text().then((text) => {
        const textarea = document.querySelector('#save-import-text');
        if (textarea) textarea.value = text;
      });
    }
  }

  handleInput(event) {
    const target = event.target;
    if (target.id === 'depth-range') {
      this.selection.depth = Number(target.value);
      const label = document.querySelector('#depth-current');
      const description = document.querySelector('#depth-description');
      if (label) label.textContent = `深度 ${this.selection.depth} — ${DEPTHS[this.selection.depth].name}`;
      if (description) description.textContent = DEPTHS[this.selection.depth].description;
    }
    if (target.matches('input[type="range"][data-setting]')) {
      const output = document.querySelector(`[data-output="${target.dataset.setting}"]`);
      if (output) output.textContent = `${Math.round(Number(target.value) * 100)}%`;
    }
  }

  setScreen(name, html, options = {}) {
    document.body.dataset.screen = name;
    this.screenLayer.innerHTML = html;
    this.hud.hidden = !options.battle;
    if (!options.battle) this.hideTutorialPrompt();
    this.closeModal();
    window.scrollTo(0, 0);
  }

  showTitle() {
    this.audio.setMode('hangar');
    const hasRun = Boolean(this.save.activeRun);
    this.setScreen('title', `
      <section class="screen title-screen">
        <div class="title-copy">
          <p class="eyebrow">TACTICAL ROUTE ACTION</p>
          <h1>ANCHOR<span>//</span>VECTOR</h1>
          <p class="subtitle">星環の残響</p>
          <p class="lead">画面を押して時間を遅くし、立体空間に経路を描く。指を離せば、静かな計画が高速の斬撃へ変わる。</p>
          <div class="title-actions">
            <button class="primary-button" data-action="start">${this.save.progress.tutorialCompleted ? 'ハンガーへ' : 'システムを起動'}</button>
            ${hasRun ? '<button class="secondary-button" data-action="continue-saved-run">中断した潜行を再開</button>' : ''}
            <a class="ghost-button" href="../../" style="display:grid;place-items:center;text-decoration:none">ポータルへ戻る</a>
          </div>
          <span class="version-label">VERSION ${GAME_VERSION} / LOCAL SAVE / NO SERVER</span>
        </div>
      </section>
    `);
  }

  showIntro() {
    this.setScreen('intro', `
      <section class="screen intro-screen">
        <div class="intro-copy">
          <p class="eyebrow">VESPER RING / MAINTENANCE LOG</p>
          <h2>居住信号、なし。<br>保守命令、継続。</h2>
          <p>無人軌道施設は、自らを分解して都市への落下を避けた。長い休眠の後、保守機AV-7が再起動する。散逸した記録核を回収し、星環の最後の命令を完了せよ。</p>
          <div class="panel-actions">
            <button class="ghost-button" data-action="skip-tutorial">訓練を省略</button>
            <button class="primary-button" data-action="intro-start">航路訓練を開始</button>
          </div>
        </div>
      </section>
    `);
  }

  showHangar() {
    this.run = null;
    this.currentEncounter = null;
    this.audio.setMode('hangar');
    this.game.clearBattle();
    const progress = this.save.progress;
    const mode = MODES[this.selection.mode];
    const chassis = CHASSIS[this.selection.chassis];
    this.setScreen('hangar', `
      <section class="screen hangar-screen">
        <header class="topbar">
          <div class="brand-small"><strong>ANCHOR//VECTOR</strong><span>VESPER HANGAR</span></div>
          <div class="resource-strip">
            ${resourceChip('fragment', progress.fragments)}
            ${resourceChip('core', progress.cores, true)}
            <button class="icon-button" data-action="settings" aria-label="設定">${icon('settings')}</button>
          </div>
        </header>
        <div class="hangar-content">
          <div class="hangar-card">
            <p class="eyebrow">READY FOR DEPARTURE</p>
            <h2>${chassis.name}</h2>
            <p>${chassis.description}</p>
            <div class="hangar-status">
              <div><span>MODE</span><strong>${mode.name}</strong></div>
              <div><span>DEPTH</span><strong>${this.selection.depth}</strong></div>
              <div><span>MAX CLEAR</span><strong>${Math.max(0, progress.maxDepthCleared)}</strong></div>
            </div>
            <div class="hangar-actions">
              <button class="primary-button launch-button" data-action="modes">潜行準備</button>
              ${this.save.activeRun ? '<button class="secondary-button" data-action="continue-saved-run">中断地点から</button>' : ''}
              <button class="secondary-button" data-action="chassis">機体・外装</button>
              <button class="ghost-button" data-action="archive">記録庫</button>
              <button class="ghost-button" data-action="achievements">実績</button>
              <button class="ghost-button" data-action="save-management">セーブ管理</button>
            </div>
          </div>
        </div>
      </section>
    `);
  }

  showModeSelect() {
    const progress = this.save.progress;
    const cards = Object.values(MODES).map((mode) => {
      const unlocked = progress.unlockedModes.includes(mode.id);
      let status = unlocked ? (this.selection.mode === mode.id ? '選択中' : '選択可能') : `解放: ${mode.unlock}`;
      if (unlocked && mode.id === 'daily') status += ` / 本日BEST ${this.save.stats.dailyBest[localDateKey()] || 0}`;
      if (unlocked && mode.id === 'endless') status += ` / BEST ${this.save.stats.endlessBest}戦`;
      return `
        <button class="selection-card ${this.selection.mode === mode.id ? 'selected' : ''} ${unlocked ? '' : 'locked'}" data-action="select-mode" data-id="${mode.id}" ${unlocked ? '' : 'disabled'}>
          ${icon(mode.icon)}
          <h3>${mode.name}</h3>
          <p>${mode.description}</p>
          <small>${status}</small>
        </button>`;
    }).join('');
    const maxDepth = progress.maxDepthUnlocked;
    this.selection.depth = Math.min(maxDepth, this.selection.depth);
    this.setScreen('selection', `
      <section class="screen choice-screen">
        <div class="screen-panel wide">
          ${panelHeader('SORTIE PROGRAM', '潜行プログラム', '目的と深度を選択します。', 'hangar')}
          <div class="selection-grid">${cards}</div>
          <div class="depth-picker">
            <label for="depth-range"><span>出撃深度</span><strong id="depth-current">深度 ${this.selection.depth} — ${DEPTHS[this.selection.depth].name}</strong></label>
            <input id="depth-range" type="range" min="0" max="${maxDepth}" value="${this.selection.depth}" step="1">
            <p id="depth-description">${DEPTHS[this.selection.depth].description}</p>
          </div>
          <div class="panel-actions">
            <button class="secondary-button" data-action="chassis">機体を選ぶ</button>
            <button class="primary-button" data-action="launch">この条件で出撃</button>
          </div>
        </div>
      </section>
    `);
  }

  showChassisSelect() {
    const progress = this.save.progress;
    const chassisCards = Object.values(CHASSIS).map((chassis) => {
      const unlocked = progress.unlockedChassis.includes(chassis.id);
      return `
        <button class="selection-card ${this.selection.chassis === chassis.id ? 'selected' : ''} ${unlocked ? '' : 'locked'}" data-action="select-chassis" data-id="${chassis.id}" ${unlocked ? '' : 'disabled'}>
          ${icon(chassis.id)}
          <h3>${chassis.name}</h3>
          <p>${chassis.passive}</p>
          <small>${unlocked ? (this.selection.chassis === chassis.id ? '搭載中' : '搭載可能') : `解放: ${chassis.unlock}`}</small>
        </button>`;
    }).join('');
    const skins = SKINS.map((skin) => {
      const unlocked = progress.unlockedSkins.includes(skin.id);
      const active = progress.activeSkin === skin.id;
      const endingLocked = skin.unlock === 'trueEnding' && !progress.trueEnding;
      const costs = [skin.price ? `${skin.price} FRAGMENT` : '', skin.corePrice ? `${skin.corePrice} CORE` : ''].filter(Boolean).join(' + ');
      const status = active ? '使用中' : unlocked ? '解放済み' : endingLocked ? '深度12クリアで解放' : costs;
      return `<button class="skin-card ${active ? 'selected' : ''}" data-action="equip-skin" data-id="${skin.id}" style="--skin:${skin.color}" ${endingLocked ? 'disabled' : ''}>
        <i class="skin-swatch"></i><span><strong>${skin.name}</strong><small> ${status}</small></span>${active ? icon('check') : ''}
      </button>`;
    }).join('');
    this.setScreen('selection', `
      <section class="screen choice-screen">
        <div class="screen-panel wide">
          ${panelHeader('CHASSIS / TRACE', '機体と軌跡', '性能は横方向の違いです。外装色に能力差はありません。', 'hangar')}
          <div class="selection-grid">${chassisCards}</div>
          <h3>軌跡色</h3>
          <div class="skin-grid">${skins}</div>
          <div class="panel-actions"><button class="primary-button" data-action="modes">出撃条件へ</button></div>
        </div>
      </section>
    `);
  }

  showArchive() {
    const unlocked = new Set(this.save.progress.records);
    const cards = RECORDS.map((record, index) => `
      <article class="record-card ${unlocked.has(index) ? '' : 'locked'}">
        <span class="index">RECORD ${String(index + 1).padStart(2, '0')}</span>
        <p>${unlocked.has(index) ? escapeHtml(record) : '――――　未回収　――――'}</p>
      </article>`).join('');
    this.setScreen('archive', `
      <section class="screen choice-screen"><div class="screen-panel wide">
        ${panelHeader('ARCHIVE', `記録庫 ${unlocked.size}/12`, '回収した記録核の内容。', 'hangar')}
        <div class="record-grid">${cards}</div>
      </div></section>
    `);
  }

  showAchievements() {
    const unlocked = new Set(this.save.progress.achievements);
    const cards = ACHIEVEMENTS.map((achievement) => `
      <article class="achievement-card ${unlocked.has(achievement.id) ? '' : 'locked'}">
        ${icon('trophy')}<div><h3>${unlocked.has(achievement.id) ? achievement.name : '未達成'}</h3><p>${achievement.description}</p></div>
      </article>`).join('');
    this.setScreen('achievements', `
      <section class="screen choice-screen"><div class="screen-panel wide">
        ${panelHeader('ACHIEVEMENTS', `実績 ${unlocked.size}/${ACHIEVEMENTS.length}`, '達成状況は端末内へ保存されます。', 'hangar')}
        <div class="achievement-grid">${cards}</div>
      </div></section>
    `);
  }

  showSettings() {
    this.setScreen('settings', `
      <section class="screen choice-screen"><div class="screen-panel wide">
        ${panelHeader('SYSTEM CONFIG', '設定', '変更はすぐに保存されます。', 'hangar')}
        ${this.settingsForm()}
        <div class="panel-actions">
          <button class="ghost-button" data-action="restart-tutorial">チュートリアルを再受講</button>
          <button class="secondary-button" data-action="fullscreen">全画面表示</button>
          <button class="primary-button" data-action="hangar">完了</button>
        </div>
      </div></section>
    `);
  }

  settingsForm() {
    const s = this.save.settings;
    return `<div class="settings-grid">
      ${rangeSetting('master', '全体音量', s.master)}
      ${rangeSetting('music', '音楽', s.music)}
      ${rangeSetting('sfx', '効果音', s.sfx)}
      ${toggleSetting('muted', 'ミュート', s.muted, 'すべての音を停止します。')}
      ${selectSetting('planningSpeed', '計画中の速度', s.planningSpeed, [['0.08','ゆっくり'],['0.16','標準'],['0.25','速め']], true)}
      ${selectSetting('gameSpeed', '通常ゲーム速度', s.gameSpeed, [['0.8','80%'],['1','100%']], true)}
      ${selectSetting('quality', '描画品質', s.quality, [['auto','自動'],['low','低'],['medium','中'],['high','高']])}
      ${selectSetting('particleLevel', 'パーティクル', s.particleLevel, [['off','なし'],['low','少ない'],['medium','標準'],['high','多い']])}
      ${toggleSetting('reducedMotion', '動きを軽減', s.reducedMotion, '残像、カメラ先行、強い動きを抑えます。')}
      ${toggleSetting('highContrast', '高コントラスト', s.highContrast, 'UIと予告線の明度差を広げます。')}
      ${toggleSetting('colorSymbols', '色覚補助記号', s.colorSymbols, '危険と安全へ形状記号を併記します。')}
      ${toggleSetting('screenShake', '画面揺れ', s.screenShake, '被弾とボス演出の揺れ。')}
      ${toggleSetting('haptics', '振動', s.haptics, '対応端末だけで短く振動します。')}
      ${toggleSetting('cameraGesture', '二本指カメラ', s.cameraGesture, '任意の補助回転。攻略には必須ではありません。')}
    </div>`;
  }

  showSaveManagement() {
    this.setScreen('save', `
      <section class="screen choice-screen"><div class="screen-panel">
        ${panelHeader('LOCAL DATA', 'セーブ管理', 'サーバーへ送信せず、この端末だけで管理します。', 'hangar')}
        <div class="settings-grid">
          <div class="setting-row"><label>最終保存 <span>${formatDate(this.save.updatedAt)}</span></label><small>主データに加えて、一世代前のバックアップを保存しています。</small></div>
          <div class="setting-row"><label>保存形式 <span>JSON / SCHEMA ${this.save.schemaVersion}</span></label><small>書き出したファイルを別端末で読み込めます。</small></div>
        </div>
        <textarea id="save-import-text" class="save-textarea" placeholder="セーブJSONを貼り付けるか、下のファイル選択を使用"></textarea>
        <input id="save-file-input" type="file" accept="application/json,.json">
        <div class="panel-actions">
          <button class="ghost-button" data-action="copy-save">JSONをコピー</button>
          <button class="secondary-button" data-action="download-save">ファイルへ書き出す</button>
          <button class="primary-button" data-action="import-save">読み込む</button>
          <button class="danger-button" data-action="reset-save">全データを消去</button>
        </div>
      </div></section>
    `);
  }

  requestNewRun() {
    if (!this.save.activeRun) {
      this.startNewRun();
      return;
    }
    this.openModal(`
      <h2>中断中の潜行があります</h2>
      <p>新しい潜行を開始すると、中断中の未確定資源は失われます。</p>
      <div class="panel-actions">
        <button class="ghost-button" data-action="close-modal">戻る</button>
        <button class="secondary-button" data-action="continue-saved-run">中断地点を再開</button>
        <button class="danger-button" id="replace-run-button">破棄して開始</button>
      </div>`);
    document.querySelector('#replace-run-button')?.addEventListener('click', () => {
      this.closeModal();
      this.save.activeRun = null;
      this.startNewRun();
    }, { once: true });
  }

  startNewRun() {
    const mode = this.selection.mode;
    const depth = this.selection.depth;
    const seed = createRunSeed(mode, depth);
    const generated = generateRun(mode, depth, seed);
    const chassis = CHASSIS[this.selection.chassis];
    this.run = {
      id: `${Date.now()}-${seed}`,
      mode,
      depth,
      seed,
      encounters: generated.encounters,
      current: 0,
      chassis: this.selection.chassis,
      modules: {},
      fragments: 0,
      risk: 1,
      retries: 1,
      shields: chassis.shield,
      maxShields: chassis.shield,
      damageTaken: 0,
      maxChain: 0,
      maxSealHits: 0,
      kills: 0,
      bosses: [],
      pendingModules: null,
      pendingBattleResult: null,
      pendingGate: false,
      dailyKey: mode === 'daily' ? localDateKey() : null,
      startedAt: new Date().toISOString(),
    };
    this.save.stats.runs += 1;
    if (mode === 'daily') {
      const today = localDateKey();
      if (!this.save.stats.dailyDates.includes(today)) this.save.stats.dailyDates.push(today);
    }
    this.persistRun();
    this.beginEncounter();
  }

  resumeSavedRun() {
    if (!this.save.activeRun) {
      this.showHangar();
      return;
    }
    this.run = structuredClone(this.save.activeRun);
    this.selection.mode = this.run.mode;
    this.selection.chassis = this.run.chassis;
    this.selection.depth = this.run.depth;
    if (this.run.pendingModules?.length) {
      this.showModuleChoice(this.run.pendingModules, this.run.pendingBattleResult || { kills: 0, fragments: 0 });
      return;
    }
    if (this.run.pendingGate) {
      this.showReturnGate();
      return;
    }
    this.beginEncounter();
  }

  getEncounter() {
    if (this.run.mode === 'endless') return generateEndlessEncounter(this.run.seed, this.run.current, this.run.depth);
    return this.run.encounters[this.run.current];
  }

  beginEncounter() {
    if (!this.run) return;
    if (this.run.mode !== 'endless' && this.run.current >= this.run.encounters.length) {
      this.completeRun();
      return;
    }
    this.currentEncounter = this.getEncounter();
    this.persistRun();
    if (this.currentEncounter.type === 'repair') {
      this.handleRepairEvent();
      return;
    }
    if (this.currentEncounter.type === 'archive') {
      this.handleArchiveEvent();
      return;
    }
    const effectiveDepth = this.currentEncounter.effectiveDepth ?? this.run.depth;
    const arena = generateArena(this.currentEncounter, effectiveDepth);
    const skin = SKINS.find((item) => item.id === this.save.progress.activeSkin) || SKINS[0];
    this.showBattle();
    this.game.startBattle(arena, {
      chassis: this.run.chassis,
      modules: this.run.modules,
      depth: effectiveDepth,
      mode: this.run.mode,
      seed: this.currentEncounter.seed,
      shields: this.run.shields,
      skinColor: skin.color,
    });
    this.setEncounterLabel();
  }

  showBattle() {
    this.setScreen('battle', '', { battle: true });
    this.hud.hidden = false;
  }

  setEncounterLabel() {
    const label = document.querySelector('#encounter-label');
    if (!label || !this.run) return;
    const total = this.run.mode === 'endless' ? '∞' : this.run.encounters.length;
    label.textContent = `ENCOUNTER ${this.run.current + 1}/${total} · DEPTH ${this.currentEncounter.effectiveDepth ?? this.run.depth}`;
  }

  handleRepairEvent() {
    const before = this.run.shields;
    this.run.shields = this.run.maxShields;
    this.run.current += 1;
    this.persistRun();
    this.setScreen('event', `
      <section class="screen event-screen"><div class="screen-panel">
        <p class="eyebrow">MAINTENANCE POCKET</p><h2>無人修復区画</h2>
        <p>残存していた保守腕が機体を認識した。シールドを ${before} → ${this.run.shields} へ復旧。</p>
        <div class="panel-actions"><button class="primary-button" data-action="event-continue">潜行を続ける</button></div>
      </div></section>`);
  }

  handleArchiveEvent() {
    const index = this.firstLockedRecord((this.run.depth + this.run.current) % RECORDS.length);
    const isNew = !this.save.progress.records.includes(index);
    if (isNew) this.save.progress.records.push(index);
    const reward = isNew ? 45 : 70;
    this.run.fragments += reward;
    this.run.current += 1;
    this.persistRun();
    this.setScreen('event', `
      <section class="screen event-screen"><div class="screen-panel">
        <p class="eyebrow">ARCHIVE RECOVERED / ${String(index + 1).padStart(2, '0')}</p><h2>記録核を回収</h2>
        <p>${isNew ? escapeHtml(RECORDS[index]) : '既知の記録を資源へ変換した。'}</p>
        <div class="reward-summary"><div><span>FRAGMENT</span><strong>+${reward}</strong></div><div><span>RECORD</span><strong>${this.save.progress.records.length}/12</strong></div><div><span>RISK</span><strong>×${this.run.risk.toFixed(2)}</strong></div></div>
        <div class="panel-actions"><button class="primary-button" data-action="event-continue">潜行を続ける</button></div>
      </div></section>`);
  }

  firstLockedRecord(preferred) {
    if (!this.save.progress.records.includes(preferred)) return preferred;
    for (let i = 0; i < RECORDS.length; i += 1) if (!this.save.progress.records.includes(i)) return i;
    return preferred;
  }

  handleBattleEnd(result) {
    if (!this.run) return;
    this.run.shields = Math.min(this.run.maxShields, result.shields + 1);
    this.run.fragments += result.fragments;
    this.run.damageTaken += result.damageTaken;
    this.run.maxChain = Math.max(this.run.maxChain, result.maxChain);
    this.run.maxSealHits = Math.max(this.run.maxSealHits, result.maxSealHits);
    this.run.kills += result.kills;
    this.save.stats.kills += result.kills;
    if (result.bossId) {
      this.run.bosses.push(result.bossId);
      this.save.stats.bosses[result.bossId] = (this.save.stats.bosses[result.bossId] || 0) + 1;
    }
    this.run.current += 1;
    this.persistRun();

    const isComplete = this.run.mode !== 'endless' && this.run.current >= this.run.encounters.length;
    if (isComplete) {
      this.completeRun();
      return;
    }
    const candidates = chooseModuleCandidates(this.save.progress.unlockedModules, this.run.modules, this.run.seed + this.run.current * 997);
    if (!candidates.length) {
      this.run.fragments += 60;
      this.notice('全モジュールが最大段階のため、60 FRAGMENTへ変換しました。', 'success');
      this.afterEncounterContinue();
      return;
    }
    this.run.pendingModules = [...candidates];
    this.run.pendingBattleResult = { kills: result.kills, fragments: result.fragments };
    this.persistRun();
    this.showModuleChoice(candidates, result);
  }

  showModuleChoice(candidates, result) {
    const cards = candidates.map((id) => {
      const data = MODULE_MAP.get(id);
      const nextLevel = (this.run.modules[id] || 0) + 1;
      const category = MODULE_CATEGORIES[data.category];
      return `<button class="module-card ${data.category}" data-action="choose-module" data-id="${id}">
        ${icon(category.icon)}
        <div class="module-meta"><span>${category.name} / ${data.rarity.toUpperCase()}</span><span>LV ${nextLevel}</span></div>
        <h3>${data.name}<br><small>${data.jp}</small></h3>
        <p>${moduleDescription(data, nextLevel)}</p>
      </button>`;
    }).join('');
    this.setScreen('module', `
      <section class="screen choice-screen"><div class="screen-panel wide">
        <div class="panel-header"><div><p class="eyebrow">ROUTE RECOMPILE</p><h2>モジュールを選択</h2><p>敵 ${result.kills}体 / FRAGMENT +${result.fragments}</p></div></div>
        <div class="module-grid">${cards}</div>
      </div></section>`);
  }

  chooseModule(id) {
    if (!this.run || !MODULE_MAP.has(id)) return;
    this.run.modules[id] = Math.min(3, (this.run.modules[id] || 0) + 1);
    this.run.pendingModules = null;
    this.run.pendingBattleResult = null;
    if (!this.save.progress.seenModules.includes(id)) this.save.progress.seenModules.push(id);
    this.audio.sfx('unlock');
    this.persistRun();
    this.afterEncounterContinue();
  }

  afterEncounterContinue() {
    if (!this.run) return;
    const gate = (this.run.mode === 'expedition' || this.run.mode === 'daily') && (this.run.current === 2 || this.run.current === 4);
    const endlessGate = this.run.mode === 'endless' && this.run.current > 0 && this.run.current % 5 === 0;
    if (gate || endlessGate) {
      this.run.pendingGate = true;
      this.persistRun();
      this.showReturnGate();
      return;
    }
    this.beginEncounter();
  }

  showReturnGate() {
    const secured = Math.floor(this.run.fragments * this.run.risk);
    this.setScreen('gate', `
      <section class="screen event-screen"><div class="screen-panel">
        <p class="eyebrow">RETURN WINDOW</p><h2>帰還可能域</h2>
        <p>現在帰還すれば資源を確定できます。潜行すると報酬倍率が上昇しますが、撃墜時には未確定資源の半分を失います。</p>
        <div class="reward-summary"><div><span>回収予定</span><strong>${secured}</strong></div><div><span>倍率</span><strong>×${this.run.risk.toFixed(2)}</strong></div><div><span>シールド</span><strong>${this.run.shields}/${this.run.maxShields}</strong></div></div>
        <div class="panel-actions"><button class="secondary-button" data-action="retreat">帰還して確定</button><button class="primary-button" data-action="go-deeper">深層へ（倍率+0.25）</button></div>
      </div></section>`);
  }

  handleDefeat(result) {
    if (!this.run) return;
    this.run.damageTaken += result.damageTaken;
    this.save.stats.defeats += 1;
    this.persistRun();
    const canRetry = this.run.retries > 0;
    this.setScreen('defeat', `
      <section class="screen result-screen"><div class="screen-panel">
        <p class="eyebrow" style="color:var(--coral)">SIGNAL LOST</p><h2>機体停止</h2>
        <p>攻撃種別: ${escapeHtml(result.killer || '不明')}。未確定資源 ${this.run.fragments}。</p>
        <div class="reward-summary"><div><span>回収可能</span><strong>${Math.floor(this.run.fragments * this.run.risk * .5)}</strong></div><div><span>再試行</span><strong>${this.run.retries}</strong></div><div><span>最大CHAIN</span><strong>${this.run.maxChain}</strong></div></div>
        <div class="panel-actions">${canRetry ? '<button class="primary-button" data-action="retry">遭遇を最初から再試行</button>' : ''}<button class="danger-button" data-action="abandon">50%を回収して終了</button></div>
      </div></section>`);
  }

  retryEncounter() {
    if (!this.run || this.run.retries <= 0) return;
    this.run.retries -= 1;
    this.run.shields = this.run.maxShields;
    this.persistRun();
    this.beginEncounter();
  }

  completeRun() {
    const run = this.run;
    if (!run) return;
    const hadNormalEnding = this.save.progress.normalEnding;
    const banked = Math.floor(run.fragments * run.risk);
    const dailyScore = this.recordDailyScore(run, banked);
    this.save.progress.fragments += banked;
    this.save.stats.totalFragments += banked;
    this.save.stats.victories += 1;
    this.save.stats.maxChain = Math.max(this.save.stats.maxChain, run.maxChain);
    this.save.stats.maxSealHits = Math.max(this.save.stats.maxSealHits, run.maxSealHits);
    this.save.stats.chassisClears[run.chassis] = (this.save.stats.chassisClears[run.chassis] || 0) + 1;
    this.save.stats.chassisDepths[run.chassis] = Math.max(this.save.stats.chassisDepths[run.chassis] || -1, run.depth);
    if (run.damageTaken === 0) this.save.stats.noDamageClears += 1;
    if (run.mode === 'endless') this.save.stats.endlessBest = Math.max(this.save.stats.endlessBest, run.current);
    else if (run.mode !== 'bossRush') {
      this.save.progress.maxDepthCleared = Math.max(this.save.progress.maxDepthCleared, run.depth);
      this.save.progress.maxDepthUnlocked = Math.min(12, Math.max(this.save.progress.maxDepthUnlocked, run.depth + 1));
      if (run.depth === 0) this.save.progress.normalEnding = true;
      if (run.depth === 12) this.save.progress.trueEnding = true;
    }
    this.save.progress.cores += Math.max(1, run.bosses.length);
    const recordIndex = Math.min(11, run.depth);
    if (!this.save.progress.records.includes(recordIndex)) this.save.progress.records.push(recordIndex);
    this.saveManager.applyMilestones();
    const newAchievements = this.checkAchievements();
    this.save.activeRun = null;
    this.saveManager.markDirty(true);
    const result = { reason: 'victory', banked, dailyScore, run: structuredClone(run), newAchievements };
    this.pendingResult = result;
    const firstNormal = run.depth === 0 && !hadNormalEnding;
    const trueEnding = run.depth === 12;
    if (firstNormal || trueEnding) this.showEnding(trueEnding);
    else this.showRunResult(result);
  }

  finishRun(reason) {
    const run = this.run || this.save.activeRun;
    if (!run) {
      this.showHangar();
      return;
    }
    const multiplier = reason === 'defeat' ? 0.5 : 1;
    const banked = Math.floor(run.fragments * run.risk * multiplier);
    const dailyScore = this.recordDailyScore(run, banked);
    this.save.progress.fragments += banked;
    this.save.stats.totalFragments += banked;
    this.save.stats.maxChain = Math.max(this.save.stats.maxChain, run.maxChain || 0);
    this.save.stats.maxSealHits = Math.max(this.save.stats.maxSealHits, run.maxSealHits || 0);
    if (reason === 'retreat') this.save.stats.retreats += 1;
    if (run.mode === 'endless') this.save.stats.endlessBest = Math.max(this.save.stats.endlessBest, run.current);
    const newAchievements = this.checkAchievements();
    this.save.activeRun = null;
    this.saveManager.markDirty(true);
    this.pendingResult = { reason, banked, dailyScore, run: structuredClone(run), newAchievements };
    this.showRunResult(this.pendingResult);
  }

  recordDailyScore(run, banked) {
    if (run.mode !== 'daily') return null;
    const started = new Date(run.startedAt);
    const key = /^\d{4}-\d{2}-\d{2}$/.test(run.dailyKey || '')
      ? run.dailyKey
      : localDateKey(Number.isNaN(started.getTime()) ? new Date() : started);
    const score = Math.max(0, Math.round(banked + run.kills * 12 + run.maxChain * 8 + run.bosses.length * 150 - run.damageTaken * 40));
    this.save.stats.dailyBest[key] = Math.max(this.save.stats.dailyBest[key] || 0, score);
    return score;
  }

  showEnding(trueEnding) {
    this.setScreen('ending', `
      <section class="screen intro-screen"><div class="intro-copy">
        <p class="eyebrow">${trueEnding ? 'FINAL COMMAND' : 'VESPER ARCHIVE / RESTORED'}</p>
        <h2>${trueEnding ? 'TASK COMPLETE' : '破壊ではなく退避。'}<br>${trueEnding ? 'NO RETURN REQUIRED' : '敗北ではなく選択。'}</h2>
        <p>${trueEnding ? 'すべての残骸は安全軌道へ移った。AV-7は最後の航路灯を消し、命令のない静寂へ停止する。' : '星環は都市を救うため、自らを空から除外した。AV-7は散逸した残骸の軌道修正を続ける。'}</p>
        <div class="panel-actions"><button class="primary-button" data-action="ending-next">戦果を確認</button></div>
      </div></section>`);
  }

  showRunResult(result) {
    if (!result) return this.showHangar();
    const run = result.run;
    const title = result.reason === 'victory' ? '潜行完了' : result.reason === 'retreat' ? '帰還完了' : '残存資源を回収';
    const achievements = result.newAchievements.length
      ? `<p class="eyebrow">NEW ACHIEVEMENT</p><p>${result.newAchievements.map((id) => ACHIEVEMENTS.find((item) => item.id === id)?.name).filter(Boolean).join(' / ')}</p>` : '';
    this.setScreen('result', `
      <section class="screen result-screen"><div class="screen-panel">
        <p class="eyebrow">SORTIE REPORT</p><h2>${title}</h2>
        <div class="reward-summary"><div><span>確定資源</span><strong>${result.banked}</strong></div><div><span>最大CHAIN</span><strong>${run.maxChain}</strong></div><div><span>撃破</span><strong>${run.kills}</strong></div>${result.dailyScore === null || result.dailyScore === undefined ? '' : `<div><span>DAILY SCORE</span><strong>${result.dailyScore}</strong></div>`}</div>
        ${achievements}
        <div class="panel-actions"><button class="primary-button" data-action="result-hangar">ハンガーへ</button></div>
      </div></section>`);
  }

  persistRun() {
    if (!this.run) return;
    this.save.activeRun = structuredClone(this.run);
    this.saveManager.markDirty(true);
  }

  checkAchievements() {
    const unlocked = new Set(this.save.progress.achievements);
    const p = this.save.progress;
    const s = this.save.stats;
    const conditions = {
      firstKill: s.kills >= 1,
      firstReturn: s.victories + s.retreats >= 1,
      firstBoss: Object.values(s.bosses).reduce((sum, value) => sum + value, 0) >= 1,
      clearLancer: (s.chassisClears.lancer || 0) >= 1,
      clearWeaver: (s.chassisClears.weaver || 0) >= 1,
      clearBulwark: (s.chassisClears.bulwark || 0) >= 1,
      ringWarden: (s.bosses.ringWarden || 0) >= 1,
      tetraCrown: (s.bosses.tetraCrown || 0) >= 1,
      vesperCore: (s.bosses.vesperCore || 0) >= 1,
      depth3: p.maxDepthCleared >= 3,
      depth6: p.maxDepthCleared >= 6,
      depth9: p.maxDepthCleared >= 9,
      depth12: p.maxDepthCleared >= 12,
      chain10: s.maxChain >= 10,
      chain20: s.maxChain >= 20,
      seal4: s.maxSealHits >= 4,
      noDamage: s.noDamageClears >= 1,
      modulesHalf: p.seenModules.length >= Math.ceil(MODULES.length / 2),
      modulesAll: p.seenModules.length >= MODULES.length,
      allRecords: p.records.length >= RECORDS.length,
      daily7: s.dailyDates.length >= 7,
      endless20: s.endlessBest >= 20,
      allChassisDepth6: Object.keys(CHASSIS).every((id) => (s.chassisDepths[id] || -1) >= 6),
    };
    const fresh = [];
    ACHIEVEMENTS.forEach((achievement) => {
      if (conditions[achievement.id] && !unlocked.has(achievement.id)) {
        unlocked.add(achievement.id);
        fresh.push(achievement.id);
      }
    });
    p.achievements = [...unlocked];
    fresh.forEach(() => this.audio.sfx('unlock'));
    return fresh;
  }

  startTutorial(index) {
    window.clearTimeout(this.tutorialTimer);
    this.tutorialIndex = index;
    const step = TUTORIAL_STEPS[index];
    if (!step) {
      this.completeTutorial(false);
      return;
    }
    const arena = tutorialArena(index);
    this.showBattle();
    this.game.startBattle(arena, {
      chassis: 'lancer',
      modules: {},
      depth: 0,
      mode: 'tutorial',
      seed: 100 + index,
      tutorialGoal: step.goal,
      skinColor: '#43f5d0',
    });
    document.querySelector('#encounter-label').textContent = `TRAINING ${index + 1}/4`;
    this.showTutorialPrompt(step);
  }

  handleTutorialGoal() {
    const step = TUTORIAL_STEPS[this.tutorialIndex];
    this.notice(`${step.title} — 完了`, 'success');
    this.tutorialTimer = window.setTimeout(() => this.startTutorial(this.tutorialIndex + 1), 650);
  }

  completeTutorial(skipped) {
    window.clearTimeout(this.tutorialTimer);
    this.tutorialTimer = 0;
    this.save.progress.tutorialCompleted = true;
    if (!this.save.progress.records.includes(0)) this.save.progress.records.push(0);
    this.saveManager.markDirty(true);
    this.hideTutorialPrompt();
    this.notice(skipped ? '訓練を省略しました。設定から再受講できます。' : '航路訓練を完了しました。', 'success');
    this.showHangar();
  }

  showTutorialPrompt(step) {
    const prompt = document.querySelector('#tutorial-prompt');
    prompt.innerHTML = `<strong>${step.title}</strong><span>${step.body}</span><br><button class="ghost-button" data-action="skip-tutorial" style="min-height:36px;margin-top:8px;padding:6px 10px">訓練を省略</button>`;
    prompt.hidden = false;
  }

  hideTutorialPrompt() {
    const prompt = document.querySelector('#tutorial-prompt');
    if (prompt) prompt.hidden = true;
  }

  updateHud(data) {
    this.lastHud = data;
    if (this.hud.hidden) return;
    const shield = document.querySelector('#shield-display');
    shield.innerHTML = Array.from({ length: data.maxShields }, (_, index) => `<i class="shield-segment ${index < data.shields ? '' : 'empty'}"></i>`).join('');
    shield.setAttribute('aria-label', `シールド ${data.shields}/${data.maxShields}`);
    document.querySelector('#enemy-count').textContent = `敵 ${data.alive}`;
    document.querySelector('#flow-value').textContent = Math.round(data.flow);
    document.querySelector('#flow-meter').style.setProperty('--flow', data.flow.toFixed(1));
    const chain = document.querySelector('#chain-display');
    chain.hidden = data.chain < 2;
    document.querySelector('#chain-value').textContent = data.chain;
    const route = document.querySelector('#route-readout');
    route.hidden = !data.planning;
    document.querySelector('#route-nodes').textContent = `${data.routeNodes} / ${data.maxRouteNodes} NODE`;
    document.querySelector('#route-length').textContent = `${data.routeLength.toFixed(1)} m`;
    const overtrace = document.querySelector('#overtrace-button');
    overtrace.disabled = !data.overtraceReady;
    const bossBar = document.querySelector('#boss-bar');
    bossBar.hidden = data.bossHp === null;
    if (data.bossHp !== null) {
      document.querySelector('#boss-fill').style.width = `${Math.max(0, data.bossHp * 100)}%`;
      if (this.currentEncounter?.bossId) document.querySelector('#boss-name').textContent = BOSSES[this.currentEncounter.bossId].name;
    }
  }

  pauseBattle() {
    if (!this.run || this.game.state !== 'running') return;
    this.game.pause();
    this.openModal(`
      <p class="eyebrow">SYSTEM PAUSED</p><h2>一時停止</h2>
      <p>現在の遭遇は開始時点から再開できます。再試行権を使用しない放棄では、未確定資源の50%を回収します。</p>
      <div class="panel-actions">
        <button class="primary-button" data-action="resume">戦闘へ戻る</button>
        ${this.run.retries > 0 ? '<button class="secondary-button" data-action="retry">遭遇を最初から再試行</button>' : ''}
        <button class="danger-button" data-action="abandon">潜行を放棄</button>
      </div>`);
  }

  applySettings() {
    const settings = this.save.settings;
    document.documentElement.classList.toggle('high-contrast', settings.highContrast);
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
    this.audio.setVolume('master', settings.master);
    this.audio.setVolume('music', settings.music);
    this.audio.setVolume('sfx', settings.sfx);
    this.audio.setEnabled(!settings.muted);
    this.game?.setSettings(settings);
  }

  equipOrBuySkin(id) {
    const skin = SKINS.find((item) => item.id === id);
    if (!skin) return;
    const progress = this.save.progress;
    if (skin.unlock === 'trueEnding' && !progress.trueEnding) {
      this.notice('無色光は深度12クリア後に解放されます。', 'warning');
      return;
    }
    if (!progress.unlockedSkins.includes(id)) {
      if (progress.fragments < skin.price || progress.cores < (skin.corePrice || 0)) {
        this.notice('解放に必要なFRAGMENTまたはCOREが不足しています。', 'warning');
        return;
      }
      progress.fragments -= skin.price;
      progress.cores -= skin.corePrice || 0;
      progress.unlockedSkins.push(id);
      this.audio.sfx('unlock');
      this.notice(`${skin.name}を解放しました。`, 'success');
    }
    progress.activeSkin = id;
    this.saveManager.markDirty(true);
    this.showChassisSelect();
  }

  async copySaveText() {
    const text = this.saveManager.exportText();
    try {
      await navigator.clipboard.writeText(text);
      this.notice('セーブJSONをコピーしました。', 'success');
    } catch (_) {
      const textarea = document.querySelector('#save-import-text');
      textarea.value = text;
      textarea.select();
      this.notice('クリップボードを使用できないため、テキスト欄を選択しました。', 'warning');
    }
  }

  importSaveText() {
    const textarea = document.querySelector('#save-import-text');
    const text = textarea?.value.trim();
    if (!text) return this.notice('読み込むJSONを指定してください。', 'warning');
    try {
      this.save = this.saveManager.importText(text);
      this.applySettings();
      this.notice('セーブデータを読み込みました。', 'success');
      this.showHangar();
    } catch (error) {
      this.notice(`読み込みに失敗しました: ${error.message}`, 'error');
    }
  }

  confirmReset() {
    this.openModal(`
      <h2>全データを消去しますか？</h2>
      <p>進行、設定、中断中の潜行、バックアップをすべて削除します。この操作は元に戻せません。</p>
      <div class="panel-actions"><button class="ghost-button" data-action="close-modal">やめる</button><button class="danger-button" data-action="reset-save-confirmed">完全に消去</button></div>`);
  }

  openModal(html) {
    this.modal.innerHTML = `<div class="modal-card">${html}</div>`;
    this.modal.hidden = false;
  }

  closeModal() {
    this.modal.hidden = true;
    this.modal.innerHTML = '';
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => this.notice('このブラウザでは全画面表示を使用できません。', 'warning'));
  }

  handleContext(state) {
    this.contextMessage.hidden = state !== 'lost';
    if (state === 'restored') this.notice('3D描画を復旧しました。', 'success');
  }

  showWebglError(error) {
    this.setScreen('error', `
      <section class="screen boot-screen"><div class="screen-panel">
        <p class="eyebrow" style="color:var(--coral)">GRAPHICS INITIALIZATION FAILED</p><h2>WebGL 2を開始できません</h2>
        <p>ブラウザのハードウェアアクセラレーションを有効にし、iOS SafariまたはAndroid Chromeの現行版で再度開いてください。</p>
        <p class="version-label">${escapeHtml(error?.message || 'unknown error')}</p>
        <div class="panel-actions"><button class="primary-button" onclick="location.reload()">再読み込み</button><a class="ghost-button" href="../../" style="text-decoration:none">ポータルへ戻る</a></div>
      </div></section>`);
  }

  notice(message, type = 'info') {
    if (!this.toastStack) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    this.toastStack.append(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }
}

function tutorialArena(index) {
  const common = {
    theme: 'rim',
    boss: null,
    nodes: [
      { id: 't0', kind: 'anchor', position: [-6, -3, 0], locked: false },
      { id: 't1', kind: 'anchor', position: [5.5, -2.8, 0.3], locked: false },
      { id: 't2', kind: 'anchor', position: [3.5, 3.8, -0.3], locked: false },
      { id: 't3', kind: 'anchor', position: [-5.2, -2.2, 0.2], locked: false },
      { id: 't4', kind: 'anchor', position: [-2.8, 3.7, 0.6], locked: false },
    ],
    playerStart: [-6, -3, 0],
    enemies: [],
  };
  if (index === 1) common.enemies.push(tutorialEnemy('tutorial-enemy', 'seeker', [0, 0, 0], 2));
  if (index === 3) {
    common.enemies.push(tutorialEnemy('seal-a', 'seeker', [-1.2, 0, 0], 8));
    common.enemies.push(tutorialEnemy('seal-b', 'seeker', [1.2, 0.4, 0], 8));
  }
  return common;
}

function tutorialEnemy(id, type, position, hp) {
  return { id, type, position, hp, maxHp: hp, cooldown: 999, reward: 0, elite: false, radius: 0.58, facing: 0 };
}

function icon(id) {
  return `<svg class="inline-icon" aria-hidden="true"><use href="./assets/ui-icons.svg#${id}"></use></svg>`;
}

function resourceChip(type, value, core = false) {
  return `<div class="resource-chip ${core ? 'core' : ''}">${icon(type)}<strong>${Number(value).toLocaleString('ja-JP')}</strong></div>`;
}

function panelHeader(eyebrow, title, description, backAction) {
  return `<header class="panel-header"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${description}</p></div><button class="icon-button" data-action="${backAction}" aria-label="戻る">${icon('back')}</button></header>`;
}

function rangeSetting(key, label, value) {
  return `<div class="setting-row"><label for="setting-${key}">${label}<output data-output="${key}">${Math.round(value * 100)}%</output></label><input id="setting-${key}" type="range" min="0" max="1" step="0.01" value="${value}" data-setting="${key}" data-number="true"></div>`;
}

function toggleSetting(key, label, checked, description) {
  return `<div class="setting-row"><label>${label}<span class="toggle"><input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''}><i></i></span></label><small>${description}</small></div>`;
}

function selectSetting(key, label, value, choices, numeric = false) {
  const options = choices.map(([optionValue, text]) => `<option value="${optionValue}" ${String(value) === optionValue ? 'selected' : ''}>${text}</option>`).join('');
  return `<div class="setting-row"><label for="setting-${key}">${label}</label><select id="setting-${key}" data-setting="${key}" ${numeric ? 'data-number="true"' : ''}>${options}</select></div>`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '不明';
  return date.toLocaleString('ja-JP');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

const app = new AnchorVectorApp();
if (new URLSearchParams(location.search).has('debug')) window.__anchorVectorApp = app;
app.boot();
if (new URLSearchParams(location.search).has('test')) {
  import('./selftest.js').then(({ runSelfTests }) => {
    window.__ANCHOR_VECTOR_TESTS__ = runSelfTests();
    console.info('ANCHOR_VECTOR_SELFTEST', window.__ANCHOR_VECTOR_TESTS__);
  }).catch((error) => {
    window.__ANCHOR_VECTOR_TESTS__ = { ok: false, passed: 0, total: 1, results: [{ name: 'selftest-load', ok: false, error: error.message }] };
    console.error('ANCHOR_VECTOR_SELFTEST_LOAD_FAILED', error);
  });
}
