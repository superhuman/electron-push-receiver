const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mockUserDataDir;

jest.mock('electron', () => ({
  ipcMain: { on: jest.fn(), handle: jest.fn() },
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

function wasSentWith(webContents, event) {
  return webContents.send.mock.calls.some(([sentEvent]) => sentEvent === event);
}

// The START_NOTIFICATION_SERVICE handler doesn't await its own registration+listen work (it's
// fire-and-forget by design - see the module doc), so `await handler(...)` alone doesn't
// guarantee that work has settled by the time it returns. Poll for the real side effect instead
// of asserting immediately. Uses a bounded attempt count, not elapsed time, since `Date.now()` is
// mocked to a fixed value in these tests.
async function waitFor(predicate, { attempts = 200, interval = 5 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('waitFor timed out');
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
  client.destroy = jest.fn();
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

  it('resends the cached token without re-registering on a second start with the same config', async () => {
    const env = load();
    let registerCallCount = 0;
    env.pushReceiver.register.mockImplementation(async () => {
      registerCallCount += 1;
      return { fcm: { token: `token-${registerCallCount}` }, gcm: { token: `gcm-${registerCallCount}` } };
    });
    const webContents = fakeWebContents();

    await startService(env, webContents);
    expect(webContents.send).toHaveBeenLastCalledWith(NOTIFICATION_SERVICE_STARTED, 'token-1');
    expect(registerCallCount).toBe(1);

    // Simulate a reload/account-switch: same handler, same fcmConfig, still `started`.
    const startHandler = env.ipcMain.on.mock.calls[0][1];
    await startHandler(null, FCM_CONFIG);

    // The bug: reload alone never mints a new token, good or bad.
    expect(webContents.send).toHaveBeenLastCalledWith(NOTIFICATION_SERVICE_STARTED, 'token-1');
    expect(registerCallCount).toBe(1);
  });

  it('mints a genuinely new token after INVALIDATE_REGISTRATION and tears down the stale client', async () => {
    const env = load();
    let registerCallCount = 0;
    env.pushReceiver.register.mockImplementation(async () => {
      registerCallCount += 1;
      return { fcm: { token: `token-${registerCallCount}` }, gcm: {} };
    });
    const webContents = fakeWebContents();

    const client = await startService(env, webContents);
    expect(registerCallCount).toBe(1);

    // Unlike START_NOTIFICATION_SERVICE (`on`), this is `handle`, so it's awaitable - the caller
    // needs to know invalidation finished before immediately starting again.
    const invalidateHandler = env.ipcMain.handle.mock.calls[0][1];
    await invalidateHandler();
    expect(client.destroy).toHaveBeenCalled();

    webContents.send.mockClear();
    const startHandler = env.ipcMain.on.mock.calls[0][1];
    await startHandler(null, FCM_CONFIG);
    await waitFor(() => wasSentWith(webContents, NOTIFICATION_SERVICE_STARTED));

    expect(registerCallCount).toBe(2);
    expect(webContents.send).toHaveBeenCalledWith(NOTIFICATION_SERVICE_STARTED, 'token-2');
  });

  it('invalidate awaits an in-flight start before clearing, instead of racing it', async () => {
    const env = load();
    let registerCallCount = 0;
    env.pushReceiver.register.mockImplementation(async () => {
      registerCallCount += 1;
      return { fcm: { token: `token-${registerCallCount}` }, gcm: {} };
    });
    env.pushReceiver.listen.mockImplementation(async () => {
      const client = new EventEmitter();
      client.destroy = jest.fn();
      return client;
    });
    const webContents = fakeWebContents();

    env.index.setup(webContents);
    const startHandler = env.ipcMain.on.mock.calls[0][1];
    const invalidateHandler = env.ipcMain.handle.mock.calls[0][1];

    // Fire the first start but don't wait for it - then invalidate immediately. If invalidate
    // didn't wait for the in-flight start, `started` could land `true` right after, and the next
    // start would hit the early-return path and resend token-1 instead of registering fresh.
    startHandler(null, FCM_CONFIG);
    await invalidateHandler();

    webContents.send.mockClear();
    await startHandler(null, FCM_CONFIG);
    await waitFor(() => wasSentWith(webContents, NOTIFICATION_SERVICE_STARTED));

    expect(registerCallCount).toBe(2);
    expect(webContents.send).toHaveBeenCalledWith(NOTIFICATION_SERVICE_STARTED, 'token-2');
  });
});
