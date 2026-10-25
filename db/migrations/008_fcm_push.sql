-- Thông báo đẩy chuyển sang Firebase Cloud Messaging (Android + iOS). PostgreSQL vẫn là nguồn sự thật
-- (thông báo, trạng thái giao, hàng đợi gửi lại); Socket.IO vẫn giao tức thời khi ứng dụng đang mở.
-- push_endpoint = FCM registration token; push_keys / push_env (Web Push, APNs trực tiếp) không còn dùng.

-- thiết bị đã đăng ký kênh cũ (APNs trực tiếp, UnifiedPush/Web Push) phải đăng ký lại bằng FCM khi mở ứng dụng
UPDATE mobile.mobile_devices SET push_provider = NULL, push_endpoint = NULL, push_keys = NULL, push_env = NULL, push_enabled = false
  WHERE push_provider IS NOT NULL AND push_provider <> 'fcm';
ALTER TABLE mobile.mobile_devices DROP CONSTRAINT IF EXISTS mobile_devices_push_provider_check;
ALTER TABLE mobile.mobile_devices ADD CONSTRAINT mobile_devices_push_provider_check CHECK (push_provider IN ('fcm'));
COMMENT ON COLUMN mobile.mobile_devices.push_endpoint IS 'FCM registration token';

-- bản giao đang chờ của kênh cũ: không gửi nữa (giữ lịch sử)
UPDATE mobile.notification_deliveries SET status = 'skipped', last_error = 'Kênh push cũ – đã chuyển sang FCM'
  WHERE status = 'pending' AND channel IN ('apns', 'webpush');
ALTER TABLE mobile.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE mobile.notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('socket', 'fcm', 'apns', 'webpush'));

-- loại thông báo cho cán bộ: phản ánh mới / tin báo cháy nhập tay chờ xác minh
ALTER TABLE mobile.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE mobile.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('fire_danger', 'fire_confirmed', 'fire_report', 'report', 'report_new', 'assignment', 'verification', 'system'));
