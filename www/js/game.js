// 게임 로직 (DOM 의존 없음 → 테스트/시뮬레이션 가능)
import {
  STAGE_KILLS, BOSS_TIME, RESPAWN, HERO_REVIVE, INV_MAX,
  monsterHp, monsterDmg, goldPerKill, isZoneBoss, bossHpMult, bossGoldMult,
  zoneOf, HERO_UPGRADES, COMPANIONS, RELICS, SKILLS, RARITIES, DROP_WEIGHTS, SLOT_IDS,
  ENHANCE_MAX, itemPct, itemName, itemSellPrice, enhanceCost, prestigeGain,
} from './data.js';
import { fmt } from './format.js';
import { lifeUpdate, autoEat, buffMult, divineMult, newLifeLog } from './life.js';

const HERO = Object.fromEntries(HERO_UPGRADES.map((u) => [u.id, u]));
const RELIC = Object.fromEntries(RELICS.map((r) => [r.id, r]));
const SKILL = Object.fromEntries(SKILLS.map((k) => [k.id, k]));

function pickWeighted(weights, rnd = Math.random) {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rnd() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

export const SPEEDS = [1, 2, 4, 8, 16];

export class Game {
  // 게임 배속 (저장값이 잘못돼도 x1)
  speed() { return SPEEDS.includes(this.s.settings.speed) ? this.s.settings.speed : 1; }

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed());
    this.s.settings.speed = SPEEDS[(i + 1) % SPEEDS.length];
  }

  constructor(state) {
    this.s = state;
    this.rt = {
      monster: null,
      respawn: 0,
      heroHp: 0,
      heroDead: 0,
      atkTimer: 0,
      monAtkTimer: 0,
      bossTime: 0,
      compAcc: 0,
      compFxT: 0,
      lunge: 0,
      shake: 0,
      spawnT: 0,
      fx: [],
      toasts: [],
      invDirty: true,
      skill: Object.fromEntries(SKILLS.map((k) => [k.id, { cd: 0, t: 0 }])),
    };
    this.rt.heroHp = this.heroMaxHp();
    this.spawn();
  }

  // ---------- 파생 능력치 ----------
  relic(id) { return this.s.relics[id] || 0; }
  heroVal(id) { return HERO[id].val(this.s.hero[id]); }
  essenceMult() { return 1 + 0.02 * this.s.stats.essenceEarned; }
  equipMult(slot) {
    const it = this.s.equip[slot];
    return it ? 1 + itemPct(it) / 100 : 1;
  }
  skillActive(id) { return this.rt.skill[id].t > 0; }

  heroAtk() {
    return this.heroVal('atk') * this.equipMult('weapon') * (1 + RELIC.sword.per * this.relic('sword')) * this.essenceMult()
      * buffMult(this.s, 'atk') * divineMult(this.s);
  }
  heroMaxHp() {
    return this.heroVal('hp') * this.equipMult('armor') * (1 + RELIC.shield.per * this.relic('shield')) * buffMult(this.s, 'hp');
  }
  atkSpeed() { return this.heroVal('speed') * (this.skillActive('frenzy') ? 2 : 1) * buffMult(this.s, 'speed'); }
  critChance() { return this.heroVal('crit'); }
  critMult() { return this.heroVal('critDmg') + RELIC.eye.per * this.relic('eye'); }
  compBaseDps(c) { return c.val(this.s.comps[c.id] || 0); }
  compMult() {
    return this.equipMult('accessory') * (1 + RELIC.banner.per * this.relic('banner')) * this.essenceMult()
      * (this.skillActive('rally') ? 3 : 1) * divineMult(this.s);
  }
  compDps() {
    let sum = 0;
    for (const c of COMPANIONS) sum += this.compBaseDps(c);
    return sum * this.compMult();
  }
  heroDps() {
    return this.heroAtk() * this.atkSpeed() * (1 + this.critChance() * (this.critMult() - 1));
  }
  totalDps() { return this.heroDps() + this.compDps(); }
  goldMult() {
    return this.heroVal('goldUp') * (1 + RELIC.grail.per * this.relic('grail')) * (this.skillActive('midas') ? 3 : 1) * buffMult(this.s, 'gold');
  }
  dropChance() { return 0.05 * (1 + RELIC.clover.per * this.relic('clover')); }

  // ---------- 구매 계산 ----------
  // def: {base, growth, start, max}, L: 현재 레벨
  plan(def, L, money, mult) {
    const maxLv = def.max ?? Infinity;
    const room = maxLv - L;
    if (room <= 0) return { n: 0, cost: Infinity, maxed: true };
    const g = def.growth;
    const c = def.base * Math.pow(g, L - (def.start || 0));
    const costN = (n) => (n === 1 ? c : (c * (Math.pow(g, n) - 1)) / (g - 1));
    let n;
    if (mult === 'max') {
      n = Math.floor(Math.log((money * (g - 1)) / c + 1) / Math.log(g));
      n = Math.max(1, Math.min(n, room));
    } else {
      n = Math.min(mult, room);
    }
    return { n, cost: costN(n), maxed: false };
  }

  buyHero(id) {
    const def = HERO[id];
    const p = this.plan(def, this.s.hero[id], this.s.gold, this.s.settings.buyMult);
    if (p.maxed || p.cost > this.s.gold) return false;
    const hpRatio = this.rt.heroHp / this.heroMaxHp();
    this.s.gold -= p.cost;
    this.s.hero[id] += p.n;
    if (id === 'hp' && this.rt.heroDead <= 0) this.rt.heroHp = hpRatio * this.heroMaxHp();
    return true;
  }

  buyComp(id) {
    const def = COMPANIONS.find((c) => c.id === id);
    const L = this.s.comps[id] || 0;
    const p = this.plan(def, L, this.s.gold, this.s.settings.buyMult);
    if (p.maxed || p.cost > this.s.gold) return false;
    this.s.gold -= p.cost;
    this.s.comps[id] = L + p.n;
    return true;
  }

  relicPlan(id) {
    return this.plan(RELIC[id], this.relic(id), this.s.essence, 1);
  }
  buyRelic(id) {
    const p = this.relicPlan(id);
    if (p.maxed || p.cost > this.s.essence) return false;
    p.cost = Math.ceil(p.cost);
    if (p.cost > this.s.essence) return false;
    this.s.essence -= p.cost;
    this.s.relics[id] = this.relic(id) + 1;
    return true;
  }

  // ---------- 전투 ----------
  spawn() {
    const s = this.s;
    const rt = this.rt;
    const st = s.stage;
    const zone = zoneOf(st);
    const boss = s.kills >= STAGE_KILLS && s.autoAdvance;
    let m;
    if (boss) {
      m = {
        e: zone.boss[0], name: zone.boss[1], boss: true, zoneBoss: isZoneBoss(st),
        maxHp: monsterHp(st) * bossHpMult(st), dmg: monsterDmg(st) * 2.5,
      };
      rt.bossTime = BOSS_TIME;
    } else {
      const [e, name] = zone.monsters[Math.floor(Math.random() * zone.monsters.length)];
      m = { e, name, boss: false, maxHp: monsterHp(st) * (0.9 + Math.random() * 0.2), dmg: monsterDmg(st) };
    }
    m.hp = m.maxHp;
    m.dead = false;
    rt.monster = m;
    rt.monAtkTimer = 0;
    rt.respawn = 0;
    rt.spawnT = 0;
  }

  fx(o) {
    const rt = this.rt;
    rt.fx.push({ t: 0, life: 0.9, dx: (Math.random() - 0.5) * 60, ...o });
    if (rt.fx.length > 70) rt.fx.splice(0, rt.fx.length - 70);
  }

  toast(text, kind = '') {
    this.rt.toasts.push({ text, kind });
  }

  dealDamage(amount) {
    const m = this.rt.monster;
    if (!m || m.dead) return;
    m.hp -= amount;
    if (m.hp <= 0) this.killMonster();
  }

  heroHit(isTap) {
    const rt = this.rt;
    if (rt.heroDead > 0 || !rt.monster || rt.monster.dead) return;
    const crit = Math.random() < this.critChance();
    const dmg = this.heroAtk() * (crit ? this.critMult() : 1);
    rt.lunge = 0.15;
    rt.shake = 0.15;
    this.fx({ type: 'dmg', anchor: 'mon', text: (crit ? '치명! ' : '') + fmt(dmg), crit, tap: isTap });
    this.dealDamage(dmg);
  }

  tap() {
    if (this.rt.heroDead > 0) return;
    this.s.stats.taps++;
    this.heroHit(true);
  }

  killMonster() {
    const s = this.s;
    const rt = this.rt;
    const m = rt.monster;
    m.dead = true;
    m.hp = 0;
    rt.respawn = RESPAWN;
    const gold = goldPerKill(s.stage) * (m.boss ? bossGoldMult(s.stage) : 1) * this.goldMult();
    this.addGold(gold);
    s.stats.kills++;
    this.fx({ type: 'gold', anchor: 'mon', text: '+' + fmt(gold), life: 1.1 });

    // 신성술 재료: 뼈
    if (m.boss) this.addBones(m.zoneBoss ? 8 : 4);
    else if (Math.random() < 0.3) this.addBones(1);

    if (m.boss) this.dropItem(m.zoneBoss ? 'zoneBoss' : 'boss');
    else if (Math.random() < this.dropChance()) this.dropItem('normal');

    if (m.boss) {
      s.stats.bossKills++;
      s.stage++;
      s.kills = 0;
      if (s.stage > s.maxStage) s.maxStage = s.stage;
      if (s.stage > s.runMaxStage) s.runMaxStage = s.stage;
      this.toast(`${m.name} 처치! 스테이지 ${s.stage} 진입`, 'good');
      for (const k of SKILLS) if (k.unlock === s.stage && s.maxStage === s.stage) this.toast(`새 스킬 해금: ${k.icon} ${k.name}`, 'epic');
    } else {
      s.kills = Math.min(STAGE_KILLS, s.kills + 1);
    }
  }

  addGold(g) {
    this.s.gold += g;
    this.s.stats.goldEarned += g;
  }

  failBoss(msg) {
    this.s.autoAdvance = false;
    this.toast(`보스 도전 실패 - ${msg}`, 'bad');
    this.spawn();
  }

  heroDie() {
    const s = this.s;
    const rt = this.rt;
    rt.heroDead = HERO_REVIVE;
    rt.heroHp = 0;
    const m = rt.monster;
    if (m && m.boss) {
      this.failBoss('영웅이 쓰러졌습니다');
    } else {
      s.autoAdvance = false;
      if (s.stage > 1) {
        s.stage--;
        s.kills = STAGE_KILLS;
      }
      this.toast('영웅이 쓰러졌습니다. 이전 스테이지로 후퇴합니다.', 'bad');
      this.spawn();
    }
  }

  challengeBoss() {
    const s = this.s;
    s.autoAdvance = true;
    const m = this.rt.monster;
    if (s.kills >= STAGE_KILLS && (!m || !m.boss) && this.rt.heroDead <= 0) this.spawn();
  }

  toggleAutoAdvance() {
    if (this.s.autoAdvance) {
      this.s.autoAdvance = false;
      const m = this.rt.monster;
      if (m && m.boss && !m.dead) this.spawn(); // 보스전 포기
    } else {
      this.challengeBoss();
    }
  }

  // ---------- 스킬 ----------
  skillUnlocked(id) { return this.s.maxStage >= SKILL[id].unlock; }
  canSkill(id) {
    const st = this.rt.skill[id];
    if (!this.skillUnlocked(id) || st.cd > 0 || this.rt.heroDead > 0) return false;
    if (id === 'strike') return !!this.rt.monster && !this.rt.monster.dead;
    return true;
  }
  useSkill(id) {
    if (!this.canSkill(id)) return false;
    const k = SKILL[id];
    const st = this.rt.skill[id];
    st.cd = k.cd;
    st.t = k.dur;
    if (id === 'strike') {
      const dmg = this.heroAtk() * 25 + this.compDps() * 3;
      this.rt.lunge = 0.25;
      this.rt.shake = 0.35;
      this.fx({ type: 'dmg', anchor: 'mon', text: '일격! ' + fmt(dmg), crit: true, big: true, life: 1.2 });
      this.dealDamage(dmg);
    } else {
      this.fx({ type: 'text', anchor: 'hero', text: `${k.icon} ${k.name}!`, life: 1.3 });
    }
    return true;
  }

  // ---------- 장비 ----------
  dropItem(kind) {
    const s = this.s;
    const r = pickWeighted(DROP_WEIGHTS[kind]);
    const slot = SLOT_IDS[Math.floor(Math.random() * SLOT_IDS.length)];
    const item = { id: s.nextId++, slot, r, lvl: s.stage, enh: 0 };
    s.stats.items++;
    this.fx({ type: 'loot', anchor: 'mon', text: '📦', color: RARITIES[r].color, life: 1.2 });
    if (r >= 3) this.toast(`${RARITIES[r].name} 장비 획득! ${itemName(item)}`, r === 4 ? 'legend' : 'epic');
    this.giveItem(item);
  }

  // 생활 스킬(대장기술·제작)로 만든 장비: 역대 최고 스테이지 레벨로 생성
  craftItem(slot, r, notify = true) {
    const s = this.s;
    const item = { id: s.nextId++, slot, r, lvl: Math.max(1, s.maxStage), enh: 0 };
    s.stats.items++;
    if (notify) this.toast(`제작 완료: ${itemName(item)}`, r >= 4 ? 'legend' : r >= 3 ? 'epic' : 'good');
    this.giveItem(item);
    return item;
  }

  addBones(n) {
    const b = this.s.life.bank;
    b.bone = (b.bone || 0) + n;
  }

  giveItem(item) {
    const s = this.s;
    const slot = item.slot;
    const eq = s.equip[slot];
    if (s.settings.autoEquip && (!eq || itemPct(item) > itemPct(eq))) {
      s.equip[slot] = item;
      if (eq) this.stash(eq);
    } else {
      this.stash(item);
    }
    this.rt.invDirty = true;
  }

  stash(item) {
    const s = this.s;
    if (item.r < s.settings.autoSell || s.inv.length >= INV_MAX) {
      this.addGold(itemSellPrice(item));
    } else {
      s.inv.push(item);
    }
  }

  equipItem(id) {
    const s = this.s;
    const i = s.inv.findIndex((x) => x.id === id);
    if (i < 0) return;
    const item = s.inv[i];
    s.inv.splice(i, 1);
    const prev = s.equip[item.slot];
    s.equip[item.slot] = item;
    if (prev) s.inv.push(prev);
    this.clampHp();
    this.rt.invDirty = true;
  }

  sellItem(id) {
    const s = this.s;
    const i = s.inv.findIndex((x) => x.id === id);
    if (i < 0) return;
    this.addGold(itemSellPrice(s.inv[i]));
    s.inv.splice(i, 1);
    this.rt.invDirty = true;
  }

  sellBelow(rarity) {
    const s = this.s;
    let total = 0;
    let count = 0;
    s.inv = s.inv.filter((it) => {
      if (it.r <= rarity) {
        total += itemSellPrice(it);
        count++;
        return false;
      }
      return true;
    });
    this.addGold(total);
    this.rt.invDirty = true;
    return { count, total };
  }

  findItem(id) {
    for (const slot of SLOT_IDS) if (this.s.equip[slot]?.id === id) return this.s.equip[slot];
    return this.s.inv.find((x) => x.id === id);
  }

  enhance(id) {
    const it = this.findItem(id);
    if (!it || it.enh >= ENHANCE_MAX) return false;
    const cost = enhanceCost(it);
    if (cost > this.s.gold) return false;
    this.s.gold -= cost;
    it.enh++;
    this.clampHp();
    this.rt.invDirty = true;
    return true;
  }

  clampHp() {
    this.rt.heroHp = Math.min(this.rt.heroHp, this.heroMaxHp());
  }

  // ---------- 환생 ----------
  prestigeGain() { return prestigeGain(this.s.runMaxStage); }

  prestige() {
    const s = this.s;
    const gain = this.prestigeGain();
    if (gain <= 0) return false;
    s.essence += gain;
    s.stats.essenceEarned += gain;
    s.stats.prestiges++;
    const start = 1 + 5 * this.relic('flag');
    s.gold = start > 1 ? goldPerKill(start) * 60 : 0;
    s.hero = { atk: 1, hp: 1, speed: 0, crit: 0, critDmg: 0, goldUp: 0 };
    s.comps = {};
    s.stage = start;
    s.kills = 0;
    s.runMaxStage = start;
    s.maxStage = Math.max(s.maxStage, start);
    s.autoAdvance = true;
    for (const k of SKILLS) this.rt.skill[k.id] = { cd: 0, t: 0 };
    this.rt.heroDead = 0;
    this.rt.heroHp = this.heroMaxHp();
    this.spawn();
    this.toast(`환생 완료! 에테르 정수 +${gain}`, 'legend');
    return gain;
  }

  // ---------- 오프라인 ----------
  offlineCapSec() { return (2 + this.relic('hourglass')) * 3600; }

  applyOffline(sec) {
    const s = this.s;
    const t = Math.min(sec, this.offlineCapSec());
    const eff = 0.5 + 0.05 * this.relic('hourglass');
    const hp = monsterHp(s.stage);
    const tpk = Math.max(hp / Math.max(1e-9, this.totalDps()), 0.1) + RESPAWN;
    const kills = t / tpk;
    const gold = kills * goldPerKill(s.stage) * this.goldMult() * eff;
    this.addGold(gold);
    s.stats.kills += Math.floor(kills);
    s.stats.playTime += t;
    const life = newLifeLog();
    lifeUpdate(this, t, life);
    return { sec: t, gold, kills: Math.floor(kills), life };
  }

  // ---------- 메인 업데이트 ----------
  update(dt) {
    const s = this.s;
    const rt = this.rt;
    s.stats.playTime += dt;
    lifeUpdate(this, dt);

    for (const k of SKILLS) {
      const st = rt.skill[k.id];
      if (st.cd > 0) st.cd = Math.max(0, st.cd - dt);
      if (st.t > 0) st.t = Math.max(0, st.t - dt);
    }
    if (s.autoSkill) for (const k of SKILLS) if (this.canSkill(k.id)) this.useSkill(k.id);

    rt.lunge = Math.max(0, rt.lunge - dt);
    rt.shake = Math.max(0, rt.shake - dt);
    rt.spawnT += dt;
    for (const f of rt.fx) f.t += dt;
    if (rt.fx.length && rt.fx[0].t > 2) rt.fx = rt.fx.filter((f) => f.t < f.life);

    const maxHp = this.heroMaxHp();
    if (rt.heroDead > 0) {
      rt.heroDead -= dt;
      if (rt.heroDead <= 0) rt.heroHp = maxHp;
      return;
    }
    rt.heroHp = Math.min(maxHp, rt.heroHp + maxHp * 0.03 * dt);
    autoEat(this);

    if (rt.respawn > 0) {
      rt.respawn -= dt;
      if (rt.respawn <= 0) this.spawn();
      return;
    }
    const m = rt.monster;
    if (!m) { this.spawn(); return; }

    if (m.boss) {
      rt.bossTime -= dt;
      if (rt.bossTime <= 0) { this.failBoss('시간 초과'); return; }
    }

    // 영웅 자동 공격
    rt.atkTimer += dt * this.atkSpeed();
    while (rt.atkTimer >= 1) {
      rt.atkTimer -= 1;
      this.heroHit(false);
      if (m.dead) { rt.atkTimer = Math.min(rt.atkTimer, 1); return; }
    }

    // 동료 지속 피해
    const cd = this.compDps();
    if (cd > 0) {
      const d = cd * dt;
      rt.compAcc += d;
      rt.compFxT += dt;
      if (rt.compFxT >= 0.6) {
        this.fx({ type: 'comp', anchor: 'mon', text: fmt(rt.compAcc) });
        rt.compAcc = 0;
        rt.compFxT = 0;
      }
      this.dealDamage(d);
      if (m.dead) return;
    }

    // 몬스터 반격
    rt.monAtkTimer += dt;
    const interval = m.boss ? 1.5 : 2;
    if (rt.monAtkTimer >= interval) {
      rt.monAtkTimer -= interval;
      rt.heroHp -= m.dmg;
      this.fx({ type: 'hurt', anchor: 'hero', text: '-' + fmt(m.dmg), life: 0.8 });
      if (rt.heroHp <= 0) this.heroDie();
    }
  }
}
