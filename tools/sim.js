// 밸런스 시뮬레이션: 봇이 장비 자동 장착 · 가장 싼 강화부터 · 지도 자동 진행
// 사용법: node tools/sim.js <시간(h)>  (브라우저 콘솔에서는 runSim(시간)으로도 실행 가능)
import { Game } from '../www/js/game.js';
import { newState } from '../www/js/state.js';
import { SLOT_IDS, RARITIES, enhanceCost } from '../www/js/data.js';
import { fmt } from '../www/js/format.js';

export function runSim(hours = 2, log = console.log) {
  const g = new Game(newState());
  g.s.autoSkill = true;
  const dt = 0.1;
  let lastReport = 0;
  const rows = [];
  for (let t = 0; t < hours * 3600; t += dt) {
    g.update(dt);
    if (Math.round(t * 10) % 50 === 0) {
      // 장착 장비 중 가장 싼 강화부터
      for (let i = 0; i < 10; i++) {
        let best = null;
        for (const slot of SLOT_IDS) {
          const it = g.s.equip[slot];
          if (it && it.enh < 10 && (!best || enhanceCost(it) < enhanceCost(best))) best = it;
        }
        if (!best || !g.enhance(best.id)) break;
      }
      if (g.s.inv.length > 40) g.sellBelow(3);
    }
    if (t - lastReport >= 600) {
      lastReport = t;
      const eq = SLOT_IDS.filter((k) => g.s.equip[k]).length;
      const row = `${(t / 3600).toFixed(2)}h zone=${g.s.maxZone + 1} lv=${g.s.stage} max=${g.s.maxStage} deaths=${g.s.stats.deaths} gear=${eq}/12 best=${RARITIES[g.s.stats.bestRarity].name} dps=${fmt(g.totalDps())} gold=${fmt(g.s.gold)}`;
      rows.push(row);
      log(row);
    }
    g.rt.toasts.length = 0;
  }
  return rows;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('sim.js')) runSim(Number(process.argv[2] || 2));
