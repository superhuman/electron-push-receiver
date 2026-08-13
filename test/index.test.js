const EventEmitter = require('events');

jest.mock('electron', () => ({ ipcMain: { on: jest.fn() } }), { virtual: true });
jest.mock('electron-config', () => {
  class FakeConfig {
    constructor(options = {}) {
      FakeConfig.constructed.push(options);
      const name = options.name || 'config';
      if (!FakeConfig.files[name]) {
        FakeConfig.files[name] = {};
      }
      this._data = FakeConfig.files[name];
    }
    get(key) {
      return this._data[key];
    }
    set(key, value) {
      this._data[key] = value;
    }
    has(key) {
      return key in this._data;
    }
    delete(key) {
      delete this._data[key];
    }
  }
  FakeConfig.constructed = [];
  FakeConfig.files = {};
  return FakeConfig;
});
jest.mock('@superhuman/push-receiver');

// Assigned by load(); every test must call it first.
let files;
let constructed;

function load() {
  jest.resetModules();
  const FakeConfig = require('electron-config');
  files = FakeConfig.files;
  constructed = FakeConfig.constructed;
  const { ipcMain } = require('electron');
  const pushReceiver = require('@superhuman/push-receiver');
  const index = require('../src/index');
  return { index, ipcMain, pushReceiver };
}

function fakeWebContents({ destroyed = false } = {}) {
  return { send: jest.fn(), isDestroyed: () => destroyed };
}

const FCM_CONFIG = { firebase: { apiKey: 'api-key', appID: 'app', projectID: 'project' } };

async function startService(
  { index, ipcMain, pushReceiver },
  setupOptions,
  fcmConfig = FCM_CONFIG,
  webContentsOptions = {},
) {
  const client = new EventEmitter();
  pushReceiver.register.mockResolvedValue({ fcm: { token: 'token' } });
  pushReceiver.listen.mockImplementation(async (credentials, onNotification) => {
    client.notify = onNotification;
    return client;
  });
  const webContents = fakeWebContents(webContentsOptions);
  index.setup(webContents, setupOptions);
  const handler = ipcMain.on.mock.calls[0][1];
  await handler(null, fcmConfig);
  return { client, webContents };
}

describe('index', () => {
  it('constructs no config at require time', () => {
    load();
    expect(constructed).toEqual([]);
  });

  it('skips renderer sends when the webContents is destroyed', async () => {
    const env = load();
    const { client, webContents } = await startService(env, {}, FCM_CONFIG, { destroyed: true });

    client.notify({ notification: { title: 'hi' }, persistentId: 'id-1' });

    expect(env.pushReceiver.listen).toHaveBeenCalled();
    expect(webContents.send).not.toHaveBeenCalled();
  });

  describe('v2 storage (payload opt-in)', () => {
    const V2_CONFIG = Object.assign({}, FCM_CONFIG, { persistentIds: { storage: 'v2' } });

    it('mirrors client persistentIds snapshots into push-receiver.json', async () => {
      const env = load();
      const { client } = await startService(env, {}, V2_CONFIG);

      client.emit('persistentIds', ['id-1', 'id-2']);
      expect(files['push-receiver'].persistentIds).toEqual(['id-1', 'id-2']);

      client.emit('persistentIds', []);
      expect(files['push-receiver'].persistentIds).toEqual([]);
    });

    it('does not write any config on notification delivery', async () => {
      const env = load();
      const { client, webContents } = await startService(env, {}, V2_CONFIG);

      client.notify({ notification: { title: 'hi' }, persistentId: 'id-1' });

      expect(files.config.persistentIds).toBeUndefined();
      expect(files['push-receiver'].persistentIds).toBeUndefined();
      expect(webContents.send).toHaveBeenCalledWith(
        'PUSH_RECEIVER:::NOTIFICATION_RECEIVED',
        { title: 'hi' },
      );
    });

    it('migrates the shared list before listening', async () => {
      const env = load();
      files.config = { persistentIds: ['old-1', 'old-2'] };
      const { pushReceiver } = env;

      await startService(env, {}, V2_CONFIG);

      expect(files.config.persistentIds).toBeUndefined();
      expect(files['push-receiver'].persistentIds).toEqual(['old-1', 'old-2']);
      expect(pushReceiver.listen.mock.calls[0][0].persistentIds).toEqual(['old-1', 'old-2']);
    });
  });

  describe('legacy storage (default when the payload is absent)', () => {
    it('behaves exactly like today: appends to the shared config, no new file', async () => {
      const env = load();
      const { client } = await startService(env, {}, FCM_CONFIG);

      client.notify({ notification: {}, persistentId: 'id-1' });
      client.notify({ notification: {}, persistentId: 'id-2' });

      expect(files.config.persistentIds).toEqual(['id-1', 'id-2']);
      expect(files['push-receiver']).toBeUndefined();
    });
  });
});
