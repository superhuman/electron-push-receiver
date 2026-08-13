// Sent by the renderer as fcmConfig.persistentIds on START_NOTIFICATION_SERVICE.
// 'v2' caps persistentIds in its own push-receiver.json and migrates the shared
// config.json once; anything else keeps the legacy unbounded append.
interface PersistentIdsOptions {
    storage?: 'v2' | 'legacy';
    maxPersistedIds?: number;
}

interface SetupOptions {
    socketTimeout?: number;
    socketKeepAliveDelay?: number;
    onError?: (error: Error) => void;
}

interface ElectronPushReceiver {
    START_NOTIFICATION_SERVICE: string;
    NOTIFICATION_SERVICE_STARTED: string;
    NOTIFICATION_SERVICE_ERROR: string;
    NOTIFICATION_RECEIVED: string;
    TOKEN_UPDATED: string;
    setup: (webContents: Electron.WebContents, options?: SetupOptions) => void;
}

declare const electronPushReceiver: ElectronPushReceiver;
export = electronPushReceiver;
