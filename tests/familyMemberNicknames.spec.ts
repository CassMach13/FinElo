import { describe, expect, it } from 'vitest';
import {
  getOtherFamilyMemberEmail,
  parseFamilyMemberNicknames,
  resolveFamilyMemberNickname,
  setFamilyMemberNickname,
} from '../src/utils/familyMemberNicknames';

describe('familyMemberNicknames', () => {
  it('parseia apelidos do user_metadata', () => {
    const parsed = parseFamilyMemberNicknames({
      family_member_nicknames: {
        'Alcione@Example.com': 'Alcione',
        '': 'ignorado',
        'markus@thomastecnica.com.br': '  Markus  ',
      },
    });
    expect(parsed).toEqual({
      'alcione@example.com': 'Alcione',
      'markus@thomastecnica.com.br': 'Markus',
    });
  });

  it('salva e remove apelido por e-mail normalizado', () => {
    const initial = { 'alcione@example.com': 'Alcione' };
    const updated = setFamilyMemberNickname(initial, 'MARKUS@example.com', 'Markus');
    expect(updated).toEqual({
      'alcione@example.com': 'Alcione',
      'markus@example.com': 'Markus',
    });
    const cleared = setFamilyMemberNickname(updated, 'alcione@example.com', '   ');
    expect(cleared).toEqual({ 'markus@example.com': 'Markus' });
  });

  it('resolve apelido com fallback indefinido', () => {
    expect(
      resolveFamilyMemberNickname('alcione@example.com', {
        'alcione@example.com': 'Alcione',
      })
    ).toBe('Alcione');
    expect(resolveFamilyMemberNickname('outro@example.com', {})).toBeUndefined();
  });

  it('identifica e-mail do outro membro no vínculo', () => {
    const member = {
      owner_id: 'owner-1',
      owner_email: 'cassio@example.com',
      member_email: 'alcione@example.com',
    };
    expect(
      getOtherFamilyMemberEmail({
        member,
        currentUserId: 'owner-1',
        currentUserEmail: 'cassio@example.com',
      })
    ).toBe('alcione@example.com');
    expect(
      getOtherFamilyMemberEmail({
        member,
        currentUserId: 'guest-1',
        currentUserEmail: 'alcione@example.com',
      })
    ).toBe('cassio@example.com');
  });
});
