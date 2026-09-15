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
const { pruneStale } = require('./persistent_ids');

const config = new Config();

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
   *   vapidKey?: string
   * }) => void} callback
   * @returns {void}
   */
  ipcMain.on(START_NOTIFICATION_SERVICE, async (_, fcmConfig) => {
    if (startNotificationPromise) {
      await startNotificationPromise;
    }

    let credentials = config.get('credentials');
    const savedApiKey = config.get('fcmApiKey');
    if (started) {
      send(NOTIFICATION_SERVICE_STARTED, (credentials.fcm || {}).token);
      return;
    }

    startNotificationPromise = new Promise(async (resolve) => {
      try {
        const persistentIds = pruneStale(config.get('persistentIds') || []);
        if (!credentials || savedApiKey !== fcmConfig.firebase.apiKey) {
          credentials = await register(fcmConfig);
          config.set('credentials', credentials);
          config.set('fcmApiKey', fcmConfig.firebase.apiKey);
          // Notify the renderer process that the FCM token has changed
          send(TOKEN_UPDATED, credentials.fcm.token);
        }
        // Listen for GCM/FCM notifications
        const client = await listen(
          Object.assign({}, credentials, { persistentIds }),
          onNotification(send),
          { socketTimeout, socketKeepAliveDelay },
        );
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
function onNotification(send) {
  return ({ notification, persistentId }) => {
    const persistentIds = pruneStale(config.get('persistentIds') || []);
    config.set('persistentIds', [...persistentIds, persistentId]);
    send(NOTIFICATION_RECEIVED, notification);
  };
}
