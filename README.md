# electron-push-receiver

A module to bring Web Push support to [Electron](https://github.com/electron/electron) allowing it to receive notifications from Firebase Cloud Messaging (FCM).

## Why and how ?

See [this blog post](https://medium.com/@MatthieuLemoine/my-journey-to-bring-web-push-support-to-node-and-electron-ce70eea1c0b0).

## Install

```
npm i -S electron-push-receiver
```

## Usage

- In `main.js` / in main process :

```javascript
const { setup: setupPushReceiver } = require('electron-push-receiver');

// Call it before 'did-finish-load' with mainWindow a reference to your window
setupPushReceiver(mainWindow.webContents);
```

- In renderer process :

```javascript
import { ipcRenderer } from 'electron';
import {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED as ON_NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
} from 'electron-push-receiver/src/constants';

// Listen for service successfully started
ipcRenderer.on(NOTIFICATION_SERVICE_STARTED, (_, token) => // do something);
// Handle notification errors
ipcRenderer.on(NOTIFICATION_SERVICE_ERROR, (_, error) => // do something);
// Send FCM token to backend
ipcRenderer.on(TOKEN_UPDATED, (_, token) => // Send token);
// Display notification
ipcRenderer.on(ON_NOTIFICATION_RECEIVED, (_, notification) => // display notification);
// Start service
ipcRenderer.send(START_NOTIFICATION_SERVICE, {
  firebase: {
    apiKey: "XXxxXxX0x0x-Xxxx0-X0Xxxxx_0xxXx_XX0xXxX",
    appID: "1:000000000000:android:xxx0xxxx0000x000xxx000",
    projectID: "the-app-name"
  },
  vapidKey: '' // optional
});
```

## Example

Thanks to [CydeSwype](https://github.com/CydeSwype), you can find an example project [here](https://github.com/CydeSwype/electron-fcm-demo).
