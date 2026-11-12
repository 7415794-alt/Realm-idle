// 캔버스 전투 화면 렌더러
import { zoneOf } from './data.js';
import { fmt } from './format.js';

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
const HERO_EMOJI = '🧙';

export class Renderer {
  constructor(canvas, game) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.t = 0;
    this.ripples = [];
    this.resize();
    if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(canvas);
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.cv.width = Math.round(this.w * dpr);
    this.cv.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  addRipple(x, y) {
    this.ripples.push({ x, y, t: 0 });
  }

  emoji(ch, x, y, size, alpha = 1) {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = '#000'; // 컬러 이모지도 fillStyle의 투명도를 따르므로 불투명하게
    c.font = `${size}px ${EMOJI_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ch, x, y);
    c.globalAlpha = 1;
  }

  bar(x, y, w, h, ratio, color, bg = 'rgba(0,0,0,.45)') {
    const c = this.ctx;
    ratio = Math.max(0, Math.min(1, ratio));
    c.fillStyle = bg;
    roundRect(c, x - 1, y - 1, w + 2, h + 2, (h + 2) / 2);
    c.fill();
    if (ratio > 0) {
      c.fillStyle = color;
      roundRect(c, x, y, Math.max(h, w * ratio), h, h / 2);
      c.fill();
    }
  }

  text(str, x, y, size, color, stroke = 'rgba(0,0,0,.75)', weight = 800) {
    const c = this.ctx;
    c.font = `${weight} ${size}px "Pretendard","Noto Sans KR",system-ui,${EMOJI_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = Math.max(2, size / 6);
    c.strokeStyle = stroke;
    c.lineJoin = 'round';
    c.strokeText(str, x, y);
    c.fillStyle = color;
    c.fillText(str, x, y);
  }

  draw(dt) {
    this.t += dt;
    const { ctx: c, w, h, game } = this;
    const s = game.s;
    const rt = game.rt;
    const zone = zoneOf(s.stage);
    const gy = h * 0.8;
    const scale = Math.min(1.2, Math.max(0.7, h / 260));

    // 하늘
    const g = c.createLinearGradient(0, 0, 0, gy);
    g.addColorStop(0, zone.sky[0]);
    g.addColorStop(1, zone.sky[1]);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    // 원경 언덕 (천천히 흐름)
    c.fillStyle = zone.hill;
    c.globalAlpha = 0.55;
    c.beginPath();
    c.moveTo(0, gy);
    const off = this.t * 6;
    for (let x = 0; x <= w + 10; x += 10) {
      const y = gy - 40 * scale - Math.sin((x + off) / 70) * 14 * scale - Math.sin((x + off) / 23) * 5;
      c.lineTo(x, y);
    }
    c.lineTo(w, gy);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;

    // 땅
    c.fillStyle = zone.ground;
    c.fillRect(0, gy, w, h - gy);
    c.fillStyle = 'rgba(255,255,255,.08)';
    for (let x = ((-this.t * 10) % 40); x < w; x += 40) c.fillRect(x, gy + 6, 18, 3);

    const hx = w * 0.27;
    const mx = w * 0.72;

    // 영웅
    const heroDead = rt.heroDead > 0;
    const lunge = rt.lunge > 0 ? Math.sin((rt.lunge / 0.15) * Math.PI) * 18 : 0;
    const hy = gy - 34 * scale + (heroDead ? 10 : Math.sin(this.t * 2.5) * 2);
    c.save();
    c.translate(hx + lunge, hy);
    if (heroDead) c.rotate(-Math.PI / 2.4);
    this.emoji(HERO_EMOJI, 0, 0, 64 * scale, heroDead ? 0.45 : 1);
    c.restore();
    if (heroDead) {
      this.emoji('💫', hx, hy - 40 * scale, 22 * scale);
      this.text(`부활까지 ${rt.heroDead.toFixed(1)}초`, hx, hy - 64 * scale, 13, '#fff');
    }
    const maxHp = game.heroMaxHp();
    const hpR = rt.heroHp / maxHp;
    this.bar(hx - 34 * scale, gy + 8, 68 * scale, 7, hpR, hpR > 0.3 ? '#4ade80' : '#f87171');
    // 체력 숫자 (정확한 값)
    const n = (v) => (v < 1e15 ? (Math.round(Math.max(0, v) * 10) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : fmt(v));
    this.text(`${n(rt.heroHp)} / ${n(maxHp)}`, hx, gy + 26, 11, '#fff');

    // 몬스터
    const m = rt.monster;
    if (m) {
      const baseSize = (m.boss ? (m.zoneBoss ? 120 : 104) : 76) * scale;
      let alpha = 1;
      let sc = Math.min(1, 0.4 + rt.spawnT * 4);
      if (m.dead) {
        const p = 1 - Math.max(0, rt.respawn) / 0.35;
        alpha = 1 - p;
        sc = 1 + p * 0.3;
      }
      const shake = rt.shake > 0 ? (Math.random() - 0.5) * 10 * (rt.shake / 0.15) : 0;
      const my = gy - baseSize * 0.48 + Math.sin(this.t * 2) * 3;
      if (m.boss && !m.dead) {
        const rg = c.createRadialGradient(mx, my, 10, mx, my, baseSize * 0.9);
        rg.addColorStop(0, m.zoneBoss ? 'rgba(255,170,40,.55)' : 'rgba(255,60,60,.45)');
        rg.addColorStop(1, 'rgba(255,0,0,0)');
        c.fillStyle = rg;
        c.beginPath();
        c.arc(mx, my, baseSize * 0.9, 0, Math.PI * 2);
        c.fill();
      }
      // 그림자
      c.fillStyle = 'rgba(0,0,0,.25)';
      c.beginPath();
      c.ellipse(mx, gy + 2, baseSize * 0.4, 7, 0, 0, Math.PI * 2);
      c.fill();
      c.save();
      c.translate(mx + shake, my);
      c.scale(sc, sc);
      if (rt.shake > 0.08 && !m.dead) {
        c.shadowColor = '#fff';
        c.shadowBlur = 25;
      }
      this.emoji(m.e, 0, 0, baseSize, alpha);
      c.restore();

      if (!m.dead) {
        const bw = Math.min(150, w * 0.36);
        const by = my - baseSize * 0.62 - 12;
        this.text((m.boss ? '👑 ' : '') + m.name, mx, by - 13, 13, m.boss ? '#ffd166' : '#fff');
        this.bar(mx - bw / 2, by, bw, 9, m.hp / m.maxHp, m.boss ? '#ef4444' : '#f97316');
      }
    }

    // 부유 텍스트
    for (const f of rt.fx) {
      const p = f.t / f.life;
      if (p >= 1) continue;
      const ax = f.anchor === 'hero' ? hx : mx;
      const ay = f.anchor === 'hero' ? gy - 90 * scale : gy - 120 * scale;
      const a = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      c.globalAlpha = Math.max(0, a);
      switch (f.type) {
        case 'dmg': {
          const size = f.big ? 26 : f.crit ? 20 : 15;
          const color = f.big ? '#ff4d6d' : f.crit ? '#ffb020' : f.tap ? '#bfe3ff' : '#ffffff';
          this.text(f.text, ax + f.dx, ay - p * 50, size, color);
          break;
        }
        case 'comp':
          this.text(f.text, ax + f.dx * 0.6 + 30, ay + 30 - p * 40, 12, '#a7f3d0');
          break;
        case 'gold':
          this.text('💰 ' + f.text, ax, ay + 40 - p * 60, 16, '#ffd84d');
          break;
        case 'hurt':
          this.text(f.text, ax + f.dx * 0.4, ay + 20 - p * 30, 14, '#ff6b6b');
          break;
        case 'loot':
          c.shadowColor = f.color;
          c.shadowBlur = 18;
          this.emoji(f.text, ax + 30, gy - 20 - Math.sin(p * Math.PI) * 50, 26);
          c.shadowBlur = 0;
          break;
        case 'text':
          this.text(f.text, ax, ay - 10 - p * 30, 17, '#ffe08a');
          break;
        default:
          break;
      }
      c.globalAlpha = 1;
    }

    // 탭 파동
    for (const r of this.ripples) {
      r.t += dt;
      const p = r.t / 0.35;
      c.strokeStyle = `rgba(255,255,255,${Math.max(0, 1 - p)})`;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(r.x, r.y, 8 + p * 30, 0, Math.PI * 2);
      c.stroke();
    }
    this.ripples = this.ripples.filter((r) => r.t < 0.35);
  }
}

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
