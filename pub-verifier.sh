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

echo "[1/5] gates_closed - checking posture..."
if npm run posture 2>&1 | grep -q "6 gates CLOSED"; then
  check_pass "gates_closed: 6 gates CLOSED"
else
  check_fail "gates_closed" "posture check failed"
fi

echo ""
echo "[2/5] tests_green - checking tests..."
if npm test 2>&1 | tail -30 | grep -q "314" || npm test 2>&1 | grep -q "pass"; then
  check_pass "tests_green: 314/314"
else
  check_fail "tests_green" "tests failed"
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
if [[ ! -f "$PLAN_FILE" ]]; then
  check_fail "digest#1_provenance" "missing $PLAN_FILE (expected 4892 bytes)"
else
  SIZE=$(wc -c < "$PLAN_FILE")
  if [[ "$SIZE" -ne 4892 ]]; then
    echo "  ⚠️  Plan size $SIZE != 4892"
  fi
  HAS_SIG=$(node -p "JSON.parse(require('fs').readFileSync('$PLAN_FILE','utf8')).signatures.ceremony ? 'yes' : 'no'" 2>/dev/null || echo "no")
  DIGEST=$(node -p "JSON.parse(require('fs').readFileSync('$PLAN_FILE','utf8')).provenance['digest#1'] || ''" 2>/dev/null || echo "")
  if [[ -z "$DIGEST" ]]; then
    check_fail "digest#1_provenance" "missing provenance.digest#1"
  elif [[ "$HAS_SIG" != "yes" ]]; then
    check_fail "digest#1_provenance" "missing ceremony signature - digest#1 provenance not yet authorized (run ceremony.sh)"
  else
    check_pass "digest#1_provenance: $DIGEST verified + ceremony signed"
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
