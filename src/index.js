const { register, listen } = require('@superhuman/push-receiver');
const { ipcMain } = require('electron');
const Config = require('electron-config');
const {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
} = require('./constants');
const { PersistentIdsStore } = require('./persistent_ids_store');

const createConfig = options => new Config(options);

// electron-config's constructor reads and rewrites the whole file, so a
// module-scope instance costs a full-file write at require() time.
let sharedConfig;
function getSharedConfig() {
  if (!sharedConfig) {
    sharedConfig = new Config();
  }
  return sharedConfig;
}

module.exports = {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
  setup,
};

let startNotificationPromise;
let started = false;

function setup(webContents, { socketTimeout, socketKeepAliveDelay, onError } = {}) {
  // No-ops once the window is gone: Electron throws on send to a destroyed webContents.
  const send = (channel, payload) => {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, payload);
    }
  };
  /**
   * @param {string} event
   * @param {(event: Electron.IpcMainEvent, fcmConfig: {
   *   firebase: {
   *     apiKey: string,
   *     appID: string,
   *     projectID: string
   *   },
   *   vapidKey?: string,
   *   persistentIds?: { storage?: 'v2' | 'legacy', maxPersistedIds?: number }
   * }) => void} callback
   * @returns {void}
   */
  ipcMain.on(START_NOTIFICATION_SERVICE, async (_, fcmConfig) => {
    if (startNotificationPromise) {
      await startNotificationPromise;
    }

    const config = getSharedConfig();
    let credentials = config.get('credentials');
    const savedApiKey = config.get('fcmApiKey');
    if (started) {
      send(NOTIFICATION_SERVICE_STARTED, ((credentials || {}).fcm || {}).token);
      return;
    }

    // The renderer payload is the only switch, so the host app flips storage
    // modes with a web deploy and a bare package bump changes nothing.
    const persistentIdsOptions = (fcmConfig && fcmConfig.persistentIds) || {};
    const useLegacyStorage = persistentIdsOptions.storage !== 'v2';

    startNotificationPromise = new Promise(async (resolve) => {
      try {
        // Sent at login so the server does not resend notifications we already have.
        let seedIds;
        let store = null;
        if (useLegacyStorage) {
          seedIds = config.get('persistentIds') || [];
        } else {
          store = new PersistentIdsStore({
            createConfig,
            maxPersistedIds: persistentIdsOptions.maxPersistedIds,
          });
          store.migrateFromSharedConfig();
          seedIds = store.read();
        }
        if (!credentials || savedApiKey !== fcmConfig.firebase.apiKey) {
          credentials = await register(fcmConfig);
          config.set('credentials', credentials);
          config.set('fcmApiKey', fcmConfig.firebase.apiKey);
          // Notify the renderer process that the FCM token has changed
          send(TOKEN_UPDATED, credentials.fcm.token);
        }
        // Listen for GCM/FCM notifications
        const client = await listen(
          Object.assign({}, credentials, { persistentIds: seedIds }),
          onNotification(send, { useLegacyStorage }),
          { socketTimeout, socketKeepAliveDelay },
        );
        if (store) {
          // The client emits a snapshot on every mutation, including the
          // clear after a successful MCS login acks the ids.
          client.on('persistentIds', ids => store.write(ids));
        }
        if (onError) {
          client.on('error', onError);
        }
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
}

// Will be called on new notification
function onNotification(send, { useLegacyStorage }) {
  return ({ notification, persistentId }) => {
    if (useLegacyStorage) {
      const config = getSharedConfig();
      const persistentIds = config.get('persistentIds') || [];
      config.set('persistentIds', [...persistentIds, persistentId]);
    }
    // Notify the renderer process that a new notification has been received
    send(NOTIFICATION_RECEIVED, notification);
  };
}
