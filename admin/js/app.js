import { api } from '../../js/shared/api.js';

let map;
let markers = [];
let currentData = [];
let routePolyline = null;
let carMarker = null;
let simInterval = null;
let aiTrafficInterval = null; // AI 교통 실시간 업데이트용
let selectedImagesBase64 = []; // 이미지 저장을 위한 배열

const HQ_COORD = { lat: 37.5645, lng: 127.2023 }; // 경기도 하남시 미사대로 550 (현대지식산업센터 한강미사1차)

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

function hexToRgba(hex, alpha) {
  let r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  const userStr = sessionStorage.getItem('authUser');
  if (!userStr) { window.location.href = '../index.html'; return; }
  const user = JSON.parse(userStr);
  if (user.role !== 'admin') { alert('관리자 권한이 필요합니다.'); window.location.href = '../index.html'; return; }
  document.getElementById('adminName').textContent = user.name;

  document.getElementById('logoutBtn').addEventListener('click', (e) => {
    e.preventDefault(); sessionStorage.removeItem('authUser'); window.location.href = '../index.html';
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

  initMap();

  // Binds
  document.getElementById('autoRouteBtn').addEventListener('click', executeAutoRouting);
  document.getElementById('manualRouteBtn').addEventListener('click', executeManualRouting);
  document.getElementById('selectAllRoutes').addEventListener('change', handleSelectAll);
  document.getElementById('refreshBtn').addEventListener('click', loadDashboardData);
  
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
    noticeEditor.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> 로딩중...</div>';
    try {
      const notices = await api.getNotices();
      const current = notices.find(n => String(n.target) === String(noticeTarget.value));
      noticeEditor.innerHTML = current ? current.content : '';
    } catch(e) {
      noticeEditor.innerHTML = '';
    }
  });

  document.getElementById('saveNoticeBtn').addEventListener('click', async () => {
    const target = noticeTarget.value;
    const content = noticeEditor.innerHTML;
    
    // 이미지 추출 (Base64)
    const imgs = noticeEditor.querySelectorAll('img');
    const imagesBase64 = Array.from(imgs).map(img => img.src).filter(src => src.startsWith('data:image'));

    document.getElementById('saveNoticeBtn').disabled = true;
    document.getElementById('saveNoticeBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 처리 중...';
    
    try {
      await api.saveNotice(target, content, imagesBase64);
      showAdminDialog('저장 완료', '공지사항이 성공적으로 저장 및 전송되었습니다.');
    } catch(e) {
      showAdminDialog('오류', '공지사항 저장에 실패했습니다.');
    } finally {
      document.getElementById('saveNoticeBtn').disabled = false;
      document.getElementById('saveNoticeBtn').innerHTML = '<i class="fa-solid fa-paper-plane"></i> 공지사항 저장 및 즉시 전송';
    }
  });

  document.getElementById('deleteNoticeBtn').addEventListener('click', async () => {
    const target = noticeTarget.value;
    showAdminDialog('공지 삭제', '현재 선택된 대상의 공지사항을 정말 삭제하시겠습니까?', true, async () => {
      try {
        await api.deleteNotice(target);
        noticeEditor.innerHTML = '';
        showAdminDialog('삭제 완료', '공지사항이 성공적으로 삭제되었습니다.');
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
      loadDashboardData(); // 알림 오면 화면 자동 리프레시
    }
  });

  await loadDashboardData();
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
   .bindPopup('<b>착한식판 본사</b><br>경기도 하남시 미사대로 550 (출발지/도착지)');
}

async function loadDashboardData() {
  currentData = await api.getDeliveryList();
  renderDashboardList(currentData);
  updateMapMarkers(currentData);
  updateVehicleStatus(currentData);
  
  if (aiTrafficInterval) clearInterval(aiTrafficInterval);
  aiTrafficInterval = setInterval(() => {
    if (currentData) updateVehicleStatus(currentData);
  }, 60000); 

  if (document.getElementById('view-routing').classList.contains('active')) renderRoutingView();
  if (document.getElementById('view-clients').classList.contains('active')) renderClientsView();
  if (document.getElementById('view-drivers').classList.contains('active')) renderDriversView();
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
  const activeDeliveries = data.filter(d => d.course !== null).sort((a,b)=> a.course - b.course || a.order - b.order);

  if (activeDeliveries.length === 0) {
    listEl.innerHTML = '<li style="text-align:center; color:#999;">할당된 데이터가 없습니다.</li>';
    return;
  }

  activeDeliveries.forEach(item => {
    const li = document.createElement('li');
    li.className = 'delivery-item animate-fade-in';
    
    // 오늘의 배송현황 코스별 배경색 적용
    const baseColor = getCourseColor(item.course);
    li.style.backgroundColor = hexToRgba(baseColor, 0.05); // 아주 연한 배경
    li.style.borderLeft = `5px solid ${baseColor}`;
    
    let badgeHtml = item.status === 'done' ? '<span class="badge badge-done">완료</span>' : 
                    item.status === 'pending' ? '<span class="badge badge-pending">대기중</span>' : 
                    '<span class="badge badge-delivering">배송중</span>';

    li.innerHTML = `
      <div class="item-header">
        <strong>[코스 ${item.course}] ${item.order ? item.order+'순번' : ''} ${item.name}</strong>
        ${badgeHtml}
      </div>
      <div style="font-size: 0.85rem; color: var(--text-muted);">
        <i class="fa-solid fa-location-dot"></i> ${item.address1}
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

function updateMapMarkers(data) {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  const bounds = [[HQ_COORD.lat, HQ_COORD.lng]];

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

  data.forEach(item => {
    if (item.latitude && item.longitude && item.course) {
      let baseColor = getCourseColor(item.course);
      let pinColor = item.status === 'done' ? '#b2bec3' : baseColor; 
      let orderText = item.status === 'done' ? '<i class="fa-solid fa-check" style="font-size:12px;"></i>' : (item.order ? item.order : '-');
      
      let classNames = 'map-pin';
      let isNextDest = nextDestIds.has(item.id);
      if (isNextDest) classNames += ' pin-next';

      const pinIcon = L.divIcon({
        className: classNames,
        html: `<i class="fa-solid fa-location-pin" style="color: ${pinColor}; ${item.status === 'done' ? 'opacity:0.8;' : ''}"></i><span>${orderText}</span>`,
        iconSize: [32, 42], iconAnchor: [16, 42], popupAnchor: [0, -42]
      });

      const marker = L.marker([item.latitude, item.longitude], {icon: pinIcon, title: String(item.id)}).addTo(map);
      marker.bindPopup(`
        <div style="text-align:center;">
          <h4 style="margin:0 0 5px 0;">${item.name}</h4>
          <span class="badge ${item.status==='done'?'badge-done':'badge-pending'}">${item.status==='done'?'완료':'대기중'}</span><br>
          <small>코스: ${item.course} | 순번: ${orderText}</small><br>
          <small>${item.address1}</small>
        </div>
      `, { autoClose: false, closeOnClick: false });
      
      markers.push(marker);
      bounds.push([item.latitude, item.longitude]);

      if (isNextDest) {
        setTimeout(() => marker.openPopup(), 100);
      }
    }
  });

  if (bounds.length > 1) map.fitBounds(bounds, { padding: [50, 50] });
}

function updateVehicleStatus(data) {
  const statusEl = document.getElementById('vehicleStatus');
  const activeData = data.filter(d => d.course !== null);
  const courses = [...new Set(activeData.map(d => d.course))].sort();
  let html = '';

  // Update Simulation Course Select
  const simSelect = document.getElementById('simCourse');
  const currentSimValue = simSelect.value;
  simSelect.innerHTML = '';

  courses.forEach(course => {
    // Add to simulation select
    const opt = document.createElement('option');
    opt.value = course;
    opt.textContent = `코스 ${course}`;
    simSelect.appendChild(opt);

    // Update status UI
    const courseData = activeData.filter(d => d.course === course);
    const total = courseData.length;
    const done = courseData.filter(d => d.status === 'done').length;
    let statusText = done === total ? '복귀중(완료)' : (done > 0 ? '배송중' : '운행 전');
    let cColor = getCourseColor(course);
    let progressPct = total > 0 ? Math.round((done/total)*100) : 0;
    
    // AI Traffic Mock Logic
    const remaining = total - done;
    const traffic = getAiTrafficStatus(course);
    let trafficHtml = '';
    
    if (done === total && total > 0) {
      trafficHtml = `<div style="margin-top:8px; padding:8px; background: rgba(0,0,0,0.03); border-radius:4px; text-align:center; color:#00b894; font-size:0.85rem; font-weight:bold;"><i class="fa-solid fa-check-circle"></i> 배송 완료 (본사 복귀중)</div>`;
    } else if (total > 0) {
      const baseMin = remaining * 15; // 남은 건당 15분 가정
      const totalMin = baseMin + traffic.delay;
      let now = new Date();
      now.setMinutes(now.getMinutes() + totalMin);
      let etaTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

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
          <strong style="color: var(--text-main); font-size:1.05rem;">${course}호차 (코스 ${course})</strong>
          <span style="background:${done === total ? 'var(--success)' : (done > 0 ? 'var(--primary)' : 'var(--text-muted)')}; color:white; padding:3px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">${statusText}</span>
        </div>
        <div style="color:var(--text-main); font-size:0.9rem; display:flex; justify-content:space-between; align-items:center;">
          <span>완료: <b>${done}</b> / ${total}건</span>
          <span style="color:var(--text-muted); font-size:0.85rem; font-weight:600;">${progressPct}%</span>
        </div>
        <div style="width:100%; background:#e9ecef; height:6px; border-radius:3px; margin-top:8px; overflow:hidden;">
          <div style="width:${progressPct}%; background:${cColor}; height:100%; transition: width 0.5s ease;"></div>
        </div>
        ${trafficHtml}
      </div>
    `;
  });
  
  if (currentSimValue && [...simSelect.options].some(o => o.value === currentSimValue)) {
    simSelect.value = currentSimValue;
  }
  
  statusEl.innerHTML = html || '운행 중인 차량이 없습니다.';
}


// ---------------- NOTICE ----------------
async function renderNoticeView() {
  const target = document.getElementById('noticeTarget').value;
  const editor = document.getElementById('noticeEditor');
  editor.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> 로딩중...</div>';
  
  try {
    const notices = await api.getNotices();
    const current = notices.find(n => String(n.target) === String(target));
    editor.innerHTML = current ? current.content : '';
  } catch(e) {
    editor.innerHTML = '';
  }
}

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
function getDist(lat1, lon1, lat2, lon2) {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p)/2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))/2;
  return 12742 * Math.asin(Math.sqrt(a));
}

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

  // Assign to courses based on Longitude, then sort by nearest
  let course1 = unassigned.filter(i => i.longitude < 127.10);
  let course2 = unassigned.filter(i => i.longitude >= 127.10);

  const sortNearest = (arr) => {
    let sorted = [];
    let curr = HQ_COORD;
    while(arr.length > 0) {
      arr.sort((a,b) => getDist(curr.lat, curr.lng, a.latitude, a.longitude) - getDist(curr.lat, curr.lng, b.latitude, b.longitude));
      let next = arr.shift();
      sorted.push(next);
      curr = {lat: next.latitude, lng: next.longitude};
    }
    return sorted;
  };

  course1 = sortNearest(course1);
  course2 = sortNearest(course2);

  course1.forEach((item, idx) => routeUpdates.push({ id: item.id, course: "1", order: idx + 1 }));
  course2.forEach((item, idx) => routeUpdates.push({ id: item.id, course: "2", order: idx + 1 }));

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

// OSMR API Route Simulation
async function runSimulation() {
  const course = document.getElementById('simCourse').value;
  const simType = document.getElementById('simType').value;
  
  // 구글 스프레드시트의 배송순번(order)을 절대 기준으로 정렬
  const courseData = currentData.filter(d => d.course === course).sort((a,b) => (a.order || 999) - (b.order || 999));
  if (courseData.length === 0) { showAdminDialog('알림', '해당 코스에 할당된 데이터가 없습니다.'); return; }

  let coords = [`${HQ_COORD.lng},${HQ_COORD.lat}`]; // Start
  courseData.forEach(d => coords.push(`${d.longitude},${d.latitude}`));
  coords.push(`${HQ_COORD.lng},${HQ_COORD.lat}`); // Return to HQ

  const btn = document.getElementById('startSimBtn');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  btn.disabled = true;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${coords.join(';')}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.code === 'Ok') {
      if (routePolyline) map.removeLayer(routePolyline);
      if (carMarker) map.removeLayer(carMarker);
      if (window.trafficPolylines) window.trafficPolylines.forEach(p => map.removeLayer(p));
      window.trafficPolylines = [];
      clearInterval(simInterval);

      const routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      
      let durationMin = Math.round(data.routes[0].duration / 60);
      const distKm = (data.routes[0].distance / 1000).toFixed(1);
      let etaHtml = '';

      if (simType === 'ai_traffic') {
        // AI 교통상황 시뮬레이션: 체증으로 인한 시간 증가
        const trafficDelay = Math.round(durationMin * (0.15 + Math.random() * 0.25)); // 15%~40% 체증
        durationMin += trafficDelay;
        
        etaHtml = `
          <i class="fa-solid fa-clock"></i> 복귀 예정시간: <span style="font-size:1.1rem;">${durationMin}분</span> 소요<br>
          <span style="font-size:0.8rem; color:#e17055; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> 정체 ${trafficDelay}분 추가됨 (AI 실시간 교통 반영)</span><br>
          <span style="font-size:0.75rem; color:#666;">(총 거리: ${distKm}km / 지정 순번 기준)</span>
        `;

        // 트래픽 폴리라인 (빨강/노랑/초록) 그리기
        let segmentLength = Math.max(1, Math.floor(routeCoords.length / 15));
        for (let i = 0; i < routeCoords.length - 1; i += segmentLength) {
          let chunk = routeCoords.slice(i, i + segmentLength + 1);
          let rand = Math.random();
          let color = '#00b894'; // 원활
          if (rand > 0.85) color = '#d63031'; // 정체
          else if (rand > 0.6) color = '#fdcb6e'; // 서행

          let p = L.polyline(chunk, {color: color, weight: 6, opacity: 0.9}).addTo(map);
          window.trafficPolylines.push(p);
        }
      } else {
        // 일반 지정 순번대로 (파란색 기본 라인)
        etaHtml = `
          <i class="fa-solid fa-clock"></i> 복귀 예정시간: ${durationMin}분 소요<br>
          <span style="font-size:0.8rem; color:#666;">(총 거리: ${distKm}km / 지정 배송순번 기준)</span>
        `;
        routePolyline = L.polyline(routeCoords, {color: '#0984e3', weight: 5, opacity: 0.7}).addTo(map);
      }

      document.getElementById('etaInfo').innerHTML = `
        <div style="background-color: #fff3cd; padding: 10px; border-radius: 6px; border-left: 4px solid #ffc107; color: #856404; font-size:0.95rem; font-weight:bold; margin-top:10px;">
          ${etaHtml}
        </div>
      `;

      map.fitBounds(L.latLngBounds(routeCoords), {padding: [50, 50]});

      // Animate Car
      const carIcon = L.divIcon({
        className: 'car-icon',
        html: `<i class="fa-solid fa-truck-fast" style="color:#2d3436; font-size:24px; background:white; padding:5px; border-radius:50%; border:2px solid #2d3436; box-shadow:0 0 10px rgba(0,0,0,0.3);"></i>`,
        iconSize: [36, 36], iconAnchor: [18, 18]
      });
      carMarker = L.marker(routeCoords[0], {icon: carIcon, zIndexOffset: 1000}).addTo(map);
      
      let i = 0;
      simInterval = setInterval(() => {
        if (i >= routeCoords.length) {
          clearInterval(simInterval);
          return;
        }
        carMarker.setLatLng(routeCoords[i]);
        i += 2; // Speed up animation
      }, 50);

    } else {
      showAdminDialog('오류', '경로를 찾을 수 없습니다.');
    }
  } catch(e) {
    showAdminDialog('오류', '경로 시뮬레이션 실패');
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
  selectedImagesBase64 = item.deliveryPlaceImages ? [...item.deliveryPlaceImages] : [];
  
  selectedImagesBase64.forEach(src => {
    const img = document.createElement('img');
    img.src = getDirectImageUrl(src);
    img.style = "width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd;";
    container.appendChild(img);
  });

  document.getElementById('clientModal').classList.add('active');
};

function closeClientModal() { document.getElementById('clientModal').classList.remove('active'); }

function handleImagePreview(e) {
  const files = Array.from(e.target.files);
  if (files.length > 6) {
    alert('최대 6장까지만 업로드 가능합니다.');
    e.target.value = '';
    return;
  }
  
  const container = document.getElementById('imagePreviewContainer');
  container.innerHTML = '';
  selectedImagesBase64 = [];

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const base64 = evt.target.result;
      selectedImagesBase64.push(base64);
      const img = document.createElement('img');
      img.src = base64;
      img.style = "width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd;";
      container.appendChild(img);
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
