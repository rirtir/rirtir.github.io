// 制作のバッグ容量判定（simulation.craftCheck / craft）の検査。UIの実DOM検証は別途。
import * as sim from '../simulation.js';
import { createWorld } from '../world.js';
import { BALANCE, ITEMS } from '../data.js';

const json = (v) => JSON.stringify(v);

export function runCraftCapacityTests() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name: `craft capacity: ${name}`, ok: !!ok, detail: ok ? '' : typeof detail === 'string' ? detail : json(detail) });
  const eq = (name, a, b) => check(name, json(a) === json(b), { expected: b, actual: a });
  const section = (name, fn) => { try { fn(); } catch (e) { check(`${name} exception`, false, String(e.stack || e)); } };

  const slots = BALANCE.items.bagSlots;
  const fresh = () => sim.createState(createWorld());
  // bag: [[id, n], ...] を先頭から詰め、残りは空
  const setBag = (s, list) => {
    s.player.bag = new Array(slots).fill(null);
    list.forEach(([id, n], i) => { s.player.bag[i] = { id, n }; });
  };
  const fill = (id, count) => Array.from({ length: count }, () => [id, ITEMS[id].stack || BALANCE.items.stack]);
  const hand = new Set(['hand']);

  section('分割された材料の消費と完成品の保存', () => {
    // 同じ合計量でも、実際に使い切る枠が異なる。完成品を失ってはならない。
    const blocked = fresh();
    setBag(blocked, [['fiber', 3], ...fill('stone', slots - 2), ['fiber', 99]]);
    check('出力枠が空かない分割材料を事前に拒否', !sim.craftCheck(blocked, 'cloth', 1, hand).ok);
    const rejected = sim.craft(blocked, 'cloth', 1);
    check('拒否した制作は失敗を返す', !rejected.ok, rejected);
    eq('完成品を置けない場合は材料全量を維持', [sim.countItem(blocked, 'fiber'), sim.countItem(blocked, 'cloth')], [102, 0]);

    const allowed = fresh();
    setBag(allowed, [['fiber', 99], ...fill('stone', slots - 2), ['fiber', 3]]);
    check('消費で出力枠が空く分割材料は許可', sim.craftCheck(allowed, 'cloth', 1, hand).ok);
    const made = sim.craft(allowed, 'cloth', 1);
    check('収納可能な制作は成功を返す', made.ok, made);
    eq('材料消費と完成品の数量が一致', [sim.countItem(allowed, 'fiber'), sim.countItem(allowed, 'cloth')], [99, 1]);
  });

  section('満杯の×1拒否と×5許可', () => {
    const s = fresh();
    setBag(s, [['fiber', 15], ...fill('stone', slots - 1)]);
    const c1 = sim.craftCheck(s, 'cloth', 1, hand), c5 = sim.craftCheck(s, 'cloth', 5, hand);
    check('×1は容量で拒否', !c1.ok && c1.code === 'capacity', c1);
    check('×5は許可（繊維を使い切って枠が空く）', c5.ok && c5.total === 5, c5);
    const r1 = sim.craft(s, 'cloth', 1);
    check('craft ×1 も拒否され、無消費', !r1.ok && sim.countItem(s, 'fiber') === 15 && sim.countItem(s, 'cloth') === 0, r1);
    const r5 = sim.craft(s, 'cloth', 5);
    check('craft ×5 は成功', r5.ok && r5.count === 5, r5);
    eq('×5後の数量', [sim.countItem(s, 'fiber'), sim.countItem(s, 'cloth')], [0, 5]);
  });

  section('材料が残り出力枠がない場合は無消費', () => {
    const s = fresh();
    setBag(s, [['fiber', 16], ...fill('stone', slots - 1)]);
    const c = sim.craftCheck(s, 'cloth', 5, hand);
    check('×5は材料が残るので拒否', !c.ok && c.code === 'capacity', c);
    const before = json(s.player.bag);
    const r = sim.craft(s, 'cloth', 5);
    check('拒否され無消費', !r.ok && json(s.player.bag) === before, r);
  });

  section('同itemの既存スタックと上限', () => {
    const s = fresh();
    const max = ITEMS.cloth.stack || BALANCE.items.stack;
    setBag(s, [['cloth', max - 2], ['fiber', 12], ...fill('stone', slots - 2)]);
    check('×2は既存スタックに入る', sim.craftCheck(s, 'cloth', 2, hand).ok);
    const c3 = sim.craftCheck(s, 'cloth', 3, hand);
    check('×3は上限を超えるので拒否', !c3.ok && c3.code === 'capacity', c3);
    sim.craft(s, 'cloth', 2);
    eq('布は上限ちょうど', sim.countItem(s, 'cloth'), max);
  });

  section('材料消費の順序どおりに空き枠を数える', () => {
    // 繊維が複数スロットに散らばる満杯バッグ。removeItem は末尾から消費する（判定も同じ順）
    const s = fresh();
    setBag(s, [['fiber', 5], ['fiber', 3], ['fiber', 2], ...fill('stone', slots - 3)]);
    const c = sim.craftCheck(s, 'cloth', 2, hand);
    check('消費後に空く枠へ収納できる', c.ok, c);
    const r = sim.craft(s, 'cloth', 2);
    check('実際のcraftも一致', r.ok && sim.countItem(s, 'cloth') === 2 && sim.countItem(s, 'fiber') === 4, r);
  });

  section('道具は1回で自動使用、数量は1に正規化', () => {
    const s = fresh();
    setBag(s, [['branch', 9], ['stone', 9], ['fiber', 9], ...fill('wood', slots - 3)]);
    const c = sim.craftCheck(s, 'axe_stone', 5, hand);
    check('道具の判定は×1として扱う', c.ok && c.times === 1, c);
    const r = sim.craft(s, 'axe_stone', 5);
    check('craft成功し自動で道具として使われる', r.ok && s.player.tools.axe >= ITEMS.axe_stone.tier, r);
    eq('材料は1回分のみ消費', [sim.countItem(s, 'branch'), sim.countItem(s, 'stone'), sim.countItem(s, 'fiber')], [6, 7, 7]);
    check('所持済みは拒否', sim.craftCheck(s, 'axe_stone', 1, hand).code === 'owned');
  });

  section('設備不足・材料不足・回数の正規化', () => {
    const s = fresh();
    setBag(s, [['stone', 50], ['clay', 50]]);
    check('設備不足', sim.craftCheck(s, 'furnace', 1, hand).code === 'station');
    check('設備があれば可', sim.craftCheck(s, 'furnace', 1, new Set(['hand', 'workbench'])).ok);
    check('未知のレシピ', sim.craftCheck(s, 'no_such', 1, hand).code === 'recipe');
    setBag(s, [['fiber', 3]]);
    check('材料不足(×2)', sim.craftCheck(s, 'cloth', 2, hand).code === 'material');
    eq('times は 1..99 に正規化', [sim.craftCheck(s, 'cloth', 0, hand).times, sim.craftCheck(s, 'cloth', -4, hand).times], [1, 1]);
    setBag(s, [['fiber', 999]]);
    eq('上限99', sim.craftCheck(s, 'cloth', 500, hand).times, 99);
  });

  section('判定は状態・イベント・時計を変えない', () => {
    const s = fresh();
    setBag(s, [['fiber', 15], ...fill('stone', slots - 1)]);
    const snap = () => json([s.player.bag, s.player.tools, s.rev, s.events.length, s.time, s.progress]);
    const before = snap();
    for (const n of [1, 5, 99]) sim.craftCheck(s, 'cloth', n, hand);
    sim.craftCheck(s, 'cloth', 1);
    sim.craftCheck(s, 'axe_stone', 1, hand);
    eq('craftCheckは無作用', snap(), before);
  });

  return { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks };
}
