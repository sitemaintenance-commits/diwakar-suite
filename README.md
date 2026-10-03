# Sadhna Healing: Android and iPhone app

One Flutter app for both Android and iPhone. It opens the live Sadhna Healing web app
(your Google Apps Script link) inside a native app. Because of that:

- every booking, patient and change still goes into your Google Sheet, and emails still send;
- when you update the web app (new version in Apps Script), the phone apps update automatically, with no reinstall.

What the app adds on top of the website:

- its own icon and name ("Sadhna Healing") on the home screen;
- a green splash screen while it loads, and a "No internet connection" screen with **Try again**;
- WhatsApp, phone and email links open in WhatsApp, the dialer and the mail app;
- the phone's back button goes back inside the app;
- if the app page hasn't loaded after a few seconds, the splash screen gives way to the page or a **Try again** screen, never an endless green screen.

The links are at the top of `lib/main.dart`:

- `appUrl`: the app page on GitHub Pages (no Google warning bar).
- `fallbackUrl`: your Apps Script web app link. The phone app opens this one automatically if the GitHub Pages page isn't available.

Change them only if the GitHub repository or the Apps Script deployment link changes.

---

## Get the Android APK (free, about 10 minutes, no software to install)

GitHub builds the APK for you on its servers.

1. Create a free account at github.com.
2. Click **+ → New repository**, name it `sadhna-healing-app`, choose **Private**, and click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Unzip `sadhna-healing-mobile.zip` on your computer, open the `mobile` folder, select **everything inside it**
   (including the hidden `.github` folder: on Windows tick View → Hidden items; on a Mac press Cmd+Shift+.)
   and drag it into the GitHub page. Click **Commit changes**.
   GitHub accepts up to 100 files per upload. If it says there are too many, upload the `android`
   folder first and commit, then upload everything else the same way and commit again.
5. Click the **Actions** tab. A run called **Build Sadhna Healing app** starts by itself when you push to the `sadhna-healing-app` branch (about 6 minutes).
6. When it shows a green tick, the finished files are saved to the branch `sadhna-healing-builds`:
   `Sadhna-Healing-Android.apk` (most phones), `Sadhna-Healing-Android-older-phones.apk`,
   `Sadhna-Healing-Android-all-phones.apk` and `Sadhna-Healing-iPhone-unsigned.ipa`.

### Install the APK on an Android phone

1. Send `Sadhna-Healing-Android.apk` to the phone (WhatsApp it to yourself, Google Drive, or a USB cable).
2. Tap it. Android asks to allow installing from this source: tap **Settings → Allow**, then **Install**.
3. Open **Sadhna Healing** from the home screen.

You can share the same APK file with all your patients.

### Google Play Store (optional)

To publish on the Play Store you need a Google Play developer account (one-time fee) and your own signing key:

1. Create a key once on any computer with Java:
   `keytool -genkey -v -keystore sadhna-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sadhna`
2. Put `sadhna-release.jks` in `android/app/` and create `android/key.properties`:
   ```
   storePassword=YOUR_PASSWORD
   keyPassword=YOUR_PASSWORD
   keyAlias=sadhna
   storeFile=sadhna-release.jks
   ```
3. Build an app bundle with `flutter build appbundle` and upload it in the Play Console.

Keep the `.jks` file and passwords safe. Without them you can never update the Play Store app.

---

## iPhone

Apple only lets iPhones install apps that are signed with an **Apple Developer account**
(a yearly paid membership). There is no way around this for an installable iPhone app.

The GitHub build above also builds the iPhone version (**sadhna-healing-ios-unsigned**), which
proves it compiles, but an unsigned build can't be installed on a phone.

Ways to get it onto iPhones:

- **App Store / TestFlight (recommended):** join the Apple Developer Program, then use Codemagic
  (codemagic.io, free tier) or a Mac with Xcode: open `ios/Runner.xcworkspace`, set your Team under
  Signing & Capabilities, then Product → Archive → Distribute. TestFlight lets up to 10,000 people
  install it by invitation link, without going through App Store review for each update.
- **No developer account:** iPhone users open the app link in **Safari**, tap **Share → Add to Home Screen**.
  It gets an icon on the home screen and works the same way.

---

## For developers

```
flutter pub get
flutter run                 # on a connected phone or emulator
flutter build apk --release # Android APK → build/app/outputs/flutter-apk/app-release.apk
flutter build ipa           # iPhone (needs a Mac, Xcode and signing)
```

- Package name / bundle ID: `com.sadhnahealing.sadhna_healing`
- Icons: `assets/icon/icon.png`; regenerate with `dart run flutter_launcher_icons`
- Known limit: CSV export and backup downloads don't work inside the phone app. Use the
  web link on a computer for those.
