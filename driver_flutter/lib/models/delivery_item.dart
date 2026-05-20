class DeliveryItem {
  final int id;
  final String name;
  final String address1;
  final String? address2;
  final String phone;
  final String? memo;
  int boxCount;
  double latitude;
  double longitude;
  final String? course;
  final int? order;
  String status; // 'pending', 'delivering', 'done', 'excluded'
  List<String> deliveryPlaceImages;

  DeliveryItem({
    required this.id,
    required this.name,
    required this.address1,
    this.address2,
    required this.phone,
    this.memo,
    required this.boxCount,
    required this.latitude,
    required this.longitude,
    this.course,
    this.order,
    required this.status,
    required this.deliveryPlaceImages,
  });

  factory DeliveryItem.fromJson(Map<String, dynamic> json) {
    // API 응답의 타입 불일치 방어코드
    int parsedId = 0;
    if (json['id'] is int) {
      parsedId = json['id'];
    } else if (json['id'] is String) {
      parsedId = int.tryParse(json['id']) ?? 0;
    }

    int parsedBoxCount = 1;
    if (json['boxCount'] is int) {
      parsedBoxCount = json['boxCount'];
    } else if (json['boxCount'] is String) {
      parsedBoxCount = int.tryParse(json['boxCount']) ?? 1;
    }

    double parsedLat = 37.556898; // 기본값 본사 위도
    if (json['latitude'] != null) {
      if (json['latitude'] is num) {
        parsedLat = (json['latitude'] as num).toDouble();
      } else if (json['latitude'] is String) {
        parsedLat = double.tryParse(json['latitude']) ?? 37.556898;
      }
    }

    double parsedLng = 127.206401; // 기본값 본사 경도
    if (json['longitude'] != null) {
      if (json['longitude'] is num) {
        parsedLng = (json['longitude'] as num).toDouble();
      } else if (json['longitude'] is String) {
        parsedLng = double.tryParse(json['longitude']) ?? 127.206401;
      }
    }

    int? parsedOrder;
    if (json['order'] != null) {
      if (json['order'] is int) {
        parsedOrder = json['order'];
      } else if (json['order'] is String) {
        parsedOrder = int.tryParse(json['order']);
      }
    }

    // 이미지 필드 처리 (구글 드라이브 주소 또는 Base64)
    List<String> images = [];
    if (json['deliveryPlaceImages'] != null) {
      if (json['deliveryPlaceImages'] is List) {
        images = List<String>.from(json['deliveryPlaceImages'].map((e) => e.toString()));
      } else if (json['deliveryPlaceImages'] is String) {
        if (json['deliveryPlaceImages'].toString().isNotEmpty) {
          images = [json['deliveryPlaceImages'].toString()];
        }
      }
    }

    return DeliveryItem(
      id: parsedId,
      name: json['name'] ?? '이름없음',
      address1: json['address1'] ?? '',
      address2: json['address2'],
      phone: json['phone'] ?? '',
      memo: json['memo'],
      boxCount: parsedBoxCount,
      latitude: parsedLat,
      longitude: parsedLng,
      course: json['course']?.toString(),
      order: parsedOrder,
      status: json['status'] ?? 'pending',
      deliveryPlaceImages: images,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'address1': address1,
      'address2': address2,
      'phone': phone,
      'memo': memo,
      'boxCount': boxCount,
      'latitude': latitude,
      'longitude': longitude,
      'course': course,
      'order': order,
      'status': status,
      'deliveryPlaceImages': deliveryPlaceImages,
    };
  }
}
