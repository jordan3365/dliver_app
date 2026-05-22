/**
 * 착한식판 통합 배송관리 시스템 - Google Apps Script (백엔드) v2.0
 * [최적화 내역]
 * - 읽기 요청(getDeliveryList, getDrivers, getNotices): CacheService 5초 캐시 적용
 * - 쓰기 요청: 전역 ScriptLock → 경량 UserLock으로 교체 (대기시간 10초)
 * - updateCourseStatus, resetAllDeliveryStatus: 셀별 setValue 루프 → setValues 일괄처리
 * - assignRoutes, updateDeliveryPlace: 다중 getRange().setValue() → 단일 setValues() 변환
 */

function hashPassword(password) {
  if (!password) return '';
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password), Utilities.Charset.UTF_8);
  let hexString = '';
  for (let i = 0; i < digest.length; i++) {
    let byteVal = digest[i];
    if (byteVal < 0) byteVal += 256;
    let byteString = byteVal.toString(16);
    if (byteString.length == 1) byteString = '0' + byteString;
    hexString += byteString;
  }
  return hexString;
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet1 = ss.getSheetByName('배송목록');
  if (!sheet1) sheet1 = ss.insertSheet('배송목록');
  if (sheet1.getLastRow() === 0) {
    sheet1.appendRow(['배송처ID','배송처명','주소','상세주소','연락처','메모','박스수량','위도','경도','할당코스','배송순번','배송상태','첨부이미지','등록일시']);
    sheet1.getRange("A1:N1").setFontWeight("bold").setBackground("#6C5CE7").setFontColor("white");
    sheet1.setFrozenRows(1);
  }
  let sheet2 = ss.getSheetByName('기사목록');
  if (!sheet2) sheet2 = ss.insertSheet('기사목록');
  if (sheet2.getLastRow() === 0) {
    sheet2.appendRow(['기사ID','기사명','아이디','비밀번호','할당코스','연락처','등록일시']);
    sheet2.getRange("A1:G1").setFontWeight("bold").setBackground("#00CEC9").setFontColor("white");
    sheet2.setFrozenRows(1);
    sheet2.appendRow([1,'최고관리자','admin',hashPassword('admin'),'0','010-0000-0000',new Date()]);
    sheet2.appendRow([2,'김기사','driver1',hashPassword('1111'),'1','010-1111-1111',new Date()]);
    sheet2.appendRow([3,'이기사','driver2',hashPassword('1111'),'2','010-2222-2222',new Date()]);
  }
  let sheet3 = ss.getSheetByName('공지사항');
  if (!sheet3) sheet3 = ss.insertSheet('공지사항');
  if (sheet3.getLastRow() === 0) {
    sheet3.appendRow(['공지ID','대상','내용','이미지목록','등록일시']);
    sheet3.getRange("A1:E1").setFontWeight("bold").setBackground("#FF7675").setFontColor("white");
    sheet3.setFrozenRows(1);
  }
  let sheet4 = ss.getSheetByName('실시간위치');
  if (!sheet4) sheet4 = ss.insertSheet('실시간위치');
  if (sheet4.getLastRow() === 0) {
    sheet4.appendRow(['코스','위도','경도','최종갱신']);
    sheet4.getRange("A1:D1").setFontWeight("bold").setBackground("#0984e3").setFontColor("white");
    sheet4.setFrozenRows(1);
  }
}

// 읽기 전용 액션 목록 (락 불필요, CacheService 적용 대상)
const READ_ACTIONS = new Set(['getDeliveryList','getDrivers','getNotices','login']);

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const data = payload.data;

    // 읽기 요청: 락 없이 즉시 처리 (속도 최우선)
    if (READ_ACTIONS.has(action)) {
      let result = {};
      if (action === 'login') result = login(data);
      else if (action === 'getDeliveryList') result = getDeliveryList(data);
      else if (action === 'getDrivers') result = getDrivers();
      else if (action === 'getNotices') result = getNotices();
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    // 쓰기 요청: UserLock으로 경량 동시성 제어 (10초 대기 → 타임아웃 대폭 감소)
    const lock = LockService.getUserLock();
    lock.waitLock(10000);
    try {
      let result = {};
      if (action === 'updateDeliveryStatus') result = updateDeliveryStatus(data);
      else if (action === 'updateCourseStatus') result = updateCourseStatus(data);
      else if (action === 'resetAllDeliveryStatus') result = resetAllDeliveryStatus();
      else if (action === 'assignRoutes') result = assignRoutes(data);
      else if (action === 'addDeliveryPlace') result = addDeliveryPlace(data);
      else if (action === 'updateDeliveryPlace') result = updateDeliveryPlace(data);
      else if (action === 'bulkAddDeliveryPlaces') result = bulkAddDeliveryPlaces(data);
      else if (action === 'addDriver') result = addDriver(data);
      else if (action === 'saveNotice') result = saveNotice(data);
      else if (action === 'deleteNotice') result = deleteNotice(data);
      else if (action === 'updateDriverLocation') result = updateDriverLocation(data);
      else if (action === 'updateBoxCount') result = updateBoxCount(data);
      else throw new Error('알 수 없는 Action: ' + action);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    } finally {
      lock.releaseLock();
    }
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function login(payload) {
  const { username, password } = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('기사목록');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('등록된 기사 정보가 없습니다.');
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const storedPw = String(row[3]);
    const inputPw = String(password);
    if (row[2] === username && (storedPw === inputPw || storedPw === hashPassword(inputPw))) {
      if (username === 'admin') {
        return { success: true, data: { role: 'admin', name: row[1], token: 'real-admin-token' } };
      } else {
        return { success: true, data: { role: 'driver', name: row[1], course: String(row[4]), token: 'real-driver-token' } };
      }
    }
  }
  throw new Error('아이디 또는 비밀번호가 일치하지 않습니다.');
}

function getDeliveryList(payload) {
  // CacheService 캐싱: 동일 요청 5초 내 재호출 시 스프레드시트 I/O 생략
  const cache = CacheService.getScriptCache();
  const cacheKey = 'deliveryList_' + (payload && payload.course ? payload.course : 'all');
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  data.shift();

  let result = [];
  data.forEach(row => {
    if (!row[0]) return;
    let images = [];
    try {
      images = row[12] ? JSON.parse(row[12]) : [];
      if (!Array.isArray(images)) images = images ? [images] : [];
    } catch (e) {
      images = row[12] ? [row[12]] : [];
    }
    let rawLat = row[7], rawLng = row[8];
    if (typeof rawLat === 'string' && (rawLat.includes(',') || rawLat.includes(' ') || rawLat.includes('\t'))) {
      const parts = rawLat.match(/-?\d+\.\d+/g);
      if (parts && parts.length >= 2) { rawLat = parts[0]; rawLng = parts[1]; }
    }
    result.push({
      id: row[0], name: row[1], address1: row[2], address2: row[3],
      phone: row[4], memo: row[5], boxCount: row[6],
      latitude: rawLat, longitude: rawLng,
      course: row[9] ? String(row[9]) : null,
      order: row[10] || null, status: row[11] || 'pending',
      deliveryPlaceImages: images
    });
  });

  if (payload && payload.course) {
    result = result.filter(r => String(r.course) === String(payload.course));
  }
  const response = { success: true, data: result };
  cache.put(cacheKey, JSON.stringify(response), 5); // 5초 캐시
  return response;
}

function updateDeliveryStatus(payload) {
  const { id, status } = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 12).setValue(status);
      // 캐시 무효화
      CacheService.getScriptCache().remove('deliveryList_all');
      return { success: true };
    }
  }
  throw new Error('배송처를 찾을 수 없습니다.');
}

function updateBoxCount(payload) {
  const { id, boxCount } = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 7).setValue(boxCount);
      CacheService.getScriptCache().remove('deliveryList_all');
      return { success: true };
    }
  }
  throw new Error('배송처를 찾을 수 없습니다.');
}

function updateCourseStatus(payload) {
  const { course, status } = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, count: 0 };
  
  const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  let updated = 0;

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][9]) === String(course) && data[i][11] !== 'done' && data[i][11] !== 'excluded') {
      data[i][11] = status;
      updated++;
    }
  }

  if (updated > 0) {
    const statusCol = data.map(r => [r[11]]);
    sheet.getRange(2, 12, data.length, 1).setValues(statusCol);
  }

  CacheService.getScriptCache().removeAll(['deliveryList_all', 'deliveryList_' + course]);
  return { success: true, count: updated };
}

function resetAllDeliveryStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('배송목록');
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    // 상태 컬럼(L열=12번째) 전체를 배열로 한 번에 덮어쓰기 (핵심 최적화)
    const count = lastRow - 1;
    const statusValues = Array.from({ length: count }, () => ['pending']);
    sheet.getRange(2, 12, count, 1).setValues(statusValues);
  }

  const locSheet = ss.getSheetByName('실시간위치');
  if (locSheet && locSheet.getLastRow() > 1) {
    locSheet.deleteRows(2, locSheet.getLastRow() - 1);
  }

  // 모든 배송 캐시 무효화
  const cache = CacheService.getScriptCache();
  cache.remove('deliveryList_all');
  cache.remove('drivers_all');
  return { success: true, count: lastRow - 1 };
}

function assignRoutes(payload) {
  const routeUpdates = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, count: 0 };

  const data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  let updated = 0;
  
  const updateMap = {};
  routeUpdates.forEach(u => updateMap[u.id] = u);

  for (let i = 0; i < data.length; i++) {
    const id = data[i][0];
    if (updateMap[id]) {
      data[i][9] = updateMap[id].course;
      data[i][10] = updateMap[id].order;
      updated++;
    }
  }

  if (updated > 0) {
    const courseOrderCol = data.map(r => [r[9], r[10]]);
    sheet.getRange(2, 10, data.length, 2).setValues(courseOrderCol);
  }

  CacheService.getScriptCache().remove('deliveryList_all');
  return { success: true, count: updated };
}

function uploadImagesToDrive(images, placeId, placeName) {
  if (!images) return [];
  if (!Array.isArray(images)) images = [images];
  if (images.length === 0) return [];
  const folderId = "1nPwkhHh2AhrfWJs2uR01j4LoUGpS3Kd2";
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    const folders = DriveApp.getFoldersByName('배송앱_이미지');
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('배송앱_이미지');
  }
  return images.map((base64, i) => {
    if (base64.startsWith('http')) return base64;
    const mime = base64.substring(base64.indexOf(':') + 1, base64.indexOf(';'));
    const base64Data = base64.substring(base64.indexOf('base64,') + 7);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mime, `${placeId}_${placeName}_${i + 1}`);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return `https://lh3.googleusercontent.com/d/${file.getId()}`;
  });
}

function addDeliveryPlace(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  const newId = data.length > 1 ? Math.max(...data.slice(1).map(r => Number(r[0]))) + 1 : 1;
  const finalImages = uploadImagesToDrive(payload.deliveryPlaceImages, newId, payload.name);
  sheet.appendRow([newId, payload.name||'', payload.address1||'', payload.address2||'', payload.phone||'', payload.memo||'', payload.boxCount||1, payload.latitude||'', payload.longitude||'', '', '', 'pending', JSON.stringify(finalImages), new Date()]);
  CacheService.getScriptCache().remove('deliveryList_all');
  return { success: true, data: { id: newId, ...payload, deliveryPlaceImages: finalImages, status: 'pending', course: null } };
}

function updateDeliveryPlace(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  const finalImages = uploadImagesToDrive(payload.deliveryPlaceImages, payload.id, payload.name);
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == payload.id) {
      const rowNum = i + 1;
      // 여러 셀을 단일 setValues 호출로 처리 (B~K열, 9개 컬럼)
      sheet.getRange(rowNum, 2, 1, 9).setValues([[
        payload.name||'', payload.address1||'', payload.address2||'',
        payload.phone||'', payload.memo||'', payload.boxCount||1,
        payload.latitude||'', payload.longitude||'',
        payload.course||''
      ]]);
      sheet.getRange(rowNum, 11).setValue(payload.order||'');
      sheet.getRange(rowNum, 13).setValue(JSON.stringify(finalImages));
      CacheService.getScriptCache().remove('deliveryList_all');
      return { success: true, data: payload };
    }
  }
  throw new Error('수정할 배송처를 찾을 수 없습니다.');
}

function bulkAddDeliveryPlaces(payload) {
  const places = payload;
  if (!places || places.length === 0) return { success: true, count: 0 };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  let currentMaxId = data.length > 1 ? Math.max(...data.slice(1).map(r => Number(r[0]))) : 0;
  const rows = places.map(p => {
    currentMaxId++;
    return [currentMaxId, p.name||'', p.address1||'', p.address2||'', p.phone||'', p.memo||'', p.boxCount||1, p.latitude||'', p.longitude||'', '', '', 'pending', p.deliveryPlaceImages ? JSON.stringify(p.deliveryPlaceImages) : '[]', new Date()];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  CacheService.getScriptCache().remove('deliveryList_all');
  return { success: true, count: rows.length };
}

function getDrivers() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('drivers_all');
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const driverSheet = ss.getSheetByName('기사목록');
  const locationSheet = ss.getSheetByName('실시간위치');
  if (!driverSheet) return { success: true, data: [] };
  const driverData = driverSheet.getDataRange().getValues();
  if (driverData.length <= 1) return { success: true, data: [] };
  driverData.shift();

  let locationMap = {};
  if (locationSheet) {
    const locationData = locationSheet.getDataRange().getValues();
    for (let i = 1; i < locationData.length; i++) {
      locationMap[String(locationData[i][0])] = { lat: locationData[i][1], lng: locationData[i][2], updated: locationData[i][3] };
    }
  }

  const result = driverData.filter(r => r[0] !== '').map(r => ({
    id: r[0], name: r[1], username: r[2], course: String(r[4]), phone: r[5],
    currentLocation: locationMap[String(r[4])] || null
  }));
  const response = { success: true, data: result };
  cache.put('drivers_all', JSON.stringify(response), 5); // 5초 캐시
  return response;
}

function updateDriverLocation(payload) {
  const { course, lat, lng } = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('실시간위치');
  const data = sheet.getDataRange().getValues();
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(course)) { foundRow = i + 1; break; }
  }
  if (foundRow > 0) {
    sheet.getRange(foundRow, 2, 1, 3).setValues([[lat, lng, new Date()]]);
  } else {
    sheet.appendRow([String(course), lat, lng, new Date()]);
  }
  // 기사 위치 업데이트 시 drivers 캐시 무효화
  CacheService.getScriptCache().remove('drivers_all');
  return { success: true };
}

function addDriver(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('기사목록');
  const data = sheet.getDataRange().getValues();
  const newId = data.length > 1 ? Math.max(...data.slice(1).map(r => Number(r[0]))) + 1 : 1;
  sheet.appendRow([newId, payload.name, payload.username, hashPassword('1111'), payload.course, payload.phone||'', new Date()]);
  return { success: true, data: { id: newId, ...payload } };
}

function getNotices() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('notices_all');
  if (cached) return JSON.parse(cached);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('공지사항');
  const data = sheet.getDataRange().getValues();
  data.shift();
  const result = data.map(r => {
    let images = [];
    try { images = r[3] ? JSON.parse(r[3]) : []; } catch(e) { images = r[3] ? [r[3]] : []; }
    return { id: r[0], target: String(r[1]), content: r[2], images, date: r[4] };
  });
  const response = { success: true, data: result };
  cache.put('notices_all', JSON.stringify(response), 5);
  return response;
}

function saveNotice(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('공지사항');
  const data = sheet.getDataRange().getValues();
  const target = String(payload.target);
  const finalImages = uploadImagesToDrive(payload.images, target, "notice");
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]) === target) sheet.deleteRow(i + 1);
  }
  sheet.appendRow([new Date().getTime(), target, payload.content, JSON.stringify(finalImages), new Date()]);
  CacheService.getScriptCache().remove('notices_all');
  return { success: true };
}

function deleteNotice(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('공지사항');
  const data = sheet.getDataRange().getValues();
  const target = String(payload.target);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]) === target) sheet.deleteRow(i + 1);
  }
  CacheService.getScriptCache().remove('notices_all');
  return { success: true };
}
