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
let prevDoneDestIds = new Set(); // 이전 배송 완료 거래처 ID 저장용
let currentDrivers = []; // 실시간 기사 위치 정보 저장용 추가
let simMap; // 시뮬레이션용 독립 지도 객체
let simMapInitialized = false;
let simMarkers = []; // 시뮬레이션용 목적지 마커
let predictedCarState = {}; // 상태 기반 예측 이동 로직을 위한 글로벌 객체
let hqArrivedCourses = new Set(); // 본사 도착 완료 처리된 코스 저장용

// AI TTS 음성 안내 함수 (기사앱과 동일한 프리미엄 TTS 음색 매핑 적용)
let sysVoices = [];
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    sysVoices = window.speechSynthesis.getVoices();
  };
  sysVoices = window.speechSynthesis.getVoices();
}

function speak(text) {
  if (!window.speechSynthesis) return;
  // window.speechSynthesis.cancel(); // 다중 알림 시 서로 취소되는 버그 방지를 위해 큐에 쌓이도록 주석 처리
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  
  if (sysVoices.length === 0) sysVoices = window.speechSynthesis.getVoices();
  // 자연스러운 구글 여성 음성을 최우선으로 매핑 (Google 한국의, ko-KR)
  const preferredVoices = ['Google 한국의', 'ko-KR', 'Microsoft SunHi', 'Yuna', 'Sora'];
  let selectedVoice = null;
  
  for (let pref of preferredVoices) {
    selectedVoice = sysVoices.find(v => v.lang.includes('ko') && v.name.includes(pref));
    if (selectedVoice) break;
  }
  if (!selectedVoice) selectedVoice = sysVoices.find(v => v.lang.includes('ko'));
  
  if (selectedVoice) utterance.voice = selectedVoice;
  
  utterance.rate = 1.0;
  utterance.pitch = 1.0; // 가장 자연스러운 기본(1.0) 피치 적용 (구글 네이티브 음성에 최적화)
  window.speechSynthesis.speak(utterance);
}

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
  const match = String(course).match(/\d+/);
  const numStr = match ? match[0] : String(course).trim();
  return COURSE_COLORS[numStr] || "#2d3436"; // Default dark grey
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
  if (points.length < 2) return { roadPoints: points, legDurations: [] };
  try {
    const coords = points.map(p => `${p[1]},${p[0]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok') {
      const roadPoints = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      const legDurations = data.routes[0].legs.map(leg => leg.duration);
      return { roadPoints, legDurations };
    }
  } catch (e) {
    console.error('OSRM 호출 실패:', e);
  }
  return { roadPoints: points, legDurations: points.map(() => 0) }; // 실패 시 직선 경로 및 0초 반환
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

// 최단거리 Nearest Neighbor 정렬 헬퍼 (TSP 최적화)
function sortNearest(points, start = HQ_COORD) {
  let unvisited = [...points];
  let sorted = [];
  let current = start;
  
  while (unvisited.length > 0) {
    let nearestIdx = -1;
    let minDist = Infinity;
    
    for (let i = 0; i < unvisited.length; i++) {
      const pLat = parseFloat(unvisited[i].latitude);
      const pLng = parseFloat(unvisited[i].longitude);
      const cLat = current.lat !== undefined ? current.lat : (current.latitude !== undefined ? current.latitude : HQ_COORD.lat);
      const cLng = current.lng !== undefined ? current.lng : (current.longitude !== undefined ? current.longitude : HQ_COORD.lng);
      
      const dist = getDist(cLat, cLng, pLat, pLng);
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = i;
      }
    }
    
    if (nearestIdx !== -1) {
      const nextPoint = unvisited.splice(nearestIdx, 1)[0];
      sorted.push(nextPoint);
      current = nextPoint;
    } else {
      break;
    }
  }
  return sorted;
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
      } else if (item.dataset.target === 'simulation') {
        renderSimulationView();
      } else if (item.dataset.target === 'data') {
        renderAnalyticsView();
      }
    });
  });

  try {
    initMap();

    // Binds
    document.getElementById('autoRouteBtn').addEventListener('click', executeAutoRouting);
    document.getElementById('manualRouteBtn').addEventListener('click', executeManualRouting);
    document.getElementById('selectAllRoutes').addEventListener('change', handleSelectAll);
    
    // 중복 폴링 제거: 하단의 단일 setInterval이 모든 자동 갱신을 담당합니다.
    
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

    // 공지사항 모달 제어
    const openNoticeBtn = document.getElementById('openNoticeModalBtn');
    if (openNoticeBtn) {
      openNoticeBtn.addEventListener('click', () => {
        // 공지 내용 초기화
        noticeEditor.innerHTML = '';
        document.getElementById('noticeModal').classList.add('active');
      });
    }
    const closeNoticeBtn = document.getElementById('closeNoticeModal');
    if (closeNoticeBtn) {
      closeNoticeBtn.addEventListener('click', () => {
        document.getElementById('noticeModal').classList.remove('active');
      });
    }

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
        document.getElementById('noticeModal').classList.remove('active');
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
          document.getElementById('noticeModal').classList.remove('active');
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
          if (map) {
            map.setView([HQ_COORD.lat, HQ_COORD.lng], 13);
          }
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

    // Sidebar Toggle for Mobile/Tablet
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (btnToggleSidebar && sidebar) {
      btnToggleSidebar.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('active');
      });
      // 사이드바 외부 클릭 시 닫기
      document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('active') && !sidebar.contains(e.target) && e.target !== btnToggleSidebar) {
          sidebar.classList.remove('active');
        }
      });
    }

    // Collapsible Dashboard List Toggle
    const btnToggleListOverlay = document.getElementById('btnToggleListOverlay');
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (btnToggleListOverlay && dashboardGrid) {
      btnToggleListOverlay.addEventListener('click', () => {
        dashboardGrid.classList.toggle('list-collapsed');
        if (dashboardGrid.classList.contains('list-collapsed')) {
          btnToggleListOverlay.innerHTML = '<i class="fa-solid fa-list-check"></i> 배송현황 열기';
          btnToggleListOverlay.style.background = '#f1f2f6';
        } else {
          btnToggleListOverlay.innerHTML = '<i class="fa-solid fa-list-check"></i> 배송현황 접기';
          btnToggleListOverlay.style.background = 'white';
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

    // 실시간 자동 갱신 (3초 → 매우 빠른 갱신)
    setInterval(async () => {
      try {
        await loadDashboardData(true); // true = 백그라운드 폴링 플래그
      } catch (err) {
        console.warn("실시간 데이터 자동 갱신 대기 중...", err);
      }
    }, 3000);
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
  L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=ko', { maxZoom: 19 }).addTo(map);

  // 본사(출발지/도착지) 고정 마커
  const hqIcon = L.divIcon({
    className: 'map-pin',
    html: `<i class="fa-solid fa-house-flag" style="color: #6C5CE7; font-size:35px; text-shadow:0 0 5px rgba(0,0,0,0.5);"></i><span style="top:10px;">HQ</span>`,
    iconSize: [35, 45], iconAnchor: [17, 45], popupAnchor: [0, -45]
  });
  L.marker([HQ_COORD.lat, HQ_COORD.lng], {icon: hqIcon}).addTo(map)
   .bindPopup('<b>착한식판 본사</b><br>경기도 하남시 덕풍동 833-1 (출발지/도착지)');
}

// isBackground=true이면 백그라운드 폴링이므로 대시보드 외 탭은 재렌더링 생략
async function loadDashboardData(isBackground = false) {
  try {
    // 두 API 요청을 병렬로 실행하여 응답 시간을 절반으로 단축
    const [deliveryRes, driverRes] = await Promise.all([
      api.getDeliveryList(),
      api.getDrivers()
    ]);
    
    currentData = deliveryRes;
    currentDrivers = driverRes;

    // 새롭게 완료된 배송처 감지하여 AI 음성 안내
    if (Array.isArray(deliveryRes)) {
      const currentDoneItems = deliveryRes.filter(d => d.status === 'done');
      if (prevDoneDestIds.size > 0) {
        currentDoneItems.forEach(item => {
          if (!prevDoneDestIds.has(item.id)) {
            const courseStr = item.course ? `${item.course}호차` : '배송차량';
            speak(`${courseStr} 배송처 ${item.name} 배송 완료되었습니다.`);
            showDeliveryCompleteAlert(item.course || '-', item.name);
            
            // 새롭게 완료된 배송처 위치로 부드럽게 줌인(Zoom-in) 비주얼 효과 적용
            if (item.latitude && item.longitude) {
              const lat = parseFloat(item.latitude);
              const lng = parseFloat(item.longitude);
              if (!isNaN(lat) && !isNaN(lng) && map) {
                map.flyTo([lat, lng], 17, {
                  animate: true,
                  duration: 2.5
                });
              }
            }
          }
        });
      }
      prevDoneDestIds = new Set(currentDoneItems.map(d => d.id));
    }

    renderDashboardList(currentData);
    await updateMapMarkers(currentData, currentDrivers);
    updateVehicleStatus(currentData, currentDrivers);
    
    // aiTrafficInterval 누수 방지: 최초 1회만 등록
    if (!aiTrafficInterval) {
      aiTrafficInterval = setInterval(() => {
        if (currentData) updateVehicleStatus(currentData, currentDrivers);
      }, 60000);
    }

    // 백그라운드 폴링 시에는 현재 보고 있지 않은 탭을 재렌더링하지 않음 (성능 최적화)
    if (!isBackground) {
      if (document.getElementById('view-routing').classList.contains('active')) renderRoutingView();
      if (document.getElementById('view-clients').classList.contains('active')) renderClientsView();
      if (document.getElementById('view-drivers').classList.contains('active')) renderDriversView();
    }
  } catch (error) {
    console.warn('데이터 업데이트 지연 (일시적 오류):', error.message);
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
      <div style="font-size: 0.75rem; color: var(--text-muted); margin-left: 22px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; justify-content:space-between; align-items:center; ${isExcluded ? 'text-decoration:line-through; opacity:0.5;' : ''}">
        <span>[${item.course}호차]</span>
        <span style="display:flex; align-items:center; gap:4px; background:#e2e8f0; padding:2px 6px; border-radius:4px; font-weight:bold; color:#333;">
          <i class="fa-solid fa-box"></i>
          <input type="number" value="${item.boxCount || 0}" min="0" style="width:40px; padding:2px; border:1px solid #ccc; border-radius:3px; text-align:center;" onclick="event.stopPropagation();" onchange="window.adminUpdateBoxCount(${item.id}, this.value, event)">
        </span>
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
  // 기존에 열려있는 팝업 ID 상태 백업 (새로고침 시 깜빡임 방지 및 유지)
  const openPopupIds = new Set();
  if (typeof markers !== 'undefined') {
    markers.forEach(m => {
      if (m.isPopupOpen() && m.options && m.options.title) {
        openPopupIds.add(m.options.title);
      }
    });
  }

  const tempMarkers = [];
  const tempLivePolylines = [];
  const tempLiveCarMarkers = [];

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
    if (item.course) {
      let lat = parseFloat(item.latitude);
      let lng = parseFloat(item.longitude);
      
      // 위경도가 올바르지 않거나 (NaN, 0.0 등), 대한민국 좌표 범위를 완전히 이탈한 경우 본사 주변 임시 좌표로 구제
      if (isNaN(lat) || isNaN(lng) || lat < 30 || lat > 45 || lng < 120 || lng > 135) {
        console.warn(`[좌표 보정] 배송처 ID: ${item.id} (${item.name})의 위경도 데이터가 비정상(Lat:${item.latitude}, Lng:${item.longitude})이어 본사 인근 임시 좌표로 보정합니다.`);
        lat = HQ_COORD.lat + (Math.random() - 0.5) * 0.006;
        lng = HQ_COORD.lng + (Math.random() - 0.5) * 0.006;
        item.latitude = lat;
        item.longitude = lng;
      }

      if(!coursePaths[item.course]) coursePaths[item.course] = [];
      coursePaths[item.course].push(item);

      let isExcluded = item.status === 'excluded';
      let baseColor = getCourseColor(item.course);
      let pinColor = item.status === 'done' ? '#2ecc71' : (isExcluded ? '#dfe6e9' : baseColor); 
      let orderText = item.status === 'done' ? '<span style="font-size: 8px; font-weight: 900; position: relative; top: -1px; letter-spacing: -0.5px; color: white !important;">완료</span>' : (isExcluded ? '<i class="fa-solid fa-xmark" style="font-size:12px;"></i>' : (item.order ? item.order : '-'));
      
      let classNames = 'map-pin';
      let isNextDest = nextDestIds.has(item.id);
      if (isNextDest) classNames += ' pin-next pin-pulse';

      const pinIcon = L.divIcon({
        className: classNames,
        html: `<i class="fa-solid fa-location-dot" style="color: ${pinColor}; ${item.status === 'done' ? 'opacity:1.0;' : (isExcluded ? 'opacity:0.6;' : '')}"></i><span style="${item.status === 'done' ? 'color:white !important;' : (isExcluded ? 'color:#636e72;' : '')}">${orderText}</span>`,
        iconSize: [32, 42], iconAnchor: [16, 42], popupAnchor: [0, -42]
      });

      try {
        const marker = L.marker([lat, lng], {icon: pinIcon, title: String(item.id)});
        
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
        
        tempMarkers.push(marker);
        bounds.push([lat, lng]);

        let shouldOpen = false;

        // 1. 새롭게 배송처가 '다음 목적지'로 지정되거나, 최초 로드 시 무조건 열기
        if (isNextDest && (isFirstLoad || newlyAddedDestIds.includes(item.id))) {
          shouldOpen = true;
        }
        // 2. 이미 사용자가 수동으로 열어뒀거나 이전 주기에 열려있던 팝업 유지
        else if (openPopupIds.has(String(item.id))) {
          shouldOpen = true;
        }

        // 3. 완료된 목적지는 무조건 팝업 닫기 (풍선 삭제 기능)
        if (item.status === 'done') {
          shouldOpen = false;
        }

        if (shouldOpen) {
          setTimeout(() => marker.openPopup(), 100);
        }
      } catch (e) {
        console.warn(`마커 생성 실패 (ID: ${item.id}):`, e);
      }
    }
  });

  // 코스별 경로 선 및 실시간 차량 위치 표시 (병렬 처리로 속도 향상)
  const courseKeys = Object.keys(coursePaths);
  const roadPathPromises = courseKeys.map(async (course) => {
    const items = coursePaths[course].sort((a,b) => (a.order || 999) - (b.order || 999));
    
    // 1. 차량 위치 우선 계산 (실시간 GPS -> 최근 완료지 -> HQ)
    const driverInfo = drivers.find(d => String(d.course).trim() === String(course).trim());
    let carPos = [HQ_COORD.lat, HQ_COORD.lng];
    let isLiveGps = false;

    const isActive = items.some(it => it.status === 'delivering' || it.status === 'done');
    const isAllDone = items.length > 0 && items.every(it => it.status === 'done');

    if (driverInfo && driverInfo.currentLocation) {
      const latGps = parseFloat(driverInfo.currentLocation.lat);
      const lngGps = parseFloat(driverInfo.currentLocation.lng);
      
      let isRecent = true;
      const timeStr = driverInfo.currentLocation.updated || driverInfo.currentLocation.timestamp;
      if (timeStr) {
        const gpsTime = new Date(timeStr).getTime();
        // 12시간 지나면 GPS 만료 (30분은 점심시간 등 휴식 시 마커 튀는 버그 유발)
        if (!isNaN(gpsTime) && Math.abs(new Date().getTime() - gpsTime) > 12 * 60 * 60 * 1000) {
          isRecent = false;
        }
      } else { isRecent = false; }

      if (isRecent && !isNaN(latGps) && !isNaN(lngGps) && latGps !== 0 && lngGps !== 0) {
        // 사용자의 요청에 따라 실제 GPS보다 '최근 배송처 -> 다음 배송처' 상태 기반 예측 이동을 우선 적용하기 위해, 
        // GPS 위치를 바로 carPos로 덮어쓰지 않고 로직을 하단 예측 로직으로 일원화합니다.
        // isLiveGps 플래그만 남겨둡니다.
        isLiveGps = true;
      }
    }

    const doneItems = items.filter(it => it.status === 'done').sort((a, b) => (a.order || 0) - (b.order || 0));
    const pendingItems = items.filter(it => it.status !== 'done' && it.status !== 'excluded');
    
    let basePos = [HQ_COORD.lat, HQ_COORD.lng];
    let lastDoneId = null;
    
    if (doneItems.length > 0) {
      const lastDone = doneItems[doneItems.length - 1];
      lastDoneId = lastDone.id;
      const latVal = parseFloat(lastDone.latitude);
      const lngVal = parseFloat(lastDone.longitude);
      if (!isNaN(latVal) && !isNaN(lngVal)) basePos = [latVal, lngVal];
    } else if (!isActive) {
      const courseNum = parseInt(course) || Math.floor(Math.random() * 10);
      const angle = courseNum * (Math.PI * 2 / 10); 
      const radius = 0.00025; 
      basePos = [HQ_COORD.lat + Math.cos(angle) * radius, HQ_COORD.lng + Math.sin(angle) * radius];
    }

    // 예측 이동 상태 초기화 또는 갱신 (새로운 목적지 완료 감지 시 위치를 즉시 동기화)
    if (!predictedCarState[course] || predictedCarState[course].lastDoneId !== lastDoneId) {
      predictedCarState[course] = { pos: [...basePos], lastDoneId: lastDoneId };
    }

    // 다음 배송처로 천천히 3%씩 이동 (상태 기반 시뮬레이션 내비게이션 효과)
    if (isActive && pendingItems.length > 0) {
      hqArrivedCourses.delete(course); // 배송 중이면 도착 상태 해제
      
      const nextDest = pendingItems[0];
      const destLat = parseFloat(nextDest.latitude);
      const destLng = parseFloat(nextDest.longitude);
      if (!isNaN(destLat) && !isNaN(destLng)) {
        const curLat = predictedCarState[course].pos[0];
        const curLng = predictedCarState[course].pos[1];
        
        const distLat = destLat - curLat;
        const distLng = destLng - curLng;
        
        // 너무 가까워지면(약 100m 이내) 더 이상 이동하지 않고 해당 위치에서 배송 완료 대기
        if (Math.abs(distLat) > 0.001 || Math.abs(distLng) > 0.001) {
          predictedCarState[course].pos = [curLat + distLat * 0.04, curLng + distLng * 0.04];
        }
      }
    } else if (isAllDone) {
      // 모든 배송이 완료되었으면 본사로 천천히 이동
      const curLat = predictedCarState[course].pos[0];
      const curLng = predictedCarState[course].pos[1];
      const distLat = HQ_COORD.lat - curLat;
      const distLng = HQ_COORD.lng - curLng;
      if (Math.abs(distLat) > 0.001 || Math.abs(distLng) > 0.001) {
        predictedCarState[course].pos = [curLat + distLat * 0.04, curLng + distLng * 0.04];
      } else {
        // 본사(HQ)에 완전히 도착한 경우
        isLiveGps = false; // LIVE 배지 자동 종료
        predictedCarState[course].pos = [HQ_COORD.lat, HQ_COORD.lng]; // 완전히 본사에 스냅
        if (!hqArrivedCourses.has(course)) {
          hqArrivedCourses.add(course);
          speak(`${course}호차가 본사에 도착하여 실시간 관제를 종료합니다.`);
          showToast(`${course}호차 본사 도착 완료 (관제 종료)`);
        }
      }
    }

    carPos = predictedCarState[course].pos;

    // 2. 향후 이동 경로 (현재 위치 -> 남은 목적지 -> 본사)
    const rawPoints = [carPos];
    pendingItems.forEach(it => {
      if (it.latitude && it.longitude) {
        rawPoints.push([parseFloat(it.latitude), parseFloat(it.longitude)]);
      }
    });

    if (isAllDone || pendingItems.length > 0) {
      rawPoints.push([HQ_COORD.lat, HQ_COORD.lng]); // 최종 복귀 지점 추가
    }

    // 3. 과거 이동 경로 (본사 -> 완료된 목적지들 -> 현재 위치)
    const pastRawPoints = [[HQ_COORD.lat, HQ_COORD.lng]];
    doneItems.forEach(it => {
      if (it.latitude && it.longitude) pastRawPoints.push([parseFloat(it.latitude), parseFloat(it.longitude)]);
    });
    pastRawPoints.push(carPos);
    
    try {
      const [pathData, pastPathData] = await Promise.all([
        getRoadPath(rawPoints),
        getRoadPath(pastRawPoints)
      ]);
      return { course, items, roadPoints: pathData.roadPoints, pastRoadPoints: pastPathData.roadPoints, legDurations: pathData.legDurations, carPos, isLiveGps, isActive, isAllDone, pendingItems };
    } catch (e) {
      console.error(`${course}호차 경로 로딩 실패:`, e);
      return { course, items, roadPoints: rawPoints, pastRoadPoints: pastRawPoints, legDurations: [], carPos, isLiveGps, isActive, isAllDone, pendingItems };
    }
  });

  const roadPathsResults = await Promise.all(roadPathPromises);

  roadPathsResults.forEach(({ course, items, roadPoints, pastRoadPoints, legDurations, carPos, isLiveGps, isActive, isAllDone, pendingItems }) => {
    const color = getCourseColor(course);
    
    // 1. 과거 이동 경로 (흐릿한 점선으로 지나온 길 표시)
    if (pastRoadPoints && pastRoadPoints.length > 1) {
      const pastPoly = L.polyline(pastRoadPoints, {color: color, weight: 6, opacity: 0.3, dashArray: '5, 10', className: 'past-route-line'});
      tempLivePolylines.push(pastPoly);
    }

    // 2. 향후 이동 경로 (진한 실선 및 마칭 앤츠 애니메이션 가미)
    const poly = L.polyline(roadPoints, {color: color, weight: 6, opacity: 0.8, className: 'animated-route-line'});
    tempLivePolylines.push(poly);

    // 각 배송처(pending)별 ETA 계산 및 핀 상단 툴팁 추가
    if (isActive && !isAllDone && legDurations && legDurations.length > 0) {
      let accumulatedTimeSeconds = 0;
      pendingItems.forEach((pendingItem, index) => {
        if (legDurations[index] !== undefined) {
          accumulatedTimeSeconds += legDurations[index];
        }
        const marker = tempMarkers.find(m => m.options.title === String(pendingItem.id));
        if (marker) {
          const now = new Date();
          // 현재까지의 주행 시간 + (이전 목적지들의 하차 작업 시간 3분씩 합산)
          const totalSecondsToAdd = accumulatedTimeSeconds + (index * 180);
          now.setSeconds(now.getSeconds() + totalSecondsToAdd);
          
          const etaString = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
          
          marker.bindTooltip(`
            <div style="font-weight:900; color:${color}; font-size:12px; text-shadow: 1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff;">
              <i class="fa-solid fa-clock"></i> ${etaString}
            </div>
          `, {
            permanent: true,
            direction: 'top',
            offset: [0, -45],
            className: 'leaflet-tooltip-eta',
            opacity: 0.95
          });
        }
      });
    }

    // 시뮬레이션 중인 코스는 실제/추정 마커를 맵에 중복 표시하지 않음
    if (simIntervals[course]) {
      return;
    }

    const carIcon = L.divIcon({
      className: 'live-vehicle-marker',
      html: `
        <div class="car-marker-container" style="--vehicle-color: ${color}; border-color: ${color};">
          <i class="fa-solid fa-truck" style="color: ${color};"></i>
          ${isLiveGps ? '<span class="live-badge" style="top: -12px; right: -12px; background: #2ecc71; color: white; padding: 2px 5px; font-size: 9px; font-weight: bold; border-radius: 4px; position: absolute; box-shadow: 0 0 5px rgba(0,0,0,0.2);">LIVE</span>' : ''}
        </div>
      `,
      iconSize: [38, 38], iconAnchor: [19, 19]
    });
    
    let carMarker = liveCarMarkers.find(m => m.options.courseId === course);
    if (carMarker) {
      carMarker.setLatLng(carPos);
      
      // CSS transition을 유지하기 위해 setIcon을 호출하지 않고, 뱃지만 DOM에서 직접 조작합니다.
      const el = carMarker.getElement();
      if (el) {
        const badge = el.querySelector('.live-badge');
        if (isLiveGps) {
          if (!badge) {
            const container = el.querySelector('.car-marker-container');
            if (container) container.insertAdjacentHTML('beforeend', '<span class="live-badge" style="top: -12px; right: -12px; background: #2ecc71; color: white; padding: 2px 5px; font-size: 9px; font-weight: bold; border-radius: 4px; position: absolute; box-shadow: 0 0 5px rgba(0,0,0,0.2);">LIVE</span>');
          }
        } else {
          if (badge) badge.remove();
        }
      }
    } else {
      carMarker = L.marker(carPos, {icon: carIcon, zIndexOffset: 500, courseId: course});
    }

    let carStatusLabel = '운행 전 (대기)';
    if (isActive && !isAllDone) carStatusLabel = '배송 운행 중';
    else if (isAllDone) carStatusLabel = '운행 완료 (HQ 복귀)';

    const nextDestInfo = items.find(it => it.status !== 'done' && it.status !== 'excluded');

    const popupContent = `
      <div style="text-align:center;">
        <h4 style="margin:0 0 5px 0; color:${color};">${course}호차</h4>
        <span class="badge" style="background:${color}; color:white; font-size:0.75rem; padding:2px 6px; border-radius:4px;">${carStatusLabel}</span><br>
        <small style="display:block; margin-top:5px;">${isLiveGps ? '실시간 GPS 연동 중' : '본사(HQ) 대기 상태'}</small>
        ${nextDestInfo ? `<div style="margin-top:8px; padding-top:8px; border-top:1px dashed #ccc; font-weight:bold; color:#d63031;"><i class="fa-solid fa-flag-checkered"></i> 다음 목적지: ${nextDestInfo.name}</div>` : ''}
      </div>
    `;

    if (carMarker.getPopup()) {
      carMarker.setPopupContent(popupContent);
    } else {
      carMarker.bindPopup(popupContent);
    }

    tempLiveCarMarkers.push(carMarker);

    // 근접 알림 체크 (다음 목적지 30m 이내 접근 시 팝업 자동 오픈)
    const nextDest = items.find(it => it.status !== 'done');
    if (nextDest) {
      const dist = getDist(carPos[0], carPos[1], nextDest.latitude, nextDest.longitude);
      if (dist <= 0.03) { // 30m 이내 (0.03km)
        const marker = tempMarkers.find(m => m.options.title === String(nextDest.id));
        if (marker && !marker.isPopupOpen()) {
          marker.openPopup();
        }
      }
    }
  });

  // [더블 버퍼링 교체 작업 실행]
  // 1. 기존에 떠 있던 마커, 폴리라인 맵에서 일괄 제거
  markers.forEach(m => map.removeLayer(m));
  livePolylines.forEach(p => map.removeLayer(p));
  
  // 기존 차량 마커 중 이번 렌더링에 유지되지 않는 마커만 삭제
  liveCarMarkers.forEach(m => {
    if (!tempLiveCarMarkers.includes(m)) {
      map.removeLayer(m);
    }
  });

  // 2. 새로운 마커, 폴리라인 맵에 추가
  tempMarkers.forEach(m => m.addTo(map));
  tempLivePolylines.forEach(p => p.addTo(map));
  
  // 차량 마커는 이미 맵에 있는 경우 addTo를 생략, 없으면 추가
  tempLiveCarMarkers.forEach(m => {
    if (!map.hasLayer(m)) m.addTo(map);
  });

  // 3. 글로벌 참조 변수 갱신
  markers = tempMarkers;
  livePolylines = tempLivePolylines;
  liveCarMarkers = tempLiveCarMarkers;

  prevNextDestIds = nextDestIds;

  if (isFirstLoad && bounds.length > 1) {
    map.fitBounds(bounds, {padding: [50, 50]});
    isFirstLoad = false;
  }
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
    
    // 현재 위치 요약 (텍스트 기반)
    let locationStatus = '';
    const pendingData = courseData.filter(d => d.status !== 'done').sort((a,b) => (a.order||0) - (b.order||0));
    const completedData = courseData.filter(d => d.status === 'done').sort((a,b) => (a.order||0) - (b.order||0));
    
    if (done === total && total > 0) {
      locationStatus = `<div style="font-size:0.85rem; color:#333; margin-top:8px;"><i class="fa-solid fa-house-chimney" style="color:var(--success);"></i> 현재: <b>모든 배송 완료 (본사 복귀 중)</b></div>`;
    } else if (done === 0 && total > 0) {
      if (pendingData.length > 0) {
        locationStatus = `<div style="font-size:0.85rem; color:#333; margin-top:8px;"><i class="fa-solid fa-location-arrow" style="color:var(--primary);"></i> 다음 목적지: <b style="color:var(--primary);">${pendingData[0].name}</b> 이동 중</div>`;
      } else {
        locationStatus = `<div style="font-size:0.85rem; color:#666; margin-top:8px;"><i class="fa-solid fa-pause" style="color:var(--text-muted);"></i> 현재: <b>출발 대기 중</b></div>`;
      }
    } else {
      const lastDoneName = completedData.length > 0 ? completedData[completedData.length-1].name : '';
      const nextDestName = pendingData.length > 0 ? pendingData[0].name : '';
      locationStatus = `
        <div style="margin-top:8px; padding-top:8px; border-top:1px dashed #eee;">
          <div style="font-size:0.8rem; color:#666; margin-bottom:4px;"><i class="fa-solid fa-check" style="color:var(--success);"></i> 최근 완료: <span style="text-decoration:line-through;">${lastDoneName}</span></div>
          <div style="font-size:0.85rem; color:#333;"><i class="fa-solid fa-location-arrow" style="color:var(--primary);"></i> 현재 이동 중: <b style="color:var(--primary);">${nextDestName}</b></div>
        </div>
      `;
    }
    
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
          <div style="display:flex; justify-content:space-between; color:var(--text-main); align-items:center; margin-bottom:4px;">
            <span>예상 소요 시간</span>
            <strong>약 ${totalMin}분 <span style="font-size:0.75rem; color:#d63031;">${traffic.delay > 0 ? '(+'+traffic.delay+'분)' : ''}</span></strong>
          </div>
          <div style="display:flex; justify-content:space-between; color:var(--text-main); align-items:center;">
            <span>도착 예정 시간</span>
            <strong style="font-size:1.1rem; color:var(--primary);">${etaTime}</strong>
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
        <div style="display:flex; gap:5px; margin-top:8px;">
          <button onclick="adminSendMessage('${course}', '${driver.name}')" style="flex:1; padding:6px; font-size:0.8rem; background:#f1f2f6; border:1px solid #ddd; border-radius:4px; cursor:pointer; color:#57606f;">
            <i class="fa-solid fa-paper-plane"></i> 메시지 전송
          </button>
          ${statusText === '운행 전' && total > 0 ? `
            <button onclick="adminStartCourse('${course}')" style="flex:1; padding:6px; font-size:0.8rem; background:var(--primary); color:white; border:none; border-radius:4px; cursor:pointer;">
              <i class="fa-solid fa-play"></i> 출발 시키기
            </button>
          ` : ''}
        </div>
        <div style="width:100%; background:#e9ecef; height:6px; border-radius:3px; margin-top:8px; overflow:hidden;">
          <div style="width:${progressPct}%; background:${cColor}; height:100%; transition: width 0.5s ease;"></div>
        </div>
        ${locationStatus}
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

window.adminSendMessage = function(course, driverName) {
  const targetSelect = document.getElementById('noticeTarget');
  const editor = document.getElementById('noticeEditor');
  
  if (targetSelect) {
    targetSelect.value = String(course);
  }
  
  if (editor) {
    editor.innerHTML = `<strong>[관리자 지시사항]</strong><br>`;
  }
  
  const noticeModal = document.getElementById('noticeModal');
  if (noticeModal) {
    noticeModal.classList.add('active');
    setTimeout(() => {
      if (editor) editor.focus();
    }, 100);
  }
};

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

window.adminUpdateBoxCount = async function(id, count, event) {
  event.stopPropagation();
  try {
    const item = currentData.find(d => d.id === id);
    if (!item) return;
    await api.updateBoxCount(id, count);
    
    // 기사앱에 실시간으로 반영하도록 알림 전송 (업데이트 신호용 백그라운드)
    await api.saveNotice(String(item.course), `<strong>[수량변경 알림]</strong><br>${item.name}의 수량이 ${count}박스로 변경되었습니다.`, []);
    
    // 화면상 수량 임시 갱신
    item.boxCount = count;
    showToast(`박스 수량이 ${count}개로 변경되었습니다.`);
  } catch(e) {
    alert('수량 변경에 실패했습니다.');
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

let adminSystemMessages = [];

function showDeliveryCompleteAlert(course, placeName) {
  adminSystemMessages.push({ type: 'complete', course, placeName, time: Date.now() });

  const stack = document.getElementById('arrivalAlertStack');
  if(!stack) return;

  const courseColor = getCourseColor(course);
  const card = document.createElement('div');
  card.className = 'arrival-card animate-fade-in';
  card.style.borderLeftColor = courseColor;
  
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong style="color:${courseColor}; font-size:1.0rem;"><i class="fa-solid fa-circle-check"></i> ${course}호차 배송 완료</strong>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none; border:none; cursor:pointer; color:#999;"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div style="font-size:1.15rem; font-weight:800; color:var(--text-main); margin:8px 0;">${placeName}</div>
    <div style="font-size:0.8rem; color:var(--text-muted);">실시간 배송 완료 처리됨</div>
  `;
  
  stack.appendChild(card);
  
  // 15초 후 자동 삭제
  setTimeout(() => {
    if(card.parentNode) card.remove();
  }, 15000);

  updateBellBadge(1);
}

function showArrivalAlert(course, eta) {
  adminSystemMessages.push({ type: 'arrival', course, eta, time: Date.now() });
  const stack = document.getElementById('arrivalAlertStack');
  if(!stack) return;

  const courseColor = getCourseColor(course);
  const card = document.createElement('div');
  card.className = 'arrival-card traffic-blink-border';
  card.style.borderLeftColor = courseColor;
  
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong style="color:${courseColor}; font-size:1.1rem;"><i class="fa-solid fa-truck-ramp-box"></i> ${course}호차 도착 10분전</strong>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none; border:none; cursor:pointer; color:#999;"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div style="font-size:1.8rem; font-weight:900; color:var(--primary); margin:5px 0;">${eta}</div>
    <div style="font-size:0.85rem; color:#d63031; font-weight:600;">하차 대기 바랍니다.</div>
  `;
  
  stack.appendChild(card);
  
  // 30초 후 자동 삭제
  setTimeout(() => {
    if(card.parentNode) card.remove();
  }, 30000);

  // 브라우저 알림 (권한 있을 경우)
  if (Notification.permission === "granted") {
    new Notification(`HQ 도착 10분전 - ${course}호차`, {
      body: `${course}호차 HQ 도착 10분전 하차 대기 바랍니다.`,
      icon: '../img/nav_logo.png'
    });
  }

  // 상단 종 아이콘 배지 업데이트
  updateBellBadge(1);

  // 중앙 팝업 모달 띄우기 (네온사인 깜빡임 효과)
  const alertModal = document.getElementById('arrivalAlertModal');
  const alertBody = document.getElementById('arrivalAlertBody');
  if (alertModal && alertBody) {
    alertBody.innerHTML = `
      <i class="fa-solid fa-triangle-exclamation" style="font-size: 4rem; color: #ff4757; margin-bottom: 15px;"></i>
      <h1 style="font-size: 2.2rem; color: #ff4757; margin-bottom: 15px; font-weight: 900;">${course}호차 HQ 도착 10분전</h1>
      <h2 style="font-size: 1.6rem; color: var(--text-main); margin-bottom: 0; font-weight: 700;">하차 대기 바랍니다.</h2>
    `;
    alertModal.classList.add('active');
    
    // 오디오 알림음 (선택사항)
    speak(`${course}호차가 도착 10분 전입니다. 하차 대기 바랍니다.`);
  }
}

let notificationCount = 0;
function updateBellBadge(increment) {
  const badge = document.getElementById('bellBadge');
  if (!badge) return;
  notificationCount += increment;
  if (notificationCount > 0) {
    badge.textContent = notificationCount > 99 ? '99+' : notificationCount;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

// 종 아이콘 클릭 시 알림 카운트 초기화 및 모달 띄우기
document.addEventListener('DOMContentLoaded', () => {
  const bell = document.getElementById('adminBell');
  if (bell) {
    bell.addEventListener('click', () => {
      notificationCount = 0;
      updateBellBadge(0);
      
      const modalBody = document.getElementById('adminMessageViewerBody');
      if (adminSystemMessages.length === 0) {
        modalBody.innerHTML = '<div style="text-align:center; color:#999; padding:20px;">수신된 시스템 알림이 없습니다.</div>';
      } else {
        let html = '';
        [...adminSystemMessages].reverse().forEach(msg => {
          const dateObj = new Date(msg.time);
          const timeStr = dateObj.toLocaleTimeString('ko-KR', {hour: '2-digit', minute:'2-digit'});
          
          if (msg.type === 'complete') {
            html += `
              <div style="background:#f8f9fa; border-left: 4px solid #00b894; border-radius:4px; padding:12px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                  <strong style="color:#00b894; font-size:0.95rem;">${msg.course}호차 배송 완료</strong>
                  <span style="font-size:0.8rem; color:#888;">${timeStr}</span>
                </div>
                <div style="font-size:0.95rem;">${msg.placeName}</div>
              </div>
            `;
          } else if (msg.type === 'arrival') {
            html += `
              <div style="background:#fff5f5; border-left: 4px solid #ff4757; border-radius:4px; padding:12px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                  <strong style="color:#ff4757; font-size:0.95rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${msg.course}호차 도착 10분전</strong>
                  <span style="font-size:0.8rem; color:#888;">${timeStr}</span>
                </div>
                <div style="font-size:0.95rem; color:#d63031;">ETA: ${msg.eta} - 하차 대기 바랍니다.</div>
              </div>
            `;
          }
        });
        modalBody.innerHTML = html;
      }
      
      const modal = document.getElementById('adminMessageViewerModal');
      if (modal) modal.classList.add('active');
    });
  }
});


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
      document.getElementById('noticeModal').classList.add('active');
      editor.focus();
    }
  }).catch(err => console.error("loadNoticeToEditor 에러:", err));
};

// ---------------- ROUTING & SIMULATION ----------------
async function renderRoutingView() {
  const tbody = document.getElementById('routingTableBody');
  tbody.innerHTML = '';
  document.getElementById('selectAllRoutes').checked = false;
  const unassigned = currentData.filter(d => !d.course || d.course === "" || String(d.course) === "null" || String(d.course) === "undefined");

  // Update Driver Select (이미 로드된 currentDrivers 전역 캐시 활용)
  const driverSelect = document.getElementById('manualDriverSelect');
  const drivers = currentDrivers && currentDrivers.length > 0 ? currentDrivers : await api.getDrivers();
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

  // [고도화] K-Means Clustering + TSP (VRP Engine)
  const K = availableCourses.length;
  let centroids = [];
  
  // 1. 초기 중심점 임의 선택
  for (let i = 0; i < K; i++) {
    const rIdx = Math.floor(Math.random() * unassigned.length);
    centroids.push({ lat: unassigned[rIdx].latitude, lng: unassigned[rIdx].longitude });
  }

  let clusters = [];
  let assignments = new Array(unassigned.length).fill(-1);
  let changed = true;
  let iter = 0;

  // 2. K-Means 반복
  while (changed && iter < 100) {
    changed = false;
    clusters = Array.from({length: K}, () => []);

    for (let i = 0; i < unassigned.length; i++) {
      let minDist = Infinity;
      let clusterIdx = 0;
      for (let k = 0; k < K; k++) {
        const d = getDist(unassigned[i].latitude, unassigned[i].longitude, centroids[k].lat, centroids[k].lng);
        if (d < minDist) { minDist = d; clusterIdx = k; }
      }
      if (assignments[i] !== clusterIdx) {
        assignments[i] = clusterIdx;
        changed = true;
      }
      clusters[clusterIdx].push(unassigned[i]);
    }

    if (changed) {
      for (let k = 0; k < K; k++) {
        if (clusters[k].length === 0) continue;
        let sumLat = 0, sumLng = 0;
        clusters[k].forEach(p => { sumLat += p.latitude; sumLng += p.longitude; });
        centroids[k] = { lat: sumLat / clusters[k].length, lng: sumLng / clusters[k].length };
      }
    }
    iter++;
  }

  // 3. TSP 정렬 및 할당
  clusters.forEach((chunk, cIdx) => {
    if (chunk.length === 0) return;
    const course = availableCourses[cIdx];
    chunk = sortNearest(chunk); // 권역 내 TSP
    chunk.forEach((item, idx) => {
      routeUpdates.push({ id: item.id, course: course, order: idx + 1 });
    });
  });

  try {
    // OSRM 최적 경로 정보 요약 생성
    let summaryText = '🤖 AI 자동 배차 및 경로 최적화가 완료되었습니다!\n\n';
    const summaries = [];
    
    for (const course of availableCourses) {
      const courseData = routeUpdates.filter(u => u.course === course).sort((a, b) => a.order - b.order);
      if (courseData.length === 0) continue;
      
      let coords = [`${HQ_COORD.lng},${HQ_COORD.lat}`];
      courseData.forEach(d => {
        const item = currentData.find(c => c.id === d.id);
        if (item) coords.push(`${item.longitude},${item.latitude}`);
      });
      coords.push(`${HQ_COORD.lng},${HQ_COORD.lat}`);

      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${coords.join(';')}?overview=false`;
        const osrmRes = await fetch(url);
        const osrmData = await osrmRes.json();
        if (osrmData.code === 'Ok') {
          const distKm = (osrmData.routes[0].distance / 1000).toFixed(1);
          const durationMin = Math.round(osrmData.routes[0].duration / 60);
          summaries.push(`🚚 [코스 ${course}] 배송처 ${courseData.length}개: 예상 거리 ${distKm}km, 예상 시간 약 ${durationMin}분`);
        }
      } catch (_) {
        summaries.push(`🚚 [코스 ${course}] 배송처 ${courseData.length}개: 최단거리 기반 순번 지정 완료`);
      }
    }
    
    summaryText += summaries.join('\n');
    summaryText += '\n\n위 추천 최적 배차 정보를 스프레드시트 서버와 연동하시겠습니까?';

    if (!confirm(summaryText)) {
      btn.innerHTML = '선택항목 자동 할당 (최적화)';
      btn.disabled = false;
      return;
    }

    const res = await api.assignRoutes(routeUpdates);
    if(res.success) {
      alert('자동 할당 정보가 서버에 성공적으로 동기화되었습니다!');
      await loadDashboardData(); 
    }
  } catch (error) { 
    alert('오류가 발생했습니다.'); 
  } finally { 
    btn.innerHTML = '선택항목 자동 할당 (최적화)'; 
    btn.disabled = false; 
  }
}

async function executeManualRouting() {
  const checkboxes = document.querySelectorAll('.route-checkbox:checked');
  const selectedCourse = document.getElementById('manualDriverSelect').value;
  
  if (checkboxes.length === 0) { alert('할당할 배송처를 선택해주세요.'); return; }
  if (!selectedCourse) { alert('수동 할당할 코스(기사)를 선택해주세요.'); return; }

  const routeUpdates = [];
  // 현재 코스의 마지막 순번 찾기 (안전한 정수 파싱 및 NaN 방지 로직 적용)
  let maxOrder = 0;
  const courseItems = currentData.filter(d => d.course && String(d.course) === String(selectedCourse));
  if (courseItems.length > 0) {
    const validOrders = courseItems.map(d => parseInt(d.order) || 0).filter(o => !isNaN(o));
    if (validOrders.length > 0) {
      maxOrder = Math.max(...validOrders);
    }
  }

  checkboxes.forEach(cb => {
    const id = parseInt(cb.dataset.id);
    if (!isNaN(id)) {
      maxOrder++;
      routeUpdates.push({ id: id, course: String(selectedCourse), order: maxOrder });
    }
  });

  if (routeUpdates.length === 0) {
    alert('선택된 배송처의 ID 정보가 올바르지 않습니다.');
    return;
  }

  try {
    const res = await api.assignRoutes(routeUpdates);
    if(res.success) {
      alert('수동 할당이 완료되었습니다.');
      await loadDashboardData();
    } else {
      throw new Error(res.error || '서버 처리 실패');
    }
  } catch(e) { 
    console.error('수동 할당 실패 상세 로그:', e);
    alert(`할당 중 오류 발생: ${e.message}`); 
  }
}
// ---------------- SIMULATION ----------------
async function renderSimulationView() {
  const driverSelect = document.getElementById('simCourse');
  if (driverSelect) {
    const drivers = currentDrivers && currentDrivers.length > 0 ? currentDrivers : await api.getDrivers();
    driverSelect.innerHTML = '<option value="all">전체 차량</option>';
    drivers.forEach(dr => {
      driverSelect.innerHTML += `<option value="${dr.course}">${dr.course}코스 (${dr.name})</option>`;
    });
  }

  if (!simMapInitialized) {
    setTimeout(() => {
      simMap = L.map('sim-map').setView([HQ_COORD.lat, HQ_COORD.lng], 13);
      L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=ko', {
        attribution: 'Google Maps'
      }).addTo(simMap);
      
      const hqIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div class="map-pin"><i class="fa-solid fa-building" style="color:var(--primary); font-size:40px;"></i><span style="top:10px;">HQ</span></div>`,
        iconSize: [40, 42],
        iconAnchor: [20, 42]
      });
      L.marker([HQ_COORD.lat, HQ_COORD.lng], { icon: hqIcon }).addTo(simMap).bindPopup("착한식판 본사");
      simMapInitialized = true;
      drawSimMarkers();
    }, 100);
  } else {
    setTimeout(() => {
      simMap.invalidateSize();
      drawSimMarkers();
    }, 100);
  }
}

function drawSimMarkers() {
  simMarkers.forEach(m => simMap.removeLayer(m));
  simMarkers = [];
  
  if(!currentData || currentData.length === 0) return;
  
  const bounds = L.latLngBounds();
  bounds.extend([HQ_COORD.lat, HQ_COORD.lng]);

  currentData.forEach(item => {
    if(!item.latitude || !item.longitude) return;
    const courseColor = getCourseColor(item.course);
    
    let iconHtml = `
      <div class="map-pin">
        <i class="fa-solid fa-location-dot" style="color: ${courseColor};"></i>
        <span>${item.order || ''}</span>
      </div>`;
      
    const customIcon = L.divIcon({
      className: 'custom-div-icon',
      html: iconHtml,
      iconSize: [32, 42],
      iconAnchor: [16, 42],
      popupAnchor: [0, -42]
    });

    const marker = L.marker([item.latitude, item.longitude], { icon: customIcon, title: String(item.id) }).addTo(simMap);
    marker.bindPopup(`
      <div style="text-align:center;">
        <h4 style="margin:0 0 5px 0;">${item.name}</h4>
        <small>코스: ${item.course} | 순번: ${item.order || '-'}</small>
      </div>
    `);
    simMarkers.push(marker);
    bounds.extend([item.latitude, item.longitude]);
  });
  
  if (simMarkers.length > 0) simMap.fitBounds(bounds, {padding: [30, 30]});
}

// OSMR API Route Simulation - 다중 차량 동시 시뮬레이션 지원
async function runSimulation() {
  const selectedCourse = document.getElementById('simCourse').value;
  const simType = document.getElementById('simType').value;
  
  const coursesToSim = selectedCourse === 'all' 
    ? [...new Set(currentData.filter(d => d.course).map(d => String(d.course)))]
    : [selectedCourse];

  // 기존 시뮬레이션 모두 중단 및 초기화
  const activeSimCourses = Object.keys(simIntervals);
  Object.values(simIntervals).forEach(clearInterval);
  simIntervals = {};
  Object.values(routePolylines).forEach(p => simMap.removeLayer(p));
  routePolylines = {};
  Object.values(carMarkers).forEach(m => simMap.removeLayer(m));
  carMarkers = {};
  if (window.trafficPolylines) window.trafficPolylines.forEach(p => simMap.removeLayer(p));
  window.trafficPolylines = [];
  
  // 강제 중단된 시뮬레이션 코스 상태 복구
  activeSimCourses.forEach(c => {
    api.updateCourseStatus(c, 'pending');
  });
  
  // 시뮬레이션 알림 상태 초기화
  coursesToSim.forEach(c => alertedArrivals.delete(c + '_sim'));

  const btn = document.getElementById('startSimBtn');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  btn.disabled = true;

  // AI Prediction UI Initialization
  const aiPredictionPanel = document.getElementById('simAiPrediction');
  const aiPredictionContent = document.getElementById('simAiPredictionContent');
  if (aiPredictionPanel && aiPredictionContent) {
    aiPredictionPanel.style.display = 'block';
    let weatherCondition = Math.random() > 0.8 ? '<span style="color:#e74c3c;font-weight:bold;">우천(비)</span>' : '<span style="color:#27ae60;font-weight:bold;">맑음/정상</span>';
    let trafficCondition = simType === 'ai_traffic' ? '<span style="color:#e67e22;font-weight:bold;">출근길/구간 정체</span>' : '<span style="color:#2980b9;font-weight:bold;">원활</span>';
    aiPredictionContent.innerHTML = `<strong><i class="fa-solid fa-temperature-half"></i> 기후 예측:</strong> ${weatherCondition}<br><strong><i class="fa-solid fa-car-burst"></i> 교통 예측:</strong> ${trafficCondition}<br><hr style="margin: 10px 0; border: 0; border-top: 1px dashed #ccc;">`;
  }

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
        
        // 배송처별 예상 소요시간 계산 (OSRM legs 활용)
        const legs = data.routes[0].legs || [];
        let accumulatedSecs = 0;
        
        courseData.forEach((item, idx) => {
          if (legs[idx]) {
            accumulatedSecs += legs[idx].duration; // 이동 시간
          }
          let etaMins = Math.round(accumulatedSecs / 60);
          
          let now = new Date();
          now.setMinutes(now.getMinutes() + etaMins);
          let etaTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
          
          const pinMarker = markers.find(m => m.options.title === String(item.id));
          if (pinMarker) {
            pinMarker.setPopupContent(`
              <div style="text-align:center;">
                <h4 style="margin:0 0 5px 0;">${item.name}</h4>
                <div style="background:#fff3cd; color:#856404; padding:3px 6px; border-radius:4px; font-weight:bold; font-size:0.8rem; margin-bottom:5px;">
                  <i class="fa-solid fa-clock"></i> 예상: ${etaTime} (약 ${etaMins}분 소요)
                </div>
                <span class="badge badge-pending">대기중</span><br>
                <small>코스: ${item.course} | 순번: ${item.order || '-'}</small><br>
                <small>${item.address1}</small>
              </div>
            `);
          }
          accumulatedSecs += 600; // 배송지 체류 시간 (10분)
        });
        
        // 본사 복귀 시간 계산 (마지막 leg)
        if (legs[courseData.length]) {
          accumulatedSecs += legs[courseData.length].duration;
        }
        let totalMins = Math.round(accumulatedSecs / 60);
        let hqNow = new Date();
        hqNow.setMinutes(hqNow.getMinutes() + totalMins);
        let hqEtaTime = hqNow.getHours().toString().padStart(2, '0') + ':' + hqNow.getMinutes().toString().padStart(2, '0');
        
        if (typeof aiPredictionContent !== 'undefined' && aiPredictionContent) {
          aiPredictionContent.innerHTML += `<div style="margin-bottom: 6px; padding: 8px; background: #f1f5f9; border-radius: 4px; border-left: 3px solid ${courseColor};">
            <strong style="color:#333;">${course}호차:</strong> 총 예상 ${totalMins}분 소요<br>
            <span style="color:var(--primary); font-size:0.8rem; font-weight:600;"><i class="fa-solid fa-building-circle-arrow-right"></i> 본사 복귀 완료: ${hqEtaTime}</span>
          </div>`;
        }
        
        // 경로 표시 (마칭 앤츠 효과 가미)
        const poly = L.polyline(routeCoords, {color: courseColor, weight: 5, opacity: 0.8, className: 'animated-route-line'}).addTo(simMap);
        routePolylines[course] = poly;

        if (simType === 'ai_traffic') {
          // 트래픽 가시화 (AI 모드일 때만)
          let segmentLength = Math.max(1, Math.floor(routeCoords.length / 10));
          for (let i = 0; i < routeCoords.length - 1; i += segmentLength) {
            let chunk = routeCoords.slice(i, i + segmentLength + 1);
            let rand = Math.random();
            let color = courseColor;
            if (rand > 0.8) color = '#d63031';
            let p = L.polyline(chunk, {color: color, weight: 8, opacity: 0.4, className: 'animated-route-line'}).addTo(simMap);
            window.trafficPolylines.push(p);
          }
        }
        
        // 시뮬레이션 시작 시 배송 상태를 '배송중'으로 시각적 변경
        await api.updateCourseStatus(course, 'delivering');
        loadDashboardData();

        // 차량 아이콘
        const carIcon = L.divIcon({
          className: 'live-vehicle-marker',
          html: `
            <div class="car-marker-container" style="--vehicle-color: ${courseColor}; border-color: ${courseColor};">
              <i class="fa-solid fa-truck" style="color: ${courseColor};"></i>
            </div>
          `,
          iconSize: [38, 38], iconAnchor: [19, 19]
        });
        const marker = L.marker(routeCoords[0], {icon: carIcon, zIndexOffset: 1000}).addTo(simMap);
        carMarkers[course] = marker;

        // 애니메이션 시작
        let i = 0;
        simIntervals[course] = setInterval(() => {
          if (i >= routeCoords.length) {
            clearInterval(simIntervals[course]);
            delete simIntervals[course];
            
            // 시뮬레이션 마커 및 라인 정리
            if (routePolylines[course]) {
              simMap.removeLayer(routePolylines[course]);
              delete routePolylines[course];
            }
            if (carMarkers[course]) {
              simMap.removeLayer(carMarkers[course]);
              delete carMarkers[course];
            }
            if (window.trafficPolylines) {
              window.trafficPolylines.forEach(p => simMap.removeLayer(p));
              window.trafficPolylines = [];
            }
            
            // 백엔드 상태를 원래대로(pending) 복구하여 초기화
            api.updateCourseStatus(course, 'pending').then(() => {
              loadDashboardData();
            });
            return;
          }
          marker.setLatLng(routeCoords[i]);
          
          // 실시간 근접 체크 (배송지 근처 통과 시 팝업 오픈)
          const courseItems = currentData.filter(d => String(d.course) === String(course) && d.status !== 'done');
          courseItems.forEach(item => {
            const dist = getDist(routeCoords[i][0], routeCoords[i][1], item.latitude, item.longitude);
            if (dist <= 0.1) { // 100m 이내
              const pinMarker = simMarkers.find(m => m.options.title === String(item.id));
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
    if(allCoords.length > 0) simMap.fitBounds(L.latLngBounds(allCoords), {padding: [50, 50]});

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
      const mappedData = jsonData.map(row => {
        // 하남시 본사 근처로 임시 위경도 분산 지정
        const randLat = 37.556898 + (Math.random() * 0.04 - 0.02);
        const randLng = 127.206401 + (Math.random() * 0.04 - 0.02);
        return {
          name: row['배송처명'] || row['이름'] || '이름없음',
          address1: row['주소'] || row['도로명주소'] || '',
          phone: row['연락처'] || row['전화번호'] || '',
          memo: row['메모'] || '',
          boxCount: parseInt(row['수량']) || 1,
          latitude: parseFloat(randLat.toFixed(6)),
          longitude: parseFloat(randLng.toFixed(6))
        };
      }).filter(d => d.name !== '이름없음' && d.address1 !== '');

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
      // 괄호 및 법정동 등 Nominatim 검색을 방해하는 부가정보 제거
      const cleanAddr = addr.replace(/\s*\(.*?\)\s*/g, '').trim();
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanAddr)}`);
        const json = await response.json();
        if(json && json.length > 0) {
          document.getElementById('clientLat').value = parseFloat(json[0].lat).toFixed(6);
          document.getElementById('clientLng').value = parseFloat(json[0].lon).toFixed(6);
        } else {
          // 본사(하남) 근처 임시 좌표로 정밀 보정
          const fallbackLat = 37.556898 + (Math.random() * 0.04 - 0.02);
          const fallbackLng = 127.206401 + (Math.random() * 0.04 - 0.02);
          document.getElementById('clientLat').value = fallbackLat.toFixed(6);
          document.getElementById('clientLng').value = fallbackLng.toFixed(6);
        }
      } catch(e) { 
        console.error('Geocoding error', e); 
        const fallbackLat = 37.556898 + (Math.random() * 0.04 - 0.02);
        const fallbackLng = 127.206401 + (Math.random() * 0.04 - 0.02);
        document.getElementById('clientLat').value = fallbackLat.toFixed(6);
        document.getElementById('clientLng').value = fallbackLng.toFixed(6);
      }
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
  const drivers = currentDrivers && currentDrivers.length > 0 ? currentDrivers : await api.getDrivers();
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

// ---------------- ANALYTICS DATA ----------------
let allAnalyticsData = [];

async function renderAnalyticsView() {
  const tableBody = document.getElementById('dataTableBody');
  if(!tableBody) return;
  
  tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 30px;"><i class="fa-solid fa-spinner fa-spin"></i> 데이터를 불러오는 중...</td></tr>';
  
  try {
    allAnalyticsData = await api.getDeliveryAnalytics();
    
    // Populate filters
    const dateSelect = document.getElementById('dataFilterDate');
    const courseSelect = document.getElementById('dataFilterCourse');
    
    const uniqueDates = [...new Set(allAnalyticsData.map(d => d.date))];
    const uniqueCourses = [...new Set(allAnalyticsData.map(d => d.course))];
    
    if (dateSelect && dateSelect.options.length <= 1) {
      uniqueDates.forEach(date => dateSelect.insertAdjacentHTML('beforeend', `<option value="${date}">${date}</option>`));
    }
    if (courseSelect && courseSelect.options.length <= 1) {
      uniqueCourses.forEach(c => courseSelect.insertAdjacentHTML('beforeend', `<option value="${c}">${c}호차</option>`));
    }
    
    updateAnalyticsTable();
  } catch (e) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 20px; color:var(--danger);">데이터 로딩 실패: ${e.message}</td></tr>`;
  }
}

function updateAnalyticsTable() {
  const tableBody = document.getElementById('dataTableBody');
  const dateFilter = document.getElementById('dataFilterDate').value;
  const courseFilter = document.getElementById('dataFilterCourse').value;
  
  let filtered = allAnalyticsData;
  if (dateFilter !== 'all') filtered = filtered.filter(d => d.date === dateFilter);
  if (courseFilter !== 'all') filtered = filtered.filter(d => String(d.course) === String(courseFilter));
  
  if (filtered.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 30px; color:#999;">표시할 데이터가 없습니다.</td></tr>';
    return;
  }
  
  let html = '';
  filtered.forEach(d => {
    let statusBadge = '';
    if (d.weatherTraffic.includes('지연')) statusBadge = `<span style="background:#fff5f5; color:#d63031; padding:3px 8px; border-radius:12px; font-size:0.8rem; border:1px solid #ffb8b8;">${d.weatherTraffic}</span>`;
    else if (d.weatherTraffic.includes('매우 원활')) statusBadge = `<span style="background:#f0fdf4; color:#16a34a; padding:3px 8px; border-radius:12px; font-size:0.8rem; border:1px solid #bbf7d0;">${d.weatherTraffic}</span>`;
    else statusBadge = `<span style="background:#f1f5f9; color:#475569; padding:3px 8px; border-radius:12px; font-size:0.8rem; border:1px solid #cbd5e1;">${d.weatherTraffic}</span>`;

    html += `
      <tr>
        <td style="font-weight:600;">${d.date}</td>
        <td>${d.day}</td>
        <td><strong style="color:var(--primary);">${d.course}호차</strong></td>
        <td>${d.count}건</td>
        <td>${d.startTime}</td>
        <td>${d.endTime}</td>
        <td style="font-weight:700; color:#0984e3;">${d.duration}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  });
  
  tableBody.innerHTML = html;
  
  // 차트 그리기
  drawAnalyticsCharts(filtered);
}

let durationChartInstance = null;
let trafficChartInstance = null;

function drawAnalyticsCharts(data) {
  const durCtx = document.getElementById('durationChart');
  const trafCtx = document.getElementById('trafficChart');
  if (!durCtx || !trafCtx) return;

  if (durationChartInstance) durationChartInstance.destroy();
  if (trafficChartInstance) trafficChartInstance.destroy();

  if (data.length === 0) return;

  // 소요시간 바 차트 데이터 가공 (차량별 평균 소요시간)
  const courseTimes = {};
  data.forEach(d => {
    if(!courseTimes[d.course]) courseTimes[d.course] = { totalMs:0, count:0 };
    const mins = parseInt(String(d.duration).replace(/[^0-9]/g, '')) || 0;
    courseTimes[d.course].totalMs += mins;
    courseTimes[d.course].count++;
  });

  const courses = Object.keys(courseTimes).sort();
  const avgMins = courses.map(c => Math.round(courseTimes[c].totalMs / courseTimes[c].count));

  durationChartInstance = new Chart(durCtx, {
    type: 'line',
    data: {
      labels: courses.map(c => c + '호차'),
      datasets: [{
        label: '평균 소요시간 (분)',
        data: avgMins,
        backgroundColor: 'rgba(9, 132, 227, 0.2)',
        borderColor: '#0984e3',
        borderWidth: 2,
        pointBackgroundColor: '#0984e3',
        pointRadius: 4,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: '차량별 평균 배송 소요시간' },
        legend: { display: false }
      }
    }
  });

  // 교통/기후 도넛 차트 데이터 가공
  const trafficCounts = { '매우 원활': 0, '정상/원활': 0, '지연 (우천/정체 의심)': 0 };
  data.forEach(d => {
    if (d.weatherTraffic.includes('매우 원활')) trafficCounts['매우 원활']++;
    else if (d.weatherTraffic.includes('지연')) trafficCounts['지연 (우천/정체 의심)']++;
    else trafficCounts['정상/원활']++;
  });

  trafficChartInstance = new Chart(trafCtx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(trafficCounts),
      datasets: [{
        data: Object.values(trafficCounts),
        backgroundColor: ['#00b894', '#74b9ff', '#ff7675']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: '기후 및 교통 상황 지표' },
        legend: { position: 'right' }
      }
    }
  });

  // AI 종합 평가 생성
  const aiSection = document.getElementById('aiSummarySection');
  const aiContent = document.getElementById('aiSummaryContent');
  if (aiSection && aiContent) {
    aiSection.style.display = 'block';
    
    let totalDeliveries = 0;
    data.forEach(d => totalDeliveries += parseInt(d.count) || 0);

    let summaryHtml = `<strong>📊 데이터 요약:</strong> 조회된 기간 동안 총 <strong>${totalDeliveries}건</strong>의 배송이 수행되었습니다.<br>`;
    
    if (courses.length > 0) {
      let maxIdx = 0, minIdx = 0;
      for(let i=1; i<avgMins.length; i++) {
        if(avgMins[i] > avgMins[maxIdx]) maxIdx = i;
        if(avgMins[i] < avgMins[minIdx]) minIdx = i;
      }
      summaryHtml += `<strong>🚚 차량별 소요시간 분석:</strong> <strong>${courses[minIdx]}호차</strong>가 평균 ${avgMins[minIdx]}분으로 가장 효율적인 배송 속도를 기록했습니다. 반면, <strong>${courses[maxIdx]}호차</strong>는 평균 ${avgMins[maxIdx]}분으로 소요시간이 가장 길었습니다.<br>`;
      
      summaryHtml += `<strong>💡 AI 운영 제안:</strong> `;
      if (avgMins[maxIdx] > (avgMins[minIdx] || 1) * 1.5 && avgMins[maxIdx] > 15) {
        summaryHtml += `${courses[maxIdx]}호차의 코스 라우팅이 비효율적이거나 상습 정체 구역이 포함되었을 가능성이 높습니다. <strong>자동 배차 최적화(라우팅)</strong>를 통해 ${courses[minIdx]}호차의 여유 물량과 분산하여 ${courses[maxIdx]}호차의 부담을 줄이는 리밸런싱을 권장합니다.<br>`;
      } else {
        summaryHtml += `차량 간 배송 소요시간 편차가 크지 않아 비교적 균형 있는 배차 상태를 유지하고 있습니다.<br>`;
      }
    }

    const totalTraffic = trafficCounts['매우 원활'] + trafficCounts['정상/원활'] + trafficCounts['지연 (우천/정체 의심)'];
    if (totalTraffic > 0) {
      const delayRatio = trafficCounts['지연 (우천/정체 의심)'] / totalTraffic;
      summaryHtml += `<br><strong>🌧 기후 및 교통 분석:</strong> `;
      if (delayRatio > 0.3) {
        summaryHtml += `전체 중 약 <strong>${Math.round(delayRatio*100)}%</strong>가 '지연' 상태로 측정되었습니다. 악천후나 상습 정체 시간에 배송이 집중되어 있을 수 있으므로, 이 구역의 배송 출발 시간(ETD)을 앞당기거나 실시간 우회로 라우팅 알고리즘을 우선 적용할 것을 제안합니다.`;
      } else {
        summaryHtml += `심각한 배송 지연 징후는 나타나지 않았습니다. 현재의 정규 출발 시간(ETD)을 유지하셔도 좋습니다.`;
      }
    }
    
    aiContent.innerHTML = summaryHtml;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const dateFilter = document.getElementById('dataFilterDate');
  const courseFilter = document.getElementById('dataFilterCourse');
  if (dateFilter) dateFilter.addEventListener('change', updateAnalyticsTable);
  if (courseFilter) courseFilter.addEventListener('change', updateAnalyticsTable);
  
  const btnGenAI = document.getElementById('btnGenerateAIReport');
  if (btnGenAI) {
    btnGenAI.addEventListener('click', async () => {
      btnGenAI.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 분석 중...';
      btnGenAI.disabled = true;
      try {
        await api.generateDeliveryAnalytics();
        alert('오늘의 배송 데이터 AI 분석 보고서가 생성 및 저장되었습니다.');
        renderAnalyticsView();
      } catch (e) {
        alert('분석 보고서 생성 실패: ' + e.message);
      } finally {
        btnGenAI.innerHTML = '<i class="fa-solid fa-robot"></i> AI 분석 보고서 생성';
        btnGenAI.disabled = false;
      }
    });
  }
  
  const btnExportData = document.getElementById('btnExportData');
  if (btnExportData) {
    btnExportData.addEventListener('click', () => {
      if (allAnalyticsData.length === 0) return alert('다운로드할 데이터가 없습니다.');
      const headers = ['일자', '요일', '차량(코스)', '총 배송건수', '출발시간', '도착시간', '총 소요시간', '기후/교통상황'];
      const rows = allAnalyticsData.map(d => [d.date, d.day, d.course, d.count, d.startTime, d.endTime, d.duration, d.weatherTraffic]);
      
      let csvContent = "\uFEFF" + headers.join(',') + '\n';
      rows.forEach(r => {
        csvContent += r.join(',') + '\n';
      });
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `배송관련데이터_${new Date().getTime()}.csv`;
      a.click();
    });
  }
});
