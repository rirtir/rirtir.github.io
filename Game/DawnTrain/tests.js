"use strict";

(function (DT) {
  const D = DT.DATA;
  const E = DT.Engine;
  const lines = [];
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) throw new Error(message || "assertion failed");
  }

  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error(`${message || "not equal"}: ${actual} !== ${expected}`);
  }

  function test(name, fn) {
    try {
      fn();
      passed += 1;
      lines.push(`PASS  ${name}`);
    } catch (error) {
      failed += 1;
      lines.push(`FAIL  ${name}\n      ${error.stack || error.message}`);
    }
  }

  function killAndComplete(game) {
    const battle = game.battle;
    battle.enemies.forEach(enemy => { enemy.hp = 0; });
    battle.spawned = D.encounters[battle.encounterId].spawns.map((_, index) => index);
    if (D.encounters[battle.encounterId].objective.type === "survive") {
      battle.phase = "victory";
      battle.result = "victory";
    } else {
      E.checkBattleEnd(battle, true);
    }
    equal(battle.phase, "victory", `${battle.encounterId} should be won`);
    const result = E.completeBattle(game);
    assert(result.ok, result.error);
  }

  test("全データIDがキーと一致する", () => {
    for (const group of [D.crew, D.cars, D.enemies, D.events, D.encounters]) {
      for (const [key, value] of Object.entries(group)) equal(value.id, key, `${key} id mismatch`);
    }
  });

  test("章の参照先が存在する", () => {
    for (const chapter of D.chapters) {
      for (const step of chapter.steps) {
        if (step.type === "event") assert(D.events[step.id], `${chapter.id}: missing event ${step.id}`);
        if (["battle", "boss"].includes(step.type)) assert(D.encounters[step.id], `${chapter.id}: missing battle ${step.id}`);
        if (step.type === "route") step.options.forEach(option => assert(D.encounters[option.battle], `${chapter.id}: missing route battle ${option.battle}`));
        if (step.type === "upgrade") step.options.forEach(id => assert(D.upgrades[id], `${chapter.id}: missing upgrade ${id}`));
      }
    }
  });

  test("全戦闘の敵・報酬・ハザード参照が妥当", () => {
    assert(Object.keys(D.encounters).length >= 35, "encounter count is too small");
    for (const encounter of Object.values(D.encounters)) {
      assert(encounter.objective && encounter.objective.type, `${encounter.id}: objective missing`);
      encounter.spawns.forEach(spawn => assert(D.enemies[spawn.type], `${encounter.id}: missing enemy ${spawn.type}`));
      if (encounter.reward?.unlockCar) assert(D.cars[encounter.reward.unlockCar], `${encounter.id}: missing car reward`);
      if (encounter.hazard) assert(["roughTrack", "flood", "corrosion", "darkness", "freeze", "freezeCrack", "bombard", "night"].includes(encounter.hazard.type), `${encounter.id}: bad hazard`);
    }
  });

  test("新規ゲームが妥当な初期状態を持つ", () => {
    const game = E.createNewGame();
    assert(E.validateGame(game).ok);
    equal(game.chapterIndex, 0);
    equal(game.stepIndex, 0);
    equal(game.train.length, 3);
    equal(game.activeCrew.length, 4);
    equal(E.getStep(game).id, "c1_intro");
  });

  test("2.1新規ゲームは操作ガイドを未完了で開始する", () => {
    const game = E.createNewGame();
    equal(D.version, "2.1.0");
    equal(game.guidance.prologue, false);
    equal(game.guidance.route, 0);
    equal(game.guidance.battle, 0);
    equal(game.guidance.choice, false);
    equal(game.guidance.garage, false);
    equal(game.guidance.garageRepair, false);
    equal(game.guidance.upgrade, false);
    assert(game.guidance.bosses && typeof game.guidance.bosses === "object");
  });

  test("旧セーブは導入を再強制せず2.1操作ガイド状態へ移行する", () => {
    const legacy = E.createNewGame();
    delete legacy.guidance;
    const result = E.validateGame(legacy);
    assert(result.ok, result.error);
    equal(legacy.guidance.prologue, true);
    equal(legacy.guidance.route, 0);
    equal(legacy.guidance.battle, 0);
  });

  test("士気が極端に低いと戦闘中の乗員最大HPが1下がる", () => {
    const game = E.createNewGame();
    game.resources.morale = 2;
    E.createBattle(game, "c1_safe");
    equal(game.battle.crew[0].maxHp, game.crew.kureha.maxHp - 1);
    equal(game.crew.kureha.maxHp, D.crew.kureha.maxHp);
  });

  test("セーブJSON往復で状態が変わらない", () => {
    const game = E.createNewGame();
    E.completeEvent(game);
    const copy = JSON.parse(JSON.stringify(game));
    assert(E.validateGame(copy).ok);
    equal(JSON.stringify(copy), JSON.stringify(game));
  });

  test("戦闘途中のセーブJSONも盤面と予告を完全に保つ", () => {
    const game = E.createNewGame();
    E.completeEvent(game);
    assert(E.chooseRoute(game, "safe").ok);
    const actor = game.battle.crew[0];
    const move = E.getTargets(game.battle, actor.uid, "move")[0];
    assert(E.performAction(game.battle, actor.uid, "move", move).ok);
    E.endPlayerTurn(game.battle);
    const saved = JSON.stringify(game);
    const copy = JSON.parse(saved);
    assert(E.validateGame(copy).ok);
    equal(JSON.stringify(copy), saved);
    equal(copy.battle.round, game.battle.round);
    equal(JSON.stringify(copy.battle.enemies.map(enemy => enemy.intent)), JSON.stringify(game.battle.enemies.map(enemy => enemy.intent)));
  });

  test("破損セーブを拒否する", () => {
    const game = E.createNewGame();
    game.train = [];
    assert(!E.validateGame(game).ok);
  });

  test("版違い・内部破損・不正編成のセーブを拒否する", () => {
    const old = E.createNewGame();
    old.saveVersion = 0;
    assert(!E.validateGame(old).ok);
    const badHp = E.createNewGame();
    badHp.crew.kureha.hp = Number.NaN;
    assert(!E.validateGame(badHp).ok);
    const badParty = E.createNewGame();
    badParty.activeCrew = ["kureha", "kureha"];
    assert(!E.validateGame(badParty).ok);
    const badBattle = E.createNewGame();
    E.createBattle(badBattle, "c1_safe");
    badBattle.battle.enemies[0].pos.lane = 99;
    assert(!E.validateGame(badBattle).ok);
  });

  test("イベント選択が資源とフラグへ反映される", () => {
    const game = E.createNewGame();
    E.completeEvent(game);
    game.stepIndex = 2;
    const before = game.resources.medkits;
    const result = E.completeEvent(game, 0);
    assert(result.ok);
    equal(game.resources.medkits, before + 1);
    assert(game.flags.c1_rescue);
    assert(game.flags.c1_extra_enemy);
  });

  test("路線選択で燃料を消費し戦闘を開始する", () => {
    const game = E.createNewGame();
    E.completeEvent(game);
    const fuel = game.resources.fuel;
    const result = E.chooseRoute(game, "safe");
    assert(result.ok, result.error);
    equal(game.resources.fuel, fuel - 2);
    equal(game.battle.encounterId, "c1_safe");
    equal(game.battle.phase, "player");
  });

  test("移動対象は隣接した空き区画だけ", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_safe");
    const actor = game.battle.crew[0];
    const targets = E.getTargets(game.battle, actor.uid, "move");
    assert(targets.length > 0);
    targets.forEach(target => {
      equal(E.cellDistance(actor.pos, target.pos), 1);
      assert(!E.unitAt(game.battle, target.pos));
    });
  });

  test("移動はAPを1消費する", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_safe");
    const actor = game.battle.crew[0];
    const target = E.getTargets(game.battle, actor.uid, "move")[0];
    const result = E.performAction(game.battle, actor.uid, "move", target);
    assert(result.ok, result.error);
    equal(actor.ap, 1);
    equal(`${actor.pos.car}:${actor.pos.lane}`, `${target.pos.car}:${target.pos.lane}`);
  });

  test("情報を開示しない直前の移動だけ取り消せる", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_safe");
    const actor = game.battle.crew[0];
    const before = { ...actor.pos };
    const target = E.getTargets(game.battle, actor.uid, "move")[0];
    assert(E.performAction(game.battle, actor.uid, "move", target).ok);
    assert(E.undoMove(game.battle).ok);
    equal(`${actor.pos.car}:${actor.pos.lane}`, `${before.car}:${before.lane}`);
    equal(actor.ap, 2);
  });

  test("ガクの焚き増しが蒸気とAPとCDを更新する", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_safe");
    const actor = game.battle.crew.find(unit => unit.id === "gaku");
    game.battle.steam = 1;
    const result = E.performAction(game.battle, actor.uid, "skill:stoke", null);
    assert(result.ok, result.error);
    equal(game.battle.steam, 4);
    equal(actor.ap, 0);
    equal(actor.cooldowns.stoke, 3);
  });

  test("敵の行動予告は対象と効果を持つ", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_risky");
    game.battle.enemies.forEach(enemy => {
      assert(enemy.intent && enemy.intent.kind);
      assert(enemy.intent.label);
      assert(enemy.intent.detail !== undefined);
    });
  });

  test("敵フェーズ後に次ラウンドへ進みAPと蒸気が回復する", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_safe");
    const battle = game.battle;
    battle.crew[0].ap = 0;
    const steam = battle.steam;
    const result = E.endPlayerTurn(battle);
    assert(result.ok);
    equal(battle.round, 2);
    equal(battle.crew[0].ap, 2);
    assert(battle.steam >= steam);
  });

  test("同じ車両設備は1ラウンドに1回だけ操作できる", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_safe");
    const gaku = game.battle.crew.find(unit => unit.id === "gaku");
    const target = E.getTargets(game.battle, gaku.uid, "operate")[0];
    assert(E.performAction(game.battle, gaku.uid, "operate", target).ok);
    assert(!E.getActions(game.battle, gaku.uid).find(action => action.key === "operate").enabled);
  });

  test("車両障壁は損傷より先に消費される", () => {
    const game = E.createNewGame();
    game.bonuses.startBarrier = 3;
    E.createBattle(game, "c1_risky");
    const car = game.battle.cars[0];
    const hp = car.hp;
    E.endPlayerTurn(game.battle);
    game.battle.round = 3;
    game.battle.hazardIntent = { kind: "allCars", text: "test" };
    E.endPlayerTurn(game.battle);
    equal(car.hp, hp, "barrier did not absorb car damage");
    assert(car.barrier < 3, "barrier was not consumed");
  });

  test("機関車破壊で敗北する", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_safe");
    const engine = game.battle.cars.find(car => car.type === "engine");
    engine.hp = 0;
    equal(E.checkBattleEnd(game.battle, false), "defeat");
    equal(game.battle.phase, "defeat");
  });

  test("敗北後の再戦は戦闘開始時の耐久へ戻る", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_safe");
    game.battle.cars[0].hp = 0;
    E.checkBattleEnd(game.battle, false);
    const result = E.retryBattle(game);
    assert(result.ok);
    equal(game.battle.cars[0].hp, game.train[0].hp);
    equal(game.stats.battlesLost, 1);
  });

  test("複数敗北後の一時支援で敵HPが15%下がる", () => {
    const game = E.createNewGame();
    E.createBattle(game, "c1_boss");
    const original = game.battle.enemies.find(enemy => enemy.type === "varga").maxHp;
    game.battle.phase = "defeat";
    E.retryBattle(game, false);
    game.battle.phase = "defeat";
    E.retryBattle(game, true);
    const assisted = game.battle.enemies.find(enemy => enemy.type === "varga").maxHp;
    assert(assisted < original, `${assisted} should be less than ${original}`);
    assert(game.assistedBattles.c1_boss);
  });

  test("全第一章戦闘を生成して勝利精算できる", () => {
    for (const id of ["c1_safe", "c1_risky", "c1_switchyard", "c1_elite", "c1_boss"]) {
      const game = E.createNewGame();
      E.createBattle(game, id);
      killAndComplete(game);
      equal(game.stats.battlesWon, 1, id);
      assert(!game.battle, `${id} battle not cleared`);
    }
  });

  test("全戦闘を生成し1ターン進行して精算できる", () => {
    for (const id of Object.keys(D.encounters)) {
      const game = E.createNewGame("story");
      E.createBattle(game, id);
      assert(game.battle.enemies.every(enemy => enemy.intent), `${id}: missing intent`);
      const turn = E.endPlayerTurn(game.battle);
      assert(turn.ok, `${id}: turn failed`);
      if (game.battle.phase === "defeat") {
        game.battle.cars.forEach(car => { car.hp = car.maxHp; });
        game.battle.crew.forEach(unit => { unit.hp = unit.maxHp; });
        game.battle.phase = "player";
      }
      killAndComplete(game);
    }
  });

  test("第一章の全イベントが順番に完了する", () => {
    const game = E.createNewGame();
    E.completeEvent(game);
    equal(E.getStep(game).type, "route");
    E.chooseRoute(game, "safe");
    killAndComplete(game);
    equal(E.getStep(game).id, "c1_signal");
    E.completeEvent(game, 1);
    E.startCurrentBattle(game); killAndComplete(game);
    equal(E.getStep(game).type, "garage");
    E.completeGarage(game);
    E.startCurrentBattle(game); killAndComplete(game);
    E.startCurrentBattle(game); killAndComplete(game);
    equal(E.getStep(game).type, "upgrade");
    assert(E.applyUpgrade(game, "reinforced").ok);
    equal(E.getStep(game).id, "c1_outro");
    E.completeEvent(game);
    equal(E.getStep(game).type, "chapterEnd");
  });

  test("車両修理と乗員治療は資源を消費する", () => {
    const game = E.createNewGame();
    game.train[1].hp -= 5;
    game.crew.kureha.hp -= 5;
    const scrap = game.resources.scrap;
    const medkits = game.resources.medkits;
    assert(E.repairPersistentCar(game, game.train[1].uid).ok);
    assert(E.healPersistentCrew(game, "kureha").ok);
    equal(game.resources.scrap, scrap - 1);
    equal(game.resources.medkits, medkits - 1);
  });

  test("機関車は先頭から動かせない", () => {
    const game = E.createNewGame();
    assert(!E.moveCar(game, game.train[0].uid, 1).ok);
    assert(E.moveCar(game, game.train[2].uid, -1).ok);
    equal(game.train[1].type, "workshop");
  });

  test("燃料不足でも損傷を受けて路線を進める", () => {
    const game = E.createNewGame();
    E.completeEvent(game);
    game.resources.fuel = 0;
    const hp = game.train[0].hp;
    const result = E.chooseRoute(game, "safe");
    assert(result.ok, result.error);
    assert(game.train[0].hp < hp);
    assert(game.flags.emergencyRouteUsed);
  });

  test("列車強化は効果を適用し物語を進める", () => {
    const game = E.createNewGame();
    game.chapterIndex = 1;
    game.stepIndex = D.chapters[1].steps.findIndex(step => step.type === "upgrade");
    const hp = game.train[0].maxHp;
    assert(E.applyUpgrade(game, "reinforced").ok);
    equal(game.train[0].maxHp, hp + 3);
    equal(game.upgrades[0], "reinforced");
  });

  test("編光は条件不足なら選べず記録3つで選べる", () => {
    const game = E.createNewGame();
    const choice = D.events.c7_decision.choices[2];
    assert(!E.choiceAvailable(game, choice).ok);
    game.records = ["a", "b", "c"];
    game.crew.teto = E.createCrewState("teto");
    assert(E.choiceAvailable(game, choice).ok);
  });

  test("全乗員の固有技を有効対象へ実行できる", () => {
    for (const [crewId, crewDef] of Object.entries(D.crew)) {
      for (const skill of crewDef.skills) {
        const game = E.createNewGame();
        for (const id of Object.keys(D.crew)) if (!game.crew[id]) game.crew[id] = E.createCrewState(id);
        const others = Object.keys(D.crew).filter(id => id !== crewId).slice(0, 3);
        game.activeCrew = [crewId, ...others];
        E.createBattle(game, "c1_safe");
        const battle = game.battle;
        const actor = battle.crew.find(unit => unit.id === crewId);
        actor.pos = { car: 1, lane: 1 };
        actor.ap = 10;
        battle.steam = battle.maxSteam;
        battle.cars[1].hp = Math.max(1, battle.cars[1].hp - 8);
        const allies = battle.crew.filter(unit => unit.uid !== actor.uid);
        const allyPositions = [{ car: 0, lane: 0 }, { car: 0, lane: 1 }, { car: 0, lane: 2 }];
        allies.forEach((unit, index) => { unit.pos = allyPositions[index]; });
        const ally = allies[0];
        ally.hp = skill.kind === "reviveAlly" ? 0 : Math.max(1, ally.maxHp - 5);
        const enemy = E.livingEnemies(battle)[0];
        enemy.pos = { car: 1, lane: 2 };
        const key = `skill:${skill.id}`;
        const targets = E.getTargets(battle, actor.uid, key);
        assert(targets.length > 0, `${crewId}/${skill.id}: no target`);
        const result = E.performAction(battle, actor.uid, key, targets[0].type === "none" ? null : targets[0]);
        assert(result.ok, `${crewId}/${skill.id}: ${result.error}`);
      }
    }
  });

  test("全車種の設備を1回操作できる", () => {
    for (const type of Object.keys(D.cars)) {
      const game = E.createNewGame();
      E.createBattle(game, "c1_safe");
      const battle = game.battle;
      const actor = battle.crew.find(unit => unit.id === "gaku");
      const index = type === "engine" ? 0 : 1;
      battle.cars[index] = E.createCarState(type, `test_${type}`);
      battle.cars[index].hp = Math.max(1, battle.cars[index].hp - 5);
      actor.pos = { car: index, lane: 1 };
      actor.ap = 4;
      battle.steam = battle.maxSteam;
      battle.morale = 10;
      const ally = battle.crew.find(unit => unit.uid !== actor.uid);
      ally.pos = { car: index, lane: 0 };
      ally.hp = Math.max(1, ally.maxHp - 5);
      const action = E.getActions(battle, actor.uid).find(item => item.key === "operate");
      assert(action && action.enabled, `${type}: operation disabled`);
      const targets = E.getTargets(battle, actor.uid, "operate");
      assert(targets.length > 0, `${type}: no target`);
      const result = E.performAction(battle, actor.uid, "operate", targets[0].type === "none" ? null : targets[0]);
      assert(result.ok, `${type}: ${result.error}`);
    }
  });

  function playTacticalBattle(encounterId, difficulty = "story") {
    const encounter = D.encounters[encounterId];
    const game = E.createNewGame(difficulty);
    for (const id of Object.keys(D.crew)) if (!game.crew[id]) game.crew[id] = E.createCrewState(id);
    game.activeCrew = ["nagi", "mina", "rikka", "orun"];
    game.train = [
      E.createCarState("engine", "sim_engine"), E.createCarState("cannon", "sim_cannon"),
      E.createCarState("workshop", "sim_workshop"), E.createCarState("medbay", "sim_medbay"),
      E.createCarState("shield", "sim_shield"), E.createCarState("observatory", "sim_observatory")
    ];
    const tier = Math.max(0, encounter.chapter - 1);
    game.bonuses.crewDamage = Math.floor(tier / 3);
    game.bonuses.startBarrier = Math.floor(tier / 2);
    game.bonuses.maxSteam = Math.floor(tier / 3);
    game.resources.morale = 8;
    E.createBattle(game, encounterId);
    const battle = game.battle;
    let roundGuard = 0;
    while (battle.phase === "player" && roundGuard++ < 35) {
      for (const actor of battle.crew) {
        let actionGuard = 0;
        while (actor.hp > 0 && actor.ap > 0 && battle.phase === "player" && actionGuard++ < 8) {
          const actions = E.getActions(battle, actor.uid).filter(action => action.enabled);
          const enemyActions = actions.filter(action => action.targetType === "enemy").sort((a, b) => {
            const score = action => action.key.includes("analyze") ? 0 : action.key.includes("blast") ? 1 : action.key.includes("snipe") ? 2 : action.key === "attack" ? 3 : 4;
            return score(a) - score(b);
          });
          let acted = false;
          for (const action of enemyActions) {
            const targets = E.getTargets(battle, actor.uid, action.key);
            if (!targets.length) continue;
            targets.sort((a, b) => {
              const enemyA = battle.enemies.find(enemy => enemy.uid === a.id);
              const enemyB = battle.enemies.find(enemy => enemy.uid === b.id);
              return ((enemyB?.armor || 0) - (enemyA?.armor || 0)) || ((enemyA?.hp || 99) - (enemyB?.hp || 99));
            });
            if (E.performAction(battle, actor.uid, action.key, targets[0]).ok) { acted = true; break; }
          }
          if (acted) continue;
          const enemies = E.livingEnemies(battle);
          const moves = E.getTargets(battle, actor.uid, "move");
          if (enemies.length && moves.length) {
            const distance = pos => Math.min(...enemies.map(enemy => E.cellDistance(pos, enemy.pos)));
            moves.sort((a, b) => distance(a.pos) - distance(b.pos));
            if (distance(moves[0].pos) < distance(actor.pos) && E.performAction(battle, actor.uid, "move", moves[0]).ok) continue;
          }
          const car = battle.cars[actor.pos.car];
          const repair = actions.find(action => action.key === "repair");
          if (repair && car.hp <= car.maxHp * 0.55 && E.performAction(battle, actor.uid, "repair", null).ok) continue;
          break;
        }
      }
      if (battle.phase === "player") E.endPlayerTurn(battle);
    }
    return battle;
  }

  test("戦術ボットが実操作だけで全35戦を完遂できる", () => {
    for (const encounterId of Object.keys(D.encounters)) {
      const battle = playTacticalBattle(encounterId);
      equal(battle.phase, "victory", `${encounterId} ended at round ${battle.round}`);
      assert(battle.round <= 14, `${encounterId} took ${battle.round} rounds`);
    }
  });

  test("標準難易度でも全章ボスを異なる章強化で完遂できる", () => {
    for (const encounter of Object.values(D.encounters).filter(item => item.objective.type === "boss")) {
      const battle = playTacticalBattle(encounter.id, "normal");
      equal(battle.phase, "victory", `${encounter.id} ended at round ${battle.round}`);
      assert(battle.round <= 16, `${encounter.id} took ${battle.round} rounds`);
    }
  });

  function completeCampaign(routeIndex, ending) {
    const game = E.createNewGame("story");
    let guard = 0;
    while (guard++ < 150) {
      const step = E.getStep(game);
      assert(step, `missing step at chapter ${game.chapterIndex} index ${game.stepIndex}`);
      if (step.type === "event") {
        const event = D.events[step.id];
        let choice = null;
        if (event.choices) {
          choice = event.choices.findIndex(item => E.choiceAvailable(game, item).ok);
          if (ending === "weave") {
            if (step.id === "c3_choice") choice = 1;
            if (step.id === "c4_record") choice = 0;
            if (step.id === "c7_decision") choice = 2;
          }
          if (ending === "divide" && step.id === "c7_decision") choice = 1;
          if (ending === "ignite" && step.id === "c7_decision") choice = 0;
        }
        const result = E.completeEvent(game, choice);
        assert(result.ok, `${step.id}: ${result.error}`);
      } else if (step.type === "route") {
        const selectedRoute = typeof routeIndex === "function" ? routeIndex(game) : routeIndex;
        const option = step.options[Math.min(selectedRoute, step.options.length - 1)];
        const result = E.chooseRoute(game, option.id);
        assert(result.ok, result.error);
        killAndComplete(game);
      } else if (["battle", "boss"].includes(step.type)) {
        assert(E.startCurrentBattle(game).ok);
        killAndComplete(game);
      } else if (step.type === "garage") {
        assert(E.completeGarage(game).ok);
      } else if (step.type === "upgrade") {
        const choice = step.options.find(id => game.upgrades.filter(item => item === id).length < 2);
        assert(choice, `no upgrade at chapter ${game.chapterIndex}`);
        assert(E.applyUpgrade(game, choice).ok);
      } else if (step.type === "chapterEnd") {
        assert(E.advanceChapter(game).ok);
      } else if (step.type === "epilogue") {
        return game;
      } else {
        throw new Error(`unsupported step ${step.type}`);
      }
    }
    throw new Error("campaign loop overflow");
  }

  test("安全路線中心で点火エンディングまで進行できる", () => {
    const game = completeCampaign(0, "ignite");
    equal(game.chapterIndex, 6);
    equal(game.ending, "ignite");
    equal(game.stats.battlesWon, 28);
  });

  test("混成路線で分灯エンディングまで進行できる", () => {
    const game = completeCampaign(state => state.chapterIndex % 2, "divide");
    equal(game.chapterIndex, 6);
    equal(game.ending, "divide");
    equal(game.stats.battlesWon, 28);
  });

  test("危険路線中心で編光条件を満たして完結できる", () => {
    const game = completeCampaign(1, "weave");
    equal(game.ending, "weave");
    assert(game.records.length >= 3);
    assert(game.crew.teto && game.crew.orun);
    equal(game.stats.battlesWon, 28);
  });

  const result = document.getElementById("result");
  result.textContent = `RESULT PASS=${passed} FAIL=${failed}\n\n${lines.join("\n")}`;
  result.className = failed ? "fail" : "pass";
  document.title = `DT TEST PASS=${passed} FAIL=${failed}`;
  document.body.dataset.passed = String(passed);
  document.body.dataset.failed = String(failed);
})(window.DT);
