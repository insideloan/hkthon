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


# ─────────────────────────────────────────────────────────────────────────────
# 5. classify JSON 모드 — _parse_classify 견고 파싱
# ─────────────────────────────────────────────────────────────────────────────


def _full_json() -> str:
    return (
        '{"intent": "INFO_REQUEST", "route": "RESPOND", "emotion": "불안", '
        '"need": "금리문의", "usability": "", "fraud_suspected": false, '
        '"churn_adjust": 3, "strategy_tactic": "안심제공", '
        '"strategy_headline": "금리 인하 안내", "rationale": "고객이 금리를 물음"}'
    )


def test_parse_classify_plain_json():
    """순수 JSON 객체를 그대로 파싱한다."""
    from orchestrator.llm import router as r

    result = r._parse_classify(_full_json())  # noqa: SLF001
    assert result is not None
    assert result.intent == "INFO_REQUEST"
    assert result.route == "RESPOND"
    assert result.emotion == "불안"
    assert result.churn_adjust == 3
    assert result.fraud_suspected is False


def test_parse_classify_strips_code_fence():
    """```json 코드펜스로 감싼 응답도 파싱한다."""
    from orchestrator.llm import router as r

    fenced = "```json\n" + _full_json() + "\n```"
    result = r._parse_classify(fenced)  # noqa: SLF001
    assert result is not None
    assert result.route == "RESPOND"


def test_parse_classify_strips_preamble_and_trailing_text():
    """모델이 앞뒤로 설명을 덧붙여도 바깥 중괄호 구간만 떼어 파싱한다."""
    from orchestrator.llm import router as r

    noisy = "분석 결과입니다:\n" + _full_json() + "\n위와 같이 판단했습니다."
    result = r._parse_classify(noisy)  # noqa: SLF001
    assert result is not None
    assert result.intent == "INFO_REQUEST"


def test_parse_classify_broken_json_returns_none():
    """깨진 JSON은 None을 반환(호출측 규칙 폴백)."""
    from orchestrator.llm import router as r

    assert r._parse_classify('{"intent": "X", "route": ') is None  # noqa: SLF001
    assert r._parse_classify("응답이 JSON이 아닙니다") is None  # noqa: SLF001
    assert r._parse_classify("") is None  # noqa: SLF001


def test_parse_classify_out_of_range_churn_returns_none():
    """churn_adjust가 -10~10 범위를 벗어나면 스키마 검증 실패 → None."""
    from orchestrator.llm import router as r

    over = '{"intent": "X", "route": "RESPOND", "churn_adjust": 99}'
    assert r._parse_classify(over) is None  # noqa: SLF001


def test_parse_classify_partial_keys_use_defaults():
    """필수(intent/route)만 있고 나머지 누락 시 스키마 기본값으로 채운다."""
    from orchestrator.llm import router as r

    minimal = '{"intent": "UNCLEAR", "route": "RESPOND"}'
    result = r._parse_classify(minimal)  # noqa: SLF001
    assert result is not None
    assert result.emotion == ""
    assert result.churn_adjust == 0
    assert result.fraud_suspected is False


# ─────────────────────────────────────────────────────────────────────────────
# 6. classify_turn 게이트 — JSON 모드(기본) vs structured(0)
# ─────────────────────────────────────────────────────────────────────────────


def test_classify_turn_json_mode_uses_invoke_not_structured():
    """기본(JSON 모드): with_structured_output 없이 .invoke() 자유 텍스트를 파싱한다."""
    mock_instance = MagicMock()
    mock_instance.invoke.return_value = MagicMock(content=_full_json())
    mock_cls = MagicMock(return_value=mock_instance)
    mock_cls.__name__ = "ChatBedrockConverse"

    with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
        import sys

        if "orchestrator.llm.router" in sys.modules:
            del sys.modules["orchestrator.llm.router"]
        from orchestrator.llm import router as r

        r._chat = None  # noqa: SLF001
        r._CLASSIFY_JSON_MODE = True  # noqa: SLF001
        result = r.classify_turn("system prompt", "고객: 금리 알려줘")

    assert result is not None
    assert result.route == "RESPOND"
    mock_instance.invoke.assert_called_once()
    mock_instance.with_structured_output.assert_not_called()
    # 시스템 프롬프트에 JSON 출력 지시가 덧붙었는지 확인.
    sent_msgs = mock_instance.invoke.call_args.args[0]
    assert "JSON" in sent_msgs[0]["content"]


def test_classify_turn_json_mode_parse_failure_returns_none():
    """JSON 모드에서 응답이 파싱 불가면 None(규칙 폴백)."""
    mock_instance = MagicMock()
    mock_instance.invoke.return_value = MagicMock(content="죄송하지만 모르겠습니다")
    mock_cls = MagicMock(return_value=mock_instance)
    mock_cls.__name__ = "ChatBedrockConverse"

    with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
        import sys

        if "orchestrator.llm.router" in sys.modules:
            del sys.modules["orchestrator.llm.router"]
        from orchestrator.llm import router as r

        r._chat = None  # noqa: SLF001
        r._CLASSIFY_JSON_MODE = True  # noqa: SLF001
        result = r.classify_turn("system", "user")

    assert result is None


def test_classify_turn_structured_mode_uses_with_structured_output():
    """CLASSIFY_JSON_MODE=0: 기존 with_structured_output(tool-use) 경로를 쓴다."""
    expected = MagicMock()
    structured = MagicMock()
    structured.invoke.return_value = expected
    mock_instance = MagicMock()
    mock_instance.with_structured_output.return_value = structured
    mock_cls = MagicMock(return_value=mock_instance)
    mock_cls.__name__ = "ChatBedrockConverse"

    with patch.dict("sys.modules", {"langchain_aws": MagicMock(ChatBedrockConverse=mock_cls)}):
        import sys

        if "orchestrator.llm.router" in sys.modules:
            del sys.modules["orchestrator.llm.router"]
        from orchestrator.llm import router as r

        r._chat = None  # noqa: SLF001
        r._CLASSIFY_JSON_MODE = False  # noqa: SLF001
        result = r.classify_turn("system", "user")

    assert result is expected
    mock_instance.with_structured_output.assert_called_once()
    mock_instance.invoke.assert_not_called()


def test_classify_turn_json_mode_default_is_on():
    """CLASSIFY_JSON_MODE env 미지정 시 기본값이 ON(=1)이다."""
    import importlib

    env_backup = os.environ.pop("CLASSIFY_JSON_MODE", None)
    try:
        from orchestrator.llm import router as r

        # 다른 테스트가 모듈 상수를 변경했을 수 있으므로 env 미지정 상태로 강제 reload.
        importlib.reload(r)
        assert r._CLASSIFY_JSON_MODE is True  # noqa: SLF001
    finally:
        if env_backup is not None:
            os.environ["CLASSIFY_JSON_MODE"] = env_backup
        from orchestrator.llm import router as r2

        importlib.reload(r2)
