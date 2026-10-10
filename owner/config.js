/* ตั้งค่าเว็บเจ้าของร้าน — ใส่ API_URL เดียวกันทั้งเว็บพนักงาน (staff/config.js) และเว็บเจ้าของร้าน (owner/config.js) */
window.APP_CONFIG = {
  // ชื่อร้าน (ขึ้นหัวเว็บ)
  SHOP_NAME: 'ร้านขนม',

  // URL ของ Apps Script ที่ Deploy เป็น Web app (ลงท้ายด้วย /exec)
  // ปล่อยว่างไว้ = โหมดทดลอง ข้อมูลเก็บในเครื่องนี้เท่านั้น
  API_URL: 'https://script.google.com/macros/s/AKfycbxuIUobr34Vhi8d3bC36dYKAOp2kTjcLeuDPc1Pw4CXHGCJt5vZrWP7gCPSY8lyMZLm/exec'
};
