// 생활 스킬 (채집 · 가공 · 제작) — 데이터와 로직 (DOM 없음)
import { goldPerKill, RARITIES, itemName } from './data.js';
import { fmt } from './format.js';

export const LIFE_MAX_LV = 99;
const AUTO_EAT_RATIO = 0.4;       // 체력이 이 비율 아래면 음식 자동 섭취
const MAX_LOOP = 200000;          // 한 번에 처리할 최대 행동 수 (안전장치)

// ---------- 경험치 ----------
// 다음 레벨까지 필요 경험치
export const xpToNext = (L) => Math.floor(15 * Math.pow(L, 1.5) + 15);
// XP_TABLE[L] = 레벨 L 도달에 필요한 누적 경험치
export const XP_TABLE = [0, 0];
for (let L = 1; L < LIFE_MAX_LV; L++) XP_TABLE.push(XP_TABLE[L] + xpToNext(L));

export function levelFromXp(xp) {
  let L = 1;
  while (L < LIFE_MAX_LV && xp >= XP_TABLE[L + 1]) L++;
  return L;
}

// ---------- 재료 / 소모품 ----------
// value: 판매가 배율 (현재 최고 스테이지의 처치 골드 기준)
export const MATS = {
  // 벌목
  log_oak: { name: '참나무 원목', icon: '🌳', value: 0.3 },
  log_pine: { name: '소나무 원목', icon: '🌲', value: 0.6 },
  log_maple: { name: '단풍나무 원목', icon: '🍁', value: 1.2 },
  log_yew: { name: '주목 원목', icon: '🎄', value: 2.4 },
  log_world: { name: '세계수 가지', icon: '🌴', value: 5 },
  // 채광
  ore_copper: { name: '구리 광석', icon: '🔸', value: 0.3 },
  rune_ess: { name: '룬 원석', icon: '💠', value: 0.4 },
  coal: { name: '석탄', icon: '⚫', value: 0.5 },
  ore_iron: { name: '철 광석', icon: '⚪', value: 0.8 },
  ore_mithril: { name: '미스릴 광석', icon: '🔷', value: 2 },
  ore_adamant: { name: '아다만 광석', icon: '🔶', value: 4 },
  gem: { name: '보석', icon: '💎', value: 15 },
  // 낚시
  fish_minnow: { name: '피라미', icon: '🐟', value: 0.3 },
  fish_shrimp: { name: '새우', icon: '🦐', value: 0.6 },
  fish_tropical: { name: '열대어', icon: '🐠', value: 1.2 },
  fish_puffer: { name: '복어', icon: '🐡', value: 2.4 },
  fish_shark: { name: '상어', icon: '🦈', value: 5 },
  // 요리 (heal: 최대 체력 대비 회복량)
  food_minnow: { name: '피라미 꼬치', icon: '🍢', value: 0.6, heal: 0.2 },
  food_shrimp: { name: '새우튀김', icon: '🍤', value: 1.2, heal: 0.3 },
  food_tropical: { name: '생선 초밥', icon: '🍣', value: 2.4, heal: 0.4 },
  food_puffer: { name: '복어 전골', icon: '🍲', value: 4.8, heal: 0.55 },
  food_shark: { name: '상어 스테이크', icon: '🥩', value: 10, heal: 0.75 },
  // 대장기술
  bar_bronze: { name: '청동 주괴', icon: '🧱', value: 0.8 },
  bar_iron: { name: '철 주괴', icon: '🧱', value: 2 },
  bar_mithril: { name: '미스릴 주괴', icon: '🧱', value: 5 },
  bar_adamant: { name: '아다만 주괴', icon: '🧱', value: 10 },
  // 도둑질 · 기타
  herb: { name: '약초', icon: '🌿', value: 0.5 },
  herb_rare: { name: '희귀 약초', icon: '🍀', value: 3 },
  bone: { name: '뼈', icon: '🦴', value: 0.2 },
  // 비전술
  rune_air: { name: '바람 룬', icon: '🌀', value: 0.8 },
  rune_fire: { name: '불 룬', icon: '🔥', value: 1.6 },
  rune_earth: { name: '대지 룬', icon: '⛰️', value: 3 },
  rune_chaos: { name: '혼돈 룬', icon: '🌑', value: 6 },
  // 연금술 (buff: 효과 종류, dur: 지속 시간(초))
  pot_atk: { name: '힘의 물약', icon: '🧪', value: 2, buff: ['atk'], dur: 600 },
  pot_gold: { name: '행운의 물약', icon: '🧪', value: 3, buff: ['gold'], dur: 600 },
  pot_speed: { name: '신속의 물약', icon: '🧪', value: 4, buff: ['speed'], dur: 600 },
  pot_hp: { name: '거인의 물약', icon: '🧪', value: 6, buff: ['hp'], dur: 600 },
  pot_all: { name: '만능 물약', icon: '🍷', value: 20, buff: ['atk', 'gold', 'speed', 'hp'], dur: 900 },
};

export const BUFFS = {
  atk: { name: '공격력', mult: 1.5, label: '+50%' },
  gold: { name: '골드', mult: 1.5, label: '+50%' },
  speed: { name: '공격 속도', mult: 1.3, label: '+30%' },
  hp: { name: '최대 체력', mult: 2, label: '+100%' },
};

// ---------- 스킬 / 행동 ----------
// in: 소모 재료, out: 획득 재료, extra: [재료, 확률] 추가 획득,
// equip: { slots, r } 장비 제작, gold: 처치 골드 배율 (도둑질)
export const LIFE_SKILLS = [
  {
    id: 'wood', name: '벌목', icon: '🪓', kind: '채집', desc: '나무를 베어 원목을 얻습니다. 가끔 약초를 발견합니다.',
    actions: [
      { id: 'oak', name: '참나무', icon: '🌳', lvl: 1, time: 3, xp: 8, out: { log_oak: 1 }, extra: [['herb', 0.05]] },
      { id: 'pine', name: '소나무', icon: '🌲', lvl: 12, time: 3.5, xp: 15, out: { log_pine: 1 }, extra: [['herb', 0.06]] },
      { id: 'maple', name: '단풍나무', icon: '🍁', lvl: 28, time: 4, xp: 28, out: { log_maple: 1 }, extra: [['herb', 0.07]] },
      { id: 'yew', name: '주목', icon: '🎄', lvl: 45, time: 4.5, xp: 45, out: { log_yew: 1 }, extra: [['herb_rare', 0.04]] },
      { id: 'world', name: '세계수', icon: '🌴', lvl: 65, time: 5, xp: 75, out: { log_world: 1 }, extra: [['herb_rare', 0.06]] },
    ],
  },
  {
    id: 'mine', name: '채광', icon: '⛏️', kind: '채집', desc: '광석과 룬 원석을 캡니다. 가끔 보석이 나옵니다.',
    actions: [
      { id: 'copper', name: '구리 광맥', icon: '🔸', lvl: 1, time: 3, xp: 8, out: { ore_copper: 1 }, extra: [['gem', 0.01]] },
      { id: 'runeess', name: '룬 원석 광맥', icon: '💠', lvl: 5, time: 3, xp: 10, out: { rune_ess: 1 }, extra: [['gem', 0.01]] },
      { id: 'coal', name: '석탄 광맥', icon: '⚫', lvl: 12, time: 3.5, xp: 14, out: { coal: 1 }, extra: [['gem', 0.015]] },
      { id: 'iron', name: '철 광맥', icon: '⚪', lvl: 15, time: 3.5, xp: 17, out: { ore_iron: 1 }, extra: [['gem', 0.015]] },
      { id: 'mithril', name: '미스릴 광맥', icon: '🔷', lvl: 35, time: 4.5, xp: 35, out: { ore_mithril: 1 }, extra: [['gem', 0.02]] },
      { id: 'adamant', name: '아다만 광맥', icon: '🔶', lvl: 55, time: 5, xp: 60, out: { ore_adamant: 1 }, extra: [['gem', 0.03]] },
    ],
  },
  {
    id: 'fish', name: '낚시', icon: '🎣', kind: '채집', desc: '물고기를 낚습니다. 요리와 연금술 재료가 됩니다.',
    actions: [
      { id: 'minnow', name: '개울 낚시', icon: '🐟', lvl: 1, time: 3, xp: 8, out: { fish_minnow: 1 } },
      { id: 'shrimp', name: '갯벌 통발', icon: '🦐', lvl: 12, time: 3.5, xp: 15, out: { fish_shrimp: 1 } },
      { id: 'tropical', name: '산호초 낚시', icon: '🐠', lvl: 28, time: 4, xp: 28, out: { fish_tropical: 1 } },
      { id: 'puffer', name: '먼바다 낚시', icon: '🐡', lvl: 45, time: 4.5, xp: 45, out: { fish_puffer: 1 } },
      { id: 'shark', name: '심해 낚시', icon: '🦈', lvl: 65, time: 5, xp: 75, out: { fish_shark: 1 } },
    ],
  },
  {
    id: 'cook', name: '요리', icon: '🍳', kind: '가공', desc: '물고기를 요리합니다. 음식은 전투 중 체력이 40% 아래로 떨어지면 자동으로 먹습니다. 레벨이 낮으면 태울 수 있습니다.',
    burn: true,
    actions: [
      { id: 'minnow', name: '피라미 꼬치', icon: '🍢', lvl: 1, time: 2.5, xp: 10, in: { fish_minnow: 1 }, out: { food_minnow: 1 } },
      { id: 'shrimp', name: '새우튀김', icon: '🍤', lvl: 12, time: 2.5, xp: 18, in: { fish_shrimp: 1 }, out: { food_shrimp: 1 } },
      { id: 'tropical', name: '생선 초밥', icon: '🍣', lvl: 28, time: 3, xp: 32, in: { fish_tropical: 1 }, out: { food_tropical: 1 } },
      { id: 'puffer', name: '복어 전골', icon: '🍲', lvl: 45, time: 3, xp: 50, in: { fish_puffer: 1 }, out: { food_puffer: 1 } },
      { id: 'shark', name: '상어 스테이크', icon: '🥩', lvl: 65, time: 3.5, xp: 80, in: { fish_shark: 1 }, out: { food_shark: 1 } },
    ],
  },
  {
    id: 'smith', name: '대장기술', icon: '🔨', kind: '가공', desc: '광석을 녹여 주괴를 만들고, 주괴로 무기와 방어구를 단조합니다.',
    actions: [
      { id: 'bronze', name: '청동 주괴', icon: '🧱', lvl: 1, time: 2.5, xp: 8, in: { ore_copper: 2 }, out: { bar_bronze: 1 } },
      { id: 'gear0', name: '청동 장비 단조', icon: '🗡️', lvl: 8, time: 5, xp: 35, in: { bar_bronze: 3 }, equip: { slots: ['weapon', 'armor'], r: 0 } },
      { id: 'iron', name: '철 주괴', icon: '🧱', lvl: 15, time: 3, xp: 18, in: { ore_iron: 1, coal: 1 }, out: { bar_iron: 1 } },
      { id: 'gear1', name: '철 장비 단조', icon: '🗡️', lvl: 22, time: 5, xp: 70, in: { bar_iron: 3 }, equip: { slots: ['weapon', 'armor'], r: 1 } },
      { id: 'mithril', name: '미스릴 주괴', icon: '🧱', lvl: 35, time: 3.5, xp: 35, in: { ore_mithril: 1, coal: 2 }, out: { bar_mithril: 1 } },
      { id: 'gear2', name: '미스릴 장비 단조', icon: '🗡️', lvl: 42, time: 6, xp: 130, in: { bar_mithril: 3 }, equip: { slots: ['weapon', 'armor'], r: 2 } },
      { id: 'adamant', name: '아다만 주괴', icon: '🧱', lvl: 55, time: 4, xp: 60, in: { ore_adamant: 1, coal: 3 }, out: { bar_adamant: 1 } },
      { id: 'gear3', name: '아다만 장비 단조', icon: '🗡️', lvl: 62, time: 6, xp: 220, in: { bar_adamant: 3 }, equip: { slots: ['weapon', 'armor'], r: 3 } },
      { id: 'gear4', name: '에테르 장비 단조', icon: '⚔️', lvl: 80, time: 8, xp: 450, in: { bar_adamant: 5, rune_chaos: 5 }, equip: { slots: ['weapon', 'armor'], r: 4 } },
    ],
  },
  {
    id: 'craft', name: '제작', icon: '🧰', kind: '가공', desc: '원목과 주괴, 보석으로 장신구를 만듭니다.',
    actions: [
      { id: 'acc0', name: '나무 부적', icon: '📿', lvl: 1, time: 4, xp: 20, in: { log_oak: 5 }, equip: { slots: ['accessory'], r: 0 } },
      { id: 'acc1', name: '소나무 반지', icon: '💍', lvl: 15, time: 5, xp: 50, in: { log_pine: 5, bar_bronze: 2 }, equip: { slots: ['accessory'], r: 1 } },
      { id: 'acc2', name: '단풍 목걸이', icon: '📿', lvl: 35, time: 6, xp: 110, in: { log_maple: 5, bar_iron: 2 }, equip: { slots: ['accessory'], r: 2 } },
      { id: 'acc3', name: '주목 보주', icon: '🔮', lvl: 55, time: 7, xp: 200, in: { log_yew: 5, bar_mithril: 2, gem: 1 }, equip: { slots: ['accessory'], r: 3 } },
      { id: 'acc4', name: '세계수 인장', icon: '💍', lvl: 75, time: 8, xp: 400, in: { log_world: 5, bar_adamant: 2, gem: 2 }, equip: { slots: ['accessory'], r: 4 } },
    ],
  },
  {
    id: 'alch', name: '연금술', icon: '⚗️', kind: '가공', desc: '약초로 물약을 만듭니다. 창고에서 마시면 일정 시간 강력한 버프를 받습니다.',
    actions: [
      { id: 'atk', name: '힘의 물약', icon: '🧪', lvl: 1, time: 3, xp: 15, in: { herb: 2, fish_minnow: 1 }, out: { pot_atk: 1 } },
      { id: 'gold', name: '행운의 물약', icon: '🧪', lvl: 15, time: 3.5, xp: 30, in: { herb: 3, rune_air: 1 }, out: { pot_gold: 1 } },
      { id: 'speed', name: '신속의 물약', icon: '🧪', lvl: 30, time: 4, xp: 50, in: { herb: 3, fish_tropical: 1 }, out: { pot_speed: 1 } },
      { id: 'hp', name: '거인의 물약', icon: '🧪', lvl: 45, time: 4.5, xp: 80, in: { herb: 3, herb_rare: 1, bar_iron: 1 }, out: { pot_hp: 1 } },
      { id: 'all', name: '만능 물약', icon: '🍷', lvl: 65, time: 6, xp: 180, in: { herb_rare: 2, rune_earth: 2, gem: 1 }, out: { pot_all: 1 } },
    ],
  },
  {
    id: 'arcane', name: '비전술', icon: '🔮', kind: '가공', desc: '룬 원석에 마력을 새겨 룬을 만듭니다. 룬은 신성술·연금술·대장기술에 쓰입니다.',
    actions: [
      { id: 'air', name: '바람 룬', icon: '🌀', lvl: 1, time: 2, xp: 6, in: { rune_ess: 1 }, out: { rune_air: 1 } },
      { id: 'fire', name: '불 룬', icon: '🔥', lvl: 20, time: 2.5, xp: 14, in: { rune_ess: 1, coal: 1 }, out: { rune_fire: 1 } },
      { id: 'earth', name: '대지 룬', icon: '⛰️', lvl: 40, time: 3, xp: 26, in: { rune_ess: 2 }, out: { rune_earth: 1 } },
      { id: 'chaos', name: '혼돈 룬', icon: '🌑', lvl: 60, time: 3.5, xp: 45, in: { rune_ess: 3, herb_rare: 1 }, out: { rune_chaos: 1 } },
    ],
  },
  {
    id: 'divine', name: '신성술', icon: '🙏', kind: '봉헌', desc: '몬스터의 뼈와 룬을 바쳐 신성력을 쌓습니다. 신성술 레벨마다 모든 피해 +1%.',
    actions: [
      { id: 'bone', name: '뼈 공양', icon: '🦴', lvl: 1, time: 2, xp: 10, in: { bone: 2 } },
      { id: 'air', name: '바람의 기도', icon: '🌀', lvl: 15, time: 2.5, xp: 24, in: { rune_air: 3 } },
      { id: 'fire', name: '불꽃 의식', icon: '🔥', lvl: 30, time: 3, xp: 45, in: { rune_fire: 3 } },
      { id: 'earth', name: '대지의 축복', icon: '⛰️', lvl: 50, time: 3.5, xp: 80, in: { rune_earth: 3, bone: 5 } },
      { id: 'chaos', name: '혼돈 정화', icon: '🌑', lvl: 70, time: 4, xp: 140, in: { rune_chaos: 3 } },
    ],
  },
  {
    id: 'thief', name: '도둑질', icon: '🗝️', kind: '채집', desc: '골드와 약초, 보석을 훔칩니다. 레벨이 높을수록 성공률이 오릅니다. 실패하면 그 시간만 버립니다.',
    actions: [
      { id: 'villager', name: '마을 주민', icon: '👨‍🌾', lvl: 1, time: 3, xp: 8, gold: 1.5, extra: [['herb', 0.3]] },
      { id: 'merchant', name: '시장 상인', icon: '👨‍💼', lvl: 15, time: 3.5, xp: 18, gold: 3, extra: [['herb', 0.35], ['rune_ess', 0.2]] },
      { id: 'guard', name: '성문 경비병', icon: '💂', lvl: 30, time: 4, xp: 32, gold: 6, extra: [['herb', 0.3], ['herb_rare', 0.1]] },
      { id: 'noble', name: '탐욕스러운 귀족', icon: '🤴', lvl: 50, time: 4.5, xp: 55, gold: 12, extra: [['herb_rare', 0.2], ['gem', 0.08]] },
      { id: 'vault', name: '왕실 금고', icon: '🏰', lvl: 70, time: 5, xp: 95, gold: 25, extra: [['herb_rare', 0.3], ['gem', 0.2]] },
    ],
  },
];

export const LIFE = Object.fromEntries(LIFE_SKILLS.map((k) => [k.id, k]));

export function findAction(skillId, actionId) {
  return LIFE[skillId]?.actions.find((a) => a.id === actionId) || null;
}

export function newLifeState() {
  return {
    xp: {},
    bank: {},
    active: null,          // { skill, action }
    progress: 0,           // 현재 행동 진행도 (0~1)
    buffs: { atk: 0, gold: 0, speed: 0, hp: 0 },
    autoEat: true,
  };
}

// ---------- 계산 ----------
export function lifeLevel(s, id) { return levelFromXp(s.life.xp[id] || 0); }

// 요구 레벨보다 높을수록 빨라짐 (최대 40% 단축)
export function actionTime(s, skillId, act) {
  const over = lifeLevel(s, skillId) - act.lvl;
  return act.time * Math.max(0.6, 1 - 0.008 * over);
}

export function burnChance(s, skillId, act) {
  if (!LIFE[skillId].burn) return 0;
  return Math.max(0, 0.3 - 0.015 * (lifeLevel(s, skillId) - act.lvl));
}

export function stealChance(s, act) {
  return Math.min(0.95, 0.65 + 0.012 * (lifeLevel(s, 'thief') - act.lvl));
}

export function matValue(s, id) {
  return MATS[id].value * goldPerKill(Math.max(1, s.maxStage));
}

export function hasInputs(s, act, times = 1) {
  if (!act.in) return true;
  for (const [id, n] of Object.entries(act.in)) if ((s.life.bank[id] || 0) < n * times) return false;
  return true;
}

export function bankAdd(s, id, n) {
  s.life.bank[id] = (s.life.bank[id] || 0) + n;
  if (s.life.bank[id] <= 0) delete s.life.bank[id];
}

export function buffMult(s, type) {
  return s.life.buffs[type] > 0 ? BUFFS[type].mult : 1;
}

// 신성술: 레벨당 모든 피해 +1%
export function divineMult(s) { return 1 + 0.01 * (lifeLevel(s, 'divine') - 1); }

// ---------- 행동 ----------
export function startAction(game, skillId, actionId) {
  const s = game.s;
  const act = findAction(skillId, actionId);
  if (!act || lifeLevel(s, skillId) < act.lvl) return false;
  if (s.life.active && s.life.active.skill === skillId && s.life.active.action === actionId) return true;
  s.life.active = { skill: skillId, action: actionId };
  s.life.progress = 0;
  return true;
}

export function stopAction(game) {
  game.s.life.active = null;
  game.s.life.progress = 0;
}

function gainXp(game, skillId, xp, log) {
  const s = game.s;
  const before = lifeLevel(s, skillId);
  s.life.xp[skillId] = (s.life.xp[skillId] || 0) + xp;
  const after = lifeLevel(s, skillId);
  if (log) log.xp[skillId] = (log.xp[skillId] || 0) + xp;
  if (after > before) {
    const k = LIFE[skillId];
    if (log) log.levels[skillId] = after;
    else game.toast(`${k.icon} ${k.name} 레벨 ${after}!`, after % 10 === 0 ? 'epic' : 'good');
  }
}

function addMat(game, id, n, log) {
  bankAdd(game.s, id, n);
  if (log) log.items[id] = (log.items[id] || 0) + n;
}

// 행동 1회 완료. 재료가 부족하면 false
function completeAction(game, skillId, act, log) {
  const s = game.s;
  if (!hasInputs(s, act)) return false;
  if (act.in) for (const [id, n] of Object.entries(act.in)) bankAdd(s, id, -n);

  if (skillId === 'thief') {
    if (Math.random() >= stealChance(s, act)) {
      if (log) log.fails++;
      return true; // 실패: 시간만 소모
    }
    const gold = act.gold * goldPerKill(Math.max(1, s.maxStage)) * game.goldMult();
    game.addGold(gold);
    if (log) log.gold += gold;
  }

  if (Math.random() < burnChance(s, skillId, act)) {
    gainXp(game, skillId, Math.ceil(act.xp * 0.2), log);
    if (log) log.burned++;
    return true;
  }

  if (act.out) for (const [id, n] of Object.entries(act.out)) addMat(game, id, n, log);
  if (act.extra) for (const [id, p] of act.extra) if (Math.random() < p) addMat(game, id, 1, log);
  if (act.equip) {
    const slot = act.equip.slots[Math.floor(Math.random() * act.equip.slots.length)];
    const item = game.craftItem(slot, act.equip.r, !log);
    if (log) log.equips.push(item);
  }
  gainXp(game, skillId, act.xp, log);
  return true;
}

// 매 프레임: 진행 중인 행동 처리. log가 있으면 토스트 대신 기록 (오프라인용)
export function lifeUpdate(game, dt, log = null) {
  const s = game.s;
  const L = s.life;

  for (const k of Object.keys(L.buffs)) if (L.buffs[k] > 0 && !log) L.buffs[k] = Math.max(0, L.buffs[k] - dt);

  const a = L.active;
  if (!a) return;
  const act = findAction(a.skill, a.action);
  if (!act) { stopAction(game); return; }

  let left = dt;
  let guard = 0;
  while (left > 0 && guard++ < MAX_LOOP) {
    const t = actionTime(s, a.skill, act);
    const need = (1 - L.progress) * t;
    if (left < need) {
      L.progress += left / t;
      break;
    }
    left -= need;
    L.progress = 0;
    if (!completeAction(game, a.skill, act, log)) {
      stopAction(game);
      if (!log) game.toast(`재료가 부족해 ${LIFE[a.skill].name}을(를) 멈췄습니다`, 'bad');
      else log.stopped = true;
      return;
    }
  }
}

export function newLifeLog() {
  return { xp: {}, levels: {}, items: {}, equips: [], gold: 0, fails: 0, burned: 0, stopped: false };
}

// 음식: 체력이 낮으면 가장 회복량이 큰 음식부터 먹음
export function autoEat(game) {
  const s = game.s;
  if (!s.life.autoEat) return;
  const rt = game.rt;
  const maxHp = game.heroMaxHp();
  if (rt.heroDead > 0 || rt.heroHp >= maxHp * AUTO_EAT_RATIO) return;
  let best = null;
  for (const id of Object.keys(s.life.bank)) {
    const m = MATS[id];
    if (m?.heal && s.life.bank[id] > 0 && (!best || m.heal > MATS[best].heal)) best = id;
  }
  if (!best) return;
  bankAdd(s, best, -1);
  rt.heroHp = Math.min(maxHp, rt.heroHp + maxHp * MATS[best].heal);
  game.fx({ type: 'text', anchor: 'hero', text: `${MATS[best].icon} +${Math.round(MATS[best].heal * 100)}%`, life: 1 });
}

export function usePotion(game, id) {
  const s = game.s;
  const m = MATS[id];
  if (!m?.buff || !(s.life.bank[id] > 0)) return false;
  bankAdd(s, id, -1);
  const hpRatio = game.rt.heroHp / game.heroMaxHp();
  for (const b of m.buff) s.life.buffs[b] = (s.life.buffs[b] || 0) + m.dur;
  if (game.rt.heroDead <= 0) game.rt.heroHp = hpRatio * game.heroMaxHp();
  return true;
}

export function sellMat(game, id, n) {
  const s = game.s;
  const have = s.life.bank[id] || 0;
  n = Math.min(n, have);
  if (n <= 0) return 0;
  const gold = matValue(s, id) * n;
  bankAdd(s, id, -n);
  game.addGold(gold);
  return gold;
}

// 오프라인 결과 요약 문장
export function describeLog(log) {
  const lines = [];
  for (const [id, n] of Object.entries(log.items)) lines.push(`${MATS[id].icon} ${MATS[id].name} +${fmt(n)}`);
  if (log.equips.length) {
    const best = log.equips.reduce((a, b) => (b.r > a.r ? b : a));
    lines.push(`🎒 장비 ${log.equips.length}개 제작 (최고: <span style="color:${RARITIES[best.r].color}">${itemName(best)}</span>)`);
  }
  if (log.gold > 0) lines.push(`💰 훔친 골드 +${fmt(log.gold)}`);
  for (const [id, xp] of Object.entries(log.xp)) {
    const k = LIFE[id];
    lines.push(`${k.icon} ${k.name} 경험치 +${fmt(xp)}${log.levels[id] ? ` (레벨 ${log.levels[id]} 달성!)` : ''}`);
  }
  if (log.stopped) lines.push('⚠️ 재료가 떨어져 중간에 멈췄습니다');
  return lines;
}

