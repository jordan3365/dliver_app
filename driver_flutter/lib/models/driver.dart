class Driver {
  final int id;
  final String username;
  final String name;
  final String course;
  final String? phone;
  final String? token;
  final String? role;

  Driver({
    required this.id,
    required this.username,
    required this.name,
    required this.course,
    this.phone,
    this.token,
    this.role,
  });

  factory Driver.fromJson(Map<String, dynamic> json) {
    int parsedId = 0;
    if (json['id'] is int) {
      parsedId = json['id'];
    } else if (json['id'] is String) {
      parsedId = int.tryParse(json['id']) ?? 0;
    }

    return Driver(
      id: parsedId,
      username: json['username'] ?? '',
      name: json['name'] ?? '',
      course: json['course']?.toString() ?? '',
      phone: json['phone'],
      token: json['token'],
      role: json['role'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'username': username,
      'name': name,
      'course': course,
      'phone': phone,
      'token': token,
      'role': role,
    };
  }
}
