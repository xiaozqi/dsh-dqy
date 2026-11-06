# notify-listen

A minimal Android app that turns the phone's own notification stream into HTTP
POST requests for the DQY plugin. It is the privileged alternative to
the logcat-based source.

## Why a NotificationListenerService

Reading notifications from `logcat` works on rooted/debuggable builds but the
extracted fields are unreliable: titles are usually absent, package names ride
on system-internal log lines, and the format differs per OEM ROM.

Android exposes the real notification stream to apps that hold the
**Notification access** (`通知使用权`) permission. An app declares a service
extending `NotificationListenerService`; once the user enables it in Settings,
the system binds the service and calls `onNotificationPosted()` with the full
`StatusBarNotification` — package, title, text, timestamp — the exact fields
the logcat source can only guess at.

## Build

Requires Android SDK 34 + JDK 17. This machine ships only the scaffold; on a
build machine run:

```bash
cd android/notify-listen
./gradlew :app:assembleDebug
```

Install on the connected device:

```bash
adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk
```

## Authorize notification access

The permission cannot be granted from code. On the phone:

1. Settings -> Notifications -> Notification access
   (设置 -> 通知和状态栏 -> 通知使用权)
2. Find **NotifyListen** and enable it.
3. Confirm the system dialog.

Alternatively open the settings screen directly:

```bash
adb -s <serial> shell appops set com.dqy.notify GET_NOTIFICATION true
# or, on most EMUI builds:
adb -s <serial> shell am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
```

## Runtime contract

`onNotificationPosted` POSTs JSON to `DEFAULT_ENDPOINT`
(`http://<host-gateway-ip>:14123/notify`):

```json
{ "app": "com.tencent.mobileqq", "title": "...", "text": "...", "when": 1793702367468, "id": "0|com.tencent.mobileqq|123|...|1000" }
```

Edit `DEFAULT_ENDPOINT` in `NotifyListener.kt` if the host IP changes.

## Switching the plugin to this source

The plugin depends only on `NotificationSource`
(`src/domain/ports/notification.port.ts`). To use the APK stream instead of
logcat, add one new infrastructure class, e.g.
`src/infrastructure/notifications/http-notification-source.ts`, that:

- starts an HTTP server on port 14123,
- parses each POST body into a `NotificationEvent` (`source: 'notify-listen'`),
- implements `subscribe`/`start`/`stop`/`connected` exactly as
  `LogcatNotificationSource` does.

Then swap the `new LogcatNotificationSource(...)` line in `src/index.ts` for
the new class. The 5-layer filter pipeline, `NotificationService` and the
`fish_notifications` tool stay untouched.
