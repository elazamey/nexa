#!/usr/bin/env bash
set -e

echo "🚀 Initializing NEXA AI OS Mesh Environment..."

# تثبيت الحزم والمكونات
npm install
npm --prefix dashboard install

# فحص سلامة محركات التشغيل المحلية المسجلة
npm run mesh:runtimes

# تشغيل الفحص السريع للسجل المشفر والأدلة
npm run mesh:verify

# تشغيل فحص الثوابت الأمنية
npm run audit

echo "✅ NEXA Cloud IDE is ready to build and govern!"
