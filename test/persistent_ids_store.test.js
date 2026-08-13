const { PersistentIdsStore } = require('../src/persistent_ids_store');

// One backing object per name, so two configs with the same name see each
// other's writes like two Config instances over one file.
function createConfigFactory() {
  const files = {};
  const factory = (options = {}) => {
    const name = options.name || 'config';
    if (!files[name]) {
      files[name] = {};
    }
    const data = files[name];
    return {
      get: key => data[key],
      set: (key, value) => {
        data[key] = value;
      },
      has: key => key in data,
      delete: key => {
        delete data[key];
      },
    };
  };
  factory.files = files;
  return factory;
}

describe('PersistentIdsStore', () => {
  it('starts empty and round-trips ids through push-receiver.json', () => {
    const createConfig = createConfigFactory();
    const store = new PersistentIdsStore({ createConfig });

    expect(store.read()).toEqual([]);

    store.write(['a', 'b']);

    expect(store.read()).toEqual(['a', 'b']);
    expect(createConfig.files['push-receiver'].persistentIds).toEqual(['a', 'b']);
    expect(createConfig.files.config).toBeUndefined();
  });

  it('caps writes to the most recent maxPersistedIds entries', () => {
    const store = new PersistentIdsStore({
      createConfig: createConfigFactory(),
      maxPersistedIds: 3,
    });
    store.write(['a', 'b', 'c', 'd', 'e']);
    expect(store.read()).toEqual(['c', 'd', 'e']);
  });

  it('caps writes to 5000 when no maxPersistedIds is given', () => {
    const store = new PersistentIdsStore({ createConfig: createConfigFactory() });
    const ids = Array.from({ length: 5010 }, (_, i) => `id-${i}`);
    store.write(ids);
    expect(store.read()).toHaveLength(5000);
  });

  describe('migrateFromSharedConfig', () => {
    it('moves and caps the shared list, then deletes only the shared key', () => {
      const createConfig = createConfigFactory();
      const shared = createConfig({});
      shared.set('persistentIds', ['a', 'b', 'c', 'd']);
      shared.set('credentials', { fcm: { token: 't' } });

      const store = new PersistentIdsStore({ createConfig, maxPersistedIds: 3 });
      const result = store.migrateFromSharedConfig();

      expect(result).toEqual({ count: 4, kept: 3 });
      expect(store.read()).toEqual(['b', 'c', 'd']);
      expect(shared.has('persistentIds')).toBe(false);
      expect(shared.get('credentials')).toEqual({ fcm: { token: 't' } });
    });

    it('migrates once, then leaves the migrated list alone', () => {
      const createConfig = createConfigFactory();
      const shared = createConfig({});
      shared.set('persistentIds', ['a']);
      const store = new PersistentIdsStore({ createConfig });

      expect(store.migrateFromSharedConfig()).toEqual({ count: 1, kept: 1 });
      expect(store.migrateFromSharedConfig()).toBeNull();
      expect(store.read()).toEqual(['a']);
    });

    it('deletes an empty shared list and reports zero', () => {
      const createConfig = createConfigFactory();
      const shared = createConfig({});
      shared.set('persistentIds', []);
      const store = new PersistentIdsStore({ createConfig });

      expect(store.migrateFromSharedConfig()).toEqual({ count: 0, kept: 0 });
      expect(shared.has('persistentIds')).toBe(false);
    });
  });
});
