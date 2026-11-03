const { register, listen } = require('@superhuman/push-receiver');
const { ipcMain } = require('electron');
const Store = require('electron-store');
const {
  START_NOTIFICATION_SERVICE,
  INVALIDATE_REGISTRATION,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
} = require('./constants');
const { pruneStale } = require('./persistent_ids');

module.exports = {
  START_NOTIFICATION_SERVICE,
  INVALIDATE_REGISTRATION,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
  setup,
};

let config;
let startNotificationPromise;
let started = false;
let currentClient;

// Constructed on first `setup()` rather than at require time: this module is loaded while the
// host app's main bundle evaluates, before it can report errors, so any filesystem failure there
// kills the launch. The store shares `config.json` with the app's own stores, so an unreadable
// file is left for them to handle and push falls back to an in-memory store for this session.
function getConfig(reportError) {
  if (!config) {
    try {
      config = new Store();
    } catch (e) {
      reportError(e);
      config = memoryStore();
    }
  }
  return config;
}

function memoryStore() {
  const data = {};
  return {
    get: key => data[key],
    set: (key, value) => {
      data[key] = value;
    },
    delete: (key) => {
      delete data[key];
    },
  };
}

function setup(webContents, { socketTimeout, socketKeepAliveDelay, onError } = {}) {
  const send = (channel, payload) => {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, payload);
    }
  };
  const reportError = (e) => {
    console.error('PUSH_RECEIVER:::', e);
    if (onError) {
      onError(e);
    }
  };
  const store = getConfig(reportError);
  /**
   * @param {string} event
   * @param {(event: Electron.IpcMainEvent, fcmConfig: {
   *   firebase: {
   *     apiKey: string,
   *     appID: string,
   *     projectID: string
   *   },
   *   vapidKey?: string
   * }) => void} callback
   * @returns {void}
   */
  ipcMain.on(START_NOTIFICATION_SERVICE, async (_, fcmConfig) => {
    if (startNotificationPromise) {
      await startNotificationPromise;
    }

    let credentials = store.get('credentials');
    const savedApiKey = store.get('fcmApiKey');
    if (started) {
      send(NOTIFICATION_SERVICE_STARTED, (credentials.fcm || {}).token);
      return;
    }

    startNotificationPromise = new Promise(async (resolve) => {
      try {
        const persistentIds = pruneStale(store.get('persistentIds') || []);
        if (!credentials || savedApiKey !== fcmConfig.firebase.apiKey) {
          credentials = await register(fcmConfig);
          store.set('credentials', credentials);
          store.set('fcmApiKey', fcmConfig.firebase.apiKey);
          // Notify the renderer process that the FCM token has changed
          send(TOKEN_UPDATED, credentials.fcm.token);
        }
        // Listen for GCM/FCM notifications
        const client = await listen(
          Object.assign({}, credentials, { persistentIds }),
          onNotification(store, send, reportError),
          { socketTimeout, socketKeepAliveDelay },
        );
        if (onError) {
          client.on('error', onError);
        }
        currentClient = client;
        // Notify the renderer process that we are listening for notifications
        send(NOTIFICATION_SERVICE_STARTED, credentials.fcm.token);
        started = true;
      } catch (e) {
        console.error('PUSH_RECEIVER:::Error while starting the service', e);
        // Forward error to the renderer process
        send(NOTIFICATION_SERVICE_ERROR, e.message);
      } finally {
        resolve();
        startNotificationPromise = null;
      }
    });
  });

  // Forces the next START_NOTIFICATION_SERVICE to mint a fresh token, e.g. after the backend
  // rejects the current one - the `apiKey` check above alone won't catch that. `handle`, not
  // `on`, so the caller can await completion before immediately calling START_NOTIFICATION_SERVICE.
  ipcMain.handle(INVALIDATE_REGISTRATION, async () => {
    if (startNotificationPromise) {
      await startNotificationPromise;
    }
    if (currentClient) {
      currentClient.destroy();
      currentClient = undefined;
    }
    try {
      store.delete('credentials');
      store.delete('fcmApiKey');
    } finally {
      started = false;
    }
  });
}

// Will be called on new notification. The push client already dedupes received ids in memory,
// so a failed save costs at most a redelivered push after restart - never drop this one for it.
function onNotification(store, send, reportError) {
  return ({ notification, persistentId }) => {
    send(NOTIFICATION_RECEIVED, notification);
    try {
      const persistentIds = pruneStale(store.get('persistentIds') || []);
      store.set('persistentIds', [...persistentIds, persistentId]);
    } catch (e) {
      reportError(e);
    }
  };
}
