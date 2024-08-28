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

const config = new Config();

module.exports = {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
  setup,
};

// To be sure that start is called only once
let started = false;

// To be call from the main process
function setup(webContents, { socketTimeout, socketKeepAliveDelay } = {}) {
  // Config shape:
  // {
  //   firebase: {
  //     apiKey: string
  //     appID: string
  //     projectID: string
  //   },
  //   vapidKey?: string
  // }
  ipcMain.on(START_NOTIFICATION_SERVICE, async (_, fcmConfig) => {
    let credentials = config.get('credentials');
    const savedApiKey = config.get('fcmApiKey');
    if (started) {
      webContents.send(NOTIFICATION_SERVICE_STARTED, (credentials.fcm || {}).token);
      return;
    }

    try {
      // Retrieve saved persistentId : avoid receiving all already received notifications on start
      const persistentIds = config.get('persistentIds') || [];
      if (!credentials || savedApiKey !== fcmConfig.firebase.apiKey) {
        credentials = await register(fcmConfig);
        config.set('credentials', credentials);
        config.set('fcmApiKey', fcmConfig.firebase.apiKey);
        // Notify the renderer process that the FCM token has changed
        webContents.send(TOKEN_UPDATED, credentials.fcm.token);
      }
      // Listen for GCM/FCM notifications
      await listen(
        Object.assign({}, credentials, { persistentIds }),
        onNotification(webContents),
        { socketTimeout, socketKeepAliveDelay },
      );
      // Notify the renderer process that we are listening for notifications
      webContents.send(NOTIFICATION_SERVICE_STARTED, credentials.fcm.token);
      started = true
    } catch (e) {
      console.error('PUSH_RECEIVER:::Error while starting the service', e);
      // Forward error to the renderer process
      webContents.send(NOTIFICATION_SERVICE_ERROR, e.message);
    }
  });
}

// Will be called on new notification
function onNotification(webContents) {
  return ({ notification, persistentId }) => {
    const persistentIds = config.get('persistentIds') || [];
    // Update persistentId
    config.set('persistentIds', [...persistentIds, persistentId]);
    // Notify the renderer process that a new notification has been received
    // And check if window is not destroyed for darwin Apps
    if (!webContents.isDestroyed()) {
      webContents.send(NOTIFICATION_RECEIVED, notification);
    }
  };
}
