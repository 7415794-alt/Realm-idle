// 게임 로직 (DOM 의존 없음 → 테스트/시뮬레이션 가능)
// 영웅 능력치는 장비(+강화) · 기도 · 물약 · 펫 · 날씨 · 스킬로만 정해짐
// 전투 방식(근접 · 원거리 · 마법)은 장착한 무기로 결정
import {
  STAGE_KILLS, BOSS_TIME, RESPAWN, HERO_REVIVE, INV_MAX, OFFLINE_CAP,
  goldPerKill, isZoneBoss, bossGoldMult, monsterStats, maxHitFor, incomingHit,
  HERO_BASE, STAT_CAPS, CRIT_MULT, VIP, BASE_MIN_HIT, zoneOf, SKILLS, RARITIES, SLOT_IDS, DROP_SLOTS, AFF_SLOTS, WEAPONS, WEAPON_IDS,
  STYLE_IDS, SPECIALS, ENHANCE_MAX, itemStats, itemScore, itemStyle, itemName, itemSellPrice, enhanceCost, rollRarity,
  lootTable, isRing,
} from './data.js';
import { fmt } from './format.js';
import { lifeUpdate, autoEat, buffMult, prayerBonus, newLifeLog, bankAdd, MATS } from './life.js';
import { worldBonus, worldTick, questEvent, rollKillPets } from './world.js';

const SKILL = Object.fromEntries(SKILLS.map((k) => [k.id, k]));
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
      skill: Object.fromEntries(SKILLS.map((k) => [k.id, { cd: 0, t: 0 }])),
    };
    worldTick(this);
    this.rt.heroHp = this.heroMaxHp();
    this.spawn();
  }

  // 기도 + 펫 + 날씨 효과 합
  bonus(key) { return prayerBonus(this.s, key) + worldBonus(this.s, key); }

  // 게임 배속 (저장값이 잘못돼도 x1)
  speed() { return SPEEDS.includes(this.s.settings.speed) ? this.s.settings.speed : 1; }
  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed());
    this.s.settings.speed = SPEEDS[(i + 1) % SPEEDS.length];
  }

  // ---------- 능력치 ----------
  weaponDef() { const w = this.s.equip.weapon; return w ? WEAPONS[w.kind || 'sword'] : null; }
  twoHanded() { return !!this.weaponDef()?.twoHand; }
  style() { return this.weaponDef()?.style || 'melee'; }

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

  // 최종 능력치: 장비 + (물약 · 기도 · 펫 · 날씨)
  stats() {
    const g = this.gearStats();
    const s = this.s;
    const all = buffMult(s, 'atk') * (1 + this.bonus('atk'));
    const melee = all * (1 + this.bonus('melee'));
    return {
      atk: g.atk * melee,
      str: g.str * melee,
      rng: g.rng * all * (1 + this.bonus('rng')),
      mag: g.mag * all * (1 + this.bonus('mag')),
      def: g.def * (1 + this.bonus('def')),
      hp: g.hp * buffMult(s, 'hp') * (1 + this.bonus('hp')),
      crit: Math.min(STAT_CAPS.crit, g.crit + this.bonus('crit')),
      ls: Math.min(STAT_CAPS.ls, g.ls + this.bonus('ls')),
      dr: Math.min(STAT_CAPS.dr, g.dr + this.bonus('dr')),
      regen: Math.min(STAT_CAPS.regen, g.regen + this.bonus('regen')),
      dmg: 1 + this.bonus('dmg'),
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
    return maxHitFor(this.style(), st, mDef) * st.dmg;
  }
  // 평균 DPS (치명타 포함)
  dpsVs(mDef) {
    const st = this.stats();
    const mh = maxHitFor(this.style(), st, mDef) * st.dmg;
    const avg = (mh * (1 + this.minHitFrac())) / 2;
    return avg * (1 + st.crit * (CRIT_MULT - 1)) * this.atkSpeed();
  }
  totalDps() { return this.dpsVs(this.rt.monster?.def ?? monsterStats(this.s.stage).def); }
  // 전투력: 장착 장비 점수 합
  powerScore() {
    const sty = this.style();
    let sum = 0;
    for (const slot of SLOT_IDS) if (!(slot === 'shield' && this.twoHanded())) sum += itemScore(this.s.equip[slot], sty);
    return sum;
  }

  goldMult() {
    return VIP.mult * (this.skillActive('midas') ? 3 : 1) * buffMult(this.s, 'gold') * (1 + this.bonus('gold'));
  }
  // 전리품 확률 배율 (VIP · 펫 · 날씨 · 기도)
  lootMult() { return VIP.mult * (1 + this.bonus('drop')); }

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
      m = { e: zone.boss[0], name: zone.boss[1], boss: true, zoneBoss: zb, mi: 0, ...monsterStats(st, zb ? 'zoneBoss' : 'boss') };
      rt.bossTime = BOSS_TIME;
    } else {
      const mi = Math.floor(Math.random() * zone.monsters.length);
      const [e, name] = zone.monsters[mi];
      m = { e, name, boss: false, mi, ...monsterStats(st) };
      m.hp *= 0.9 + Math.random() * 0.2;
    }
    m.maxHp = m.hp;
    m.dead = false;
    rt.monster = m;
    rt.monAtkTimer = 0;
    rt.respawn = 0;
    rt.spawnT = 0;
  }

  monsterLoot(m = this.rt.monster) {
    return lootTable(this.s.stage, m?.mi || 0, m?.zoneBoss ? 'zoneBoss' : m?.boss ? 'boss' : 'normal');
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
    const mh = this.maxHit(m.def);
    const lo = mh * this.minHitFrac();
    let dmg = lo + Math.random() * (mh - lo);
    const crit = Math.random() < st.crit;
    if (crit) dmg *= CRIT_MULT;
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
    const gold = goldPerKill(s.stage) * (m.boss ? bossGoldMult(s.stage) : 1) * this.goldMult();
    this.addGold(gold);
    s.stats.kills++;
    questEvent(s, 'kill', 1);
    if (m.boss) questEvent(s, 'boss', 1);
    if (m.zoneBoss) questEvent(s, 'zoneBoss', 1);
    rollKillPets(this, m);
    this.fx({ type: 'gold', anchor: 'mon', text: '+' + fmt(gold), life: 1.1 });

    // 전리품: 몬스터별 표 + 보스는 추가로 고등급 장비
    const got = this.rollLoot(this.monsterLoot(m), m.boss);
    if (got.length) this.fx({ type: 'loot', anchor: 'mon', text: got.slice(0, 3).map((id) => MATS[id]?.icon || '').join(''), life: 1.1 });
    if (m.zoneBoss) { this.dropItem(8); this.dropItem(4); }
    else if (m.boss) this.dropItem(4);

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
    questEvent(this.s, 'gold', g);
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
  // spec: { slot, kind?, aff? } 정해진 장비, 없으면 무작위
  newItem(slot, r, lvl, spec = {}) {
    const s = this.s;
    const item = { id: s.nextId++, slot, r, lvl: Math.max(1, lvl), enh: 0 };
    if (slot === 'weapon') item.kind = spec.kind || WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)];
    if (AFF_SLOTS.includes(slot)) {
      // 성향: 지정값 → 아니면 60% 확률로 지금 전투 방식
      item.aff = spec.aff || (Math.random() < 0.6 ? this.style() : STYLE_IDS[Math.floor(Math.random() * STYLE_IDS.length)]);
    }
    // 영웅 등급 이상: 특수 옵션 1개 (등급이 높으면 더 강함)
    if (r >= 3) {
      const keys = Object.keys(SPECIALS);
      const k = keys[Math.floor(Math.random() * keys.length)];
      item.sp = { [k]: SPECIALS[k] * (0.7 + Math.random() * 0.6) };
    }
    s.stats.items++;
    questEvent(s, 'item', 1);
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
  craftItem(slots, floor, notify = true) {
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const r = Math.max(floor, rollRarity(2));
    const spec = slot === 'weapon' ? { kind: this.randomKindOfStyle() } : { aff: this.style() };
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

  giveItem(item) {
    // 다른 전투 방식의 무기는 자동 장착하지 않음 (직접 바꾸기)
    const otherStyle = item.slot === 'weapon' && this.s.equip.weapon && itemStyle(item) !== this.style();
    if (this.s.settings.autoEquip && !otherStyle && this.upgradeGain(item) > 0) this.putOn(item);
    else this.stash(item);
    this.rt.invDirty = true;
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
    questEvent(s, 'kill', Math.floor(kills));
    s.stats.playTime += t;
    // 전리품: 다섯 몬스터의 표를 고르게 적용한 기댓값
    const lm = this.lootMult();
    const per = kills / 5;
    let mats = 0;
    let drops = 0;
    for (let mi = 0; mi < 5; mi++) {
      for (const d of lootTable(s.stage, mi, 'normal')) {
        const exp = per * Math.min(1, d.c * lm);
        if (d.mat) {
          const n = Math.floor(exp * (d.q[0] + d.q[1]) / 2 + Math.random());
          if (n > 0) { bankAdd(s, d.mat, n); mats += n; }
        } else {
          const n = Math.min(4, Math.floor(exp + Math.random()));
          for (let i = 0; i < n && drops < 20; i++, drops++) this.giveItem(this.newItem(d.slot, rollRarity(1), s.stage, d));
        }
      }
    }
    const life = newLifeLog();
    lifeUpdate(this, t, life);
    return { sec: t, gold, kills: Math.floor(kills), drops, bones: mats, life };
  }

  // ---------- 메인 업데이트 ----------
  update(dt) {
    const s = this.s;
    const rt = this.rt;
    s.stats.playTime += dt;
    rt.worldT -= dt;
    if (rt.worldT <= 0) { rt.worldT = 2; worldTick(this); }
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
      const dmg = incomingHit(m.str, st.def) * (1 - st.dr) * (this.skillActive('fortify') ? 0.5 : 1);
      rt.heroHp -= dmg;
      this.fx({ type: 'hurt', anchor: 'hero', text: '-' + fmt(dmg), life: 0.8 });
      if (rt.heroHp <= 0) this.heroDie();
    }
  }
}
