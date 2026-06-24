#!/usr/bin/env bash
# admin-invoke.sh — orchestrator Lambda의 admin 내부 resolver(_seed/_cleanup)를
# 직접 호출한다. 이 resolver들은 AppSync 스키마에 노출되지 않으므로 `aws lambda
# invoke`로만 부른다(Lambda 실행 역할의 테이블 write 권한을 빌림 → 직접 DynamoDB
# 권한 불필요).
#
# 사용법:
#   scripts/admin-invoke.sh _cleanup                 # 누적된 CREATED 고아 콜 정리
#   scripts/admin-invoke.sh _seed                    # 데모 데이터 전체 시드
#   scripts/admin-invoke.sh _seed '{"what":"queue"}' # 큐만 재시드
#
# 함수명은 CDK 스택 출력(OrchestratorName)에서 자동 해석. 환경변수로 덮어쓰기 가능:
#   ORCHESTRATOR_FN=내함수명  scripts/admin-invoke.sh _cleanup
#   STACK_NAME=HkthonStack    (기본값)
set -euo pipefail

FIELD="${1:?usage: admin-invoke.sh <_cleanup|_seed> [extra-args-json]}"
EXTRA="${2:-{}}"
STACK_NAME="${STACK_NAME:-HkthonStack}"

# 함수명 해석: 명시 env 우선, 없으면 스택 출력에서 조회.
FN="${ORCHESTRATOR_FN:-}"
if [[ -z "$FN" ]]; then
  FN=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='OrchestratorName'].OutputValue" \
        --output text)
fi
if [[ -z "$FN" || "$FN" == "None" ]]; then
  echo "오류: orchestrator 함수명을 찾지 못했습니다. ORCHESTRATOR_FN을 직접 지정하세요." >&2
  exit 1
fi

# _seed/_cleanup은 args를 fieldName과 같은 레벨에서 읽으므로 EXTRA를 머지한다.
PAYLOAD=$(printf '{"fieldName":"%s","arguments":%s}' "$FIELD" "$EXTRA")
echo "→ invoke $FN field=$FIELD payload=$PAYLOAD" >&2

OUT=$(mktemp)
aws lambda invoke \
  --function-name "$FN" \
  --cli-binary-format raw-in-base64-out \
  --payload "$PAYLOAD" \
  "$OUT" >/dev/null

echo "← response:" >&2
cat "$OUT"
echo
rm -f "$OUT"
