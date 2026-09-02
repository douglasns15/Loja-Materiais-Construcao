import { describe, it, expect } from 'vitest';
import {
  CASH_OPEN_ALERT_HOURS,
  DEBT_STALE_ALERT_DAYS,
  isCashOpenTooLong,
  isDebtStale,
} from './index';

/** Central de pendências — bloco C (ADR-029 §6). Regras puras de limiar de caixa/dívida. */

const NOW = new Date('2026-09-02T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

describe('isCashOpenTooLong', () => {
  it('não alerta um caixa aberto há poucas horas', () => {
    expect(isCashOpenTooLong(hoursAgo(3), NOW)).toBe(false);
  });

  it('alerta quando cruza o limiar padrão (18h)', () => {
    expect(CASH_OPEN_ALERT_HOURS).toBe(18);
    expect(isCashOpenTooLong(hoursAgo(19), NOW)).toBe(true);
  });

  it('é inclusivo exatamente no limiar', () => {
    expect(isCashOpenTooLong(hoursAgo(18), NOW)).toBe(true);
    expect(isCashOpenTooLong(hoursAgo(17.9), NOW)).toBe(false);
  });

  it('respeita um limiar customizado', () => {
    expect(isCashOpenTooLong(hoursAgo(13), NOW, 12)).toBe(true);
    expect(isCashOpenTooLong(hoursAgo(13), NOW, 24)).toBe(false);
  });
});

describe('isDebtStale', () => {
  it('padrão de dias é 30', () => {
    expect(DEBT_STALE_ALERT_DAYS).toBe(30);
  });

  it('dívida recente com vencimento no futuro NÃO está parada', () => {
    expect(
      isDebtStale({ dueDate: daysAgo(-10), openedAt: daysAgo(5), lastPaymentAt: daysAgo(2) }, NOW),
    ).toBe(false);
  });

  it('vencida há mais de 30 dias está parada (mesmo com recebimento recente)', () => {
    expect(
      isDebtStale({ dueDate: daysAgo(40), openedAt: daysAgo(50), lastPaymentAt: daysAgo(1) }, NOW),
    ).toBe(true);
  });

  it('sem nenhum recebimento há mais de 30 dias está parada (usa a abertura)', () => {
    expect(
      isDebtStale({ dueDate: null, openedAt: daysAgo(45), lastPaymentAt: null }, NOW),
    ).toBe(true);
  });

  it('último recebimento recente (e sem vencimento) NÃO está parada', () => {
    expect(
      isDebtStale({ dueDate: null, openedAt: daysAgo(90), lastPaymentAt: daysAgo(10) }, NOW),
    ).toBe(false);
  });

  it('sem vencimento definido não conta como vencida (só a inatividade decide)', () => {
    expect(
      isDebtStale({ dueDate: null, openedAt: daysAgo(20), lastPaymentAt: daysAgo(20) }, NOW),
    ).toBe(false);
  });
});
