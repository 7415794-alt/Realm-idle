// DOM UI (탭, 강화 목록, 모달, 토스트)
import {
  SKILLS, SLOTS, SLOT_IDS, RARITIES, WEAPONS, STAGE_KILLS, BOSS_TIME, INV_MAX, ENHANCE_MAX, GAME_NAME, VERSION, CRIT_MULT,
  VIP, zoneOf, itemName, itemStats, itemSellPrice, enhanceCost, goldPerKill, statText, incomingHit, defEfficiency,
} from './data.js';
import { fmt, fmtPct, fmtTime } from './format.js';
import { exportState, importState, clearState } from './state.js';
import {
  LIFE_SKILLS, LIFE, MATS, BUFFS, LIFE_MAX_LV, XP_TABLE, lifeLevel, actionTime, burnChance, stealChance,
  hasInputs, matValue, startAction, stopAction, usePotion, sellMat, describeLog,
  TOOLS, PRAYERS, PRODUCTION, toolInfo, toolUpgradeCheck, upgradeTool, setPrayer, activePrayer, perkText, actionXp, speedMult,
} from './life.js';
import {
  climate, bonusText, msToNextDay, msToNextWeek, PETS, PET, PET_SRC, petCost, hasPet, activePet, buyPet, setPet,
  SB, SKILL_BOSSES, CHEST_NAMES, sbState, sbDamage, sbCheck, attackSkillBoss,
  CHAIN, chainProgress, questText, questIcon, questReward, claimQuest, claimChain, questClaimable,
} from './world.js';

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function setText(el, v) {
  v = String(v);
  if (el._v !== v) {
    el._v = v;
    el.textContent = v;
  }
}

function setDisabled(el, d) {
  if (el.disabled !== d) el.disabled = d;
}

// 공통 강화 행
function makeRow(icon) {
  const el = h('div', 'row', `
    <div class="ricon">${icon}</div>
    <div class="rinfo">
      <div class="rtitle"><span class="rname"></span><span class="rlv"></span></div>
      <div class="rdesc"></div>
    </div>
    <button class="rbtn"><span class="bt1"></span><span class="bt2"></span></button>`);
  return {
    el,
    name: $('.rname', el), lv: $('.rlv', el), desc: $('.rdesc', el),
    btn: $('.rbtn', el), bt1: $('.bt1', el), bt2: $('.bt2', el),
  };
}

export class UI {
  constructor(game, hooks) {
    this.game = game;
    this.hooks = hooks; // { onReset(state), onImport(state) }
    this.tab = 'hero';
    this.updaters = [];
    this.dom = {
      gold: $('#gold'), power: $('#power'), dps: $('#dps'),
      stageName: $('#stageName'), zoneName: $('#zoneName'),
      progFill: $('#progFill'), progText: $('#progText'), bossBtn: $('#bossBtn'), speedBtn: $('#speedBtn'),
      panel: $('#panel'), skills: $('#skills'), toasts: $('#toasts'),
      modal: $('#modal'), modalBox: $('#modalBox'),
    };
    this.dom.bossBtn.addEventListener('click', () => this.game.toggleAutoAdvance());
    this.dom.speedBtn.addEventListener('click', () => {
      this.game.cycleSpeed();
      this.updateSpeed();
    });
    this.updateSpeed();
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.addEventListener('click', () => this.showTab(b.dataset.tab));
    });
    this.dom.modal.addEventListener('click', (e) => {
      if (e.target === this.dom.modal) this.closeModal();
    });
    this.buildSkills();
    this.showTab('hero');
  }

  updateSpeed() {
    const sp = this.game.speed();
    setText(this.dom.speedBtn, (sp > 1 ? '⏩' : '▶') + ' x' + sp);
    this.dom.speedBtn.classList.toggle('fast', sp > 1);
  }

  // ---------- 매 프레임(약 6~7fps) 갱신 ----------
  refresh() {
    const g = this.game;
    const s = g.s;
    const rt = g.rt;
    const d = this.dom;
    setText(d.gold, fmt(s.gold));
    setText(d.power, fmt(g.powerScore()));
    setText(d.dps, fmt(g.totalDps()));
    const zone = zoneOf(s.stage);
    setText(d.stageName, `스테이지 ${s.stage}`);
    setText(d.zoneName, zone.title);

    const m = rt.monster;
    if (m && m.boss && !m.dead) {
      d.progFill.style.width = (Math.max(0, rt.bossTime) / BOSS_TIME) * 100 + '%';
      d.progFill.classList.add('boss');
      setText(d.progText, `보스 제한시간 ${Math.max(0, rt.bossTime).toFixed(1)}초`);
    } else {
      d.progFill.style.width = (s.kills / STAGE_KILLS) * 100 + '%';
      d.progFill.classList.remove('boss');
      setText(d.progText, s.kills >= STAGE_KILLS ? (s.autoAdvance ? '보스 등장!' : '사냥 중 (보스 대기)') : `처치 ${s.kills} / ${STAGE_KILLS}`);
    }
    const btn = d.bossBtn;
    if (s.autoAdvance) {
      setText(btn, m && m.boss ? '🏳️ 후퇴' : '⏸ 진행 중');
      btn.classList.remove('pulse');
    } else {
      setText(btn, '👑 보스 도전');
      btn.classList.toggle('pulse', s.kills >= STAGE_KILLS);
    }

    this.updateSpeed();
    this.updateSkills();
    for (const u of this.updaters) u();
    if ((this.tab === 'gear' || this.tab === 'hero') && rt.invDirty) this.showTab(this.tab, true);
    if (this.tab === 'life' && this.lifeDirty) this.showTab('life', true);
    if (this.tab === 'adv' && this.advDirty) this.showTab('adv', true);
    this.advBtn ||= $('.tabs button[data-tab="adv"]');
    if (this.advBtn) this.advBtn.classList.toggle('dot', questClaimable(s));
    rt.invDirty = false;

    while (rt.toasts.length) {
      const t = rt.toasts.shift();
      this.toast(t.text, t.kind);
    }
  }

  // ---------- 토스트 / 모달 ----------
  toast(text, kind = '') {
    const el = h('div', 'toast ' + kind);
    el.textContent = text;
    this.dom.toasts.appendChild(el);
    while (this.dom.toasts.children.length > 3) this.dom.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  modal(title, bodyHtml, buttons = [{ label: '확인' }]) {
    const box = this.dom.modalBox;
    box.innerHTML = `<h2>${title}</h2><div class="mbody">${bodyHtml}</div><div class="mbtns"></div>`;
    const wrap = $('.mbtns', box);
    for (const b of buttons) {
      const el = h('button', 'btn ' + (b.cls || ''), b.label);
      el.addEventListener('click', () => {
        const keep = b.onClick ? b.onClick(box) : false;
        if (!keep) this.closeModal();
      });
      wrap.appendChild(el);
    }
    this.dom.modal.classList.remove('hidden');
    return box;
  }

  closeModal() {
    this.dom.modal.classList.add('hidden');
  }

  showOffline(r) {
    this.modal('🌙 돌아오셨군요!', `
      <p>자리를 비운 <b>${fmtTime(r.sec)}</b> 동안 원정대가 계속 싸웠습니다.</p>
      <div class="reward">💰 <b>${fmt(r.gold)}</b> 골드</div>
      <p class="muted">처치 ${fmt(r.kills)} · 장비 ${fmt(r.drops || 0)}개 · 뼈 ${fmt(r.bones || 0)}개 · 최대 오프라인 ${fmtTime(this.game.offlineCapSec())}</p>
      ${r.life ? lifeLines(r.life) : ''}`,
    [{ label: '받기', cls: 'primary' }]);
  }

  // ---------- 스킬 바 ----------
  buildSkills() {
    const wrap = this.dom.skills;
    wrap.innerHTML = '';
    this.skillEls = [];
    for (const k of SKILLS) {
      const b = h('button', 'skill', `<span class="sicon">${k.icon}</span><span class="sname">${k.name}</span><span class="scd"></span>`);
      b.title = k.desc;
      b.addEventListener('click', () => {
        if (!this.game.skillUnlocked(k.id)) {
          this.toast(`스테이지 ${k.unlock} 도달 시 해금: ${k.desc}`);
          return;
        }
        this.game.useSkill(k.id);
      });
      wrap.appendChild(b);
      this.skillEls.push({ k, b, cd: $('.scd', b) });
    }
    const auto = h('button', 'skill auto', '<span class="sicon">🤖</span><span class="sname">자동</span>');
    auto.addEventListener('click', () => {
      this.game.s.autoSkill = !this.game.s.autoSkill;
    });
    wrap.appendChild(auto);
    this.autoBtn = auto;
  }

  updateSkills() {
    const g = this.game;
    for (const { k, b, cd } of this.skillEls) {
      const unlocked = g.skillUnlocked(k.id);
      const st = g.rt.skill[k.id];
      b.classList.toggle('locked', !unlocked);
      b.classList.toggle('active', st.t > 0);
      b.classList.toggle('ready', unlocked && st.cd <= 0);
      const p = unlocked ? st.cd / k.cd : 1;
      b.style.setProperty('--cd', (p * 360).toFixed(1) + 'deg');
      setText(cd, !unlocked ? `🔒${k.unlock}` : st.t > 0 ? Math.ceil(st.t) + 's' : st.cd > 0 ? Math.ceil(st.cd) + 's' : '');
    }
    this.autoBtn.classList.toggle('on', g.s.autoSkill);
  }

  // ---------- 탭 ----------
  showTab(id, keepScroll = false) {
    const scroll = this.dom.panel.scrollTop;
    this.tab = id;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    this.dom.panel.innerHTML = '';
    this.updaters = [];
    this.lifeDirty = false;
    this.advDirty = false;
    const fn = {
      hero: this.tabHero, gear: this.tabGear, life: this.tabLife, adv: this.tabAdv, more: this.tabMore,
    }[id];
    fn.call(this, this.dom.panel);
    for (const u of this.updaters) u();
    this.dom.panel.scrollTop = keepScroll ? scroll : 0;
  }

  tabHero(panel) {
    const g = this.game;
    const s = g.s;
    const card = h('div', 'card stats');
    panel.appendChild(h('div', 'section-title', '⚔️ 능력치 (장비로 결정)'));
    panel.appendChild(card);
    const mon = () => g.rt.monster || { def: 0, str: 0 };
    const fields = [
      ['⚔️ 공격', () => fmt(g.stats().atk)],
      ['💪 힘', () => fmt(g.stats().str)],
      ['🛡️ 방어', () => fmt(g.stats().def)],
      ['❤️ 체력', () => `${fmt(Math.max(0, g.rt.heroHp))} / ${fmt(g.heroMaxHp())}`],
      ['🎯 치명타', () => fmtPct(g.stats().crit, 1) + ' · x' + CRIT_MULT],
      ['💨 공격 속도', () => g.atkSpeed().toFixed(2) + '/초'],
      ['🗡️ 피해 범위', () => `${fmt(g.maxHit() * g.minHitFrac())}~${fmt(g.maxHit())}`],
      ['📈 DPS', () => fmt(g.totalDps())],
      ['💥 받는 피해', () => fmt(incomingHit(mon().str, g.stats().def)) + '/회'],
      ['🧱 피해 감소', () => fmtPct(defEfficiency(g.stats().def, mon().str), 1)],
    ];
    const vals = fields.map(([label]) => {
      const it = h('div', 'stat', `<span>${label}</span><b></b>`);
      card.appendChild(it);
      return $('b', it);
    });
    this.updaters.push(() => fields.forEach(([, f], i) => setText(vals[i], f())));
    const pw = h('div', 'card note power');
    panel.appendChild(pw);
    const wx = h('div', 'card note');
    panel.appendChild(wx);
    this.updaters.push(() => {
      const c = climate();
      const p = activePet(s);
      setText(wx, `${c.weather.icon} ${c.weather.name} · ${c.season.icon} ${c.season.name} · ${p ? p.icon + ' ' + p.name : '펫 없음'} (자세한 효과는 🗺️ 모험 탭)`);
    });
    this.updaters.push(() => setText(pw, `전투력 ${fmt(g.powerScore())} · 몬스터(스테이지 ${s.stage}) 체력 ${fmt(mon().maxHp || 0)} · 방어 ${fmt(mon().def)} · 힘 ${fmt(mon().str)}`));

    panel.appendChild(h('div', 'section-title', '🎽 장착 장비'));
    const wrap = h('div');
    panel.appendChild(wrap);
    const build = () => {
      wrap.innerHTML = '';
      for (const slot of SLOT_IDS) {
        const it = s.equip[slot];
        if (it) wrap.appendChild(this.itemCard(it, true));
        else {
          const off = slot === 'shield' && g.twoHanded();
          wrap.appendChild(h('div', 'item empty', `<div class="iicon">${SLOTS[slot].icon}</div><div class="iinfo"><div class="iname">${SLOTS[slot].name} 없음</div><div class="istat">${off ? '양손검 착용 중' : '몬스터 드롭 · 대장기술 · 제작으로 획득'}</div></div>`));
        }
      }
    };
    build();
    this.heroRebuild = build;
  }

  itemCard(it, equipped) {
    const g = this.game;
    const rar = RARITIES[it.r];
    const icon = it.slot === 'weapon' ? (WEAPONS[it.kind || 'sword'].twoHand ? '⚔️' : '🗡️') : SLOTS[it.slot].icon;
    const el = h('div', 'item' + (equipped ? ' equipped' : ''));
    el.style.setProperty('--rc', rar.color);
    let diff = '';
    if (!equipped) {
      const d = g.upgradeGain(it);
      diff = `<span class="diff ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}</span>`;
    }
    const inactive = equipped && it.slot === 'shield' && g.twoHanded();
    const wd = it.slot === 'weapon' ? WEAPONS[it.kind || 'sword'] : null;
    const extra = wd ? ` · 속도 ${wd.speed}${wd.minHit ? ' · 최소피해+' + Math.round(wd.minHit * 100) + '%' : ''}${wd.twoHand ? ' · 양손' : ''}` : '';
    el.innerHTML = `
      <div class="iicon">${icon}</div>
      <div class="iinfo">
        <div class="iname"><span class="rtag" style="color:${rar.color}">[${rar.name}]</span> ${itemName(it)} <small>Lv${it.lvl}</small></div>
        <div class="istat">${statText(itemStats(it))}${extra} ${diff}${inactive ? ' <span class="diff down">양손검으로 비활성</span>' : ''}</div>
      </div>
      <div class="ibtns"></div>`;
    const btns = $('.ibtns', el);
    if (equipped) {
      const enh = h('button', 'btn small');
      const upd = () => {
        const c = enhanceCost(it);
        enh.innerHTML = it.enh >= ENHANCE_MAX ? '강화 MAX' : `강화 +${it.enh + 1}<br><small>💰 ${fmt(c)}</small>`;
        setDisabled(enh, it.enh >= ENHANCE_MAX || c > g.s.gold);
      };
      enh.addEventListener('click', () => {
        if (g.enhance(it.id)) {
          this.toast(`${itemName(it)} 강화 성공!`, 'good');
          this.showTab(this.tab, true);
        }
      });
      this.updaters.push(upd);
      const off = h('button', 'btn small', '해제');
      off.addEventListener('click', () => { if (g.unequip(it.slot)) this.showTab(this.tab, true); else this.toast('가방이 가득 찼습니다', 'bad'); });
      btns.append(enh, off);
    } else {
      const eb = h('button', 'btn small primary', '장착');
      eb.addEventListener('click', () => { g.equipItem(it.id); this.showTab(this.tab, true); });
      const sb = h('button', 'btn small', `판매<br><small>💰 ${fmt(itemSellPrice(it))}</small>`);
      sb.addEventListener('click', () => { g.sellItem(it.id); this.showTab(this.tab, true); });
      btns.append(eb, sb);
    }
    return el;
  }

  tabGear(panel) {
    const g = this.game;
    const s = g.s;
    const opts = h('div', 'card opts');
    const sellOpts = ['끄기', ...RARITIES.slice(1, 9).map((r, i) => `${RARITIES[i].name} 이하`)];
    opts.innerHTML = `
      <label class="toggle"><input type="checkbox" id="optAutoEquip"> 더 좋은 장비 자동 장착</label>
      <label>자동 판매 <select id="optAutoSell">${sellOpts.map((o, i) => `<option value="${i}">${o}</option>`).join('')}</select></label>
      <div class="muted">드롭률 6% · 보스는 등급을 4번, 지역 보스는 8번 굴려 가장 좋은 등급 · 최고 획득 등급 <b style="color:${RARITIES[s.stats.bestRarity || 0].color}">${RARITIES[s.stats.bestRarity || 0].name}</b></div>`;
    panel.appendChild(opts);
    const ae = $('#optAutoEquip', opts);
    ae.checked = s.settings.autoEquip;
    ae.addEventListener('change', () => { s.settings.autoEquip = ae.checked; });
    const as = $('#optAutoSell', opts);
    as.value = String(Math.min(s.settings.autoSell, sellOpts.length - 1));
    as.addEventListener('change', () => { s.settings.autoSell = Number(as.value); });

    // 등급표
    const tbl = h('details', 'card rartable', `<summary>장비 등급 ${RARITIES.length}단계 보기</summary><div class="rgrid">${RARITIES.map((r) => `<span style="color:${r.color}">${r.name} x${r.mult}</span>`).join('')}</div>`);
    panel.appendChild(tbl);

    const head = h('div', 'section-title', `가방 (${s.inv.length}/${INV_MAX})`);
    const bulk = h('button', 'btn small', '희귀 이하 일괄 판매');
    bulk.addEventListener('click', () => {
      const r = g.sellBelow(2);
      if (r.count) this.toast(`${r.count}개 판매: 💰 ${fmt(r.total)}`, 'good');
    });
    head.appendChild(bulk);
    panel.appendChild(head);
    if (!s.inv.length) panel.appendChild(h('div', 'muted center pad', '가방이 비어 있습니다'));
    const sorted = [...s.inv].sort((a, b) => g.upgradeGain(b) - g.upgradeGain(a));
    for (const it of sorted) panel.appendChild(this.itemCard(it, false));
  }

  // ---------- 생활 스킬 ----------
  tabLife(panel) {
    const g = this.game;
    const s = g.s;
    const L = s.life;
    this.lifeDirty = false;
    this.lifeView = this.lifeView || 'skills';
    this.lifeSel = this.lifeSel || L.active?.skill || 'wood';

    // 진행 중인 행동 / 버프
    const act = h('div', 'card lifeact', `
      <div class="la-top"><span class="la-text"></span><button class="btn small la-stop">중지</button></div>
      <div class="lbar"><div></div></div>
      <div class="la-buffs muted"></div>`);
    panel.appendChild(act);
    const laText = $('.la-text', act);
    const laStop = $('.la-stop', act);
    const laBar = $('.lbar div', act);
    const laBuffs = $('.la-buffs', act);
    laStop.addEventListener('click', () => { stopAction(g); });
    this.updaters.push(() => {
      const a = L.active;
      if (a) {
        const k = LIFE[a.skill];
        const ad = k.actions.find((x) => x.id === a.action);
        setText(laText, L.stun > 0
          ? `🚨 들켰습니다! ${L.stun.toFixed(1)}초 기절 · ${ad.icon} ${ad.name}`
          : `${k.icon} ${k.name} · ${ad.icon} ${ad.name} (${actionTime(s, a.skill, ad).toFixed(1)}초)`);
        laBar.style.width = (L.progress * 100).toFixed(1) + '%';
        act.classList.toggle('stunned', L.stun > 0);
      } else {
        setText(laText, '쉬는 중 · 아래에서 행동을 골라 시작하세요');
        laBar.style.width = '0%';
      }
      laStop.style.visibility = a ? 'visible' : 'hidden';
      const bl = Object.entries(L.buffs).filter(([, t]) => t > 0).map(([b, t]) => `${BUFFS[b].name} ${BUFFS[b].label} ${fmtTime(t)}`);
      setText(laBuffs, bl.length ? '🧪 ' + bl.join(' · ') : '');
      laBuffs.style.display = bl.length ? '' : 'none';
    });

    const seg = h('div', 'buybar');
    for (const [v, label] of [['skills', '🛠️ 스킬'], ['bank', '📦 창고']]) {
      const b = h('button', this.lifeView === v ? 'on' : '', label);
      b.addEventListener('click', () => { this.lifeView = v; this.showTab('life'); });
      seg.appendChild(b);
    }
    panel.appendChild(seg);

    if (this.lifeView === 'bank') this.lifeBank(panel);
    else this.lifeSkills(panel);
  }

  lifeSkills(panel) {
    const g = this.game;
    const s = g.s;
    const L = s.life;

    const grid = h('div', 'lifegrid');
    for (const k of LIFE_SKILLS) {
      const b = h('button', 'lchip' + (k.id === this.lifeSel ? ' sel' : ''), `<span class="lc-i">${k.icon}</span><span class="lc-n">${k.name}</span><span class="lc-l"></span>`);
      b.addEventListener('click', () => { this.lifeSel = k.id; this.showTab('life', true); });
      grid.appendChild(b);
      const lv = $('.lc-l', b);
      this.updaters.push(() => {
        setText(lv, 'Lv ' + lifeLevel(s, k.id));
        b.classList.toggle('running', L.active?.skill === k.id);
      });
    }
    panel.appendChild(grid);
    const total = h('div', 'muted center');
    panel.appendChild(total);
    this.updaters.push(() => setText(total, `총 생활 레벨 ${LIFE_SKILLS.reduce((a, k) => a + lifeLevel(s, k.id), 0)} / ${LIFE_SKILLS.length * LIFE_MAX_LV}`));

    const k = LIFE[this.lifeSel];
    const head = h('div', 'card lifehead', `
      <div class="lh-top"><b>${k.icon} ${k.name}</b><span class="tag">${k.kind}</span><span class="lh-lv"></span></div>
      <div class="lbar xp"><div></div><span></span></div>
      <p>${k.desc}</p><p class="lh-bonus"></p>`);
    panel.appendChild(head);
    const hLv = $('.lh-lv', head);
    const hBar = $('.lbar div', head);
    const hTxt = $('.lbar span', head);
    const hBonus = $('.lh-bonus', head);
    this.updaters.push(() => {
      const lv = lifeLevel(s, k.id);
      const xp = L.xp[k.id] || 0;
      setText(hLv, `Lv ${lv} / ${LIFE_MAX_LV}`);
      if (lv >= LIFE_MAX_LV) {
        hBar.style.width = '100%';
        setText(hTxt, `최고 레벨 · 경험치 ${fmt(xp)}`);
      } else {
        const cur = xp - XP_TABLE[lv];
        const need = XP_TABLE[lv + 1] - XP_TABLE[lv];
        hBar.style.width = (cur / need * 100).toFixed(1) + '%';
        setText(hTxt, `${fmt(cur)} / ${fmt(need)} XP`);
      }
      let bonus;
      if (k.tool) bonus = `특수 효과: ${perkText(s, k.id)}`;
      else if (PRODUCTION.includes(k.id)) bonus = `작업대 속도 x${toolInfo(s, 'workshop').cur.speed}`;
      else if (k.id === 'divine') bonus = activePrayer(s) ? `기도 중: ${activePrayer(s).icon} ${activePrayer(s).name} (${activePrayer(s).desc})` : '켜 둔 기도가 없습니다 (아래에서 선택)';
      else bonus = '요구 레벨보다 높을수록 조금씩 빨라집니다 (최대 +25%)';
      setText(hBonus, bonus);
    });

    // 채집 도구 / 가공 작업대
    const toolKey = k.tool || (PRODUCTION.includes(k.id) ? 'workshop' : null);
    if (toolKey) this.lifeToolCard(panel, toolKey);

    // 신성술: 기도 목록
    if (k.id === 'divine') this.lifePrayers(panel);

    for (const a of k.actions) {
      if (a.group) panel.appendChild(h('div', 'section-title', a.group));
      const r = makeRow(a.icon);
      setText(r.name, a.name);
      r.btn.addEventListener('click', () => {
        if (L.active?.skill === k.id && L.active.action === a.id) stopAction(g);
        else if (startAction(g, k.id, a.id)) this.toast(`${k.icon} ${a.name} 시작`, 'good');
      });
      panel.appendChild(r.el);
      this.updaters.push(() => {
        const lv = lifeLevel(s, k.id);
        const locked = lv < a.lvl;
        const running = L.active?.skill === k.id && L.active.action === a.id;
        const parts = [];
        if (a.in) parts.push('필요: ' + Object.entries(a.in).map(([id, n]) => `${MATS[id].icon}${MATS[id].name} ${n} (보유 ${fmt(L.bank[id] || 0)})`).join(', '));
        if (a.out) parts.push('획득: ' + matList(a.out));
        if (a.equip) parts.push(`획득: ${a.equip.slots.map((x) => SLOTS[x].name).join('/')} · <span style="color:${RARITIES[a.equip.r].color}">${RARITIES[a.equip.r].name}</span> 이상 · Lv${Math.max(1, s.maxStage)}`);
        if (a.gold) parts.push(`골드 약 ${fmt(a.gold * g.goldMult() * goldPerKillAt(s))}`);
        if (a.extra) parts.push('확률: ' + a.extra.map(([id, p]) => `${MATS[id].icon}${MATS[id].name} ${fmtPct(p, 1)}`).join(', '));
        const extra = [`XP ${fmt(actionXp(s, a))}`, `${actionTime(s, k.id, a).toFixed(1)}초 (x${speedMult(s, k.id, a).toFixed(2)})`];
        if (k.id === 'thief') extra.push(`성공 ${fmtPct(stealChance(s, a))}`);
        const bc = burnChance(s, k.id, a);
        if (bc > 0) extra.push(`태울 확률 ${fmtPct(bc)}`);
        parts.push(extra.join(' · '));
        const html = parts.join('<br>');
        if (r.desc._h !== html) { r.desc._h = html; r.desc.innerHTML = html; }
        setText(r.lv, `Lv ${a.lvl}`);
        r.el.classList.toggle('locked', locked);
        r.el.classList.toggle('running', running);
        const ok = hasInputs(s, a);
        setText(r.bt1, locked ? '🔒 잠김' : running ? '■ 중지' : '▶ 시작');
        setText(r.bt2, locked ? `Lv ${a.lvl} 필요` : !running && !ok ? '재료 부족' : '');
        setDisabled(r.btn, locked || (!running && !ok));
      });
    }
  }

  lifeToolCard(panel, key) {
    const g = this.game;
    const s = g.s;
    const t = TOOLS[key];
    const card = h('div', 'card toolcard', `
      <div class="tc-top"><span class="tc-name"></span><span class="tc-speed"></span></div>
      <div class="tc-next muted"></div>
      <button class="btn small primary tc-btn"></button>`);
    panel.appendChild(card);
    const nm = $('.tc-name', card);
    const sp = $('.tc-speed', card);
    const nx = $('.tc-next', card);
    const bt = $('.tc-btn', card);
    bt.addEventListener('click', () => {
      if (upgradeTool(g, key)) this.toast(`${t.icon} ${toolInfo(s, key).name}(으)로 업그레이드!`, 'epic');
    });
    this.updaters.push(() => {
      const info = toolInfo(s, key);
      setText(nm, `${t.icon} ${info.name}`);
      setText(sp, `속도 x${info.cur.speed}`);
      if (!info.next) {
        setText(nx, '최고 단계입니다');
        bt.style.display = 'none';
        return;
      }
      const mats = Object.entries(info.next.mats).map(([id, n]) => `${MATS[id].icon}${MATS[id].name} ${n} (보유 ${fmt(s.life.bank[id] || 0)})`);
      const req = [info.next.lvl ? `Lv ${info.next.lvl}` : null, info.next.gold ? `💰 ${fmt(info.next.gold)}` : null, ...mats].filter(Boolean);
      setText(nx, `다음: ${info.next.pre} ${t.name} (속도 x${info.next.speed}) · 필요: ${req.join(', ')}`);
      const chk = toolUpgradeCheck(s, key);
      setText(bt, chk.ok ? '업그레이드' : chk.why);
      setDisabled(bt, !chk.ok);
    });
  }

  lifePrayers(panel) {
    const s = this.game.s;
    panel.appendChild(h('div', 'section-title', '기도 (1개만 켤 수 있음)'));
    for (const p of PRAYERS) {
      const r = makeRow(p.icon);
      setText(r.name, p.name);
      setText(r.lv, `Lv ${p.lvl}`);
      setText(r.desc, p.desc);
      r.btn.addEventListener('click', () => {
        if (setPrayer(s, p.id)) this.toast(s.life.prayer ? `${p.icon} ${p.name} 시작` : '기도를 껐습니다', 'good');
      });
      panel.appendChild(r.el);
      this.updaters.push(() => {
        const locked = lifeLevel(s, 'divine') < p.lvl;
        const on = s.life.prayer === p.id && !locked;
        r.el.classList.toggle('locked', locked);
        r.el.classList.toggle('running', on);
        setText(r.bt1, locked ? '🔒 잠김' : on ? '■ 끄기' : '🙏 켜기');
        setText(r.bt2, locked ? `Lv ${p.lvl} 필요` : '');
        setDisabled(r.btn, locked);
      });
    }
  }

  lifeBank(panel) {
    const g = this.game;
    const s = g.s;
    const L = s.life;

    const opts = h('div', 'card opts', '<label class="toggle"><input type="checkbox"> 체력 40% 미만일 때 음식 자동 섭취</label>');
    const cb = $('input', opts);
    cb.checked = L.autoEat;
    cb.addEventListener('change', () => { L.autoEat = cb.checked; });
    panel.appendChild(opts);

    const owned = () => Object.keys(MATS).filter((id) => (L.bank[id] || 0) > 0);
    const ids = owned();
    const sig = ids.join(',');
    this.updaters.push(() => { if (owned().join(',') !== sig) this.lifeDirty = true; });
    panel.appendChild(h('div', 'section-title', `창고 (${ids.length}종)`));
    if (!ids.length) {
      panel.appendChild(h('div', 'muted center pad', '창고가 비어 있습니다. 생활 스킬로 재료를 모아 보세요.<br>몬스터를 잡으면 뼈도 얻습니다.'));
      return;
    }
    for (const id of ids) {
      const m = MATS[id];
      const row = h('div', 'row bankrow', `
        <div class="ricon">${m.icon}</div>
        <div class="rinfo"><div class="rtitle"><span class="rname">${m.name}</span><span class="rlv"></span></div><div class="rdesc"></div></div>
        <div class="bbtns"></div>`);
      const cnt = $('.rlv', row);
      const desc = $('.rdesc', row);
      const btns = $('.bbtns', row);
      let use = null;
      if (m.buff) {
        use = h('button', 'btn small primary', '마시기');
        use.addEventListener('click', () => {
          if (usePotion(g, id)) this.toast(`${m.name}: ${m.buff.map((b) => BUFFS[b].name + ' ' + BUFFS[b].label).join(', ')}`, 'good');
        });
        btns.appendChild(use);
      }
      const sell = h('button', 'btn small', '전부 판매');
      sell.addEventListener('click', () => {
        const n = L.bank[id] || 0;
        const gold = sellMat(g, id, n);
        if (gold > 0) this.toast(`${m.name} ${fmt(n)}개 판매: 💰 ${fmt(gold)}`, 'good');
      });
      btns.appendChild(sell);
      panel.appendChild(row);
      const info = m.heal ? `음식 · 체력 ${Math.round(m.heal * 100)}% 회복`
        : m.buff ? `물약 · ${m.buff.map((b) => BUFFS[b].name + ' ' + BUFFS[b].label).join(', ')} ${fmtTime(m.dur)}` : '재료';
      this.updaters.push(() => {
        const n = L.bank[id] || 0;
        setText(cnt, 'x' + fmt(n));
        setText(desc, `${info} · 개당 💰 ${fmt(matValue(s, id))}`);
        if (use) setDisabled(use, n <= 0);
        setDisabled(sell, n <= 0);
      });
    }
  }

  // ---------- 모험 (퀘스트 · 스킬 보스 · 펫 · 날씨) ----------
  tabAdv(panel) {
    const g = this.game;
    const s = g.s;
    const c = climate();
    const wcard = h('div', 'card weather', `
      <div class="wx-top"><span class="wx-icon">${c.weather.icon}</span><div><b>오늘 날씨: ${c.weather.name}</b><div class="muted">${bonusText(c.weather.bonus)}</div></div></div>
      <div class="wx-top"><span class="wx-icon">${c.season.icon}</span><div><b>이번 주 계절: ${c.season.name}</b><div class="muted">${bonusText(c.season.bonus)}</div></div></div>
      <div class="muted wx-next"></div>`);
    panel.appendChild(wcard);
    const wn = $('.wx-next', wcard);
    this.updaters.push(() => setText(wn, `날씨는 매일 0시, 계절은 매주 월요일에 바뀝니다 · 날씨 변경까지 ${fmtTime(msToNextDay() / 1000)}`));

    const seg = h('div', 'buybar');
    for (const [v, label] of [['quest', '📜 퀘스트'], ['sboss', '🐉 스킬 보스'], ['pet', '🐾 펫']]) {
      const b = h('button', this.advView === v ? 'on' : '', label);
      b.addEventListener('click', () => { this.advView = v; this.showTab('adv'); });
      seg.appendChild(b);
    }
    panel.appendChild(seg);
    if (this.advView === 'sboss') this.advBoss(panel);
    else if (this.advView === 'pet') this.advPets(panel);
    else this.advQuests(panel);
  }

  rewardToast(title, lines) {
    if (!lines) return;
    this.modal(title, `<div class="rewardlist">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`, [{ label: '확인', cls: 'primary' }]);
    this.showTab('adv', true);
  }

  questRow(panel, q, onClaim) {
    const r = makeRow(questIcon(q));
    setText(r.name, questText(q));
    r.btn.addEventListener('click', onClaim);
    panel.appendChild(r.el);
    const bar = h('div', 'lbar qbar', '<div></div>');
    $('.rinfo', r.el).appendChild(bar);
    const fill = $('div', bar);
    this.updaters.push(() => {
      const done = q.n >= q.goal;
      setText(r.desc, `${fmt(q.n)} / ${fmt(q.goal)}`);
      fill.style.width = Math.min(100, (q.n / q.goal) * 100).toFixed(1) + '%';
      r.el.classList.toggle('running', done && !q.claimed);
      r.el.classList.toggle('locked', q.claimed);
      setText(r.bt1, q.claimed ? '✔ 완료' : done ? '🎁 받기' : '진행 중');
      setText(r.bt2, '');
      setDisabled(r.btn, q.claimed || !done);
    });
  }

  advQuests(panel) {
    const g = this.game;
    const s = g.s;
    const Q = s.world.quests;

    // 원정 퀘스트
    panel.appendChild(h('div', 'section-title', `🗺️ 원정 퀘스트 (${Math.min(Q.chain, CHAIN.length)} / ${CHAIN.length})`));
    const cp = chainProgress(s);
    if (!cp) panel.appendChild(h('div', 'card muted center', '모든 원정 퀘스트를 완료했습니다!'));
    else {
      const rw = cp.reward;
      const r = makeRow('🗺️');
      setText(r.name, `${Q.chain + 1}. ${cp.text}`);
      setText(r.lv, `보상: ${RARITIES[rw.floor].name} 이상 장비${rw.pet ? ' · 펫 ' + PET[rw.pet].icon + PET[rw.pet].name : ''}`);
      r.lv.style.color = RARITIES[rw.floor].color;
      r.btn.addEventListener('click', () => this.rewardToast('🗺️ 원정 퀘스트 완료!', claimChain(g)));
      panel.appendChild(r.el);
      const bar = h('div', 'lbar qbar', '<div></div>');
      $('.rinfo', r.el).appendChild(bar);
      const fill = $('div', bar);
      this.updaters.push(() => {
        const p = chainProgress(s);
        if (!p) return;
        setText(r.desc, `${fmt(p.n)} / ${fmt(p.goal)}`);
        fill.style.width = Math.min(100, (p.n / p.goal) * 100).toFixed(1) + '%';
        r.el.classList.toggle('running', p.done);
        setText(r.bt1, p.done ? '🎁 받기' : '진행 중');
        setText(r.bt2, '');
        setDisabled(r.btn, !p.done);
      });
    }

    const dr = questReward(s, false);
    const dt = h('div', 'section-title', '📅 일일 퀘스트');
    panel.appendChild(dt);
    panel.appendChild(h('div', 'muted qnote', `보상: 💰 ${fmt(dr.gold)} + <span style="color:${RARITIES[dr.floor].color}">${RARITIES[dr.floor].name}</span> 이상 장비`));
    Q.daily.forEach((q, i) => this.questRow(panel, q, () => this.rewardToast('📅 일일 퀘스트 완료!', claimQuest(g, false, i))));
    const dn = h('div', 'muted center');
    panel.appendChild(dn);
    this.updaters.push(() => setText(dn, `새 일일 퀘스트까지 ${fmtTime(msToNextDay() / 1000)}`));

    const wr = questReward(s, true);
    panel.appendChild(h('div', 'section-title', '🗓️ 주간 퀘스트'));
    panel.appendChild(h('div', 'muted qnote', `보상: 💰 ${fmt(wr.gold)} + <span style="color:${RARITIES[wr.floor].color}">${RARITIES[wr.floor].name}</span> 이상 장비`));
    Q.weekly.forEach((q, i) => this.questRow(panel, q, () => this.rewardToast('🗓️ 주간 퀘스트 완료!', claimQuest(g, true, i))));
    const wn = h('div', 'muted center');
    panel.appendChild(wn);
    this.updaters.push(() => setText(wn, `새 주간 퀘스트까지 ${fmtTime(msToNextWeek() / 1000)}`));

    // 날짜가 바뀌면 다시 그림
    const sig = `${Q.day}/${Q.week}`;
    this.updaters.push(() => { if (`${Q.day}/${Q.week}` !== sig) this.advDirty = true; });
  }

  advBoss(panel) {
    const g = this.game;
    const s = g.s;
    panel.appendChild(h('div', 'card help', `<ul>
      <li>매주 보스마다 <b>${SB.tries}번</b> 도전할 수 있습니다 (월요일 0시 초기화).</li>
      <li>피해량은 해당 생활 스킬 레벨과 도구 성능, 채집 속도 효과로 정해집니다.</li>
      <li>누적 피해가 단계를 넘을 때마다 상자를 엽니다: 재료 · 골드 · 등급 하한 장비 · 드물게 <b>펫</b>.</li>
    </ul>`));
    for (const b of SKILL_BOSSES) {
      const card = h('div', 'card sboss', `
        <div class="sb-top"><span class="sb-icon">${b.icon}</span><div class="sb-info"><b>${b.name}</b> <span class="tag">${LIFE[b.skill].icon} ${LIFE[b.skill].name}</span><div class="muted">${b.desc}</div></div></div>
        <div class="lbar sb-hp"><div></div><span></span></div>
        <div class="sb-ms"></div>
        <div class="sb-foot"><span class="muted sb-dmg"></span><button class="btn primary sb-btn"></button></div>`);
      panel.appendChild(card);
      const fill = $('.sb-hp div', card);
      const txt = $('.sb-hp span', card);
      const ms = $('.sb-ms', card);
      const dmg = $('.sb-dmg', card);
      const btn = $('.sb-btn', card);
      btn.addEventListener('click', () => {
        const r = attackSkillBoss(g, b.id);
        if (!r) return;
        const body = `<p>${b.icon} ${b.name}에게 <b>${fmt(r.dmg)}</b> 피해!${r.killed ? ' <b>이번 주 처치 완료!</b>' : ''}</p>` +
          (r.chests.length ? r.chests.map((c) => `<div class="offlife"><b>🎁 ${c.name}</b>${c.lines.map((l) => `<div>${l}</div>`).join('')}</div>`).join('') : '<p class="muted">다음 상자까지 조금 더!</p>');
        this.modal('🐉 스킬 보스 도전', body, [{ label: '확인', cls: 'primary' }]);
        this.showTab('adv', true);
      });
      this.updaters.push(() => {
        const st = sbState(s, b.id);
        const p = st.dmg / SB.hp;
        fill.style.width = Math.max(0, 100 - p * 100).toFixed(2) + '%';
        setText(txt, `체력 ${fmt(SB.hp - st.dmg)} / ${fmt(SB.hp)} · 남은 도전 ${SB.tries - st.tries}회`);
        const html = SB.milestones.map((m, i) => `<span class="${i < st.got ? 'got' : ''}">${i < st.got ? '✔' : '🎁'} ${CHEST_NAMES[i]} ${Math.round(m * 100)}%</span>`).join('');
        if (ms._h !== html) { ms._h = html; ms.innerHTML = html; }
        setText(dmg, `예상 피해 약 ${fmt(sbDamage(s, b))} · 펫 ${PET[b.pet].icon}${PET[b.pet].name}${hasPet(s, b.pet) ? ' ✔' : ''}`);
        const chk = sbCheck(s, b);
        setText(btn, chk.ok ? '⚔️ 도전' : chk.why);
        setDisabled(btn, !chk.ok);
      });
    }
    const n = h('div', 'muted center');
    panel.appendChild(n);
    this.updaters.push(() => setText(n, `초기화까지 ${fmtTime(msToNextWeek() / 1000)}`));
  }

  advPets(panel) {
    const g = this.game;
    const s = g.s;
    const ap = activePet(s);
    panel.appendChild(h('div', 'card note', ap ? `데리고 다니는 펫: ${ap.icon} <b>${ap.name}</b> · ${bonusText(ap.bonus)}` : '데리고 다니는 펫이 없습니다. 펫은 1마리만 데리고 다닐 수 있습니다.'));
    const groups = [['shop', '🛒 상점 펫'], ['boss', '👑 보스 펫 (지역 보스 처치 시 1%)'], ['skillboss', '🐉 스킬 보스 펫'], ['quest', '🗺️ 원정 펫']];
    for (const [src, title] of groups) {
      panel.appendChild(h('div', 'section-title', `${title} (${PETS.filter((p) => p.src === src && hasPet(s, p.id)).length} / ${PETS.filter((p) => p.src === src).length})`));
      for (const p of PETS.filter((x) => x.src === src)) {
        const owned = hasPet(s, p.id);
        const r = makeRow(owned || src === 'shop' ? p.icon : '❔');
        setText(r.name, owned || src === 'shop' ? p.name : '???');
        setText(r.desc, bonusText(p.bonus));
        if (src === 'skillboss') setText(r.lv, p.id === 'woodpecker' || p.id === 'hedgehog' || p.id === 'penguin' ? '전용 보스' : '모든 스킬 보스');
        r.btn.addEventListener('click', () => {
          if (hasPet(s, p.id)) { setPet(g, p.id); this.showTab('adv', true); }
          else if (buyPet(g, p.id)) this.showTab('adv', true);
        });
        panel.appendChild(r.el);
        this.updaters.push(() => {
          const own = hasPet(s, p.id);
          const on = s.world.pets.active === p.id;
          r.el.classList.toggle('running', on);
          r.el.classList.toggle('locked', !own && src !== 'shop');
          if (own) {
            setText(r.bt1, on ? '■ 넣기' : '🐾 데리고 가기');
            setText(r.bt2, '');
            setDisabled(r.btn, false);
          } else if (src === 'shop') {
            const lockd = s.maxStage < p.stage;
            setText(r.bt1, lockd ? '🔒 잠김' : '구매');
            setText(r.bt2, lockd ? `스테이지 ${p.stage}` : `💰 ${fmt(petCost(p))}`);
            setDisabled(r.btn, lockd || s.gold < petCost(p));
          } else {
            setText(r.bt1, '미획득');
            setText(r.bt2, PET_SRC[src]);
            setDisabled(r.btn, true);
          }
        });
      }
    }
  }

  tabMore(panel) {
    const g = this.game;
    const s = g.s;
    const st = h('div', 'card stats');
    panel.appendChild(h('div', 'section-title', '📊 통계'));
    panel.appendChild(st);
    const rows = [
      ['플레이 시간', () => fmtTime(s.stats.playTime)],
      ['총 처치', () => fmt(s.stats.kills)],
      ['보스 처치', () => fmt(s.stats.bossKills)],
      ['누적 골드', () => fmt(s.stats.goldEarned)],
      ['획득 장비', () => fmt(s.stats.items)],
      ['탭 횟수', () => fmt(s.stats.taps)],
      ['쓰러진 횟수', () => fmt(s.stats.deaths || 0)],
      ['최고 등급', () => RARITIES[s.stats.bestRarity || 0].name],
      ['역대 최고', () => '스테이지 ' + s.maxStage],
    ];
    const vals = rows.map(([label]) => {
      const it = h('div', 'stat', `<span>${label}</span><b></b>`);
      st.appendChild(it);
      return $('b', it);
    });
    this.updaters.push(() => rows.forEach(([, f], i) => setText(vals[i], f())));

    panel.appendChild(h('div', 'section-title', '👑 VIP'));
    panel.appendChild(h('div', 'card vipcard', `<b class="vip-text">${VIP.name}</b> <span class="tag">무료 적용 중</span>
      <p>생활 스킬 경험치 · 장비 드롭률 · 골드 획득 <b>${VIP.label}</b></p>
      <p class="muted">결제 없이 모든 플레이어에게 최고 등급 혜택이 적용됩니다.</p>`));

    panel.appendChild(h('div', 'section-title', '💾 저장'));
    const sv = h('div', 'card btngrid');
    const bSave = h('button', 'btn', '지금 저장');
    bSave.addEventListener('click', () => { this.hooks.onSave(); this.toast('저장되었습니다', 'good'); });
    const bExport = h('button', 'btn', '세이브 내보내기');
    bExport.addEventListener('click', () => {
      const code = exportState(s);
      this.modal('세이브 코드', `<p class="muted">이 코드를 복사해 다른 기기에서 불러올 수 있습니다.</p><textarea readonly class="code">${code}</textarea>`,
        [{ label: '복사', cls: 'primary', onClick: (box) => { navigator.clipboard?.writeText(code).then(() => this.toast('복사됨', 'good')).catch(() => { $('textarea', box).select(); }); return true; } }, { label: '닫기' }]);
    });
    const bImport = h('button', 'btn', '세이브 불러오기');
    bImport.addEventListener('click', () => {
      this.modal('세이브 불러오기', '<textarea class="code" placeholder="세이브 코드를 붙여넣으세요"></textarea>',
        [{ label: '취소' }, {
          label: '불러오기', cls: 'primary', onClick: (box) => {
            try {
              const st2 = importState($('textarea', box).value);
              this.hooks.onImport(st2);
              return false;
            } catch (e) {
              this.toast('잘못된 세이브 코드입니다', 'bad');
              return true;
            }
          },
        }]);
    });
    const bReset = h('button', 'btn danger', '데이터 초기화');
    bReset.addEventListener('click', () => {
      this.modal('정말 초기화할까요?', '<p>모든 진행 상황이 삭제되며 되돌릴 수 없습니다.</p>',
        [{ label: '취소' }, { label: '초기화', cls: 'danger', onClick: () => { clearState(); this.hooks.onReset(); } }]);
    });
    sv.append(bSave, bExport, bImport, bReset);
    panel.appendChild(sv);

    panel.appendChild(h('div', 'section-title', '❓ 도움말'));
    panel.appendChild(h('div', 'card help', `
      <ul>
        <li>전투 화면을 <b>탭</b>하면 영웅이 추가 공격합니다.</li>
        <li>스테이지마다 몬스터 ${STAGE_KILLS}마리를 처치하면 <b>보스</b>가 등장합니다 (제한시간 ${BOSS_TIME}초).</li>
        <li>보스에게 지면 사냥 모드로 바뀝니다. 강해진 뒤 <b>👑 보스 도전</b>을 누르세요.</li>
        <li>스킬은 스테이지 진행에 따라 해금되며 🤖 자동 사용을 켤 수 있습니다.</li>
        <li>영웅의 능력치는 <b>장비</b>로만 정해집니다. 장비는 9부위 · ${RARITIES.length}단계 등급이며, 골드로 강화(+${ENHANCE_MAX})할 수 있습니다.</li>
        <li>최대 피해 = (공격 + 힘) x 0.85 - 몬스터 방어 x 0.3 · 방어가 높을수록 받는 피해가 줄어듭니다.</li>
        <li>막히면 이전 스테이지에서 장비를 모으고 강화하거나, 대장기술·제작으로 장비를 만드세요.</li>
        <li><b>👑 VIP++</b>는 무료입니다: 생활 경험치 · 장비 드롭 · 골드 ${VIP.label}.</li>
        <li><b>🗺️ 모험</b> 탭: 일일·주간·원정 퀘스트, 주간 스킬 보스, 펫(1마리 동행), 매일 바뀌는 날씨와 매주 바뀌는 계절 효과.</li>
        <li><b>⛏️ 생활</b> 탭: 전투와 동시에 생활 스킬 1개를 진행합니다. 재료로 음식·물약·장비를 만듭니다.</li>
        <li>게임을 꺼도 최대 ${fmtTime(g.offlineCapSec())} 동안 골드·장비·뼈를 모으고 생활 스킬이 진행됩니다.</li>
      </ul>
      <p class="muted center">${GAME_NAME} v${VERSION}</p>`));
  }
}

function goldPerKillAt(s) {
  return goldPerKill(Math.max(1, s.maxStage));
}

function lifeLines(log) {
  const lines = describeLog(log);
  return lines.length ? `<div class="offlife"><b>생활 스킬</b>${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : '';
}

function matList(obj) {
  return Object.entries(obj).map(([id, n]) => `${MATS[id].icon} ${MATS[id].name} ${n}`).join(', ');
}
