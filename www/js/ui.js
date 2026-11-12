// DOM UI (탭, 강화 목록, 모달, 토스트)
import {
  HERO_UPGRADES, COMPANIONS, RELICS, SKILLS, SLOTS, SLOT_IDS, RARITIES, STAGE_KILLS, BOSS_TIME,
  INV_MAX, ENHANCE_MAX, PRESTIGE_MIN, GAME_NAME, VERSION,
  zoneOf, itemPct, itemName, itemSellPrice, enhanceCost, prestigeGain, goldPerKill,
} from './data.js';
import { fmt, fmtPct, fmtTime } from './format.js';
import { exportState, importState, clearState } from './state.js';
import {
  LIFE_SKILLS, LIFE, MATS, BUFFS, LIFE_MAX_LV, XP_TABLE, lifeLevel, actionTime, burnChance, stealChance,
  hasInputs, matValue, startAction, stopAction, usePotion, sellMat, divineMult, describeLog,
} from './life.js';

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
      gold: $('#gold'), essence: $('#essence'), dps: $('#dps'),
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
    setText(d.essence, fmt(s.essence));
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
    if (this.tab === 'gear' && rt.invDirty) this.showTab('gear', true);
    if (this.tab === 'life' && this.lifeDirty) this.showTab('life', true);
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
      <p class="muted">처치 ${fmt(r.kills)} · 최대 오프라인 ${fmtTime(this.game.offlineCapSec())}</p>
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
    const fn = {
      hero: this.tabHero, comp: this.tabComp, gear: this.tabGear, life: this.tabLife, relic: this.tabRelic, more: this.tabMore,
    }[id];
    fn.call(this, this.dom.panel);
    for (const u of this.updaters) u();
    this.dom.panel.scrollTop = keepScroll ? scroll : 0;
  }

  buyBar(panel) {
    const bar = h('div', 'buybar');
    const opts = [1, 10, 100, 'max'];
    const btns = opts.map((o) => {
      const b = h('button', '', o === 'max' ? 'MAX' : 'x' + o);
      b.addEventListener('click', () => { this.game.s.settings.buyMult = o; });
      bar.appendChild(b);
      return [o, b];
    });
    this.updaters.push(() => {
      for (const [o, b] of btns) b.classList.toggle('on', this.game.s.settings.buyMult === o);
    });
    panel.appendChild(bar);
  }

  tabHero(panel) {
    const g = this.game;
    const card = h('div', 'card stats');
    panel.appendChild(card);
    const fields = [
      ['⚔️ 공격력', () => fmt(g.heroAtk())],
      ['❤️ 체력', () => `${fmt(Math.max(0, g.rt.heroHp))} / ${fmt(g.heroMaxHp())}`],
      ['💨 공격 속도', () => g.atkSpeed().toFixed(2) + '/초'],
      ['🎯 치명타', () => `${fmtPct(g.critChance())} · ${fmtPct(g.critMult())}`],
      ['🗡️ 영웅 DPS', () => fmt(g.heroDps())],
      ['👥 동료 DPS', () => fmt(g.compDps())],
    ];
    const vals = fields.map(([label]) => {
      const it = h('div', 'stat', `<span>${label}</span><b></b>`);
      card.appendChild(it);
      return $('b', it);
    });
    this.updaters.push(() => fields.forEach(([, f], i) => setText(vals[i], f())));

    this.buyBar(panel);
    for (const def of HERO_UPGRADES) {
      const r = makeRow(def.icon);
      setText(r.name, def.name);
      r.btn.addEventListener('click', () => g.buyHero(def.id));
      panel.appendChild(r.el);
      this.updaters.push(() => {
        const L = g.s.hero[def.id];
        const p = g.plan(def, L, g.s.gold, g.s.settings.buyMult);
        setText(r.lv, p.maxed ? `Lv ${L} (MAX)` : `Lv ${L}`);
        setText(r.desc, p.maxed ? `${def.desc} · ${def.show(def.val(L))}` : `${def.desc} · ${def.show(def.val(L))} → ${def.show(def.val(L + p.n))}`);
        setText(r.bt1, p.maxed ? 'MAX' : `+${p.n}`);
        setText(r.bt2, p.maxed ? '' : '💰 ' + fmt(p.cost));
        setDisabled(r.btn, p.maxed || p.cost > g.s.gold);
      });
    }
  }

  tabComp(panel) {
    const g = this.game;
    const info = h('div', 'card note', '동료는 영웅과 함께 자동으로 지속 피해를 줍니다. 25레벨마다 피해량 x2!');
    panel.appendChild(info);
    this.buyBar(panel);
    COMPANIONS.forEach((def, i) => {
      const r = makeRow(def.icon);
      r.btn.addEventListener('click', () => {
        if (g.buyComp(def.id)) this.updaters.forEach((u) => u());
      });
      panel.appendChild(r.el);
      this.updaters.push(() => {
        const L = g.s.comps[def.id] || 0;
        const prevOwned = i === 0 || (g.s.comps[COMPANIONS[i - 1].id] || 0) > 0;
        const visible = L > 0 || prevOwned;
        r.el.classList.toggle('hidden-row', !visible);
        r.el.classList.toggle('locked', !visible);
        if (!visible) {
          setText(r.name, '???');
          setText(r.lv, '');
          setText(r.desc, '이전 동료를 고용하면 공개됩니다');
          setText(r.bt1, '잠김');
          setText(r.bt2, '');
          setDisabled(r.btn, true);
          return;
        }
        const p = g.plan(def, L, g.s.gold, g.s.settings.buyMult);
        const mult = g.compMult();
        setText(r.name, def.name);
        setText(r.lv, L > 0 ? `Lv ${L}` : '미고용');
        setText(r.desc, `DPS ${fmt(def.val(L) * mult)} → ${fmt(def.val(L + p.n) * mult)}`);
        setText(r.bt1, L > 0 ? `+${p.n}` : '고용');
        setText(r.bt2, '💰 ' + fmt(p.cost));
        setDisabled(r.btn, p.cost > g.s.gold);
      });
    });
  }

  itemCard(it, equipped) {
    const g = this.game;
    const rar = RARITIES[it.r];
    const slot = SLOTS[it.slot];
    const el = h('div', 'item' + (equipped ? ' equipped' : ''));
    el.style.setProperty('--rc', rar.color);
    const eq = g.s.equip[it.slot];
    let diff = '';
    if (!equipped) {
      const d = itemPct(it) - (eq ? itemPct(eq) : 0);
      diff = `<span class="diff ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}%</span>`;
    }
    el.innerHTML = `
      <div class="iicon">${slot.icon}</div>
      <div class="iinfo">
        <div class="iname" style="color:${rar.color}">${itemName(it)}</div>
        <div class="istat">${rar.name} · Lv${it.lvl} · ${slot.stat} +${fmt(itemPct(it))}% ${diff}</div>
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
      enh.addEventListener('click', () => { if (g.enhance(it.id)) this.toast(`${itemName(it)} 강화 성공!`, 'good'); });
      this.updaters.push(upd);
      btns.appendChild(enh);
    } else {
      const eb = h('button', 'btn small primary', '장착');
      eb.addEventListener('click', () => g.equipItem(it.id));
      const sb = h('button', 'btn small', `판매<br><small>💰 ${fmt(itemSellPrice(it))}</small>`);
      sb.addEventListener('click', () => g.sellItem(it.id));
      btns.append(eb, sb);
    }
    return el;
  }

  tabGear(panel) {
    const g = this.game;
    const s = g.s;
    panel.appendChild(h('div', 'section-title', '장착 장비'));
    for (const slot of SLOT_IDS) {
      const it = s.equip[slot];
      if (it) panel.appendChild(this.itemCard(it, true));
      else panel.appendChild(h('div', 'item empty', `<div class="iicon">${SLOTS[slot].icon}</div><div class="iinfo"><div class="iname">${SLOTS[slot].name} 없음</div><div class="istat">몬스터 처치 시 확률적으로 획득 (${SLOTS[slot].stat} 증가)</div></div>`));
    }

    const opts = h('div', 'card opts');
    const sellOpts = ['끄기', ...RARITIES.slice(1).map((r, i) => `${RARITIES[i].name} 이하`)];
    opts.innerHTML = `
      <label class="toggle"><input type="checkbox" id="optAutoEquip"> 더 좋은 장비 자동 장착</label>
      <label>자동 판매 <select id="optAutoSell">${sellOpts.map((o, i) => `<option value="${i}">${o}</option>`).join('')}</select></label>
      <div class="muted">드롭률 ${fmtPct(g.dropChance(), 1)} · 보스는 항상 드롭</div>`;
    panel.appendChild(opts);
    const ae = $('#optAutoEquip', opts);
    ae.checked = s.settings.autoEquip;
    ae.addEventListener('change', () => { s.settings.autoEquip = ae.checked; });
    const as = $('#optAutoSell', opts);
    as.value = String(s.settings.autoSell);
    as.addEventListener('change', () => { s.settings.autoSell = Number(as.value); });

    const head = h('div', 'section-title', `가방 (${s.inv.length}/${INV_MAX})`);
    const bulk = h('button', 'btn small', '희귀 이하 일괄 판매');
    bulk.addEventListener('click', () => {
      const r = g.sellBelow(2);
      if (r.count) this.toast(`${r.count}개 판매: 💰 ${fmt(r.total)}`, 'good');
    });
    head.appendChild(bulk);
    panel.appendChild(head);
    if (!s.inv.length) panel.appendChild(h('div', 'muted center pad', '가방이 비어 있습니다'));
    const sorted = [...s.inv].sort((a, b) => b.r - a.r || itemPct(b) - itemPct(a));
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
        setText(laText, `${k.icon} ${k.name} · ${ad.icon} ${ad.name} (${actionTime(s, a.skill, ad).toFixed(1)}초)`);
        laBar.style.width = (L.progress * 100).toFixed(1) + '%';
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
      setText(hBonus, k.id === 'divine' ? `현재 보너스: 모든 피해 x${divineMult(s).toFixed(2)}` : '레벨이 오를수록 행동이 빨라집니다 (최대 40%)');
    });

    for (const a of k.actions) {
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
        if (a.equip) parts.push(`획득: ${a.equip.slots.map((x) => SLOTS[x].name).join('/')} · ${RARITIES[a.equip.r].name} · Lv${Math.max(1, s.maxStage)}`);
        if (a.gold) parts.push(`골드 약 ${fmt(a.gold * g.goldMult() * goldPerKillAt(s))}`);
        if (a.extra) parts.push('확률: ' + a.extra.map(([id, p]) => `${MATS[id].icon}${MATS[id].name} ${fmtPct(p, 1)}`).join(', '));
        const extra = [`XP ${a.xp}`, `${actionTime(s, k.id, a).toFixed(1)}초`];
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

  tabRelic(panel) {
    const g = this.game;
    const s = g.s;
    const card = h('div', 'card prestige', `
      <div class="ptitle">✨ 환생</div>
      <p>지금까지의 진행(스테이지·골드·영웅·동료)을 초기화하고 <b>에테르 정수 🔮</b>를 얻습니다.
      장비와 유물은 유지됩니다. 누적 정수 1개당 모든 피해 <b>+2%</b>.</p>
      <div class="pstats"></div>
      <button class="btn primary big" id="prestigeBtn"></button>`);
    panel.appendChild(card);
    const pstats = $('.pstats', card);
    const pbtn = $('#prestigeBtn', card);
    pbtn.addEventListener('click', () => {
      const gain = g.prestigeGain();
      if (gain <= 0) return;
      this.modal('환생하시겠습니까?', `
        <p>에테르 정수 <b>🔮 ${gain}</b>개를 얻고 스테이지 ${1 + 5 * g.relic('flag')}부터 다시 시작합니다.</p>
        <p class="muted">골드, 영웅 강화, 동료가 초기화됩니다.</p>`,
      [{ label: '취소' }, { label: '환생', cls: 'primary', onClick: () => { g.prestige(); this.hooks.onSave(); this.showTab('relic'); } }]);
    });
    this.updaters.push(() => {
      const gain = g.prestigeGain();
      const next = s.runMaxStage < PRESTIGE_MIN ? PRESTIGE_MIN : null;
      pstats.innerHTML = `
        <div>이번 원정 최고 스테이지 <b>${s.runMaxStage}</b> · 역대 최고 <b>${s.maxStage}</b></div>
        <div>누적 정수 <b>${fmt(s.stats.essenceEarned)}</b> → 피해 <b>x${g.essenceMult().toFixed(2)}</b></div>
        <div>다음 정수까지: 스테이지 <b>${next ?? nextGainStage(s.runMaxStage)}</b></div>`;
      pbtn.textContent = gain > 0 ? `환생하기 (+🔮 ${gain})` : `스테이지 ${PRESTIGE_MIN}부터 가능`;
      setDisabled(pbtn, gain <= 0);
    });

    const title = h('div', 'section-title');
    panel.appendChild(title);
    this.updaters.push(() => setText(title, `유물 · 보유 🔮 ${fmt(s.essence)}`));
    for (const def of RELICS) {
      const r = makeRow(def.icon);
      setText(r.name, def.name);
      r.btn.addEventListener('click', () => g.buyRelic(def.id));
      panel.appendChild(r.el);
      this.updaters.push(() => {
        const L = g.relic(def.id);
        const p = g.relicPlan(def.id);
        setText(r.lv, p.maxed ? `Lv ${L} (MAX)` : `Lv ${L}`);
        setText(r.desc, `${def.desc} / Lv`);
        setText(r.bt1, p.maxed ? 'MAX' : '+1');
        setText(r.bt2, p.maxed ? '' : '🔮 ' + fmt(Math.ceil(p.cost)));
        setDisabled(r.btn, p.maxed || Math.ceil(p.cost) > s.essence);
      });
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
      ['환생 횟수', () => fmt(s.stats.prestiges)],
      ['역대 최고', () => '스테이지 ' + s.maxStage],
    ];
    const vals = rows.map(([label]) => {
      const it = h('div', 'stat', `<span>${label}</span><b></b>`);
      st.appendChild(it);
      return $('b', it);
    });
    this.updaters.push(() => rows.forEach(([, f], i) => setText(vals[i], f())));

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
        <li>막히면 <b>환생</b>으로 정수를 얻어 유물을 강화하세요.</li>
        <li><b>⛏️ 생활</b> 탭: 전투와 동시에 생활 스킬 1개를 진행합니다. 재료로 음식·물약·장비를 만들고, 생활 스킬은 환생해도 유지됩니다.</li>
        <li>게임을 꺼도 최대 ${fmtTime(g.offlineCapSec())} 동안 골드를 모읍니다.</li>
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

function nextGainStage(runMax) {
  const cur = prestigeGain(runMax);
  let st = runMax;
  while (prestigeGain(st) <= cur && st < runMax + 500) st++;
  return st;
}

