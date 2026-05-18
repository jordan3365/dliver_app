// api.js - 가짜 데이터 모드와 실제 통신(GAS) 모드를 스위칭할 수 있습니다.
// 실제 연동 시 아래 useMock 을 false로 변경하고 GAS_WEB_APP_URL 에 URL을 넣으세요.
// const useMock = true; 
const useMock = false ;
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzJ_pwHmm7t93cKl3fplQ_4P1g-NdEl29o661rDHRB34lS1jww3Oq8yUxYr4WcIUlmm0Q/exec".trim();

let dummyDeliveryData = [];
let dummyDrivers = [
  { id: 1, username: 'driver1', name: '김기사', course: '1', phone: '010-1111-1111' },
  { id: 2, username: 'driver2', name: '이기사', course: '2', phone: '010-2222-2222' }
];

// LocalStorage 동기화 (창 간 데이터 공유를 위함) - Mock 모드에서만 사용
function loadData() {
  if (!useMock) return;
  const localData = localStorage.getItem('dummyDeliveryData');
  if (localData) dummyDeliveryData = JSON.parse(localData);
  else {
    import('./dummyData.js').then(m => {
      dummyDeliveryData = m.default;
      saveData();
    });
  }
  const localDrivers = localStorage.getItem('dummyDrivers');
  if (localDrivers) dummyDrivers = JSON.parse(localDrivers);
  else localStorage.setItem('dummyDrivers', JSON.stringify(dummyDrivers));
}
function saveData() {
  if (!useMock) return;
  localStorage.setItem('dummyDeliveryData', JSON.stringify(dummyDeliveryData));
  localStorage.setItem('dummyDrivers', JSON.stringify(dummyDrivers));
}
loadData();

class ApiService {
  async _fetch(action, data = {}) {
    if (useMock) {
      // Mock 로직은 각 메서드 내부에서 setTimeout 으로 처리됨 (아래 코드들)
      return null;
    } else {
      // 실제 GAS 통신
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초로 연장

        const url = GAS_WEB_APP_URL + (GAS_WEB_APP_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
        const response = await fetch(url, {
          method: 'POST',
          mode: 'cors',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: action, data: data }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP 에러! 상태코드: ${response.status}`);
        }
        
        const responseText = await response.text();
        let result;
        try {
          result = JSON.parse(responseText);
        } catch (parseError) {
          console.error("JSON 파싱 에러. 응답 내용:", responseText);
          if (responseText.includes("google-signin")) {
            throw new Error("Google 로그인 세션이 만료되었습니다. GAS 웹 앱 설정을 '모든 사용자(Anyone)'로 다시 확인해주세요.");
          }
          if (responseText.includes("<!DOCTYPE html>")) {
            throw new Error("서버에서 HTML 응답이 왔습니다. GAS 웹 앱 배포가 올바른지 확인해주세요.");
          }
          throw new Error("서버 응답이 올바른 JSON 형식이 아닙니다. (GAS 웹 앱 배포 설정 확인 필요)");
        }
        
        if (!result.success) throw new Error(result.error || "알 수 없는 서버 오류");
        return result;
      } catch (e) {
        console.error(`API 통신 에러 [${action}]:`, e);
        if (e.name === 'AbortError') {
          throw new Error("서버 응답 시간이 초과되었습니다. 네트워크 상태를 확인하거나 GAS 할당량을 확인해주세요.");
        }
        if (e.message === 'Failed to fetch') {
          throw new Error("서버에 연결할 수 없습니다. 1) GAS 웹 앱 URL 확인 2) 브라우저의 CORS 제한 3) 인터넷 연결을 확인해주세요.");
        }
        throw e;
      }
    }
  }

  async login(username, password) {
    if(!useMock) return (await this._fetch('login', { username, password })).data;

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        loadData();
        if (username === 'admin' && password === 'admin') resolve({ role: 'admin', name: '최고 관리자', token: 'fake-admin' });
        else {
          const driver = dummyDrivers.find(d => d.username === username);
          if (driver && password === '1111') { // 임시 비밀번호 1111 통일
            resolve({ role: 'driver', name: driver.name, course: driver.course, token: 'fake-d' + driver.id });
          } else {
            reject(new Error('아이디 또는 비밀번호 불일치'));
          }
        }
      }, 500);
    });
  }

  async getDeliveryList(course = null) {
    if(!useMock) return (await this._fetch('getDeliveryList', { course })).data;

    return new Promise((resolve) => {
      setTimeout(() => {
        loadData();
        let data = [...dummyDeliveryData];
        if (course) data = data.filter(d => String(d.course) === String(course));
        resolve(data);
      }, 300);
    });
  }

  async updateDeliveryStatus(id, newStatus) {
    if(!useMock) return await this._fetch('updateDeliveryStatus', { id, status: newStatus });

    return new Promise((resolve) => {
      setTimeout(() => {
        loadData();
        const index = dummyDeliveryData.findIndex(d => d.id === id);
        if (index !== -1) {
          dummyDeliveryData[index].status = newStatus;
          saveData();
          resolve({ success: true, updated: dummyDeliveryData[index] });
        } else resolve({ success: false, message: 'Not found' });
      }, 300);
    });
  }
  async updateBoxCount(id, boxCount) {
    if(!useMock) return await this._fetch('updateBoxCount', { id, boxCount });
    return new Promise((resolve) => resolve({success:true}));
  }

  async updateCourseStatus(course, newStatus) {
    if(!useMock) return await this._fetch('updateCourseStatus', { course, status: newStatus });

    return new Promise((resolve) => {
      setTimeout(() => {
        loadData();
        let updatedCount = 0;
        dummyDeliveryData.forEach(d => {
          if (String(d.course) === String(course) && d.status !== 'done') {
            d.status = newStatus;
            updatedCount++;
          }
        });
        saveData();
        resolve({ success: true, count: updatedCount });
      }, 300);
    });
  }

  async resetAllDeliveryStatus() {
    if(!useMock) return await this._fetch('resetAllDeliveryStatus');

    return new Promise((resolve) => {
      setTimeout(() => {
        loadData();
        dummyDeliveryData.forEach(d => {
          if(d.id) d.status = 'pending';
        });
        saveData();
        resolve({ success: true, count: dummyDeliveryData.length });
      }, 300);
    });
  }

  async assignRoutes(routeUpdates) {
    if(!useMock) return await this._fetch('assignRoutes', routeUpdates);

    return new Promise((resolve) => {
      setTimeout(() => {
        loadData();
        routeUpdates.forEach(update => {
          const index = dummyDeliveryData.findIndex(d => d.id === update.id);
          if(index !== -1) {
            dummyDeliveryData[index].course = update.course;
            dummyDeliveryData[index].order = update.order; // 배송 순번 추가
          }
        });
        saveData();
        resolve({ success: true, count: routeUpdates.length });
      }, 500);
    });
  }

  async addDeliveryPlace(place) {
    if(!useMock) return await this._fetch('addDeliveryPlace', place);

    return new Promise((resolve) => {
      setTimeout(() => {
        loadData();
        const newId = dummyDeliveryData.length > 0 ? Math.max(...dummyDeliveryData.map(d=>d.id)) + 1 : 1;
        const newPlace = { id: newId, course: null, status: 'pending', ...place };
        dummyDeliveryData.push(newPlace);
        saveData();
        resolve({ success: true, data: newPlace });
      }, 500);
    });
  }

  async updateDeliveryPlace(place) {
    if(!useMock) return await this._fetch('updateDeliveryPlace', place);

    return new Promise((resolve) => {
      setTimeout(() => {
        loadData();
        const index = dummyDeliveryData.findIndex(d => d.id === place.id);
        if (index !== -1) {
          dummyDeliveryData[index] = { ...dummyDeliveryData[index], ...place };
          saveData();
          resolve({ success: true, data: dummyDeliveryData[index] });
        } else resolve({ success: false, message: 'Not found' });
      }, 500);
    });
  }

  async bulkAddDeliveryPlaces(places) {
    if(!useMock) return await this._fetch('bulkAddDeliveryPlaces', places);

    return new Promise((resolve) => {
      setTimeout(() => {
        loadData();
        let currentMaxId = dummyDeliveryData.length > 0 ? Math.max(...dummyDeliveryData.map(d=>d.id)) : 0;
        places.forEach(place => {
          currentMaxId++;
          dummyDeliveryData.push({ id: currentMaxId, course: null, status: 'pending', ...place });
        });
        saveData();
        resolve({ success: true, count: places.length });
      }, 800);
    });
  }

  async getDrivers() {
    if(!useMock) return (await this._fetch('getDrivers')).data;

    return new Promise(resolve => {
      setTimeout(() => {
        loadData();
        const locations = JSON.parse(localStorage.getItem('driverLocations') || '{}');
        const drivers = dummyDrivers.map(d => ({
          ...d,
          currentLocation: locations[d.course] || null
        }));
        resolve(drivers);
      }, 300);
    });
  }

  // 기사 등록
  async addDriver(driver) {
    if(!useMock) return await this._fetch('addDriver', driver);

    return new Promise(resolve => {
      setTimeout(() => {
        loadData();
        const newId = dummyDrivers.length > 0 ? Math.max(...dummyDrivers.map(d=>d.id)) + 1 : 1;
        const newDriver = { id: newId, ...driver };
        dummyDrivers.push(newDriver);
        saveData();
        resolve({ success: true, data: newDriver });
      }, 500);
    });
  }

  // 관리자 알림 전송 (LocalStorage 이벤트 용)
  sendAdminNotification(message) {
    localStorage.setItem('adminNotification', JSON.stringify({ message, time: Date.now() }));
  }

  // 공지사항 관리
  async getNotices() {
    if(!useMock) return (await this._fetch('getNotices')).data;

    return new Promise((resolve) => {
      setTimeout(() => {
        const localNotices = localStorage.getItem('dummyNotices');
        resolve({ success: true, data: localNotices ? JSON.parse(localNotices) : [] });
      }, 300);
    });
  }

  async saveNotice(target, content, images = []) {
    if(!useMock) return await this._fetch('saveNotice', { target, content, images });

    return new Promise((resolve) => {
      setTimeout(() => {
        let localNotices = JSON.parse(localStorage.getItem('dummyNotices') || '[]');
        // 기존 타겟 공지 제거
        localNotices = localNotices.filter(n => String(n.target) !== String(target));
        localNotices.push({
          id: Date.now(),
          target: String(target),
          content: content,
          images: images, // Mock에서는 base64 그대로 저장
          date: new Date()
        });
        localStorage.setItem('dummyNotices', JSON.stringify(localNotices));
        resolve({ success: true });
      }, 300);
    });
  }

  async deleteNotice(target) {
    if(!useMock) return await this._fetch('deleteNotice', { target });

    return new Promise((resolve) => {
      setTimeout(() => {
        let localNotices = JSON.parse(localStorage.getItem('dummyNotices') || '[]');
    localNotices = localNotices.filter(n => String(n.target) !== String(target));
    localStorage.setItem('dummyNotices', JSON.stringify(localNotices));
    resolve({ success: true });
  }, 300);
});
}

async updateDriverLocation(course, lat, lng) {
if(!useMock) return await this._fetch('updateDriverLocation', { course, lat, lng });

// Mock 모드에서는 로컬스토리지에 저장
return new Promise((resolve) => {
  setTimeout(() => {
    let locations = JSON.parse(localStorage.getItem('driverLocations') || '{}');
    locations[course] = { lat, lng, updated: Date.now() };
    localStorage.setItem('driverLocations', JSON.stringify(locations));
    resolve({ success: true });
  }, 100);
});
}
}

export const api = new ApiService();
