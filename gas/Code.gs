/**
 * 착한식판 통합 배송관리 시스템 - Google Apps Script (백엔드)
 * 스프레드시트와 연동하여 데이터베이스 역할을 수행합니다.
 * 
 * [초기 설정 방법]
 * 1. 구글 드라이브에서 새 'Google 스프레드시트'를 생성합니다.
 * 2. 상단 메뉴의 [확장 프로그램] -> [Apps Script]를 클릭합니다.
 * 3. 기존에 적혀있는 코드를 모두 지우고 이 파일의 전체 코드를 복사해서 붙여넣습니다.
 * 4. 상단의 [저장] 아이콘을 누릅니다.
 * 5. [실행] 메뉴 옆의 드롭다운에서 'setupSheets'를 선택하고 [실행] 버튼을 누릅니다. (권한 허용 창이 뜨면 고급 -> 안전하지 않음으로 이동하여 허용합니다.)
 * 6. 스프레드시트로 돌아가보면 '배송목록'과 '기사목록' 시트가 한글로 예쁘게 자동 생성된 것을 확인할 수 있습니다!
 * 7. 다시 스크립트 편집기에서 우측 상단 [배포] -> [새 배포]를 클릭합니다.
 * 8. 유형 선택(톱니바퀴) -> '웹 앱' 선택
 * 9. 설명: '배송관리 API v1', 실행 주체: '나', 액세스 권한 있는 사용자: '모든 사용자' 로 설정하고 [배포]를 클릭합니다.
 * 10. 발급된 '웹 앱 URL'을 복사하여 프론트엔드의 api.js 파일에 연동합니다.
 */

// 1. 초기 시트 및 한글 컬럼 세팅 함수
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 배송목록 시트 생성 및 헤더 세팅
  let sheet1 = ss.getSheetByName('배송목록');
  if (!sheet1) {
    sheet1 = ss.insertSheet('배송목록');
  }
  // 시트가 비어있을 때만 헤더 추가
  if (sheet1.getLastRow() === 0) {
    sheet1.appendRow(['배송처ID', '배송처명', '주소', '상세주소', '연락처', '메모', '박스수량', '위도', '경도', '할당코스', '배송순번', '배송상태', '첨부이미지', '등록일시']);
    sheet1.getRange("A1:N1").setFontWeight("bold").setBackground("#6C5CE7").setFontColor("white");
    sheet1.setFrozenRows(1);
  }
  
  // 기사목록 시트 생성 및 헤더 세팅
  let sheet2 = ss.getSheetByName('기사목록');
  if (!sheet2) {
    sheet2 = ss.insertSheet('기사목록');
  }
  // 시트가 비어있을 때만 헤더 및 기본 데이터 추가
  if (sheet2.getLastRow() === 0) {
    sheet2.appendRow(['기사ID', '기사명', '아이디', '비밀번호', '할당코스', '연락처', '등록일시']);
    sheet2.getRange("A1:G1").setFontWeight("bold").setBackground("#00CEC9").setFontColor("white");
    sheet2.setFrozenRows(1);
    
    // 기본 관리자 및 테스트 기사 세팅
    sheet2.appendRow([1, '최고관리자', 'admin', 'admin', '0', '010-0000-0000', new Date()]);
    sheet2.appendRow([2, '김기사', 'driver1', '1111', '1', '010-1111-1111', new Date()]);
    sheet2.appendRow([3, '이기사', 'driver2', '1111', '2', '010-2222-2222', new Date()]);
  }

  // 공지사항 시트 생성
  let sheet3 = ss.getSheetByName('공지사항');
  if (!sheet3) {
    sheet3 = ss.insertSheet('공지사항');
  }
  if (sheet3.getLastRow() === 0) {
    sheet3.appendRow(['공지ID', '대상', '내용', '이미지목록', '등록일시']);
    sheet3.getRange("A1:E1").setFontWeight("bold").setBackground("#FF7675").setFontColor("white");
    sheet3.setFrozenRows(1);
  }
}

// 2. API 통신 처리 (POST)
// 주의: 프론트엔드에서 fetch 시 Content-Type을 'text/plain'으로 보내야 CORS 에러가 발생하지 않습니다.
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const data = payload.data;
    
    let result = {};
    
    if (action === 'login') result = login(data);
    else if (action === 'getDeliveryList') result = getDeliveryList(data);
    else if (action === 'updateDeliveryStatus') result = updateDeliveryStatus(data);
    else if (action === 'updateCourseStatus') result = updateCourseStatus(data);
    else if (action === 'resetAllDeliveryStatus') result = resetAllDeliveryStatus();
    else if (action === 'assignRoutes') result = assignRoutes(data);
    else if (action === 'addDeliveryPlace') result = addDeliveryPlace(data);
    else if (action === 'updateDeliveryPlace') result = updateDeliveryPlace(data);
    else if (action === 'bulkAddDeliveryPlaces') result = bulkAddDeliveryPlaces(data);
    else if (action === 'getDrivers') result = getDrivers();
    else if (action === 'addDriver') result = addDriver(data);
    else if (action === 'getNotices') result = getNotices();
    else if (action === 'saveNotice') result = saveNotice(data);
    else if (action === 'deleteNotice') result = deleteNotice(data);
    else throw new Error('알 수 없는 Action 입니다.');
    
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// === 비즈니스 로직 함수 ===

function login(payload) {
  const { username, password } = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('기사목록');
  const data = sheet.getDataRange().getValues();
  data.shift(); // 헤더 제거
  
  for(let i=0; i<data.length; i++) {
    let row = data[i];
    if (row[2] === username && String(row[3]) === String(password)) {
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  data.shift(); // 헤더 제거
  
  let result = [];
  data.forEach(row => {
    if (row[0]) { // ID가 있는 정상 데이터만
      result.push({
        id: row[0],
        name: row[1],
        address1: row[2],
        address2: row[3],
        phone: row[4],
        memo: row[5],
        boxCount: row[6],
        latitude: row[7],
        longitude: row[8],
        course: row[9] ? String(row[9]) : null,
        order: row[10] || null,
        status: row[11] || 'pending',
        deliveryPlaceImages: row[12] ? JSON.parse(row[12]) : []
      });
    }
  });
  
  if (payload && payload.course) {
    result = result.filter(r => String(r.course) === String(payload.course));
  }
  return { success: true, data: result };
}

function updateDeliveryStatus(payload) {
  const { id, status } = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  
  for(let i=1; i<data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i+1, 12).setValue(status); // L열: 배송상태
      return { success: true };
    }
  }
  throw new Error('배송처를 찾을 수 없습니다.');
}

function updateCourseStatus(payload) {
  const { course, status } = payload;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  let count = 0;
  
  for(let i=1; i<data.length; i++) {
    if (String(data[i][9]) === String(course) && data[i][11] !== 'done') {
      sheet.getRange(i+1, 12).setValue(status);
      count++;
    }
  }
  return { success: true, count: count };
}

function resetAllDeliveryStatus() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  let count = 0;
  
  for(let i=1; i<data.length; i++) {
    if (data[i][0]) {
      sheet.getRange(i+1, 12).setValue('pending');
      count++;
    }
  }
  return { success: true, count: count };
}

function assignRoutes(payload) {
  const routeUpdates = payload; 
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  
  let updated = 0;
  routeUpdates.forEach(update => {
    for(let i=1; i<data.length; i++) {
      if (data[i][0] == update.id) {
        sheet.getRange(i+1, 10).setValue(update.course); // J열: 할당코스 (없으면 빈값으로 미할당 처리)
        sheet.getRange(i+1, 11).setValue(update.order);  // K열: 배송순번
        updated++;
        break;
      }
    }
  });
  return { success: true, count: updated };
}

// 구글 드라이브 이미지 업로드 헬퍼
function uploadImagesToDrive(images, placeId, placeName) {
  if (!images || images.length === 0) return [];
  const folderId = "1nPwkhHh2AhrfWJs2uR01j4LoUGpS3Kd2";
  const folder = DriveApp.getFolderById(folderId);
  let savedUrls = [];
  
  for(let i=0; i<images.length; i++) {
    let base64 = images[i];
    if (base64.startsWith('http')) {
      savedUrls.push(base64); // 기존 URL 유지
      continue;
    }
    
    let mime = base64.substring(base64.indexOf(':')+1, base64.indexOf(';'));
    let base64Data = base64.substring(base64.indexOf('base64,')+7);
    let blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mime, `${placeId}_${placeName}_${i+1}`);
    let file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // 가장 호환성이 좋은 googleusercontent URL 형식으로 저장 (미리보기 안정성 확보)
    savedUrls.push(`https://lh3.googleusercontent.com/d/${file.getId()}`);
  }
  return savedUrls;
}

function addDeliveryPlace(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  const newId = data.length > 1 ? Math.max(...data.slice(1).map(r => Number(r[0]))) + 1 : 1;
  
  // 드라이브에 이미지 저장
  const finalImages = uploadImagesToDrive(payload.deliveryPlaceImages, newId, payload.name);
  
  sheet.appendRow([
    newId,
    payload.name || '',
    payload.address1 || '',
    payload.address2 || '',
    payload.phone || '',
    payload.memo || '',
    payload.boxCount || 1,
    payload.latitude || '',
    payload.longitude || '',
    '', // 할당코스 (자동할당을 위해 빈값=미할당)
    '', // 배송순번
    'pending', // 배송상태
    JSON.stringify(finalImages),
    new Date()
  ]);
  return { success: true, data: { id: newId, ...payload, deliveryPlaceImages: finalImages, status: 'pending', course: null } };
}

function updateDeliveryPlace(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('배송목록');
  const data = sheet.getDataRange().getValues();
  const idToUpdate = payload.id;
  
  // 드라이브에 이미지 저장 (신규 업로드된 Base64만 파일로 생성됨)
  const finalImages = uploadImagesToDrive(payload.deliveryPlaceImages, idToUpdate, payload.name);
  
  for(let i=1; i<data.length; i++) {
    if (data[i][0] == idToUpdate) {
      const rowNum = i + 1;
      sheet.getRange(rowNum, 2).setValue(payload.name || '');
      sheet.getRange(rowNum, 3).setValue(payload.address1 || '');
      sheet.getRange(rowNum, 4).setValue(payload.address2 || '');
      sheet.getRange(rowNum, 5).setValue(payload.phone || '');
      sheet.getRange(rowNum, 6).setValue(payload.memo || '');
      sheet.getRange(rowNum, 7).setValue(payload.boxCount || 1);
      sheet.getRange(rowNum, 8).setValue(payload.latitude || '');
      sheet.getRange(rowNum, 9).setValue(payload.longitude || '');
      // 할당코스와 배송순번 업데이트 (모달에서 입력된 값 반영)
      sheet.getRange(rowNum, 10).setValue(payload.course || '');
      sheet.getRange(rowNum, 11).setValue(payload.order || '');
      
      sheet.getRange(rowNum, 13).setValue(JSON.stringify(finalImages));
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
    return [
      currentMaxId,
      p.name || '',
      p.address1 || '',
      p.address2 || '',
      p.phone || '',
      p.memo || '',
      p.boxCount || 1,
      p.latitude || '',
      p.longitude || '',
      '', '', 'pending',
      p.deliveryPlaceImages ? JSON.stringify(p.deliveryPlaceImages) : '[]',
      new Date()
    ];
  });
  
  // 대량 삽입을 위해 getRange -> setValues 사용 (성능 최적화)
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { success: true, count: rows.length };
}

function getDrivers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('기사목록');
  const data = sheet.getDataRange().getValues();
  data.shift();
  
  const result = data.filter(r => r[0] > 1).map(r => ({ // admin 제외
    id: r[0],
    name: r[1],
    username: r[2],
    course: String(r[4]),
    phone: r[5]
  }));
  return { success: true, data: result };
}

function addDriver(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('기사목록');
  const data = sheet.getDataRange().getValues();
  const newId = data.length > 1 ? Math.max(...data.slice(1).map(r => Number(r[0]))) + 1 : 1;
  
  sheet.appendRow([
    newId,
    payload.name,
    payload.username,
    '1111', // 초기 임시 비밀번호
    payload.course,
    payload.phone || '',
    new Date()
  ]);
  
  return { success: true, data: { id: newId, ...payload } };
}

function getNotices() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('공지사항');
  const data = sheet.getDataRange().getValues();
  data.shift();
  
  const result = data.map(r => ({
    id: r[0],
    target: String(r[1]),
    content: r[2],
    images: r[3] ? JSON.parse(r[3]) : [],
    date: r[4]
  }));
  return { success: true, data: result };
}

function saveNotice(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('공지사항');
  const data = sheet.getDataRange().getValues();
  const target = String(payload.target); // 'global' or '1', '2'...
  
  // 이미지 업로드
  const finalImages = uploadImagesToDrive(payload.images, target, "notice");
  
  // 기존 해당 타겟 공지 삭제 (하나씩만 유지)
  for(let i=data.length-1; i>=1; i--) {
    if (String(data[i][1]) === target) {
      sheet.deleteRow(i+1);
    }
  }
  
  const newId = sheet.getLastRow() > 0 ? sheet.getLastRow() + 1 : 1;
  sheet.appendRow([
    newId,
    target,
    payload.content,
    JSON.stringify(finalImages),
    new Date()
  ]);
  
  return { success: true };
}

function deleteNotice(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('공지사항');
  const data = sheet.getDataRange().getValues();
  const target = String(payload.target);
  
  for(let i=data.length-1; i>=1; i--) {
    if (String(data[i][1]) === target) {
      sheet.deleteRow(i+1);
    }
  }
  return { success: true };
}
