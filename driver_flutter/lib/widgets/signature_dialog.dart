import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:signature/signature.dart';

class SignatureDialog extends StatefulWidget {
  const SignatureDialog({super.key});

  @override
  State<SignatureDialog> createState() => _SignatureDialogState();
}

class _HomeScreenState extends State<SignatureDialog> {
  // state template
}

class _SignatureDialogState extends State<SignatureDialog> {
  late final SignatureController _controller;

  @override
  void initState() {
    super.initState();
    _controller = SignatureController(
      penStrokeWidth: 4,
      penColor: const Color(0xFF2D3436),
      exportBackgroundColor: Colors.white,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _handleConfirm() async {
    if (_controller.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('서명을 남겨주세요.')),
      );
      return;
    }

    final Uint8List? data = await _controller.toPngBytes();
    if (data != null) {
      final base64String = 'data:image/png;base64,${base64Encode(data)}';
      if (mounted) {
        Navigator.pop(context, base64String);
      }
    } else {
      if (mounted) {
        Navigator.pop(context, "");
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Icon(Icons.gesture, color: Colors.green),
                const SizedBox(width: 8),
                const Text(
                  '배송 완료 서명 및 검증',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              '아래 영역에 터치로 서명을 받아주세요.',
              style: TextStyle(
                fontSize: 13,
                color: Color(0xFF1D2129),
              ),
            ),
            const SizedBox(height: 12),
            // Signature Canvas Area
            Container(
              decoration: BoxDecoration(
                border: Border.all(color: const Color(0xFFE5E9F0)),
                borderRadius: BorderRadius.circular(12),
              ),
              clipBehavior: Clip.antiAlias,
              child: Signature(
                controller: _controller,
                height: 160,
                width: double.infinity,
                backgroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 16),
            // Actions
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      _controller.clear();
                    },
                    icon: const Icon(Icons.cleaning_services, size: 16, color: Colors.red),
                    label: const Text('지우기', style: TextStyle(color: Colors.red)),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Colors.red),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _handleConfirm,
                    icon: const Icon(Icons.check_circle, size: 16, color: Colors.white),
                    label: const Text('완료 처리', style: TextStyle(color: Colors.white)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('취소', style: TextStyle(color: Colors.grey)),
            ),
          ],
        ),
      ),
    );
  }
}
