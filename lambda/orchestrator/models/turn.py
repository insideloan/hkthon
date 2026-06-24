"""Turn 엔터티 모델 (DATA-003 / #3).

발화 분석 UI(키워드 강조 + 턴 단위 flag 배지)가 Turn의 토큰 구조와 턴 레벨
flag 필드를 요구한다. DynamoDB 싱글 테이블 `CALL#{id}` / `TURN#{seq}`.

⚠️ SSOT-3 용도 재정의 (중요):
  - token의 `polarity`(PRO|CONS|null)는 **키워드 색상 매핑 목적이 아니다**. 키워드
    (`.bubble .kw`)는 UI에서 색상/배경/깜빡임이 제거되고 폰트 강조만 남았다. polarity는
    턴 레벨 `flag`(`.flag--risk`/`.flag--def`) 배지 분기를 돕는 신호로만 쓰인다.
  - `reason`은 전략 카드(`.slead`, stratGrid)의 대표 발화방향 텍스트로 사용된다.
  - 턴 레벨 `flag`("risk"|"def"|null)는 wire `SpeechAnalysis.turnFlag`(RISK|DEF|NEUTRAL)에
    매핑된다(**null → NEUTRAL**). enum 표기/매핑은 BACKEND #28 canonical 소유.

storage 키는 `resolvers/calls.py`(`speaker`/`text`/`node`/`churn_after`/`flag`/`tokens`)와 정합.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, Optional

from ..api import dynamo

# 턴 레벨 flag 허용값 (null = 배지 없음 = wire NEUTRAL)
TurnFlag = Literal["risk", "def"]
_ALLOWED_FLAGS = {"risk", "def", None}

# token.polarity 허용값 (null 허용)
_ALLOWED_POLARITY = {"PRO", "CONS", None}


class Speaker(str, Enum):
    BOT = "bot"
    CUSTOMER = "customer"
    AGENT = "agent"


@dataclass
class Turn:
    """발화 턴. PK=CALL#{id}, SK=TURN#{seq:04d}.

    tokens: list of {text, polarity: PRO|CONS|null, reason}. DynamoDB List of Maps로 저장.
    flag: 턴 레벨 배지 분기("risk"|"def"|null).
    """

    call_id: str
    seq: int
    speaker: Speaker = Speaker.BOT
    text: str = ""
    node: Optional[str] = None
    ts: Optional[str] = None
    tokens: list[dict[str, Any]] = field(default_factory=list)
    churn_after: Optional[float] = None
    flag: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.call_id:
            raise ValueError("Turn.call_id is required")
        self.speaker = Speaker(self.speaker)  # 검증 + 정규화
        if self.flag not in _ALLOWED_FLAGS:
            raise ValueError(f"invalid turn flag: {self.flag!r} (risk|def|null)")
        self.tokens = [self._normalize_token(t) for t in (self.tokens or [])]

    @staticmethod
    def _normalize_token(tok: dict[str, Any]) -> dict[str, Any]:
        polarity = tok.get("polarity")  # 누락 시 None 허용
        # "NEUTRAL"/"" 은 중립의 별칭 → null로 관용 정규화. wire(SpeechAnalysis)와
        # UI는 PRO|CONS|null만 알고 null=중립(배지 없음)이므로 의미 동일하다. 이 관용
        # 처리가 없으면 토큰 하나의 표기 차이가 persist 전체(봇 Turn write)를 죽인다.
        if polarity in ("NEUTRAL", ""):
            polarity = None
        if polarity not in _ALLOWED_POLARITY:
            raise ValueError(f"invalid token polarity: {polarity!r} (PRO|CONS|null)")
        return {
            "text": tok.get("text", ""),
            "polarity": polarity,
            "reason": tok.get("reason", ""),
        }

    def to_item(self) -> dict[str, Any]:
        return {
            "PK": dynamo.pk_call(self.call_id),
            "SK": dynamo.sk_turn(self.seq),
            "seq": self.seq,
            "speaker": self.speaker.value,
            "text": self.text,
            "node": self.node,
            "ts": self.ts,
            "tokens": [dict(t) for t in self.tokens],
            "churn_after": self.churn_after,
            "flag": self.flag,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "Turn":
        # SK(TURN#0001)에서 seq 복원 (seq 필드 우선, 없으면 SK 파싱).
        seq = item.get("seq")
        if seq is None:
            seq = int(str(item["SK"]).removeprefix(dynamo.SK_PREFIX_TURN))
        return cls(
            call_id=str(item["PK"]).removeprefix("CALL#"),
            seq=int(seq),
            speaker=item.get("speaker", Speaker.BOT.value),
            text=item.get("text", ""),
            node=item.get("node"),
            ts=item.get("ts"),
            tokens=list(item.get("tokens") or []),
            churn_after=item.get("churn_after"),
            flag=item.get("flag"),
        )
