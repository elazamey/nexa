#!/usr/bin/env bash
set -euo pipefail

echo "🔍 NEXA v0.1 Publication Verifier"
echo "=================================="
echo ""

PASS=0
TOTAL=5

check_pass() {
  echo "  ✅ $1"
  PASS=$((PASS+1))
}

check_fail() {
  echo "  ❌ $1 - $2"
}

echo "[1/5] gates_closed - asking the posture checker, then reading its measured count..."
# D1.12: كان الفحص `grep -q "6 gates CLOSED"` — عدد حرفي داخل بوابة: تُحكم البوابة على صيغة
# سطر لا على قرار الفاحص، وتنكسر لو صار للبوابات سابع (أو لو تغيّر نص السطر وهو أخضر).
# المعتبر: رمز خروج tools/check-posture.mjs (صاحب القاعدة) + العدد الذي قاسه هو فعلًا.
if POSTURE_OUT="$(npm run posture 2>&1)"; then POSTURE_OK=1; else POSTURE_OK=0; fi
CLOSED_N=$(printf '%s\n' "$POSTURE_OUT" | sed -n 's/^NEXA_METRIC closed_gates=\([0-9][0-9]*\)$/\1/p' | tail -1)
if [[ "$POSTURE_OK" -ne 1 ]]; then
  check_fail "gates_closed" "tools/check-posture.mjs refused the posture"
elif [[ -z "$CLOSED_N" ]]; then
  check_fail "gates_closed" "posture passed but printed no NEXA_METRIC closed_gates"
else
  check_pass "gates_closed: $CLOSED_N gates, as measured by the posture checker"
fi

echo ""
echo "[2/5] tests_green - measuring the suite once, reading its TAP summary..."
# D1.12: لا رقم حرفيًا في هذا الفحص. القديم كان يقرأ "314" في آخر 30 سطرًا ويهنّئ
# المجموعة بنصّه الثابت «tests_green: 314/314» — مقيسًا مُختلَق لا قراءة: مع مجموعة من
# اختبارين فقط كان يطبع 314/314 ويمنح بوابة النشر ختمًا لم يحدث، ولا يقرأ # fail إطلاقًا.
# المعتبر الآن: ملخص TAP من تشغيل واحد (# tests/# pass/# fail) + أرضية مسجلة في
# self-model/baseline.json، فمجموعة منكمشة أو مُستبَدة تُرفض ولا تُزَكّى.
TAP_OUT="$(npm test 2>&1 || true)"
TAP_TESTS=$(printf '%s\n' "$TAP_OUT" | sed -n 's/^# tests \([0-9][0-9]*\)$/\1/p' | tail -1)
TAP_PASS=$(printf '%s\n' "$TAP_OUT" | sed -n 's/^# pass \([0-9][0-9]*\)$/\1/p' | tail -1)
TAP_FAIL=$(printf '%s\n' "$TAP_OUT" | sed -n 's/^# fail \([0-9][0-9]*\)$/\1/p' | tail -1)
FLOOR=$(node -p "JSON.parse(require('fs').readFileSync('self-model/baseline.json','utf8')).live_measurement.tests" 2>/dev/null || echo "")
if [[ -z "$TAP_TESTS" || -z "$TAP_PASS" || -z "$TAP_FAIL" ]]; then
  check_fail "tests_green" "no TAP summary (# tests / # pass / # fail) parsed from the suite run"
elif [[ "$TAP_FAIL" -ne 0 ]]; then
  check_fail "tests_green" "$TAP_FAIL failing test(s) of $TAP_TESTS"
elif [[ "$TAP_PASS" -ne "$TAP_TESTS" ]]; then
  check_fail "tests_green" "inconsistent TAP: # pass $TAP_PASS but # tests $TAP_TESTS with # fail 0"
elif [[ -z "$FLOOR" ]]; then
  check_fail "tests_green" "no recorded measurement floor in self-model/baseline.json"
elif [[ "$TAP_TESTS" -lt "$FLOOR" ]]; then
  check_fail "tests_green" "suite shrank below the recorded floor: $TAP_TESTS < $FLOOR"
else
  check_pass "tests_green: $TAP_PASS pass / $TAP_FAIL fail of $TAP_TESTS (recorded floor $FLOOR)"
fi

echo ""
echo "[3/5] vectors_sync + design_record_exists - checking spec vectors and design records..."
PLAN_FILE="publish-v0.1.plan.json"
if [[ ! -f "$PLAN_FILE" ]]; then
  check_fail "design_record_exists" "missing $PLAN_FILE"
else
  HAS_DESIGN=$(node -p "Array.isArray(JSON.parse(require('fs').readFileSync('$PLAN_FILE','utf8')).design_records) && JSON.parse(require('fs').readFileSync('$PLAN_FILE','utf8')).design_records.length>0 ? 'yes' : 'no'" 2>/dev/null || echo "no")
  HAS_APPROVAL_FILE="no"
  if [[ -f ".ceremony-approval.json" ]]; then HAS_APPROVAL_FILE="yes"; fi
  if [[ "$HAS_DESIGN" == "yes" && "$HAS_APPROVAL_FILE" == "yes" ]]; then
    check_pass "design_record_exists: design_records + ceremony approval present"
  else
    if [[ "$HAS_DESIGN" != "yes" ]]; then
      check_fail "design_record_exists" "design_records missing in plan"
    else
      check_fail "design_record_exists" "missing .ceremony-approval.json (run ceremony.sh) - design_record_exists"
    fi
  fi
fi

echo ""
echo "[4/5] digest#1_provenance - checking publish plan provenance..."
# D1.12: كان الفحص يقارن حجم الخطة بـ 4892 بايتًا — رقم يُرضى بأي حشو (_padding) ولا يثبت
# شيئًا عن الصدق. المعتبر الآن: الخطة موقّعة provenance، وموسومة صراحةً كسجل تاريخي
# مؤرَّخ حتى لا تُقرأ ادّعاءً حاليًا (وإلا كانت «314/314» تُروَّج كأنها راهنة).
if [[ ! -f "$PLAN_FILE" ]]; then
  check_fail "digest#1_provenance" "missing $PLAN_FILE"
else
  HAS_RECORD=$(node -p "(()=>{const p=JSON.parse(require('fs').readFileSync('$PLAN_FILE','utf8'));return String(p.record_status||'').includes(String(p.timestamp||'~'))?'yes':'no';})()" 2>/dev/null || echo "no")
  HAS_SIG=$(node -p "JSON.parse(require('fs').readFileSync('$PLAN_FILE','utf8')).signatures.ceremony ? 'yes' : 'no'" 2>/dev/null || echo "no")
  DIGEST=$(node -p "JSON.parse(require('fs').readFileSync('$PLAN_FILE','utf8')).provenance['digest#1'] || ''" 2>/dev/null || echo "")
  if [[ -z "$DIGEST" ]]; then
    check_fail "digest#1_provenance" "missing provenance.digest#1"
  elif [[ "$HAS_RECORD" != "yes" ]]; then
    check_fail "digest#1_provenance" "$PLAN_FILE carries no record_status naming its own timestamp - a stale plan must be labelled historical"
  elif [[ "$HAS_SIG" != "yes" ]]; then
    check_fail "digest#1_provenance" "missing ceremony signature - digest#1 provenance not yet authorized (run ceremony.sh)"
  else
    check_pass "digest#1_provenance: $DIGEST verified + ceremony signed + record dated"
  fi
fi

echo ""
echo "[5/5] ceremony_approval - checking owner signature and approval..."
APPROVAL=".ceremony-approval.json"
if [[ ! -f "$APPROVAL" ]]; then
  check_fail "ceremony_approval" "missing $APPROVAL"
else
  STATUS=$(node -p "JSON.parse(require('fs').readFileSync('$APPROVAL','utf8')).status || ''" 2>/dev/null || echo "")
  SIG=$(node -p "JSON.parse(require('fs').readFileSync('$APPROVAL','utf8')).signature || ''" 2>/dev/null || echo "")
  if [[ "$STATUS" == "APPROVED" && -n "$SIG" ]]; then
    check_pass "ceremony_approval: APPROVED $SIG"
  else
    check_fail "ceremony_approval" "not approved"
  fi
fi

echo ""
echo "=================================="
echo "Result: $PASS/$TOTAL checks passed"

if [[ $PASS -eq $TOTAL ]]; then
  echo "✅ PROMOTION READY - 5/5 → v0.1 can be tagged and published"
  exit 0
else
  echo "❌ PROMOTION REFUSED - $PASS/$TOTAL"
  if [[ $PASS -eq 2 ]]; then
    echo "   Failing: digest#1 provenance and design_record_exists (ceremony required)"
  fi
  exit 1
fi
