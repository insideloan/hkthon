"""AGENT-007 (#15) — LLM 라우터 Bedrock Converse 단위 테스트.

모든 테스트는 실제 AWS 호출 없이 mock으로 검증.
수용 기준:
- ChatBedrockConverse 인스턴스 반환 (올바른 모델 클래스)
- .astream 인터페이스 호출 가능
- 미지정 시 기본 모델 global.anthropic.claude-haiku-4-5-20251001-v1:0 사용
- 타임아웃 가드: 첫 토큰 초과 시 FALLBACK_TEXT 반환
"""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch


# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼: 모듈 리셋 (환경변수 변경 테스트용)
# ─────────────────────────────────────────────────────────────────────────────


def _reset_router_module():
    """router 모듈의 lazy singleton을 초기화. 환경변수 재적용 테스트에 필요."""
    import sys

    mod = sys.modules.get("orchestrator.llm.router")
    if mod is not None:
        mod._chat = None  # noqa: SLF001


# ─────────────────────────────────────────────────────────────────────────────
# 1. get_llm() — 올바른 모델 클래스 반환
# ─────────────────────────────────────────────────────────────────────────────


def test_get_llm_returns_chat_bedrock_converse_instance():
    """get_llm()이 ChatBedrockConverse 인스턴스를 반환한다."""
    mock_instance = MagicMock()
    mock_cls = MagicMock(return_value=mock_instance)
    mock_cls.__name__ = "ChatBedrockConverse"

    with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
        _reset_router_module()
        from orchestrator.llm import router

        # singleton 리셋
        router._chat = None  # noqa: SLF001
        result = router.get_llm()

    assert result is mock_instance
    mock_cls.assert_called_once()


def test_get_llm_uses_default_model_when_env_not_set():
    """LLM_MODEL 미지정 시 기본 모델 global.anthropic.claude-haiku-4-5-20251001-v1:0을 사용한다."""
    mock_cls = MagicMock()
    mock_cls.__name__ = "ChatBedrockConverse"

    env = os.environ.copy()
    env.pop("LLM_MODEL", None)

    with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
        with patch.dict("os.environ", env, clear=True):
            _reset_router_module()

            import sys

            # 모듈을 환경변수 없이 재로드
            if "orchestrator.llm.router" in sys.modules:
                del sys.modules["orchestrator.llm.router"]

            from orchestrator.llm import router as r

            r._chat = None  # noqa: SLF001
            r.get_llm()

    call_kwargs = mock_cls.call_args
    assert call_kwargs is not None
    # model 인자 확인
    model_arg = (
        call_kwargs.kwargs.get("model") or call_kwargs.args[0]
        if call_kwargs.args
        else call_kwargs.kwargs.get("model")
    )
    assert model_arg == "global.anthropic.claude-haiku-4-5-20251001-v1:0"


def test_get_llm_uses_env_model_when_set():
    """LLM_MODEL 환경변수 지정 시 해당 모델을 사용한다."""
    custom_model = "global.anthropic.claude-haiku-3"
    mock_cls = MagicMock()
    mock_cls.__name__ = "ChatBedrockConverse"

    with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
        with patch.dict("os.environ", {"LLM_MODEL": custom_model}):
            import sys

            if "orchestrator.llm.router" in sys.modules:
                del sys.modules["orchestrator.llm.router"]

            from orchestrator.llm import router as r

            r._chat = None  # noqa: SLF001
            r.get_llm()

    call_kwargs = mock_cls.call_args
    assert call_kwargs is not None
    model_arg = (
        call_kwargs.kwargs.get("model") or call_kwargs.args[0]
        if call_kwargs.args
        else call_kwargs.kwargs.get("model")
    )
    assert model_arg == custom_model


# ─────────────────────────────────────────────────────────────────────────────
# 2. .astream 인터페이스 — 호출 가능 검증
# ─────────────────────────────────────────────────────────────────────────────


def test_get_llm_has_astream_interface():
    """get_llm() 반환 인스턴스가 .astream 메서드를 가진다."""
    mock_instance = MagicMock()
    mock_instance.astream = AsyncMock()
    mock_cls = MagicMock(return_value=mock_instance)
    mock_cls.__name__ = "ChatBedrockConverse"

    with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
        import sys

        if "orchestrator.llm.router" in sys.modules:
            del sys.modules["orchestrator.llm.router"]

        from orchestrator.llm import router as r

        r._chat = None  # noqa: SLF001
        llm = r.get_llm()

    assert hasattr(llm, "astream"), "ChatBedrockConverse 인스턴스에 .astream 이 있어야 한다"
    assert callable(llm.astream)


def test_astream_converse_yields_chunks():
    """astream_converse()가 비동기 스트리밍 청크를 yield한다."""

    async def _run():
        chunk1 = MagicMock()
        chunk1.content = "안녕하세요"
        chunk2 = MagicMock()
        chunk2.content = " 고객님"

        async def _fake_astream(_msgs):
            for c in [chunk1, chunk2]:
                yield c

        mock_instance = MagicMock()
        mock_instance.astream = _fake_astream
        mock_cls = MagicMock(return_value=mock_instance)
        mock_cls.__name__ = "ChatBedrockConverse"

        with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
            import sys

            if "orchestrator.llm.router" in sys.modules:
                del sys.modules["orchestrator.llm.router"]

            from orchestrator.llm import router as r

            r._chat = None  # noqa: SLF001

            chunks = []
            async for text in r.astream_converse("system", "user"):
                chunks.append(text)

        return chunks

    result = asyncio.get_event_loop().run_until_complete(_run())
    assert result == ["안녕하세요", " 고객님"]


# ─────────────────────────────────────────────────────────────────────────────
# 3. 기본 모델 검증 — DEFAULT_MODEL 상수
# ─────────────────────────────────────────────────────────────────────────────


def test_default_model_constant():
    """기본 모델 상수가 global.anthropic.claude-haiku-4-5-20251001-v1:0이다.

    모델 ID는 모듈 로드 시점이 아니라 _client() 생성 시점에 env에서 읽으므로
    (테스트 순서 의존 제거), 기본값은 상수 _DEFAULT_MODEL_ID로 검증한다.
    """
    from orchestrator.llm import router as r

    assert r._DEFAULT_MODEL_ID == "global.anthropic.claude-haiku-4-5-20251001-v1:0"  # noqa: SLF001


def test_get_llm_falls_back_to_default_model_without_env():
    """LLM_MODEL 미지정 시 기본 모델로 클라이언트를 생성한다."""
    mock_cls = MagicMock()
    mock_cls.__name__ = "ChatBedrockConverse"

    with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
        env_backup = os.environ.pop("LLM_MODEL", None)
        try:
            from orchestrator.llm import router as r

            r._chat = None  # noqa: SLF001
            r.get_llm()
        finally:
            if env_backup is not None:
                os.environ["LLM_MODEL"] = env_backup
            r._chat = None  # noqa: SLF001

    call_kwargs = mock_cls.call_args
    assert call_kwargs is not None
    model_arg = call_kwargs.kwargs.get("model") or (call_kwargs.args[0] if call_kwargs.args else None)
    assert model_arg == "global.anthropic.claude-haiku-4-5-20251001-v1:0"


# ─────────────────────────────────────────────────────────────────────────────
# 4. 첫 토큰 타임아웃 가드 — astream_converse
# ─────────────────────────────────────────────────────────────────────────────


def test_astream_converse_timeout_yields_fallback():
    """첫 토큰이 timeout_s 내 도착하지 않으면 FALLBACK_TEXT를 yield한다."""

    async def _run():
        async def _slow_astream(_msgs):
            await asyncio.sleep(10)  # 고의적으로 지연
            yield MagicMock(content="늦은 응답")

        mock_instance = MagicMock()
        mock_instance.astream = _slow_astream
        mock_cls = MagicMock(return_value=mock_instance)
        mock_cls.__name__ = "ChatBedrockConverse"

        with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
            import sys

            if "orchestrator.llm.router" in sys.modules:
                del sys.modules["orchestrator.llm.router"]

            from orchestrator.llm import router as r

            r._chat = None  # noqa: SLF001

            chunks = []
            # timeout_s=0.01로 즉시 타임아웃 유발
            async for text in r.astream_converse("system", "user", timeout_s=0.01):
                chunks.append(text)

        return chunks

    result = asyncio.get_event_loop().run_until_complete(_run())
    assert len(result) == 1
    from orchestrator.llm.router import FALLBACK_TEXT

    assert result[0] == FALLBACK_TEXT


def test_astream_converse_exception_yields_fallback():
    """astream_converse()가 예외 발생 시 FALLBACK_TEXT를 yield한다."""

    async def _run():
        async def _broken_astream(_msgs):
            raise RuntimeError("Bedrock 연결 실패")
            yield  # AsyncGenerator 타입 힌트용

        mock_instance = MagicMock()
        mock_instance.astream = _broken_astream
        mock_cls = MagicMock(return_value=mock_instance)
        mock_cls.__name__ = "ChatBedrockConverse"

        with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
            import sys

            if "orchestrator.llm.router" in sys.modules:
                del sys.modules["orchestrator.llm.router"]

            from orchestrator.llm import router as r

            r._chat = None  # noqa: SLF001

            chunks = []
            async for text in r.astream_converse("system", "user"):
                chunks.append(text)

        return chunks

    result = asyncio.get_event_loop().run_until_complete(_run())
    assert len(result) == 1
    from orchestrator.llm.router import FALLBACK_TEXT

    assert result[0] == FALLBACK_TEXT
