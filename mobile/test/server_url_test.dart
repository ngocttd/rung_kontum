import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kontum_mobilegis/app/config.dart';
import 'package:kontum_mobilegis/core/session.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('bản cài cũ tự chuyển máy chủ localhost đã lưu sang HTTPS', () async {
    SharedPreferences.setMockInitialValues({'server_url': 'http://localhost:3000'});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(overrides: [prefsProvider.overrideWithValue(prefs)]);
    addTearDown(container.dispose);

    expect(container.read(serverUrlProvider), AppConfig.defaultApiBase);
    expect(prefs.getString('server_url'), AppConfig.defaultApiBase);
    expect(Uri.parse(container.read(serverUrlProvider)).scheme, 'https');
  });

  test('giữ địa chỉ HTTPS do người dùng đã chọn', () async {
    const server = 'https://field-api.example.test';
    SharedPreferences.setMockInitialValues({'server_url': server});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(overrides: [prefsProvider.overrideWithValue(prefs)]);
    addTearDown(container.dispose);

    expect(container.read(serverUrlProvider), server);
    expect(prefs.getString('server_url'), server);
  });
}
