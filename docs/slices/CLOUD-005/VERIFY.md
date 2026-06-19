# Verify Checklist — `CLOUD-005` (#46)

> DynamoDB/S3 검증 + DATA 식별자 전달 + 로컬↔원격 전환. 생성은 #54.

## 수용 기준 (#46) — 2026-06-19 실측

- [x] `aws dynamodb describe-table` → `ACTIVE`, Streams `ENABLED`, `NEW_AND_OLD_IMAGES`
- [x] `aws s3 ls` 버킷 도달 + public access `BLOCK_ALL` (최소권한)
- [x] 로컬→원격 전환 문서 존재 → `infra/data-stores.md`

## 산출물

- `infra/data-stores.md`: CfnOutput 조회법(`TableName`/`AssetsBucketName`), DATA 핸드오프, 로컬(dynamodb-local)↔원격 전환.

## 결과
- [x] **PASS**
