import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'models/driver.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 로그인 세션 잔존 여부 파악
  final prefs = await SharedPreferences.getInstance();
  final authUserStr = prefs.getString('authUser');
  
  Driver? savedDriver;
  if (authUserStr != null) {
    try {
      final Map<String, dynamic> decoded = json.decode(authUserStr);
      savedDriver = Driver.fromJson(decoded);
    } catch (_) {}
  }

  runApp(MyApp(initialDriver: savedDriver));
}

class MyApp extends StatelessWidget {
  final Driver? initialDriver;

  const MyApp({super.key, this.initialDriver});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '착한식판 기사앱 (Flutter)',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        primaryColor: const Color(0xFF0054A6), // Coupang Blue
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0054A6),
          primary: const Color(0xFF0054A6),
          secondary: const Color(0xFF002D5A),
          surface: Colors.white,
        ),
        scaffoldBackgroundColor: const Color(0xFFF2F4F7),
        cardTheme: const CardTheme(
          color: Colors.white,
          surfaceTintColor: Colors.transparent,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0054A6),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
        fontFamily: 'Pretendard', // 앱 전반에 프리미엄 폰트 가중치 적용 지시
      ),
      home: initialDriver != null
          ? HomeScreen(driver: initialDriver!)
          : const LoginScreen(),
    );
  }
}
