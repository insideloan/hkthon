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
_TIMEOUT = 30.0  # seconds

# 화자 이름 → Typecast voice_id 고정 매핑
VOICE_MAP: dict[str, str] = {
    "혜라": "tc_66504763aed05555cd12438c",
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
    api_key = os.environ.get("TYPECAST_API_KEY", "")
    if not api_key:
        raise TtsError("TTS_ERROR: TYPECAST_API_KEY 환경변수가 설정되지 않음")

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
        resp = httpx.post(_TTS_ENDPOINT, json=payload, headers=headers, timeout=_TIMEOUT)
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
