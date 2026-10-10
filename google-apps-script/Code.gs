/**
 * หลังบ้านร้านขนม — เก็บข้อมูลลง Google Sheets
 *
 *   ก่อนขาย : พนักงานกรอก ของเดิม + เพิ่ม ของแต่ละรายการ
 *   หลังขาย : พนักงานกรอก คงเหลือ + เงินสด / เงินโอน / ไทยช่วยไทย + ค่าใช้จ่าย
 *   สรุป    : เจ้าของร้านดูยอด (ต้องใส่รหัส OWNER_PIN)
 *
 * วิธีติดตั้งอยู่ใน README.md ของโปรเจกต์
 *
 * ค่าใช้จ่ายจ่ายจากเงินสดเท่านั้น — เงินสดที่พนักงานกรอกคือเงินที่นับได้ "หลังจ่ายค่าใช้จ่ายแล้ว"
 * ยอดขายจริง = เงินสด + เงินโอน + ไทยช่วยไทย + ค่าใช้จ่าย
 */

/* ── รายการสินค้า + ราคา (แก้ตรงนี้ได้เลย แล้ว Deploy ใหม่) ── */
var ITEMS = [   // color = สีจุดหน้ารายการบนเว็บ
  { name: 'ไดฟุกุ ครีมนม',       price: 10, color: '#f3e3c3' },
  { name: 'ไดฟุกุ ช็อกโกแลต',     price: 10, color: '#c9a48a' },
  { name: 'ไดฟุกุ ชาเขียว',      price: 10, color: '#bcd9b0' },
  { name: 'ไดฟุกุ สตรอเบอร์รี่',   price: 10, color: '#f5bccb' },
  { name: 'ไดฟุกุ โอริโอ้',      price: 10, color: '#c8c6d3' },
  { name: 'บราวนี่',             price: 10, color: '#a98274' },
  { name: 'ทาร์ตไข่',            price: 5,  color: '#f7d98b' }
];

var TZ = 'Asia/Bangkok';
var SHEET_STOCK = 'สต็อก';
var SHEET_MONEY = 'เงิน';
var STOCK_HEADERS = ['วันที่', 'รายการ', 'ราคา', 'ของเดิม', 'เพิ่ม', 'รวมมี', 'คงเหลือ', 'ขายไป',
                     'ควรได้เงิน', 'กรอกก่อนขาย', 'กรอกหลังขาย'];
var MONEY_HEADERS = ['วันที่', 'เงินสด', 'เงินโอน', 'ไทยช่วยไทย', 'ค่าใช้จ่าย', 'รายการค่าใช้จ่าย',
                     'รวมรับ', 'ควรได้', 'ส่วนต่าง', 'กรอกเมื่อ'];

/* ── จุดเข้า ── */

function doGet() {
  return json_({ ok: true, app: 'bakery-stock' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'ข้อมูลที่ส่งมาอ่านไม่ได้' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return json_(handle_(req));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function handle_(req) {
  switch (req.action) {
    case 'items':      return { ok: true, items: ITEMS };
    case 'day':        checkStaff_(req); return getDay_(req.date);
    case 'saveBefore': checkStaff_(req); return saveBefore_(req);
    case 'saveAfter':  checkStaff_(req); return saveAfter_(req);
    case 'login':      checkOwner_(req); return { ok: true };
    case 'report':     checkOwner_(req); return report_(req.from, req.to);
  }
  return { ok: false, error: 'ไม่รู้จักคำสั่ง ' + req.action };
}

/** รันครั้งเดียวตอนติดตั้ง — สร้างชีตให้ */
function setup() {
  sheet_(SHEET_STOCK, STOCK_HEADERS);
  sheet_(SHEET_MONEY, MONEY_HEADERS);
  if (!prop_('OWNER_PIN')) {
    Logger.log('⚠️ ยังไม่ได้ตั้ง OWNER_PIN — ไปที่ ตั้งค่าโปรเจกต์ → พร็อพเพอร์ตี้ของสคริปต์');
  }
  Logger.log('✅ พร้อมใช้งาน');
}

/* ── รหัส ── */

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || '';
}

function checkStaff_(req) {
  var pin = prop_('STAFF_PIN');
  if (pin && String(req.pin || '') !== pin) throw new Error('รหัสพนักงานไม่ถูกต้อง');
}

function checkOwner_(req) {
  var pin = prop_('OWNER_PIN');
  if (!pin) throw new Error('ยังไม่ได้ตั้งรหัสเจ้าของร้าน (OWNER_PIN) ใน Apps Script');
  var cache = CacheService.getScriptCache();
  var tries = Number(cache.get('owner_fail') || 0);
  if (tries >= 5) throw new Error('ใส่รหัสผิดหลายครั้ง รอ 10 นาทีแล้วลองใหม่');
  if (String(req.pin || '') !== pin) {
    cache.put('owner_fail', String(tries + 1), 600);
    throw new Error('รหัสไม่ถูกต้อง');
  }
}

/* ── อ่าน/เขียนชีต ── */

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');   // เก็บวันที่เป็นข้อความ yyyy-MM-dd ชีตจะได้ไม่แปลงเอง
  }
  return sh;
}

function rows_(name, headers) {
  var sh = sheet_(name, headers);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, headers.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    o['วันที่'] = dateKey_(o['วันที่']);
    return o;
  });
}

function dateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').trim();
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
}

function writeRow_(sh, rowNo, values) {
  if (rowNo) sh.getRange(rowNo, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
}

/* ── ตรวจข้อมูล ── */

function checkDate_(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) throw new Error('วันที่ไม่ถูกต้อง');
  return d;
}

function count_(v, label) {
  var n = Number(v);
  if (v === '' || v === null || v === undefined || !isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error('กรอก ' + label + ' เป็นจำนวนเต็มไม่ติดลบ');
  }
  return n;
}

function money_(v, label) {
  var n = Number(v);
  if (v === '' || v === null || v === undefined || !isFinite(n) || n < 0) {
    throw new Error('กรอก ' + label + ' ให้ถูกต้อง (ถ้าไม่มีใส่ 0)');
  }
  return Math.round(n * 100) / 100;
}

/** แปลง rows ที่ส่งมาเป็น map ตามชื่อ — ต้องครบทุกรายการ */
function byItem_(rows) {
  var m = {};
  (rows || []).forEach(function (r) { m[r.item] = r; });
  ITEMS.forEach(function (it) {
    if (!m[it.name]) throw new Error('ยังไม่ได้กรอก ' + it.name);
  });
  return m;
}

/* ── พนักงาน ── */

/** ข้อมูลวันที่เลือก + ของเดิมที่แนะนำ (= คงเหลือของวันล่าสุดก่อนหน้า) */
function getDay_(date) {
  checkDate_(date);
  var stock = rows_(SHEET_STOCK, STOCK_HEADERS);
  var today = stock.filter(function (r) { return r['วันที่'] === date; });
  var prev = lastLeft_(stock, date);
  var before = null, after = null;
  if (today.length) {
    before = {};
    today.forEach(function (r) { before[r['รายการ']] = { old: r['ของเดิม'], add: r['เพิ่ม'] }; });
    if (today.every(function (r) { return r['คงเหลือ'] !== ''; })) {
      after = { rows: {} };
      today.forEach(function (r) { after.rows[r['รายการ']] = r['คงเหลือ']; });
      var m = rows_(SHEET_MONEY, MONEY_HEADERS).filter(function (r) { return r['วันที่'] === date; })[0];
      if (m) {
        after.cash = m['เงินสด']; after.transfer = m['เงินโอน']; after.thai = m['ไทยช่วยไทย'];
        after.expenses = parseExpenses_(m['รายการค่าใช้จ่าย'], m['ค่าใช้จ่าย']);
      }
    }
  }
  return { ok: true, items: ITEMS, date: date, before: before, after: after,
           suggestOld: prev ? prev.left : null, suggestFrom: prev ? prev.date : null };
}

/** คงเหลือของวันล่าสุดที่กรอกหลังขายแล้ว ก่อนวันที่กำหนด */
function lastLeft_(stock, date) {
  var byDate = {};
  stock.forEach(function (r) {
    if (r['วันที่'] >= date) return;
    (byDate[r['วันที่']] = byDate[r['วันที่']] || []).push(r);
  });
  var dates = Object.keys(byDate).sort().reverse();
  for (var i = 0; i < dates.length; i++) {
    var rs = byDate[dates[i]];
    if (rs.every(function (r) { return r['คงเหลือ'] !== ''; })) {
      var left = {};
      rs.forEach(function (r) { left[r['รายการ']] = Number(r['คงเหลือ']); });
      return { date: dates[i], left: left };
    }
  }
  return null;
}

function parseExpenses_(text, total) {
  var list = String(text || '').split(/[,+]/).map(function (s) { return Number(s.trim()); })
    .filter(function (n) { return isFinite(n) && n > 0; });
  if (!list.length && Number(total) > 0) list = [Number(total)];
  return list;
}

function saveBefore_(req) {
  var date = checkDate_(req.date);
  var m = byItem_(req.rows);
  var sh = sheet_(SHEET_STOCK, STOCK_HEADERS);
  var existing = {};
  rows_(SHEET_STOCK, STOCK_HEADERS).forEach(function (r) {
    if (r['วันที่'] === date) existing[r['รายการ']] = r;
  });
  var t = now_();
  ITEMS.forEach(function (it) {
    var old = count_(m[it.name].old, 'ของเดิม ' + it.name);
    var add = count_(m[it.name].add, 'เพิ่ม ' + it.name);
    var ex = existing[it.name];
    var left = ex ? ex['คงเหลือ'] : '';
    var total = old + add;
    if (left !== '' && Number(left) > total) left = '';   // แก้ก่อนขายจนน้อยกว่าคงเหลือ → ต้องกรอกหลังขายใหม่
    var sold = left === '' ? '' : total - Number(left);
    writeRow_(sh, ex && ex._row, [date, it.name, it.price, old, add, total, left, sold,
      sold === '' ? '' : sold * it.price, t, ex ? ex['กรอกหลังขาย'] : '']);
  });
  if (Object.keys(existing).length) refreshMoney_(date);
  return { ok: true };
}

function saveAfter_(req) {
  var date = checkDate_(req.date);
  var m = byItem_(req.rows);
  var existing = {};
  rows_(SHEET_STOCK, STOCK_HEADERS).forEach(function (r) {
    if (r['วันที่'] === date) existing[r['รายการ']] = r;
  });
  if (!Object.keys(existing).length) throw new Error('ยังไม่ได้กรอก "ก่อนขาย" ของวันนี้');

  var cash = money_(req.cash, 'เงินสด');
  var transfer = money_(req.transfer, 'เงินโอน');
  var thai = money_(req.thai, 'ไทยช่วยไทย');
  var expenses = (req.expenses || []).map(function (v) { return money_(v, 'ค่าใช้จ่าย'); })
    .filter(function (n) { return n > 0; });

  var sh = sheet_(SHEET_STOCK, STOCK_HEADERS);
  var t = now_();
  var rowsOut = [];
  ITEMS.forEach(function (it) {
    var ex = existing[it.name];
    var left = count_(m[it.name].left, 'คงเหลือ ' + it.name);
    var old = ex ? Number(ex['ของเดิม']) : 0, add = ex ? Number(ex['เพิ่ม']) : 0;
    var price = ex && ex['ราคา'] !== '' ? Number(ex['ราคา']) : it.price;
    if (left > old + add) throw new Error(it.name + ': คงเหลือ ' + left + ' มากกว่าที่มี ' + (old + add));
    var sold = old + add - left;
    rowsOut.push({ row: ex && ex._row, values: [date, it.name, price, old, add, old + add, left, sold,
      sold * price, ex ? ex['กรอกก่อนขาย'] : '', t] });
  });
  rowsOut.forEach(function (r) { writeRow_(sh, r.row, r.values); });

  var exp = expenses.reduce(function (a, b) { return a + b; }, 0);
  var msh = sheet_(SHEET_MONEY, MONEY_HEADERS);
  var mex = rows_(SHEET_MONEY, MONEY_HEADERS).filter(function (r) { return r['วันที่'] === date; })[0];
  writeRow_(msh, mex && mex._row, [date, cash, transfer, thai, exp, expenses.join(' + '), 0, 0, 0, t]);
  refreshMoney_(date);
  return { ok: true };   // ไม่ส่งยอดที่ควรได้กลับไปให้พนักงาน
}

/** คำนวณ รวมรับ / ควรได้ / ส่วนต่าง ในชีตเงินใหม่ (ให้เจ้าของร้านเปิดดูในชีตได้ตรงกัน) */
function refreshMoney_(date) {
  var expected = 0;
  rows_(SHEET_STOCK, STOCK_HEADERS).forEach(function (r) {
    if (r['วันที่'] === date && r['ควรได้เงิน'] !== '') expected += Number(r['ควรได้เงิน']);
  });
  var m = rows_(SHEET_MONEY, MONEY_HEADERS).filter(function (r) { return r['วันที่'] === date; })[0];
  if (!m) return;
  var received = Number(m['เงินสด']) + Number(m['เงินโอน']) + Number(m['ไทยช่วยไทย']) + Number(m['ค่าใช้จ่าย']);
  var sh = sheet_(SHEET_MONEY, MONEY_HEADERS);
  sh.getRange(m._row, 7, 1, 3).setValues([[received, expected, received - expected]]);
}

/* ── เจ้าของร้าน ── */

/** ข้อมูลดิบรายวันในช่วง from..to + คงเหลือของวันก่อนหน้า (ไว้เช็คของเดิม) */
function report_(from, to) {
  checkDate_(from); checkDate_(to);
  var stock = rows_(SHEET_STOCK, STOCK_HEADERS);
  var money = {};
  rows_(SHEET_MONEY, MONEY_HEADERS).forEach(function (r) {
    if (r['วันที่'] >= from && r['วันที่'] <= to) money[r['วันที่']] = r;
  });
  var days = {};
  stock.forEach(function (r) {
    var d = r['วันที่'];
    if (d < from || d > to) return;
    var day = days[d] = days[d] || { date: d, stock: [], money: null };
    day.stock.push({ item: r['รายการ'], price: Number(r['ราคา']), old: Number(r['ของเดิม']),
      add: Number(r['เพิ่ม']), left: r['คงเหลือ'] === '' ? null : Number(r['คงเหลือ']) });
  });
  Object.keys(money).forEach(function (d) {
    var r = money[d];
    var day = days[d] = days[d] || { date: d, stock: [], money: null };
    day.money = { cash: Number(r['เงินสด']), transfer: Number(r['เงินโอน']), thai: Number(r['ไทยช่วยไทย']),
      expense: Number(r['ค่าใช้จ่าย']), expenses: parseExpenses_(r['รายการค่าใช้จ่าย'], r['ค่าใช้จ่าย']),
      at: String(r['กรอกเมื่อ'] || '') };
  });
  var list = Object.keys(days).sort().map(function (d) { return days[d]; });
  var prev = lastLeft_(stock, from);
  return { ok: true, items: ITEMS, from: from, to: to, days: list, prevLeft: prev };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
