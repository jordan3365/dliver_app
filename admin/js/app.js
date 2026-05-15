import { api } from '../../js/shared/api.js';

let map;
let markers = [];
let currentData = [];
let routePolylines = {}; // 코스별 폴리라인
let carMarkers = {}; // 코스별 차량 마커
let simIntervals = {}; // 코스별 시뮬레이션 인터벌
let aiTrafficInterval = null; // AI 교통 실시간 업데이트용
let dashboardPollingInterval = null; // 자동 동기화용 인터벌
let isFirstLoad = true; // 첫 로딩 여부 (자동 줌 조절용)
let livePolylines = []; // 실시간 배송 경로 선
let liveCarMarkers = []; // 실시간 차량 위치 마커
let selectedImagesBase64 = []; // 이미지 저장을 위한 배열
let alertedArrivals = new Set(); // HQ 도착 알림이 뜬 코스 저장
let prevNextDestIds = new Set(); // 이전 목적지 ID 저장
let currentDrivers = []; // 실시간 기사 위치 정보 저장용 추가

const HQ_COORD = { lat: 37.556898, lng: 127.206401 }; // 경기도 하남시 덕풍동 833-1 (현대지식산업센터 한강미사)

const COURSE_COLORS = {
  "1": "#e17055", // Red Orange
  "2": "#0984e3", // Blue
  "3": "#6c5ce7", // Purple
  "4": "#00b894", // Green
  "5": "#fdcb6e", // Yellow
  "6": "#e84393", // Pink
  "7": "#00cec9", // Teal
  "8": "#d63031"  // Dark Red
};

function getCourseColor(course) {
  return COURSE_COLORS[String(course)] || "#2d3436"; // Default dark grey
}

// 구글 드라이브 URL을 직접 미리보기 가능한 URL로 변환하는 유틸리티 (더 강력한 버전)
function getDirectImageUrl(url) {
  if (!url) return '';
  // 데이터 스킴(Base64)은 그대로 반환
  if (url.startsWith('data:')) return url;
  
  let fileId = '';
  try {
    if (url.includes('/d/')) {
      fileId = url.split('/d/')[1].split('/')[0];
    } else if (url.includes('id=')) {
      const match = url.match(/[?&]id=([^&]+)/);
      if (match) fileId = match[1];
    }
    
    if (fileId) {
      // 가장 호환성이 좋은 googleusercontent URL 사용
      return `https://lh3.googleusercontent.com/d/${fileId}`;
    }
  } catch (e) {
    console.error('URL 변환 실패:', e);
  }
  return url;
}

// OSRM을 이용한 실제 도로 경로 좌표 획득 함수
async function getRoadPath(points) {
  if (points.length < 2) return points;
  try {
    const coords = points.map(p => `${p[1]},${p[0]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok') {
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
  } catch (e) {
    console.error('OSRM 호출 실패:', e);
  }
  return points; // 실패 시 직선 경로 반환
}

function hexToRgba(hex, alpha) {
  let r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getDist(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 999;
  const R = 6371; // km
  const dLat = (lat2-lat1) * Math.PI / 180;
  const dLon = (lon2-lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// AI 실시간 교통상황 (가상) 생성 함수 - 1분마다 상태 변동
function getAiTrafficStatus(courseId) {
  const timeBlock = Math.floor(Date.now() / (1000 * 60)); 
  const seed = (parseInt(courseId) || 1) * timeBlock;
  const rand = (seed % 100) / 100; 

  if (rand > 0.85) return { text: '정체', color: '#d63031', delay: 15 + (seed % 20) };
  if (rand > 0.6) return { text: '서행', color: '#fdcb6e', delay: 5 + (seed % 10) };
  return { text: '원활', color: '#00b894', delay: 0 };
}

// --- Custom Alert Modal Override ---
window.showAdminDialog = function(title, msg, isConfirm = false, onConfirm = null) {
  document.getElementById('adminDialogTitle').textContent = title;
  document.getElementById('adminDialogMsg').innerHTML = msg.replace(/\n/g, '<br>');
  document.getElementById('adminDialogCancel').style.display = isConfirm ? 'inline-block' : 'none';
  document.getElementById('adminDialogModal').classList.add('active');

  const btnConfirm = document.getElementById('adminDialogConfirm');
  const btnCancel = document.getElementById('adminDialogCancel');
  
  const newConfirm = btnConfirm.cloneNode(true);
  btnConfirm.parentNode.replaceChild(newConfirm, btnConfirm);
  const newCancel = btnCancel.cloneNode(true);
  btnCancel.parentNode.replaceChild(newCancel, btnCancel);

  newConfirm.addEventListener('click', () => {
    document.getElementById('adminDialogModal').classList.remove('active');
    if(onConfirm) onConfirm();
  });

  newCancel.addEventListener('click', () => {
    document.getElementById('adminDialogModal').classList.remove('active');
  });
};

window.alert = function(msg) {
  showAdminDialog('알림', msg);
};
// -----------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  let userStr = localStorage.getItem('authUser');
  
  // 세션이 없으면 자동으로 최고관리자 세션 생성 (로그인 단계 건너뛰기)
  if (!userStr || JSON.parse(userStr).role !== 'admin') {
    const defaultAdmin = { role: 'admin', name: '최고관리자', token: 'auto-login-admin' };
    localStorage.setItem('authUser', JSON.stringify(defaultAdmin));
    userStr = JSON.stringify(defaultAdmin);
  }

  const user = JSON.parse(userStr);
  document.getElementById('adminName').textContent = user.name;

  // 오늘 날짜 표시
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  if(document.getElementById('todayDate')) document.getElementById('todayDate').textContent = dateStr;

  document.getElementById('logoutBtn').addEventListener('click', (e) => {
    e.preventDefault(); localStorage.removeItem('authUser'); window.location.href = '../index.html';
  });

  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view-section');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      const targetId = 'view-' + item.dataset.target;
      views.forEach(v => v.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
      document.getElementById('topbarTitle').textContent = item.innerText;

      if (item.dataset.target === 'dashboard') {
        setTimeout(() => map.invalidateSize(), 100); 
        loadDashboardData();
      } else if (item.dataset.target === 'clients') {
        renderClientsView();
      } else if (item.dataset.target === 'routing') {
        renderRoutingView();
      } else if (item.dataset.target === 'drivers') {
        renderDriversView();
      } else if (item.dataset.target === 'notice') {
        renderNoticeView();
      }
    });
  });

  try {
    initMap();

    // Binds
    document.getElementById('autoRouteBtn').addEventListener('click', executeAutoRouting);
    document.getElementById('manualRouteBtn').addEventListener('click', executeManualRouting);
    document.getElementById('selectAllRoutes').addEventListener('change', handleSelectAll);
    
    // 자동 동기화 설정 (5초마다로 변경하여 실시간성 강화)
    if(dashboardPollingInterval) clearInterval(dashboardPollingInterval);
    dashboardPollingInterval = setInterval(() => {
      if (document.getElementById('view-dashboard').classList.contains('active')) {
        loadDashboardData();
      }
    }, 5000);
    
    // Client Modal Binds
    document.getElementById('addClientBtn').addEventListener('click', openClientModal);
    document.getElementById('closeClientModal').addEventListener('click', closeClientModal);
    document.getElementById('cancelClientModal').addEventListener('click', closeClientModal);
    document.getElementById('saveClientBtn').addEventListener('click', saveClient);
    document.getElementById('searchAddressBtn').addEventListener('click', execDaumPostcode);
    document.getElementById('clientImages').addEventListener('change', handleImagePreview);
    
    // Download Template
    document.getElementById('downloadExcelTemplateBtn').addEventListener('click', downloadExcelTemplate);

    // Driver Modal Binds
    document.getElementById('addDriverBtn').addEventListener('click', () => { document.getElementById('driverForm').reset(); document.getElementById('driverModal').classList.add('active'); });
    document.getElementById('closeDriverModal').addEventListener('click', () => document.getElementById('driverModal').classList.remove('active'));
    document.getElementById('cancelDriverModal').addEventListener('click', () => document.getElementById('driverModal').classList.remove('active'));
    document.getElementById('saveDriverBtn').addEventListener('click', saveDriver);

    // Excel Binds
    document.getElementById('uploadExcelBtn').addEventListener('click', () => document.getElementById('excelUploadInput').click());
    document.getElementById('excelUploadInput').addEventListener('change', handleExcelUpload);

    // Simulation
    document.getElementById('startSimBtn').addEventListener('click', runSimulation);

    // Notice Management
    const noticeEditor = document.getElementById('noticeEditor');
    const noticeTarget = document.getElementById('noticeTarget');

    // 이미지 붙여넣기 핸들러
    noticeEditor.addEventListener('paste', (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = document.createElement('img');
            img.src = event.target.result;
            noticeEditor.appendChild(img);
          };
          reader.readAsDataURL(blob);
        }
      }
    });

    // 이미지 드래그 & 드롭 핸들러
    noticeEditor.addEventListener('dragover', (e) => {
      e.preventDefault();
      noticeEditor.style.borderColor = 'var(--primary)';
      noticeEditor.style.backgroundColor = 'rgba(108, 92, 231, 0.05)';
    });

    noticeEditor.addEventListener('dragleave', (e) => {
      e.preventDefault();
      noticeEditor.style.borderColor = 'var(--border-color)';
      noticeEditor.style.backgroundColor = 'white';
    });

    noticeEditor.addEventListener('drop', (e) => {
      e.preventDefault();
      noticeEditor.style.borderColor = 'var(--border-color)';
      noticeEditor.style.backgroundColor = 'white';

      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = document.createElement('img');
            img.src = event.target.result;
            noticeEditor.appendChild(img);
          };
          reader.readAsDataURL(file);
        }
      }
    });

    // 타겟 변경 시 기존 공지 불러오기
    noticeTarget.addEventListener('change', async () => {
      const notices = await api.getNotices();
      const current = notices.find(n => String(n.target) === String(noticeTarget.value));
      noticeEditor.innerHTML = current ? current.content : '';
    });

    document.getElementById('saveNoticeBtn').addEventListener('click', async () => {
      const target = noticeTarget.value;
      const content = noticeEditor.innerHTML;
      
      const imgs = noticeEditor.querySelectorAll('img');
      const images = Array.from(imgs).map(img => img.src);

      document.getElementById('saveNoticeBtn').disabled = true;
      document.getElementById('saveNoticeBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 처리 중...';
      
      try {
        await api.saveNotice(target, content, images);
        showAdminDialog('저장 완료', '공지사항이 성공적으로 저장 및 전송되었습니다.');
        renderNoticeView();
      } catch(e) {
        showAdminDialog('오류', '공지사항 저장에 실패했습니다.');
      } finally {
        document.getElementById('saveNoticeBtn').disabled = false;
        document.getElementById('saveNoticeBtn').innerHTML = '<i class="fa-solid fa-paper-plane"></i> 공지사항 저장 및 전송';
      }
    });

    document.getElementById('deleteNoticeBtn').addEventListener('click', async () => {
      const target = noticeTarget.value;
      showAdminDialog('공지 삭제', '현재 선택된 대상의 공지사항을 정말 삭제하시겠습니까?', true, async () => {
        try {
          await api.deleteNotice(target);
          noticeEditor.innerHTML = '';
          showAdminDialog('삭제 완료', '공지사항이 성공적으로 삭제되었습니다.');
          renderNoticeView();
        } catch(e) {
          showAdminDialog('오류', '공지 삭제에 실패했습니다.');
        }
      });
    });

    // Reset All Status
    document.getElementById('resetAllStatusBtn').addEventListener('click', () => {
      showAdminDialog('전체 초기화', '모든 배송처의 배송상태를 "대기중"으로 완전히 초기화하시겠습니까?\n(기사앱 데이터도 즉시 동기화되어 초기화됩니다.)', true, async () => {
        try {
          const btn = document.getElementById('resetAllStatusBtn');
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 처리중';
          btn.disabled = true;
          await api.resetAllDeliveryStatus();
          api.sendAdminNotification('배송 상태가 전체 초기화되었습니다.');
          alertedArrivals.clear();
          await loadDashboardData();
          showAdminDialog('초기화 완료', '모든 배송 데이터가 "대기중" 상태로 초기화되었습니다.');
        } catch(e) {
          showAdminDialog('오류', '초기화 실패');
        } finally {
          const btn = document.getElementById('resetAllStatusBtn');
          btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> 전체 초기화';
          btn.disabled = false;
        }
      });
    });

    // HQ Arrival Alert Modal Binds
    document.getElementById('closeArrivalAlertModal').addEventListener('click', () => document.getElementById('arrivalAlertModal').classList.remove('active'));
    document.getElementById('confirmArrivalAlert').addEventListener('click', () => document.getElementById('arrivalAlertModal').classList.remove('active'));

    // Map Fullscreen Toggle
    const btnFullscreen = document.getElementById('btnFullscreenMap');
    const mapContainer = document.querySelector('.map-container');
    if (btnFullscreen && mapContainer) {
      btnFullscreen.addEventListener('click', () => {
        mapContainer.classList.toggle('fullscreen');
        if(mapContainer.classList.contains('fullscreen')) {
          btnFullscreen.innerHTML = '<i class="fa-solid fa-compress"></i> 축소화면';
          btnFullscreen.style.background = '#f1f2f6';
        } else {
          btnFullscreen.innerHTML = '<i class="fa-solid fa-expand"></i> 전체화면';
          btnFullscreen.style.background = 'white';
        }
        setTimeout(() => map.invalidateSize(), 300);
      });
    }

    // LocalStorage Event for real-time alerts
    window.addEventListener('storage', (e) => {
      if (e.key === 'adminNotification') {
        const notif = JSON.parse(e.newValue);
        showToast(notif.message);
        loadDashboardData();
      }
    });

    await loadDashboardData();
  } catch (err) {
    console.error("App initialization failed:", err);
    const errorMsg = `
      <div style="padding: 40px; text-align: center; color: var(--danger);">
        <i class="fa-solid fa-triangle-exclamation fa-3x" style="margin-bottom: 20px;"></i>
        <h2 style="margin-bottom: 10px;">앱 로딩 실패</h2>
        <p style="margin-bottom: 20px;">${err.message}</p>
        <button onclick="location.reload()" class="btn-primary">다시 시도</button>
        <button onclick="localStorage.removeItem('authUser'); location.href='../index.html'" class="btn-primary" style="background:var(--text-muted); margin-left:10px;">로그아웃 후 재로그인</button>
      </div>
    `;
    document.body.innerHTML = errorMsg;
  }
});

function initMap() {
  map = L.map('map').setView([37.4988, 127.0530], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  // 본사(출발지/도착지) 고정 마커
  const hqIcon = L.divIcon({
    className: 'map-pin',
    html: `<i class="fa-solid fa-house-flag" style="color: #6C5CE7; font-size:35px; text-shadow:0 0 5px rgba(0,0,0,0.5);"></i><span style="top:10px;">HQ</span>`,
    iconSize: [35, 45], iconAnchor: [17, 45], popupAnchor: [0, -45]
  });
  L.marker([HQ_COORD.lat, HQ_COORD.lng], {icon: hqIcon}).addTo(map)
   .bindPopup('<b>착한식판 본사</b><br>경기도 하남시 덕풍동 833-1 (출발지/도착지)');
}

async function loadDashboardData() {
  try {
    const deliveryRes = await api.getDeliveryList();
    const driverRes = await api.getDrivers();
    
    currentData = deliveryRes;
    currentDrivers = driverRes;

    renderDashboardList(currentData);
    await updateMapMarkers(currentData, currentDrivers);
    updateVehicleStatus(currentData, currentDrivers);
    
    if (aiTrafficInterval) clearInterval(aiTrafficInterval);
    aiTrafficInterval = setInterval(() => {
      if (currentData) updateVehicleStatus(currentData, currentDrivers);
    }, 60000); 

    if (document.getElementById('view-routing').classList.contains('active')) renderRoutingView();
    if (document.getElementById('view-clients').classList.contains('active')) renderClientsView();
    if (document.getElementById('view-drivers').classList.contains('active')) renderDriversView();
  } catch (error) {
    console.error('데이터 로딩 중 오류:', error);
    const listEl = document.getElementById('deliveryList');
    if (listEl) {
      listEl.innerHTML = `<li style="text-align:center; color:var(--danger); padding:20px;">
        <i class="fa-solid fa-triangle-exclamation"></i> 데이터 로딩 실패<br>
        <small style="display:block; margin-top:5px; color:#999;">${error.message || '네트워크 상태를 확인해주세요.'}</small>
      </li>`;
    }
    const statusEl = document.getElementById('vehicleStatus');
    if (statusEl) statusEl.innerHTML = '<div style="text-align:center; color:var(--danger); padding:10px;">데이터를 불러올 수 없습니다.</div>';
  }
}

function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fa-solid fa-bell"></i> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 5000);
}

function renderDashboardList(data) {
  const listEl = document.getElementById('deliveryList');
  listEl.innerHTML = '';
  const activeDeliveries = data.filter(d => d.course && d.course !== "").sort((a,b)=> {
    const courseA = parseInt(a.course) || 0;
    const courseB = parseInt(b.course) || 0;
    if (courseA !== courseB) return courseA - courseB;
    return (a.order || 0) - (b.order || 0);
  });

  if (activeDeliveries.length === 0) {
    listEl.innerHTML = '<li style="text-align:center; color:#999;">할당된 데이터가 없습니다.</li>';
    return;
  }

  activeDeliveries.forEach(item => {
    const li = document.createElement('li');
    li.className = 'delivery-item animate-fade-in';
    
    const baseColor = getCourseColor(item.course);
    li.style.cssText = `
      background-color: ${hexToRgba(baseColor, 0.03)};
      border-left: 4px solid ${baseColor};
      padding: 8px 12px;
      margin-bottom: 6px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 3px;
    `;
    
    let isExcluded = item.status === 'excluded';
    let badgeHtml = isExcluded ? '<span class="badge" style="background:#eee; color:#999; font-size:0.7rem;">제외</span>' : 
                    (item.status === 'done' ? '<span class="badge badge-done" style="font-size:0.7rem;">완료</span>' : 
                    item.status === 'pending' ? '<span class="badge badge-pending" style="font-size:0.7rem;">대기</span>' : 
                    '<span class="badge badge-delivering" style="font-size:0.7rem;">배송중</span>');

    li.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:6px; flex:1; overflow:hidden;">
          <input type="checkbox" ${isExcluded ? 'checked' : ''} 
            style="width:16px; height:16px; cursor:pointer;" 
            onclick="event.stopPropagation(); toggleExclude(${item.id}, this.checked)"
            title="배송 제외">
          <strong style="font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; ${isExcluded ? 'text-decoration:line-through; color:#bbb;' : ''}">
            ${item.order ? item.order+'.' : ''} ${item.name}
          </strong>
        </div>
        ${badgeHtml}
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); margin-left: 22px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; ${isExcluded ? 'text-decoration:line-through; opacity:0.5;' : ''}">
        [${item.course}호차] ${item.address1}
      </div>
    `;
    li.addEventListener('click', () => {
      map.setView([item.latitude, item.longitude], 16);
      markers.forEach(m => {
        if(m.options.title === String(item.id)) m.openPopup();
      });
    });
    listEl.appendChild(li);
  });
}

async function updateMapMarkers(data, drivers = []) {
  // 기존 마커 및 경로 제거
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  livePolylines.forEach(p => map.removeLayer(p));
  liveCarMarkers.forEach(m => map.removeLayer(m));
  livePolylines = [];
  liveCarMarkers = [];

  const bounds = [[HQ_COORD.lat, HQ_COORD.lng]];
  const coursePaths = {}; // 코스별 경로 좌표 수집

  // 코스별 다음 목적지(Next Destination) ID 추출
  const activeData = data.filter(d => d.course !== null && d.status !== 'done');
  const nextDestIds = new Set();
  const courses = [...new Set(activeData.map(d => d.course))];
  
  courses.forEach(c => {
    const courseItems = activeData.filter(d => d.course === c);
    courseItems.sort((a, b) => (a.order || 999) - (b.order || 999));
    if(courseItems.length > 0) {
      nextDestIds.add(courseItems[0].id);
    }
  });

  // 새로 추가된 목적지 (배송 완료 후 다음 목적지로 이동 시)
  const newlyAddedDestIds = [...nextDestIds].filter(id => !prevNextDestIds.has(id));

    data.forEach(item => {
    if (item.latitude && item.longitude && item.course) {
      if(!coursePaths[item.course]) coursePaths[item.course] = [];
      coursePaths[item.course].push(item);

      let isExcluded = item.status === 'excluded';
      let baseColor = getCourseColor(item.course);
      let pinColor = item.status === 'done' ? '#b2bec3' : (isExcluded ? '#dfe6e9' : baseColor); 
      let orderText = item.status === 'done' ? '<i class="fa-solid fa-check" style="font-size:12px;"></i>' : (isExcluded ? '<i class="fa-solid fa-xmark" style="font-size:12px;"></i>' : (item.order ? item.order : '-'));
      
      let classNames = 'map-pin';
      let isNextDest = nextDestIds.has(item.id);
      if (isNextDest) classNames += ' pin-next';

      const pinIcon = L.divIcon({
        className: classNames,
        html: `<i class="fa-solid fa-location-pin" style="color: ${pinColor}; ${item.status === 'done' || isExcluded ? 'opacity:0.6;' : ''}"></i><span style="${isExcluded ? 'color:#636e72;' : ''}">${orderText}</span>`,
        iconSize: [32, 42], iconAnchor: [16, 42], popupAnchor: [0, -42]
      });

      const marker = L.marker([item.latitude, item.longitude], {icon: pinIcon, title: String(item.id)}).addTo(map);
      
      let statusBadgeClass = item.status === 'done' ? 'badge-done' : (isExcluded ? 'badge-pending' : 'badge-pending');
      let statusLabel = item.status === 'done' ? '완료' : (isExcluded ? '제외' : '대기중');
      let statusStyle = isExcluded ? 'background:#eee; color:#999; border:1px solid #ddd;' : '';

      marker.bindPopup(`
        <div style="text-align:center; ${isExcluded ? 'opacity:0.7;' : ''}">
          <h4 style="margin:0 0 5px 0; ${isExcluded ? 'text-decoration:line-through; color:#999;' : ''}">${item.name}</h4>
          <span class="badge ${statusBadgeClass}" style="${statusStyle}">${statusLabel}</span><br>
          <small>코스: ${item.course} | 순번: ${item.order || '-'}</small><br>
          <small>${item.address1}</small>
        </div>
      `, { autoClose: false, closeOnClick: false });
      
      markers.push(marker);
      bounds.push([item.latitude, item.longitude]);

      if (isNextDest && (isFirstLoad || newlyAddedDestIds.includes(item.id))) {
        setTimeout(() => marker.openPopup(), 100);
      }
    }
  });

  // 코스별 경로 선 및 실시간 차량 위치 표시 (병렬 처리로 속도 향상)
  const courseKeys = Object.keys(coursePaths);
  const roadPathPromises = courseKeys.map(async (course) => {
    const items = coursePaths[course].sort((a,b) => (a.order || 999) - (b.order || 999));
    const rawPoints = [[HQ_COORD.lat, HQ_COORD.lng]];
    items.forEach(it => {
      if (it.latitude && it.longitude) {
        rawPoints.push([parseFloat(it.latitude), parseFloat(it.longitude)]);
      }
    });
    
    try {
      const roadPoints = await getRoadPath(rawPoints);
      return { course, items, roadPoints };
    } catch (e) {
      console.error(`${course}호차 경로 로딩 실패:`, e);
      return { course, items, roadPoints: rawPoints };
    }
  });

  const roadPathsResults = await Promise.all(roadPathPromises);

  roadPathsResults.forEach(({ course, items, roadPoints }) => {
    const color = getCourseColor(course);
    // 진한 실선으로 표시
    const poly = L.polyline(roadPoints, {color: color, weight: 6, opacity: 0.7}).addTo(map);
    livePolylines.push(poly);

    // 차량 위치 결정 (실시간 GPS 우선, 없으면 마지막 완료 지점)
    const driverInfo = drivers.find(d => String(d.course) === String(course));
    let carPos = [HQ_COORD.lat, HQ_COORD.lng];
    let isLiveGps = false;

    if (driverInfo && driverInfo.currentLocation) {
      // 실시간 GPS 사용
      carPos = [driverInfo.currentLocation.lat, driverInfo.currentLocation.lng];
      isLiveGps = true;
    } else {
      // 위치 추정 (마지막 완료 지점)
      const doneItems = items.filter(it => it.status === 'done');
      if(doneItems.length > 0) {
        const lastDone = doneItems[doneItems.length - 1];
        carPos = [lastDone.latitude, lastDone.longitude];
      }
    }

    const isActive = items.some(it => it.status === 'delivering' || it.status === 'done');
    const isAllDone = items.length > 0 && items.every(it => it.status === 'done');

    if(isActive && !isAllDone) {
      const carIcon = L.divIcon({
        className: 'live-car',
        html: `
          <div class="car-marker-container">
            <i class="fa-solid fa-truck" style="color:white; background:${color}; padding:6px; border-radius:50%; font-size:16px; border:2px solid white; box-shadow:0 0 15px ${color};"></i>
            ${isLiveGps ? '<span class="live-badge">LIVE</span>' : ''}
          </div>
        `,
        iconSize: [32, 32], iconAnchor: [16, 16]
      });
      const carMarker = L.marker(carPos, {icon: carIcon, zIndexOffset: 500}).addTo(map);
      liveCarMarkers.push(carMarker);

      // 근접 알림 체크 (다음 목적지 100m 이내 접근 시 팝업 자동 오픈)
      const nextDest = items.find(it => it.status !== 'done');
      if (nextDest) {
        const dist = getDist(carPos[0], carPos[1], nextDest.latitude, nextDest.longitude);
        if (dist <= 0.1) { // 100m 이내
          const marker = markers.find(m => m.options.title === String(nextDest.id));
          if (marker && !marker.isPopupOpen()) {
            marker.openPopup();
          }
        }
      }
    }
  });

  if (bounds.length > 1 && isFirstLoad) {
    map.fitBounds(bounds, { padding: [50, 50] });
    isFirstLoad = false;
  }
  
  // 목적지 상태 업데이트
  prevNextDestIds = nextDestIds;
}

function updateVehicleStatus(data, drivers = []) {
  const statusEl = document.getElementById('vehicleStatus');
  const activeData = data.filter(d => d.course !== null && d.course !== undefined && d.course !== "");
  const courses = [...new Set(activeData.map(d => String(d.course)))].sort((a, b) => parseInt(a) - parseInt(b));
  let html = '';

  let totalActiveDrivers = 0;
  let arrivedDriversCount = 0;

  // Update Simulation Course Select
  const simSelect = document.getElementById('simCourse');
  const currentSimValue = simSelect.value;
  const newOptionsHtml = '<option value="all">전체 코스</option>' + 
    courses.map(c => `<option value="${c}">코스 ${c}</option>`).join('');
  
  if (simSelect.innerHTML !== newOptionsHtml) {
    simSelect.innerHTML = newOptionsHtml;
    if (currentSimValue && [...simSelect.options].some(o => o.value === currentSimValue)) {
      simSelect.value = currentSimValue;
    }
  }

  // 기사 목록(drivers)을 기준으로 모든 차량 표시
  drivers.forEach(driver => {
    const course = String(driver.course);
    // 제외(excluded)된 배송처는 기사별 배송현황 계산에서 완전히 제외
    const courseData = activeData.filter(d => String(d.course) === course && d.status !== 'excluded');
    if (courseData.length === 0) return;
    
    totalActiveDrivers++;
    const total = courseData.length;
    const done = courseData.filter(d => d.status === 'done').length;
    const isDeliveringNow = courseData.some(d => d.status === 'delivering');
    let statusText = done === total ? '복귀중(완료)' : (isDeliveringNow ? '배송중' : (done > 0 ? '배송중' : '운행 전'));
    let cColor = getCourseColor(course);
    let progressPct = total > 0 ? Math.round((done/total)*100) : 0;
    
    const remaining = total - done;
    const traffic = getAiTrafficStatus(course);
    let trafficHtml = '';
    
    const baseMin = remaining * 15;
    const totalMin = baseMin + (remaining === 0 ? 10 : traffic.delay); 
    let now = new Date();
    now.setMinutes(now.getMinutes() + totalMin);
    let etaTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    // 15분 전 알림 체크
    const isReturning = (done === total && total > 0);
    if (isReturning) {
      if (totalMin <= 10) arrivedDriversCount++; // 도착 임박 (초기화 트리거용)

      if (totalMin <= 15 && totalMin > 10 && !alertedArrivals.has(course)) {
        showArrivalAlert(course, etaTime);
        alertedArrivals.add(course);
      }
    }

    if (done === 0 || totalMin > 20) {
      alertedArrivals.delete(course);
    }

    if (done === total && total > 0) {
      trafficHtml = `
        <div style="margin-top:8px; padding:8px; background: rgba(0,184,148,0.1); border: 1px solid #00b894; border-radius:6px; font-size:0.85rem;">
          <div style="display:flex; justify-content:space-between; color:#00b894; align-items:center;">
            <span><i class="fa-solid fa-check-circle"></i> 배송 완료 (HQ 복귀중)</span>
            <strong style="font-size:1.1rem;">${etaTime} 도착예정</strong>
          </div>
        </div>
      `;
    } else if (total > 0) {
      trafficHtml = `
        <div style="margin-top:8px; padding:8px; background: #fff; border: 1px solid #eee; border-radius:6px; font-size:0.85rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; border-bottom:1px dashed #eee; padding-bottom:4px;">
            <span style="color:var(--text-muted);"><i class="fa-solid fa-satellite-dish" style="color:var(--primary);"></i> AI 교통 분석</span>
            <span style="color:${traffic.color}; font-weight:bold;">
              <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${traffic.color}; margin-right:4px; animation: pinBlink 1.5s infinite;"></span>
              ${traffic.text}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; color:var(--text-main); align-items:center;">
            <span>예상 복귀 시간</span>
            <strong style="font-size:1.1rem;">${etaTime} <span style="font-size:0.75rem; color:#d63031;">${traffic.delay > 0 ? '(+'+traffic.delay+'분)' : ''}</span></strong>
          </div>
        </div>
      `;
    }
    
    html += `
      <div style="background: #fafbfc; border: 1px solid var(--border-color); border-left: 6px solid ${cColor}; padding: 12px; margin-bottom: 12px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.02);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color: var(--text-main); font-size:1.05rem;">${driver.name} (${course}호차)</strong>
          <span style="background:${done === total && total > 0 ? 'var(--success)' : (isDeliveringNow ? 'var(--primary)' : (done > 0 ? 'var(--primary)' : 'var(--text-muted)'))}; color:white; padding:3px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">${statusText}</span>
        </div>
        <div style="color:var(--text-main); font-size:0.9rem; display:flex; justify-content:space-between; align-items:center;">
          <span>완료: <b>${done}</b> / ${total}건</span>
          <span style="color:var(--text-muted); font-size:0.85rem; font-weight:600;">${progressPct}%</span>
        </div>
        <div style="width:100%; background:#e9ecef; height:6px; border-radius:3px; margin-top:8px; overflow:hidden;">
          <div style="width:${progressPct}%; background:${cColor}; height:100%; transition: width 0.5s ease;"></div>
        </div>
        ${statusText === '운행 전' && total > 0 ? `
          <button onclick="adminStartCourse('${course}')" style="width:100%; margin-top:10px; padding:8px; background:var(--primary); color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">
            <i class="fa-solid fa-play"></i> 배송 출발 시키기
          </button>
        ` : ''}
        ${trafficHtml}
      </div>
    `;
  });

  // 전체 차량 도착 시 자동 초기화 실행
  if (totalActiveDrivers > 0 && totalActiveDrivers === arrivedDriversCount) {
    autoResetSystem();
  }
  
  if (currentSimValue && [...simSelect.options].some(o => o.value === currentSimValue)) {
    simSelect.value = currentSimValue;
  }
  
  statusEl.innerHTML = html || '운행 중인 차량이 없습니다.';
}

// 자동 초기화 실행 플래그 및 함수
let isAutoResetting = false;
async function autoResetSystem() {
  if (isAutoResetting) return;
  isAutoResetting = true;
  
  console.log("전체 차량 본사 도착 감지 - 시스템 자동 초기화를 진행합니다.");
  try {
    const res = await api.resetAllDeliveryStatus();
    if (res.success) {
      showToast("모든 차량 도착 - 오늘의 업무가 종료되어 시스템이 자동 초기화되었습니다.");
      alertedArrivals.clear();
      await loadDashboardData();
    }
  } catch (e) {
    console.error("자동 초기화 실패:", e);
  } finally {
    setTimeout(() => { isAutoResetting = false; }, 300000); // 5분간 재작동 방지
  }
}

window.adminStartCourse = async function(course) {
  if(!confirm(`코스 ${course}의 배송을 시작 처리하시겠습니까?`)) return;
  try {
    await api.updateCourseStatus(course, 'delivering');
    api.sendAdminNotification(`[관리자] 코스 ${course} 배송이 강제 시작되었습니다.`);
    loadDashboardData();
  } catch(e) {
    alert('배송 시작 처리 중 오류가 발생했습니다.');
  }
};

window.toggleExclude = async function(id, isChecked) {
  try {
    const item = currentData.find(d => d.id === id);
    const newStatus = isChecked ? 'excluded' : 'pending';
    await api.updateDeliveryStatus(id, newStatus);
    
    // 배송 제외 시 해당 기사에게 실시간 알림 전송 (api.saveNotice 사용)
    if (isChecked && item) {
      await api.saveNotice(String(item.course), `<strong>[배송취소 알림]</strong><br>${item.name} 배송처가 목록에서 제외되었습니다. 해당 주소는 방문하지 마세요.`, []);
    }

    await loadDashboardData();
  } catch (e) {
    console.error("toggleExclude 에러:", e);
    alert('상태 변경 중 오류가 발생했습니다.');
  }
};

function showArrivalAlert(course, eta) {
  const stack = document.getElementById('arrivalAlertStack');
  if(!stack) return;

  const courseColor = getCourseColor(course);
  const card = document.createElement('div');
  card.className = 'arrival-card traffic-blink-border';
  card.style.borderLeftColor = courseColor;
  
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong style="color:${courseColor}; font-size:1.1rem;"><i class="fa-solid fa-truck-ramp-box"></i> ${course}호차 도착 예정</strong>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none; border:none; cursor:pointer; color:#999;"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div style="font-size:1.8rem; font-weight:900; color:var(--primary); margin:5px 0;">${eta}</div>
    <div style="font-size:0.85rem; color:#d63031; font-weight:600;">하역 준비 및 다음 업무 준비</div>
  `;
  
  stack.appendChild(card);
  
  // 30초 후 자동 삭제
  setTimeout(() => {
    if(card.parentNode) card.remove();
  }, 30000);

  // 브라우저 알림 (권한 있을 경우)
  if (Notification.permission === "granted") {
    new Notification(`차량 도착 예정 - ${course}호차`, {
      body: `${eta}경 HQ에 도착할 예정입니다.`,
      icon: '../img/nav_logo.png'
    });
  }
}


// ---------------- NOTICE ----------------
async function renderNoticeView() {
  const tableBody = document.getElementById('noticeTableBody');
  if(!tableBody) return;
  
  tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> 로딩중...</td></tr>';
  
  try {
    const notices = await api.getNotices();
    tableBody.innerHTML = '';
    
    if (!notices || !Array.isArray(notices) || notices.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">등록된 공지사항이 없습니다.</td></tr>';
    } else {
      // 최신순 정렬 (날짜가 없을 경우 대비)
      notices.sort((a,b) => {
        const dateA = a.date ? new Date(a.date) : new Date(0);
        const dateB = b.date ? new Date(b.date) : new Date(0);
        return dateB - dateA;
      });
      
      notices.forEach(notice => {
        const tr = document.createElement('tr');
        const targetLabel = notice.target === 'global' ? '📢 전체 공지' : `🚚 ${notice.target}호차`;
        const dateStr = notice.date ? new Date(notice.date).toLocaleString() : '-';
        
        // 이미지 태그들에 클래스 추가하여 반응형 대응 (내용이 없을 경우 대비)
        let contentHtml = notice.content || '';
        if (contentHtml.includes('<img ')) {
          contentHtml = contentHtml.replace(/<img /g, '<img class="notice-preview-img" ');
        }

        tr.innerHTML = `
          <td><strong>${targetLabel}</strong></td>
          <td><div class="notice-content-preview">${contentHtml}</div></td>
          <td><small>${dateStr}</small></td>
          <td style="text-align:center;">
            <button class="btn-primary" style="padding:6px 12px; font-size:0.8rem;" onclick="loadNoticeToEditor('${notice.target}')">수정</button>
          </td>
        `;
        tableBody.appendChild(tr);
      });
    }

    // 에디터 초기화 (현재 선택된 타겟 기준)
    const targetSelect = document.getElementById('noticeTarget');
    const editor = document.getElementById('noticeEditor');
    if (targetSelect && editor) {
      const target = targetSelect.value;
      const current = Array.isArray(notices) ? notices.find(n => String(n.target) === String(target)) : null;
      editor.innerHTML = current ? current.content : '';
    }

  } catch(e) {
    console.error("renderNoticeView 에러:", e);
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--danger); padding:20px;">데이터를 불러오지 못했습니다.</td></tr>';
  }
}

// 테이블에서 수정 버튼 클릭 시 에디터로 로드
window.loadNoticeToEditor = function(target) {
  const targetSelect = document.getElementById('noticeTarget');
  const editor = document.getElementById('noticeEditor');
  if (targetSelect) targetSelect.value = target;
  
  // 에디터 내용을 해당 타겟 공지로 변경
  api.getNotices().then(notices => {
    if (Array.isArray(notices) && editor) {
      const current = notices.find(n => String(n.target) === String(target));
      editor.innerHTML = current ? current.content : '';
      editor.focus();
    }
  }).catch(err => console.error("loadNoticeToEditor 에러:", err));
};

// ---------------- ROUTING & SIMULATION ----------------
async function renderRoutingView() {
  const tbody = document.getElementById('routingTableBody');
  tbody.innerHTML = '';
  document.getElementById('selectAllRoutes').checked = false;
  const unassigned = currentData.filter(d => d.course === null || d.course === "");

  // Update Driver Select
  const driverSelect = document.getElementById('manualDriverSelect');
  const drivers = await api.getDrivers();
  driverSelect.innerHTML = '<option value="">코스(기사) 선택</option>';
  drivers.forEach(dr => {
    driverSelect.innerHTML += `<option value="${dr.course}">${dr.course}코스 (${dr.name})</option>`;
  });

  if (unassigned.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 30px;">현재 미할당된 배송처가 없습니다.</td></tr>';
    document.getElementById('autoRouteBtn').disabled = true;
    document.getElementById('manualRouteBtn').disabled = true;
    return;
  }
  document.getElementById('autoRouteBtn').disabled = false;
  document.getElementById('manualRouteBtn').disabled = false;

  unassigned.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="route-checkbox" data-id="${item.id}"></td>
      <td>${item.id}</td>
      <td><strong>${item.name}</strong></td>
      <td>${item.address1}</td>
      <td><span class="badge badge-pending">미할당</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function handleSelectAll(e) {
  const isChecked = e.target.checked;
  document.querySelectorAll('.route-checkbox').forEach(cb => cb.checked = isChecked);
}

// Distance util
// distance util removed (redundant)

async function executeAutoRouting() {
  const checkboxes = document.querySelectorAll('.route-checkbox:checked');
  if (checkboxes.length === 0) { alert('할당할 배송처를 선택해주세요.'); return; }

  const btn = document.getElementById('autoRouteBtn');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 계산 중...';
  btn.disabled = true;

  const routeUpdates = [];
  let c1Order = 1, c2Order = 1;

  // Simple Nearest Neighbor from HQ
  let unassigned = [];
  checkboxes.forEach(cb => {
    const id = parseInt(cb.dataset.id);
    const item = currentData.find(d => d.id === id);
    if(item) unassigned.push(item);
  });

  // 배송지들을 위도/경도 기준으로 균등하게 분할하여 할당 (K-Means 스타일의 단순 구현)
  const drivers = await api.getDrivers();
  const availableCourses = drivers.map(d => String(d.course)).filter(c => c !== "0"); // 관리자 제외
  
  if (availableCourses.length === 0) {
    alert('할당 가능한 기사(코스)가 없습니다. 기사 관리에 기사를 먼저 등록해주세요.');
    btn.innerHTML = '선택항목 자동 할당 (최적화)'; btn.disabled = false;
    return;
  }

  // 정렬 (경도 기준)
  unassigned.sort((a, b) => a.longitude - b.longitude);
  
  // 코스 개수만큼 분할
  const chunkSize = Math.ceil(unassigned.length / availableCourses.length);
  
  availableCourses.forEach((course, cIdx) => {
    let chunk = unassigned.slice(cIdx * chunkSize, (cIdx + 1) * chunkSize);
    chunk = sortNearest(chunk); // 해당 구역 내에서 최단거리 정렬
    chunk.forEach((item, idx) => {
      routeUpdates.push({ id: item.id, course: course, order: idx + 1 });
    });
  });

  try {
    const res = await api.assignRoutes(routeUpdates);
    if(res.success) {
      alert('자동 할당 및 최단거리 순번 지정 완료!');
      await loadDashboardData(); 
    }
  } catch (error) { alert('오류가 발생했습니다.'); } 
  finally { btn.innerHTML = '선택항목 자동 할당 (최적화)'; btn.disabled = false; }
}

async function executeManualRouting() {
  const checkboxes = document.querySelectorAll('.route-checkbox:checked');
  const selectedCourse = document.getElementById('manualDriverSelect').value;
  
  if (checkboxes.length === 0) { alert('할당할 배송처를 선택해주세요.'); return; }
  if (!selectedCourse) { alert('수동 할당할 코스(기사)를 선택해주세요.'); return; }

  const routeUpdates = [];
  // 현재 코스의 마지막 순번 찾기
  let maxOrder = 0;
  const courseItems = currentData.filter(d => String(d.course) === String(selectedCourse));
  if(courseItems.length > 0) maxOrder = Math.max(...courseItems.map(d => d.order || 0));

  checkboxes.forEach(cb => {
    const id = parseInt(cb.dataset.id);
    maxOrder++;
    routeUpdates.push({ id: id, course: String(selectedCourse), order: maxOrder });
  });

  try {
    const res = await api.assignRoutes(routeUpdates);
    if(res.success) {
      alert('수동 할당이 완료되었습니다.');
      await loadDashboardData();
    }
  } catch(e) { alert('할당 중 오류 발생'); }
}

// OSMR API Route Simulation - 다중 차량 동시 시뮬레이션 지원
async function runSimulation() {
  const selectedCourse = document.getElementById('simCourse').value;
  const simType = document.getElementById('simType').value;
  
  const coursesToSim = selectedCourse === 'all' 
    ? [...new Set(currentData.filter(d => d.course).map(d => String(d.course)))]
    : [selectedCourse];

  // 기존 시뮬레이션 모두 중단 및 초기화
  Object.values(simIntervals).forEach(clearInterval);
  simIntervals = {};
  Object.values(routePolylines).forEach(p => map.removeLayer(p));
  routePolylines = {};
  Object.values(carMarkers).forEach(m => map.removeLayer(m));
  carMarkers = {};
  if (window.trafficPolylines) window.trafficPolylines.forEach(p => map.removeLayer(p));
  window.trafficPolylines = [];
  
  // 시뮬레이션 알림 상태 초기화
  coursesToSim.forEach(c => alertedArrivals.delete(c + '_sim'));

  const btn = document.getElementById('startSimBtn');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  btn.disabled = true;

  try {
    const simPromises = coursesToSim.map(async (course) => {
      const courseData = currentData.filter(d => String(d.course) === String(course)).sort((a,b) => (a.order || 999) - (b.order || 999));
      if (courseData.length === 0) return;

      let coords = [`${HQ_COORD.lng},${HQ_COORD.lat}`];
      courseData.forEach(d => coords.push(`${d.longitude},${d.latitude}`));
      coords.push(`${HQ_COORD.lng},${HQ_COORD.lat}`);

      const url = `https://router.project-osrm.org/route/v1/driving/${coords.join(';')}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.code === 'Ok') {
        const routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        const courseColor = getCourseColor(course);
        
        // 경로 표시
        const poly = L.polyline(routeCoords, {color: courseColor, weight: 5, opacity: 0.6}).addTo(map);
        routePolylines[course] = poly;

        if (simType === 'ai_traffic') {
          // 트래픽 가시화 (AI 모드일 때만)
          let segmentLength = Math.max(1, Math.floor(routeCoords.length / 10));
          for (let i = 0; i < routeCoords.length - 1; i += segmentLength) {
            let chunk = routeCoords.slice(i, i + segmentLength + 1);
            let rand = Math.random();
            let color = courseColor;
            if (rand > 0.8) color = '#d63031';
            let p = L.polyline(chunk, {color: color, weight: 8, opacity: 0.4}).addTo(map);
            window.trafficPolylines.push(p);
          }
        }
        
        // 시뮬레이션 시작 시 배송 상태를 '배송중'으로 시각적 변경
        await api.updateCourseStatus(course, 'delivering');
        loadDashboardData();

        // 차량 아이콘
        const carIcon = L.divIcon({
          className: 'car-icon',
          html: `<i class="fa-solid fa-truck-fast" style="color:white; font-size:18px; background:${courseColor}; padding:6px; border-radius:50%; border:2px solid white; box-shadow:0 0 10px rgba(0,0,0,0.3);"></i>`,
          iconSize: [32, 32], iconAnchor: [16, 16]
        });
        const marker = L.marker(routeCoords[0], {icon: carIcon, zIndexOffset: 1000}).addTo(map);
        carMarkers[course] = marker;

        // 애니메이션 시작
        let i = 0;
        simIntervals[course] = setInterval(() => {
          if (i >= routeCoords.length) {
            clearInterval(simIntervals[course]);
            return;
          }
          marker.setLatLng(routeCoords[i]);
          
          // 실시간 근접 체크 (배송지 근처 통과 시 팝업 오픈)
          const courseItems = currentData.filter(d => String(d.course) === String(course) && d.status !== 'done');
          courseItems.forEach(item => {
            const dist = getDist(routeCoords[i][0], routeCoords[i][1], item.latitude, item.longitude);
            if (dist <= 0.1) { // 100m 이내
              const pinMarker = markers.find(m => m.options.title === String(item.id));
              if (pinMarker && !pinMarker.isPopupOpen()) {
                pinMarker.openPopup();
              }
            }
          });
          
          // 시뮬레이션 중 HQ 도착 알림 (마지막 지점 근처일 때)
          const distToHQ = getDist(routeCoords[i][0], routeCoords[i][1], HQ_COORD.lat, HQ_COORD.lng);
          if (i > routeCoords.length * 0.7 && distToHQ < 2.0 && !alertedArrivals.has(course + '_sim')) {
            showArrivalAlert(course, '시뮬레이션 도착 예정');
            alertedArrivals.add(course + '_sim');
          }

          i += 2;
        }, 50);
      }
    });

    await Promise.all(simPromises);

    // 전체 경로가 보이도록 줌 조정
    const allCoords = Object.values(routePolylines).flatMap(p => p.getLatLngs());
    if(allCoords.length > 0) map.fitBounds(L.latLngBounds(allCoords), {padding: [50, 50]});

  } catch(e) {
    console.error(e);
    showAdminDialog('오류', '시뮬레이션 실행 중 오류가 발생했습니다.');
  } finally {
    btn.innerHTML = '실행';
    btn.disabled = false;
  }
}

// ---------------- CLIENTS EXCEL & MODAL ----------------
function renderClientsView() {
  const tbody = document.getElementById('clientsTableBody');
  tbody.innerHTML = '';
  if(currentData.length === 0) return;

  currentData.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.id}</td>
      <td><strong>${item.name}</strong></td>
      <td>${item.address1} ${item.address2 || ''}</td>
      <td>${item.phone}</td>
      <td>${item.memo || '-'}</td>
      <td><button class="btn-primary" style="padding: 4px 8px; font-size: 0.8rem; background: var(--secondary);" onclick="openEditClientModal(${item.id})">수정</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function downloadExcelTemplate() {
  const ws = XLSX.utils.json_to_sheet([{ "배송처명": "", "주소": "", "상세주소": "", "연락처": "", "메모": "", "수량": "1" }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "템플릿");
  XLSX.writeFile(wb, "착한식판_거래처_대량업로드_템플릿.xlsx");
}

function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, {type: 'array'});
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);
      
      // 엑셀 양식 매핑 로직 (배송처명, 주소, 연락처 등)
      const mappedData = jsonData.map(row => ({
        name: row['배송처명'] || row['이름'] || '이름없음',
        address1: row['주소'] || row['도로명주소'] || '',
        phone: row['연락처'] || row['전화번호'] || '',
        memo: row['메모'] || '',
        boxCount: parseInt(row['수량']) || 1,
        // 가짜 위경도 (실제로는 서버에서 Geocoding 필요)
        latitude: 37.5 + (Math.random() * 0.1),
        longitude: 127.0 + (Math.random() * 0.2)
      })).filter(d => d.name !== '이름없음' && d.address1 !== '');

      if(mappedData.length === 0) { alert('유효한 데이터가 없습니다. 엑셀 헤더(배송처명, 주소)를 확인해주세요.'); return; }

      const res = await api.bulkAddDeliveryPlaces(mappedData);
      if(res.success) {
        alert(`${res.count}개의 거래처가 성공적으로 대량 업로드 되었습니다.`);
        await loadDashboardData();
      }
    } catch(err) {
      alert('엑셀 파일 처리 중 오류가 발생했습니다.');
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ... Client Modal logic (Same as before)
function openClientModal() {
  document.getElementById('clientModalTitle').textContent = '신규 거래처 등록';
  document.getElementById('editClientId').value = '';
  document.getElementById('clientForm').reset();
  document.getElementById('clientLat').value = '';
  document.getElementById('clientLng').value = '';
  document.getElementById('clientCourse').value = '';
  document.getElementById('clientOrder').value = '';
  document.getElementById('imagePreviewContainer').innerHTML = '';
  selectedImagesBase64 = [];
  document.getElementById('clientModal').classList.add('active');
}

window.openEditClientModal = function(id) {
  const item = currentData.find(d => d.id === id);
  if(!item) return;

  document.getElementById('clientModalTitle').textContent = '거래처 정보 수정';
  document.getElementById('editClientId').value = item.id;
  document.getElementById('clientName').value = item.name;
  document.getElementById('clientPhone').value = item.phone || '';
  document.getElementById('clientAddress1').value = item.address1 || '';
  document.getElementById('clientAddress2').value = item.address2 || '';
  document.getElementById('clientLat').value = item.latitude || '';
  document.getElementById('clientLng').value = item.longitude || '';
  document.getElementById('clientCourse').value = item.course || '';
  document.getElementById('clientOrder').value = item.order || '';
  document.getElementById('clientBoxCount').value = item.boxCount || 1;
  document.getElementById('clientMemo').value = item.memo || '';
  
  const container = document.getElementById('imagePreviewContainer');
  container.innerHTML = '';
  
  // 이미지가 문자열로 들어올 경우를 대비해 배열로 변환하여 처리
  const imgData = item.deliveryPlaceImages;
  selectedImagesBase64 = Array.isArray(imgData) ? [...imgData] : (imgData ? [imgData] : []);
  
  selectedImagesBase64.forEach(src => {
    const wrap = document.createElement('div');
    wrap.style = "position:relative;";
    
    const img = document.createElement('img');
    img.src = getDirectImageUrl(src);
    img.style = "width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd;";
    
    const delBtn = document.createElement('button');
    delBtn.innerHTML = '×';
    delBtn.style = "position:absolute; top:-5px; right:-5px; background:red; color:white; border:none; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer;";
    delBtn.onclick = (event) => {
      event.preventDefault();
      const idx = selectedImagesBase64.indexOf(src);
      if(idx > -1) selectedImagesBase64.splice(idx, 1);
      wrap.remove();
    };
    
    wrap.appendChild(img);
    wrap.appendChild(delBtn);
    container.appendChild(wrap);
  });

  document.getElementById('clientModal').classList.add('active');
};

function closeClientModal() { document.getElementById('clientModal').classList.remove('active'); }

function handleImagePreview(e) {
  const files = Array.from(e.target.files);
  const container = document.getElementById('imagePreviewContainer');
  
  // 기존 이미지는 유지하고 새로 추가하는 방식으로 변경
  if (selectedImagesBase64.length + files.length > 6) {
    alert('최대 6장까지만 업로드 가능합니다.');
    e.target.value = '';
    return;
  }

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const base64 = evt.target.result;
      selectedImagesBase64.push(base64);
      const img = document.createElement('img');
      img.src = base64;
      img.style = "width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd;";
      
      // 삭제 버튼 추가 (기능 편의성)
      const wrap = document.createElement('div');
      wrap.style = "position:relative;";
      const delBtn = document.createElement('button');
      delBtn.innerHTML = '×';
      delBtn.style = "position:absolute; top:-5px; right:-5px; background:red; color:white; border:none; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer;";
      delBtn.onclick = (event) => {
        event.preventDefault();
        const idx = selectedImagesBase64.indexOf(base64);
        if(idx > -1) selectedImagesBase64.splice(idx, 1);
        wrap.remove();
      };
      
      wrap.appendChild(img);
      wrap.appendChild(delBtn);
      container.appendChild(wrap);
    };
    reader.readAsDataURL(file);
  });
}

function execDaumPostcode() {
  new daum.Postcode({
    oncomplete: async function(data) {
      const addr = data.roadAddress || data.jibunAddress;
      document.getElementById('clientAddress1').value = addr;
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}`);
        const json = await response.json();
        if(json && json.length > 0) {
          document.getElementById('clientLat').value = parseFloat(json[0].lat).toFixed(6);
          document.getElementById('clientLng').value = parseFloat(json[0].lon).toFixed(6);
        } else {
          document.getElementById('clientLat').value = "37.5" + Math.floor(Math.random() * 9999);
          document.getElementById('clientLng').value = "127.0" + Math.floor(Math.random() * 9999);
        }
      } catch(e) { console.error('Geocoding error', e); }
      document.getElementById('clientAddress2').focus();
    }
  }).open();
}

async function saveClient() {
  const editId = document.getElementById('editClientId').value;
  const placeData = {
    name: document.getElementById('clientName').value,
    address1: document.getElementById('clientAddress1').value,
    address2: document.getElementById('clientAddress2').value,
    phone: document.getElementById('clientPhone').value,
    memo: document.getElementById('clientMemo').value,
    boxCount: parseInt(document.getElementById('clientBoxCount').value) || 1,
    latitude: parseFloat(document.getElementById('clientLat').value),
    longitude: parseFloat(document.getElementById('clientLng').value),
    course: document.getElementById('clientCourse').value || null,
    order: document.getElementById('clientOrder').value ? parseInt(document.getElementById('clientOrder').value) : null,
    deliveryPlaceImages: selectedImagesBase64
  };
  if(!placeData.name || !placeData.address1) { alert('배송처명과 주소는 필수입니다.'); return; }

  document.getElementById('saveClientBtn').disabled = true;
  try {
    let res;
    if (editId) {
      placeData.id = parseInt(editId);
      res = await api.updateDeliveryPlace(placeData);
    } else {
      res = await api.addDeliveryPlace(placeData);
    }
    
    if(res.success) { 
      alert(`성공적으로 ${editId ? '수정' : '등록'}되었습니다!`); 
      closeClientModal(); 
      await loadDashboardData(); 
    }
  } catch(e) { alert('처리 중 오류 발생'); } 
  finally { document.getElementById('saveClientBtn').disabled = false; }
}

// ---------------- DRIVERS ----------------
async function renderDriversView() {
  const tbody = document.getElementById('driversTableBody');
  tbody.innerHTML = '';
  const drivers = await api.getDrivers();
  if(drivers.length === 0) return;

  drivers.forEach(dr => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${dr.id}</td>
      <td><strong>${dr.name}</strong></td>
      <td>${dr.username}</td>
      <td><span class="badge badge-pending">코스 ${dr.course}</span></td>
      <td>${dr.phone || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveDriver() {
  const name = document.getElementById('driverName').value;
  const username = document.getElementById('driverUsername').value;
  const course = document.getElementById('driverCourse').value;
  const phone = document.getElementById('driverPhone').value;

  if(!name || !username || !course) { alert('필수값을 입력해주세요.'); return; }
  
  try {
    const res = await api.addDriver({ name, username, course: String(course), phone });
    if(res.success) {
      alert('기사가 등록되었습니다.');
      document.getElementById('driverModal').classList.remove('active');
      renderDriversView();
    }
  } catch(e) { alert('등록 오류'); }
}
