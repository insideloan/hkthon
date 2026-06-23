"""AGENT-009 (#17) — Typecast TTS 브리지 검증.

테스트 항목:
- voice 이름 → voice_id 매핑 (3개 화자)
- 알 수 없는 화자 → TtsError
- mock REST 200 → mp3 bytes 반환
- HTTP 오류 → TtsError (TTS_ERROR)
- TYPECAST_API_KEY 미설정 → TtsError
"""

import httpx
import pytest

from orchestrator.tts.typecast_tts import (
    VOICE_MAP,
    TtsError,
    _SKIP_S3,
    resolve_voice_id,
    synthesize,
)


# ─────────────────────────────────────────────────────────────────────────────
# voice_id 매핑 테스트
# ─────────────────────────────────────────────────────────────────────────────


def test_voice_map_contains_all_speakers():
    """세 화자 모두 VOICE_MAP에 정의되어 있어야 함."""
    assert "혜라" in VOICE_MAP
    assert "진서" in VOICE_MAP
    assert "유라" in VOICE_MAP


def test_resolve_voice_id_혜라():
    assert resolve_voice_id("혜라") == "tc_66504763aed05555cd12438c"


def test_resolve_voice_id_진서():
    assert resolve_voice_id("진서") == "tc_65bb3a1976b69213594357fc"


def test_resolve_voice_id_유라():
    assert resolve_voice_id("유라") == "tc_61130d6cf89dd58a4c13295d"


def test_resolve_voice_id_unknown_raises_tts_error():
    """알 수 없는 화자 → TtsError 발생."""
    with pytest.raises(TtsError) as exc_info:
        resolve_voice_id("민준")
    assert "TTS_ERROR" in str(exc_info.value)


# ─────────────────────────────────────────────────────────────────────────────
# synthesize — API 키 미설정
# ─────────────────────────────────────────────────────────────────────────────


def test_synthesize_no_api_key_raises_tts_error(monkeypatch):
    """TYPECAST_API_KEY/SECRET_ARN 둘 다 미설정 → TtsError."""
    monkeypatch.delenv("TYPECAST_API_KEY", raising=False)
    monkeypatch.delenv("TYPECAST_SECRET_ARN", raising=False)
    with pytest.raises(TtsError) as exc_info:
        synthesize("안녕하세요", "혜라", s3_uploader=_SKIP_S3)
    assert "TTS_ERROR" in str(exc_info.value)


# ─────────────────────────────────────────────────────────────────────────────
# _resolve_api_key — env 우선 / Secrets Manager 폴백 (배포 경로)
# ─────────────────────────────────────────────────────────────────────────────


def test_resolve_api_key_prefers_env(monkeypatch):
    """env가 있으면 boto3를 타지 않고 env 값을 쓴다."""
    from orchestrator.tts import typecast_tts as t

    monkeypatch.setenv("TYPECAST_API_KEY", "env-key")
    monkeypatch.setenv("TYPECAST_SECRET_ARN", "arn:should-not-be-used")
    assert t._resolve_api_key() == "env-key"


def test_resolve_api_key_from_secret_plain(monkeypatch):
    """env 없고 ARN만 있으면 Secrets Manager 평문 시크릿을 읽는다."""
    from orchestrator.tts import typecast_tts as t

    monkeypatch.delenv("TYPECAST_API_KEY", raising=False)
    monkeypatch.setenv("TYPECAST_SECRET_ARN", "arn:secret")
    monkeypatch.setattr(t, "_cached_secret_key", None)

    class _FakeSM:
        def get_secret_value(self, SecretId):  # noqa: N803 (boto3 kw)
            assert SecretId == "arn:secret"
            return {"SecretString": "plain-secret-key"}

    # boto3는 함수 내부 import — monkeypatch.setitem으로 가짜 주입(자동 복원, 누수 없음).
    import sys

    monkeypatch.setitem(sys.modules, "boto3",
                        type("M", (), {"client": staticmethod(lambda svc: _FakeSM())}))
    assert t._resolve_api_key() == "plain-secret-key"


def test_resolve_api_key_from_secret_json(monkeypatch):
    """JSON 시크릿이면 TYPECAST_API_KEY 키에서 추출."""
    import sys

    from orchestrator.tts import typecast_tts as t

    monkeypatch.delenv("TYPECAST_API_KEY", raising=False)
    monkeypatch.setenv("TYPECAST_SECRET_ARN", "arn:secret")
    monkeypatch.setattr(t, "_cached_secret_key", None)

    class _FakeSM:
        def get_secret_value(self, SecretId):  # noqa: N803
            return {"SecretString": '{"TYPECAST_API_KEY": "json-key-123"}'}

    monkeypatch.setitem(sys.modules, "boto3",
                        type("M", (), {"client": staticmethod(lambda svc: _FakeSM())}))
    assert t._resolve_api_key() == "json-key-123"


def test_resolve_api_key_none_when_unset(monkeypatch):
    """env/ARN 모두 없으면 빈 문자열(→ synthesize가 TtsError)."""
    from orchestrator.tts import typecast_tts as t

    monkeypatch.delenv("TYPECAST_API_KEY", raising=False)
    monkeypatch.delenv("TYPECAST_SECRET_ARN", raising=False)
    assert t._resolve_api_key() == ""


# ─────────────────────────────────────────────────────────────────────────────
# synthesize — mock REST 200 → mp3 bytes
# ─────────────────────────────────────────────────────────────────────────────

_FAKE_MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00"  # 최소 mp3-like bytes


def test_synthesize_mock_200_returns_mp3_bytes(monkeypatch):
    """mock 200 응답 → mp3 bytes 반환, S3 저장 생략."""
    monkeypatch.setenv("TYPECAST_API_KEY", "test-key-xxx")

    def _mock_post(url, **kwargs):
        return httpx.Response(200, content=_FAKE_MP3)

    monkeypatch.setattr(httpx, "post", _mock_post)

    mp3, url = synthesize("안녕하세요", "혜라", s3_uploader=_SKIP_S3)
    assert mp3 == _FAKE_MP3
    assert url is None


def test_synthesize_mock_200_진서(monkeypatch):
    """진서 화자로 mock 200 → mp3 bytes 반환."""
    monkeypatch.setenv("TYPECAST_API_KEY", "test-key-yyy")

    def _mock_post(url, **kwargs):
        # 요청 body에 올바른 voice_id가 포함되어야 함
        assert kwargs["json"]["voice_id"] == "tc_65bb3a1976b69213594357fc"
        assert kwargs["json"]["model"] == "ssfm-v30"
        return httpx.Response(200, content=_FAKE_MP3)

    monkeypatch.setattr(httpx, "post", _mock_post)

    mp3, _ = synthesize("테스트 텍스트", "진서", s3_uploader=_SKIP_S3)
    assert mp3 == _FAKE_MP3


# ─────────────────────────────────────────────────────────────────────────────
# synthesize — API 오류 → TtsError
# ─────────────────────────────────────────────────────────────────────────────


def test_synthesize_http_4xx_raises_tts_error(monkeypatch):
    """HTTP 401 → TtsError(TTS_ERROR)."""
    monkeypatch.setenv("TYPECAST_API_KEY", "bad-key")

    def _mock_post(url, **kwargs):
        return httpx.Response(401, text="Unauthorized")

    monkeypatch.setattr(httpx, "post", _mock_post)

    with pytest.raises(TtsError) as exc_info:
        synthesize("텍스트", "혜라", s3_uploader=_SKIP_S3)
    assert "TTS_ERROR" in str(exc_info.value)


def test_synthesize_http_500_raises_tts_error(monkeypatch):
    """HTTP 500 → TtsError(TTS_ERROR)."""
    monkeypatch.setenv("TYPECAST_API_KEY", "test-key")

    def _mock_post(url, **kwargs):
        return httpx.Response(500, text="Internal Server Error")

    monkeypatch.setattr(httpx, "post", _mock_post)

    with pytest.raises(TtsError) as exc_info:
        synthesize("텍스트", "유라", s3_uploader=_SKIP_S3)
    assert "TTS_ERROR" in str(exc_info.value)


def test_synthesize_request_error_raises_tts_error(monkeypatch):
    """네트워크 오류(httpx.RequestError) → TtsError(TTS_ERROR)."""
    monkeypatch.setenv("TYPECAST_API_KEY", "test-key")

    def _mock_post(url, **kwargs):
        raise httpx.ConnectError("연결 실패")

    monkeypatch.setattr(httpx, "post", _mock_post)

    with pytest.raises(TtsError) as exc_info:
        synthesize("텍스트", "혜라", s3_uploader=_SKIP_S3)
    assert "TTS_ERROR" in str(exc_info.value)


# ─────────────────────────────────────────────────────────────────────────────
# synthesize — S3 업로더 주입 테스트
# ─────────────────────────────────────────────────────────────────────────────


def test_synthesize_with_custom_s3_uploader(monkeypatch):
    """커스텀 S3Uploader 주입 → presigned URL 반환."""
    monkeypatch.setenv("TYPECAST_API_KEY", "test-key")

    def _mock_post(url, **kwargs):
        return httpx.Response(200, content=_FAKE_MP3)

    monkeypatch.setattr(httpx, "post", _mock_post)

    class _MockUploader:
        uploaded: list = []

        def upload(self, key: str, data: bytes) -> str:
            self.uploaded.append((key, data))
            return f"https://s3.example.com/{key}"

    uploader = _MockUploader()
    mp3, url = synthesize("안녕하세요", "혜라", s3_uploader=uploader, s3_key="test/audio.mp3")

    assert mp3 == _FAKE_MP3
    assert url == "https://s3.example.com/test/audio.mp3"
    assert len(uploader.uploaded) == 1
    assert uploader.uploaded[0] == ("test/audio.mp3", _FAKE_MP3)
