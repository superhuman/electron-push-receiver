const { MAX_AGE_MS, pruneStale } = require('../src/persistent_ids');

const NOW = 1702365002000;

function idWithAge(ageMs) {
  return `0:${(NOW - ageMs) * 1000}%abc`;
}

describe('pruneStale', () => {
  it('keeps ids younger than 24 h in order', () => {
    const first = idWithAge(1000);
    const second = idWithAge(2000);
    const third = idWithAge(3000);
    expect(pruneStale([first, second, third], NOW)).toEqual([first, second, third]);
  });

  it('drops ids older than 24 h', () => {
    expect(pruneStale([idWithAge(25 * 60 * 60 * 1000)], NOW)).toEqual([]);
  });

  it('keeps ids dated in the future', () => {
    const future = `0:${(NOW + (60 * 1000)) * 1000}%abc`;
    expect(pruneStale([future], NOW)).toEqual([future]);
  });

  it('drops unparsable ids', () => {
    const fresh = idWithAge(1000);
    const ids = [fresh, 'garbage', null, '1:1702365002000000%abc', '0:1702365002018330'];
    expect(pruneStale(ids, NOW)).toEqual([fresh]);
  });

  it('drops ids exactly 24 h old and keeps ids 24 h minus 1 ms old', () => {
    const boundary = idWithAge(MAX_AGE_MS);
    const justInside = idWithAge(MAX_AGE_MS - 1);
    expect(pruneStale([boundary, justInside], NOW)).toEqual([justInside]);
  });
});
