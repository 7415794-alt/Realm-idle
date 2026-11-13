// 생활 스킬 (채집 · 가공 · 제작) — 데이터와 로직 (DOM 없음)
import { goldPerKill, RARITIES, itemName, VIP, LOOT_MATS, ZONES, DROP_SLOTS, BOSS_MI } from './data.js';
import { fmt } from './format.js';
import { worldBonus, questEvent, rollSkillPet } from './world.js';

export const LIFE_MAX_LV = 999;
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
// 99레벨 이후에는 완만하게 (레벨마다 99레벨 필요량의 3%씩 증가)
const xpBase = (L) => Math.floor(((L + 240 * Math.pow(2, L / 8)) / 4) * earlyDiscount(L));
export const xpToNext = (L) => (L < 99 ? xpBase(L) : Math.floor(xpBase(98) * (1 + (L - 98) * 0.03)));
// XP_TABLE[L] = 레벨 L 도달에 필요한 누적 경험치
export const XP_TABLE = [0, 0];
for (let L = 1; L < LIFE_MAX_LV; L++) XP_TABLE.push(XP_TABLE[L] + xpToNext(L));

export function levelFromXp(xp) {
  // 이진 탐색: XP_TABLE[L] <= xp 인 가장 큰 L
  let lo = 1;
  let hi = LIFE_MAX_LV;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xp >= XP_TABLE[mid]) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// ---------- 생활 스킬 레벨 → 특수 옵션 ----------
// 레벨마다 조금씩 올라 999레벨에서 최대 (값: 999레벨 수치)
export const LIFE_SPECIAL = {
  wood: ['boss', 1.0], mine: ['pen', 0.15], fish: ['drop', 1.0], cook: ['spd', 0.25], smith: ['dmg', 0.5],
  craft: ['cdmg', 1.0], alch: ['ls', 0.1], arcane: ['dmg', 0.5], divine: ['gold', 2.0], thief: ['crit', 0.15],
};
export const lifeSpecialOf = (id, lv) => (LIFE_SPECIAL[id] ? LIFE_SPECIAL[id][1] * (lv / LIFE_MAX_LV) : 0);
export function lifeSpecial(s, key) {
  let v = 0;
  for (const [id, [k]] of Object.entries(LIFE_SPECIAL)) if (k === key) v += lifeSpecialOf(id, lifeLevel(s, id));
  return v;
}

// 상위 행동일수록 경험치 배율 증가
export const xpScale = (lvl) => 1 + Math.pow(lvl / 40, 2);

// 고기 요리 [이름, 아이콘, 요리 레벨, 회복량]
const MEAT_DISHES = [
  ['들짐승 바비큐', '🥓', 1, 0.18], ['늪 고기 스튜', '🥣', 9, 0.25], ['들소 버거', '🍔', 19, 0.33], ['화산 훈제 소시지', '🌭', 29, 0.41],
  ['매머드 고기 파이', '🥧', 39, 0.5], ['정화된 고기 수프', '🍵', 51, 0.6], ['천둥새 샌드위치', '🥪', 63, 0.72], ['심연 볶음면', '🥡', 76, 0.88],
];

// ---------- 재료 / 소모품 ----------
// value: 판매가 배율 (현재 최고 스테이지의 처치 골드 기준)
export const MATS = {
  // 벌목 (10)
  log_oak: { name: '참나무 원목', icon: '🌳', value: 0.3 },
  log_birch: { name: '자작나무 원목', icon: '🎋', value: 0.45 },
  log_pine: { name: '소나무 원목', icon: '🌲', value: 0.6 },
  log_aspen: { name: '사시나무 원목', icon: '🍃', value: 0.9 },
  log_maple: { name: '단풍나무 원목', icon: '🍁', value: 1.2 },
  log_cedar: { name: '삼나무 원목', icon: '🏕️', value: 1.7 },
  log_ebony: { name: '흑단 원목', icon: '⬛', value: 2.4 },
  log_yew: { name: '주목 원목', icon: '🎄', value: 3.2 },
  log_frost: { name: '서리나무 원목', icon: '🌨️', value: 4.5 },
  log_world: { name: '세계수 가지', icon: '🌴', value: 6 },
  // 채광 (11) + 보석
  ore_copper: { name: '구리 광석', icon: '🔸', value: 0.3 },
  rune_ess: { name: '룬 원석', icon: '💠', value: 0.4 },
  coal: { name: '석탄', icon: '⚫', value: 0.5 },
  ore_iron: { name: '철 광석', icon: '⚪', value: 0.8 },
  ore_gold: { name: '금 광석', icon: '🥇', value: 1.5 },
  ore_cobalt: { name: '코발트 광석', icon: '🔵', value: 1.8 },
  ore_mithril: { name: '미스릴 광석', icon: '🔷', value: 2.5 },
  ore_titan: { name: '티타늄 광석', icon: '◻️', value: 3.2 },
  ore_adamant: { name: '아다만 광석', icon: '🔶', value: 4 },
  ore_frost: { name: '빙하 광석', icon: '❄️', value: 5.5 },
  ore_aether: { name: '에테르 광석', icon: '✴️', value: 8 },
  gem: { name: '보석', icon: '💎', value: 15 },
  gem_sapphire: { name: '사파이어', icon: '🔹', value: 8 },
  gem_emerald: { name: '에메랄드', icon: '❇️', value: 14 },
  gem_ruby: { name: '루비', icon: '♦️', value: 22 },
  gem_diamond: { name: '다이아몬드', icon: '✨', value: 40 },
  // 낚시 (16)
  fish_minnow: { name: '피라미', icon: '🐟', value: 0.3 },
  fish_perch: { name: '농어', icon: '🐟', value: 0.4 },
  fish_salmon: { name: '연어', icon: '🐟', value: 0.55 },
  fish_shrimp: { name: '새우', icon: '🦐', value: 0.7 },
  fish_carp: { name: '잉어', icon: '🎏', value: 0.9 },
  fish_pike: { name: '강꼬치고기', icon: '🐟', value: 1.1 },
  fish_tropical: { name: '열대어', icon: '🐠', value: 1.4 },
  fish_eel: { name: '장어', icon: '🐍', value: 1.8 },
  fish_barracuda: { name: '창꼬치', icon: '🐟', value: 2.2 },
  fish_puffer: { name: '복어', icon: '🐡', value: 2.6 },
  fish_seasnake: { name: '바다뱀', icon: '🐍', value: 3.1 },
  fish_angler: { name: '아귀', icon: '🏮', value: 3.6 },
  fish_octopus: { name: '문어', icon: '🐙', value: 4.2 },
  fish_shark: { name: '상어', icon: '🦈', value: 5 },
  fish_tuna: { name: '냉동 참치', icon: '🐟', value: 6.2 },
  fish_abyss: { name: '심연어', icon: '🦑', value: 8 },
  // 요리 (heal: 최대 체력 대비 회복량)
  food_minnow: { name: '피라미 꼬치', icon: '🍢', value: 0.6, heal: 0.15 },
  food_perch: { name: '농어 구이', icon: '🍖', value: 0.8, heal: 0.18 },
  food_salmon: { name: '연어 주먹밥', icon: '🍙', value: 1.1, heal: 0.21 },
  food_shrimp: { name: '새우튀김', icon: '🍤', value: 1.4, heal: 0.24 },
  food_carp: { name: '잉어찜', icon: '🥘', value: 1.8, heal: 0.28 },
  food_pike: { name: '생선 만두', icon: '🥟', value: 2.2, heal: 0.32 },
  food_tropical: { name: '생선 초밥', icon: '🍣', value: 2.8, heal: 0.36 },
  food_eel: { name: '장어 덮밥', icon: '🍛', value: 3.6, heal: 0.4 },
  food_barracuda: { name: '창꼬치 도시락', icon: '🍱', value: 4.4, heal: 0.45 },
  food_puffer: { name: '복어 전골', icon: '🍲', value: 5.2, heal: 0.5 },
  food_seasnake: { name: '바다뱀 탕', icon: '🍜', value: 6.2, heal: 0.55 },
  food_angler: { name: '아귀찜', icon: '🌶️', value: 7.2, heal: 0.6 },
  food_octopus: { name: '문어 볶음', icon: '🍝', value: 8.4, heal: 0.66 },
  food_shark: { name: '상어 스테이크', icon: '🥩', value: 10, heal: 0.72 },
  food_tuna: { name: '참치 회', icon: '🥗', value: 12.4, heal: 0.8 },
  food_abyss: { name: '심연 만찬', icon: '🍽️', value: 16, heal: 0.9 },
  // 대장기술 주괴
  bar_bronze: { name: '청동 주괴', icon: '🧱', value: 0.8 },
  bar_iron: { name: '철 주괴', icon: '🧱', value: 2 },
  bar_gold: { name: '금 주괴', icon: '🧱', value: 3.5 },
  bar_cobalt: { name: '코발트 주괴', icon: '🧱', value: 4 },
  bar_mithril: { name: '미스릴 주괴', icon: '🧱', value: 5.5 },
  bar_titan: { name: '티타늄 주괴', icon: '🧱', value: 7 },
  bar_adamant: { name: '아다만 주괴', icon: '🧱', value: 10 },
  bar_frost: { name: '빙하 주괴', icon: '🧱', value: 14 },
  bar_aether: { name: '에테르 주괴', icon: '🧱', value: 20 },
  // 약초
  herb: { name: '약초', icon: '🌿', value: 0.5 },
  herb_rare: { name: '희귀 약초', icon: '🍀', value: 3 },
  // 뼈 (몬스터 전리품, 지역에 따라 다름)
  bone: { name: '뼈', icon: '🦴', value: 0.2 },
  bone_big: { name: '큰 뼈', icon: '🦴', value: 0.6 },
  bone_beast: { name: '맹수의 뼈', icon: '🦴', value: 1.5 },
  bone_dragon: { name: '용의 뼈', icon: '🦴', value: 4 },
  bone_ancient: { name: '태고의 뼈', icon: '🦴', value: 10 },
  // 몬스터 전리품
  mon_feather: { name: '깃털', icon: '🕊️', value: 0.3 },
  mon_hide: { name: '가죽', icon: '🧥', value: 0.4 },
  mon_mushroom: { name: '독버섯', icon: '🍄', value: 0.4 },
  mon_slime: { name: '점액', icon: '💧', value: 0.5 },
  mon_venom: { name: '독주머니', icon: '☠️', value: 0.8 },
  mon_claw: { name: '맹수 발톱', icon: '🔪', value: 1 },
  mon_web: { name: '거미줄', icon: '🕸️', value: 0.9 },
  mon_horn: { name: '뿔', icon: '📯', value: 1.2 },
  mon_ember: { name: '용암 결정', icon: '🌋', value: 1.5 },
  mon_scale: { name: '비늘', icon: '🦎', value: 1.8 },
  mon_ice: { name: '서리 결정', icon: '❄️', value: 2 },
  mon_ecto: { name: '영혼 조각', icon: '👻', value: 2.5 },
  mon_shadow: { name: '그림자 정수', icon: '🕳️', value: 3 },
  mon_cloth: { name: '저주받은 천', icon: '🧵', value: 2.2 },
  mon_storm: { name: '폭풍 정수', icon: '⚡', value: 3.5 },
  mon_honey: { name: '하늘꿀', icon: '🍯', value: 3 },
  mon_pearl: { name: '흑진주', icon: '🌕', value: 5 },
  mon_ink: { name: '심연 먹물', icon: '🖋️', value: 4 },
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
  pot_def: { name: '철피의 물약', icon: '🧪', value: 3, buff: ['def'], dur: 600 },
  pot_drop: { name: '탐색의 물약', icon: '🧪', value: 5, buff: ['drop'], dur: 600 },
  // 몬스터 고유 전리품 · 고기 · 보물 상자 (data.js)
  ...LOOT_MATS,
  // 고기 요리
  ...Object.fromEntries(MEAT_DISHES.map(([name, icon, , heal], z) => ['food_meat' + z, { name, icon, value: 1 + z * 1.5, heal }])),
};

// 지역(20스테이지 단위)별 뼈
export const BONE_TIERS = ['bone', 'bone_big', 'bone_beast', 'bone_dragon', 'bone_ancient'];
export const boneForStage = (stage) => BONE_TIERS[Math.min(BONE_TIERS.length - 1, Math.floor((stage - 1) / 20))];

export const BUFFS = {
  atk: { name: '공격력', mult: 1.5, label: '+50%' },
  gold: { name: '골드', mult: 1.5, label: '+50%' },
  speed: { name: '공격 속도', mult: 1.3, label: '+30%' },
  hp: { name: '최대 체력', mult: 2, label: '+100%' },
  def: { name: '방어', mult: 1.5, label: '+50%' },
  drop: { name: '드롭률', mult: 1.5, label: 'x1.5' },
};

// ---------- 도구 / 작업대 ----------
// 채집 도구: 골드 + 주괴로 업그레이드, 채집 속도 배율
const TOOL_TIERS = [
  { pre: '낡은', speed: 1, lvl: 1, gold: 0, mats: {} },
  { pre: '구리', speed: 1.5, lvl: 10, gold: 50, mats: { bar_bronze: 5 } },
  { pre: '철', speed: 2.2, lvl: 25, gold: 500, mats: { bar_iron: 10 } },
  { pre: '미스릴', speed: 3.2, lvl: 40, gold: 5e3, mats: { bar_mithril: 15 } },
  { pre: '아다만', speed: 4.5, lvl: 55, gold: 3e4, mats: { bar_adamant: 20 } },
  { pre: '에테르', speed: 6.5, lvl: 70, gold: 2e5, mats: { bar_adamant: 40, rune_chaos: 10 } },
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
      { pre: '튼튼한', speed: 1.3, gold: 100, mats: { log_oak: 50 } },
      { pre: '장인의', speed: 1.7, gold: 1e3, mats: { log_pine: 50, bar_bronze: 10 } },
      { pre: '명장의', speed: 2.2, gold: 1e4, mats: { log_maple: 50, bar_iron: 20 } },
      { pre: '대가의', speed: 2.8, gold: 5e4, mats: { log_yew: 50, bar_mithril: 20 } },
      { pre: '전설의', speed: 3.5, gold: 3e5, mats: { log_world: 50, bar_adamant: 20 } },
    ],
  },
};
export const PRODUCTION = ['cook', 'smith', 'craft', 'alch', 'arcane'];

// ---------- 신성술 기도 ----------
// 신성술 레벨로 해금, 1개만 활성화. effect 값은 비율(+0.1 = +10%)
export const PRAYERS = [
  { id: 'guard', name: '수호의 기도', icon: '🛡️', lvl: 1, effect: { hp: 0.1 }, desc: '최대 체력 +10%' },
  { id: 'war', name: '전사의 기도', icon: '⚔️', lvl: 8, effect: { atk: 0.1 }, desc: '모든 공격 스탯 +10%' },
  { id: 'iron', name: '철갑의 기도', icon: '🔰', lvl: 15, effect: { def: 0.15 }, desc: '방어 +15%' },
  { id: 'nimble', name: '날랜 손의 기도', icon: '🗝️', lvl: 22, effect: { thief: 0.1 }, desc: '도둑질 성공률 +10%p' },
  { id: 'nature', name: '대지의 기도', icon: '🌳', lvl: 30, effect: { gather: 0.25 }, desc: '채집 속도 +25%' },
  { id: 'craft', name: '장인의 기도', icon: '🛠️', lvl: 38, effect: { prod: 0.25 }, desc: '가공 속도 +25%' },
  { id: 'leech', name: '피의 기도', icon: '💉', lvl: 42, effect: { ls: 0.03 }, desc: '흡혈 +3%p' },
  { id: 'gold', name: '황금의 기도', icon: '💰', lvl: 45, effect: { gold: 0.3 }, desc: '골드 획득 +30%' },
  { id: 'wisdom', name: '지혜의 기도', icon: '📖', lvl: 55, effect: { xp: 0.2 }, desc: '생활 경험치 +20%' },
  { id: 'ward', name: '결계의 기도', icon: '🔯', lvl: 60, effect: { dr: 0.08, regen: 0.005 }, desc: '피해 감소 +8%p, 초당 회복 +0.5%p' },
  { id: 'fury', name: '분노의 기도', icon: '🔥', lvl: 65, effect: { atk: 0.3, def: 0.2 }, desc: '모든 공격 스탯 +30%, 방어 +20%' },
  { id: 'grace', name: '신의 은총', icon: '🌟', lvl: 80, effect: { dmg: 0.5, gold: 0.3, xp: 0.2 }, desc: '모든 피해 +50%, 골드 +30%, 생활 경험치 +20%' },
];

// ---------- 스킬 / 행동 ----------
// in: 소모 재료, out: 획득 재료, extra: [재료, 확률] 추가 획득,
// equip: { slots, r } 장비 제작, gold: 처치 골드 배율 (도둑질), group: 목록 구분
const SMITH_SLOTS = ['weapon', 'shield', 'helm', 'body', 'legs', 'boots'];
const CRAFT_SLOTS = ['gloves', 'amulet', 'ring1', 'cape', 'off'];
const g = (id, name, icon, lvl, time, xp, out, extra) => ({ id, name, icon, lvl, time, xp, out: { [out]: 1 }, ...(extra ? { extra } : {}) });
const FISH = [
  ['minnow', '개울 낚시', '🐟', 1], ['perch', '호숫가 낚시', '🐟', 5], ['salmon', '연어 여울', '🐟', 10], ['shrimp', '갯벌 통발', '🦐', 15],
  ['carp', '연못 낚시', '🎏', 20], ['pike', '강 하구', '🐟', 25], ['tropical', '산호초 낚시', '🐠', 30], ['eel', '진흙 강바닥', '🐍', 38],
  ['barracuda', '암초 지대', '🐟', 45], ['puffer', '먼바다 낚시', '🐡', 50], ['seasnake', '해초 숲', '🐍', 57], ['angler', '어두운 해구', '🏮', 63],
  ['octopus', '난파선 주변', '🐙', 68], ['shark', '심해 낚시', '🦈', 74], ['tuna', '빙해 낚시', '🐟', 82], ['abyss', '심연 낚시', '🦑', 90],
];
const COOK = {
  minnow: '피라미 꼬치', perch: '농어 구이', salmon: '연어 주먹밥', shrimp: '새우튀김', carp: '잉어찜', pike: '생선 만두', tropical: '생선 초밥', eel: '장어 덮밥',
  barracuda: '창꼬치 도시락', puffer: '복어 전골', seasnake: '바다뱀 탕', angler: '아귀찜', octopus: '문어 볶음', shark: '상어 스테이크', tuna: '참치 회', abyss: '심연 만찬',
};
const TROPHY = [
  ['초원 수렵 장비', 5, 1], ['늪지 사냥 장비', 15, 1], ['협곡 전사 장비', 25, 2], ['화산 정복 장비', 35, 2],
  ['빙하 원정 장비', 45, 3], ['망령 사냥 장비', 55, 3], ['폭풍 추적 장비', 65, 4], ['심연 탐험 장비', 78, 5],
];
const BOWYER = [
  ['oak', '참나무', 3, 0, {}], ['birch', '자작나무', 10, 0, { mon_feather: 2 }], ['pine', '소나무', 17, 1, { mon_feather: 3 }],
  ['aspen', '사시나무', 24, 1, { mon_web: 2 }], ['maple', '단풍나무', 32, 1, { mon_horn: 2 }], ['cedar', '삼나무', 40, 2, { mon_scale: 2 }],
  ['ebony', '흑단', 47, 2, { mon_shadow: 2 }], ['yew', '주목', 57, 3, { mon_ecto: 3 }], ['frost', '서리나무', 70, 4, { mon_ice: 4 }],
  ['world', '세계수', 84, 5, { mon_storm: 3, gem_diamond: 1 }],
];
const WOOD_KINDS = ['xbow', 'bow', 'wand', 'staff'];
const trophyIn = (z) => Object.fromEntries(ZONES[z].drops.map((id, mi) => [id, mi === BOSS_MI ? 1 : 4]));
const xpAt = (lvl) => Math.round(7 + lvl * 1.1 + Math.pow(lvl, 1.6) / 6);

export const LIFE_SKILLS = [
  {
    id: 'wood', name: '벌목', icon: '🪓', kind: '채집', tool: 'wood', desc: '나무를 베어 원목을 얻습니다. 가끔 약초를 발견합니다.',
    actions: [
      g('oak', '참나무', '🌳', 1, 3, 8, 'log_oak', [['herb', 0.05]]),
      g('birch', '자작나무', '🎋', 8, 3.2, 12, 'log_birch', [['herb', 0.05]]),
      g('pine', '소나무', '🌲', 15, 3.5, 16, 'log_pine', [['herb', 0.06]]),
      g('aspen', '사시나무', '🍃', 22, 3.7, 21, 'log_aspen', [['herb', 0.06]]),
      g('maple', '단풍나무', '🍁', 30, 4, 28, 'log_maple', [['herb', 0.07]]),
      g('cedar', '삼나무', '🏕️', 38, 4.2, 36, 'log_cedar', [['herb', 0.07]]),
      g('ebony', '흑단나무', '⬛', 45, 4.5, 46, 'log_ebony', [['herb_rare', 0.03]]),
      g('yew', '주목', '🎄', 55, 4.7, 60, 'log_yew', [['herb_rare', 0.04]]),
      g('frost', '서리나무', '🌨️', 68, 5, 82, 'log_frost', [['herb_rare', 0.05]]),
      g('world', '세계수', '🌴', 80, 5.5, 115, 'log_world', [['herb_rare', 0.07]]),
    ],
  },
  {
    id: 'mine', name: '채광', icon: '⛏️', kind: '채집', tool: 'mine', desc: '광석과 룬 원석을 캡니다. 가끔 보석이 나옵니다.',
    actions: [
      g('copper', '구리 광맥', '🔸', 1, 3, 8, 'ore_copper', [['gem', 0.01]]),
      g('runeess', '룬 원석 광맥', '💠', 5, 3, 10, 'rune_ess', [['gem', 0.01]]),
      g('coal', '석탄 광맥', '⚫', 12, 3.5, 14, 'coal', [['gem', 0.012]]),
      g('iron', '철 광맥', '⚪', 15, 3.5, 17, 'ore_iron', [['gem', 0.015], ['gem_sapphire', 0.005]]),
      g('gold', '금 광맥', '🥇', 22, 3.8, 22, 'ore_gold', [['gem', 0.015], ['gem_sapphire', 0.008]]),
      g('cobalt', '코발트 광맥', '🔵', 30, 4, 29, 'ore_cobalt', [['gem', 0.018], ['gem_emerald', 0.006]]),
      g('mithril', '미스릴 광맥', '🔷', 38, 4.3, 37, 'ore_mithril', [['gem', 0.02], ['gem_emerald', 0.008]]),
      g('titan', '티타늄 광맥', '◻️', 46, 4.6, 48, 'ore_titan', [['gem', 0.022], ['gem_ruby', 0.006]]),
      g('adamant', '아다만 광맥', '🔶', 55, 5, 60, 'ore_adamant', [['gem', 0.025], ['gem_ruby', 0.008]]),
      g('frost', '빙하 광맥', '❄️', 68, 5.3, 82, 'ore_frost', [['gem', 0.03], ['gem_diamond', 0.004]]),
      g('aether', '에테르 광맥', '✴️', 80, 5.8, 115, 'ore_aether', [['gem', 0.035], ['gem_diamond', 0.006]]),
    ],
  },
  {
    id: 'fish', name: '낚시', icon: '🎣', kind: '채집', tool: 'fish', desc: '물고기를 낚습니다. 요리와 연금술 재료가 됩니다.',
    actions: FISH.map(([id, name, icon, lvl]) => g(id, name, icon, lvl, 2.6 + lvl / 40, xpAt(lvl), 'fish_' + id)),
  },
  {
    id: 'cook', name: '요리', icon: '🍳', kind: '가공', desc: '물고기와 사냥한 고기를 요리합니다. 음식은 전투 중 체력이 40% 아래로 떨어지면 회복량이 큰 것부터 자동으로 먹습니다. 레벨이 낮으면 태울 수 있습니다.',
    burn: true,
    actions: [
      ...FISH.map(([id, , , lvl], i) => ({ id, ...(i ? {} : { group: '생선 요리' }), name: COOK[id], icon: '🍳', lvl, time: 2.4 + lvl / 60, xp: Math.round(xpAt(lvl) * 1.2), in: { ['fish_' + id]: 1 }, out: { ['food_' + id]: 1 } })),
      ...MEAT_DISHES.map(([name, icon, lvl], z) => ({ id: 'meat' + z, ...(z ? {} : { group: '고기 요리 (사냥 전리품)' }), name, icon, lvl, time: 2.6 + lvl / 60, xp: Math.round(xpAt(lvl) * 1.3), in: { ['meat_' + z]: 1 }, out: { ['food_meat' + z]: 1 } })),
    ],
  },
  {
    id: 'smith', name: '대장기술', icon: '🔨', kind: '가공', desc: '광석을 녹여 주괴를 만들고, 주괴로 무기·방패·투구·갑옷·각반·장화를 단조합니다. 무기는 지금 전투 방식에 맞는 종류, 단계마다 최소 등급이 보장됩니다.',
    actions: [
      { id: 'bronze', group: '주괴 제련', name: '청동 주괴', icon: '🧱', lvl: 1, time: 2.5, xp: 8, in: { ore_copper: 2 }, out: { bar_bronze: 1 } },
      { id: 'iron', name: '철 주괴', icon: '🧱', lvl: 15, time: 3, xp: 18, in: { ore_iron: 1, coal: 1 }, out: { bar_iron: 1 } },
      { id: 'goldbar', name: '금 주괴', icon: '🧱', lvl: 22, time: 3, xp: 24, in: { ore_gold: 1 }, out: { bar_gold: 1 } },
      { id: 'cobalt', name: '코발트 주괴', icon: '🧱', lvl: 30, time: 3.3, xp: 30, in: { ore_cobalt: 1, coal: 1 }, out: { bar_cobalt: 1 } },
      { id: 'mithril', name: '미스릴 주괴', icon: '🧱', lvl: 38, time: 3.5, xp: 38, in: { ore_mithril: 1, coal: 2 }, out: { bar_mithril: 1 } },
      { id: 'titan', name: '티타늄 주괴', icon: '🧱', lvl: 46, time: 3.7, xp: 48, in: { ore_titan: 1, coal: 2 }, out: { bar_titan: 1 } },
      { id: 'adamant', name: '아다만 주괴', icon: '🧱', lvl: 55, time: 4, xp: 60, in: { ore_adamant: 1, coal: 3 }, out: { bar_adamant: 1 } },
      { id: 'frostbar', name: '빙하 주괴', icon: '🧱', lvl: 68, time: 4.3, xp: 82, in: { ore_frost: 1, coal: 3 }, out: { bar_frost: 1 } },
      { id: 'aetherbar', name: '에테르 주괴', icon: '🧱', lvl: 80, time: 4.6, xp: 115, in: { ore_aether: 1, coal: 4 }, out: { bar_aether: 1 } },
      { id: 'gear0', group: '장비 단조', name: '청동 장비 단조', icon: '🗡️', lvl: 8, time: 5, xp: 35, in: { bar_bronze: 3 }, equip: { slots: SMITH_SLOTS, r: 0 } },
      { id: 'gear1', name: '철 장비 단조', icon: '🗡️', lvl: 20, time: 5, xp: 70, in: { bar_iron: 3 }, equip: { slots: SMITH_SLOTS, r: 1 } },
      { id: 'gear5', name: '코발트 장비 단조', icon: '🗡️', lvl: 32, time: 5.5, xp: 100, in: { bar_cobalt: 3 }, equip: { slots: SMITH_SLOTS, r: 1 } },
      { id: 'gear2', name: '미스릴 장비 단조', icon: '🗡️', lvl: 42, time: 6, xp: 130, in: { bar_mithril: 3 }, equip: { slots: SMITH_SLOTS, r: 2 } },
      { id: 'gear6', name: '티타늄 장비 단조', icon: '🗡️', lvl: 50, time: 6, xp: 170, in: { bar_titan: 3 }, equip: { slots: SMITH_SLOTS, r: 2 } },
      { id: 'gear3', name: '아다만 장비 단조', icon: '⚔️', lvl: 60, time: 6.5, xp: 220, in: { bar_adamant: 3 }, equip: { slots: SMITH_SLOTS, r: 3 } },
      { id: 'gear7', name: '빙하 장비 단조', icon: '⚔️', lvl: 70, time: 7, xp: 320, in: { bar_frost: 3 }, equip: { slots: SMITH_SLOTS, r: 4 } },
      { id: 'gear4', name: '에테르 장비 단조', icon: '⚔️', lvl: 82, time: 8, xp: 480, in: { bar_aether: 3, rune_chaos: 2 }, equip: { slots: SMITH_SLOTS, r: 5 } },
    ],
  },
  {
    id: 'craft', name: '제작', icon: '🧰', kind: '가공', desc: '원목을 깎아 활 · 지팡이를 만들고, 원목 · 몬스터 전리품 · 주괴 · 보석으로 장갑 · 목걸이 · 반지 · 망토 · 보조장비를 만듭니다. 지금 전투 방식에 맞는 성향으로 만들어지고, 단계마다 최소 등급이 보장됩니다.',
    actions: [
      { id: 'acc0', name: '참나무 공예', icon: '📿', lvl: 1, time: 4, xp: 20, in: { log_oak: 5 }, equip: { slots: CRAFT_SLOTS, r: 0 } },
      { id: 'acc1', name: '가죽 공예', icon: '🧤', lvl: 10, time: 4.5, xp: 35, in: { mon_hide: 3, log_birch: 4 }, equip: { slots: CRAFT_SLOTS, r: 0 } },
      { id: 'acc2', name: '깃털 공예', icon: '🏹', lvl: 18, time: 5, xp: 55, in: { mon_feather: 4, log_pine: 4, bar_bronze: 2 }, equip: { slots: CRAFT_SLOTS, r: 1 } },
      { id: 'acc3', name: '금 세공', icon: '💍', lvl: 26, time: 5, xp: 75, in: { bar_gold: 2, gem_sapphire: 1 }, equip: { slots: CRAFT_SLOTS, r: 1 } },
      { id: 'acc4', name: '거미줄 직조', icon: '🧣', lvl: 35, time: 5.5, xp: 105, in: { mon_web: 4, log_maple: 5, bar_cobalt: 2 }, equip: { slots: CRAFT_SLOTS, r: 2 } },
      { id: 'acc5', name: '비늘 공예', icon: '🛡️', lvl: 45, time: 6, xp: 140, in: { mon_scale: 4, bar_mithril: 2, gem_emerald: 1 }, equip: { slots: CRAFT_SLOTS, r: 2 } },
      { id: 'acc6', name: '영혼 직조', icon: '👻', lvl: 55, time: 6.5, xp: 190, in: { mon_ecto: 4, mon_cloth: 4, bar_titan: 2 }, equip: { slots: CRAFT_SLOTS, r: 3 } },
      { id: 'acc7', name: '흑진주 세공', icon: '📿', lvl: 68, time: 7, xp: 280, in: { mon_pearl: 4, bar_adamant: 2, gem_ruby: 1 }, equip: { slots: CRAFT_SLOTS, r: 4 } },
      { id: 'acc8', name: '세계수 인장', icon: '💍', lvl: 82, time: 8, xp: 450, in: { log_world: 5, bar_aether: 2, gem_diamond: 1 }, equip: { slots: CRAFT_SLOTS, r: 5 } },
      ...BOWYER.map(([id, name, lvl, r, more], i) => ({
        id: 'bow_' + id, ...(i ? {} : { group: '활 · 지팡이 깎기 (원목 → 원거리 · 마법 무기)' }), name: `${name} 활 · 지팡이`, icon: '🏹', lvl, time: 5 + i * 0.3,
        xp: Math.round(xpAt(lvl) * 3), in: { ['log_' + id]: 8, ...more }, equip: { slots: ['weapon'], r, kinds: WOOD_KINDS },
      })),
      { id: 'claw', group: '몬스터 재료 공예', name: '맹수 발톱 장갑', icon: '🧤', lvl: 28, time: 5, xp: 80, in: { mon_claw: 4, mon_hide: 3, bar_gold: 1 }, equip: { slots: ['gloves'], r: 1 } },
      { id: 'icecape', name: '서리 결정 망토', icon: '🧣', lvl: 50, time: 6, xp: 150, in: { mon_ice: 5, mon_cloth: 3, bar_titan: 1 }, equip: { slots: ['cape'], r: 2 } },
      ...TROPHY.map(([name, lvl, r], z) => ({
        id: 'trophy' + z, ...(z ? {} : { group: '전리품 공예 (특수 옵션 보장)' }), name, icon: ZONES[z].boss[0], lvl, time: 6 + z * 0.5, xp: Math.round(xpAt(lvl) * 4),
        in: trophyIn(z), equip: { slots: DROP_SLOTS, r, sp: true },
      })),
    ],
  },
  {
    id: 'alch', name: '연금술', icon: '⚗️', kind: '가공', desc: '약초와 몬스터 전리품으로 물약을 만듭니다. 전리품 물약으로 방어 · 드롭률 버프도 받을 수 있습니다. 창고에서 마시면 일정 시간 강력한 버프를 받습니다.',
    actions: [
      { id: 'atk', name: '힘의 물약', icon: '🧪', lvl: 1, time: 3, xp: 15, in: { herb: 2, fish_minnow: 1 }, out: { pot_atk: 1 } },
      { id: 'atk2', name: '힘의 물약 (독버섯)', icon: '🧪', lvl: 8, time: 3, xp: 20, in: { herb: 1, mon_mushroom: 2 }, out: { pot_atk: 1 } },
      { id: 'gold', name: '행운의 물약', icon: '🧪', lvl: 15, time: 3.5, xp: 30, in: { herb: 3, rune_air: 1 }, out: { pot_gold: 1 } },
      { id: 'gold2', name: '행운의 물약 (하늘꿀)', icon: '🧪', lvl: 25, time: 3.5, xp: 40, in: { herb: 2, mon_honey: 1 }, out: { pot_gold: 2 } },
      { id: 'speed', name: '신속의 물약', icon: '🧪', lvl: 30, time: 4, xp: 50, in: { herb: 3, fish_tropical: 1 }, out: { pot_speed: 1 } },
      { id: 'speed2', name: '신속의 물약 (폭풍 정수)', icon: '🧪', lvl: 40, time: 4, xp: 65, in: { herb: 2, mon_storm: 1 }, out: { pot_speed: 2 } },
      { id: 'hp', name: '거인의 물약', icon: '🧪', lvl: 45, time: 4.5, xp: 80, in: { herb: 3, herb_rare: 1, bar_iron: 1 }, out: { pot_hp: 1 } },
      { id: 'hp2', name: '거인의 물약 (뿔)', icon: '🧪', lvl: 52, time: 4.5, xp: 95, in: { herb_rare: 1, mon_horn: 3 }, out: { pot_hp: 2 } },
      { id: 'all', name: '만능 물약', icon: '🍷', lvl: 65, time: 6, xp: 180, in: { herb_rare: 2, rune_earth: 2, gem: 1 }, out: { pot_all: 1 } },
      { id: 'all2', name: '만능 물약 (심연 먹물)', icon: '🍷', lvl: 78, time: 6, xp: 240, in: { herb_rare: 2, mon_ink: 2, mon_shadow: 2 }, out: { pot_all: 2 } },
      { id: 'hp4', group: '전리품 물약', name: '거인의 물약 (점액)', icon: '🧪', lvl: 14, time: 3.5, xp: 26, in: { herb: 1, mon_slime: 3 }, out: { pot_hp: 1 } },
      { id: 'atk4', name: '힘의 물약 (독주머니)', icon: '🧪', lvl: 26, time: 3, xp: 40, in: { herb: 1, mon_venom: 2 }, out: { pot_atk: 2 } },
      { id: 'def3', name: '철피의 물약 (서리 결정)', icon: '🧪', lvl: 42, time: 4, xp: 70, in: { herb: 2, mon_ice: 2 }, out: { pot_def: 2 } },
      { id: 'def', name: '철피의 물약', icon: '🧪', lvl: 10, time: 3, xp: 22, in: { herb: 2, u_shell: 2 }, out: { pot_def: 1 } },
      { id: 'drop', name: '탐색의 물약', icon: '🧪', lvl: 18, time: 3.5, xp: 32, in: { herb: 3, u_rattail: 3 }, out: { pot_drop: 1 } },
      { id: 'atk3', name: '힘의 물약 (피주머니)', icon: '🧪', lvl: 22, time: 3, xp: 34, in: { herb: 1, u_bloodsac: 2 }, out: { pot_atk: 2 } },
      { id: 'def2', name: '철피의 물약 (이끼 등껍질)', icon: '🧪', lvl: 33, time: 3.5, xp: 52, in: { herb: 2, u_moss: 1, u_crabshell: 1 }, out: { pot_def: 2 } },
      { id: 'hp3', name: '거인의 물약 (곰 발바닥)', icon: '🧪', lvl: 48, time: 4.5, xp: 85, in: { herb: 2, u_paw: 2 }, out: { pot_hp: 2 } },
      { id: 'drop2', name: '탐색의 물약 (부엉이 눈)', icon: '🧪', lvl: 58, time: 4.5, xp: 105, in: { herb_rare: 1, u_owleye: 2 }, out: { pot_drop: 2 } },
      { id: 'speed3', name: '신속의 물약 (로열 젤리)', icon: '🧪', lvl: 63, time: 4, xp: 120, in: { herb: 1, u_jelly: 1, u_dust: 1 }, out: { pot_speed: 3 } },
      { id: 'all3', name: '만능 물약 (화염룡의 심장)', icon: '🍷', lvl: 72, time: 6, xp: 260, in: { herb_rare: 2, u_heart: 1 }, out: { pot_all: 3 } },
    ],
  },
  {
    id: 'arcane', name: '비전술', icon: '🔮', kind: '가공', desc: '룬 원석에 마력을 새겨 룬을 만듭니다. 룬은 신성술·연금술·대장기술·도구에 쓰입니다.',
    actions: [
      { id: 'air', name: '바람 룬', icon: '🌀', lvl: 1, time: 2, xp: 6, in: { rune_ess: 1 }, out: { rune_air: 1 } },
      { id: 'fire', name: '불 룬', icon: '🔥', lvl: 20, time: 2.5, xp: 14, in: { rune_ess: 1, coal: 1 }, out: { rune_fire: 1 } },
      { id: 'fire2', name: '불 룬 (용암 결정)', icon: '🔥', lvl: 28, time: 2.5, xp: 18, in: { rune_ess: 1, mon_ember: 1 }, out: { rune_fire: 2 } },
      { id: 'earth', name: '대지 룬', icon: '⛰️', lvl: 40, time: 3, xp: 26, in: { rune_ess: 2 }, out: { rune_earth: 1 } },
      { id: 'chaos', name: '혼돈 룬', icon: '🌑', lvl: 60, time: 3.5, xp: 45, in: { rune_ess: 3, herb_rare: 1 }, out: { rune_chaos: 1 } },
      { id: 'chaos2', name: '혼돈 룬 (그림자 정수)', icon: '🌑', lvl: 70, time: 3.5, xp: 55, in: { rune_ess: 2, mon_shadow: 1 }, out: { rune_chaos: 2 } },
      { id: 'air2', group: '전리품 룬', name: '바람 룬 (독수리 깃털)', icon: '🌀', lvl: 12, time: 2.2, xp: 12, in: { rune_ess: 1, u_eaglefeather: 1 }, out: { rune_air: 4 } },
      { id: 'fire3', name: '불 룬 (도깨비불)', icon: '🔥', lvl: 32, time: 2.6, xp: 24, in: { rune_ess: 1, u_wisp: 1 }, out: { rune_fire: 4 } },
      { id: 'earth2', name: '대지 룬 (골렘 핵)', icon: '⛰️', lvl: 45, time: 3, xp: 36, in: { rune_ess: 1, u_core: 1 }, out: { rune_earth: 3 } },
      { id: 'chaos3', name: '혼돈 룬 (구름 조각)', icon: '🌑', lvl: 66, time: 3.5, xp: 60, in: { rune_ess: 2, u_cloud: 1, u_breath: 1 }, out: { rune_chaos: 3 } },
    ],
  },
  {
    id: 'divine', name: '신성술', icon: '🙏', kind: '봉헌', desc: '몬스터의 뼈(지역마다 다름) · 영혼 조각 · 룬 · 망령 지역 전리품을 바쳐 신성력을 쌓습니다. 레벨이 오르면 기도가 해금되고, 기도 하나를 켜 두면 효과를 받습니다.',
    actions: [
      { id: 'bone', group: '뼈 공양', name: '뼈 공양', icon: '🦴', lvl: 1, time: 2, xp: 10, in: { bone: 1 } },
      { id: 'bone_big', name: '큰 뼈 공양', icon: '🦴', lvl: 10, time: 2.5, xp: 22, in: { bone_big: 1 } },
      { id: 'bone_beast', name: '맹수의 뼈 공양', icon: '🦴', lvl: 25, time: 3, xp: 40, in: { bone_beast: 1 } },
      { id: 'bone_dragon', name: '용의 뼈 공양', icon: '🦴', lvl: 45, time: 3.5, xp: 70, in: { bone_dragon: 1 } },
      { id: 'bone_ancient', name: '태고의 뼈 공양', icon: '🦴', lvl: 65, time: 4, xp: 120, in: { bone_ancient: 1 } },
      { id: 'ecto', group: '영혼 의식', name: '영혼 정화', icon: '👻', lvl: 35, time: 3, xp: 55, in: { mon_ecto: 1 } },
      { id: 'fire', group: '룬 의식', name: '불꽃 의식', icon: '🔥', lvl: 30, time: 3, xp: 45, in: { rune_fire: 3 } },
      { id: 'chaos', name: '혼돈 정화', icon: '🌑', lvl: 70, time: 4, xp: 140, in: { rune_chaos: 3 } },
      { id: 'mask', group: '전리품 봉헌', name: '요괴 가면 봉인', icon: '👺', lvl: 20, time: 3, xp: 40, in: { u_mask: 1 } },
      { id: 'skull', name: '해골 안치', icon: '💀', lvl: 40, time: 3, xp: 80, in: { u_skull: 1 } },
      { id: 'chain', name: '망령의 사슬 정화', icon: '⛓️', lvl: 50, time: 3.5, xp: 100, in: { u_chain: 1, u_nail: 1 } },
      { id: 'fang', name: '흡혈귀 송곳니 정화', icon: '🗡️', lvl: 60, time: 3.5, xp: 125, in: { u_fang: 1 } },
      { id: 'crown', name: '그림자 왕관 봉헌', icon: '👑', lvl: 75, time: 5, xp: 600, in: { u_crown: 1 } },
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
      { id: 'fishstall', name: '생선 노점', icon: '🐟', lvl: 20, time: 4, xp: 26, gold: 0.3, extra: [['fish_shrimp', 0.5], ['fish_tropical', 0.2], ['fish_eel', 0.1]] },
      { id: 'leather', name: '가죽 노점', icon: '🧥', lvl: 28, time: 4, xp: 32, gold: 0.4, extra: [['mon_hide', 0.6], ['mon_feather', 0.5], ['mon_horn', 0.15]] },
      { id: 'orestall', name: '광물 노점', icon: '⚒️', lvl: 35, time: 4.5, xp: 40, gold: 0.5, extra: [['ore_iron', 0.5], ['coal', 0.6], ['ore_gold', 0.2], ['ore_mithril', 0.12]] },
      { id: 'jeweler', name: '보석상', icon: '💍', lvl: 50, time: 5, xp: 60, gold: 1, extra: [['gem', 0.25], ['gem_sapphire', 0.1], ['gem_emerald', 0.05]] },
      { id: 'apothecary', name: '약재상', icon: '⚗️', lvl: 60, time: 5, xp: 75, gold: 1, extra: [['herb_rare', 0.45], ['rune_ess', 0.5], ['mon_venom', 0.3]] },
      { id: 'caravan', group: '대규모 털이', name: '상단 마차', icon: '🐎', lvl: 45, time: 10, xp: 160, gold: 30, extra: [['gem', 0.3], ['bar_iron', 0.5], ['mon_cloth', 0.3]] },
      { id: 'manor', name: '귀족 저택', icon: '🏛️', lvl: 65, time: 12, xp: 260, gold: 60, extra: [['gem', 0.5], ['herb_rare', 0.6], ['gem_ruby', 0.1]] },
      { id: 'vault', name: '왕실 금고', icon: '🏰', lvl: 80, time: 15, xp: 420, gold: 120, extra: [['gem', 1], ['rune_chaos', 0.5], ['gem_diamond', 0.08]] },
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

export function actionXp(s, act) { return act.xp * xpScale(act.lvl) * VIP.mult * (1 + allBonus(s, 'xp')); }

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
  return Math.ceil(MATS[id].value * goldPerKill(Math.max(1, s.maxStage)));
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
    const i = list.findIndex((x) => x.id === act.id);
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
      const item = game.craftItem(act.equip.slots, act.equip.r, !log, !!act.equip.sp, act.equip.kinds);
      if (log) log.equips.push(item);
    }
  }
  gainXp(game, skillId, actionXp(s, act) * (skillId === 'divine' ? times : 1), log);
  questEvent(s, 'life', 1, skillId);
  rollSkillPet(game, skillId, act);
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

// 창고에서 회복량이 가장 큰 음식 id
export function bestFood(s) {
  let best = null;
  for (const id of Object.keys(s.life.bank)) {
    const m = MATS[id];
    if (m?.heal && s.life.bank[id] > 0 && (!best || m.heal > MATS[best].heal)) best = id;
  }
  return best;
}
export const foodCount = (s) => Object.keys(s.life.bank).reduce((n, id) => n + (MATS[id]?.heal ? s.life.bank[id] : 0), 0);

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
