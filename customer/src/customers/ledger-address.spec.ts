import { ledgerAddress } from './customers.service.js';

describe('ledgerAddress', () => {
  it('builds one ledger address per customer and currency', () => {
    const id = 'd1306336-8995-44c8-b7de-297bdfaf0093';
    expect(ledgerAddress(id, 'USD')).toBe(`users:${id}:usd`);
    expect(ledgerAddress(id, 'KHR')).toBe(`users:${id}:khr`);
  });
});
