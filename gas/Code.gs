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

  let sheet5 = ss.getSheetByName('배송ETD');
  if (!sheet5) sheet5 = ss.insertSheet('배송ETD');
  if (sheet5.getLastRow() === 0) {
    sheet5.appendRow(['날짜', '보고서내용', '생성시간']);
    sheet5.getRange("A1:C1").setFontWeight("bold").setBackground("#6c5ce7").setFontColor("white");
    sheet5.setFrozenRows(1);
  }
  
  let sheetAnalytics = ss.getSheetByName('배송데이터_로그');
  if (!sheetAnalytics) sheetAnalytics = ss.insertSheet('배송데이터_로그');
  if (sheetAnalytics.getLastRow() === 0) {
    sheetAnalytics.appendRow(['일자', '요일', '차량(코스)', '총배송건수', '출발시간', '도착시간', '총소요시간', '기후및교통']);
    sheetAnalytics.getRange("A1:H1").setFontWeight("bold").setBackground("#00b894").setFontColor("white");
    sheetAnalytics.setFrozenRows(1);
  }
  let sheet6 = ss.getSheetByName('gps_logs');
  if (!sheet6) sheet6 = ss.insertSheet('gps_logs');
  if (sheet6.getLastRow() === 0) {
    sheet6.appendRow(['id','driver_id','course_id','order_id','lat','lng','speed','heading','accuracy','battery','status','created_at']);
    sheet6.getRange("A1:L1").setFontWeight("bold").setBackground("#e17055").setFontColor("white");
    sheet6.setFrozenRows(1);
  }
}

// 읽기 전용 액션 목록 (락 불필요, CacheService 적용 대상)
const READ_ACTIONS = new Set(['getDeliveryList','getDrivers','getNotices','login', 'getEtdReports', 'getGpsLogs', 'getDeliveryAnalytics']);

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
      else if (action === 'getEtdReports') result = getEtdReports();
      else if (action === 'getGpsLogs') result = getGpsLogs(data);
      else if (action === 'getDeliveryAnalytics') result = getDeliveryAnalytics(data);
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
      else if (action === 'saveGpsLog') result = saveGpsLog(data);
      else if (action === 'generateEtdReport') result = generateEtdReport();
      else if (action === 'generateDeliveryAnalytics') result = generateDeliveryAnalytics(data);
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
  const cache = CacheService.getScriptCache();
  const targetCourse = payload && payload.course ? String(payload.course) : null;
  const cacheKey = 'deliveryList_' + (targetCourse ? targetCourse : 'all');
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  data.shift();

  let result = [];
  data.forEach(row => {
    if (!row[0]) return;
    if (targetCourse && String(row[9]) !== targetCourse) return; // 최적화: 불필요한 행 파싱 생략

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
      deliveryPlaceImages: images, arrivalTime: row[13] || null
    });
  });

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
      if (status === 'done') {
        sheet.getRange(i + 1, 14).setValue(new Date().toISOString()); // 도착시간 기록
      } else if (status === 'pending') {
        sheet.getRange(i + 1, 14).setValue(''); // 취소시 초기화
      }
      const course = data[i][9];
      // 캐시 무효화: 전체 목록 및 해당 코스 목록 동시 무효화
      CacheService.getScriptCache().removeAll(['deliveryList_all', 'deliveryList_' + course]);
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
      const course = data[i][9];
      CacheService.getScriptCache().removeAll(['deliveryList_all', 'deliveryList_' + course]);
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

  let cacheKeys = ['deliveryList_all', 'drivers_all'];

  if (lastRow > 1) {
    // 고유 코스 추출하여 개별 캐시도 모두 무효화 타겟팅
    const courseData = sheet.getRange(2, 10, lastRow - 1, 1).getValues();
    const uniqueCourses = new Set();
    courseData.forEach(r => {
      if (r[0]) uniqueCourses.add('deliveryList_' + r[0]);
    });
    cacheKeys = cacheKeys.concat(Array.from(uniqueCourses));

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
  try {
    cache.removeAll(cacheKeys);
  } catch (e) {
    cache.removeAll(['deliveryList_all', 'drivers_all']); // 예비 처리
  }
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
  const coursesToClear = new Set(['deliveryList_all']);

  for (let i = 0; i < data.length; i++) {
    const id = data[i][0];
    if (updateMap[id]) {
      if (data[i][9]) coursesToClear.add('deliveryList_' + data[i][9]); // 기존 코스
      if (updateMap[id].course) coursesToClear.add('deliveryList_' + updateMap[id].course); // 새 코스
      data[i][9] = updateMap[id].course;
      data[i][10] = updateMap[id].order;
      updated++;
    }
  }

  if (updated > 0) {
    const courseOrderCol = data.map(r => [r[9], r[10]]);
    sheet.getRange(2, 10, data.length, 2).setValues(courseOrderCol);
  }

  CacheService.getScriptCache().removeAll(Array.from(coursesToClear));
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
  sheet.appendRow([newId, payload.name||'', payload.address1||'', payload.address2||'', payload.phone||'', payload.memo||'', payload.boxCount||1, payload.latitude||'', payload.longitude||'', '', '', 'pending', JSON.stringify(finalImages), '']);
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
      const oldCourse = data[i][9];
      const newCourse = payload.course || '';

      // 여러 셀을 단일 setValues 호출로 처리 (B~K열, 9개 컬럼)
      sheet.getRange(rowNum, 2, 1, 9).setValues([[
        payload.name||'', payload.address1||'', payload.address2||'',
        payload.phone||'', payload.memo||'', payload.boxCount||1,
        payload.latitude||'', payload.longitude||'',
        newCourse
      ]]);
      sheet.getRange(rowNum, 11).setValue(payload.order||'');
      sheet.getRange(rowNum, 13).setValue(JSON.stringify(finalImages));
      
      const keysToClear = ['deliveryList_all'];
      if (oldCourse) keysToClear.push('deliveryList_' + oldCourse);
      if (newCourse) keysToClear.push('deliveryList_' + newCourse);
      CacheService.getScriptCache().removeAll(keysToClear);
      
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
    return [currentMaxId, p.name||'', p.address1||'', p.address2||'', p.phone||'', p.memo||'', p.boxCount||1, p.latitude||'', p.longitude||'', '', '', 'pending', p.deliveryPlaceImages ? JSON.stringify(p.deliveryPlaceImages) : '[]', ''];
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
      locationMap[String(locationData[i][0]).trim()] = { lat: locationData[i][1], lng: locationData[i][2], updated: locationData[i][3] };
    }
  }

  const result = driverData.filter(r => r[0] !== '').map(r => ({
    id: r[0], name: r[1], username: r[2], course: String(r[4]).trim(), phone: r[5],
    currentLocation: locationMap[String(r[4]).trim()] || null
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
  const targetCourse = String(course).trim();
  
  // 성능 최적화: 중복 삭제(deleteRow)와 같은 무거운 작업을 제거하고
  // 첫 번째 발견되는 해당 차량의 행만 찾아 즉각 위도, 경도를 덮어씁니다.
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === targetCourse) {
      foundRow = i + 1;
      break;
    }
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

function saveGpsLog(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const { driver_id, course_id, order_id, lat, lng, speed, heading, accuracy, battery, status } = payload;
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('gps_logs');
    const id = new Date().getTime(); // timestamp as ID
    sheet.appendRow([id, driver_id, course_id, order_id, lat, lng, speed, heading, accuracy, battery, status, new Date().toISOString()]);
    
    // 동시에 실시간 위치 테이블도 업데이트 (기존 로직 호환 유지)
    updateDriverLocation({ course: course_id, lat, lng });
  } catch(e) {
    console.error("GPS 로깅 락 획득 실패:", e);
  } finally {
    lock.releaseLock();
  }
  return { success: true };
}

function getGpsLogs(payload) {
  const { date, course_id } = payload; // date format: YYYY-MM-DD
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('gps_logs');
  if (!sheet) return { success: true, data: [] };
  const data = sheet.getDataRange().getValues();
  data.shift(); // 헤더 제외
  
  const result = [];
  data.forEach(r => {
    if (String(r[2]) !== String(course_id)) return;
    const logDate = r[11] ? new Date(r[11]).toISOString().split('T')[0] : '';
    if (logDate === date) {
      result.push({
        id: r[0], driver_id: r[1], course_id: r[2], order_id: r[3],
        lat: r[4], lng: r[5], speed: r[6], heading: r[7],
        accuracy: r[8], battery: r[9], status: r[10], created_at: r[11]
      });
    }
  });
  return { success: true, data: result };
}

function addDriver(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('기사목록');
  const data = sheet.getDataRange().getValues();
  const newId = data.length > 1 ? Math.max(...data.slice(1).map(r => Number(r[0]))) + 1 : 1;
  sheet.appendRow([newId, payload.name, payload.username, hashPassword('1111'), payload.course, payload.phone||'', new Date()]);
  CacheService.getScriptCache().remove('drivers_all');
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

function getEtdReports() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송ETD');
  if (!sheet) return { success: true, data: [] };
  const data = sheet.getDataRange().getValues();
  data.shift(); // 헤더 제외
  const result = data.map(r => ({ date: r[0], report: r[1], createdAt: r[2] })).reverse();
  return { success: true, data: result };
}

function generateEtdReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  data.shift();
  
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  let totalDest = 0;
  let totalDone = 0;
  let driverStats = {};

  data.forEach(row => {
    if (!row[0] || !row[9] || row[11] === 'excluded') return;
    const course = String(row[9]);
    const status = row[11];
    const arrivalTimeStr = row[13];
    
    if (!driverStats[course]) driverStats[course] = { total: 0, done: 0, arrivals: [] };
    
    driverStats[course].total++;
    totalDest++;
    
    if (status === 'done') {
      driverStats[course].done++;
      totalDone++;
      if (arrivalTimeStr) {
        driverStats[course].arrivals.push(new Date(arrivalTimeStr).getTime());
      }
    }
  });

  // GPS 로그를 분석하여 공회전(Idling) 및 정체 시간 계산
  const gpsSheet = ss.getSheetByName('gps_logs');
  if (gpsSheet && gpsSheet.getLastRow() > 1) {
    const gpsData = gpsSheet.getDataRange().getValues();
    gpsData.shift();
    
    // speed < 1 인 로그 개수 집계 (1로그당 약 10초)
    gpsData.forEach(row => {
      const logDate = row[11] ? new Date(row[11]) : null;
      if (logDate && Utilities.formatDate(logDate, Session.getScriptTimeZone(), "yyyy-MM-dd") === today) {
        const dCourse = String(row[2]);
        const speed = parseFloat(row[6]) || 0;
        if (driverStats[dCourse]) {
          if (!driverStats[dCourse].idleCount) driverStats[dCourse].idleCount = 0;
          if (speed < 1) driverStats[dCourse].idleCount++;
        }
      }
    });
  }

  let reportText = `🤖 [AI 배송 ETD 분석 리포트 - ${today}]\n\n`;
  reportText += `📊 전체 요약\n`;
  reportText += `- 총 배송처: ${totalDest}곳\n`;
  reportText += `- 완료 배송처: ${totalDone}곳 (진행률: ${totalDest > 0 ? Math.round((totalDone/totalDest)*100) : 0}%)\n\n`;
  
  reportText += `🚚 차량별 배송 현황 및 ETD 분석:\n`;
  
  let bestDriver = "";
  let bestTime = Infinity;

  Object.keys(driverStats).forEach(course => {
    const stat = driverStats[course];
    reportText += `\n[${course}호차]\n- 완료 현황: ${stat.done}/${stat.total}건\n`;
    
    if (stat.arrivals.length >= 2) {
      stat.arrivals.sort();
      let totalDiff = 0;
      for (let i = 1; i < stat.arrivals.length; i++) {
        totalDiff += (stat.arrivals[i] - stat.arrivals[i-1]);
      }
      const avgMs = totalDiff / (stat.arrivals.length - 1);
      const avgMins = Math.round(avgMs / 60000);
      reportText += `- 평균 목적지 간 이동/배송 시간: 약 ${avgMins}분\n`;
      
      if (avgMins < bestTime) {
        bestTime = avgMins;
        bestDriver = course;
      }
      
      if (avgMins > 20) {
        reportText += `⚠️ 평균 배송 시간이 20분을 초과했습니다. 교통 정체 또는 배송지 대기가 원인일 수 있습니다.\n`;
      } else if (avgMins <= 10) {
        reportText += `⚡ 매우 신속한 배송이 이루어지고 있습니다!\n`;
      }
    } else if (stat.arrivals.length === 1) {
      reportText += `- 배송 시작 단계입니다.\n`;
    } else {
      reportText += `- 아직 배송 완료된 데이터가 없습니다.\n`;
    }
    
    // 공회전/휴게 시간 텔레매틱스 분석 기록
    if (stat.idleCount && stat.idleCount > 0) {
      const idleMinutes = Math.round(stat.idleCount * 10 / 60); // 10초 주기
      if (idleMinutes > 15) {
        reportText += `⚠️ 텔레매틱스 분석: 차량 정차(유휴/휴게/정체) 시간이 총 ${idleMinutes}분 감지되었습니다.\n`;
      }
    }
  });

  reportText += `\n💡 AI 인사이트:\n`;
  if (bestDriver !== "") {
    reportText += `오늘 가장 배송 효율(목적지 간 최단시간)이 좋은 차량은 **${bestDriver}호차**(평균 ${bestTime}분)입니다.\n`;
  }
  if (totalDone === totalDest && totalDest > 0) {
    reportText += `모든 배송이 성공적으로 완료되었습니다! 수고하셨습니다.`;
  } else if (totalDone < totalDest) {
    reportText += `아직 미완료된 배송처가 남아 있습니다. 끝까지 안전 운행 부탁드립니다.`;
  } else {
    reportText += `금일 등록된 배송 일정이 없습니다.`;
  }

  let etdSheet = ss.getSheetByName('배송ETD');
  if (!etdSheet) {
    etdSheet = ss.insertSheet('배송ETD');
    etdSheet.appendRow(['날짜', '보고서내용', '생성시간']);
    etdSheet.getRange("A1:C1").setFontWeight("bold").setBackground("#6c5ce7").setFontColor("white");
    etdSheet.setFrozenRows(1);
  }
  
  const etdData = etdSheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < etdData.length; i++) {
    let rowDate = etdData[i][0];
    if (rowDate instanceof Date) {
      rowDate = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    }
    if (String(rowDate) === today) {
      etdSheet.getRange(i + 1, 2).setValue(reportText);
      etdSheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      found = true;
      break;
    }
  }
  
  if (!found) {
    etdSheet.appendRow([today, reportText, new Date().toISOString()]);
  }
  
  return { success: true, data: reportText };
}

function getDeliveryAnalytics(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송데이터_로그');
  if (!sheet) return { success: true, data: [] };
  const data = sheet.getDataRange().getValues();
  data.shift(); // 헤더 제외
  const result = data.map(r => ({
    date: r[0] instanceof Date ? Utilities.formatDate(r[0], "Asia/Seoul", "yyyy-MM-dd") : r[0],
    day: r[1],
    course: r[2],
    count: r[3],
    startTime: r[4] instanceof Date ? Utilities.formatDate(r[4], "Asia/Seoul", "HH:mm") : r[4],
    endTime: r[5] instanceof Date ? Utilities.formatDate(r[5], "Asia/Seoul", "HH:mm") : r[5],
    duration: r[6],
    weatherTraffic: r[7]
  })).reverse();
  return { success: true, data: result };
}

function generateDeliveryAnalytics(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  data.shift();
  
  const todayDate = new Date();
  const todayStr = Utilities.formatDate(todayDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStr = days[todayDate.getDay()];
  
  let courseStats = {};
  
  data.forEach(row => {
    if (!row[0] || !row[9] || row[11] === 'excluded') return;
    const course = String(row[9]);
    const status = row[11];
    const arrivalTimeStr = row[13];
    
    if (!courseStats[course]) courseStats[course] = { total: 0, done: 0, times: [] };
    
    courseStats[course].total++;
    if (status === 'done') courseStats[course].done++;
    if (arrivalTimeStr) {
      courseStats[course].times.push(new Date(arrivalTimeStr));
    }
  });

  let logSheet = ss.getSheetByName('배송데이터_로그');
  if (!logSheet) {
    setupSheets(); // 안전장치
    logSheet = ss.getSheetByName('배송데이터_로그');
  }

  // 중복 생성 방지: 오늘 날짜 기록은 덮어쓰기 위해 탐색
  const logData = logSheet.getDataRange().getValues();
  
  let newRecords = [];
  
  Object.keys(courseStats).forEach(course => {
    const stat = courseStats[course];
    if (stat.total === 0 || stat.times.length === 0) return;
    
    stat.times.sort((a, b) => a - b);
    
    // 첫 배송 도착시간에서 약 20분을 뺀 시간을 출발 시간으로 추정 (가상)
    const firstTime = stat.times[0];
    const estimatedStartTime = new Date(firstTime.getTime() - 20 * 60000);
    const lastTime = stat.times[stat.times.length - 1];
    
    const diffMs = lastTime - estimatedStartTime;
    const diffMins = Math.round(diffMs / 60000);
    
    const startStr = Utilities.formatDate(estimatedStartTime, Session.getScriptTimeZone(), "HH:mm");
    const endStr = Utilities.formatDate(lastTime, Session.getScriptTimeZone(), "HH:mm");
    
    let weatherTraffic = "정상/원활";
    if (diffMins > stat.total * 20) {
      weatherTraffic = "지연 (우천/정체 의심)";
    } else if (diffMins < stat.total * 10) {
      weatherTraffic = "매우 원활";
    }

    const rowData = [todayStr, dayStr, course, stat.total, startStr, endStr, diffMins + "분", weatherTraffic];
    
    let foundRow = -1;
    for (let i = 1; i < logData.length; i++) {
      if (String(logData[i][0]) === todayStr && String(logData[i][2]) === course) {
        foundRow = i + 1;
        break;
      }
    }
    
    if (foundRow > 0) {
      logSheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      newRecords.push(rowData);
    }
  });
  
  if (newRecords.length > 0) {
    logSheet.getRange(logSheet.getLastRow() + 1, 1, newRecords.length, newRecords[0].length).setValues(newRecords);
  }
  
  return { success: true };
}
