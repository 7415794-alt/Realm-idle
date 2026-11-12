// 게임 로직 (DOM 의존 없음 → 테스트/시뮬레이션 가능)
// 영웅 능력치는 장비(+강화) · 기도 · 물약 · 스킬로만 정해짐
import {
  STAGE_KILLS, BOSS_TIME, RESPAWN, HERO_REVIVE, INV_MAX, OFFLINE_CAP,
  goldPerKill, isZoneBoss, bossGoldMult, monsterStats, maxHitVs, incomingHit,
  HERO_BASE, CRIT_MULT, BASE_MIN_HIT, zoneOf, SKILLS, RARITIES, SLOT_IDS, WEAPONS, WEAPON_IDS,
  ENHANCE_MAX, itemStats, itemScore, itemName, itemSellPrice, enhanceCost, rollRarity,
} from './data.js';
import { fmt } from './format.js';
import { lifeUpdate, autoEat, buffMult, prayerBonus, newLifeLog, boneForStage, bankAdd } from './life.js';

const SKILL = Object.fromEntries(SKILLS.map((k) => [k.id, k]));
export const SPEEDS = [1, 2, 4, 8, 16];
const DROP_CHANCE = 0.06;          // 일반 몬스터 장비 드롭 확률
const REGEN = 0.02;                // 초당 체력 회복 (최대 체력 대비)

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
      skill: Object.fromEntries(SKILLS.map((k) => [k.id, { cd: 0, t: 0 }])),
    };
    this.rt.heroHp = this.heroMaxHp();
    this.spawn();
  }

  // 게임 배속 (저장값이 잘못돼도 x1)
  speed() { return SPEEDS.includes(this.s.settings.speed) ? this.s.settings.speed : 1; }
  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed());
    this.s.settings.speed = SPEEDS[(i + 1) % SPEEDS.length];
  }

  // ---------- 능력치 ----------
  weaponDef() { const w = this.s.equip.weapon; return w ? WEAPONS[w.kind || 'sword'] : null; }
  twoHanded() { return !!this.weaponDef()?.twoHand; }

  // 장비 합산 (장비가 바뀔 때만 다시 계산)
  gearStats() {
    if (this.rt.statCache) return this.rt.statCache;
    const st = { ...HERO_BASE };
    for (const slot of SLOT_IDS) {
      const it = this.s.equip[slot];
      if (!it) continue;
      if (slot === 'shield' && this.twoHanded()) continue;
      for (const [k, v] of Object.entries(itemStats(it))) st[k] = (st[k] || 0) + v;
    }
    this.rt.statCache = st;
    return st;
  }
  dirtyStats() { this.rt.statCache = null; }

  skillActive(id) { return this.rt.skill[id].t > 0; }

  stats() {
    const g = this.gearStats();
    const s = this.s;
    const atkMult = buffMult(s, 'atk') * (1 + prayerBonus(s, 'atk'));
    return {
      atk: g.atk * atkMult,
      str: g.str * atkMult,
      def: g.def * (1 + prayerBonus(s, 'def')),
      hp: g.hp * buffMult(s, 'hp') * (1 + prayerBonus(s, 'hp')),
      crit: Math.min(0.75, g.crit),
      dmg: 1 + prayerBonus(s, 'dmg'),
    };
  }

  heroMaxHp() { return this.stats().hp; }
  atkSpeed() {
    return (this.weaponDef()?.speed || 1) * (this.skillActive('frenzy') ? 2 : 1) * buffMult(this.s, 'speed');
  }
  minHitFrac() { return BASE_MIN_HIT + (this.weaponDef()?.minHit || 0); }

  // 대상 몬스터 방어를 반영한 한 방 최대 피해
  maxHit(mDef = this.rt.monster?.def || 0) {
    const st = this.stats();
    return maxHitVs(st.atk, st.str, mDef) * st.dmg;
  }
  // 평균 DPS (치명타 포함)
  dpsVs(mDef) {
    const st = this.stats();
    const mh = maxHitVs(st.atk, st.str, mDef) * st.dmg;
    const avg = (mh * (1 + this.minHitFrac())) / 2;
    return avg * (1 + st.crit * (CRIT_MULT - 1)) * this.atkSpeed();
  }
  totalDps() { return this.dpsVs(this.rt.monster?.def ?? monsterStats(this.s.stage).def); }
  // 전투력: 장착 장비 점수 합
  powerScore() {
    let sum = 0;
    for (const slot of SLOT_IDS) if (!(slot === 'shield' && this.twoHanded())) sum += itemScore(this.s.equip[slot]);
    return sum;
  }

  goldMult() {
    return (this.skillActive('midas') ? 3 : 1) * buffMult(this.s, 'gold') * (1 + prayerBonus(this.s, 'gold'));
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
      const zb = isZoneBoss(st);
      m = { e: zone.boss[0], name: zone.boss[1], boss: true, zoneBoss: zb, ...monsterStats(st, zb ? 'zoneBoss' : 'boss') };
      rt.bossTime = BOSS_TIME;
    } else {
      const [e, name] = zone.monsters[Math.floor(Math.random() * zone.monsters.length)];
      m = { e, name, boss: false, ...monsterStats(st) };
      m.hp *= 0.9 + Math.random() * 0.2;
    }
    m.maxHp = m.hp;
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
    const m = rt.monster;
    if (rt.heroDead > 0 || !m || m.dead) return;
    const mh = this.maxHit(m.def);
    const lo = mh * this.minHitFrac();
    let dmg = lo + Math.random() * (mh - lo);
    const crit = Math.random() < this.stats().crit;
    if (crit) dmg *= CRIT_MULT;
    if (isTap) dmg *= 0.5; // 탭은 절반 피해의 추가 공격
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

    // 장비: 보스는 여러 번 굴려 가장 좋은 등급
    if (m.zoneBoss) { this.dropItem(8); this.dropItem(4); }
    else if (m.boss) this.dropItem(4);
    else if (Math.random() < DROP_CHANCE) this.dropItem(1);

    if (m.boss) {
      s.stats.bossKills++;
      s.stage++;
      s.kills = 0;
      if (s.stage > s.maxStage) s.maxStage = s.stage;
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
    s.stats.deaths++;
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
      const dmg = this.maxHit() * 8;
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
  newItem(slot, r, lvl) {
    const s = this.s;
    const item = { id: s.nextId++, slot, r, lvl: Math.max(1, lvl), enh: 0 };
    if (slot === 'weapon') item.kind = WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)];
    s.stats.items++;
    if (r > (s.stats.bestRarity || 0)) s.stats.bestRarity = r;
    return item;
  }

  dropItem(luck) {
    const s = this.s;
    const r = rollRarity(luck);
    const slot = SLOT_IDS[Math.floor(Math.random() * SLOT_IDS.length)];
    const item = this.newItem(slot, r, s.stage);
    this.fx({ type: 'loot', anchor: 'mon', text: '📦', color: RARITIES[r].color, life: 1.2 });
    if (r >= 4) this.toast(`${RARITIES[r].name} 장비 획득! ${itemName(item)}`, r >= 6 ? 'legend' : 'epic');
    this.giveItem(item);
  }

  // 생활 스킬(대장기술·제작)로 만든 장비: 역대 최고 스테이지 레벨, 최소 등급 보장
  craftItem(slots, floor, notify = true) {
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const r = Math.max(floor, rollRarity(2));
    const item = this.newItem(slot, r, this.s.maxStage);
    if (notify) this.toast(`제작 완료: [${RARITIES[r].name}] ${itemName(item)}`, r >= 6 ? 'legend' : r >= 4 ? 'epic' : 'good');
    this.giveItem(item);
    return item;
  }

  // 지역(20스테이지 단위)마다 다른 뼈
  addBones(n) {
    bankAdd(this.s, boneForStage(this.s.stage), n);
  }

  // 장착했을 때의 전투력 변화 (양손검 ↔ 방패 관계 포함)
  upgradeGain(item) {
    const eq = this.s.equip;
    if (item.slot === 'shield') return this.twoHanded() ? -1 : itemScore(item) - itemScore(eq.shield);
    if (item.slot === 'weapon') {
      const newTwo = !!WEAPONS[item.kind || 'sword'].twoHand;
      const shieldNow = this.twoHanded() ? 0 : itemScore(eq.shield);
      const shieldAfter = newTwo ? 0 : itemScore(eq.shield);
      return itemScore(item) + shieldAfter - itemScore(eq.weapon) - shieldNow;
    }
    return itemScore(item) - itemScore(eq[item.slot]);
  }

  giveItem(item) {
    if (this.s.settings.autoEquip && this.upgradeGain(item) > 0) this.putOn(item);
    else this.stash(item);
    this.rt.invDirty = true;
  }

  putOn(item) {
    const s = this.s;
    const hpRatio = this.rt.heroHp / this.heroMaxHp();
    const prev = s.equip[item.slot];
    s.equip[item.slot] = item;
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
    this.dirtyStats();
    this.rt.invDirty = true;
    return true;
  }

  // ---------- 오프라인 ----------
  offlineCapSec() { return OFFLINE_CAP; }

  applyOffline(sec) {
    const s = this.s;
    const t = Math.min(sec, this.offlineCapSec());
    const m = monsterStats(s.stage);
    const tpk = Math.max(m.hp / Math.max(1e-9, this.dpsVs(m.def)), 0.3) + RESPAWN;
    const kills = (t / tpk) * 0.5;
    const gold = kills * goldPerKill(s.stage) * this.goldMult();
    this.addGold(gold);
    s.stats.kills += Math.floor(kills);
    s.stats.playTime += t;
    // 오프라인 동안 뼈와 장비도 일부 획득
    const bones = Math.floor(kills * 0.3);
    if (bones > 0) this.addBones(bones);
    const drops = Math.min(20, Math.floor(kills * DROP_CHANCE));
    for (let i = 0; i < drops; i++) {
      this.giveItem(this.newItem(SLOT_IDS[Math.floor(Math.random() * SLOT_IDS.length)], rollRarity(1), s.stage));
    }
    const life = newLifeLog();
    lifeUpdate(this, t, life);
    return { sec: t, gold, kills: Math.floor(kills), drops, bones, life };
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
    rt.heroHp = Math.min(maxHp, rt.heroHp + maxHp * REGEN * dt);
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

    // 몬스터 반격
    rt.monAtkTimer += dt;
    if (rt.monAtkTimer >= m.interval) {
      rt.monAtkTimer -= m.interval;
      const dmg = incomingHit(m.str, this.stats().def) * (this.skillActive('fortify') ? 0.5 : 1);
      rt.heroHp -= dmg;
      this.fx({ type: 'hurt', anchor: 'hero', text: '-' + fmt(dmg), life: 0.8 });
      if (rt.heroHp <= 0) this.heroDie();
    }
  }
}
