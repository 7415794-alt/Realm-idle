// 생활 스킬 (채집 · 가공 · 제작) — 데이터와 로직 (DOM 없음)
import { goldPerKill, RARITIES, itemName } from './data.js';
import { fmt } from './format.js';
import { worldBonus, questEvent } from './world.js';

export const LIFE_MAX_LV = 99;
const AUTO_EAT_RATIO = 0.4;       // 체력이 이 비율 아래면 음식 자동 섭취
const MAX_LOOP = 200000;          // 한 번에 처리할 최대 행동 수 (안전장치)
const CAUGHT_STUN = 3;            // 도둑질 실패 시 기절 시간(초)

// ---------- 경험치 ----------
// 지수형 곡선: 8레벨마다 필요 경험치가 약 2배. 초반 레벨은 할인
function earlyDiscount(L) {
  if (L < 10) return 0.4;
  if (L < 20) return 0.7;
  if (L < 30) return 0.9;
  return 1;
}
export const xpToNext = (L) => Math.floor(((L + 240 * Math.pow(2, L / 8)) / 4) * earlyDiscount(L));
// XP_TABLE[L] = 레벨 L 도달에 필요한 누적 경험치
export const XP_TABLE = [0, 0];
for (let L = 1; L < LIFE_MAX_LV; L++) XP_TABLE.push(XP_TABLE[L] + xpToNext(L));

export function levelFromXp(xp) {
  let L = 1;
  while (L < LIFE_MAX_LV && xp >= XP_TABLE[L + 1]) L++;
  return L;
}

// 상위 행동일수록 경험치 배율 증가
export const xpScale = (lvl) => 1 + Math.pow(lvl / 40, 2);

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
  // 약초
  herb: { name: '약초', icon: '🌿', value: 0.5 },
  herb_rare: { name: '희귀 약초', icon: '🍀', value: 3 },
  // 뼈 (몬스터 처치 시 지역에 따라 획득)
  bone: { name: '뼈', icon: '🦴', value: 0.2 },
  bone_big: { name: '큰 뼈', icon: '🦴', value: 0.6 },
  bone_beast: { name: '맹수의 뼈', icon: '🦴', value: 1.5 },
  bone_dragon: { name: '용의 뼈', icon: '🦴', value: 4 },
  bone_ancient: { name: '태고의 뼈', icon: '🦴', value: 10 },
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

// 지역(20스테이지 단위)별 뼈
export const BONE_TIERS = ['bone', 'bone_big', 'bone_beast', 'bone_dragon', 'bone_ancient'];
export const boneForStage = (stage) => BONE_TIERS[Math.min(BONE_TIERS.length - 1, Math.floor((stage - 1) / 20))];

export const BUFFS = {
  atk: { name: '공격력', mult: 1.5, label: '+50%' },
  gold: { name: '골드', mult: 1.5, label: '+50%' },
  speed: { name: '공격 속도', mult: 1.3, label: '+30%' },
  hp: { name: '최대 체력', mult: 2, label: '+100%' },
};

// ---------- 도구 / 작업대 ----------
// 채집 도구: 골드 + 주괴로 업그레이드, 채집 속도 배율
const TOOL_TIERS = [
  { pre: '낡은', speed: 1, lvl: 1, gold: 0, mats: {} },
  { pre: '구리', speed: 1.5, lvl: 10, gold: 300, mats: { bar_bronze: 5 } },
  { pre: '철', speed: 2.2, lvl: 25, gold: 5e3, mats: { bar_iron: 10 } },
  { pre: '미스릴', speed: 3.2, lvl: 40, gold: 1e5, mats: { bar_mithril: 15 } },
  { pre: '아다만', speed: 4.5, lvl: 55, gold: 3e6, mats: { bar_adamant: 20 } },
  { pre: '에테르', speed: 6.5, lvl: 70, gold: 1e8, mats: { bar_adamant: 40, rune_chaos: 10 } },
];
export const TOOLS = {
  wood: { name: '도끼', icon: '🪓', tiers: TOOL_TIERS },
  mine: { name: '곡괭이', icon: '⛏️', tiers: TOOL_TIERS },
  fish: { name: '낚싯대', icon: '🎣', tiers: TOOL_TIERS },
  // 가공 스킬(요리·대장기술·제작·연금술·비전술) 공통 생산 속도
  workshop: {
    name: '작업대', icon: '🛠️',
    tiers: [
      { pre: '허름한', speed: 1, gold: 0, mats: {} },
      { pre: '튼튼한', speed: 1.3, gold: 500, mats: { log_oak: 50 } },
      { pre: '장인의', speed: 1.7, gold: 1e4, mats: { log_pine: 50, bar_bronze: 10 } },
      { pre: '명장의', speed: 2.2, gold: 2e5, mats: { log_maple: 50, bar_iron: 20 } },
      { pre: '대가의', speed: 2.8, gold: 5e6, mats: { log_yew: 50, bar_mithril: 20 } },
      { pre: '전설의', speed: 3.5, gold: 2e8, mats: { log_world: 50, bar_adamant: 20 } },
    ],
  },
};
export const PRODUCTION = ['cook', 'smith', 'craft', 'alch', 'arcane'];

// ---------- 신성술 기도 ----------
// 신성술 레벨로 해금, 1개만 활성화. effect 값은 비율(+0.1 = +10%)
export const PRAYERS = [
  { id: 'guard', name: '수호의 기도', icon: '🛡️', lvl: 1, effect: { hp: 0.1 }, desc: '최대 체력 +10%' },
  { id: 'war', name: '전사의 기도', icon: '⚔️', lvl: 8, effect: { atk: 0.1 }, desc: '공격·힘 +10%' },
  { id: 'iron', name: '철갑의 기도', icon: '🔰', lvl: 15, effect: { def: 0.15 }, desc: '방어 +15%' },
  { id: 'nimble', name: '날랜 손의 기도', icon: '🗝️', lvl: 22, effect: { thief: 0.1 }, desc: '도둑질 성공률 +10%p' },
  { id: 'nature', name: '대지의 기도', icon: '🌳', lvl: 30, effect: { gather: 0.25 }, desc: '채집 속도 +25%' },
  { id: 'craft', name: '장인의 기도', icon: '🛠️', lvl: 38, effect: { prod: 0.25 }, desc: '가공 속도 +25%' },
  { id: 'gold', name: '황금의 기도', icon: '💰', lvl: 45, effect: { gold: 0.3 }, desc: '골드 획득 +30%' },
  { id: 'wisdom', name: '지혜의 기도', icon: '📖', lvl: 55, effect: { xp: 0.2 }, desc: '생활 경험치 +20%' },
  { id: 'fury', name: '분노의 기도', icon: '🔥', lvl: 65, effect: { atk: 0.3, def: 0.2 }, desc: '공격·힘 +30%, 방어 +20%' },
  { id: 'grace', name: '신의 은총', icon: '🌟', lvl: 80, effect: { dmg: 0.5, gold: 0.3, xp: 0.2 }, desc: '모든 피해 +50%, 골드 +30%, 생활 경험치 +20%' },
];

// ---------- 스킬 / 행동 ----------
// in: 소모 재료, out: 획득 재료, extra: [재료, 확률] 추가 획득,
// equip: { slots, r } 장비 제작, gold: 처치 골드 배율 (도둑질), group: 목록 구분
export const LIFE_SKILLS = [
  {
    id: 'wood', name: '벌목', icon: '🪓', kind: '채집', tool: 'wood', desc: '나무를 베어 원목을 얻습니다. 가끔 약초를 발견합니다.',
    actions: [
      { id: 'oak', name: '참나무', icon: '🌳', lvl: 1, time: 3, xp: 8, out: { log_oak: 1 }, extra: [['herb', 0.05]] },
      { id: 'pine', name: '소나무', icon: '🌲', lvl: 12, time: 3.5, xp: 15, out: { log_pine: 1 }, extra: [['herb', 0.06]] },
      { id: 'maple', name: '단풍나무', icon: '🍁', lvl: 28, time: 4, xp: 28, out: { log_maple: 1 }, extra: [['herb', 0.07]] },
      { id: 'yew', name: '주목', icon: '🎄', lvl: 45, time: 4.5, xp: 45, out: { log_yew: 1 }, extra: [['herb_rare', 0.04]] },
      { id: 'world', name: '세계수', icon: '🌴', lvl: 65, time: 5, xp: 75, out: { log_world: 1 }, extra: [['herb_rare', 0.06]] },
    ],
  },
  {
    id: 'mine', name: '채광', icon: '⛏️', kind: '채집', tool: 'mine', desc: '광석과 룬 원석을 캡니다. 가끔 보석이 나옵니다.',
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
    id: 'fish', name: '낚시', icon: '🎣', kind: '채집', tool: 'fish', desc: '물고기를 낚습니다. 요리와 연금술 재료가 됩니다.',
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
    id: 'smith', name: '대장기술', icon: '🔨', kind: '가공', desc: '광석을 녹여 주괴를 만들고, 주괴로 무기·방패·투구·갑옷·각반·장화를 단조합니다. 단계마다 최소 등급이 보장됩니다. 주괴는 도구 업그레이드에도 쓰입니다.',
    actions: [
      { id: 'bronze', group: '주괴 제련', name: '청동 주괴', icon: '🧱', lvl: 1, time: 2.5, xp: 8, in: { ore_copper: 2 }, out: { bar_bronze: 1 } },
      { id: 'iron', name: '철 주괴', icon: '🧱', lvl: 15, time: 3, xp: 18, in: { ore_iron: 1, coal: 1 }, out: { bar_iron: 1 } },
      { id: 'mithril', name: '미스릴 주괴', icon: '🧱', lvl: 35, time: 3.5, xp: 35, in: { ore_mithril: 1, coal: 2 }, out: { bar_mithril: 1 } },
      { id: 'adamant', name: '아다만 주괴', icon: '🧱', lvl: 55, time: 4, xp: 60, in: { ore_adamant: 1, coal: 3 }, out: { bar_adamant: 1 } },
      { id: 'gear0', group: '장비 단조', name: '청동 장비 단조', icon: '🗡️', lvl: 8, time: 5, xp: 35, in: { bar_bronze: 3 }, equip: { slots: ['weapon', 'shield', 'helm', 'body', 'legs', 'boots'], r: 0 } },
      { id: 'gear1', name: '철 장비 단조', icon: '🗡️', lvl: 22, time: 5, xp: 70, in: { bar_iron: 3 }, equip: { slots: ['weapon', 'shield', 'helm', 'body', 'legs', 'boots'], r: 1 } },
      { id: 'gear2', name: '미스릴 장비 단조', icon: '🗡️', lvl: 42, time: 6, xp: 130, in: { bar_mithril: 3 }, equip: { slots: ['weapon', 'shield', 'helm', 'body', 'legs', 'boots'], r: 2 } },
      { id: 'gear3', name: '아다만 장비 단조', icon: '🗡️', lvl: 62, time: 6, xp: 220, in: { bar_adamant: 3 }, equip: { slots: ['weapon', 'shield', 'helm', 'body', 'legs', 'boots'], r: 3 } },
      { id: 'gear4', name: '에테르 장비 단조', icon: '⚔️', lvl: 80, time: 8, xp: 450, in: { bar_adamant: 5, rune_chaos: 5 }, equip: { slots: ['weapon', 'shield', 'helm', 'body', 'legs', 'boots'], r: 5 } },
    ],
  },
  {
    id: 'craft', name: '제작', icon: '🧰', kind: '가공', desc: '원목과 주괴, 보석으로 장갑·목걸이·망토를 만듭니다. 단계마다 최소 등급이 보장됩니다.',
    actions: [
      { id: 'acc0', name: '나무 부적', icon: '📿', lvl: 1, time: 4, xp: 20, in: { log_oak: 5 }, equip: { slots: ['gloves', 'amulet', 'cape'], r: 0 } },
      { id: 'acc1', name: '소나무 반지', icon: '💍', lvl: 15, time: 5, xp: 50, in: { log_pine: 5, bar_bronze: 2 }, equip: { slots: ['gloves', 'amulet', 'cape'], r: 1 } },
      { id: 'acc2', name: '단풍 목걸이', icon: '📿', lvl: 35, time: 6, xp: 110, in: { log_maple: 5, bar_iron: 2 }, equip: { slots: ['gloves', 'amulet', 'cape'], r: 2 } },
      { id: 'acc3', name: '주목 보주', icon: '🔮', lvl: 55, time: 7, xp: 200, in: { log_yew: 5, bar_mithril: 2, gem: 1 }, equip: { slots: ['gloves', 'amulet', 'cape'], r: 3 } },
      { id: 'acc4', name: '세계수 인장', icon: '💍', lvl: 75, time: 8, xp: 400, in: { log_world: 5, bar_adamant: 2, gem: 2 }, equip: { slots: ['gloves', 'amulet', 'cape'], r: 5 } },
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
    id: 'arcane', name: '비전술', icon: '🔮', kind: '가공', desc: '룬 원석에 마력을 새겨 룬을 만듭니다. 룬은 신성술·연금술·대장기술·도구에 쓰입니다.',
    actions: [
      { id: 'air', name: '바람 룬', icon: '🌀', lvl: 1, time: 2, xp: 6, in: { rune_ess: 1 }, out: { rune_air: 1 } },
      { id: 'fire', name: '불 룬', icon: '🔥', lvl: 20, time: 2.5, xp: 14, in: { rune_ess: 1, coal: 1 }, out: { rune_fire: 1 } },
      { id: 'earth', name: '대지 룬', icon: '⛰️', lvl: 40, time: 3, xp: 26, in: { rune_ess: 2 }, out: { rune_earth: 1 } },
      { id: 'chaos', name: '혼돈 룬', icon: '🌑', lvl: 60, time: 3.5, xp: 45, in: { rune_ess: 3, herb_rare: 1 }, out: { rune_chaos: 1 } },
    ],
  },
  {
    id: 'divine', name: '신성술', icon: '🙏', kind: '봉헌', desc: '몬스터의 뼈(지역마다 다름)와 룬을 바쳐 신성력을 쌓습니다. 레벨이 오르면 기도가 해금되고, 기도 하나를 켜 두면 효과를 받습니다.',
    actions: [
      { id: 'bone', group: '뼈 공양', name: '뼈 공양', icon: '🦴', lvl: 1, time: 2, xp: 10, in: { bone: 1 } },
      { id: 'bone_big', name: '큰 뼈 공양', icon: '🦴', lvl: 10, time: 2.5, xp: 22, in: { bone_big: 1 } },
      { id: 'bone_beast', name: '맹수의 뼈 공양', icon: '🦴', lvl: 25, time: 3, xp: 40, in: { bone_beast: 1 } },
      { id: 'bone_dragon', name: '용의 뼈 공양', icon: '🦴', lvl: 45, time: 3.5, xp: 70, in: { bone_dragon: 1 } },
      { id: 'bone_ancient', name: '태고의 뼈 공양', icon: '🦴', lvl: 65, time: 4, xp: 120, in: { bone_ancient: 1 } },
      { id: 'fire', group: '룬 의식', name: '불꽃 의식', icon: '🔥', lvl: 30, time: 3, xp: 45, in: { rune_fire: 3 } },
      { id: 'chaos', name: '혼돈 정화', icon: '🌑', lvl: 70, time: 4, xp: 140, in: { rune_chaos: 3 } },
    ],
  },
  {
    id: 'thief', name: '도둑질', icon: '🗝️', kind: '채집', desc: '소매치기는 골드, 노점 털기는 물건, 대규모 털이는 큰 한탕을 노립니다. 성공률은 50%에서 시작해 레벨 차이 1당 +4.5%p (최대 95%). 들키면 3초간 기절합니다.',
    actions: [
      { id: 'villager', group: '소매치기', name: '마을 주민', icon: '👨‍🌾', lvl: 1, time: 3, xp: 8, gold: 1.5 },
      { id: 'farmer', name: '농부', icon: '👩‍🌾', lvl: 8, time: 3, xp: 13, gold: 2, extra: [['herb', 0.15]] },
      { id: 'merchant', name: '시장 상인', icon: '👨‍💼', lvl: 15, time: 3, xp: 18, gold: 3 },
      { id: 'guard', name: '성문 경비병', icon: '💂', lvl: 25, time: 3, xp: 28, gold: 4.5 },
      { id: 'noble', name: '탐욕스러운 귀족', icon: '🤴', lvl: 40, time: 3, xp: 45, gold: 7 },
      { id: 'captain', name: '기사단장', icon: '🤺', lvl: 55, time: 3, xp: 70, gold: 11 },
      { id: 'veg', group: '노점 털기', name: '약초 노점', icon: '🥬', lvl: 10, time: 4, xp: 16, gold: 0.3, extra: [['herb', 0.7], ['herb_rare', 0.03]] },
      { id: 'fishstall', name: '생선 노점', icon: '🐟', lvl: 20, time: 4, xp: 26, gold: 0.3, extra: [['fish_shrimp', 0.5], ['fish_tropical', 0.2]] },
      { id: 'orestall', name: '광물 노점', icon: '⚒️', lvl: 35, time: 4.5, xp: 40, gold: 0.5, extra: [['ore_iron', 0.5], ['coal', 0.6], ['ore_mithril', 0.12]] },
      { id: 'jeweler', name: '보석상', icon: '💍', lvl: 50, time: 5, xp: 60, gold: 1, extra: [['gem', 0.25]] },
      { id: 'apothecary', name: '약재상', icon: '⚗️', lvl: 60, time: 5, xp: 75, gold: 1, extra: [['herb_rare', 0.45], ['rune_ess', 0.5]] },
      { id: 'caravan', group: '대규모 털이', name: '상단 마차', icon: '🐎', lvl: 45, time: 10, xp: 160, gold: 30, extra: [['gem', 0.3], ['bar_iron', 0.5]] },
      { id: 'manor', name: '귀족 저택', icon: '🏛️', lvl: 65, time: 12, xp: 260, gold: 60, extra: [['gem', 0.5], ['herb_rare', 0.6]] },
      { id: 'vault', name: '왕실 금고', icon: '🏰', lvl: 80, time: 15, xp: 420, gold: 120, extra: [['gem', 1], ['rune_chaos', 0.5]] },
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
    stun: 0,               // 도둑질 실패 기절 남은 시간
    buffs: { atk: 0, gold: 0, speed: 0, hp: 0 },
    tools: { wood: 0, mine: 0, fish: 0, workshop: 0 },
    prayer: null,
    autoEat: true,
  };
}

// ---------- 계산 ----------
export function lifeLevel(s, id) { return levelFromXp(s.life.xp[id] || 0); }

export function activePrayer(s) {
  const p = PRAYERS.find((x) => x.id === s.life.prayer);
  return p && lifeLevel(s, 'divine') >= p.lvl ? p : null;
}
// 기도 효과 (없으면 0)
export function prayerBonus(s, key) { return activePrayer(s)?.effect[key] || 0; }
// 기도 + 펫 + 날씨
export function allBonus(s, key) { return prayerBonus(s, key) + worldBonus(s, key); }

export function setPrayer(s, id) {
  const p = PRAYERS.find((x) => x.id === id);
  if (!p || lifeLevel(s, 'divine') < p.lvl) return false;
  s.life.prayer = s.life.prayer === id ? null : id;
  return true;
}

export function toolTier(s, key) { return Math.min(s.life.tools[key] || 0, TOOLS[key].tiers.length - 1); }
export function toolInfo(s, key) {
  const t = TOOLS[key];
  const i = toolTier(s, key);
  return { cur: t.tiers[i], next: t.tiers[i + 1] || null, tier: i, name: `${t.tiers[i].pre} ${t.name}` };
}
export function toolUpgradeCheck(s, key) {
  const { next } = toolInfo(s, key);
  if (!next) return { ok: false, why: '최고 단계' };
  const skillLv = key === 'workshop' ? Infinity : lifeLevel(s, key);
  if (next.lvl && skillLv < next.lvl) return { ok: false, why: `${LIFE[key].name} Lv ${next.lvl} 필요` };
  if (s.gold < next.gold) return { ok: false, why: '골드 부족' };
  for (const [id, n] of Object.entries(next.mats)) if ((s.life.bank[id] || 0) < n) return { ok: false, why: '재료 부족' };
  return { ok: true };
}
export function upgradeTool(game, key) {
  const s = game.s;
  if (!toolUpgradeCheck(s, key).ok) return false;
  const { next } = toolInfo(s, key);
  s.gold -= next.gold;
  for (const [id, n] of Object.entries(next.mats)) bankAdd(s, id, -n);
  s.life.tools[key] = toolTier(s, key) + 1;
  return true;
}

// 행동 속도 배율: 채집은 도구, 가공은 작업대, 그리고 기도 · 숙련(요구 레벨 초과분, 최대 +25%)
export function speedMult(s, skillId, act) {
  let m = 1 + Math.min(0.25, 0.005 * Math.max(0, lifeLevel(s, skillId) - act.lvl));
  const k = LIFE[skillId];
  if (k.tool) m *= toolInfo(s, k.tool).cur.speed * (1 + allBonus(s, 'gather'));
  else if (k.kind === '채집') m *= 1 + allBonus(s, 'gather');
  if (PRODUCTION.includes(skillId)) m *= toolInfo(s, 'workshop').cur.speed * (1 + allBonus(s, 'prod'));
  return m;
}
export function actionTime(s, skillId, act) { return act.time / speedMult(s, skillId, act); }

export function actionXp(s, act) { return act.xp * xpScale(act.lvl) * (1 + allBonus(s, 'xp')); }

export function burnChance(s, skillId, act) {
  if (!LIFE[skillId].burn) return 0;
  return Math.max(0, 0.3 - 0.015 * (lifeLevel(s, skillId) - act.lvl));
}

export function stealChance(s, act) {
  const p = 0.5 + 0.045 * (lifeLevel(s, 'thief') - act.lvl) + prayerBonus(s, 'thief');
  return Math.min(0.95, Math.max(0.05, p));
}

// 채집 특수 효과 (레벨에 비례)
export function gatherPerks(s, skillId) {
  const lv = lifeLevel(s, skillId);
  if (skillId === 'wood') return { double: Math.min(0.25, lv * 0.0025), triple: lv >= 50 ? 0.05 : 0 };
  if (skillId === 'fish') return { upgrade: Math.min(0.15, lv * 0.0015), gem: lv >= 60 ? 0.01 : 0 };
  if (skillId === 'mine') return { coal: Math.min(0.2, lv * 0.002), gem: lv >= 50 ? 0.01 : 0 };
  return null;
}
export function perkText(s, skillId) {
  const p = gatherPerks(s, skillId);
  if (!p) return '';
  const pct = (x) => (x * 100).toFixed(1) + '%';
  if (skillId === 'wood') return `원목 2배 ${pct(p.double)}` + (p.triple ? ` · 3배 ${pct(p.triple)}` : ' · Lv 50: 3배 확률');
  if (skillId === 'fish') return `상위 어종 ${pct(p.upgrade)}` + (p.gem ? ` · 보석 ${pct(p.gem)}` : ' · Lv 60: 보석 낚기');
  return `석탄 추가 ${pct(p.coal)}` + (p.gem ? ` · 보석 추가 ${pct(p.gem)}` : ' · Lv 50: 보석 추가');
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

// ---------- 행동 ----------
export function startAction(game, skillId, actionId) {
  const s = game.s;
  const act = findAction(skillId, actionId);
  if (!act || lifeLevel(s, skillId) < act.lvl) return false;
  if (s.life.active && s.life.active.skill === skillId && s.life.active.action === actionId) return true;
  s.life.active = { skill: skillId, action: actionId };
  s.life.progress = 0;
  s.life.stun = 0;
  return true;
}

export function stopAction(game) {
  game.s.life.active = null;
  game.s.life.progress = 0;
  game.s.life.stun = 0;
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
    if (skillId === 'divine' && !log) {
      for (const p of PRAYERS) if (p.lvl > before && p.lvl <= after) game.toast(`새 기도 해금: ${p.icon} ${p.name}`, 'epic');
    }
  }
}

function addMat(game, id, n, log) {
  bankAdd(game.s, id, n);
  if (log) log.items[id] = (log.items[id] || 0) + n;
}

// 채집 특수 효과 적용
function applyPerks(game, skillId, act, log) {
  const p = gatherPerks(game.s, skillId);
  if (!p || !act.out) return;
  const main = Object.keys(act.out)[0];
  if (skillId === 'wood') {
    if (Math.random() < p.triple) addMat(game, main, 2, log);
    else if (Math.random() < p.double) addMat(game, main, 1, log);
  } else if (skillId === 'fish') {
    const list = LIFE.fish.actions;
    const i = list.indexOf(act);
    if (Math.random() < p.upgrade) addMat(game, Object.keys(list[Math.min(i + 1, list.length - 1)].out)[0], 1, log);
    if (Math.random() < p.gem) addMat(game, 'gem', 1, log);
  } else if (skillId === 'mine') {
    if (main !== 'coal' && Math.random() < p.coal * (act.lvl / 55 + 0.2)) addMat(game, 'coal', 1, log);
    if (Math.random() < p.gem) addMat(game, 'gem', 1, log);
  }
}

// 행동 1회 완료. 재료가 부족하면 false
function completeAction(game, skillId, act, log) {
  const s = game.s;
  if (!hasInputs(s, act)) return false;
  if (act.in) for (const [id, n] of Object.entries(act.in)) bankAdd(s, id, -n);
  // 해당 스킬 펫: 결과물 2배 확률
  const dup = Math.random() < worldBonus(s, 'x_' + skillId);
  const times = dup ? 2 : 1;

  if (skillId === 'thief') {
    if (Math.random() >= stealChance(s, act)) {
      s.life.stun = CAUGHT_STUN;
      if (log) log.fails++;
      return true; // 들킴: 기절
    }
    const base = act.gold * goldPerKill(Math.max(1, s.maxStage)) * game.goldMult();
    const gold = base * (0.5 + Math.random()) * (dup ? 2 : 1);
    game.addGold(gold);
    if (log) log.gold += gold;
  }

  if (Math.random() < burnChance(s, skillId, act)) {
    gainXp(game, skillId, actionXp(s, act) * 0.2, log);
    if (log) log.burned++;
    return true;
  }

  if (act.out) for (const [id, n] of Object.entries(act.out)) addMat(game, id, n * times, log);
  if (act.extra) {
    for (const [id, p] of act.extra) {
      let q = Math.floor(p);
      if (Math.random() < p - q) q++;
      if (q > 0) addMat(game, id, q, log);
    }
  }
  applyPerks(game, skillId, act, log);
  if (act.equip) {
    for (let i = 0; i < times; i++) {
      const item = game.craftItem(act.equip.slots, act.equip.r, !log);
      if (log) log.equips.push(item);
    }
  }
  gainXp(game, skillId, actionXp(s, act) * (skillId === 'divine' ? times : 1), log);
  questEvent(s, 'life', 1, skillId);
  return true;
}

// 매 프레임: 진행 중인 행동 처리. log가 있으면 토스트 대신 기록 (오프라인용)
export function lifeUpdate(game, dt, log = null) {
  const s = game.s;
  const L = s.life;

  if (!log) for (const k of Object.keys(L.buffs)) if (L.buffs[k] > 0) L.buffs[k] = Math.max(0, L.buffs[k] - dt);

  const a = L.active;
  if (!a) return;
  const act = findAction(a.skill, a.action);
  if (!act) { stopAction(game); return; }

  let left = dt;
  let guard = 0;
  while (left > 0 && guard++ < MAX_LOOP) {
    if (L.stun > 0) {
      const d = Math.min(L.stun, left);
      L.stun -= d;
      left -= d;
      continue;
    }
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
  if (log.fails > 0) lines.push(`🚨 들킨 횟수 ${fmt(log.fails)}`);
  for (const [id, xp] of Object.entries(log.xp)) {
    const k = LIFE[id];
    lines.push(`${k.icon} ${k.name} 경험치 +${fmt(xp)}${log.levels[id] ? ` (레벨 ${log.levels[id]} 달성!)` : ''}`);
  }
  if (log.stopped) lines.push('⚠️ 재료가 떨어져 중간에 멈췄습니다');
  return lines;
}
