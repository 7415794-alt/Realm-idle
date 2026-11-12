// 게임 로직 (DOM 의존 없음 → 테스트/시뮬레이션 가능)
// 영웅 능력치는 장비(+강화) · 기도 · 물약 · 펫 · 날씨 · 스킬로만 정해짐
// 전투 방식(근접 · 원거리 · 마법)은 장착한 무기로 결정
import {
  BOSS_TIME, RESPAWN, HERO_REVIVE, INV_MAX, OFFLINE_CAP, BOSS_MI, AUTO_STREAK, BOSS_RETRY, BOSS_GOLD,
  goldPerKill, monsterStats, monsterInfo, monLevel, zoneTitle, maxHitFor, incomingHit, ZONES, LOOT_POOLS,
  HERO_BASE, STAT_CAPS, CRIT_MULT, VIP, BASE_MIN_HIT, RARITIES, STYLES, rollWeights, rollPot, liftLine, potSum, POT_TIERS, POT_LOCK_COST, PET_POT_LINES, PET_ENH_MAX, PET_ENH, petEnhCost, cubeGoldCost, SLOT_IDS, DROP_SLOTS, AFF_SLOTS, WEAPONS, WEAPON_IDS,
  STYLE_IDS, SPECIALS, ENHANCE_MAX, itemStats, itemScore, itemStyle, itemName, itemSellPrice, enhanceCost, rollRarity,
  lootTable, isRing,
} from './data.js';
import { fmt } from './format.js';
import { lifeUpdate, autoEat, buffMult, prayerBonus, newLifeLog, bankAdd, MATS, lifeSpecial } from './life.js';
import { worldBonus, worldTick, questEvent, rollKillPets } from './world.js';

// 쿠폰: 몇 번이든 사용 가능. gold는 '처치 골드 x 배수'(최고 레벨 기준)
export const COUPONS = {
  에테르원정대: { name: '에테르 원정대 지원', gold: 50000, items: 10, luck: 8, mats: { cube: 500, chest: 30, pot_all: 10, pot_drop: 10, gem: 20 } },
  AETHER: { name: '에테르 원정대 지원', gold: 50000, items: 10, luck: 8, mats: { cube: 500, chest: 30, pot_all: 10, pot_drop: 10, gem: 20 } },
  큐브폭탄: { name: '큐브 폭탄', mats: { cube: 1000 } },
  CUBE: { name: '큐브 폭탄', mats: { cube: 1000 } },
  황금비: { name: '황금비', gold: 200000 },
  GOLD: { name: '황금비', gold: 200000 },
  보물사냥꾼: { name: '보물 사냥꾼', items: 20, luck: 10, mats: { chest: 100, gem_ruby: 10, gem_diamond: 5, gem_emerald: 10, gem_sapphire: 10 } },
  TREASURE: { name: '보물 사냥꾼', items: 20, luck: 10, mats: { chest: 100, gem_ruby: 10, gem_diamond: 5, gem_emerald: 10, gem_sapphire: 10 } },
  물약상자: { name: '물약 상자', mats: { pot_atk: 30, pot_def: 30, pot_hp: 30, pot_speed: 30, pot_gold: 30, pot_drop: 30, pot_all: 20 } },
  POTION: { name: '물약 상자', mats: { pot_atk: 30, pot_def: 30, pot_hp: 30, pot_speed: 30, pot_gold: 30, pot_drop: 30, pot_all: 20 } },
};
export const SPEEDS = [1, 2, 4, 8, 16];
const REGEN = 0.02;                // 기본 초당 체력 회복 (최대 체력 대비)

export class Game {
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
      lunge: 0,
      shake: 0,
      spawnT: 0,
      fx: [],
      toasts: [],
      invDirty: true,
      statCache: null,
      worldT: 0,
      streak: 0,   // 자동 진행: 지금 대상 연속 처치 수
      retry: 0,    // 자동 진행: 후퇴 후 다시 나아가기까지 남은 처치 수
      potCache: null,
    };
    worldTick(this);
    this.rt.heroHp = this.heroMaxHp();
    this.spawn();
  }

  // 기도 + 펫 + 날씨 효과 합
  bonus(key) { return prayerBonus(this.s, key) + worldBonus(this.s, key) + this.potBonus(key) + this.petEnhBonus(key) + lifeSpecial(this.s, key); }

  // 게임 배속 (저장값이 잘못돼도 x1)
  speed() { return SPEEDS.includes(this.s.settings.speed) ? this.s.settings.speed : 1; }
  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed());
    this.s.settings.speed = SPEEDS[(i + 1) % SPEEDS.length];
  }

  // ---------- 능력치 ----------
  weaponDef() { const w = this.s.equip.weapon; return w ? WEAPONS[w.kind || 'sword'] : null; }
  twoHanded() { return !!this.weaponDef()?.twoHand; }
  // 전투 방식: 직접 선택 (근접 · 원거리 · 마법)
  style() { return STYLES[this.s.settings.style] ? this.s.settings.style : 'melee'; }
  setStyle(id) {
    if (!STYLES[id]) return;
    this.s.settings.style = id;
    this.dirtyStats();
  }

  // 장비 합산 (장비가 바뀔 때만 다시 계산)
  gearStats() {
    if (this.rt.statCache) return this.rt.statCache;
    const st = { ...HERO_BASE };
    for (const slot of SLOT_IDS) {
      const it = this.s.equip[slot];
      if (!it) continue;
      if (slot === 'shield' && this.twoHanded()) continue;
      // 강화는 장비칸 기준
      const enh = this.s.slots?.[slot]?.enh || 0;
      for (const [k, v] of Object.entries(itemStats(enh ? { ...it, enh } : it))) st[k] = (st[k] || 0) + v;
    }
    this.rt.statCache = st;
    return st;
  }
  dirtyStats() { this.rt.statCache = null; this.rt.potCache = null; }

  // 최종 능력치: 장비 + (물약 · 기도 · 펫 · 날씨)
  stats() {
    const g = this.gearStats();
    const s = this.s;
    const all = buffMult(s, 'atk') * (1 + this.bonus('atk'));
    return {
      melee: g.melee * all * (1 + this.bonus('melee')),
      rng: g.rng * all * (1 + this.bonus('rng')),
      mag: g.mag * all * (1 + this.bonus('mag')),
      def: g.def * buffMult(s, 'def') * (1 + this.bonus('def')),
      hp: g.hp * buffMult(s, 'hp') * (1 + this.bonus('hp')),
      crit: Math.min(STAT_CAPS.crit, g.crit + this.bonus('crit')),
      ls: Math.min(STAT_CAPS.ls, g.ls + this.bonus('ls')),
      dr: Math.min(STAT_CAPS.dr, g.dr + this.bonus('dr')),
      regen: Math.min(STAT_CAPS.regen, g.regen + this.bonus('regen')),
      dmg: 1 + Math.min(STAT_CAPS.dmg, this.bonus('dmg')),
      // 특수 옵션 (잠재능력 · 생활 스킬)
      boss: Math.min(STAT_CAPS.boss, this.bonus('boss')),
      pen: Math.min(STAT_CAPS.pen, this.bonus('pen')),
      cdmg: CRIT_MULT + Math.min(STAT_CAPS.cdmg, this.bonus('cdmg')),
      spd: Math.min(STAT_CAPS.spd, this.bonus('spd')),
      gold: Math.min(STAT_CAPS.gold, this.bonus('gold')),
      drop: Math.min(STAT_CAPS.drop, this.bonus('drop')),
    };
  }

  heroMaxHp() { return this.stats().hp; }
  atkSpeed() {
    return (this.weaponDef()?.speed || 1) * buffMult(this.s, 'speed') * (1 + this.stats().spd);
  }
  minHitFrac() { return BASE_MIN_HIT + (this.weaponDef()?.minHit || 0); }

  // 대상 몬스터 방어를 반영한 한 방 최대 피해
  maxHit(mDef = this.rt.monster?.def || 0, boss = !!this.rt.monster?.boss) {
    const st = this.stats();
    return maxHitFor(this.style(), st, mDef * (1 - st.pen)) * st.dmg * (boss ? 1 + st.boss : 1);
  }
  // 평균 DPS (치명타 포함)
  dpsVs(mDef) {
    const st = this.stats();
    const mh = this.maxHit(mDef);
    const avg = (mh * (1 + this.minHitFrac())) / 2;
    return avg * (1 + st.crit * (st.cdmg - 1)) * this.atkSpeed();
  }
  totalDps() { return this.dpsVs(this.rt.monster?.def ?? monsterStats(this.s.stage).def); }
  // 전투력: 장착 장비 점수 합
  // 전투력: 최종 능력치로 계산 (공격 x 치명타 x 속도 x 특수 옵션 + 생존, 흡혈 · 감소 · 회복 · 골드 · 드롭률 보정)
  powerOf(st = this.stats()) {
    const sty = STYLES[this.style()];
    const atk = st[sty.stat] * (sty.stat === 'mag' ? 0.8 : 0.85);
    const off = atk * st.dmg * (1 + st.crit * (st.cdmg - 1)) * (1 + st.spd) * (this.weaponDef()?.speed || 1) * (1 + st.pen * 0.5) * (1 + st.boss * 0.1);
    const surv = st.hp * 0.3 + st.def * 2;
    const sustain = 1 + st.ls * 3 + st.dr * 1.5 + st.regen * 10;
    const eco = 1 + (st.gold + st.drop) * 0.02;
    return (off * 10 + surv) * sustain * eco;
  }
  powerScore() { return this.powerOf(); }
  // 바꿔 보고 전투력 차이를 잰 뒤 되돌림. change()는 되돌리는 함수를 돌려줌
  powerDelta(change) {
    const before = this.powerOf();
    const undo = change();
    this.dirtyStats();
    const after = this.powerOf();
    undo();
    this.dirtyStats();
    return after - before;
  }
  // 가방 장비를 장착했을 때 전투력 변화
  equipDelta(item) {
    const s = this.s;
    return this.powerDelta(() => {
      const slot = this.targetSlot(item);
      const prev = s.equip[slot];
      const oldSlot = item.slot;
      item.slot = slot;
      s.equip[slot] = item;
      return () => { s.equip[slot] = prev; item.slot = oldSlot; };
    });
  }
  enhanceDelta(it) {
    return this.powerDelta(() => { it.enh++; return () => { it.enh--; }; });
  }
  // 큐브 새 결과를 적용했을 때 (장착 장비 · 데리고 다니는 펫만 전투력에 반영)
  cubeDelta(it) {
    if (!it?.potNew) return 0;
    return this.powerDelta(() => { const old = it.pot; it.pot = it.potNew; return () => { it.pot = old; }; });
  }

  goldMult() {
    return VIP.mult * buffMult(this.s, 'gold') * (1 + Math.min(STAT_CAPS.gold, this.bonus('gold')));
  }
  // 전리품 확률 배율 (VIP · 펫 · 날씨 · 기도)
  lootMult() { return VIP.mult * buffMult(this.s, 'drop') * (1 + Math.min(STAT_CAPS.drop, this.bonus('drop'))); }

  // ---------- 전투 · 지도 ----------
  // 지금 대상: s.target = { z: 지역, mi: 몬스터(5 = 보스) }. s.stage = 대상 몬스터 레벨
  target() { return this.s.target; }
  canTarget(z, mi) { return z >= 0 && z <= this.s.maxZone && mi >= 0 && mi <= BOSS_MI; }
  // 지도에서 직접 고르면 자동 진행을 끄고 그 몬스터만 사냥
  selectTarget(z, mi, manual = true) {
    const s = this.s;
    if (!this.canTarget(z, mi)) return false;
    s.target = { z, mi };
    s.stage = monLevel(z, mi);
    if (manual) s.settings.autoProgress = false;
    this.rt.streak = 0;
    // 처치 직후(재등장 대기)면 대기 후 새 대상이 나옴
    if (!(this.rt.monster?.dead && this.rt.respawn > 0)) this.spawn();
    return true;
  }
  toggleAutoProgress() {
    const s = this.s;
    s.settings.autoProgress = !s.settings.autoProgress;
    this.rt.streak = 0;
    this.rt.retry = 0;
  }
  killCount(z, mi) { return this.s.bestiary[`${z}_${mi}`] || 0; }

  spawn() {
    const s = this.s;
    const rt = this.rt;
    const { z, mi } = s.target;
    const info = monsterInfo(z, mi);
    s.stage = info.lvl;
    const m = { ...info, zoneBoss: info.boss, ...monsterStats(info.lvl, info.boss ? 'zoneBoss' : 'normal') };
    if (info.boss) rt.bossTime = BOSS_TIME;
    else m.hp *= 0.9 + Math.random() * 0.2;
    m.maxHp = m.hp;
    m.dead = false;
    rt.monster = m;
    rt.monAtkTimer = 0;
    rt.respawn = 0;
    rt.spawnT = 0;
  }

  monsterLoot(m = this.rt.monster) {
    const t = this.s.target;
    return lootTable(m?.z ?? t.z, m?.mi ?? t.mi);
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
    const m = rt.monster;
    if (rt.heroDead > 0 || !m || m.dead) return;
    const st = this.stats();
    const mh = this.maxHit(m.def, m.boss);
    const lo = mh * this.minHitFrac();
    let dmg = lo + Math.random() * (mh - lo);
    const crit = Math.random() < st.crit;
    if (crit) dmg *= this.stats().cdmg;
    if (isTap) dmg *= 0.5; // 탭은 절반 피해의 추가 공격
    rt.lunge = 0.15;
    rt.shake = 0.15;
    const sty = this.style();
    const icon = sty === 'ranged' ? '🏹 ' : sty === 'magic' ? '✨ ' : '';
    this.fx({ type: 'dmg', anchor: 'mon', text: (crit ? '치명! ' : icon) + fmt(dmg), crit, tap: isTap });
    // 흡혈
    if (st.ls > 0) rt.heroHp = Math.min(this.heroMaxHp(), rt.heroHp + Math.min(dmg, m.hp) * st.ls);
    this.dealDamage(dmg);
  }

  tap() {
    if (this.rt.heroDead > 0) return;
    this.s.stats.taps++;
    questEvent(this.s, 'tap', 1);
    this.heroHit(true);
  }

  // 전리품 표 굴리기 (항목마다 따로, 확률 x 드롭률 배율)
  rollLoot(table, boss) {
    const lm = this.lootMult();
    const got = [];
    for (const d of table) {
      if (Math.random() >= Math.min(1, d.c * lm)) continue;
      if (d.mat) {
        const n = d.q[0] + Math.floor(Math.random() * (d.q[1] - d.q[0] + 1));
        bankAdd(this.s, d.mat, n);
        got.push(d.mat);
      } else {
        this.dropItem(boss ? 4 : 1, d);
      }
    }
    return got;
  }

  killMonster() {
    const s = this.s;
    const rt = this.rt;
    const m = rt.monster;
    m.dead = true;
    m.hp = 0;
    rt.respawn = RESPAWN;
    const gold = goldPerKill(m.lvl) * (m.boss ? BOSS_GOLD : 1) * this.goldMult();
    this.addGold(gold);
    s.stats.kills++;
    const key = `${m.z}_${m.mi}`;
    s.bestiary[key] = (s.bestiary[key] || 0) + 1;
    questEvent(s, 'kill', 1);
    if (m.boss) { questEvent(s, 'boss', 1); questEvent(s, 'zoneBoss', 1); }
    rollKillPets(this, m);
    this.fx({ type: 'gold', anchor: 'mon', text: '+' + fmt(gold), life: 1.1 });

    // 전리품: 몬스터별 표 + 보스는 추가로 고등급 장비
    const got = this.rollLoot(this.monsterLoot(m), m.boss);
    if (got.length) this.fx({ type: 'loot', anchor: 'mon', text: got.slice(0, 3).map((id) => MATS[id]?.icon || '').join(''), life: 1.1 });
    if (m.boss) { this.dropItem(8); this.dropItem(4); }

    // 최고 레벨 갱신 (스킬 해금 등)
    if (m.lvl > s.maxStage) {
      s.maxStage = m.lvl;
    }
    if (m.boss) {
      s.stats.bossKills++;
      if (m.z === s.maxZone) {
        s.maxZone++;
        this.toast(`${m.name} 처치! 새 지역 개방: ${zoneTitle(s.maxZone)}`, 'epic');
      } else this.toast(`${m.name} 처치!`, 'good');
    }
    this.autoProgress(m);
  }

  // 자동 진행: 같은 몬스터를 AUTO_STREAK번 잡으면 다음 몬스터 → 보스 → 다음 지역
  autoProgress(m) {
    const s = this.s;
    const rt = this.rt;
    if (!s.settings.autoProgress) return;
    rt.streak++;
    if (rt.retry > 0) rt.retry--;
    const { z, mi } = s.target;
    if (m.boss) {
      if (z < s.maxZone) this.selectTarget(z + 1, 0, false);
      return;
    }
    if (rt.streak < AUTO_STREAK || rt.retry > 0) return;
    this.selectTarget(z, mi + 1, false);
  }

  addGold(g) {
    this.s.gold += g;
    this.s.stats.goldEarned += g;
    questEvent(this.s, 'gold', g);
  }

  // 보스전 실패: 자동 진행 중이면 마지막 일반 몬스터로 물러나 BOSS_RETRY마리 더 사냥 후 재도전
  failBoss(msg) {
    const s = this.s;
    this.toast(`보스 도전 실패 - ${msg}`, 'bad');
    if (s.settings.autoProgress) {
      this.rt.retry = BOSS_RETRY;
      this.selectTarget(s.target.z, 4, false);
    } else this.spawn();
  }

  heroDie() {
    const s = this.s;
    const rt = this.rt;
    rt.heroDead = HERO_REVIVE;
    rt.heroHp = 0;
    s.stats.deaths++;
    const m = rt.monster;
    if (m && m.boss) {
      this.failBoss('영웅이 쓰러졌습니다');
      return;
    }
    // 자동 진행 중이면 한 단계 약한 몬스터로 후퇴
    const { z, mi } = s.target;
    if (s.settings.autoProgress && (mi > 0 || z > 0)) {
      this.rt.retry = BOSS_RETRY;
      if (mi > 0) this.selectTarget(z, mi - 1, false);
      else this.selectTarget(z - 1, 4, false);
      this.toast('영웅이 쓰러졌습니다. 더 약한 몬스터로 후퇴합니다.', 'bad');
    } else {
      this.toast('영웅이 쓰러졌습니다.', 'bad');
      this.spawn();
    }
  }

  // 보스전 포기 (지도에서 일반 몬스터 고르기와 같음)
  retreat() {
    const { z } = this.s.target;
    this.selectTarget(z, 4, false);
  }

  // ---------- 스탯 분석 · 추천 ----------
  // 지금 대상 몬스터 기준으로 전투를 계산: 처치 시간 · 받는 피해 · 회복 → '분당 처치 수'(죽음 포함)
  combatCalc(st, style, m) {
    const wd = this.weaponDef();
    const mh = maxHitFor(style, st, m.def * (1 - st.pen)) * st.dmg * (m.boss ? 1 + st.boss : 1);
    const dps = (mh * (1 + this.minHitFrac())) / 2 * (1 + st.crit * (st.cdmg - 1)) * (wd?.speed || 1) * buffMult(this.s, 'speed') * (1 + st.spd);
    const ttk = m.hp / Math.max(1e-9, dps);
    const inc = (incomingHit(m.str, st.def) * (1 - st.dr)) / m.interval;
    const heal = st.hp * (REGEN + st.regen) + Math.min(dps, m.hp / Math.max(ttk, 0.1)) * st.ls;
    const net = inc - heal; // 초당 체력 순손실
    const lossPerKill = Math.max(0, net) * ttk;
    const killsPerLife = lossPerKill > 0 ? st.hp / lossPerKill : Infinity;
    const cycle = ttk + RESPAWN;
    // 죽으면 부활 대기 + 처치 흐름이 끊김
    const kpm = killsPerLife === Infinity ? 60 / cycle : (60 * killsPerLife) / (killsPerLife * cycle + HERO_REVIVE + 3);
    return { dps, ttk, inc, heal, net, killsPerLife, kpm };
  }
  // 스탯을 조금씩 올렸을 때 '분당 처치 수'가 얼마나 늘어나는지 비교
  analyze(style = this.style()) {
    const base = this.stats();
    const info = monsterInfo(this.s.target.z, this.s.target.mi);
    const m = this.rt.monster && !this.rt.monster.dead ? this.rt.monster : { ...monsterStats(info.lvl, info.boss ? 'zoneBoss' : 'normal') };
    const now = this.combatCalc(base, style, m);
    const key = STYLES[style].stat;
    // 모두 1% 기준 (공격 · 방어 · 체력은 +1%, 나머지는 +1%p). 최대치에 도달한 스탯은 뺌
    const C = STAT_CAPS;
    const add = (k, cap, off = 0) => (s) => { s[k] = Math.min(cap + off, s[k] + 0.01); };
    const tests = [
      { k: key, label: `${STYLES[style].icon} ${STYLES[style].name} +1%`, f: (s) => { s[key] *= 1.01; } },
      { k: 'def', label: '🛡️ 방어 +1%', f: (s) => { s.def *= 1.01; } },
      { k: 'hp', label: '❤️ 체력 +1%', f: (s) => { s.hp *= 1.01; } },
      { k: 'crit', label: '🎯 치명타 +1%p', full: base.crit >= C.crit, f: add('crit', C.crit) },
      { k: 'ls', label: '🧛 흡혈 +1%p', full: base.ls >= C.ls, f: add('ls', C.ls) },
      { k: 'dr', label: '🧱 피해 감소 +1%p', full: base.dr >= C.dr, f: add('dr', C.dr) },
      { k: 'regen', label: '💚 초당 회복 +1%p', full: base.regen >= C.regen, f: add('regen', C.regen) },
      { k: 'dmg', sp: true, label: '★ 모든 피해 +1%p', full: base.dmg - 1 >= C.dmg, f: add('dmg', C.dmg, 1) },
      { k: 'boss', sp: true, label: '★ 보스 피해 +1%p', full: base.boss >= C.boss, f: add('boss', C.boss) },
      { k: 'pen', sp: true, label: '★ 방어 무시 +1%p', full: base.pen >= C.pen, f: add('pen', C.pen) },
      { k: 'cdmg', sp: true, label: '★ 치명타 피해 +1%p', full: base.cdmg - CRIT_MULT >= C.cdmg, f: add('cdmg', C.cdmg, CRIT_MULT) },
      { k: 'spd', sp: true, label: '★ 공격 속도 +1%p', full: base.spd >= C.spd, f: add('spd', C.spd) },
    ].filter((x) => !x.full);
    const rows = tests.map((x) => {
      const st = { ...base };
      x.f(st);
      const r = this.combatCalc(st, style, m);
      return { ...x, gain: r.kpm / Math.max(1e-9, now.kpm) - 1, dpsGain: r.dps / now.dps - 1, incCut: 1 - r.net / (now.net || 1) };
    }).sort((a, b) => b.gain - a.gain);
    // 방식별 지금 장비 DPS
    const styles = STYLE_IDS.map((sid) => ({ id: sid, ...this.combatCalc(base, sid, m) }));
    return { now, rows, styles, m, danger: now.killsPerLife < 30 };
  }

  // ---------- 큐브 (잠재능력) ----------
  // 장착 여부와 상관없이 사용. 🎲 큐브 1개(없으면 골드)로 3줄을 다시 굴림
  // 잠재능력이 없으면 바로 개방, 있으면 새 결과를 보여 주고 '적용' 또는 '유지'를 고름 (등급 상승은 어느 쪽이든 유지)
  // 잠근 줄 (잠재능력이 있을 때만, 최대 2줄)
  potLines(it) { return it.slot === 'pet' ? PET_POT_LINES : 3; }
  potLocks(it) { return it.pot ? (it.potLock || []).filter((i) => i >= 0 && i < this.potLines(it)) : []; }
  toggleLock(id, i) {
    const it = this.findItem(id);
    if (!it?.pot) return false;
    const L = new Set(it.potLock || []);
    if (L.has(i)) L.delete(i);
    else if (L.size >= this.potLines(it) - 1) return false;
    else L.add(i);
    it.potLock = [...L].sort();
    return true;
  }
  // 한 번 돌리는 데 드는 큐브 수 · 골드 (잠글수록 비쌈)
  cubeNeed(it) { return POT_LOCK_COST[this.potLocks(it).length]; }
  cubeCost(it) { return cubeGoldCost(it.lvl) * this.cubeNeed(it); }
  canCube(it, payGold = true) {
    return (this.s.life.bank.cube || 0) >= this.cubeNeed(it) || (payGold && this.s.gold >= this.cubeCost(it));
  }
  useCube(id, payGold = false) {
    const s = this.s;
    const it = this.findItem(id);
    if (!it) return { ok: false, why: '장비를 찾을 수 없습니다' };
    const need = this.cubeNeed(it);
    if ((s.life.bank.cube || 0) >= need) bankAdd(s, 'cube', -need);
    else if (payGold && s.gold >= this.cubeCost(it)) s.gold -= this.cubeCost(it);
    else return { ok: false, why: '큐브(또는 골드)가 부족합니다' };
    s.stats.cubes = (s.stats.cubes || 0) + 1;
    const before = it.pot?.t ?? 0;
    // 천장: 같은 등급에서 정해진 횟수를 돌리면 다음 등급 확정
    it.pity = (it.pity || 0) + 1;
    const pity = POT_TIERS[before].pity;
    const keep = [];
    for (const i of this.potLocks(it)) keep[i] = it.pot.lines[i];
    const res = rollPot(before, Math.random, pity > 0 && it.pity >= pity, it.slot, keep, this.potLines(it));
    if (res.t > before) it.pity = 0;
    if (!it.pot) {
      it.pot = res;
      delete it.potNew;
      this.dirtyStats();
    } else {
      it.potNew = res;
      if (res.t > it.pot.t) { it.pot = { t: res.t, lines: it.pot.lines.map((l, i) => liftLine(l, i, res.t)) }; this.dirtyStats(); }
    }
    this.rt.invDirty = true;
    return { ok: true, item: it, up: res.t > before, res };
  }
  // accept: true면 새 결과 적용, false면 기존 유지
  decideCube(id, accept) {
    const it = this.findItem(id);
    if (!it?.potNew) return;
    if (accept) it.pot = it.potNew;
    delete it.potNew;
    this.dirtyStats();
    this.rt.invDirty = true;
  }
  // 장착 장비 잠재능력 합 (장비가 바뀔 때만 다시 계산)
  potBonus(key) {
    if (!this.rt.potCache) {
      // 잠재능력은 장비칸 기준 (장비를 낀 칸만 적용)
      const items = SLOT_IDS.filter((sl) => this.s.equip[sl] && !(sl === 'shield' && this.twoHanded())).map((sl) => this.s.slots?.[sl]);
      const ap = this.s.world.pets.active;
      if (ap && this.s.world.pets.owned.includes(ap)) items.push(this.s.world.pets.data?.[ap]);
      this.rt.potCache = potSum(items);
    }
    return this.rt.potCache[key] || 0;
  }

  // ---------- 쿠폰 (무제한 사용) ----------
  redeemCoupon(code) {
    const c = COUPONS[String(code || '').trim().toUpperCase()] || COUPONS[String(code || '').trim()];
    if (!c) return null;
    const s = this.s;
    const lines = [];
    const g0 = goldPerKill(Math.max(10, s.maxStage));
    if (c.gold) { const gold = g0 * c.gold; this.addGold(gold); lines.push(`💰 골드 +${fmt(gold)}`); }
    for (const [id, n] of Object.entries(c.mats || {})) { bankAdd(s, id, n); lines.push(`${MATS[id].icon} ${MATS[id].name} +${fmt(n)}`); }
    if (c.items) {
      for (let i = 0; i < c.items; i++) this.giveItem(this.newItem(DROP_SLOTS[Math.floor(Math.random() * DROP_SLOTS.length)], rollRarity(c.luck || 6), Math.max(1, s.maxStage)));
      lines.push(`📦 장비 ${c.items}개`);
    }
    s.stats.coupons = (s.stats.coupons || 0) + 1;
    return { name: c.name, lines };
  }

  // ---------- 장비 ----------
  // spec: { slot, kind?, aff? } 정해진 장비, 없으면 무작위
  newItem(slot, r, lvl, spec = {}) {
    const s = this.s;
    const item = { id: s.nextId++, slot, r, lvl: Math.max(1, lvl), enh: 0 };
    if (slot === 'weapon') item.kind = spec.kind || WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)];
    // 주력 방식: 무기는 종류대로, 나머지는 지정값 → 아니면 60% 확률로 지금 전투 방식
    if (slot !== 'weapon') item.aff = spec.aff || (Math.random() < 0.6 ? this.style() : STYLE_IDS[Math.floor(Math.random() * STYLE_IDS.length)]);
    // 근접 · 원거리 · 마법 비율 (장비마다 다름)
    item.w = rollWeights(slot === 'weapon' ? WEAPONS[item.kind].style : item.aff);
    // 영웅 등급 이상(또는 전리품 공예): 특수 옵션 1개
    if (r >= 3 || spec.sp) {
      const keys = Object.keys(SPECIALS);
      const k = keys[Math.floor(Math.random() * keys.length)];
      item.sp = { [k]: SPECIALS[k] * (0.7 + Math.random() * 0.6) };
    }
    if (!spec.noCount) {
      s.stats.items++;
      questEvent(s, 'item', 1);
    }
    if (r > (s.stats.bestRarity || 0)) s.stats.bestRarity = r;
    return item;
  }

  dropItem(luck, spec = null) {
    const s = this.s;
    const r = rollRarity(luck);
    const slot = spec?.slot || DROP_SLOTS[Math.floor(Math.random() * DROP_SLOTS.length)];
    const item = this.newItem(slot, r, s.stage, spec || {});
    this.fx({ type: 'loot', anchor: 'mon', text: '📦', color: RARITIES[r].color, life: 1.2 });
    if (r >= 4) this.toast(`${RARITIES[r].name} 장비 획득! ${itemName(item)}`, r >= 6 ? 'legend' : 'epic');
    this.giveItem(item);
  }

  // 생활 스킬(대장기술·제작)로 만든 장비: 역대 최고 스테이지 레벨, 최소 등급 보장, 성향은 지금 전투 방식
  // sp: 특수 옵션 보장 (전리품 공예)
  // kinds: 무기 종류 제한 (활 · 지팡이 깎기 등) → 지금 전투 방식에 맞는 종류 우선
  craftItem(slots, floor, notify = true, sp = false, kinds = null) {
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const r = Math.max(floor, rollRarity(2));
    let kind = null;
    if (slot === 'weapon') {
      const mine = kinds ? kinds.filter((k) => WEAPONS[k].style === this.style()) : null;
      const pool = kinds ? (mine.length ? mine : kinds) : null;
      kind = pool ? pool[Math.floor(Math.random() * pool.length)] : this.randomKindOfStyle();
    }
    const spec = slot === 'weapon' ? { kind, sp } : { aff: this.style(), sp };
    const item = this.newItem(slot, r, this.s.maxStage, spec);
    questEvent(this.s, 'craft', 1);
    if (notify) this.toast(`제작 완료: [${RARITIES[r].name}] ${itemName(item)}`, r >= 6 ? 'legend' : r >= 4 ? 'epic' : 'good');
    this.giveItem(item);
    return item;
  }
  randomKindOfStyle() {
    const sty = this.style();
    const kinds = WEAPON_IDS.filter((k) => WEAPONS[k].style === sty);
    return kinds[Math.floor(Math.random() * kinds.length)];
  }

  // 반지는 두 칸 중 약한 쪽(빈 칸 우선)에 비교
  targetSlot(item) {
    if (!isRing(item.slot)) return item.slot;
    const eq = this.s.equip;
    if (!eq.ring1) return 'ring1';
    if (!eq.ring2) return 'ring2';
    const sty = this.style();
    return itemScore(eq.ring1, sty) <= itemScore(eq.ring2, sty) ? 'ring1' : 'ring2';
  }

  // 장착했을 때의 전투력 변화 (양손 무기 ↔ 방패 관계 포함)
  upgradeGain(item) {
    const eq = this.s.equip;
    const sty = this.style();
    if (item.slot === 'shield') return this.twoHanded() ? -1 : itemScore(item, sty) - itemScore(eq.shield, sty);
    if (item.slot === 'weapon') {
      const newTwo = !!WEAPONS[item.kind || 'sword'].twoHand;
      const shieldNow = this.twoHanded() ? 0 : itemScore(eq.shield, sty);
      const shieldAfter = newTwo ? 0 : itemScore(eq.shield, sty);
      return itemScore(item, sty) + shieldAfter - itemScore(eq.weapon, sty) - shieldNow;
    }
    return itemScore(item, sty) - itemScore(eq[this.targetSlot(item)], sty);
  }

  // keep: 조합 결과물(자동 판매하지 않음)
  giveItem(item, keep = false) {
    if (this.s.settings.autoEquip && this.upgradeGain(item) > 0) this.putOn(item);
    else this.stash(item, keep);
    this.rt.invDirty = true;
    // 자동 조합: 가방에 같은 부위 · 등급이 3개 모이면 바로 조합
    if (this.s.settings.autoCombine && !this.rt.combining) this.combineAll(true);
  }

  putOn(item) {
    const s = this.s;
    const hpRatio = this.rt.heroHp / this.heroMaxHp();
    const slot = this.targetSlot(item);
    item.slot = slot;
    const prev = s.equip[slot];
    s.equip[slot] = item;
    if (prev) this.stash(prev, true);
    this.dirtyStats();
    if (this.rt.heroDead <= 0) this.rt.heroHp = Math.min(this.heroMaxHp(), hpRatio * this.heroMaxHp());
  }

  stash(item, keep = false) {
    const s = this.s;
    if ((!keep && item.r < s.settings.autoSell) || s.inv.length >= INV_MAX) this.addGold(itemSellPrice(item));
    else s.inv.push(item);
  }

  equipItem(id) {
    const s = this.s;
    const i = s.inv.findIndex((x) => x.id === id);
    if (i < 0) return;
    const item = s.inv[i];
    s.inv.splice(i, 1);
    this.putOn(item);
    this.rt.invDirty = true;
  }

  unequip(slot) {
    const s = this.s;
    const it = s.equip[slot];
    if (!it || s.inv.length >= INV_MAX) return false;
    s.equip[slot] = null;
    s.inv.push(it);
    this.dirtyStats();
    this.rt.heroHp = Math.min(this.rt.heroHp, this.heroMaxHp());
    this.rt.invDirty = true;
    return true;
  }

  sellItem(id) {
    const s = this.s;
    const i = s.inv.findIndex((x) => x.id === id);
    if (i < 0) return;
    this.addGold(itemSellPrice(s.inv[i]));
    s.inv.splice(i, 1);
    this.rt.invDirty = true;
  }

  // rarity 이하 등급 일괄 판매
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

  findEquipped(id) { return SLOT_IDS.find((sl) => this.s.equip[sl]?.id === id) || null; }
  // ---------- 펫: 골드 강화 · 잠재능력 5줄 ----------
  petData(id) {
    const P = this.s.world.pets;
    P.data ||= {};
    const d = (P.data[id] ||= { enh: 0 });
    d.id = 'pet:' + id;
    d.slot = 'pet';
    d.lvl = Math.max(1, this.s.maxStage || 1);
    return d;
  }
  petEnhBonus(key) {
    const ap = this.s.world.pets.active;
    if (!ap || !PET_ENH[key]) return 0;
    return (this.s.world.pets.data?.[ap]?.enh || 0) * PET_ENH[key];
  }
  petEnhCost(id) { return petEnhCost(this.s.maxStage, this.petData(id).enh); }
  enhancePet(id) {
    const d = this.petData(id);
    if (!this.s.world.pets.owned.includes(id) || d.enh >= PET_ENH_MAX) return false;
    const c = this.petEnhCost(id);
    if (this.s.gold < c) return false;
    this.s.gold -= c;
    d.enh++;
    this.dirtyStats();
    return true;
  }
  // 이 펫을 데리고 다닐 때 기준 강화 1회 전투력 변화
  petEnhDelta(id) {
    const d = this.petData(id);
    const P = this.s.world.pets;
    return this.powerDelta(() => { const a = P.active; P.active = id; d.enh++; return () => { d.enh--; P.active = a; }; });
  }

  // ---------- 장비칸: 강화 · 잠재능력 (장비를 바꿔도 칸에 남음) ----------
  slotData(sl) {
    this.s.slots ||= {};
    const d = (this.s.slots[sl] ||= { enh: 0 });
    d.id = 'slot:' + sl;
    d.slot = sl;
    d.lvl = Math.max(1, this.s.maxStage || 1);
    return d;
  }

  findItem(id) {
    if (typeof id === 'string' && id.startsWith('slot:')) return SLOT_IDS.includes(id.slice(5)) ? this.slotData(id.slice(5)) : undefined;
    if (typeof id === 'string' && id.startsWith('pet:')) {
      const pid = id.slice(4);
      return this.s.world.pets.owned.includes(pid) ? this.petData(pid) : undefined;
    }
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
    this.dirtyStats();
    this.rt.invDirty = true;
    return true;
  }

  // ---------- 장비 조합 ----------
  // 가방 속 같은 부위 · 같은 등급 장비 3개 → 한 단계 높은 등급 1개
  // 결과: 셋 중 가장 좋은 장비의 종류 · 성향, 가장 높은 레벨과 강화 수치를 이어받음
  combineKey(it) { return `${isRing(it.slot) ? 'ring1' : it.slot}/${it.r}`; }
  combineGroups(auto = false) {
    const groups = {};
    for (const it of this.s.inv) {
      if (it.r >= RARITIES.length - 1) continue;
      if (auto && (it.enh > 0 || it.pot)) continue; // 자동 조합은 강화 · 잠재능력 장비를 쓰지 않음
      (groups[this.combineKey(it)] ||= []).push(it);
    }
    return groups;
  }
  combineOne(key, auto = false) {
    const s = this.s;
    const list = this.combineGroups(auto)[key];
    if (!list || list.length < 3) return null;
    const sty = this.style();
    // 강화 안 한 것 · 약한 것부터 재료로 사용
    const use = [...list].sort((a, b) => ((a.pot ? 1 : 0) - (b.pot ? 1 : 0)) || (a.enh - b.enh) || (itemScore(a, sty) - itemScore(b, sty))).slice(0, 3);
    const best = use.reduce((a, b) => (itemScore(b, sty) > itemScore(a, sty) ? b : a));
    const ids = new Set(use.map((x) => x.id));
    s.inv = s.inv.filter((x) => !ids.has(x.id));
    const slot = isRing(best.slot) ? 'ring1' : best.slot;
    const item = this.newItem(slot, best.r + 1, Math.max(...use.map((x) => x.lvl)), { kind: best.kind, aff: best.aff, noCount: true });
    item.enh = Math.max(...use.map((x) => x.enh || 0));
    if (best.w) item.w = best.w;
    const withPot = use.filter((x) => x.pot).sort((a, b) => b.pot.t - a.pot.t)[0];
    if (withPot) item.pot = withPot.pot;
    s.stats.combines = (s.stats.combines || 0) + 1;
    if (item.r > (s.stats.bestRarity || 0)) s.stats.bestRarity = item.r;
    if (item.r >= 5) this.toast(`조합 성공! [${RARITIES[item.r].name}] ${itemName(item)}`, item.r >= 7 ? 'legend' : 'epic');
    this.rt.combining = true;
    this.giveItem(item, true);
    this.rt.combining = false;
    this.rt.invDirty = true;
    return item;
  }
  // 조합할 수 있는 만큼 반복 (낮은 등급부터 → 연쇄 조합)
  combineAll(auto = false) {
    let n = 0;
    for (let guard = 0; guard < 500; guard++) {
      const groups = this.combineGroups(auto);
      const key = Object.keys(groups).filter((k) => groups[k].length >= 3).sort((a, b) => +a.split('/')[1] - +b.split('/')[1])[0];
      if (!key || !this.combineOne(key, auto)) break;
      n++;
    }
    return n;
  }
  toggleAutoCombine() {
    this.s.settings.autoCombine = !this.s.settings.autoCombine;
    if (this.s.settings.autoCombine) this.combineAll(true);
  }

  // ---------- 오프라인 ----------
  offlineCapSec() { return OFFLINE_CAP; }

  // 오프라인: 지금 고른 몬스터를 계속 사냥한 것으로 계산 (효율 50%, 보스는 일반 몬스터로 대체)
  applyOffline(sec) {
    const s = this.s;
    const t = Math.min(sec, this.offlineCapSec());
    const { z } = s.target;
    const mi = s.target.mi === BOSS_MI ? 4 : s.target.mi;
    const lvl = monLevel(z, mi);
    const m = monsterStats(lvl);
    const tpk = Math.max(m.hp / Math.max(1e-9, this.dpsVs(m.def)), 0.3) + RESPAWN;
    const kills = (t / tpk) * 0.5;
    const gold = kills * goldPerKill(lvl) * this.goldMult();
    this.addGold(gold);
    s.stats.kills += Math.floor(kills);
    const key = `${z}_${mi}`;
    s.bestiary[key] = (s.bestiary[key] || 0) + Math.floor(kills);
    questEvent(s, 'kill', Math.floor(kills));
    s.stats.playTime += t;
    const lm = this.lootMult();
    let mats = 0;
    let drops = 0;
    for (const d of lootTable(z, mi)) {
      const exp = kills * Math.min(1, d.c * lm);
      if (d.mat) {
        const n = Math.floor(exp * (d.q[0] + d.q[1]) / 2 + Math.random());
        if (n > 0) { bankAdd(s, d.mat, n); mats += n; }
      } else {
        const n = Math.min(6, Math.floor(exp + Math.random()));
        for (let i = 0; i < n && drops < 20; i++, drops++) this.giveItem(this.newItem(d.slot, rollRarity(1), lvl, d));
      }
    }
    const life = newLifeLog();
    lifeUpdate(this, t, life);
    return { sec: t, gold, kills: Math.floor(kills), drops, bones: mats, life };
  }

  // ---------- 보물 상자 ----------
  // 열면: 골드 + (보석 · 지금까지 연 지역의 고유 전리품 · 장비) 중 확률로
  openChests(n) {
    const s = this.s;
    n = Math.min(n, s.life.bank.chest || 0);
    if (n <= 0) return null;
    bankAdd(s, 'chest', -n);
    const lines = [];
    const gold = goldPerKill(Math.max(1, s.maxStage)) * 80 * n * (0.5 + Math.random()) * this.goldMult();
    this.addGold(gold);
    lines.push(`💰 골드 +${fmt(gold)}`);
    const got = {};
    const add = (id, q) => { bankAdd(s, id, q); got[id] = (got[id] || 0) + q; };
    const zTop = Math.min(ZONES.length - 1, s.maxZone);
    let eq = 0;
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.5) add(LOOT_POOLS.gem[Math.min(3, Math.floor(Math.random() * (zTop / 2 + 1)))], 1);
      if (Math.random() < 0.6) {
        const zone = ZONES[Math.floor(Math.random() * (zTop + 1))];
        add(zone.drops[Math.floor(Math.random() * 5)], 1 + Math.floor(Math.random() * 5));
      }
      if (Math.random() < 0.1) add(ZONES[Math.floor(Math.random() * (zTop + 1))].drops[BOSS_MI], 1);
      if (Math.random() < 0.5) add('cube', 1 + Math.floor(Math.random() * 3));
      if (Math.random() < 0.3) { this.dropItem(6); eq++; }
    }
    if (eq) lines.push(`📦 장비 ${eq}개`);
    for (const [id, q] of Object.entries(got)) if (q > 0) lines.push(`${MATS[id].icon} ${MATS[id].name} +${fmt(q)}`);
    return lines;
  }

  // ---------- 메인 업데이트 ----------
  update(dt) {
    const s = this.s;
    const rt = this.rt;
    s.stats.playTime += dt;
    rt.worldT -= dt;
    if (rt.worldT <= 0) { rt.worldT = 2; worldTick(this); }
    lifeUpdate(this, dt);

    rt.lunge = Math.max(0, rt.lunge - dt);
    rt.shake = Math.max(0, rt.shake - dt);
    rt.spawnT += dt;
    for (const f of rt.fx) f.t += dt;
    if (rt.fx.length && rt.fx[0].t > 2) rt.fx = rt.fx.filter((f) => f.t < f.life);

    const st = this.stats();
    const maxHp = st.hp;
    if (rt.heroDead > 0) {
      rt.heroDead -= dt;
      if (rt.heroDead <= 0) rt.heroHp = maxHp;
      return;
    }
    rt.heroHp = Math.min(maxHp, rt.heroHp + maxHp * (REGEN + st.regen) * dt);
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

    // 몬스터 반격 (방어 · 피해 감소 · 철벽)
    rt.monAtkTimer += dt;
    if (rt.monAtkTimer >= m.interval) {
      rt.monAtkTimer -= m.interval;
      const dmg = incomingHit(m.str, st.def) * (1 - st.dr);
      rt.heroHp -= dmg;
      this.fx({ type: 'hurt', anchor: 'hero', text: '-' + fmt(dmg), life: 0.8 });
      if (rt.heroHp <= 0) this.heroDie();
    }
  }
}
