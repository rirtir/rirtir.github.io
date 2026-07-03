/* ============================================================
   グラビティゴルフ — 物理エンジン
   ------------------------------------------------------------
   ゲーム本体・軌道予測の両方から使う決定論的シミュレータ。
   solver.py はこのファイルと同じ挙動を Python で再実装して
   全ホールのクリア可能性を検証している。定数やロジックを
   変更したら solver.py にも反映して再検証すること。
   ============================================================ */

const GGP = (() => {

  const C = {
    W: 1600, H: 900,          // 仮想空間サイズ
    DT: 1 / 240,              // 物理サブステップ
    SUBSTEPS: 4,              // 60fps 時のサブステップ数
    GRAV: 2400,               // 重力定数（加速度 = GRAV*m*r^2 / d^2）
    BALL_R: 7,
    REST_SPEED: 80,           // これ未満の相対速度で接地すると着地
    BOUNCE: 0.45,             // 反発係数
    FRICTION: 0.7,            // バウンド時の接線方向の減衰
    MAX_SPEED: 1500,
    AMAX: 4200,               // 加速度の上限（特異点対策）
    OB: 350,                  // 場外マージン
    TIMEOUT: 25,              // 飛行タイムアウト（秒）
    WORM_R: 20, WORM_CD: 0.6, // ワームホール半径・クールダウン
    RING_R: 26, RING_BOOST: 1.5,
    PULL_MAX: 260,            // 引っぱり距離の上限
    PULL_V: 4.2,              // 引っぱり→初速の変換係数
    BH_CORE: 0.5,             // ブラックホール死亡半径の係数
    MF: { p: 1, r: -0.9, s: 1.5, b: 9 }  // 種別ごとの質量係数
  };

  // ---- 天体の位置・速度（公転は時刻 t の決定論的関数） ----
  function bodyPos(b, t) {
    if (!b.orbit) return { x: b.x, y: b.y };
    const o = b.orbit, a = o.ph + o.w * t;
    return { x: o.cx + o.R * Math.cos(a), y: o.cy + o.R * Math.sin(a) };
  }
  function bodyVel(b, t) {
    if (!b.orbit) return { x: 0, y: 0 };
    const o = b.orbit, a = o.ph + o.w * t;
    return { x: -o.R * o.w * Math.sin(a), y: o.R * o.w * Math.cos(a) };
  }
  function orbitAngle(b, t) {
    return b.orbit ? b.orbit.ph + b.orbit.w * t : 0;
  }
  // 表面の角度（公転による見かけの回転＋自転）。着地追従に使う
  function surfAngle(b, t) {
    return orbitAngle(b, t) + (b.spin || 0) * t;
  }
  // 表面速度（公転速度＋自転による接線速度）。(nx,ny)=中心→接点の法線
  function surfVel(b, t, nx, ny) {
    const v = bodyVel(b, t);
    if (b.spin) {
      const lever = b.r + C.BALL_R;
      v.x += -b.spin * lever * ny;
      v.y += b.spin * lever * nx;
    }
    return v;
  }
  function goalPos(level, t) {
    return bodyPos(level.goal, t);
  }

  // ---- 初期状態 ----
  function makeState(level) {
    const st = {
      t: 0, mode: "rest",                 // rest | fly | goal | dead
      x: level.start.x, y: level.start.y, vx: 0, vy: 0,
      attach: null,                        // { bi, ang, oang } 着地情報
      flight: 0, strokes: 0,
      deadReason: null,                    // "burn" | "hole" | "ob"
      last: null,                          // 直前の発射地点（リスポーン用）
      wormCd: (level.worm || []).map(() => 0),
      ringUsed: (level.rings || []).map(() => false)
    };
    st.attach = findAttach(level, st.x, st.y, 0);
    st.last = snapshot(st);
    return st;
  }

  function findAttach(level, x, y, t) {
    for (let i = 0; i < level.bodies.length; i++) {
      const b = level.bodies[i];
      if (b.t !== "p" && b.t !== "r") continue;
      const bp = bodyPos(b, t);
      const d = Math.hypot(x - bp.x, y - bp.y);
      if (d < b.r + C.BALL_R + 6) {
        return { bi: i, ang: Math.atan2(y - bp.y, x - bp.x), oang: surfAngle(b, t) };
      }
    }
    return null;
  }

  function snapshot(st) {
    return { x: st.x, y: st.y, attach: st.attach ? { ...st.attach } : null };
  }

  // 着地中のボール位置を天体に追従させる
  function restFollow(st, level) {
    if (!st.attach) return;
    const b = level.bodies[st.attach.bi];
    const bp = bodyPos(b, st.t);
    const ang = st.attach.ang + (surfAngle(b, st.t) - st.attach.oang);
    st.x = bp.x + (b.r + C.BALL_R) * Math.cos(ang);
    st.y = bp.y + (b.r + C.BALL_R) * Math.sin(ang);
  }

  // ---- 発射 ----
  function launch(st, level, dirx, diry, speed) {
    const len = Math.hypot(dirx, diry) || 1;
    let vx = (dirx / len) * speed, vy = (diry / len) * speed;
    if (st.attach) {                      // 動く足場の速度を引き継ぐ（公転＋自転）
      const b = level.bodies[st.attach.bi];
      const bp = bodyPos(b, st.t);
      const d = Math.hypot(st.x - bp.x, st.y - bp.y) || 1;
      const bv = surfVel(b, st.t, (st.x - bp.x) / d, (st.y - bp.y) / d);
      vx += bv.x; vy += bv.y;
    }
    st.last = snapshot(st);
    st.vx = vx; st.vy = vy;
    st.mode = "fly"; st.flight = 0; st.strokes++;
    st.attach = null;
    st.deadReason = null;
    for (let i = 0; i < st.ringUsed.length; i++) st.ringUsed[i] = false;
    for (let i = 0; i < st.wormCd.length; i++) st.wormCd[i] = 0;
  }

  // ミス後のリスポーン（打数はそのまま）
  function respawn(st, level) {
    const s = st.last;
    st.mode = "rest"; st.vx = 0; st.vy = 0; st.flight = 0;
    st.deadReason = null;
    st.attach = s.attach ? { ...s.attach } : null;
    st.x = s.x; st.y = s.y;
    restFollow(st, level);
  }

  // ---- 1 サブステップ進める。events 配列にイベントを push ----
  function step(st, level, events) {
    st.t += C.DT;
    for (let i = 0; i < st.wormCd.length; i++) {
      if (st.wormCd[i] > 0) st.wormCd[i] -= C.DT;
    }
    if (st.mode !== "fly") { restFollow(st, level); return; }
    st.flight += C.DT;

    // 重力
    let ax = 0, ay = 0;
    for (const b of level.bodies) {
      const bp = bodyPos(b, st.t);
      const dx = bp.x - st.x, dy = bp.y - st.y;
      const d2 = Math.max(dx * dx + dy * dy, b.r * b.r);
      const d = Math.sqrt(d2);
      const gm = C.GRAV * (b.m !== undefined ? b.m : C.MF[b.t]) * b.r * b.r;
      const a = gm / d2;
      ax += a * dx / d; ay += a * dy / d;
    }
    const am = Math.hypot(ax, ay);
    if (am > C.AMAX) { ax *= C.AMAX / am; ay *= C.AMAX / am; }
    st.vx += ax * C.DT; st.vy += ay * C.DT;
    const sp = Math.hypot(st.vx, st.vy);
    if (sp > C.MAX_SPEED) { st.vx *= C.MAX_SPEED / sp; st.vy *= C.MAX_SPEED / sp; }
    st.x += st.vx * C.DT; st.y += st.vy * C.DT;

    // 衝突
    for (let i = 0; i < level.bodies.length; i++) {
      const b = level.bodies[i];
      const bp = bodyPos(b, st.t);
      const dx = st.x - bp.x, dy = st.y - bp.y;
      const d = Math.hypot(dx, dy);
      if (b.t === "b") {
        if (d < b.r * C.BH_CORE) {
          st.mode = "dead"; st.deadReason = "hole";
          events.push({ type: "dead", reason: "hole", x: bp.x, y: bp.y });
          return;
        }
        continue;
      }
      if (d >= b.r + C.BALL_R) continue;
      if (b.t === "s") {
        st.mode = "dead"; st.deadReason = "burn";
        events.push({ type: "dead", reason: "burn", x: st.x, y: st.y });
        return;
      }
      // 惑星 / リペラー: 押し出して着地 or バウンド
      const nx = dx / (d || 1), ny = dy / (d || 1);
      st.x = bp.x + nx * (b.r + C.BALL_R);
      st.y = bp.y + ny * (b.r + C.BALL_R);
      const bv = surfVel(b, st.t, nx, ny);
      const rvx = st.vx - bv.x, rvy = st.vy - bv.y;
      const rsp = Math.hypot(rvx, rvy);
      const vn = rvx * nx + rvy * ny;
      if (rsp < C.REST_SPEED) {
        st.mode = "rest"; st.vx = 0; st.vy = 0;
        st.attach = { bi: i, ang: Math.atan2(ny, nx), oang: surfAngle(b, st.t) };
        events.push({ type: "rest", x: st.x, y: st.y });
        return;
      }
      if (vn < 0) {
        const tx = rvx - vn * nx, ty = rvy - vn * ny;
        st.vx = bv.x + (-vn * C.BOUNCE) * nx + tx * C.FRICTION;
        st.vy = bv.y + (-vn * C.BOUNCE) * ny + ty * C.FRICTION;
        events.push({ type: "bounce", speed: -vn, x: st.x, y: st.y, nx: nx, ny: ny });
      }
    }

    // ゴール
    const gp = goalPos(level, st.t);
    const gr = level.goal.r !== undefined ? level.goal.r : 18;
    if (Math.hypot(st.x - gp.x, st.y - gp.y) < gr) {
      st.mode = "goal";
      events.push({ type: "goal", x: gp.x, y: gp.y });
      return;
    }

    // ワームホール
    const worm = level.worm || [];
    for (let i = 0; i < worm.length; i++) {
      if (st.wormCd[i] > 0) continue;
      for (let s = 0; s < 2; s++) {
        const a = worm[i][s];
        if (Math.hypot(st.x - a.x, st.y - a.y) < C.WORM_R) {
          const bexit = worm[i][1 - s];
          events.push({ type: "warp", fx: st.x, fy: st.y, tx: bexit.x, ty: bexit.y });
          st.x = bexit.x; st.y = bexit.y;
          st.wormCd[i] = C.WORM_CD;
          break;
        }
      }
    }

    // ブーストリング
    const rings = level.rings || [];
    for (let i = 0; i < rings.length; i++) {
      if (st.ringUsed[i]) continue;
      const rg = rings[i];
      if (Math.hypot(st.x - rg.x, st.y - rg.y) < C.RING_R) {
        st.ringUsed[i] = true;
        st.vx *= C.RING_BOOST; st.vy *= C.RING_BOOST;
        const s2 = Math.hypot(st.vx, st.vy);
        if (s2 > C.MAX_SPEED) { st.vx *= C.MAX_SPEED / s2; st.vy *= C.MAX_SPEED / s2; }
        events.push({ type: "boost", x: rg.x, y: rg.y });
      }
    }

    // 場外・タイムアウト
    if (st.x < -C.OB || st.x > C.W + C.OB || st.y < -C.OB || st.y > C.H + C.OB ||
        st.flight > C.TIMEOUT) {
      st.mode = "dead"; st.deadReason = "ob";
      events.push({ type: "dead", reason: "ob", x: st.x, y: st.y });
    }
  }

  // ---- 軌道予測（プレビュー用の軽量クローン） ----
  function cloneState(st) {
    return {
      t: st.t, mode: st.mode, x: st.x, y: st.y, vx: st.vx, vy: st.vy,
      attach: st.attach ? { ...st.attach } : null,
      flight: st.flight, strokes: st.strokes, deadReason: null,
      last: st.last,
      wormCd: st.wormCd.slice(), ringUsed: st.ringUsed.slice()
    };
  }

  // 発射方向・強さから予測軌道を返す（steps サブステップぶん）
  function predict(st, level, dirx, diry, speed, steps, stride) {
    const sim = cloneState(st);
    launch(sim, level, dirx, diry, speed);
    sim.strokes--;                       // 予測なので打数は戻す
    const pts = [];
    const ev = [];
    for (let i = 0; i < steps; i++) {
      step(sim, level, ev);
      if (i % stride === 0) pts.push({ x: sim.x, y: sim.y });
      if (sim.mode !== "fly") break;
    }
    return { pts, end: sim.mode, ex: sim.x, ey: sim.y };
  }

  return { C, bodyPos, bodyVel, goalPos, orbitAngle, surfAngle, surfVel,
           makeState, findAttach, launch, respawn, step, cloneState, predict };
})();
