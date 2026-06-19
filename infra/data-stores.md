# Data Stores — DynamoDB + S3 (CLOUD-005 / #46)

> 리소스 **생성은 CLOUD-011(#54)** 의 단일 CDK 스택. 이 문서는 생성된 스토어를
> 검증하고 **DATA(수민)** 에게 식별자를 전달하며, 로컬↔원격 전환을 안내한다.

## 어떻게 식별자를 얻나 (하드코딩 금지)

스택 출력에서 직접 조회 — 이름은 배포마다 바뀔 수 있으니 값을 문서에 박지 않는다:

```bash
aws cloudformation describe-stacks --stack-name HkthonStack \
  --query 'Stacks[0].Outputs[?OutputKey==`TableName` || OutputKey==`AssetsBucketName`].{k:OutputKey,v:OutputValue}' \
  --output table
```

| Output | 용도 | 소비자 |
|---|---|---|
| `TableName` | DynamoDB 싱글 테이블 (PK/SK, +Streams) | DATA: `seed.py` · `models/*` |
| `AssetsBucketName` | S3 (scenario.json · 렉시콘 · mp3) | DATA: 시나리오/렉시콘 업로드 |

DATA 코드는 환경변수로 주입받는다 (Lambda는 이미 `TABLE_NAME`/`ASSETS_BUCKET` env 보유). 로컬 실행 시:

```bash
export TABLE_NAME="$(aws cloudformation describe-stacks --stack-name HkthonStack \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)"
```

## 검증 (2026-06-19 실측)

- **DynamoDB**: `TableStatus=ACTIVE`, `StreamEnabled=true`, `StreamViewType=NEW_AND_OLD_IMAGES`
  ```bash
  aws dynamodb describe-table --table-name "$TABLE_NAME" \
    --query 'Table.{status:TableStatus,stream:StreamSpecification}'
  ```
- **S3**: 버킷 도달 가능, public access **BLOCK_ALL** (최소권한)
  ```bash
  aws s3 ls "s3://$ASSETS_BUCKET"
  aws s3api get-public-access-block --bucket "$ASSETS_BUCKET"
  ```
- 단일 테이블 키: `CALL#{id}` / `META`·`TURN#{seq}`·`MOT#{seq}`·`CMPL#{turn}#{try}`·`SUMMARY` (STACK.md §6).

## 로컬 ↔ 원격 전환

| 모드 | 설정 |
|---|---|
| **원격(배포 테이블)** | 위 `TABLE_NAME` env 주입, 자격증명 `ap-northeast-2`. seed: `python lambda/orchestrator/seed.py` |
| **로컬(dev 계정 없음)** | `docker run -p 8000:8000 amazon/dynamodb-local` 후 boto3 `endpoint_url=http://localhost:8000`, `TABLE_NAME=hkthon-local` |

> 로컬 테이블 스키마(PK/SK)는 배포본과 동일하게 DATA가 생성. S3는 로컬 대체 없이 원격 버킷 사용 권장(데모 자산 소량).

## 범위

- 리소스 생성/스키마는 #54. 본 issue는 검증 + DATA 핸드오프 + 전환 문서.
- 시드 데이터·모델은 DATA 소유(`lambda/orchestrator/models/*`, `seed.py`).
