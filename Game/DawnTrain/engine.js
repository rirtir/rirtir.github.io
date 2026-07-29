"use strict";

(function (DT) {
  const DATA = DT.DATA;

  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const posKey = pos => `${pos.car}:${pos.lane}`;

  function hashSeed(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rngNext(holder) {
    holder.rng = (holder.rng + 0x6D2B79F5) >>> 0;
    let t = holder.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function createCrewState(id) {
    const def = DATA.crew[id];
    return {
      id,
      hp: def.maxHp,
      maxHp: def.maxHp,
      level: 1,
      upgrades: [],
      joined: true
    };
  }

  function createCarState(type, uid, level = 1) {
    const def = DATA.cars[type];
    const maxHp = def.maxHp + (level - 1) * 3;
    return { uid, type, level, hp: maxHp, maxHp, barrier: 0 };
  }

  function createNewGame(difficulty = "normal") {
    const now = Date.now();
    const game = {
      saveVersion: DATA.saveVersion,
      buildVersion: DATA.version,
      createdAt: now,
      updatedAt: now,
      difficulty,
      chapterIndex: 0,
      stepIndex: 0,
      resources: { fuel: 7, scrap: 5, medkits: 3, morale: 6 },
      train: [
        createCarState("engine", "car_engine"),
        createCarState("cannon", "car_cannon"),
        createCarState("workshop", "car_workshop")
      ],
      crew: {
        kureha: createCrewState("kureha"),
        gaku: createCrewState("gaku"),
        mina: createCrewState("mina"),
        sui: createCrewState("sui")
      },
      activeCrew: ["kureha", "gaku", "mina", "sui"],
      unlockedCars: ["engine", "cannon", "workshop"],
      upgrades: [],
      bonuses: { maxSteam: 0, startSteam: 0, crewDamage: 0, afterHeal: 0, bonusScrap: 0, startBarrier: 0, efficiency: 0 },
      routeChoices: {},
      flags: {},
      guidance: { prologue: false, route: 0, battle: 0, choice: false, garage: false, garageRepair: false, upgrade: false, bosses: {} },
      assistedBattles: {},
      records: [],
      rescued: [],
      battle: null,
      lastResult: null,
      completed: false,
      ending: null,
      stats: {
        playSeconds: 0,
        battlesWon: 0,
        battlesLost: 0,
        enemiesDefeated: 0,
        damageTaken: 0,
        carDamageTaken: 0,
        repairs: 0,
        turns: 0,
        retries: {},
        choices: 0
      }
    };
    return game;
  }

  function validateGame(game) {
    if (!game || typeof game !== "object") return { ok: false, error: "セーブデータがオブジェクトではありません" };
    game.upgrades = Array.isArray(game.upgrades) ? game.upgrades : [];
    game.bonuses = Object.assign({ maxSteam: 0, startSteam: 0, crewDamage: 0, afterHeal: 0, bonusScrap: 0, startBarrier: 0, efficiency: 0 }, game.bonuses || {});
    game.records = Array.isArray(game.records) ? game.records : [];
    game.rescued = Array.isArray(game.rescued) ? game.rescued : [];
    game.assistedBattles = game.assistedBattles && typeof game.assistedBattles === "object" ? game.assistedBattles : {};
    game.guidance = Object.assign({ prologue: true, route: 0, battle: 0, choice: false, garage: false, garageRepair: false, upgrade: false, bosses: {} }, game.guidance || {});
    game.guidance.bosses = game.guidance.bosses && typeof game.guidance.bosses === "object" ? game.guidance.bosses : {};
    if (game.saveVersion !== DATA.saveVersion) return { ok: false, error: `未対応のセーブ版です (${game.saveVersion})` };
    if (!["normal", "story"].includes(game.difficulty)) return { ok: false, error: "難易度が不正です" };
    if (!Number.isInteger(game.chapterIndex) || game.chapterIndex < 0 || game.chapterIndex >= DATA.chapters.length) {
      if (!game.completed) return { ok: false, error: "章番号が不正です" };
    }
    const chapter = DATA.chapters[game.chapterIndex];
    if (!Number.isInteger(game.stepIndex) || game.stepIndex < 0 || (!game.completed && (!chapter || game.stepIndex >= chapter.steps.length))) {
      return { ok: false, error: "現在地の情報が壊れています" };
    }
    if (!game.resources || !Array.isArray(game.train) || !game.crew || !Array.isArray(game.activeCrew)) {
      return { ok: false, error: "進行データの必須項目がありません" };
    }
    if (!game.stats || !game.flags || typeof game.flags !== "object" || !game.routeChoices || typeof game.routeChoices !== "object") {
      return { ok: false, error: "記録データの必須項目がありません" };
    }
    for (const key of ["playSeconds", "battlesWon", "battlesLost", "enemiesDefeated", "damageTaken", "carDamageTaken", "repairs", "turns", "choices"]) {
      if (!Number.isFinite(game.stats[key]) || game.stats[key] < 0) return { ok: false, error: `統計データが不正です: ${key}` };
    }
    for (const key of ["fuel", "scrap", "medkits", "morale"]) {
      if (!Number.isFinite(game.resources[key]) || game.resources[key] < 0) return { ok: false, error: `資源データが不正です: ${key}` };
    }
    if (game.resources.morale > 10) return { ok: false, error: "士気データが不正です" };
    if (game.train.length < 1 || game.train.length > 6) return { ok: false, error: "車両数が不正です" };
    if (!game.train.some(car => car.type === "engine")) return { ok: false, error: "機関車がありません" };
    for (const car of game.train) {
      if (!DATA.cars[car.type] || !Number.isFinite(car.hp) || !Number.isFinite(car.maxHp) || car.maxHp <= 0 || car.hp < 0 || car.hp > car.maxHp) {
        return { ok: false, error: "車両データが不正です" };
      }
    }
    for (const id of Object.keys(game.crew)) {
      if (!DATA.crew[id]) return { ok: false, error: `不明な乗員です: ${id}` };
      const member = game.crew[id];
      if (!Number.isFinite(member.hp) || !Number.isFinite(member.maxHp) || member.maxHp <= 0 || member.hp < 0 || member.hp > member.maxHp) {
        return { ok: false, error: `乗員データが不正です: ${id}` };
      }
    }
    if (game.activeCrew.length < 2 || game.activeCrew.length > 4 || new Set(game.activeCrew).size !== game.activeCrew.length || game.activeCrew.some(id => !game.crew[id])) {
      return { ok: false, error: "出撃編成が不正です" };
    }
    if (!Array.isArray(game.unlockedCars) || game.unlockedCars.some(type => !DATA.cars[type])) return { ok: false, error: "車両設計図が不正です" };
    if (game.upgrades.some(id => !DATA.upgrades[id]) || Object.keys(DATA.upgrades).some(id => game.upgrades.filter(item => item === id).length > 2)) {
      return { ok: false, error: "列車強化の情報が壊れています" };
    }
    if (game.battle) {
      const battle = game.battle;
      if (!DATA.encounters[battle.encounterId] || !Array.isArray(battle.crew) || !Array.isArray(battle.enemies) || !Array.isArray(battle.cars)) {
        return { ok: false, error: "戦闘途中データが不正です" };
      }
      if (!["player", "enemy", "victory", "defeat"].includes(battle.phase) || !Number.isInteger(battle.round) || battle.round < 1) {
        return { ok: false, error: "戦闘進行データが不正です" };
      }
      if (battle.cars.length !== game.train.length || battle.cars.some(car => !DATA.cars[car.type] || !Number.isFinite(car.hp) || !Number.isFinite(car.maxHp) || car.maxHp <= 0 || car.hp < 0 || car.hp > car.maxHp)) {
        return { ok: false, error: "戦闘車両データが不正です" };
      }
      if (!Number.isFinite(battle.steam) || !Number.isFinite(battle.maxSteam) || battle.steam < 0 || battle.maxSteam < 1 || battle.steam > battle.maxSteam || !Number.isFinite(battle.morale) || battle.morale < 0 || battle.morale > 10) {
        return { ok: false, error: "戦闘資源データが不正です" };
      }
      const validUnit = unit => unit && Number.isFinite(unit.hp) && Number.isFinite(unit.maxHp) && unit.hp >= 0 && unit.hp <= unit.maxHp && unit.pos && Number.isInteger(unit.pos.car) && unit.pos.car >= 0 && unit.pos.car < battle.cars.length && Number.isInteger(unit.pos.lane) && unit.pos.lane >= 0 && unit.pos.lane < 3;
      if (battle.crew.some(unit => !DATA.crew[unit.id] || !validUnit(unit)) || battle.enemies.some(unit => !DATA.enemies[unit.type] || !validUnit(unit))) {
        return { ok: false, error: "戦闘ユニットデータが不正です" };
      }
    }
    return { ok: true };
  }

  function getChapter(game) {
    return DATA.chapters[game.chapterIndex] || null;
  }

  function getStep(game) {
    const chapter = getChapter(game);
    return chapter && chapter.steps[game.stepIndex] ? chapter.steps[game.stepIndex] : null;
  }

  function addLog(battle, text, tone = "normal") {
    battle.log.unshift({ text, tone, round: battle.round });
    if (battle.log.length > 36) battle.log.length = 36;
  }

  function cellDistance(a, b) {
    return Math.abs(a.car - b.car) + Math.abs(a.lane - b.lane);
  }

  function inBounds(battle, pos) {
    return pos && pos.car >= 0 && pos.car < battle.cars.length && pos.lane >= 0 && pos.lane < 3;
  }

  function neighbors(battle, pos) {
    return [
      { car: pos.car - 1, lane: pos.lane },
      { car: pos.car + 1, lane: pos.lane },
      { car: pos.car, lane: pos.lane - 1 },
      { car: pos.car, lane: pos.lane + 1 }
    ].filter(next => inBounds(battle, next));
  }

  function livingCrew(battle) { return battle.crew.filter(unit => unit.hp > 0); }
  function livingEnemies(battle) { return battle.enemies.filter(unit => unit.hp > 0); }

  function unitAt(battle, pos, includeDown = false) {
    const all = battle.crew.concat(battle.enemies);
    const living = all.find(unit => unit.hp > 0 && unit.pos.car === pos.car && unit.pos.lane === pos.lane);
    if (living || !includeDown) return living || null;
    return all.find(unit => unit.pos.car === pos.car && unit.pos.lane === pos.lane) || null;
  }

  function findOpenCell(battle, preferred, side) {
    if (inBounds(battle, preferred) && !unitAt(battle, preferred)) return preferred;
    const carOrder = [];
    if (side === "front") {
      for (let car = 0; car < battle.cars.length; car += 1) carOrder.push(car);
    } else {
      for (let car = battle.cars.length - 1; car >= 0; car -= 1) carOrder.push(car);
    }
    const laneOrder = [preferred.lane, 1, 0, 2].filter((lane, index, arr) => arr.indexOf(lane) === index);
    for (const car of carOrder) {
      for (const lane of laneOrder) {
        const pos = { car, lane };
        if (!unitAt(battle, pos)) return pos;
      }
    }
    return null;
  }

  function spawnEnemy(battle, spec) {
    const def = DATA.enemies[spec.type];
    if (!def) return false;
    const edgeCar = spec.side === "front" ? 0 : battle.cars.length - 1;
    const pos = findOpenCell(battle, { car: edgeCar, lane: spec.lane }, spec.side);
    if (!pos) {
      addLog(battle, `${def.name}は足場を得られず、次の機会をうかがっている。`, "info");
      return false;
    }
    const difficultyScale = battle.difficulty === "story" ? 0.8 : 1;
    const assistScale = battle.assist ? 0.85 : 1;
    const difficultyHp = Math.max(1, Math.ceil(def.maxHp * difficultyScale * assistScale));
    const unit = {
      uid: `enemy_${battle.nextEnemyId++}`,
      type: def.id,
      hp: difficultyHp,
      maxHp: difficultyHp,
      pos,
      shield: 0,
      armor: def.armor || 0,
      marked: 0,
      stunned: 0,
      intent: null,
      spawnedRound: battle.round
    };
    battle.enemies.push(unit);
    addLog(battle, `${def.name}が${DATA.lanes[pos.lane]}へ侵入。`, "enemy");
    return true;
  }

  function spawnRound(battle, round) {
    const encounter = DATA.encounters[battle.encounterId];
    const pending = encounter.spawns.filter((spawn, index) => spawn.round === round && !battle.spawned.includes(index));
    for (const spawn of pending) {
      const index = encounter.spawns.indexOf(spawn);
      spawnEnemy(battle, spawn);
      battle.spawned.push(index);
    }
    if (round === 2 && battle.encounterFlags && battle.encounterFlags.c1_extra_enemy && battle.encounterId === "c1_switchyard") {
      if (!battle.extraSpawned && spawnEnemy(battle, { type: "raider", side: "front", lane: 2 })) battle.extraSpawned = true;
    }
    if (round === 2 && battle.encounterFlags && battle.encounterFlags.c3_extra_parasite && battle.encounterId === "c3_rootway") {
      if (!battle.extraParasiteSpawned && spawnEnemy(battle, { type: "parasite", side: "front", lane: 2 })) battle.extraParasiteSpawned = true;
    }
  }

  function createBattle(game, encounterId) {
    const encounter = DATA.encounters[encounterId];
    if (!encounter) throw new Error(`Unknown encounter: ${encounterId}`);
    const carsState = clone(game.train);
    const starts = [
      { car: 0, lane: 1 },
      { car: Math.min(1, carsState.length - 1), lane: 1 },
      { car: 0, lane: 0 },
      { car: Math.min(1, carsState.length - 1), lane: 2 }
    ];
    const moraleHpPenalty = game.resources.morale <= 2 ? 1 : 0;
    const battleCrew = game.activeCrew.slice(0, 4).map((id, index) => {
      const persistent = game.crew[id];
      const def = DATA.crew[id];
      return {
        uid: `crew_${id}`,
        id,
        hp: Math.max(1, Math.min(persistent.hp, persistent.maxHp - moraleHpPenalty)),
        maxHp: persistent.maxHp - moraleHpPenalty,
        ap: 2,
        maxAp: 2,
        level: persistent.level || 1,
        pos: starts[index],
        shield: 0,
        cooldowns: Object.fromEntries(def.skills.map(skill => [skill.id, 0])),
        guardedOnce: false
      };
    });
    const battle = {
      encounterId,
      difficulty: game.difficulty,
      round: 1,
      phase: "player",
      steam: (game.resources.morale >= 8 ? 4 : 3) + (game.bonuses?.startSteam || 0),
      maxSteam: 8 + Math.max(0, (carsState.find(car => car.type === "engine") || { level: 1 }).level - 1) + (game.bonuses?.maxSteam || 0),
      morale: game.resources.morale,
      crewDamageBonus: game.bonuses?.crewDamage || 0,
      efficiency: game.bonuses?.efficiency || 0,
      rng: hashSeed(`${game.createdAt}:${encounterId}:${game.stats.retries[encounterId] || 0}`),
      cars: carsState,
      crew: battleCrew,
      enemies: [],
      spawned: [],
      nextEnemyId: 1,
      log: [],
      mines: [],
      encounterFlags: clone(game.flags),
      stats: { enemiesDefeated: 0, damageTaken: 0, carDamageTaken: 0, repairs: 0 },
      startedAt: Date.now(),
      reward: clone(encounter.reward || {}),
      assist: Boolean(game.assistedBattles?.[encounterId]),
      undo: null,
      result: null
    };
    if (game.bonuses?.startBarrier) battle.cars.forEach(car => { car.barrier = (car.barrier || 0) + game.bonuses.startBarrier; });
    battle.steam = Math.min(battle.steam, battle.maxSteam);
    spawnRound(battle, 1);
    if (encounterId === "c5_boss" && game.flags.c5_helped_alba) {
      const boss = battle.enemies.find(enemy => enemy.type === "isberg");
      if (boss) boss.armor = 0;
    }
    if (encounterId === "c7_boss" && game.flags.c6_promise) {
      const boss = battle.enemies.find(enemy => enemy.type === "nox");
      if (boss) { boss.maxHp = Math.max(1, boss.maxHp - 8); boss.hp = boss.maxHp; }
    }
    computeHazardIntent(battle);
    computeEnemyIntents(battle);
    addLog(battle, encounter.intro, "info");
    game.battle = battle;
    game.updatedAt = Date.now();
    return battle;
  }

  function nearestCrew(battle, enemy) {
    return livingCrew(battle).slice().sort((a, b) => {
      const diff = cellDistance(enemy.pos, a.pos) - cellDistance(enemy.pos, b.pos);
      return diff || a.hp - b.hp || a.uid.localeCompare(b.uid);
    })[0] || null;
  }

  function stepToward(battle, from, to) {
    const options = neighbors(battle, from)
      .filter(pos => !unitAt(battle, pos))
      .sort((a, b) => cellDistance(a, to) - cellDistance(b, to) || a.car - b.car || a.lane - b.lane);
    return options[0] || null;
  }

  function computeIntent(battle, enemy) {
    const def = DATA.enemies[enemy.type];
    if (enemy.stunned > 0) return { kind: "wait", label: "信号中断", detail: "このラウンドは行動しない" };

    if (def.ai === "bossVarga" || def.ai === "boss") {
      const targetCar = (battle.round + enemy.pos.car) % battle.cars.length;
      return {
        kind: "bombardCar",
        targetCar,
        amount: difficultyDamage(battle, def.damage + (enemy.bonusDamage || 0)),
        label: "砲撃",
        detail: `${DATA.cars[battle.cars[targetCar].type].name}へ${difficultyDamage(battle, def.damage)}損傷`
      };
    }

    if (def.ai === "car") {
      return {
        kind: "attackCar",
        targetCar: enemy.pos.car,
        amount: difficultyDamage(battle, def.damage + (enemy.bonusDamage || 0)),
        corrosion: def.corrosion || 0,
        label: "車両破壊",
        detail: `${DATA.cars[battle.cars[enemy.pos.car].type].name}へ${difficultyDamage(battle, def.damage)}損傷`
      };
    }

    if (def.ai === "steam" && battle.steam > 0) {
      return { kind: "drainSteam", amount: def.drain || 1, label: "吸熱", detail: `蒸気を${def.drain || 1}奪う` };
    }

    if (def.ai === "support") {
      const ally = livingEnemies(battle).filter(unit => unit.uid !== enemy.uid).sort((a, b) => a.hp - b.hp)[0];
      if (ally) return { kind: "buffEnemy", targetId: ally.uid, amount: 1, label: "増幅信号", detail: `${DATA.enemies[ally.type].name}へ障壁2・攻撃+1` };
    }

    const target = nearestCrew(battle, enemy);
    if (!target) return { kind: "wait", label: "待機", detail: "標的なし" };
    const distance = cellDistance(enemy.pos, target.pos);
    if (distance <= Math.max(1, def.range)) {
      if (def.ai === "bomb") {
        return { kind: "areaCell", targetPos: clone(target.pos), amount: difficultyDamage(battle, def.damage + (enemy.bonusDamage || 0)), label: "範囲爆破", detail: `${formatPos(target.pos)}と隣接区画へ${difficultyDamage(battle, def.damage + (enemy.bonusDamage || 0))}ダメージ` };
      }
      return { kind: "attackCell", targetPos: clone(target.pos), amount: difficultyDamage(battle, def.damage + (enemy.bonusDamage || 0)), label: "攻撃", detail: `${formatPos(target.pos)}へ${difficultyDamage(battle, def.damage + (enemy.bonusDamage || 0))}ダメージ` };
    }
    const destination = stepToward(battle, enemy.pos, target.pos);
    return destination
      ? { kind: "move", targetPos: destination, label: "接近", detail: `${formatPos(destination)}へ移動` }
      : { kind: "wait", label: "足止め", detail: "移動先なし" };
  }

  function difficultyDamage(battle, amount) {
    return battle.difficulty === "story" ? Math.max(1, amount - 1) : amount;
  }

  function computeEnemyIntents(battle) {
    for (const enemy of livingEnemies(battle)) enemy.intent = computeIntent(battle, enemy);
  }

  function formatPos(pos) {
    return `${pos.car + 1}両目・${["上", "中", "下"][pos.lane]}`;
  }

  function getActor(battle, actorId) {
    return battle.crew.find(unit => unit.uid === actorId) || null;
  }

  function getEnemy(battle, enemyId) {
    return battle.enemies.find(unit => unit.uid === enemyId && unit.hp > 0) || null;
  }

  function actionTargetType(kind) {
    if (["grantAp", "swapAlly", "healAlly", "reviveAlly", "refreshAlly"].includes(kind)) return "ally";
    if (["damage", "damagePush", "markEnemy", "stunEnemy", "splashDamage", "analyzeEnemy", "damageEnemy"].includes(kind)) return "enemy";
    if (["repairAnyCar", "shieldCar"].includes(kind)) return "car";
    if (kind === "placeMine") return "cell";
    if (kind === "healSameCar") return "ally";
    return "none";
  }

  function getActions(battle, actorId) {
    const actor = getActor(battle, actorId);
    if (!actor || actor.hp <= 0) return [];
    const def = DATA.crew[actor.id];
    const currentCar = battle.cars[actor.pos.car];
    const carDef = DATA.cars[currentCar.type];
    const actions = [
      { key: "move", name: "移動", text: "隣の空いている区画へ移動", ap: 1, targetType: "cell", enabled: actor.ap >= 1 },
      { key: "attack", name: "攻撃", text: `射程${def.range}・${def.damage + (battle.crewDamageBonus || 0)}ダメージ`, ap: 1, targetType: "enemy", enabled: actor.ap >= 1 },
      { key: "repair", name: "応急修理", text: `今いる車両の耐久を${actor.id === "gaku" ? 2 : 1}回復`, ap: 1, targetType: "none", enabled: actor.ap >= 1 && currentCar.hp < currentCar.maxHp }
    ];
    for (const skill of def.skills) {
      actions.push({
        key: `skill:${skill.id}`,
        name: skill.name,
        text: skill.text,
        ap: skill.ap,
        steam: skill.steam,
        targetType: actionTargetType(skill.kind),
        enabled: actor.ap >= skill.ap && battle.steam >= skill.steam && (actor.cooldowns[skill.id] || 0) <= 0,
        cooldown: actor.cooldowns[skill.id] || 0
      });
    }
    if (carDef.operation) {
      const op = carDef.operation;
      const operationSteam = Math.max(0, (op.cost || 0) - (currentCar.type === "cannon" ? (battle.efficiency || 0) : 0));
      actions.push({
        key: "operate",
        name: op.name,
        text: op.text,
        ap: 1,
        steam: operationSteam,
        targetType: actionTargetType(op.kind),
        enabled: actor.ap >= 1 && battle.steam >= operationSteam && battle.morale >= (op.morale || 0) && currentCar.operatedRound !== battle.round
      });
    }
    return actions;
  }

  function getTargets(battle, actorId, actionKey) {
    const actor = getActor(battle, actorId);
    if (!actor || actor.hp <= 0) return [];
    const def = DATA.crew[actor.id];
    if (actionKey === "move") {
      return neighbors(battle, actor.pos).filter(pos => !unitAt(battle, pos)).map(pos => ({ type: "cell", pos }));
    }
    if (actionKey === "attack") {
      const darkness = DATA.encounters[battle.encounterId].hazard?.type === "darkness" && !battle.cars.some(car => car.type === "observatory" && car.hp > 0);
      const attackRange = darkness ? Math.min(2, def.range) : def.range;
      return livingEnemies(battle).filter(enemy => cellDistance(actor.pos, enemy.pos) <= attackRange).map(enemy => ({ type: "enemy", id: enemy.uid }));
    }
    if (actionKey === "repair") return [{ type: "none" }];

    let effect;
    if (actionKey === "operate") effect = DATA.cars[battle.cars[actor.pos.car].type].operation;
    else if (actionKey.startsWith("skill:")) effect = def.skills.find(skill => `skill:${skill.id}` === actionKey);
    if (!effect) return [];
    const type = actionTargetType(effect.kind);
    let range = typeof effect.range === "number" ? effect.range : 99;
    if (DATA.encounters[battle.encounterId].hazard?.type === "darkness" && !battle.cars.some(car => car.type === "observatory" && car.hp > 0)) range = Math.min(2, range);
    if (type === "none") return [{ type: "none" }];
    if (type === "enemy") {
      return livingEnemies(battle).filter(enemy => cellDistance(actor.pos, enemy.pos) <= range).map(enemy => ({ type: "enemy", id: enemy.uid }));
    }
    if (type === "ally") {
      return battle.crew.filter(ally => {
        const distanceOk = cellDistance(actor.pos, ally.pos) <= range;
        if (!distanceOk) return false;
        if (effect.kind === "reviveAlly") return ally.hp <= 0 && !unitAt(battle, ally.pos);
        if (effect.kind === "healSameCar") return ally.hp > 0 && ally.hp < ally.maxHp && ally.pos.car === actor.pos.car;
        if (effect.kind === "swapAlly" && ally.uid === actor.uid) return false;
        return ally.hp > 0;
      }).map(ally => ({ type: "ally", id: ally.uid }));
    }
    if (type === "car") return battle.cars.map((car, index) => ({ type: "car", index }));
    if (type === "cell") {
      const cells = [];
      for (let car = 0; car < battle.cars.length; car += 1) {
        for (let lane = 0; lane < 3; lane += 1) {
          const pos = { car, lane };
          if (!unitAt(battle, pos) && cellDistance(actor.pos, pos) <= range && !battle.mines.some(mine => posKey(mine.pos) === posKey(pos))) {
            cells.push({ type: "cell", pos });
          }
        }
      }
      return cells;
    }
    return [];
  }

  function targetMatches(targets, target) {
    if (!target) return targets.some(item => item.type === "none");
    return targets.some(item => {
      if (item.type !== target.type) return false;
      if (item.type === "cell") return posKey(item.pos) === posKey(target.pos);
      if (item.type === "car") return item.index === target.index;
      return item.id === target.id;
    });
  }

  function absorbShield(unit, amount) {
    const key = Object.prototype.hasOwnProperty.call(unit, "barrier") ? "barrier" : "shield";
    const absorbed = Math.min(unit[key] || 0, amount);
    unit[key] = Math.max(0, (unit[key] || 0) - absorbed);
    return amount - absorbed;
  }

  function damageCrew(battle, unit, amount) {
    const def = DATA.crew[unit.id];
    if (def.passive.id === "guard" && !unit.guardedOnce) {
      amount = Math.max(0, amount - 2);
      unit.guardedOnce = true;
    }
    amount = absorbShield(unit, amount);
    if (amount <= 0) return 0;
    unit.hp = Math.max(0, unit.hp - amount);
    battle.stats.damageTaken += amount;
    addLog(battle, `${def.name}が${amount}ダメージ。${unit.hp <= 0 ? "戦闘不能！" : ""}`, unit.hp <= 0 ? "danger" : "enemy");
    return amount;
  }

  function damageEnemy(battle, enemy, amount, options = {}) {
    const def = DATA.enemies[enemy.type];
    amount += enemy.marked > 0 ? 1 : 0;
    if (!options.ignoreArmor) amount = Math.max(0, amount - (enemy.armor || 0));
    amount = absorbShield(enemy, amount);
    if (amount <= 0) {
      addLog(battle, `${def.name}の装甲が攻撃を弾いた。`, "info");
      return 0;
    }
    enemy.hp = Math.max(0, enemy.hp - amount);
    addLog(battle, `${def.name}へ${amount}ダメージ。`, "player");
    if (enemy.hp <= 0) {
      battle.stats.enemiesDefeated += 1;
      addLog(battle, `${def.name}を排除した。`, "good");
    }
    return amount;
  }

  function damageCar(battle, index, amount) {
    const car = battle.cars[index];
    if (!car) return 0;
    amount = absorbShield(car, amount);
    if (amount <= 0) return 0;
    const before = car.hp;
    car.hp = Math.max(0, car.hp - amount);
    const dealt = before - car.hp;
    battle.stats.carDamageTaken += dealt;
    addLog(battle, `${DATA.cars[car.type].name}が${dealt}損傷。${car.hp <= 0 ? "設備停止！" : ""}`, car.hp <= 0 ? "danger" : "enemy");
    return dealt;
  }

  function repairCar(battle, index, amount) {
    const car = battle.cars[index];
    if (!car || car.hp <= 0 && car.type === "engine") return 0;
    const before = car.hp;
    car.hp = Math.min(car.maxHp, car.hp + amount);
    const healed = car.hp - before;
    battle.stats.repairs += healed;
    if (healed) addLog(battle, `${DATA.cars[car.type].name}を${healed}修理。`, "good");
    return healed;
  }

  function pushEnemy(battle, actor, enemy) {
    const options = neighbors(battle, enemy.pos)
      .filter(pos => !unitAt(battle, pos))
      .sort((a, b) => cellDistance(b, actor.pos) - cellDistance(a, actor.pos));
    if (options[0]) {
      enemy.pos = options[0];
      triggerMine(battle, enemy);
      addLog(battle, `${DATA.enemies[enemy.type].name}を押し出した。`, "player");
    }
  }

  function triggerMine(battle, enemy) {
    const index = battle.mines.findIndex(mine => posKey(mine.pos) === posKey(enemy.pos));
    if (index < 0) return;
    const mine = battle.mines[index];
    battle.mines.splice(index, 1);
    addLog(battle, "設置爆薬が起爆した。", "player");
    damageEnemy(battle, enemy, mine.power, { ignoreArmor: true });
  }

  function executeEffect(battle, actor, effect, target) {
    switch (effect.kind) {
      case "grantAp": {
        const ally = getActor(battle, target.id);
        ally.ap = Math.min(3, ally.ap + effect.power);
        addLog(battle, `${DATA.crew[ally.id].name}へ号令。AP+${effect.power}。`, "good");
        break;
      }
      case "swapAlly": {
        const ally = getActor(battle, target.id);
        const old = actor.pos;
        actor.pos = ally.pos;
        ally.pos = old;
        actor.shield += effect.power;
        ally.shield += effect.power;
        addLog(battle, `${DATA.crew[actor.id].name}と${DATA.crew[ally.id].name}が位置交換。`, "good");
        break;
      }
      case "repairCar": repairCar(battle, actor.pos.car, effect.power); break;
      case "gainSteam": {
        const gained = Math.min(effect.power, battle.maxSteam - battle.steam);
        battle.steam += gained;
        addLog(battle, `蒸気が${gained}増えた。`, "good");
        break;
      }
      case "damagePush": {
        const enemy = getEnemy(battle, target.id);
        if (enemy && damageEnemy(battle, enemy, effect.power) && enemy.hp > 0) pushEnemy(battle, actor, enemy);
        break;
      }
      case "selfGuard": {
        actor.shield += effect.power;
        for (const enemy of livingEnemies(battle).filter(unit => unit.pos.car === actor.pos.car)) {
          enemy.intent = { kind: "attackCell", targetPos: clone(actor.pos), amount: difficultyDamage(battle, DATA.enemies[enemy.type].damage), label: "挑発攻撃", detail: `${DATA.crew[actor.id].name}へ攻撃` };
        }
        addLog(battle, `${DATA.crew[actor.id].name}が防御態勢。障壁${effect.power}。`, "good");
        break;
      }
      case "healAlly":
      case "healSameCar": {
        const ally = getActor(battle, target.id);
        const before = ally.hp;
        ally.hp = Math.min(ally.maxHp, ally.hp + effect.power);
        addLog(battle, `${DATA.crew[ally.id].name}を${ally.hp - before}回復。`, "good");
        break;
      }
      case "reviveAlly": {
        const ally = battle.crew.find(unit => unit.uid === target.id);
        ally.hp = effect.power;
        addLog(battle, `${DATA.crew[ally.id].name}が戦線復帰。`, "good");
        break;
      }
      case "damage":
      case "damageEnemy": {
        const enemy = getEnemy(battle, target.id);
        if (enemy) damageEnemy(battle, enemy, effect.power);
        break;
      }
      case "markEnemy": {
        const enemy = getEnemy(battle, target.id);
        enemy.marked = Math.max(enemy.marked, effect.power);
        addLog(battle, `${DATA.enemies[enemy.type].name}に照準を合わせた。`, "good");
        break;
      }
      case "stunEnemy": {
        const enemy = getEnemy(battle, target.id);
        enemy.stunned = effect.power;
        enemy.intent = { kind: "wait", label: "信号中断", detail: "このラウンドは行動しない" };
        addLog(battle, `${DATA.enemies[enemy.type].name}の行動を中断した。`, "good");
        break;
      }
      case "areaDamage": {
        const targets = livingEnemies(battle).filter(enemy => enemy.pos.car === actor.pos.car);
        for (const enemy of targets) damageEnemy(battle, enemy, effect.power);
        break;
      }
      case "splashDamage": {
        const primary = getEnemy(battle, target.id);
        if (!primary) break;
        const origin = clone(primary.pos);
        for (const enemy of livingEnemies(battle).filter(unit => cellDistance(origin, unit.pos) <= 1)) damageEnemy(battle, enemy, effect.power, { ignoreArmor: true });
        break;
      }
      case "placeMine":
        battle.mines.push({ pos: clone(target.pos), power: effect.power });
        addLog(battle, `${formatPos(target.pos)}へ爆薬を設置。`, "good");
        break;
      case "analyzeEnemy": {
        const enemy = getEnemy(battle, target.id);
        enemy.armor = 0;
        enemy.shield = 0;
        damageEnemy(battle, enemy, effect.power, { ignoreArmor: true });
        addLog(battle, `${DATA.enemies[enemy.type].name}の防御を解析。`, "good");
        break;
      }
      case "refreshAlly": {
        const ally = getActor(battle, target.id);
        for (const key of Object.keys(ally.cooldowns)) ally.cooldowns[key] = Math.max(0, ally.cooldowns[key] - effect.power);
        addLog(battle, `${DATA.crew[ally.id].name}へ次の指示を出した。`, "good");
        break;
      }
      case "repairAnyCar": repairCar(battle, target.index, effect.power); break;
      case "shieldCar": {
        battle.cars[target.index].barrier += effect.power;
        addLog(battle, `${DATA.cars[battle.cars[target.index].type].name}へ障壁${effect.power}。`, "good");
        break;
      }
      case "teamShield":
        for (const ally of livingCrew(battle)) ally.shield += effect.power;
        battle.morale = Math.max(0, battle.morale - (effect.morale || 0));
        addLog(battle, `乗員全員へ障壁${effect.power}。`, "good");
        break;
      case "releaseHeat":
        battle.steam = Math.min(battle.maxSteam, battle.steam + effect.power);
        addLog(battle, `蓄熱車から蒸気${effect.power}を放出。`, "good");
        break;
      default: throw new Error(`Unsupported effect: ${effect.kind}`);
    }
  }

  function performAction(battle, actorId, actionKey, target = null) {
    if (!battle || battle.phase !== "player") return { ok: false, error: "現在は行動できません" };
    const actor = getActor(battle, actorId);
    if (!actor || actor.hp <= 0) return { ok: false, error: "行動できる乗員ではありません" };
    const descriptor = getActions(battle, actorId).find(action => action.key === actionKey);
    if (!descriptor || !descriptor.enabled) return { ok: false, error: "その行動は使用できません" };
    const targets = getTargets(battle, actorId, actionKey);
    if (!targetMatches(targets, target)) return { ok: false, error: "対象が範囲外です" };

    if (actionKey === "move") {
      battle.undo = { actorId: actor.uid, from: clone(actor.pos), to: clone(target.pos), apBefore: actor.ap };
      actor.pos = clone(target.pos);
      addLog(battle, `${DATA.crew[actor.id].name}が${formatPos(actor.pos)}へ移動。`, "player");
    } else if (actionKey === "attack") {
      battle.undo = null;
      const enemy = getEnemy(battle, target.id);
      damageEnemy(battle, enemy, DATA.crew[actor.id].damage + (battle.crewDamageBonus || 0), { ignoreArmor: DATA.crew[actor.id].passive.id === "breacher" });
    } else if (actionKey === "repair") {
      battle.undo = null;
      repairCar(battle, actor.pos.car, actor.id === "gaku" ? 2 : 1);
    } else {
      battle.undo = null;
      let effect;
      if (actionKey === "operate") effect = DATA.cars[battle.cars[actor.pos.car].type].operation;
      else effect = DATA.crew[actor.id].skills.find(skill => actionKey === `skill:${skill.id}`);
      battle.steam -= descriptor.steam || 0;
      executeEffect(battle, actor, effect, target);
      if (actionKey === "operate") battle.cars[actor.pos.car].operatedRound = battle.round;
      if (actionKey.startsWith("skill:")) actor.cooldowns[effect.id] = effect.cooldown;
    }
    actor.ap -= descriptor.ap;
    const result = checkBattleEnd(battle, false);
    return { ok: true, result };
  }

  function resolveIntent(battle, enemy) {
    const intent = enemy.intent;
    const def = DATA.enemies[enemy.type];
    if (!intent || enemy.hp <= 0) return;
    switch (intent.kind) {
      case "wait": addLog(battle, `${def.name}は行動できない。`, "info"); break;
      case "move":
        if (!unitAt(battle, intent.targetPos)) {
          enemy.pos = clone(intent.targetPos);
          triggerMine(battle, enemy);
        }
        break;
      case "attackCell": {
        const target = battle.crew.find(unit => unit.hp > 0 && posKey(unit.pos) === posKey(intent.targetPos));
        if (target) damageCrew(battle, target, intent.amount);
        else addLog(battle, `${def.name}の攻撃は空を切った。`, "good");
        break;
      }
      case "areaCell": {
        const affected = battle.crew.filter(unit => unit.hp > 0 && cellDistance(unit.pos, intent.targetPos) <= 1);
        if (!affected.length) addLog(battle, `${def.name}の爆破を全員が回避。`, "good");
        for (const target of affected) damageCrew(battle, target, intent.amount);
        break;
      }
      case "attackCar":
      case "bombardCar": damageCar(battle, intent.targetCar, intent.amount); break;
      case "drainSteam": {
        const drained = Math.min(battle.steam, intent.amount);
        battle.steam -= drained;
        addLog(battle, `${def.name}が蒸気を${drained}奪った。`, "enemy");
        break;
      }
      case "buffEnemy": {
        const ally = getEnemy(battle, intent.targetId);
        if (ally) {
          ally.shield += 2;
          ally.bonusDamage = (ally.bonusDamage || 0) + intent.amount;
          addLog(battle, `${DATA.enemies[ally.type].name}の攻撃信号が増幅。`, "enemy");
        }
        break;
      }
      default: break;
    }
  }

  function hazardInterval(battle, hazard) {
    const fastFlood = battle.encounterFlags?.c2_fast_flood && hazard.type === "flood" ? 1 : 0;
    return Math.max(1, (hazard.every || 1) - fastFlood);
  }

  function computeHazardIntent(battle) {
    const hazard = DATA.encounters[battle.encounterId].hazard;
    battle.hazardIntent = null;
    if (!hazard || battle.round % hazardInterval(battle, hazard) !== 0) return;
    const targetCar = battle.round % battle.cars.length;
    const targetLane = battle.round % 3;
    if (hazard.type === "flood") {
      battle.hazardIntent = { kind: "lane", targetLane, text: `${["上", "中", "下"][targetLane]}通路へ浸水・${hazard.damage}ダメージ` };
    } else if (hazard.type === "corrosion") {
      const weakest = battle.cars.map((car, index) => ({ index, ratio: car.hp / car.maxHp })).sort((a, b) => a.ratio - b.ratio || a.index - b.index)[0];
      battle.hazardIntent = { kind: "car", targetCar: weakest.index, text: `${DATA.cars[battle.cars[weakest.index].type].name}へ腐食${hazard.damage}` };
    } else if (["darkness", "bombard"].includes(hazard.type)) {
      battle.hazardIntent = { kind: "car", targetCar, text: `${DATA.cars[battle.cars[targetCar].type].name}へ${hazard.damage}損傷` };
    } else if (hazard.type === "freezeCrack" || hazard.type === "roughTrack") {
      battle.hazardIntent = { kind: "allCars", text: `全車両へ${hazard.damage}損傷` };
    } else if (hazard.type === "freeze") {
      battle.hazardIntent = { kind: "steam", text: "次ラウンド開始時の蒸気-1" };
    } else if (hazard.type === "night") {
      const mode = battle.round % 3;
      battle.hazardIntent = mode === 0
        ? { kind: "steam", text: "蒸気を3吸収" }
        : mode === 1
          ? { kind: "lane", targetLane, text: `${["上", "中", "下"][targetLane]}通路へ${hazard.damage}ダメージ` }
          : { kind: "car", targetCar, text: `${DATA.cars[battle.cars[targetCar].type].name}へ${hazard.damage}損傷` };
    }
  }

  function applyHazard(battle) {
    const encounter = DATA.encounters[battle.encounterId];
    const hazard = encounter.hazard;
    const intent = battle.hazardIntent;
    if (!hazard || !intent) return;
    addLog(battle, `${hazard.text}`, "danger");
    if (intent.kind === "lane") {
      battle.crew.filter(unit => unit.hp > 0 && unit.pos.lane === intent.targetLane).forEach(unit => damageCrew(battle, unit, hazard.damage));
    } else if (intent.kind === "car") {
      damageCar(battle, intent.targetCar, hazard.damage);
    } else if (intent.kind === "allCars") {
      battle.cars.forEach((car, index) => damageCar(battle, index, hazard.damage));
    } else if (intent.kind === "steam" && hazard.type === "night") {
      const drained = Math.min(3, battle.steam);
      battle.steam -= drained;
      addLog(battle, `夜蝕が蒸気を${drained}吸収。`, "enemy");
    }
  }

  function hasFutureSpawns(battle) {
    const encounter = DATA.encounters[battle.encounterId];
    return encounter.spawns.some((spawn, index) => !battle.spawned.includes(index));
  }

  function checkBattleEnd(battle, afterEnemyPhase) {
    const encounter = DATA.encounters[battle.encounterId];
    const engine = battle.cars.find(car => car.type === "engine");
    if (!engine || engine.hp <= 0 || livingCrew(battle).length === 0) {
      battle.phase = "defeat";
      battle.result = "defeat";
      addLog(battle, "黎明列車は走行を維持できない。", "danger");
      return "defeat";
    }
    if (encounter.objective.type === "survive" && afterEnemyPhase && battle.round >= encounter.objective.rounds) {
      battle.phase = "victory";
      battle.result = "victory";
      addLog(battle, "切替器が作動した。離脱経路を確保。", "good");
      return "victory";
    }
    if (encounter.objective.type === "boss" && !livingEnemies(battle).some(enemy => DATA.enemies[enemy.type].boss)) {
      battle.phase = "victory";
      battle.result = "victory";
      return "victory";
    }
    if (encounter.objective.type === "defeat" && livingEnemies(battle).length === 0 && !hasFutureSpawns(battle)) {
      battle.phase = "victory";
      battle.result = "victory";
      return "victory";
    }
    return null;
  }

  function prepareNextRound(battle) {
    battle.round += 1;
    battle.phase = "player";
    const hazard = DATA.encounters[battle.encounterId].hazard;
    const baseSteam = hazard?.type === "freeze" ? 1 : 2;
    battle.steam = Math.min(battle.maxSteam, battle.steam + baseSteam);
    for (const unit of battle.crew) {
      if (unit.hp > 0) unit.ap = unit.maxAp;
      unit.shield = Math.max(0, unit.shield - 1);
      for (const key of Object.keys(unit.cooldowns)) unit.cooldowns[key] = Math.max(0, unit.cooldowns[key] - 1);
    }
    for (const enemy of livingEnemies(battle)) {
      enemy.marked = Math.max(0, enemy.marked - 1);
      enemy.stunned = Math.max(0, enemy.stunned - 1);
    }
    spawnRound(battle, battle.round);
    computeHazardIntent(battle);
    computeEnemyIntents(battle);
    addLog(battle, `ラウンド${battle.round}。蒸気が${baseSteam}増えた。`, "info");
  }

  function endPlayerTurn(battle) {
    if (!battle || battle.phase !== "player") return { ok: false, error: "ターンを終了できません" };
    battle.phase = "enemy";
    battle.undo = null;
    addLog(battle, "敵の手番。", "info");
    for (const enemy of livingEnemies(battle).slice()) resolveIntent(battle, enemy);
    applyHazard(battle);
    const ended = checkBattleEnd(battle, true);
    if (!ended) prepareNextRound(battle);
    return { ok: true, result: ended };
  }

  function applyReward(game, reward) {
    const labels = [];
    const scrap = (reward.scrap || 0) + (reward.scrap ? (game.bonuses?.bonusScrap || 0) : 0);
    if (scrap) { game.resources.scrap += scrap; labels.push({ key: "scrap", amount: scrap }); }
    if (reward.fuel) { game.resources.fuel += reward.fuel; labels.push({ key: "fuel", amount: reward.fuel }); }
    if (reward.medkits) { game.resources.medkits += reward.medkits; labels.push({ key: "medkits", amount: reward.medkits }); }
    if (reward.morale) { game.resources.morale = clamp(game.resources.morale + reward.morale, 0, 10); labels.push({ key: "morale", amount: reward.morale }); }
    if (reward.record && !game.records.includes(reward.record)) {
      game.records.push(reward.record);
      labels.push({ key: "record", id: reward.record });
    }
    if (reward.unlockCar && !game.unlockedCars.includes(reward.unlockCar)) {
      game.unlockedCars.push(reward.unlockCar);
      const uid = `car_${reward.unlockCar}_${Date.now().toString(36)}`;
      if (game.train.length < 6) game.train.push(createCarState(reward.unlockCar, uid));
      labels.push({ key: "car", id: reward.unlockCar });
    }
    return labels;
  }

  function completeBattle(game) {
    const battle = game.battle;
    if (!battle || battle.phase !== "victory") return { ok: false, error: "勝利していません" };
    for (const battleCar of battle.cars) {
      const car = game.train.find(item => item.uid === battleCar.uid);
      if (car) { car.hp = battleCar.hp; car.barrier = 0; }
    }
    const hasSui = battle.crew.some(unit => unit.id === "sui" && unit.hp > 0);
    const extraHeal = game.bonuses?.afterHeal || 0;
    for (const battleCrew of battle.crew) {
      const crew = game.crew[battleCrew.id];
      if (crew) crew.hp = Math.min(crew.maxHp, battleCrew.hp + (hasSui && battleCrew.hp > 0 ? 1 : 0) + (battleCrew.hp > 0 ? extraHeal : 0));
    }
    game.resources.morale = battle.morale;
    const rewards = applyReward(game, battle.reward);
    game.stats.battlesWon += 1;
    game.stats.enemiesDefeated += battle.stats.enemiesDefeated;
    game.stats.damageTaken += battle.stats.damageTaken;
    game.stats.carDamageTaken += battle.stats.carDamageTaken;
    game.stats.repairs += battle.stats.repairs;
    game.stats.turns += battle.round;
    game.lastResult = {
      encounterId: battle.encounterId,
      round: battle.round,
      rewards,
      crew: clone(battle.crew),
      cars: clone(battle.cars),
      wasBoss: DATA.encounters[battle.encounterId].objective.type === "boss"
    };
    game.battle = null;
    game.stepIndex += 1;
    game.updatedAt = Date.now();
    return { ok: true, result: game.lastResult };
  }

  function retryBattle(game, useAssist = false) {
    if (!game.battle || game.battle.phase !== "defeat") return { ok: false, error: "再戦できません" };
    const encounterId = game.battle.encounterId;
    game.stats.battlesLost += 1;
    game.stats.retries[encounterId] = (game.stats.retries[encounterId] || 0) + 1;
    if (useAssist && game.stats.retries[encounterId] >= 2) game.assistedBattles[encounterId] = true;
    createBattle(game, encounterId);
    return { ok: true };
  }

  function undoMove(battle) {
    if (!battle || battle.phase !== "player" || !battle.undo) return { ok: false, error: "取り消せる移動がありません" };
    const undo = battle.undo;
    const actor = getActor(battle, undo.actorId);
    if (!actor || posKey(actor.pos) !== posKey(undo.to) || unitAt(battle, undo.from)) return { ok: false, error: "移動後の状態が変化したため取り消せません" };
    actor.pos = clone(undo.from);
    actor.ap = undo.apBefore;
    battle.undo = null;
    addLog(battle, `${DATA.crew[actor.id].name}の移動を取り消した。`, "info");
    return { ok: true };
  }

  function applyEffects(game, effects = {}) {
    for (const key of ["fuel", "scrap", "medkits"]) {
      if (effects[key]) game.resources[key] = Math.max(0, game.resources[key] + effects[key]);
    }
    if (effects.morale) game.resources.morale = clamp(game.resources.morale + effects.morale, 0, 10);
    if (effects.flag) game.flags[effects.flag] = true;
    if (effects.encounterFlag) game.flags[effects.encounterFlag] = true;
    if (effects.record && !game.records.includes(effects.record)) game.records.push(effects.record);
    if (effects.rescued && !game.rescued.includes(effects.rescued)) game.rescued.push(effects.rescued);
    if (effects.joinCrew && !game.crew[effects.joinCrew] && DATA.crew[effects.joinCrew]) {
      game.crew[effects.joinCrew] = createCrewState(effects.joinCrew);
      if (game.activeCrew.length < 4) game.activeCrew.push(effects.joinCrew);
    }
    if (effects.unlockCar && !game.unlockedCars.includes(effects.unlockCar)) game.unlockedCars.push(effects.unlockCar);
    if (effects.ending) game.ending = effects.ending;
  }

  function choiceAvailable(game, choice) {
    const req = choice?.requires;
    if (!req) return { ok: true };
    if (req.records && game.records.length < req.records) return { ok: false, reason: `制御記録が${req.records}つ必要` };
    if (req.anyCrew && !req.anyCrew.some(id => game.crew[id])) return { ok: false, reason: "必要な乗員がいない" };
    if (req.flags && !req.flags.every(flag => game.flags[flag])) return { ok: false, reason: "必要な旅の選択が不足" };
    if (req.resources) {
      for (const [key, amount] of Object.entries(req.resources)) {
        if ((game.resources[key] || 0) < amount) return { ok: false, reason: `${key}が${amount}必要` };
      }
    }
    return { ok: true };
  }

  function completeEvent(game, choiceIndex = null) {
    const step = getStep(game);
    if (!step || step.type !== "event") return { ok: false, error: "現在はイベントではありません" };
    const event = DATA.events[step.id];
    if (event.choices) {
      if (!Number.isInteger(choiceIndex) || !event.choices[choiceIndex]) return { ok: false, error: "その選択肢は選べません" };
      const available = choiceAvailable(game, event.choices[choiceIndex]);
      if (!available.ok) return { ok: false, error: available.reason };
      applyEffects(game, event.choices[choiceIndex].effects);
      game.flags[`choice_${event.id}`] = choiceIndex;
      game.stats.choices += 1;
    }
    game.stepIndex += 1;
    game.updatedAt = Date.now();
    return { ok: true };
  }

  function chooseRoute(game, optionId) {
    const step = getStep(game);
    if (!step || step.type !== "route") return { ok: false, error: "現在は路線選択ではありません" };
    const option = step.options.find(item => item.id === optionId);
    if (!option) return { ok: false, error: "路線が見つかりません" };
    const fuelCost = (option.cost && option.cost.fuel) || 0;
    if (game.resources.fuel < fuelCost) {
      const shortage = fuelCost - game.resources.fuel;
      game.resources.fuel = 0;
      game.resources.morale = Math.max(0, game.resources.morale - 1);
      game.train.forEach(car => { car.hp = Math.max(1, car.hp - shortage * 2); });
      game.flags.emergencyRouteUsed = true;
    } else {
      game.resources.fuel -= fuelCost;
    }
    game.routeChoices[`${getChapter(game).id}:${step.id}`] = option.id;
    createBattle(game, option.battle);
    return { ok: true };
  }

  function startCurrentBattle(game) {
    const step = getStep(game);
    if (!step || !["battle", "boss"].includes(step.type)) return { ok: false, error: "現在は戦闘地点ではありません" };
    createBattle(game, step.id);
    return { ok: true };
  }

  function completeGarage(game) {
    const step = getStep(game);
    if (!step || step.type !== "garage") return { ok: false, error: "現在は整備地点ではありません" };
    game.stepIndex += 1;
    game.updatedAt = Date.now();
    return { ok: true };
  }

  function repairPersistentCar(game, uid) {
    const car = game.train.find(item => item.uid === uid);
    if (!car) return { ok: false, error: "車両がありません" };
    if (car.hp >= car.maxHp) return { ok: false, error: "損傷はありません" };
    if (game.resources.scrap <= 0) return { ok: false, error: "部品が足りません" };
    const amount = Math.min(4, car.maxHp - car.hp);
    car.hp += amount;
    game.resources.scrap -= 1;
    game.updatedAt = Date.now();
    return { ok: true, amount };
  }

  function healPersistentCrew(game, id) {
    const crew = game.crew[id];
    if (!crew) return { ok: false, error: "乗員がいません" };
    if (crew.hp >= crew.maxHp) return { ok: false, error: "負傷はありません" };
    if (game.resources.medkits <= 0) return { ok: false, error: "医療品が足りません" };
    const amount = Math.min(5, crew.maxHp - crew.hp);
    crew.hp += amount;
    game.resources.medkits -= 1;
    game.updatedAt = Date.now();
    return { ok: true, amount };
  }

  function moveCar(game, uid, direction) {
    const index = game.train.findIndex(item => item.uid === uid);
    if (index < 0) return { ok: false, error: "車両がありません" };
    const target = index + direction;
    if (target < 1 || target >= game.train.length || game.train[index].type === "engine") return { ok: false, error: "その位置へは動かせません" };
    [game.train[index], game.train[target]] = [game.train[target], game.train[index]];
    game.updatedAt = Date.now();
    return { ok: true };
  }

  function toggleActiveCrew(game, id) {
    if (!game.crew[id]) return { ok: false, error: "乗員がいません" };
    const index = game.activeCrew.indexOf(id);
    if (index >= 0) {
      if (game.activeCrew.length <= 2) return { ok: false, error: "出撃者は最低2人必要です" };
      game.activeCrew.splice(index, 1);
    } else {
      if (game.activeCrew.length >= 4) return { ok: false, error: "出撃できるのは4人までです" };
      game.activeCrew.push(id);
    }
    game.updatedAt = Date.now();
    return { ok: true };
  }

  function upgradeCar(game, uid) {
    const car = game.train.find(item => item.uid === uid);
    if (!car) return { ok: false, error: "車両がありません" };
    if (car.level >= 3) return { ok: false, error: "最大強化です" };
    const cost = 4 + car.level * 3;
    if (game.resources.scrap < cost) return { ok: false, error: `部品が${cost}必要です` };
    game.resources.scrap -= cost;
    car.level += 1;
    car.maxHp += 3;
    car.hp += 3;
    game.updatedAt = Date.now();
    return { ok: true, cost };
  }

  function refitCar(game, uid, type) {
    const car = game.train.find(item => item.uid === uid);
    if (!car || car.type === "engine") return { ok: false, error: "換装できない車両です" };
    if (!game.unlockedCars.includes(type) || type === "engine") return { ok: false, error: "未解禁の設計です" };
    if (car.type === type) return { ok: false, error: "同じ車種です" };
    const cost = 4;
    if (game.resources.scrap < cost) return { ok: false, error: `部品が${cost}必要です` };
    const ratio = car.hp / car.maxHp;
    car.type = type;
    car.level = 1;
    car.maxHp = DATA.cars[type].maxHp;
    car.hp = Math.max(1, Math.round(car.maxHp * ratio));
    car.barrier = 0;
    game.resources.scrap -= cost;
    game.updatedAt = Date.now();
    return { ok: true, cost };
  }

  function applyUpgrade(game, upgradeId) {
    const step = getStep(game);
    if (!step || step.type !== "upgrade" || !step.options.includes(upgradeId)) return { ok: false, error: "その強化は選べません" };
    if (game.upgrades.filter(id => id === upgradeId).length >= 2) return { ok: false, error: "この強化は最大レベルです" };
    const upgrade = DATA.upgrades[upgradeId];
    if (!upgrade) return { ok: false, error: "列車強化が見つかりません" };
    game.upgrades.push(upgradeId);
    switch (upgrade.kind) {
      case "carMaxHp":
        game.train.forEach(car => { car.maxHp += upgrade.power; car.hp = Math.min(car.maxHp, car.hp + upgrade.power); });
        break;
      case "steam": game.bonuses.maxSteam += upgrade.power; game.bonuses.startSteam += upgrade.power; break;
      case "crewDamage": game.bonuses.crewDamage += upgrade.power; break;
      case "afterHeal": game.bonuses.afterHeal += upgrade.power; break;
      case "bonusScrap": game.bonuses.bonusScrap += upgrade.power; break;
      case "startBarrier": game.bonuses.startBarrier += upgrade.power; break;
      case "efficiency": game.bonuses.efficiency += upgrade.power; game.resources.fuel += 2; break;
      case "crewMaxHp":
        Object.values(game.crew).forEach(member => { member.maxHp += upgrade.power; member.hp += upgrade.power; });
        break;
      default: return { ok: false, error: "この列車強化には対応していません" };
    }
    game.stepIndex += 1;
    game.updatedAt = Date.now();
    return { ok: true };
  }

  function advanceChapter(game) {
    const step = getStep(game);
    if (!step || step.type !== "chapterEnd") return { ok: false, error: "章末ではありません" };
    if (game.chapterIndex >= DATA.chapters.length - 1) {
      game.completed = true;
      return { ok: true, completed: true };
    }
    game.chapterIndex += 1;
    game.stepIndex = 0;
    game.resources.fuel += game.bonuses?.efficiency ? 2 : 0;
    for (const crew of Object.values(game.crew)) {
      crew.level = Math.min(7, (crew.level || 1) + 1);
      crew.hp = Math.min(crew.maxHp, crew.hp + 3);
    }
    game.updatedAt = Date.now();
    return { ok: true, chapterIndex: game.chapterIndex };
  }

  function getProgress(game) {
    const chapter = getChapter(game);
    const total = chapter && chapter.steps.length ? chapter.steps.length : 1;
    return { chapter: game.chapterIndex + 1, step: game.stepIndex, steps: total, ratio: game.chapterIndex / DATA.chapters.length + (game.stepIndex / total) / DATA.chapters.length };
  }

  DT.Engine = {
    clone,
    clamp,
    hashSeed,
    rngNext,
    createNewGame,
    validateGame,
    createCarState,
    createCrewState,
    getChapter,
    getStep,
    getProgress,
    createBattle,
    getActions,
    getTargets,
    performAction,
    endPlayerTurn,
    completeBattle,
    retryBattle,
    undoMove,
    completeEvent,
    choiceAvailable,
    chooseRoute,
    startCurrentBattle,
    completeGarage,
    repairPersistentCar,
    healPersistentCrew,
    moveCar,
    toggleActiveCrew,
    upgradeCar,
    refitCar,
    applyUpgrade,
    advanceChapter,
    formatPos,
    cellDistance,
    livingCrew,
    livingEnemies,
    unitAt,
    computeEnemyIntents,
    computeHazardIntent,
    checkBattleEnd
  };
})(window.DT);
