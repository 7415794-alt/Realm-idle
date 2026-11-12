// 게임 밸런스 / 콘텐츠 데이터
import { fmt, fmtPct } from './format.js';

export const GAME_NAME = '에테르 원정기';
export const VERSION = '1.3.0';

// ---- 전투 / 스테이지 ----
export const STAGE_KILLS = 10;      // 보스 등장까지 처치 수
export const BOSS_TIME = 30;        // 보스 제한 시간(초)
export const RESPAWN = 0.35;        // 몬스터 재등장 시간
export const HERO_REVIVE = 3;       // 영웅 부활 시간
export const INV_MAX = 40;          // 가방 칸 수
export const PRESTIGE_MIN = 40;     // 환생 가능 최소 스테이지

export const monsterHp = (s) => 8 * Math.pow(1.19, s - 1);
export const monsterDmg = (s) => 1.2 * Math.pow(1.14, s - 1);
export const goldPerKill = (s) => 2 * Math.pow(1.13, s - 1);
export const isZoneBoss = (s) => s % 10 === 0;
export const bossHpMult = (s) => (isZoneBoss(s) ? 12 : 6);
export const bossGoldMult = (s) => (isZoneBoss(s) ? 15 : 6);
export const milestone = (L) => Math.pow(2, Math.floor(L / 25));

// ---- 지역 ----
export const ZONES = [
  {
    name: '고요한 숲', sky: ['#8fd3f4', '#e2f7d4'], hill: '#6fae5a', ground: '#4c8a3a',
    monsters: [['🐛', '애벌레'], ['🐀', '들쥐'], ['🐌', '독달팽이'], ['🦔', '가시고슴도치'], ['🐍', '풀뱀']],
    boss: ['🐗', '멧돼지 우두머리'],
  },
  {
    name: '안개 늪', sky: ['#7b8d99', '#c4d1bd'], hill: '#5a7563', ground: '#3d5a46',
    monsters: [['🐸', '늪개구리'], ['🦟', '흡혈모기'], ['🦎', '늪도마뱀'], ['🍄', '걷는 버섯'], ['🐢', '이끼거북']],
    boss: ['🐊', '늪의 군주'],
  },
  {
    name: '바위 협곡', sky: ['#f6c48a', '#f7e3c3'], hill: '#b07a4f', ground: '#8a5b38',
    monsters: [['🦂', '협곡전갈'], ['🦅', '바위독수리'], ['🐺', '회색늑대'], ['🦬', '성난 들소'], ['🕷️', '동굴거미']],
    boss: ['🦍', '협곡의 폭군'],
  },
  {
    name: '화염 동굴', sky: ['#3a0d0d', '#a8341c'], hill: '#5e1a12', ground: '#2e0f0b',
    monsters: [['🔥', '불도깨비'], ['🦇', '용암박쥐'], ['🦖', '화염 랩터'], ['👺', '화염 요괴'], ['🦀', '용암게']],
    boss: ['🐉', '화염룡'],
  },
  {
    name: '얼음 성채', sky: ['#a9d6ff', '#f0f8ff'], hill: '#c8e2f5', ground: '#9cc3de',
    monsters: [['⛄', '서리 정령'], ['🐧', '빙하 펭귄'], ['🦭', '얼음 바다표범'], ['🐻‍❄️', '설원곰'], ['🧊', '얼음 골렘']],
    boss: ['🦣', '고대 매머드'],
  },
  {
    name: '그림자 왕국', sky: ['#1b1530', '#4a3a6b'], hill: '#2d2445', ground: '#1a1428',
    monsters: [['👻', '망령'], ['💀', '해골 병사'], ['🧟', '구울'], ['🦉', '밤부엉이'], ['🧛', '흡혈귀']],
    boss: ['👹', '그림자 군주'],
  },
  {
    name: '천공의 섬', sky: ['#5ec2ff', '#fff6d6'], hill: '#ffffff', ground: '#7fc06b',
    monsters: [['🌪️', '폭풍 정령'], ['🦜', '천둥새'], ['🐝', '거대 벌'], ['🦋', '환영나비'], ['☁️', '구름 골렘']],
    boss: ['🌩️', '폭풍의 화신'],
  },
  {
    name: '심연의 바다', sky: ['#021b3a', '#0d5a7a'], hill: '#083049', ground: '#0a2235',
    monsters: [['🐙', '심연 문어'], ['🦑', '대왕오징어'], ['🦈', '그림자 상어'], ['🐡', '독복어'], ['🐚', '껍질괴물']],
    boss: ['🐋', '심연의 고래'],
  },
];

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
export function zoneOf(stage) {
  const idx = Math.floor((stage - 1) / 10);
  const zone = ZONES[idx % ZONES.length];
  const cycle = Math.floor(idx / ZONES.length);
  return { ...zone, title: zone.name + (ROMAN[cycle] ?? ` ${cycle + 1}`) };
}

// ---- 영웅 강화 (골드) ----
// cost(L) = base * growth^(L - start)
export const HERO_UPGRADES = [
  {
    id: 'atk', icon: '⚔️', name: '공격력', base: 4, growth: 1.07, start: 1,
    desc: '기본 공격력 · 25레벨마다 x2',
    val: (L) => 5 * L * milestone(L), show: (v) => fmt(v),
  },
  {
    id: 'hp', icon: '❤️', name: '체력', base: 5, growth: 1.07, start: 1,
    desc: '최대 체력 · 25레벨마다 x2',
    val: (L) => 40 * L * milestone(L), show: (v) => fmt(v),
  },
  {
    id: 'speed', icon: '💨', name: '공격 속도', base: 40, growth: 1.25, start: 0, max: 40,
    desc: '초당 공격 횟수',
    val: (L) => 1 + 0.05 * L, show: (v) => v.toFixed(2) + '/초',
  },
  {
    id: 'crit', icon: '🎯', name: '치명타 확률', base: 80, growth: 1.22, start: 0, max: 45,
    desc: '치명타 발생 확률',
    val: (L) => 0.05 + 0.01 * L, show: (v) => fmtPct(v),
  },
  {
    id: 'critDmg', icon: '💥', name: '치명타 피해', base: 150, growth: 1.16, start: 0,
    desc: '치명타 피해 배율',
    val: (L) => 1.5 + 0.1 * L, show: (v) => fmtPct(v),
  },
  {
    id: 'goldUp', icon: '💰', name: '골드 획득', base: 300, growth: 1.15, start: 0,
    desc: '처치 시 골드 획득량',
    val: (L) => 1 + 0.05 * L, show: (v) => fmtPct(v),
  },
];

// ---- 동료 (골드) ----
export const COMPANIONS = [
  { id: 'archer', icon: '🏹', name: '견습 궁수', dps: 3, base: 50 },
  { id: 'mage', icon: '🔮', name: '떠돌이 마법사', dps: 25, base: 600 },
  { id: 'druid', icon: '🌿', name: '숲의 드루이드', dps: 180, base: 8e3 },
  { id: 'knight', icon: '🛡️', name: '강철 기사', dps: 1.5e3, base: 1.2e5 },
  { id: 'storm', icon: '⚡', name: '폭풍 술사', dps: 1.4e4, base: 2e6 },
  { id: 'saint', icon: '✨', name: '별빛 성녀', dps: 1.5e5, base: 4e7 },
  { id: 'dragoon', icon: '🐲', name: '용기사', dps: 2e6, base: 1e9 },
  { id: 'void', icon: '🌌', name: '공허의 현자', dps: 3e7, base: 3e10 },
  { id: 'meteor', icon: '☄️', name: '유성 소환사', dps: 5e8, base: 1e12 },
  { id: 'titan', icon: '🗿', name: '고대 거신', dps: 9e9, base: 4e13 },
].map((c) => ({ ...c, growth: 1.075, start: 0, val: (L) => c.dps * L * milestone(L) }));

// ---- 유물 (에테르 정수) ----
export const RELICS = [
  { id: 'sword', icon: '🗡️', name: '고대의 검', base: 1, growth: 1.45, desc: '영웅 공격력 +30%', per: 0.3 },
  { id: 'banner', icon: '🚩', name: '동료의 인장', base: 1, growth: 1.45, desc: '동료 DPS +30%', per: 0.3 },
  { id: 'grail', icon: '🏆', name: '황금 성배', base: 1, growth: 1.5, desc: '골드 획득 +25%', per: 0.25 },
  { id: 'shield', icon: '🛡️', name: '수호의 방패', base: 1, growth: 1.45, desc: '영웅 체력 +30%', per: 0.3 },
  { id: 'eye', icon: '👁️', name: '사냥꾼의 눈', base: 2, growth: 1.5, desc: '치명타 피해 +25%', per: 0.25 },
  { id: 'clover', icon: '🍀', name: '행운의 클로버', base: 2, growth: 1.6, max: 20, desc: '장비 드롭률 +15%', per: 0.15 },
  { id: 'hourglass', icon: '⏳', name: '시간의 모래시계', base: 3, growth: 1.7, max: 10, desc: '오프라인 시간 +1시간, 효율 +5%', per: 1 },
  { id: 'flag', icon: '🏁', name: '도약의 깃발', base: 5, growth: 1.6, max: 20, desc: '환생 후 시작 스테이지 +5', per: 5 },
].map((r) => ({ ...r, start: 0 }));

// ---- 스킬 ----
export const SKILLS = [
  { id: 'strike', icon: '⚔️', name: '일격필살', unlock: 5, cd: 10, dur: 0, desc: '공격력 25배 + 동료 DPS 3초분 피해' },
  { id: 'frenzy', icon: '🔥', name: '광폭화', unlock: 15, cd: 45, dur: 12, desc: '12초간 공격 속도 x2' },
  { id: 'rally', icon: '📯', name: '전투의 함성', unlock: 25, cd: 60, dur: 15, desc: '15초간 동료 DPS x3' },
  { id: 'midas', icon: '💰', name: '황금비', unlock: 35, cd: 90, dur: 20, desc: '20초간 골드 획득 x3' },
];

// ---- 장비 ----
export const RARITIES = [
  { name: '일반', color: '#b8b8b8', mult: 1 },
  { name: '고급', color: '#5fd35f', mult: 1.6 },
  { name: '희귀', color: '#4da3ff', mult: 2.6 },
  { name: '영웅', color: '#c37bff', mult: 4.2 },
  { name: '전설', color: '#ffa63d', mult: 7 },
];
export const DROP_WEIGHTS = {
  normal: [60, 26, 10, 3.3, 0.7],
  boss: [20, 40, 26, 11, 3],
  zoneBoss: [0, 30, 40, 22, 8],
};
export const SLOTS = {
  weapon: { name: '무기', icon: '🗡️', stat: '영웅 공격력', names: ['녹슨 검', '강철 검', '룬 블레이드', '용살자의 검', '에테르 성검'] },
  armor: { name: '방어구', icon: '🥋', stat: '영웅 체력', names: ['가죽 갑옷', '사슬 갑옷', '미스릴 흉갑', '용린 갑주', '별빛 성갑'] },
  accessory: { name: '장신구', icon: '💍', stat: '동료 DPS', names: ['구리 반지', '은 목걸이', '마력의 부적', '현자의 보주', '영원의 인장'] },
};
export const SLOT_IDS = Object.keys(SLOTS);
export const ENHANCE_MAX = 10;

export const itemPct = (it) => RARITIES[it.r].mult * (10 + it.lvl * 1.5) * (1 + 0.15 * it.enh);
export const itemName = (it) => SLOTS[it.slot].names[it.r] + (it.enh > 0 ? ` +${it.enh}` : '');
export const itemSellPrice = (it) => goldPerKill(it.lvl) * 2 * RARITIES[it.r].mult * (1 + it.enh * 0.5);
export const enhanceCost = (it) => goldPerKill(it.lvl) * 12 * Math.pow(1.55, it.enh);

export const prestigeGain = (runMax) => (runMax < PRESTIGE_MIN ? 0 : Math.floor(Math.pow((runMax - 30) / 10, 2)));
