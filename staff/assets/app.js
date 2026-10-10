/* เว็บพนักงาน — เรียกหลังบ้าน + เก็บค่าในเครื่อง */
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

  /* ── โหมดทดลอง: ทำงานเหมือน Code.gs แต่เก็บใน localStorage (คีย์ demo-db ใช้ร่วมกับเว็บเจ้าของร้าน) ── */
  const Demo = (() => {
    const ITEMS = [
      { name: 'ไดฟุกุ ครีมนม',       price: 10, color: '#f3e3c3' },
      { name: 'ไดฟุกุ ช็อกโกแลต',     price: 10, color: '#c9a48a' },
      { name: 'ไดฟุกุ ชาเขียว',      price: 10, color: '#bcd9b0' },
      { name: 'ไดฟุกุ สตรอเบอร์รี่',   price: 10, color: '#f5bccb' },
      { name: 'ไดฟุกุ โอริโอ้',      price: 10, color: '#c8c6d3' },
      { name: 'บราวนี่',             price: 10, color: '#a98274' },
      { name: 'ทาร์ตไข่',            price: 5,  color: '#f7d98b' }
    ];
    const K = 'demo-db';
    const db = () => store.get(K, {});            // { 'yyyy-MM-dd': { stock: {item:{price,old,add,left}}, money } }
    const save = d => store.set(K, d);
    const isNum = v => v !== '' && v !== null && v !== undefined && isFinite(Number(v)) && Number(v) >= 0;
    const need = rows => {
      const m = {}; (rows || []).forEach(r => { m[r.item] = r; });
      ITEMS.forEach(it => { if (!m[it.name]) throw new Error('ยังไม่ได้กรอก ' + it.name); });
      return m;
    };
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
      const d = db();
      switch (req.action) {
        case 'items': return { ok: true, items: ITEMS };
        case 'day': {
          const day = d[req.date], prev = lastLeft(d, req.date);
          let before = null, after = null;
          if (day) {
            before = {}; Object.entries(day.stock).forEach(([n, s]) => { before[n] = { old: s.old, add: s.add }; });
            if (Object.values(day.stock).every(s => s.left !== null)) {
              after = { rows: {} }; Object.entries(day.stock).forEach(([n, s]) => { after.rows[n] = s.left; });
              if (day.money) Object.assign(after, day.money);
            }
          }
          return { ok: true, items: ITEMS, date: req.date, before, after,
                   suggestOld: prev && prev.left, suggestFrom: prev && prev.date };
        }
        case 'saveBefore': {
          const m = need(req.rows), day = d[req.date] || { stock: {}, money: null };
          ITEMS.forEach(it => {
            const r = m[it.name];
            if (!isNum(r.old) || !isNum(r.add)) throw new Error('กรอก ' + it.name + ' ให้ครบ');
            const ex = day.stock[it.name];
            let left = ex ? ex.left : null;
            if (left !== null && left > +r.old + +r.add) left = null;
            day.stock[it.name] = { price: ex ? ex.price : it.price, old: +r.old, add: +r.add, left };
          });
          d[req.date] = day; save(d); return { ok: true };
        }
        case 'saveAfter': {
          const day = d[req.date];
          if (!day) throw new Error('ยังไม่ได้กรอก "ก่อนขาย" ของวันนี้');
          const m = need(req.rows);
          ['cash', 'transfer', 'thai'].forEach(k => { if (!isNum(req[k])) throw new Error('กรอกเงินให้ครบ (ถ้าไม่มีใส่ 0)'); });
          ITEMS.forEach(it => {
            const s = day.stock[it.name] || { price: it.price, old: 0, add: 0 }, left = m[it.name].left;
            if (!isNum(left)) throw new Error('กรอกคงเหลือ ' + it.name);
            if (+left > s.old + s.add) throw new Error(`${it.name}: คงเหลือ ${left} มากกว่าที่มี ${s.old + s.add}`);
            s.left = +left; day.stock[it.name] = s;
          });
          const expenses = (req.expenses || []).map(Number).filter(n => n > 0);
          day.money = { cash: +req.cash, transfer: +req.transfer, thai: +req.thai,
                        expense: expenses.reduce((a, b) => a + b, 0), expenses };
          save(d); return { ok: true };
        }
      }
      throw new Error('ไม่รู้จักคำสั่ง');
    }
    return { handle: req => new Promise((ok, no) => setTimeout(() => {
      try { ok(handle(JSON.parse(JSON.stringify(req)))); } catch (e) { no(e); }
    }, 150)) };
  })();

  /* ── UI เล็ก ๆ ── */
  function toast(msg, kind) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.className = 'show ' + (kind || '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { el.className = ''; }, 3200);
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function thDate(k) {
    const [y, m, d] = k.split('-').map(Number);
    return `${d} ${TH_MONTHS[m - 1]} ${String(y + 543).slice(2)}`;
  }
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-shop]').forEach(el => { el.textContent = CFG.SHOP_NAME || 'ร้านขนม'; });
    if (DEMO) {
      const b = document.createElement('div');
      b.className = 'demo';
      b.textContent = '🧪 โหมดทดลอง — ข้อมูลเก็บในเครื่องนี้เท่านั้น (ยังไม่ได้ใส่ API_URL ใน config.js)';
      document.body.prepend(b);
    }
  });

  window.App = { call, store, toast, esc, thDate, today, DEMO };
})();
