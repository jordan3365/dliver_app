import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import '../models/driver.dart';
import '../services/api_service.dart';

class MyInfoTab extends StatefulWidget {
  final Driver driver;
  final VoidCallback onLogout;

  const MyInfoTab({
    super.key,
    required this.driver,
    required this.onLogout,
  });

  @override
  State<MyInfoTab> createState() => _MyInfoTabState();
}

class _MyInfoTabState extends State<MyInfoTab> {
  int _offlineCount = 0;
  bool _isSyncing = false;
  final FlutterTts _flutterTts = FlutterTts();

  @override
  void initState() {
    super.initState();
    _loadOfflineQueueCount();
  }

  Future<void> _loadOfflineQueueCount() async {
    final count = await ApiService.getOfflineQueueCount();
    setState(() {
      _offlineCount = count;
    });
  }

  Future<void> _handleSync() async {
    if (_offlineCount == 0) return;

    setState(() {
      _isSyncing = true;
    });

    try {
      final synced = await ApiService.syncOfflineTasks(widget.driver.course);
      await _loadOfflineQueueCount();
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('동기화 완료: $synced건의 배송 내역이 전송되었습니다.'),
            backgroundColor: Colors.green,
          ),
        );
      }
      
      await _flutterTts.setLanguage("ko-KR");
      await _flutterTts.speak("오프라인 데이터 동기화가 성공적으로 끝났습니다.");
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('동기화 실패: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSyncing = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF2F4F7),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Driver Info Card
            Card(
              elevation: 2,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              color: Colors.white,
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  children: [
                    CircleAvatar(
                      radius: 36,
                      backgroundColor: const Color(0x1F0054A6),
                      child: const Icon(Icons.person, size: 40, color: Color(0xFF0054A6)),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      widget.driver.name,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1D2129),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '사번: ${widget.driver.username}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: Colors.grey,
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Divider(),
                    const SizedBox(height: 10),
                    _buildInfoRow('배송 코스', '${widget.driver.course} 코스'),
                    const SizedBox(height: 10),
                    _buildInfoRow('연락처', widget.driver.phone ?? '등록 정보 없음'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Offline Sync Card
            Card(
              elevation: 2,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              color: Colors.white,
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.cloud_off, color: Colors.orange, size: 20),
                        SizedBox(width: 8),
                        Text(
                          '오프라인 데이터 동기화',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1D2129),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      '터널 등 데이터 불통 구역에서 배송 완료를 진행한 경우 내역이 스마트폰에 임시 저장됩니다. '
                      '네트워크 연결이 회복되면 아래 동기화 버튼을 눌러 데이터를 본사에 전송해 주십시오.',
                      style: TextStyle(fontSize: 12, color: Colors.grey, height: 1.4),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '대기 중인 오프라인 데이터: $_offlineCount건',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1D2129),
                          ),
                        ),
                        ElevatedButton.icon(
                          onPressed: (_offlineCount == 0 || _isSyncing) ? null : _handleSync,
                          icon: _isSyncing
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const Icon(Icons.sync, size: 16, color: Colors.white),
                          label: const Text('수동 동기화', style: TextStyle(color: Colors.white)),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.orange,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Logout Button
            ElevatedButton.icon(
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text('로그아웃'),
                    content: const Text('기사앱에서 로그아웃 하시겠습니까?'),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('취소', style: TextStyle(color: Colors.grey)),
                      ),
                      TextButton(
                        onPressed: () {
                          Navigator.pop(context);
                          widget.onLogout();
                        },
                        child: const Text('로그아웃', style: TextStyle(color: Colors.red)),
                      ),
                    ],
                  ),
                );
              },
              icon: const Icon(Icons.exit_to_app, color: Colors.white),
              label: const Text(
                '로그아웃 (퇴근)',
                style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFD63031),
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Colors.grey,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            color: Color(0xFF1D2129),
            fontSize: 13,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}
