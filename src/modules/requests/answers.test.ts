import { describe, expect, it } from 'vitest';
import {
  formatAnswer,
  initialBody,
  returnedBody,
  serverAnswerErrors,
  validateInitial,
  validateReturned,
} from './answers';
import type { RequestFieldRecord } from './types';

const field = (patch: Partial<RequestFieldRecord>): RequestFieldRecord => ({
  id: patch.key ?? 'f', request_id: 'r1', key: 'q1', label: 'Pergunta', help_text: null, type: 'long_text',
  required: true, options: null, sort_order: 1, system_generated: false, ...patch,
});

const text = field({ id: 'text', key: 'q1', type: 'long_text', sort_order: 1 });
const choice = field({ id: 'choice', key: 'q2', type: 'single_choice', options: ['A', 'B'], sort_order: 2 });
const yesno = field({ id: 'yesno', key: 'q3', type: 'boolean', sort_order: 3 });
const extra = field({ id: 'extra', key: 'q4', type: 'long_text', required: false, sort_order: 4 });
const approval = field({ id: 'ap', key: 'approval', type: 'approval', system_generated: true, options: ['approve', 'needs_changes'] });
const notes = field({ id: 'notes', key: 'approval_notes', type: 'long_text', system_generated: true, required: false, sort_order: 2 });

describe('initial round', () => {
  it('builds one trimmed answer per answered field, in field order, and leaves optional blanks out', () => {
    expect(initialBody([yesno, extra, choice, text], { text: '  Sim.  ', choice: 'B', yesno: false, extra: '   ' })).toEqual({
      answers: [
        { field_id: 'text', value: 'Sim.' },
        { field_id: 'choice', value: 'B' },
        { field_id: 'yesno', value: false },
      ],
    });
  });

  it('accepts false as an answer to a required boolean, and names what is missing', () => {
    expect(validateInitial([text, yesno], { text: 'x', yesno: false })).toEqual({});
    expect(validateInitial([text, yesno], { text: '   ' })).toEqual({
      text: 'Escreva a sua resposta.',
      yesno: 'Escolha uma opção.',
    });
  });

  it('rejects text over the limit before sending', () => {
    expect(validateInitial([text], { text: 'x'.repeat(4001) }).text).toMatch(/4000/);
  });

  it('sends change notes only with “Precisa de alterações”', () => {
    expect(initialBody([approval, notes], { ap: 'approve', notes: 'Mudem a cor.' })).toEqual({
      answers: [{ field_id: 'ap', value: 'approve' }],
    });
    expect(initialBody([approval, notes], { ap: 'needs_changes', notes: ' Mudem a cor. ' })).toEqual({
      answers: [
        { field_id: 'ap', value: 'needs_changes' },
        { field_id: 'notes', value: 'Mudem a cor.' },
      ],
    });
    expect(validateInitial([approval, notes], {})).toEqual({ ap: 'Escolha Aprovar ou Precisa de alterações.' });
  });
});

describe('returned round', () => {
  it('a text round needs non-empty text and sends it trimmed', () => {
    expect(validateReturned('text', { text: '  ', decision: null, notes: '' })).toEqual({ text: 'Escreva a sua resposta.' });
    expect(returnedBody('text', { text: '  Sim, no telemóvel também.  ', decision: null, notes: 'x' })).toEqual({
      response: { text: 'Sim, no telemóvel também.' },
    });
  });

  it('an approval round needs a decision; notes travel only with “Precisa de alterações”', () => {
    expect(validateReturned('approval', { text: '', decision: null, notes: '' })).toEqual({
      decision: 'Escolha Aprovar ou Precisa de alterações.',
    });
    expect(returnedBody('approval', { text: '', decision: 'approve', notes: 'ignorado' })).toEqual({
      response: { decision: 'approve', notes: null },
    });
    expect(returnedBody('approval', { text: '', decision: 'needs_changes', notes: ' Falta o logótipo. ' })).toEqual({
      response: { decision: 'needs_changes', notes: 'Falta o logótipo.' },
    });
  });
});

describe('server errors and read-only answers', () => {
  it('keys server field errors like the drafts', () => {
    expect(serverAnswerErrors([
      { field: 'answers.abc', code: 'required', message: 'Responda.' },
      { field: 'response.text', code: 'required', message: 'Escreva.' },
      { field: 'answers', code: 'invalid', message: 'Inválido.' },
    ])).toEqual({ abc: 'Responda.', text: 'Escreva.', _form: 'Inválido.' });
  });

  it('reads answers in pt-PT', () => {
    expect(formatAnswer(yesno, true)).toBe('Sim');
    expect(formatAnswer(yesno, false)).toBe('Não');
    expect(formatAnswer(approval, 'needs_changes')).toBe('Precisa de alterações');
    expect(formatAnswer(text, 'Texto livre')).toBe('Texto livre');
  });
});
