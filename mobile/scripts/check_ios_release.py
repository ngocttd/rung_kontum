#!/usr/bin/env python3
"""Kiểm tra cấu hình build iOS; không in API key/token ra log."""
import argparse
import ipaddress
import json
from pathlib import Path
import plistlib
import re
import struct
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def validate(config):
    errors = []
    for key in ('API_BASE_URL', 'PRIVACY_POLICY_URL', 'ACCOUNT_DELETION_URL'):
        value = config.get(key, '')
        url = urlsplit(value if isinstance(value, str) else '')
        host = url.hostname or ''
        valid = url.scheme == 'https' and '.' in host and not url.username and not url.password
        valid = valid and not any(x in host.lower() for x in ('localhost', 'example.', 'your_', '.local', '<', '>'))
        try:
            valid = valid and ipaddress.ip_address(host).is_global
        except ValueError:
            pass
        if key == 'API_BASE_URL' and (url.query or url.fragment):
            valid = False
        if not valid:
            errors.append(f'{key}: cần URL HTTPS chính thức, truy cập công khai.')
    if str(config.get('DEMO_LOGIN')).lower() != 'false':
        errors.append('DEMO_LOGIN: phải là false.')
    project = config.get('FIREBASE_PROJECT_ID', '')
    if not isinstance(project, str) or not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project):
        errors.append('FIREBASE_PROJECT_ID: thiếu hoặc không hợp lệ.')
    sender = str(config.get('FIREBASE_SENDER_ID', ''))
    app_id = str(config.get('FIREBASE_IOS_APP_ID', ''))
    if not sender.isdigit() or not re.fullmatch(r'1:' + re.escape(sender) + r':ios:[a-fA-F0-9]+', app_id):
        errors.append('FIREBASE_IOS_APP_ID / FIREBASE_SENDER_ID: thiếu hoặc không cùng sender ID.')
    if not re.fullmatch(r'AIza[\w-]{35}', str(config.get('FIREBASE_IOS_API_KEY', ''))):
        errors.append('FIREBASE_IOS_API_KEY: cần API key iOS từ Firebase.')
    pbx = (ROOT / 'ios/Runner.xcodeproj/project.pbxproj').read_text()
    bundles = set(re.findall(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', pbx))
    bundle = config.get('FIREBASE_IOS_BUNDLE_ID')
    if not bundle or bundle not in bundles or bundle.endswith('.RunnerTests'):
        errors.append('FIREBASE_IOS_BUNDLE_ID: phải trùng Bundle ID Runner trong Xcode.')
    for key in config:
        if any(x in key.lower() for x in ('private_key', 'service_account', 'client_secret')):
            errors.append(f'{key}: cấu hình máy chủ/bí mật không được đóng gói vào ứng dụng.')
    info = plistlib.loads((ROOT / 'ios/Runner/Info.plist').read_bytes())
    if info.get('FirebaseAppDelegateProxyEnabled') is False:
        errors.append('Firebase swizzling đang bị tắt.')
    if 'remote-notification' not in info.get('UIBackgroundModes', []):
        errors.append('Thiếu background mode remote-notification.')
    entitlements = plistlib.loads((ROOT / 'ios/Runner/RunnerRelease.entitlements').read_bytes())
    if entitlements.get('aps-environment') != 'production':
        errors.append('Release phải dùng aps-environment=production.')
    icons = ROOT / 'ios/Runner/Assets.xcassets/AppIcon.appiconset'
    for entry in json.loads((icons / 'Contents.json').read_text())['images']:
        filename = entry.get('filename')
        if not filename:
            continue
        path = icons / filename
        if not path.is_file():
            errors.append(f'Thiếu icon {filename}.')
            continue
        png = path.read_bytes()
        if png[:8] != b'\x89PNG\r\n\x1a\n':
            errors.append(f'Icon {filename} không phải PNG.')
            continue
        width, height = struct.unpack('>II', png[16:24])
        expected = round(float(entry['size'].split('x')[0]) * float(entry['scale'][:-1]))
        if (width, height) != (expected, expected):
            errors.append(f'Icon {filename} sai kích thước.')
        # IHDR color type 4/6 có alpha; indexed PNG cũng có thể có chunk tRNS.
        offset, transparent = 8, png[25] in (4, 6)
        while offset + 12 <= len(png):
            length = int.from_bytes(png[offset:offset + 4], 'big')
            transparent |= png[offset + 4:offset + 8] == b'tRNS'
            offset += length + 12
        if transparent:
            errors.append(f'Icon {filename} có alpha/transparency, cần xuất PNG nền kín.')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text())
        if not isinstance(config, dict):
            raise ValueError('Cấu hình phải là JSON object')
        errors = validate(config)
    except (OSError, ValueError) as error:
        print(f'Không đọc được cấu hình: {error}', file=sys.stderr)
        return 1
    for error in errors:
        print(f'FAIL: {error}', file=sys.stderr)
    if errors:
        return 1
    print('PASS: cấu hình build iOS. Cần kiểm tra website xóa tài khoản, signing và push thật qua TestFlight theo APP_STORE.md.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
