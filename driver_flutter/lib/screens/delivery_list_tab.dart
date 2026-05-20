import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/delivery_item.dart';
import '../services/api_service.dart';
import '../widgets/delivery_card.dart';

class DeliveryListTab extends StatefulWidget {
  final List<DeliveryItem> deliveries;
  final bool isLoading;
  final Future<void> Function() onRefresh;
  final bool isDelivering;
  final Future<void> Function() onStartRoute;

  const DeliveryListTab({
    super.key,
    required this.deliveries,
    required this.isLoading,
    required this.onRefresh,
    required this.isDelivering,
    required this.onStartRoute,
  });

  @override
  State<DeliveryListTab> createState() => _DeliveryListTabState();
}

class _DeliveryListTabState extends State<DeliveryListTab> {
  final ImagePicker _picker = ImagePicker();
  bool _isUploadingPhoto = false;

  // 현장 사진 등록 모달 띄우기
  void _showUploadPhotoModal(BuildContext context) {
    if (widget.deliveries.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('배송처 데이터가 없습니다.')),
      );
      return;
    }

    DeliveryItem? selectedItem = widget.deliveries.first;
    XFile? pickedFile;

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return AlertDialog(
              title: const Text('현장 사진 등록', style: TextStyle(fontWeight: FontWeight.bold)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('배송처 선택', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  const SizedBox(height: 6),
                  DropdownButtonFormField<DeliveryItem>(
                    value: selectedItem,
                    items: widget.deliveries.map((item) {
                      return DropdownMenuItem<DeliveryItem>(
                        value: item,
                        child: Text(
                          '[${item.order ?? "-"}] ${item.name}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) {
                        setModalState(() {
                          selectedItem = val;
                        });
                      }
                    },
                    decoration: InputDecoration(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text('사진 촬영/첨부', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      ElevatedButton.icon(
                        onPressed: () async {
                          final file = await _picker.pickImage(
                            source: ImageSource.camera,
                            maxWidth: 1024,
                            maxHeight: 1024,
                            imageQuality: 75,
                          );
                          if (file != null) {
                            setModalState(() {
                              pickedFile = file;
                            });
                          }
                        },
                        icon: const Icon(Icons.camera_alt),
                        label: const Text('카메라 촬영'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0054A6),
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton.icon(
                        onPressed: () async {
                          final file = await _picker.pickImage(
                            source: ImageSource.gallery,
                            maxWidth: 1024,
                            maxHeight: 1024,
                            imageQuality: 75,
                          );
                          if (file != null) {
                            setModalState(() {
                              pickedFile = file;
                            });
                          }
                        },
                        icon: const Icon(Icons.photo_library),
                        label: const Text('앨범 선택'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.grey[200],
                          foregroundColor: Colors.black87,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                        ),
                      ),
                    ],
                  ),
                  if (pickedFile != null) ...[
                    const SizedBox(height: 12),
                    const Text('선택된 이미지 미리보기:', style: TextStyle(fontSize: 12, color: Colors.grey)),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.network(
                        pickedFile!.path, // Flutter Web/Desktop 호환성 및 로컬 경로
                        height: 150,
                        width: double.infinity,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const Icon(Icons.check_circle, size: 50, color: Colors.green),
                      ),
                    ),
                  ],
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('취소', style: TextStyle(color: Colors.grey)),
                ),
                ElevatedButton(
                  onPressed: _isUploadingPhoto
                      ? null
                      : () async {
                          if (pickedFile == null || selectedItem == null) return;
                          
                          setModalState(() {
                            _isUploadingPhoto = true;
                          });

                          try {
                            final bytes = await pickedFile!.readAsBytes();
                            final base64Image = 'data:image/jpeg;base64,${base64Encode(bytes)}';

                            final updatedImages = List<String>.from(selectedItem!.deliveryPlaceImages);
                            updatedImages.add(base64Image);
                            selectedItem!.deliveryPlaceImages = updatedImages;

                            final success = await ApiService.updateDeliveryPlace(selectedItem!);
                            if (success) {
                              if (context.mounted) {
                                Navigator.pop(context);
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('✅ 현장 사진이 성공적으로 등록되었습니다.'),
                                    backgroundColor: Colors.green,
                                  ),
                                );
                                widget.onRefresh();
                              }
                            }
                          } catch (e) {
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('업로드 실패: $e')),
                              );
                            }
                          } finally {
                            setModalState(() {
                              _isUploadingPhoto = false;
                            });
                          }
                        },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0054A6),
                    foregroundColor: Colors.white,
                  ),
                  child: _isUploadingPhoto
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : const Text('업로드'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (widget.deliveries.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.inbox_outlined, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text(
              '배송할 내역이 없습니다.',
              style: TextStyle(color: Colors.grey, fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: widget.onRefresh,
              child: const Text('다시 불러오기'),
            )
          ],
        ),
      );
    }

    // 첫 번째 대기중인 배송지를 활성화된 목적지로 지정 (테두리 굵기 강조)
    int? firstActiveId;
    try {
      firstActiveId = widget.deliveries.firstWhere(
        (d) => d.status != 'done' && d.status != 'excluded',
      ).id;
    } catch (_) {}

    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      child: Column(
        children: [
          // 1. 배송출발 대기 탑 액션 바
          if (!widget.isDelivering)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              color: Colors.white,
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: widget.onStartRoute,
                icon: const Icon(Icons.play_arrow, color: Colors.white),
                label: const Text(
                  '배송출발 (업무시작)',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.white),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0054A6),
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  elevation: 2,
                ),
              ),
            ),
          
          // 2. 배송 목록
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16.0),
              itemCount: widget.deliveries.length,
              itemBuilder: (context, index) {
                final item = widget.deliveries[index];
                final isActive = item.id == firstActiveId;
                
                return DeliveryCard(
                  item: item,
                  isActive: isActive,
                  onStateChanged: widget.onRefresh,
                );
              },
            ),
          ),
          
          // 3. 플로팅 카메라 모달 작동 트리거 단추
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: Colors.grey[200]!)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => _showUploadPhotoModal(context),
                    icon: const Icon(Icons.camera_alt, color: Colors.white),
                    label: const Text('현장 사진 등록', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF002D5A),
                      minimumSize: const Size.fromHeight(44),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
