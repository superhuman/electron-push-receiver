const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mockUserDataDir;

jest.mock('electron', () => ({
  ipcMain: { on: jest.fn() },
  app: { getPath: () => mockUserDataDir },
}), { virtual: true });
jest.mock('@superhuman/push-receiver');

const {
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_RECEIVED,
} = require('../src/constants');

const NOW = 1702365002000;
const FCM_CONFIG = { firebase: { apiKey: 'api-key', appID: 'app', projectID: 'project' } };

function load() {
  jest.resetModules();
  const { ipcMain } = require('electron');
  const pushReceiver = require('@superhuman/push-receiver');
  const index = require('../src/index');
  return { index, ipcMain, pushReceiver };
}

function fakeWebContents() {
  return { send: jest.fn(), isDestroyed: () => false };
}

function idWithAge(ageMs) {
  return `0:${(NOW - ageMs) * 1000}%abc`;
}

function configPath() {
  return path.join(mockUserDataDir, 'config.json');
}

function writeConfig(obj) {
  fs.writeFileSync(configPath(), JSON.stringify(obj));
}

function readConfig() {
  return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
}

async function startService({ index, ipcMain, pushReceiver }, webContents, fcmConfig = FCM_CONFIG) {
  const client = new EventEmitter();
  pushReceiver.listen.mockImplementation(async (credentials, onNotification) => {
    client.notify = onNotification;
    return client;
  });
  index.setup(webContents);
  const handler = ipcMain.on.mock.calls[0][1];
  await handler(null, fcmConfig);
  return client;
}

describe('index', () => {
  beforeEach(() => {
    mockUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epr-'));
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(mockUserDataDir, { recursive: true, force: true });
  });

  it('seeds listen with the stored ids minus the stale ones', async () => {
    const env = load();
    const staleId = idWithAge(25 * 60 * 60 * 1000);
    const freshId = idWithAge(60 * 1000);
    writeConfig({
      credentials: { fcm: { token: 'saved-token' } },
      fcmApiKey: 'api-key',
      persistentIds: [staleId, freshId],
    });
    const webContents = fakeWebContents();
    await startService(env, webContents);

    expect(env.pushReceiver.listen.mock.calls[0][0].persistentIds).toEqual([freshId]);
    expect(webContents.send).toHaveBeenCalledWith(NOTIFICATION_SERVICE_STARTED, 'saved-token');
  });

  it('writes the received id to config.json after pruning stale ones', async () => {
    const env = load();
    const staleId = idWithAge(25 * 60 * 60 * 1000);
    const freshId = idWithAge(60 * 1000);
    writeConfig({
      credentials: { fcm: { token: 'saved-token' } },
      fcmApiKey: 'api-key',
      persistentIds: [staleId, freshId],
    });
    const webContents = fakeWebContents();
    const client = await startService(env, webContents);
    const notification = { title: 'hi' };
    const newId = idWithAge(1000);
    client.notify({ notification, persistentId: newId });

    expect(readConfig().persistentIds).toEqual([freshId, newId]);
    expect(webContents.send).toHaveBeenCalledWith(NOTIFICATION_RECEIVED, notification);
  });
});
