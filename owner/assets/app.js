/* เว็บเจ้าของร้าน — เรียกหลังบ้าน + เก็บค่าในเครื่อง */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.API_URL;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  async function call(action, body) {
    const req = Object.assign({ action }, body || {});
    if (DEMO) return Demo.handle(req);
    let res;
    try {
      res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
                                       body: JSON.stringify(req) });
    } catch (e) {
      throw new Error('ต่อเน็ตไม่ได้ ลองใหม่อีกครั้ง');
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('หลังบ้านตอบกลับไม่ถูกต้อง (เช็ค API_URL)'); }
    if (!j.ok) throw new Error(j.error || 'ผิดพลาด');
    return j;
  }

  /* ── โหมดทดลอง: อ่านข้อมูลที่เว็บพนักงานโหมดทดลองเก็บไว้ (localStorage คีย์ demo-db) · รหัส 1234 ── */
  const Demo = (() => {
    const PIN = '1234';
    const lastLeft = (d, date) => {
      const ds = Object.keys(d).filter(k => k < date).sort().reverse();
      for (const k of ds) {
        const st = d[k].stock, names = Object.keys(st);
        if (names.length && names.every(n => st[n].left !== null)) {
          const left = {}; names.forEach(n => { left[n] = st[n].left; });
          return { date: k, left };
        }
      }
      return null;
    };
    function handle(req) {
      if (String(req.pin) !== PIN) throw new Error('รหัสไม่ถูกต้อง (โหมดทดลองใช้ 1234)');
      if (req.action === 'login') return { ok: true };
      if (req.action !== 'report') throw new Error('ไม่รู้จักคำสั่ง');
      const d = store.get('demo-db', {});
      const days = Object.keys(d).filter(k => k >= req.from && k <= req.to).sort().map(k => ({
        date: k, money: d[k].money,
        stock: Object.entries(d[k].stock).map(([item, s]) => Object.assign({ item }, s))
      }));
      return { ok: true, from: req.from, to: req.to, days, prevLeft: lastLeft(d, req.from) };
    }
    return { handle: req => new Promise((ok, no) => setTimeout(() => {
      try { ok(handle(JSON.parse(JSON.stringify(req)))); } catch (e) { no(e); }
    }, 150)) };
  })();

  /* ── UI เล็ก ๆ ── */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสฯ', 'ศุกร์', 'เสาร์'];
  function thDate(k, withDay) {
    const [y, m, d] = k.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return (withDay ? TH_DAYS[dow] + ' ' : '') + `${d} ${TH_MONTHS[m - 1]} ${String(y + 543).slice(2)}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-shop]').forEach(el => { el.textContent = CFG.SHOP_NAME || 'ร้านขนม'; });
    if (DEMO) {
      const b = document.createElement('div');
      b.className = 'demo';
      b.textContent = '🧪 โหมดทดลอง — อ่านข้อมูลทดลองในเครื่องนี้ (ยังไม่ได้ใส่ API_URL ใน config.js)';
      document.body.prepend(b);
    }
  });

  window.App = { call, store, esc, thDate, DEMO };
})();
