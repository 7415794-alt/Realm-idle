// 게임 로직 (DOM 의존 없음 → 테스트/시뮬레이션 가능)
// 영웅 능력치는 장비(+강화) · 기도 · 물약 · 펫 · 날씨 · 스킬로만 정해짐
// 전투 방식(근접 · 원거리 · 마법)은 장착한 무기로 결정
import {
  BOSS_TIME, RESPAWN, HERO_REVIVE, INV_MAX, OFFLINE_CAP, BOSS_MI, AUTO_STREAK, BOSS_RETRY, BOSS_GOLD,
  goldPerKill, monsterStats, monsterInfo, monLevel, zoneTitle, maxHitFor, incomingHit, ZONES, LOOT_POOLS,
  HERO_BASE, STAT_CAPS, CRIT_MULT, VIP, BASE_MIN_HIT, SKILLS, RARITIES, SLOT_IDS, DROP_SLOTS, AFF_SLOTS, WEAPONS, WEAPON_IDS,
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
      streak: 0,   // 자동 진행: 지금 대상 연속 처치 수
      retry: 0,    // 자동 진행: 후퇴 후 다시 나아가기까지 남은 처치 수
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
      def: g.def * buffMult(s, 'def') * (1 + this.bonus('def')),
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
  lootMult() { return VIP.mult * buffMult(this.s, 'drop') * (1 + this.bonus('drop')); }

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
      const before = s.maxStage;
      s.maxStage = m.lvl;
      for (const k of SKILLS) if (k.unlock > before && k.unlock <= m.lvl) this.toast(`새 스킬 해금: ${k.icon} ${k.name}`, 'epic');
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
    // 다른 전투 방식의 무기는 자동 장착하지 않음 (직접 바꾸기)
    const otherStyle = item.slot === 'weapon' && this.s.equip.weapon && itemStyle(item) !== this.style();
    if (this.s.settings.autoEquip && !otherStyle && this.upgradeGain(item) > 0) this.putOn(item);
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

  // ---------- 장비 조합 ----------
  // 가방 속 같은 부위 · 같은 등급 장비 3개 → 한 단계 높은 등급 1개
  // 결과: 셋 중 가장 좋은 장비의 종류 · 성향, 가장 높은 레벨과 강화 수치를 이어받음
  combineKey(it) { return `${isRing(it.slot) ? 'ring1' : it.slot}/${it.r}`; }
  combineGroups(auto = false) {
    const groups = {};
    for (const it of this.s.inv) {
      if (it.r >= RARITIES.length - 1) continue;
      if (auto && it.enh > 0) continue; // 자동 조합은 강화한 장비를 쓰지 않음
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
    const use = [...list].sort((a, b) => (a.enh - b.enh) || (itemScore(a, sty) - itemScore(b, sty))).slice(0, 3);
    const best = use.reduce((a, b) => (itemScore(b, sty) > itemScore(a, sty) ? b : a));
    const ids = new Set(use.map((x) => x.id));
    s.inv = s.inv.filter((x) => !ids.has(x.id));
    const slot = isRing(best.slot) ? 'ring1' : best.slot;
    const item = this.newItem(slot, best.r + 1, Math.max(...use.map((x) => x.lvl)), { kind: best.kind, aff: best.aff, noCount: true });
    item.enh = Math.max(...use.map((x) => x.enh || 0));
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
