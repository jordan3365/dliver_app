import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'dart:convert';
import 'dart:io';
import '../models/delivery_item.dart';
import '../services/api_service.dart';
import 'signature_dialog.dart';

class DeliveryCard extends StatelessWidget {
  final DeliveryItem item;
  final bool isActive;
  final VoidCallback onStateChanged;

  const DeliveryCard({
    super.key,
    required this.item,
    required this.isActive,
    required this.onStateChanged,
  });

  // 카카오맵 네비게이션 앱/웹 호출
  Future<void> _openKakaoMap(BuildContext context) async {
    final lat = item.latitude;
    final lng = item.longitude;
    final name = Uri.encodeComponent(item.name);

    final appUri = Uri.parse('kakaomap://route?ep=$lat,$lng&by=CAR');
    final webUri = Uri.parse('https://map.kakao.com/link/to/$name,$lat,$lng');

    try {
      bool launched = await launchUrl(appUri, mode: LaunchMode.externalApplication);
      if (!launched) {
        await launchUrl(webUri, mode: LaunchMode.externalApplication);
      }
    } catch (_) {
      await launchUrl(webUri, mode: LaunchMode.externalApplication);
    }
  }

  // 배송 완료 처리 (서명 받고 서버 업데이트)
  Future<void> _completeDelivery(BuildContext context) async {
    final signature = await showDialog<String>(
      context: context,
      builder: (context) => const SignatureDialog(),
    );

    if (signature == null) return; // 취소됨

    // 로컬 인터넷 상태 감지 (try-catch 및 Geolocation/timeout 등으로 간접 체크 가능)
    bool isOnline = true;
    try {
      // 가벼운 헤드 요청이나 소켓 커넥션으로 확인 가능하지만, 모바일 환경에서는 
      // http.get 이나 ApiService 통신 결과 에러 여부로 판단
      final checkUrl = Uri.parse('https://script.google.com');
      final res = await HttpClient().headUrl(checkUrl).then((req) => req.close()).timeout(const Duration(seconds: 3));
      isOnline = res.statusCode > 0;
    } catch (_) {
      isOnline = false;
    }

    if (!isOnline) {
      // 오프라인 상태 -> 로컬 큐에 임시 저장
      await ApiService.saveOfflineTask(item.id, signature);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('⚠️ 통신 상태 장애 감지: 배송 내역이 로컬 큐에 임시 저장되었습니다.'),
            backgroundColor: Colors.orange,
          ),
        );
      }
      onStateChanged();
      return;
    }

    // 온라인 정상 처리
    try {
      final success = await ApiService.updateDeliveryStatus(item.id, 'done');
      if (success) {
        // 서명 이미지도 업로드
        final updatedImages = List<String>.from(item.deliveryPlaceImages);
        if (signature.isNotEmpty) {
          updatedImages.add(signature);
        }
        item.status = 'done';
        item.deliveryPlaceImages = updatedImages;

        await ApiService.updateDeliveryPlace(item);

        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ 배송 완료 처리 성공!'),
              backgroundColor: Colors.green,
            ),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        showDialog(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('오류'),
            content: Text('완료 처리 중 에러가 발생했습니다: $e'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('확인'),
              ),
            ],
          ),
        );
      }
    } finally {
      onStateChanged();
    }
  }

  // 상세 보기 모달 다이얼로그
  void _showDetails(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  item.name,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              )
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildDetailRow(Icons.map, '주소', '${item.address1} ${item.address2 ?? ""}'),
                const SizedBox(height: 8),
                _buildDetailRow(Icons.phone, '연락처', item.phone),
                const SizedBox(height: 8),
                _buildDetailRow(Icons.inbox, '수량', '${item.boxCount} 박스'),
                if (item.memo != null && item.memo!.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF9E6),
                      border: Border.all(color: const Color(0xFFFFE0B2)),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '메모: ${item.memo}',
                      style: const TextStyle(
                        color: Color(0xFFD35400),
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
                // 이미지 & 서명 확인 영역
                if (item.deliveryPlaceImages.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  const Text(
                    '현장 이미지 & 서명',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF0054A6),
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 80,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: item.deliveryPlaceImages.length,
                      itemBuilder: (context, idx) {
                        final src = item.deliveryPlaceImages[idx];
                        Widget imageWidget;
                        
                        if (src.startsWith('data:image')) {
                          final base64Data = src.split(',').last;
                          imageWidget = Image.memory(
                            base64Decode(base64Data),
                            fit: BoxFit.cover,
                            width: 80,
                            height: 80,
                          );
                        } else {
                          // 웹상의 Google Drive 또는 일반 URL
                          imageWidget = Image.network(
                            src,
                            fit: BoxFit.cover,
                            width: 80,
                            height: 80,
                            errorBuilder: (_, __, ___) => Container(
                              color: Colors.grey[300],
                              child: const Icon(Icons.broken_image),
                            ),
                          );
                        }

                        return GestureDetector(
                          onTap: () => _viewLargeImage(context, src),
                          child: Padding(
                            padding: const EdgeInsets.only(right: 8.0),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: imageWidget,
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            ElevatedButton(
              onPressed: () => Navigator.pop(context),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0054A6),
                foregroundColor: Colors.white,
              ),
              child: const Text('닫기'),
            )
          ],
        );
      },
    );
  }

  Widget _buildDetailRow(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: const Color(0xFF0054A6)),
        const SizedBox(width: 8),
        Text(
          '$label: ',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(fontSize: 13),
          ),
        ),
      ],
    );
  }

  // 이미지 크게 보기
  void _viewLargeImage(BuildContext context, String src) {
    showDialog(
      context: context,
      builder: (context) {
        Widget img;
        if (src.startsWith('data:image')) {
          final base64Data = src.split(',').last;
          img = Image.memory(base64Decode(base64Data));
        } else {
          img = Image.network(src);
        }

        return Dialog(
          backgroundColor: Colors.black,
          insetPadding: EdgeInsets.zero,
          child: Stack(
            alignment: Alignment.center,
            children: [
              InteractiveViewer(child: img),
              Positioned(
                top: 20,
                right: 20,
                child: IconButton(
                  icon: const Icon(Icons.close, color: Colors.white, size: 30),
                  onPressed: () => Navigator.pop(context),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool isDone = item.status == 'done';
    final bool isExcluded = item.status == 'excluded';
    final bool isDelivering = item.status == 'delivering';

    // UI 스타일 토큰 결정
    Color leftBorderColor = const Color(0xFF0054A6);
    String statusText = '대기중';
    Color badgeBg = const Color(0x1FF1C40F);
    Color badgeColor = const Color(0xFFF1C40F);
    double opacity = 1.0;

    if (isDone) {
      leftBorderColor = const Color(0xFF2ECC71);
      statusText = '완료';
      badgeBg = const Color(0x1F2ECC71);
      badgeColor = const Color(0xFF2ECC71);
      opacity = 0.75;
    } else if (isExcluded) {
      leftBorderColor = const Color(0xFFE5E9F0);
      statusText = '배송제외';
      badgeBg = Colors.grey[200]!;
      badgeColor = Colors.grey[600]!;
      opacity = 0.5;
    } else if (isDelivering) {
      leftBorderColor = const Color(0xFF0054A6);
      statusText = '배송중';
      badgeBg = const Color(0x1F0054A6);
      badgeColor = const Color(0xFF0054A6);
    }

    return Opacity(
      opacity: opacity,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border(
            left: BorderSide(
              color: leftBorderColor,
              width: isActive ? 7.0 : 5.0,
            ),
          ),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFF0054A6).withOpacity(isActive ? 0.12 : 0.04),
              blurRadius: isActive ? 12 : 8,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      '${item.order ?? "-"}순번. ${item.name}',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        decoration: isExcluded ? TextDecoration.lineThrough : null,
                        color: isExcluded ? Colors.grey : const Color(0xFF1D2129),
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: badgeBg,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      statusText,
                      style: TextStyle(
                        color: badgeColor,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              // Body
              Column(
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.location_on, size: 15, color: Color(0xFF0054A6)),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${item.address1} ${item.address2 ?? ""}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Color(0xFF8A96A3),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(Icons.inbox, size: 15, color: Color(0xFF0054A6)),
                      const SizedBox(width: 6),
                      Text(
                        '${item.boxCount} 박스 (배송수량)',
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF1D2129),
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  if (item.memo != null && item.memo!.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const Icon(Icons.note_alt, size: 15, color: Colors.red),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            item.memo!,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Colors.red,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 14),
              // Action Buttons
              Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 38,
                      child: OutlinedButton.icon(
                        onPressed: isExcluded ? null : () => _showDetails(context),
                        icon: const Icon(Icons.info, size: 14),
                        label: const Text('상세', style: TextStyle(fontSize: 11)),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFF4A5568),
                          side: const BorderSide(color: Color(0xFFE5E9F0)),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: SizedBox(
                      height: 38,
                      child: ElevatedButton.icon(
                        onPressed: isExcluded ? null : () => _openKakaoMap(context),
                        icon: const Icon(Icons.navigation, size: 14, color: Colors.black),
                        label: const Text('길안내', style: TextStyle(fontSize: 11, color: Colors.black)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFFEE500), // Kakao Yellow
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: SizedBox(
                      height: 38,
                      child: ElevatedButton.icon(
                        onPressed: (isDone || isExcluded) ? null : () => _completeDelivery(context),
                        icon: const Icon(Icons.check, size: 14, color: Colors.white),
                        label: const Text('완료', style: TextStyle(fontSize: 11, color: Colors.white)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0054A6), // Coupang Blue
                          elevation: 1,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
