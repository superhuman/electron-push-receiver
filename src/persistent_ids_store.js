const KEY = 'persistentIds';
const DEFAULT_MAX_PERSISTED_IDS = 5000;

// Own config file ('push-receiver.json') so per-notification writes stop
// rewriting the host app's shared config.json.
class PersistentIdsStore {
  // createConfig is injected so tests need no electron: (options) => Config
  constructor({ createConfig, maxPersistedIds = DEFAULT_MAX_PERSISTED_IDS } = {}) {
    this._createConfig = createConfig;
    this._max = maxPersistedIds;
    this._ownConfig = null;
  }

  _config() {
    if (!this._ownConfig) {
      this._ownConfig = this._createConfig({ name: 'push-receiver' });
    }
    return this._ownConfig;
  }

  read() {
    return this._config().get(KEY) || [];
  }

  write(ids) {
    this._config().set(KEY, ids.slice(-this._max));
  }

  // Guarded by has(): without it a second run would overwrite the migrated
  // file with an empty array. Returns null when the shared key is absent.
  migrateFromSharedConfig() {
    const shared = this._createConfig({});
    if (!shared.has(KEY)) {
      return null;
    }
    const old = shared.get(KEY) || [];
    this.write(old);
    shared.delete(KEY);
    return { count: old.length, kept: Math.min(old.length, this._max) };
  }
}

module.exports = { PersistentIdsStore };
