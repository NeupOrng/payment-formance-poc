import { ledgerAccountFor } from './profiles.service.js';

describe('ledgerAccountFor', () => {
  it('builds a lower-case address from ids only', () => {
    expect(ledgerAccountFor({ profileType: 'INDIVIDUAL', profileNumber: 'CIF000000001' }, 'CURRENT', '000000000007')).toBe(
      'individual:cif000000001:current:000000000007',
    );
  });
});
