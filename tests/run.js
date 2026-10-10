/* เทสต์ในเครื่อง:  node tests/run.js
 * จำลอง Google Apps Script (ชีตเป็น array) แล้วเรียก Code.gs จริง + เช็คการคำนวณสรุปใน owner/assets/report.js */
process.env.TZ = 'Asia/Bangkok';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const Report = require('../owner/assets/report.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

/* ── ตัวจำลอง Apps Script ── */
function makeGs(props) {
  const sheets = {};
  function sheet(name) {
    const data = [];
    const s = {
      data,
      getLastRow: () => data.length,
      appendRow: r => { data.push(r.slice()); },
      setFrozenRows() {},
      getRange(a, c, nr, nc) {
        if (typeof a === 'string') return { setNumberFormat() { return this; } };
        return {
          setValues(v) { v.forEach((row, i) => { const rr = data[a - 1 + i] = data[a - 1 + i] || [];
            row.forEach((x, j) => { rr[c - 1 + j] = x; }); }); return this; },
          getValues() { const out = []; for (let i = 0; i < nr; i++) { const rr = data[a - 1 + i] || [], o = [];
            for (let j = 0; j < nc; j++) o.push(rr[c - 1 + j] === undefined ? '' : rr[c - 1 + j]); out.push(o); } return out; },
          setFontWeight() { return this; }
        };
      }
    };
    return s;
  }
  const cache = {};
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: n => sheets[n] || null,
      insertSheet: n => (sheets[n] = sheet(n))
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: (d, tz, f) => {
      const p = n => String(n).padStart(2, '0');
      return f.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
              .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes()));
    } },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8'), ctx);
  ctx.post = req => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).s);
  ctx.sheets = sheets;
  return ctx;
}

const gs = makeGs({ OWNER_PIN: '9999' });
const names = gs.ITEMS.map(i => i.name);
const before = (date, olds, adds) => gs.post({ action: 'saveBefore', date,
  rows: names.map((n, i) => ({ item: n, old: olds[i], add: adds[i] })) });
const after = (date, lefts, money) => gs.post(Object.assign({ action: 'saveAfter', date,
  rows: names.map((n, i) => ({ item: n, left: lefts[i] })) }, money));

console.log('หลังบ้าน (Code.gs)');
t('มีครบ 7 รายการ ราคาถูก', () => {
  assert.strictEqual(names.length, 7);
  assert.deepStrictEqual(Array.from(gs.ITEMS, i => i.price), [10, 10, 10, 10, 10, 10, 5]);
});
t('หลังขายก่อนกรอกก่อนขาย → ไม่ให้บันทึก', () => {
  const r = after('2026-10-05', [0, 0, 0, 0, 0, 0, 0], { cash: 0, transfer: 0, thai: 0 });
  assert.strictEqual(r.ok, false); assert.match(r.error, /ก่อนขาย/);
});
t('ก่อนขายต้องครบทุกรายการ', () => {
  const r = gs.post({ action: 'saveBefore', date: '2026-10-05', rows: [{ item: names[0], old: 1, add: 1 }] });
  assert.strictEqual(r.ok, false);
});
t('ก่อนขาย ห้ามติดลบ/ทศนิยม', () => {
  assert.strictEqual(before('2026-10-05', [-1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]).ok, false);
  assert.strictEqual(before('2026-10-05', [1.5, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]).ok, false);
});
t('บันทึกก่อนขายได้', () => {
  assert.strictEqual(before('2026-10-05', [5, 0, 0, 0, 0, 2, 0], [20, 20, 10, 10, 10, 10, 20]).ok, true);
  assert.strictEqual(gs.sheets['สต็อก'].data.length, 8);
});
t('คงเหลือมากกว่าที่มี → ไม่ให้บันทึก', () => {
  const r = after('2026-10-05', [26, 0, 0, 0, 0, 0, 0], { cash: 0, transfer: 0, thai: 0 });
  assert.strictEqual(r.ok, false); assert.match(r.error, /มากกว่าที่มี/);
});
t('ไม่กรอกเงิน → ไม่ให้บันทึก', () => {
  assert.strictEqual(after('2026-10-05', [0, 0, 0, 0, 0, 0, 0], { cash: 100 }).ok, false);
});
t('หลังขาย: ขาย 25+20+10+10+10+12 = 87 ชิ้น×10 + ทาร์ต 20×5 = 970 · ได้ 960 → ไม่บอกพนักงาน', () => {
  const r = after('2026-10-05', [0, 0, 0, 0, 0, 0, 0], { cash: 500, transfer: 300, thai: 100, expenses: [40, 20] });
  assert.deepStrictEqual(r, { ok: true });
  const m = gs.sheets['เงิน'].data[1];
  assert.deepStrictEqual(Array.from(m.slice(1, 9)), [500, 300, 100, 60, '40 + 20', 960, 970, -10]);
});
t('กรอกหลังขายซ้ำ = แก้ ไม่เพิ่มแถว', () => {
  after('2026-10-05', [0, 0, 0, 0, 0, 0, 0], { cash: 510, transfer: 300, thai: 100, expenses: [40, 20] });
  assert.strictEqual(gs.sheets['เงิน'].data.length, 2);
  assert.strictEqual(gs.sheets['สต็อก'].data.length, 8);
  assert.strictEqual(gs.sheets['เงิน'].data[1][8], 0);
});
t('วันถัดไป: ของเดิมแนะนำจากคงเหลือ', () => {
  after('2026-10-05', [3, 0, 0, 0, 0, 0, 2], { cash: 470, transfer: 300, thai: 100, expenses: [40, 20] });  // ขาย 84×10 + 18×5 = 930
  const d = gs.post({ action: 'day', date: '2026-10-07' });
  assert.strictEqual(d.suggestFrom, '2026-10-05');
  assert.strictEqual(d.suggestOld[names[0]], 3);
  assert.strictEqual(d.suggestOld[names[6]], 2);
  assert.strictEqual(d.before, null);
});
t('วันที่กรอกแล้ว โหลดกลับมาแก้ได้', () => {
  const d = gs.post({ action: 'day', date: '2026-10-05' });
  assert.strictEqual(d.before[names[0]].add, 20);
  assert.strictEqual(d.after.rows[names[0]], 3);
  assert.strictEqual(d.after.cash, 470);
  assert.deepStrictEqual(Array.from(d.after.expenses), [40, 20]);
});
t('สรุปต้องใช้รหัสเจ้าของร้าน', () => {
  assert.strictEqual(gs.post({ action: 'report', from: '2026-10-01', to: '2026-10-31' }).ok, false);
  assert.strictEqual(gs.post({ action: 'login', pin: '9999' }).ok, true);
});
t('รหัสพนักงาน (ถ้าตั้งไว้)', () => {
  const g2 = makeGs({ OWNER_PIN: '1', STAFF_PIN: '55' });
  assert.match(g2.post({ action: 'day', date: '2026-10-05' }).error, /รหัสพนักงาน/);
  assert.strictEqual(g2.post({ action: 'day', date: '2026-10-05', pin: '55' }).ok, true);
});
t('ใส่รหัสผิด 5 ครั้ง → ล็อก', () => {
  const g3 = makeGs({ OWNER_PIN: '1' });
  for (let i = 0; i < 5; i++) g3.post({ action: 'login', pin: 'x' });
  assert.match(g3.post({ action: 'login', pin: '1' }).error, /รอ 10 นาที/);
});

t('แก้ราคาใน ITEMS แล้วกรอกก่อนขายวันเก่าซ้ำ → ราคาเดิมไม่เปลี่ยน', () => {
  const g = makeGs({ OWNER_PIN: '1' });
  const nm = Array.from(g.ITEMS, i => i.name);
  const z = nm.map(() => 0);
  const rows = (k, vals) => nm.map((n, i) => ({ item: n, [k]: vals[i] }));
  g.post({ action: 'saveBefore', date: '2026-10-05', rows: nm.map((n, i) => ({ item: n, old: 0, add: i === 6 ? 30 : 0 })) });
  g.post({ action: 'saveAfter', date: '2026-10-05', rows: rows('left', nm.map((n, i) => i === 6 ? 10 : 0)), cash: 100, transfer: 0, thai: 0 });
  g.ITEMS[6].price = 6;
  const r = g.post({ action: 'saveBefore', date: '2026-10-05', rows: nm.map((n, i) => ({ item: n, old: 0, add: i === 6 ? 30 : 0 })) });
  assert.strictEqual(r.ok, true);
  const tart = g.sheets['สต็อก'].data.find(x => x[1] === nm[6]);
  assert.deepStrictEqual([tart[2], tart[8]], [5, 100]);
  assert.strictEqual(g.sheets['เงิน'].data[1][8], 0);
});
t('ลบรายการออกจาก ITEMS หลังกรอกก่อนขาย → ยังปิดยอดวันนั้นได้', () => {
  const g = makeGs({ OWNER_PIN: '1' });
  const nm = Array.from(g.ITEMS, i => i.name);
  g.post({ action: 'saveBefore', date: '2026-10-05', rows: nm.map(n => ({ item: n, old: 0, add: 2 })) });
  g.ITEMS = g.ITEMS.slice(0, 6);                       // เอาทาร์ตไข่ออก
  const r = g.post({ action: 'saveAfter', date: '2026-10-05', rows: nm.slice(0, 6).map(n => ({ item: n, left: 0 })),
                     cash: 120, transfer: 0, thai: 0 });
  assert.strictEqual(r.ok, true);
  assert.ok(g.post({ action: 'day', date: '2026-10-05' }).after, 'หลังขายต้องขึ้นว่ากรอกแล้ว');
  assert.strictEqual(g.post({ action: 'day', date: '2026-10-06' }).suggestFrom, '2026-10-05');
  const d = Report.computeAll(g.post({ action: 'report', pin: '1', from: '2026-10-01', to: '2026-10-31' }))[0];
  assert.strictEqual(d.hasAfter, true); assert.strictEqual(d.diff, 0);
});

console.log('สรุปยอด (report.js)');
before('2026-10-07', [2, 0, 0, 0, 0, 0, 2], [10, 10, 0, 0, 0, 0, 0]);   // ไดฟุกุครีมนมหายไป 1
after('2026-10-07', [0, 0, 0, 0, 0, 0, 0], { cash: 220, transfer: 0, thai: 0 });  // ควรได้ 120+100+10 = 230
before('2026-10-08', [0, 0, 0, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0, 0]);    // ยังไม่ปิดยอด
const rep = gs.post({ action: 'report', pin: '9999', from: '2026-10-01', to: '2026-10-31' });
const days = Report.computeAll(rep);
t('ได้ 3 วัน', () => assert.deepStrictEqual(days.map(d => d.date), ['2026-10-05', '2026-10-07', '2026-10-08']));
t('5 ต.ค. ตรง', () => {
  const d = days[0];
  assert.strictEqual(d.expected, 930); assert.strictEqual(d.received, 930); assert.strictEqual(d.diff, 0);
  assert.strictEqual(d.issues.length, 0);
});
t('7 ต.ค. เงินขาด 10 + ของเดิมหายไป 1', () => {
  const d = days[1];
  assert.strictEqual(d.expected, 230); assert.strictEqual(d.diff, -10);
  assert.ok(d.issues.some(i => i.kind === 'short' && /ขาด 10/.test(i.text)));
  assert.ok(d.issues.some(i => i.kind === 'carry' && /หายไป 1/.test(i.text)));
});
t('8 ต.ค. ยังไม่ได้กรอกหลังขาย', () => {
  assert.strictEqual(days[2].hasAfter, false);
  assert.ok(days[2].issues.some(i => i.kind === 'missing'));
});
t('รวมสัปดาห์ 5–11 ต.ค. นับเฉพาะวันที่ปิดยอดแล้ว', () => {
  const w = Report.totals(days, Report.date.weekStart('2026-10-08'), '2026-10-11');
  assert.strictEqual(Report.date.weekStart('2026-10-08'), '2026-10-05');
  assert.strictEqual(w.received, 1150); assert.strictEqual(w.expected, 1160); assert.strictEqual(w.diff, -10);
  assert.strictEqual(w.expense, 60); assert.strictEqual(w.issues, 2);
});
t('วันที่: สัปดาห์เริ่มจันทร์ · สิ้นเดือน', () => {
  assert.strictEqual(Report.date.weekStart('2026-10-11'), '2026-10-05');   // อาทิตย์
  assert.strictEqual(Report.date.monthEnd('2026-02-10'), '2026-02-28');
  assert.strictEqual(Report.date.monthEnd('2026-12-31'), '2026-12-31');
});

console.log(`\n${pass} ผ่าน · ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
