// SSOT-3 wire-contract regression — SpeechAnalysisSchema/SpeechTokenSchema.
// 백엔드(turn.py)는 NEUTRAL/"" 토큰 polarity 를 wire 에서 null 로 정규화하고,
// graphql Polarity/reason 은 nullable 이다. 프론트 Zod 가 null 을 거부하면
// ZodError 가 onSpeechAnalysis 구독 전체 파싱을 죽여 발화분석 카드가 멈춘다
// (콘솔: "Expected 'PRO'|'CONS'|'NEUTRAL', received null").
import { describe, expect, it } from 'vitest';
import { SpeechAnalysisSchema, SpeechTokenSchema } from '@/types/realtime';

describe('SpeechTokenSchema — SSOT-3 nullable polarity', () => {
  it('polarity null → NEUTRAL 정규화 (구독을 죽이지 않음)', () => {
    const tok = SpeechTokenSchema.parse({ text: '음', polarity: null, reason: '' });
    expect(tok.polarity).toBe('NEUTRAL');
  });

  it('polarity 누락 → NEUTRAL 정규화', () => {
    const tok = SpeechTokenSchema.parse({ text: '음', reason: '대기' });
    expect(tok.polarity).toBe('NEUTRAL');
  });

  it('PRO/CONS 는 그대로 보존', () => {
    expect(SpeechTokenSchema.parse({ text: 'a', polarity: 'PRO', reason: '' }).polarity).toBe('PRO');
    expect(SpeechTokenSchema.parse({ text: 'b', polarity: 'CONS', reason: '' }).polarity).toBe('CONS');
  });

  it('reason null/누락 → 빈 문자열', () => {
    expect(SpeechTokenSchema.parse({ text: 'a', polarity: null, reason: null }).reason).toBe('');
    expect(SpeechTokenSchema.parse({ text: 'a', polarity: 'PRO' }).reason).toBe('');
  });

  it('text 는 여전히 필수', () => {
    expect(() => SpeechTokenSchema.parse({ polarity: 'PRO', reason: '' })).toThrow();
  });

  it('알 수 없는 polarity 값은 여전히 거부', () => {
    expect(() => SpeechTokenSchema.parse({ text: 'a', polarity: 'MAYBE', reason: '' })).toThrow();
  });
});

describe('SpeechAnalysisSchema — null polarity 토큰 섞인 페이로드', () => {
  it('null polarity 토큰이 있어도 전체 페이로드가 파싱된다', () => {
    const parsed = SpeechAnalysisSchema.parse({
      callId: 'c1',
      turnSeq: 3,
      tokens: [
        { text: '금리', polarity: 'CONS', reason: '부담' },
        { text: '인하', polarity: null, reason: null },
        { text: '관심', polarity: 'PRO', reason: '긍정' },
      ],
    });
    expect(parsed.tokens.map((t) => t.polarity)).toEqual(['CONS', 'NEUTRAL', 'PRO']);
  });
});
