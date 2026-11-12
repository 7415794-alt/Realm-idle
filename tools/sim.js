// 밸런스 시뮬레이션: 단순 봇이 가장 싼 강화부터 구매하며 플레이
// 사용법: npm run sim -- <시간(h)>
import { Game } from '../www/js/game.js';
import { newState } from '../www/js/state.js';
import { HERO_UPGRADES, COMPANIONS, RELICS } from '../www/js/data.js';
import { fmt } from '../www/js/format.js';

const hours = Number(process.argv[2] || 6);
const g = new Game(newState());
g.s.autoSkill = true;
g.s.settings.buyMult = 1;
const dt = 0.1;
let lastReport = 0;
for (let t = 0; t < hours * 3600; t += dt) {
  g.update(dt);
  if (Math.round(t * 10) % 20 === 0) {
    // 가장 싼 항목부터 구매
    for (let i = 0; i < 20; i++) {
      const opts = [];
      for (const u of HERO_UPGRADES) { const p = g.plan(u, g.s.hero[u.id], g.s.gold, 1); if (!p.maxed) opts.push([p.cost * (u.id === 'atk' || u.id === 'hp' ? 1 : 1.5), () => g.buyHero(u.id)]); }
      for (const c of COMPANIONS) { const p = g.plan(c, g.s.comps[c.id] || 0, g.s.gold, 1); opts.push([p.cost, () => g.buyComp(c.id)]); }
      opts.sort((a, b) => a[0] - b[0]);
      if (!opts.length || !opts[0][1]()) break;
    }
    if (!g.s.autoAdvance && g.s.kills >= 10 && Math.round(t) % 60 === 0) g.challengeBoss();
  }
  if (t - lastReport >= 600) {
    lastReport = t;
    console.log(`${(t/3600).toFixed(1)}h stage=${g.s.stage} max=${g.s.runMaxStage} gold=${fmt(g.s.gold)} dps=${fmt(g.totalDps())} atkLv=${g.s.hero.atk} gain=${g.prestigeGain()}`);
  }
}
