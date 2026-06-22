"""Runtime configuration / Settings.

BACKEND 모듈 (#20). 환경변수 + Secrets Manager ARN에서 config를 로드한다.
Lambda는 stateless이므로 매 invocation에서 `get_settings()`가 env를 읽는다
(콜드스타트 간 캐시는 lru_cache로 재사용; 테스트는 cache_clear로 초기화).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    """오케스트레이터 런타임 설정. 값은 환경변수에서 로드 (Secrets는 ARN만 보관)."""

    table_name: str
    assets_bucket: str
    scenario_key: str
    lexicon_key: str
    orchestrator_mode: str          # "script" | "live"
    typecast_secret_arn: str
    aws_region: str
    log_level: str

    @property
    def is_live(self) -> bool:
        return self.orchestrator_mode.lower() == "live"

    @property
    def is_script(self) -> bool:
        return not self.is_live


def _load() -> Settings:
    return Settings(
        table_name=os.environ.get("TABLE_NAME", ""),
        assets_bucket=os.environ.get("ASSETS_BUCKET", ""),
        scenario_key=os.environ.get("SCENARIO_KEY", "scenarios/scenario.json"),
        lexicon_key=os.environ.get("LEXICON_KEY", "lexicon/churn_risk_lexicon.json"),
        orchestrator_mode=os.environ.get("ORCHESTRATOR_MODE", "script"),
        typecast_secret_arn=os.environ.get("TYPECAST_SECRET_ARN", ""),
        aws_region=os.environ.get("AWS_REGION", "ap-northeast-2"),
        log_level=os.environ.get("LOG_LEVEL", "INFO"),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """캐시된 Settings 반환. 테스트에서 env 변경 후 `get_settings.cache_clear()` 호출."""
    return _load()
