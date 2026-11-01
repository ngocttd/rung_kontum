// Cấu hình công khai tải từ Firebase project even-metrics-413108.
// Không chứa khóa service account/APNs. Đổi môi trường bằng dart-define nếu cần.
import 'package:firebase_core/firebase_core.dart';

class KonTumFirebaseOptions {
  KonTumFirebaseOptions._();
  static const ios = FirebaseOptions(
    apiKey: "AIzaSyDZ8892ekybkkfRVcqhpohhh5ndgrxHeZ4",
    appId: "1:315105906364:ios:d44716f1cb166a35c10ab9",
    messagingSenderId: "315105906364",
    projectId: "even-metrics-413108",
    storageBucket: "even-metrics-413108.firebasestorage.app",
    iosBundleId: "vn.gov.kontum.mobilegis",
  );
  static const android = FirebaseOptions(
    apiKey: "AIzaSyDEUeB1-CNe2VXjRfagTd7NJfDz6CaSPZc",
    appId: "1:315105906364:android:4d942c85ba243dfdc10ab9",
    messagingSenderId: "315105906364",
    projectId: "even-metrics-413108",
    storageBucket: "even-metrics-413108.firebasestorage.app",
  );
}
