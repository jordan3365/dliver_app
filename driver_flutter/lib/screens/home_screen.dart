import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:math' as math;
import '../models/delivery_item.dart';
import '../models/driver.dart';
import '../services/api_service.dart';
import 'delivery_list_tab.dart';
import 'delivery_map_tab.dart';
import 'my_info_tab.dart';
import 'login_screen.dart';

class HomeScreen extends StatefulWidget {
  final Driver driver;

  const HomeScreen({super.key, required this.driver});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;
  List<DeliveryItem> _deliveries = [];
  bool _isLoading = true;
  int _pendingCount = 0;
  int _doneCount = 0;
  int _excludedCount = 0;
  double _progressPercent = 0.0;

  // 타이머 및 서비스 객체들
  Timer? _refreshTimer;
  Timer? _locationTimer;
  final FlutterTts _flutterTts = FlutterTts();
  
  // 위치 추적 상태
  Position? _currentPosition;
  bool _isDelivering = false;

  // 공지사항 팝업 이력 관리용
  final Set<int> _shownNoticeIds = {};
  int _bellNotificationCount = 0;

  @override
  void initState() {
    super.initState();
    _initTts();
    _fetchData();
    _requestLocationPermission();

    // 5초 간격 실시간 갱신 타이머
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (timer) {
      _fetchData(quiet: true);
      _checkNotices();
    });

    // 30초 간격 기사 위치 보고 및 시뮬레이션 타이머
    _locationTimer = Timer.periodic(const Duration(seconds: 30), (timer) {
      _reportLocation();
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _locationTimer?.cancel();
    _flutterTts.stop();
    super.dispose();
  }

  void _initTts() async {
    await _flutterTts.setLanguage("ko-KR");
    await _flutterTts.setSpeechRate(1.0);
    await _flutterTts.setPitch(1.0);
  }

  Future<void> speak(String text) async {
    await _flutterTts.speak(text);
  }

  Future<void> _requestLocationPermission() async {
    bool serviceEnabled;
    LocationPermission permission;

    serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      if (mounted) {
        _showGpsWarning();
      }
      return;
    }

    permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        if (mounted) {
          _showGpsWarning();
        }
        return;
      }
    }
    
    if (permission == LocationPermission.deniedForever) {
      if (mounted) {
        _showGpsWarning();
      }
      return;
    }

    // 초기 위치 가져오기
    try {
      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      setState(() {
        _currentPosition = pos;
      });
      _reportLocation();
    } catch (_) {}
  }

  void _showGpsWarning() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('위치 권한 안내'),
        content: const Text(
          '배송 관제 및 길안내를 위해 스마트폰의 GPS 위치 활용 동의가 반드시 필요합니다. '
          '설정에서 이 앱의 위치 권한을 허용해 주십시오.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }

  Future<void> _fetchData({bool quiet = false}) async {
    if (!quiet) {
      setState(() {
        _isLoading = true;
      });
    }

    try {
      final list = await ApiService.getDeliveryList(widget.driver.course);
      list.sort((a, b) => (a.order ?? 999).compareTo(b.order ?? 999));

      int pending = 0;
      int done = 0;
      int excluded = 0;

      for (var item in list) {
        if (item.status == 'done') {
          done++;
        } else if (item.status == 'excluded') {
          excluded++;
        } else {
          pending++;
        }
      }

      final double progress = list.isNotEmpty ? (done / list.length) : 0.0;
      final bool isDelivering = list.any((item) => item.status == 'delivering');

      setState(() {
        _deliveries = list;
        _pendingCount = pending;
        _doneCount = done;
        _excludedCount = excluded;
        _progressPercent = progress;
        _isDelivering = isDelivering;
        _isLoading = false;
      });

      // 오프라인 저장소 동기화 체크 (온라인 상태일 때 자동 수행)
      _syncOfflineQueueIfNeeded();
    } catch (e) {
      if (!quiet) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _syncOfflineQueueIfNeeded() async {
    final count = await ApiService.getOfflineQueueCount();
    if (count > 0) {
      final synced = await ApiService.syncOfflineTasks(widget.driver.course);
      if (synced > 0 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('✅ 오프라인 배송 내역 $synced건이 백그라운드 서버에 동기화되었습니다!'),
            backgroundColor: Colors.green,
          ),
        );
        speak("오프라인 배송 내역 동기화가 완료되었습니다.");
        _fetchData(quiet: true);
      }
    }
  }

  Future<void> _checkNotices() async {
    try {
      final notices = await ApiService.getNotices();
      if (notices.isEmpty) return;

      final relevantNotices = notices.where((n) {
        final target = n['target']?.toString() ?? '';
        return target == 'global' || target == widget.driver.course;
      }).toList();

      for (var notice in relevantNotices) {
        final id = notice['id'] is int ? notice['id'] as int : int.tryParse(notice['id']?.toString() ?? '') ?? 0;
        if (id == 0) continue;

        if (!_shownNoticeIds.contains(id)) {
          _shownNoticeIds.add(id);
          final isGlobal = notice['target']?.toString() == 'global';
          final title = isGlobal ? '📢 전체 공지사항' : '🚚 코스 전용 공지';
          final content = notice['content']?.toString() ?? '';

          setState(() {
            _bellNotificationCount++;
          });

          if (mounted) {
            _showNoticeDialog(title, content);
          }

          // HTML 태그 제거하여 TTS로 읽기
          final plainText = content.replaceAll(RegExp(r'<[^>]*>'), '');
          speak("새로운 메시지가 도착했습니다. $plainText");

          // 중요 공지(취소/변경)가 포함된 경우 데이터 강제 리로드
          if (content.contains('배송취소') || content.contains('수량변경')) {
            _fetchData(quiet: true);
          }
        }
      }
    } catch (_) {}
  }

  void _showNoticeDialog(String title, String content) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
        content: SingleChildScrollView(
          child: Text(content.replaceAll(RegExp(r'<[^>]*>'), '')),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }

  Future<void> _reportLocation() async {
    if (!_isDelivering) return;

    try {
      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      setState(() {
        _currentPosition = pos;
      });

      await ApiService.updateDriverLocation(
        widget.driver.course,
        pos.latitude,
        pos.longitude,
      );

      // 본사 도착 및 업무 완료 자동 복귀 알림 체크
      final double distanceToHq = _getDistance(
        pos.latitude,
        pos.longitude,
        37.556898,
        127.206401,
      );

      final bool allDone = _deliveries.isNotEmpty &&
          _deliveries.every((d) => d.status == 'done' || d.status == 'excluded');

      if (allDone && distanceToHq < 0.1) { // 100m 이내
        _handleHqArrival();
      }
    } catch (_) {}
  }

  double _getDistance(double lat1, double lon1, double lat2, double lon2) {
    const double r = 6371; // km
    final double dLat = _deg2rad(lat2 - lat1);
    final double dLon = _deg2rad(lon2 - lon1);
    final double a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_deg2rad(lat1)) *
            math.cos(_deg2rad(lat2)) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    final double c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return r * c;
  }

  double _deg2rad(double deg) {
    return deg * (math.pi / 180);
  }

  void _handleHqArrival() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('업무 종료'),
        content: const Text('본사에 도착하였습니다. 오늘 하루도 고생하셨습니다!'),
        actions: [
          TextButton(
            onPressed: () async {
              Navigator.pop(context);
              final prefs = await SharedPreferences.getInstance();
              await prefs.remove('authUser');
              
              if (mounted) {
                Navigator.of(context).pushReplacement(
                  MaterialPageRoute(builder: (context) => const LoginScreen()),
                );
              }
            },
            child: const Text('업무종료 (로그아웃)'),
          ),
        ],
      ),
    );
  }

  Future<void> _handleStartRoute() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final success = await ApiService.updateCourseStatus(
        widget.driver.course,
        'delivering',
      );

      if (success) {
        await _fetchData(quiet: true);
        speak("배송 업무를 시작합니다. 안전 운행 하십시오.");
        
        final nextItem = _deliveries.firstWhere(
          (d) => d.status == 'delivering',
          orElse: () => _deliveries.firstWhere((d) => d.status == 'pending'),
        );
        
        // 길안내 연동 실행
        _reportLocation();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('🚀 배송 업무에 자동으로 진입하였습니다! 안전 운전 하세요.'),
              backgroundColor: Colors.blue,
            ),
          );
        }
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('상태 업데이트에 실패했습니다.')),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // 탭 화면
    final List<Widget> tabs = [
      DeliveryListTab(
        deliveries: _deliveries,
        isLoading: _isLoading,
        onRefresh: () => _fetchData(quiet: true),
        isDelivering: _isDelivering,
        onStartRoute: _handleStartRoute,
      ),
      DeliveryMapTab(
        deliveries: _deliveries,
        currentPosition: _currentPosition,
        onRefresh: () => _fetchData(quiet: true),
      ),
      MyInfoTab(
        driver: widget.driver,
        onLogout: () async {
          final prefs = await SharedPreferences.getInstance();
          await prefs.remove('authUser');
          if (mounted) {
            Navigator.of(context).pushReplacement(
              MaterialPageRoute(builder: (context) => const LoginScreen()),
            );
          }
        },
      ),
    ];

    return Scaffold(
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(135),
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF002D5A), Color(0xFF0054A6)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.only(
              bottomLeft: Radius.circular(20),
              bottomRight: Radius.circular(20),
            ),
          ),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 10.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // App Bar Top
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${widget.driver.name} 기사님 (코스 ${widget.driver.course})',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Row(
                        children: [
                          // Bell Icon with Badge
                          GestureDetector(
                            onTap: () {
                              setState(() {
                                _bellNotificationCount = 0;
                              });
                            },
                            child: Stack(
                              clipBehavior: Clip.none,
                              children: [
                                const Icon(Icons.notifications, color: Colors.white, size: 24),
                                if (_bellNotificationCount > 0)
                                  Positioned(
                                    right: -4,
                                    top: -4,
                                    child: Container(
                                      padding: const EdgeInsets.all(2),
                                      decoration: BoxDecoration(
                                        color: Colors.red,
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      constraints: const BoxConstraints(
                                        minWidth: 16,
                                        minHeight: 16,
                                      ),
                                      child: Text(
                                        '$_bellNotificationCount',
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 9,
                                          fontWeight: FontWeight.bold,
                                        ),
                                        textAlign: TextAlign.center,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Dashboard Stats Grid
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildStatItem('배송대기', '$_pendingCount', const Color(0xFFF1C40F)),
                        _buildDivider(),
                        _buildStatItem('배송완료', '$_doneCount', const Color(0xFF2ECC71)),
                        _buildDivider(),
                        _buildStatItem('배송제외', '$_excludedCount', const Color(0xFFB2BEC3)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  // Progress Bar
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: LinearProgressIndicator(
                      value: _progressPercent,
                      backgroundColor: Colors.white.withOpacity(0.15),
                      valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF00E676)),
                      minHeight: 6,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      body: tabs[_currentIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) {
          setState(() {
            _currentIndex = index;
          });
        },
        selectedItemColor: const Color(0xFF0054A6),
        unselectedItemColor: const Color(0xFF8A96A3),
        selectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold),
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.list_alt),
            label: '배송목록',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.map),
            label: '배송지도',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.person),
            label: '내정보',
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, Color color) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildDivider() {
    return Container(
      height: 25,
      width: 1,
      color: Colors.white.withOpacity(0.15),
    );
  }
}
