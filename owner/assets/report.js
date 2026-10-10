/* คำนวณสรุปยอดขายจากข้อมูลดิบ — ใช้ในหน้าเจ้าของร้าน (และเทสต์ใน Node) */
(function (root) {
  'use strict';

  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
  const r2 = n => Math.round(n * 100) / 100;

  /** วันเดียว: day = { date, stock:[{item,price,old,add,left}], money } · prevLeft = {item: n} ของวันก่อนหน้า */
  function computeDay(day, prevLeft) {
    const rows = day.stock.map(s => {
      const total = s.old + s.add;
      const sold = s.left === null || s.left === undefined ? null : total - s.left;
      return { item: s.item, price: s.price, old: s.old, add: s.add, total, left: s.left ?? null,
               sold, value: sold === null ? null : sold * s.price };
    });
    const hasBefore = rows.length > 0;
    const hasAfter = hasBefore && rows.every(r => r.left !== null) && !!day.money;
    const m = day.money || { cash: 0, transfer: 0, thai: 0, expense: 0, expenses: [] };
    const units = sum(rows, r => r.sold || 0);
    const expected = sum(rows, r => r.value || 0);
    const received = r2(m.cash + m.transfer + m.thai + m.expense);
    const diff = r2(received - expected);

    const issues = [];
    if (!hasBefore) issues.push({ kind: 'missing', text: 'ไม่ได้กรอกก่อนขาย' });
    else if (!hasAfter) issues.push({ kind: 'missing', text: 'ยังไม่ได้กรอกหลังขาย' });
    if (hasAfter && diff < 0) issues.push({ kind: 'short', text: `เงินขาด ${fmt(-diff)} บาท`, amount: diff });
    if (hasAfter && diff > 0) issues.push({ kind: 'over', text: `เงินเกิน ${fmt(diff)} บาท`, amount: diff });
    if (prevLeft) {
      rows.forEach(r => {
        const p = prevLeft[r.item];
        if (p === undefined || p === r.old) return;
        issues.push({ kind: 'carry', item: r.item,
          text: p > r.old ? `${r.item}: ของเดิมหายไป ${p - r.old} ชิ้น (เมื่อวานเหลือ ${p} วันนี้กรอก ${r.old})`
                          : `${r.item}: ของเดิมเกินมา ${r.old - p} ชิ้น (เมื่อวานเหลือ ${p} วันนี้กรอก ${r.old})` });
      });
    }
    return { date: day.date, rows, hasBefore, hasAfter, units, expected, received, diff,
             cash: m.cash, transfer: m.transfer, thai: m.thai, expense: m.expense,
             expenses: m.expenses || [], issues };
  }

  /** ทั้งช่วงจากผลของ api report — คิดของเดิมเทียบกับคงเหลือวันก่อนหน้าให้ด้วย */
  function computeAll(rep) {
    let prev = rep.prevLeft ? rep.prevLeft.left : null;
    return rep.days.map(d => {
      const c = computeDay(d, prev);
      if (c.rows.length && c.rows.every(r => r.left !== null)) {
        prev = {};
        c.rows.forEach(r => { prev[r.item] = r.left; });
      }
      return c;
    });
  }

  /** รวมยอดหลายวัน (เฉพาะวันที่อยู่ใน from..to) */
  function totals(days, from, to) {
    const ds = days.filter(d => d.date >= from && d.date <= to);
    const done = ds.filter(d => d.hasAfter);
    const byItem = {};
    done.forEach(d => d.rows.forEach(r => {
      const b = byItem[r.item] = byItem[r.item] || { item: r.item, sold: 0, value: 0 };
      b.sold += r.sold; b.value += r.value;
    }));
    return {
      from, to, days: ds.length, doneDays: done.length,
      received: r2(sum(done, d => d.received)),
      expected: r2(sum(done, d => d.expected)),
      diff: r2(sum(done, d => d.diff)),
      cash: r2(sum(done, d => d.cash)), transfer: r2(sum(done, d => d.transfer)),
      thai: r2(sum(done, d => d.thai)), expense: r2(sum(done, d => d.expense)),
      units: sum(done, d => d.units), byItem: Object.values(byItem),
      issues: sum(ds, d => d.issues.filter(i => i.kind !== 'missing').length)
    };
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  }

  /* ── วันที่ (yyyy-MM-dd ตามเวลาเครื่อง) ── */
  const pad = n => String(n).padStart(2, '0');
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return key(d); };
  /** สัปดาห์เริ่มวันจันทร์ */
  const weekStart = k => { const d = parse(k); return addDays(k, -((d.getDay() + 6) % 7)); };
  const monthStart = k => k.slice(0, 8) + '01';
  const monthEnd = k => { const d = parse(monthStart(k)); d.setMonth(d.getMonth() + 1); d.setDate(0); return key(d); };

  const api = { computeDay, computeAll, totals, fmt,
                date: { key, parse, addDays, weekStart, monthStart, monthEnd, today: () => key(new Date()) } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Report = api;
})(this);
