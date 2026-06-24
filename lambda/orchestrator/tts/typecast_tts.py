"""Typecast TTS 브리지 — 텍스트→mp3 변환 후 S3 저장.

AGENT 모듈. 이슈: AGENT-009 (#17).

POST https://api.typecast.ai/v1/text-to-speech
헤더: X-API-KEY (환경변수 TYPECAST_API_KEY에서 로드)
모델: ssfm-v30
화자: 혜라 / 진서 / 유라 (고정 voice_id 매핑)

반환된 mp3를 S3에 저장 후 presigned URL 반환.
실패 시 TtsError("TTS_ERROR") 발생.
"""

from __future__ import annotations

import os
from typing import Protocol, runtime_checkable

import httpx

# ─────────────────────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────────────────────

_TTS_ENDPOINT = "https://api.typecast.ai/v1/text-to-speech"
_MODEL = "ssfm-v30"
# TTS는 best-effort 부가 기능 — 통화 한 턴(Lambda 90s) 안에서 agent 그래프와 직렬
# 실행되므로, 느린/멈춘 Typecast 응답이 턴 전체를 잡아먹지 않게 짧게 끊는다.
# 초과 시 nodes._synthesize_bot_audio가 예외를 삼키고 텍스트만 남긴다.
_TIMEOUT = 12.0  # seconds


# 환경변수로 오버라이드 가능(운영 튜닝용). 미설정 시 _TIMEOUT.
def _http_timeout() -> float:
    raw = os.environ.get("TTS_HTTP_TIMEOUT_S", "")
    try:
        return float(raw) if raw else _TIMEOUT
    except ValueError:
        return _TIMEOUT

# 화자 이름 → Typecast voice_id 고정 매핑
VOICE_MAP: dict[str, str] = {
    "혜라": "tc_68413e12459cfdf27b481183",
    "진서": "tc_65bb3a1976b69213594357fc",
    "유라": "tc_61130d6cf89dd58a4c13295d",
}

# 기본 화자
_DEFAULT_VOICE = "혜라"


# ─────────────────────────────────────────────────────────────────────────────
# 예외
# ─────────────────────────────────────────────────────────────────────────────


class TtsError(RuntimeError):
    """TTS 변환 실패 — 코드: TTS_ERROR."""

    code = "TTS_ERROR"


# ─────────────────────────────────────────────────────────────────────────────
# S3 저장 인터페이스 (추상화 — 실제 구현은 주입 또는 기본 boto3 구현 사용)
# ─────────────────────────────────────────────────────────────────────────────


@runtime_checkable
class S3Uploader(Protocol):
    """mp3 bytes → S3 저장 후 presigned URL 반환 인터페이스."""

    def upload(self, key: str, data: bytes) -> str:
        """S3에 data를 key로 업로드하고 presigned URL 반환."""
        ...


class _DefaultS3Uploader:
    """boto3 기반 기본 S3 업로더.

    환경변수:
        TTS_S3_BUCKET: 저장 버킷 이름
        TTS_S3_PRESIGN_TTL: presigned URL 유효 시간(초), 기본 3600
    """

    def upload(self, key: str, data: bytes) -> str:
        import boto3  # 런타임 임포트 — 테스트 환경에서 mock 가능

        bucket = os.environ.get("TTS_S3_BUCKET", "insideloan-tts-audio")
        ttl = int(os.environ.get("TTS_S3_PRESIGN_TTL", "3600"))

        s3 = boto3.client("s3")
        s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType="audio/mpeg")
        url: str = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=ttl,
        )
        return url


# ─────────────────────────────────────────────────────────────────────────────
# 핵심 함수
# ─────────────────────────────────────────────────────────────────────────────


def _resolve_api_key() -> str:
    """Typecast API 키 해석. env(TYPECAST_API_KEY) 우선, 없으면 Secrets Manager 폴백.

    배포 환경(infra)은 시크릿 값을 직접 env로 주입하지 않고 `TYPECAST_SECRET_ARN`만
    넘긴다(시크릿을 코드/로그에 남기지 않기 위함). 이 함수가 런타임에 ARN으로
    Secrets Manager에서 키를 꺼낸다. 시크릿은 평문 문자열 또는 {"TYPECAST_API_KEY": "..."}
    /{"apiKey": "..."} JSON 둘 다 허용. 해석 결과는 콜드스타트 간 캐시(반복 호출 비용 방지).

    로컬/단위테스트는 TYPECAST_API_KEY를 직접 설정하므로 boto3/네트워크 경로를 타지 않는다.
    """
    env_key = os.environ.get("TYPECAST_API_KEY", "")
    if env_key:
        return env_key

    arn = os.environ.get("TYPECAST_SECRET_ARN", "")
    if not arn:
        return ""

    global _cached_secret_key
    if _cached_secret_key is not None:
        return _cached_secret_key

    try:
        import json

        import boto3

        resp = boto3.client("secretsmanager").get_secret_value(SecretId=arn)
        raw = resp.get("SecretString") or ""
        key = raw
        # JSON 시크릿이면 흔한 키 이름에서 추출, 아니면 평문으로 간주.
        if raw.lstrip().startswith("{"):
            try:
                data = json.loads(raw)
                key = data.get("TYPECAST_API_KEY") or data.get("apiKey") or data.get("X-API-KEY") or ""
            except (ValueError, TypeError):
                key = raw
        _cached_secret_key = key.strip()
        return _cached_secret_key
    except Exception as exc:  # noqa: BLE001 — 시크릿 조회 실패는 TtsError로 일원화
        raise TtsError(f"TTS_ERROR: 시크릿 조회 실패 — {exc}") from exc


# Secrets Manager 조회 결과 캐시 (콜드스타트 간 재사용). 테스트는 직접 env를 쓰므로 무관.
_cached_secret_key: str | None = None


def resolve_voice_id(voice_name: str) -> str:
    """화자 이름 → Typecast voice_id 반환.

    Args:
        voice_name: 화자 이름 (혜라 / 진서 / 유라)

    Returns:
        Typecast voice_id 문자열

    Raises:
        TtsError: 알 수 없는 화자 이름
    """
    voice_id = VOICE_MAP.get(voice_name)
    if voice_id is None:
        supported = ", ".join(VOICE_MAP.keys())
        raise TtsError(f"TTS_ERROR: 지원하지 않는 화자 '{voice_name}'. 지원 화자: {supported}")
    return voice_id


def synthesize(
    text: str,
    voice_name: str = _DEFAULT_VOICE,
    *,
    s3_uploader: S3Uploader | None = None,
    s3_key: str | None = None,
) -> tuple[bytes, str | None]:
    """텍스트를 mp3로 변환하고 S3에 저장.

    Args:
        text: 변환할 텍스트
        voice_name: 화자 이름 (혜라 / 진서 / 유라)
        s3_uploader: S3 저장 구현체 (None이면 기본 boto3 업로더 사용, False-y 값이면 S3 저장 생략)
        s3_key: S3 저장 키 (None이면 자동 생성)

    Returns:
        (mp3_bytes, presigned_url_or_none)
        s3_uploader가 None인 경우 기본 업로더로 presigned URL 반환.
        s3_uploader가 명시적 False(예: _NO_S3 sentinel)이면 url은 None.

    Raises:
        TtsError: API 호출 실패 또는 알 수 없는 화자
    """
    api_key = _resolve_api_key()
    if not api_key:
        raise TtsError("TTS_ERROR: TYPECAST_API_KEY/TYPECAST_SECRET_ARN 미설정")

    voice_id = resolve_voice_id(voice_name)

    payload = {
        "text": text,
        "voice_id": voice_id,
        "model": _MODEL,
    }
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }

    try:
        resp = httpx.post(_TTS_ENDPOINT, json=payload, headers=headers, timeout=_http_timeout())
    except httpx.RequestError as exc:
        raise TtsError(f"TTS_ERROR: Typecast 요청 실패 — {exc}") from exc

    if resp.status_code != 200:
        raise TtsError(
            f"TTS_ERROR: Typecast API {resp.status_code} — {resp.text[:200]}"
        )

    mp3_bytes = resp.content
    if not mp3_bytes:
        raise TtsError("TTS_ERROR: Typecast 응답 본문이 비어있음")

    # S3 저장
    if s3_uploader is _SKIP_S3:
        return mp3_bytes, None

    uploader: S3Uploader = s3_uploader if s3_uploader is not None else _DefaultS3Uploader()
    if s3_key is None:
        import hashlib
        import time

        ts = int(time.time() * 1000)
        h = hashlib.md5(text.encode()).hexdigest()[:8]  # noqa: S324
        s3_key = f"tts/{voice_name}/{ts}_{h}.mp3"

    presigned_url = uploader.upload(s3_key, mp3_bytes)
    return mp3_bytes, presigned_url


# S3 저장 생략용 sentinel (테스트/단순 bytes 반환 시 사용)
_SKIP_S3 = object()
