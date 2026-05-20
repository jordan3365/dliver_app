import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/delivery_item.dart';
import '../models/driver.dart';

class ApiService {
  // 웹 버전과 마찬가지로 useMock를 false로 두어 실제 GAS 연동이 가능하게 설계
  static const bool useMock = false;
  static const String gasWebAppUrl =
      "https://script.google.com/macros/s/AKfycbxeybhAoooBw6bYbG0d_31n5seOLTUhGFHjVb0cu08coKAaGmwUsAQxr-7avHJ1GJNi/exec";

  // Mock 데이터
  static final List<Map<String, dynamic>> _mockDrivers = [
    {'id': 1, 'username': 'driver1', 'name': '김기사', 'course': '1', 'phone': '010-1111-1111', 'role': 'driver', 'token': 'fake-d1'},
    {'id': 2, 'username': 'driver2', 'name': '이기사', 'course': '2', 'phone': '010-2222-2222', 'role': 'driver', 'token': 'fake-d2'},
  ];

  static List<Map<String, dynamic>> _mockDeliveries = [];

  // API 통신을 위한 기본 POST 메서드
  static Future<Map<String, dynamic>> _fetch(String action, Map<String, dynamic> data) async {
    if (useMock) {
      await Future.delayed(const Duration(milliseconds: 300));
      return {'success': true};
    }

    try {
      final url = Uri.parse('$gasWebAppUrl?t=${DateTime.now().millisecondsSinceEpoch}');
      final response = await http.post(
        url,
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: json.encode({'action': action, 'data': data}),
      ).timeout(const Duration(seconds: 30));

      if (response.statusCode != 200) {
        throw Exception("HTTP 에러! 상태코드: ${response.statusCode}");
      }

      final responseBody = response.body;
      final Map<String, dynamic> decoded = json.decode(responseBody);
      
      if (decoded['success'] != true) {
        throw Exception(decoded['error'] ?? "알 수 없는 서버 오류");
      }
      return decoded;
    } catch (e) {
      rethrow;
    }
  }

  // 로그인
  static Future<Driver> login(String username, String password) async {
    if (useMock) {
      await Future.delayed(const Duration(milliseconds: 500));
      if (username == 'admin' && password == 'admin') {
        return Driver(id: 0, username: 'admin', name: '최고 관리자', course: '0', role: 'admin', token: 'fake-admin');
      }
      final found = _mockDrivers.firstWhere(
        (d) => d['username'] == username,
        orElse: () => throw Exception('아이디 또는 비밀번호 불일치'),
      );
      if (password == '1111') {
        return Driver.fromJson(found);
      } else {
        throw Exception('아이디 또는 비밀번호 불일치');
      }
    }

    final res = await _fetch('login', {'username': username, 'password': password});
    return Driver.fromJson(res['data']);
  }

  // 배송 목록 가져오기
  static Future<List<DeliveryItem>> getDeliveryList(String course) async {
    if (useMock) {
      await Future.delayed(const Duration(milliseconds: 300));
      // 임시 데이터 생성
      if (_mockDeliveries.isEmpty) {
        _mockDeliveries = List.generate(5, (index) => {
          'id': index + 1,
          'name': '거래처 ${index + 1}',
          'address1': '경기도 하남시 미사강변동로 ${100 + index * 10}',
          'address2': '10${index}동 20${index}호',
          'phone': '010-1234-567${index}',
          'memo': index == 1 ? '문 앞에 놓아주세요 (벨X)' : null,
          'boxCount': index + 1,
          'latitude': 37.556898 + (index - 2) * 0.003,
          'longitude': 127.206401 + (index - 2) * 0.004,
          'course': course,
          'order': index + 1,
          'status': 'pending',
          'deliveryPlaceImages': []
        });
      }
      return _mockDeliveries.map((e) => DeliveryItem.fromJson(e)).toList();
    }

    final res = await _fetch('getDeliveryList', {'course': course});
    final List<dynamic> list = res['data'] ?? [];
    return list.map((e) => DeliveryItem.fromJson(e as Map<String, dynamic>)).toList();
  }

  // 배송지 상태 업데이트
  static Future<bool> updateDeliveryStatus(int id, String status) async {
    if (useMock) {
      await Future.delayed(const Duration(milliseconds: 200));
      final index = _mockDeliveries.indexWhere((d) => d['id'] == id);
      if (index != -1) {
        _mockDeliveries[index]['status'] = status;
      }
      return true;
    }

    final res = await _fetch('updateDeliveryStatus', {'id': id, 'status': status});
    return res['success'] == true;
  }

  // 배송 완료 처리 (서명 및 사진 포함 업데이트)
  static Future<bool> updateDeliveryPlace(DeliveryItem item) async {
    if (useMock) {
      await Future.delayed(const Duration(milliseconds: 300));
      final index = _mockDeliveries.indexWhere((d) => d['id'] == item.id);
      if (index != -1) {
        _mockDeliveries[index] = item.toJson();
      }
      return true;
    }

    final res = await _fetch('updateDeliveryPlace', item.toJson());
    return res['success'] == true;
  }

  // 코스별 모든 배송지 출발 처리
  static Future<bool> updateCourseStatus(String course, String status) async {
    if (useMock) {
      await Future.delayed(const Duration(milliseconds: 200));
      for (var d in _mockDeliveries) {
        if (d['course'].toString() == course && d['status'] != 'done') {
          d['status'] = status;
        }
      }
      return true;
    }

    final res = await _fetch('updateCourseStatus', {'course': course, 'status': status});
    return res['success'] == true;
  }

  // 기사 실시간 위치 보고
  static Future<bool> updateDriverLocation(String course, double lat, double lng) async {
    if (useMock) {
      // 로컬 스토리지 등에 가상 위치 반영
      final prefs = await SharedPreferences.getInstance();
      final locations = json.decode(prefs.getString('driverLocations') ?? '{}');
      locations[course] = {
        'lat': lat,
        'lng': lng,
        'updated': DateTime.now().millisecondsSinceEpoch
      };
      await prefs.setString('driverLocations', json.encode(locations));
      return true;
    }

    final res = await _fetch('updateDriverLocation', {'course': course, 'lat': lat, 'lng': lng});
    return res['success'] == true;
  }

  // 공지사항 조회
  static Future<List<Map<String, dynamic>>> getNotices() async {
    if (useMock) {
      final prefs = await SharedPreferences.getInstance();
      final String? noticesStr = prefs.getString('dummyNotices');
      if (noticesStr != null) {
        final List<dynamic> decoded = json.decode(noticesStr);
        return decoded.cast<Map<String, dynamic>>();
      }
      return [];
    }

    final res = await _fetch('getNotices', {});
    final List<dynamic> list = res['data'] ?? [];
    return list.cast<Map<String, dynamic>>();
  }

  // ---------------- 오프라인 대응 로직 ----------------
  
  // 오프라인 완료 태스크 로컬 저장
  static Future<void> saveOfflineTask(int id, String signatureBase64) async {
    final prefs = await SharedPreferences.getInstance();
    final queueStr = prefs.getString('offlineQueue') ?? '[]';
    final List<dynamic> queue = json.decode(queueStr);
    
    queue.add({
      'id': id,
      'signature': signatureBase64,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
    
    await prefs.setString('offlineQueue', json.encode(queue));
  }

  // 오프라인 태스크 서버 동기화
  static Future<int> syncOfflineTasks(String course) async {
    final prefs = await SharedPreferences.getInstance();
    final queueStr = prefs.getString('offlineQueue') ?? '[]';
    final List<dynamic> queue = json.decode(queueStr);
    
    if (queue.isEmpty) return 0;
    
    int syncedCount = 0;
    final List<dynamic> failedQueue = [];

    // 동기화 시 최신 배송 정보를 먼저 조회해 오기 위해 리스트 가져옴
    List<DeliveryItem> currentItems = [];
    try {
      currentItems = await getDeliveryList(course);
    } catch (_) {}

    for (var task in queue) {
      final int taskId = task['id'];
      final String signature = task['signature'];

      try {
        // 1. 배송 상태 완료로 업데이트
        await updateDeliveryStatus(taskId, 'done');
        
        // 2. 서명 이미지 등록 업데이트
        final item = currentItems.firstWhere((element) => element.id == taskId);
        final List<String> images = List<String>.from(item.deliveryPlaceImages);
        if (signature.isNotEmpty) {
          images.add(signature);
        }
        item.status = 'done';
        item.deliveryPlaceImages = images;
        
        await updateDeliveryPlace(item);
        syncedCount++;
      } catch (e) {
        failedQueue.add(task);
      }
    }

    if (failedQueue.isEmpty) {
      await prefs.remove('offlineQueue');
    } else {
      await prefs.setString('offlineQueue', json.encode(failedQueue));
    }
    
    return syncedCount;
  }

  // 오프라인 큐 크기 가져오기
  static Future<int> getOfflineQueueCount() async {
    final prefs = await SharedPreferences.getInstance();
    final queueStr = prefs.getString('offlineQueue') ?? '[]';
    final List<dynamic> queue = json.decode(queueStr);
    return queue.length;
  }
}
