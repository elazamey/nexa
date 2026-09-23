# `dashboard/legacy/` — صفحات موازية غير بناءة

لا تُعرَّب هذه الملفات ولا تُحدَّث آليًا، ولا تدخل `dashboard/dist/` (فوق `publicDir` كانت
تتصادم مع `index.html` الإنتاجي). تُخدَم من `tools/celia-dashboard-server.mjs` عند مسارها
الخاص، وتُذكر صراحةً أنها ليست البناء.

| الملف | كان | صار | لماذا |
|:---|:---|:---|:---|
| `static-dashboard.html` | `dashboard/public/index.html` | `GET /dashboard-static.html` (أو `/static`) | نسخة ساكنة من اللوحة تقرأ `/api/celia/state` مباشرةً؛ ليست مدخل Vite (`dashboard/index.html` هو الإنتاجي)، وبقيت للاطلاع والمقارنة فقط |

الحارس: `tests/duplicate-sync.test.js` — يقطع إذا رجع اسم `index.html` إلى `dashboard/public/`،
أو إذ تُرِكَت نسخة ظلّ بلا مصدر مُعلَن في `tools/sync-dashboard-assets.mjs`.
