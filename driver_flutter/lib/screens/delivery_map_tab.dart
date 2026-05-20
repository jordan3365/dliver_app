import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import '../models/delivery_item.dart';

class DeliveryMapTab extends StatefulWidget {
  final List<DeliveryItem> deliveries;
  final Position? currentPosition;
  final VoidCallback onRefresh;

  const DeliveryMapTab({
    super.key,
    required this.deliveries,
    this.currentPosition,
    required this.onRefresh,
  });

  @override
  State<DeliveryMapTab> createState() => _DeliveryMapTabState();
}

class _DeliveryMapTabState extends State<DeliveryMapTab> {
  final MapController _mapController = MapController();
  List<LatLng> _routePoints = [];
  bool _isLoadingRoute = false;

  // 본사 고정 좌표
  static final LatLng hqLatLng = const LatLng(37.556898, 127.206401);

  @override
  void initState() {
    super.initState();
    _loadRoadRoute();
  }

  @override
  void didUpdateWidget(covariant DeliveryMapTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 배송 데이터 개수나 순서가 바뀐 경우 경로 재생성
    if (oldWidget.deliveries.length != widget.deliveries.length ||
        oldWidget.deliveries.firstOrNull?.status != widget.deliveries.firstOrNull?.status) {
      _loadRoadRoute();
    }
  }

  // OSRM API를 호출하여 도로 기반 최적 경로 Polyline 수집
  Future<void> _loadRoadRoute() async {
    final activeDeliveries = widget.deliveries
        .where((d) => d.status != 'excluded')
        .toList();

    if (activeDeliveries.isEmpty) {
      setState(() {
        _routePoints = [];
      });
      return;
    }

    setState(() {
      _isLoadingRoute = true;
    });

    try {
      // 본사 -> 1순번 -> 2순번 -> ... -> 본사 형태의 경유 좌표 조립
      final List<LatLng> coordsList = [hqLatLng];
      for (var d in activeDeliveries) {
        coordsList.add(LatLng(d.latitude, d.longitude));
      }
      coordsList.add(hqLatLng);

      final String coordsString = coordsList
          .map((latlng) => '${latlng.longitude},${latlng.latitude}')
          .join(';');

      final url = Uri.parse(
        'https://router.project-osrm.org/route/v1/driving/$coordsString?overview=full&geometries=geojson',
      );

      final response = await http.get(url).timeout(const Duration(seconds: 15));
      if (response.statusCode == 200) {
        final decoded = json.decode(response.body);
        if (decoded['code'] == 'Ok') {
          final List<dynamic> coordinates =
              decoded['routes'][0]['geometry']['coordinates'];
          
          final List<LatLng> roadPoints = coordinates.map((c) {
            return LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble());
          }).toList();

          setState(() {
            _routePoints = roadPoints;
          });
        }
      }
    } catch (_) {
      // 실패 시 직선 경로로 대체
      final List<LatLng> fallbackPoints = [hqLatLng];
      for (var d in activeDeliveries) {
        fallbackPoints.add(LatLng(d.latitude, d.longitude));
      }
      fallbackPoints.add(hqLatLng);
      setState(() {
        _routePoints = fallbackPoints;
      });
    } finally {
      setState(() {
        _isLoadingRoute = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // 1. 지도상 마커 리스트 조립
    final List<Marker> markers = [];

    // 본사 마커
    markers.add(
      Marker(
        point: hqLatLng,
        width: 45,
        height: 45,
        child: Stack(
          alignment: Alignment.center,
          children: [
            const Icon(Icons.house_siding, color: Color(0xFF6C5CE7), size: 38),
            Positioned(
              top: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                decoration: BoxDecoration(
                  color: const Color(0xFF6C5CE7),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text(
                  '본사',
                  style: TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.bold),
                ),
              ),
            )
          ],
        ),
      ),
    );

    // 배송지 마커들
    for (var item in widget.deliveries) {
      if (item.status == 'excluded') continue;

      final bool isDone = item.status == 'done';
      final Color pinColor = isDone ? const Color(0xFF2ECC71) : const Color(0xFF0054A6);

      markers.add(
        Marker(
          point: LatLng(item.latitude, item.longitude),
          width: 40,
          height: 40,
          child: GestureDetector(
            onTap: () {
              // 팝업 상세 모달 띄우기
              showDialog(
                context: context,
                builder: (context) => AlertDialog(
                  title: Text(item.name, style: const TextStyle(fontWeight: FontWeight.bold)),
                  content: Text(
                    '주소: ${item.address1} ${item.address2 ?? ""}\n'
                    '배송수량: ${item.boxCount} 박스\n'
                    '상태: ${isDone ? "배송완료" : "배송대기"}',
                    style: const TextStyle(fontSize: 13),
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('닫기'),
                    )
                  ],
                ),
              );
            },
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(Icons.location_on, color: pinColor, size: 36),
                Positioned(
                  top: 6,
                  child: Text(
                    isDone ? 'V' : '${item.order ?? "-"}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    // 기사님 현재 차량 마커
    if (widget.currentPosition != null) {
      final carPos = LatLng(widget.currentPosition!.latitude, widget.currentPosition!.longitude);
      markers.add(
        Marker(
          point: carPos,
          width: 44,
          height: 44,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFF0054A6), width: 3),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF0054A6).withOpacity(0.3),
                      blurRadius: 8,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: const Icon(Icons.local_shipping, color: Color(0xFF0054A6), size: 18),
              ),
              Positioned(
                top: -8,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFF2ECC71),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text(
                    'LIVE',
                    style: TextStyle(color: Colors.white, fontSize: 7, fontWeight: FontWeight.bold),
                  ),
                ),
              )
            ],
          ),
        ),
      );
    }

    return Stack(
      children: [
        // 1. OSM Map
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(
            initialCenter: widget.currentPosition != null
                ? LatLng(widget.currentPosition!.latitude, widget.currentPosition!.longitude)
                : hqLatLng,
            initialZoom: 13.5,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              subdomains: const ['a', 'b', 'c'],
            ),
            // OSRM 실제 도로 polyline 그리기
            if (_routePoints.isNotEmpty)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: _routePoints,
                    color: const Color(0xFF0054A6).withOpacity(0.8),
                    strokeWidth: 5.0,
                    isDotted: false,
                  ),
                ],
              ),
            MarkerLayer(markers: markers),
          ],
        ),

        // 2. 우측 하단 현재 위치로 이동 및 새로고침 플로팅 버튼들
        Positioned(
          bottom: 16,
          right: 16,
          child: Column(
            children: [
              FloatingActionButton(
                heroTag: 'map_refresh',
                mini: true,
                onPressed: () {
                  widget.onRefresh();
                  _loadRoadRoute();
                },
                backgroundColor: Colors.white,
                child: _isLoadingRoute
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh, color: Colors.black87),
              ),
              const SizedBox(height: 10),
              FloatingActionButton(
                heroTag: 'map_gps',
                mini: true,
                onPressed: () {
                  if (widget.currentPosition != null) {
                    _mapController.move(
                      LatLng(
                        widget.currentPosition!.latitude,
                        widget.currentPosition!.longitude,
                      ),
                      16.0,
                    );
                  } else {
                    _mapController.move(hqLatLng, 13.5);
                  }
                },
                backgroundColor: const Color(0xFF0054A6),
                child: const Icon(Icons.my_location, color: Colors.white),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
