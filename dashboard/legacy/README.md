# `dashboard/legacy/` — صفحات موازية غير بناءة

لا تُعرَّب هذه الملفات ولا تُحدَّث آليًا، ولا تدخل `dashboard/dist/`. السبب ليس تصادم بناء —
قِيس أن Vite 5 لا ينسخ `public/index.html` فوق مدخله ولا يُحذّر، والسيرفر يحلّ `/index.html` من
`dashboard/dist`؛ فالنسخة القديمة كانت **ميتة قابلة للتحرير**: عدّلها أحدٌ فتبدو محدَّثة ولا أحد
يقرأها. تُخدَم من `tools/celia-dashboard-server.mjs` عند مسارها الخاص، وتُذكر صراحةً أنها ليست البناء.

| الملف | كان | صار | لماذا |
|:---|:---|:---|:---|
| `static-dashboard.html` | `dashboard/public/index.html` | `GET /dashboard-static.html` (أو `/static`) | نسخة ساكنة من اللوحة تقرأ `/api/celia/state` مباشرةً؛ ليست مدخل Vite (`dashboard/index.html` هو الإنتاجي)، وبقيت للاطلاع والمقارنة فقط |

الحارس: `tests/duplicate-sync.test.js` — يقطع إذا رجع اسم `index.html` إلى `dashboard/public/`،
أو إذ تُرِكَت نسخة ظلّ بلا مصدر مُعلَن في `tools/sync-dashboard-assets.mjs`.
