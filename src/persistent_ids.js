// The list stops the server redelivering already-received pushes on login; desktop pushes carry
// a 5-minute (or 0) TTL so nothing older can be replayed, and 24 h leaves margin for clock skew.
// Unparsable ids are dropped: keeping them risks unbounded regrowth if the format ever changes.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// The digits are a microsecond unix timestamp.
const ID_PATTERN = /^0:(\d+)%/;

function pruneStale(ids, now = Date.now()) {
  return ids.filter((id) => {
    const match = ID_PATTERN.exec(id);
    return match !== null && now - (Number(match[1]) / 1000) < MAX_AGE_MS;
  });
}

module.exports = { MAX_AGE_MS, pruneStale };
