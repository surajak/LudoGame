# Static recon — Ludo King 10.7.0.423 (reference only)

Source artifact: `Reference/Ludo+King®_10.7.0.423_APKPure.xapk` (256 MB XAPK, APKPure build).
Extracted to `Reference/_extracted/`; working copies in `Reference/_work/`.

Nothing in this document is reused in our build. It exists to define **which features
to reimplement** and **which behaviors to guarantee absent**.

## 1. Container layout

| APK | Size | Role |
|---|---|---|
| `com.ludo.king.apk` | 96.5 MB | base: 7 DEX, manifest, `global-metadata.dat`, level0/sharedassets |
| `UnityDataAssetPack.apk` | 121 MB | Play Asset Delivery: board packs, dice packs, art |
| `config.armeabi_v7a.apk` | 38.7 MB | native libs (single ABI) |
| `AddressablesAssetPack.apk` | 0.05 MB | Addressables catalog + 52 asset packs |

Package `com.ludo.king`, versionCode 423, minSdk 24, targetSdk 36, **armeabi-v7a only**.

## 2. Engine fingerprint

Unity + **IL2CPP**, not Mono. Therefore:

- Game logic is native (`lib/armeabi-v7a/libil2cpp.so`, 71.9 MB). No readable C#.
- `assets/bin/Data/Managed/Metadata/global-metadata.dat` (15.8 MB) still carries type,
  method and string names — this is where the feature inventory below comes from.
- `libunity.so` 18.9 MB; `libmain.so` is the JNI shim.

Native libs also present: `libFirebaseCppAnalytics`, `libFirebaseCppCrashlytics`,
`libFirebaseCppMessaging`, `libagora-rtc-sdk` + codec wrappers (voice chat),
`libapplovin-native-crash-reporter`, `libcrashlytics*`, `libnative-googlesignin`,
`libunitycoherencenative`.

## 3. Third-party SDK inventory (all to be omitted)

- **Ads / mediation**: Google Mobile Ads + UMP, AppLovin, DTExchange, InMobi,
  Liftoff (Vungle), Mintegral, Moloco, UnityAds, Amazon APS, Facebook Audience Network,
  Open Measurement (OM SDK).
- **Analytics / crash**: Firebase Analytics, Crashlytics, Messaging, Play install-referrer.
- **Commerce**: Play Billing, offerwall master DLL, gift/chest/IAP flows.
- **Identity / social**: Google Sign-In, Play Games, Facebook Unity SDK, NativeShare, BestHTTP.
- **Runtime**: Agora RTC (voice), Anti-Cheat Toolkit (`ACTk.Runtime`).
- **Animation**: DOTween, Spine (`spine-unity`), SVGA, Coffee.UIParticle.

## 4. Permissions requested

`INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `VIBRATE`,
`com.google.android.gms.permission.AD_ID`, `ACCESS_ADSERVICES_{AD_ID,ATTRIBUTION,TOPICS,CUSTOM_AUDIENCE}`,
`WAKE_LOCK`, `com.android.vending.{BILLING,CHECK_LICENSE}`, `BIND_GET_INSTALL_REFERRER_SERVICE`,
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `com.amazon.privacypass.ATTEST`,
`RECORD_AUDIO`, `BLUETOOTH`, `BLUETOOTH_CONNECT`, `MODIFY_AUDIO_SETTINGS`,
plus `C2D_MESSAGE` / FCM receive.

Our target: **none of the above**. Optional `VIBRATE` only.

## 5. Game modes observed (metadata identifiers)

`GameController`, `GameController5P`, `GameController6P`, `GameControllerSNL`,
`GameController_LMP_Quick` / `gameController_Quick` / `gameControllerQuickLMP`,
`gameControllerTeamUpOnline`, `GameController_Corona` (event variant).

Interpretation: classic Ludo (2–4p), 5-player and 6-player boards, Ludo "quick"/LMP
variant, Snake & Ladders (SNL) inside the same client, online team-up, seasonal event.

## 6. Rules / engine identifiers

`GameControllerParent`, `GameControllerInstance`, `TurnManager`-style helpers,
`MoveValidator`, `PathFinder`, `CaptureRule`, `SixRule`, `AILevelData`,
`ConnectNotAllowedByRuleset`, `b_falseTokenOnKillAnim` (capture animation hook),
safe-cell and home-path handling implied by `ABConfigCell` / `AddPawnAnimTile`.

## 7. Cosmetics / content packs

- Addressables: **52 packs**, 50 of them cosmetic — `CS_Gift_1..40+` (gift animations)
  and `CS_EntryEffect_0..7` (player entry effects), plus `Default_Fast_Follow` (camera).
- Unity asset packs: `assets/SNL/Android/BOARD/bpacksnl1..7` (7 board skins),
  `assets/SNL/Android/DICE/dicepack1..17` (17 dice skins).
- Skins/avatars: `ABAvatarHandler`, `ABAvatarPack`, `ABDicePack`, `ABStoreDicePack`,
  theme selection (`actCSWelcomeAndThemeSelected`, `actualSelectedThemeSNL`).

## 8. Animation identifiers (to reimplement, not copy)

`boardAnim`, `BG_ANIM`, `BOARD_ANIM`, `arrowanim`, `avatarAnim`, `attackAnimation`,
`b_falseTokenOnKillAnim`, `blinkAnimation`, `ButterFlyAnim`, `CakeThemeSparkAnim`,
`chestAnim`, `AddPawnAnimTile`, `actCollectAnim`, `actCardAnimCompleted`,
`allPlayingSVGAAnimList`, `ANIM_FILE_PREFIX` (SVGA), Spine + DOTween usage.

## 9. Audio identifiers

`SoundManager` (13 refs), `AudioManager`, `AudioClip` (30), `AudioSource` (14),
`arrAudioClip`, `ApplyAudioToTargets`, `animAudio`, `AUDIO_EFFECT_PRESET`.
No loose `.ogg`/`.mp3` in the base APK (one incidental `mp3`); audio is packed inside
Unity bundles, which is why it must be re-created rather than extracted.

## 10. Decoded manifest (JADX, heap 4096 MiB)

CLI run: `REA_JADX_HEAP_MIB=4096 rea inspect-android-package <base.apk>` →
`Reference/_work/android-package.json` (236 KB, exit 0).

Decode stats: **36,720 classes**, 2,059 resources, 7 DEX, load duration 74.8 s,
JVM heap limit 4096 MiB. With the default 120 s deadline the same command fails;
with 4096 MiB + 600 s it completes. Manifest status: `complete`, 122 components.

### 10.1 Component census

| Kind | Count | Exported |
|---|---|---|
| activity | 71 | 6 |
| service | 21 | 6 |
| receiver | 18 | 4 |
| provider | 12 | 1 |
| **total** | **122** | **17** |

Grouped by SDK owner — **exactly one component in the whole app belongs to the game**:

| Owner | Components | Exported |
|---|---|---|
| Ads/mediation: AppLovin (+MAX debugger ×16) | 23 | 0 |
| Google (GMS / Firebase / Play Games / Billing) | 27 | 7 |
| Facebook (Unity SDK + Audience Network) | 17 | 4 |
| MBridge | 7 | 1 |
| Fyber / DTExchange (Inneractive) | 5 | 0 |
| Unity (notification, share, play-core) | 5 | 0 |
| Amazon APS | 2 | 2 |
| InMobi | 2 | 0 |
| Vungle | 2 | 0 |
| Unattributed (Crashlytics, WorkManager, Picasso, Guava, AndroidX) | 31 | 3 |
| **First-party game** | **1** | **1** |

### 10.2 The only first-party component

`com.gametion.ludoking.LudoKingPlayerActivity` — the Unity player shell.

- `exported="true"`, declared with meta-data `unityplayer.UnityActivity=true`,
  `WindowManagerPreference:FreeformWindowSize`, `…FreeformWindowOrientation`,
  `notch_support`.
- Intent filter 1: `MAIN` + `LAUNCHER`.
- Intent filter 2: `VIEW` + `DEFAULT`/`BROWSABLE` with data `scheme=http`,
  `scheme=https`, `host=lk.gggred.com` — a **deep link that requires network**.
- Everything else the game does happens inside Unity via JNI into the ad/analytics SDKs.

### 10.3 Notable exported surface

All exported components are third-party SDK entry points, not game surface:

| Component | Exported via | Why it exists |
|---|---|---|
| `com.google.firebase.messaging.MessageForwardingService` | `BIND_JOB_SERVICE` | FCM push |
| `com.google.firebase.iid.FirebaseInstanceIdReceiver` | `c2dm.permission.SEND` | FCM token/registration |
| `com.facebook.FacebookContentProvider` | no permission | authority `com.facebook.app.FacebookContentProvider321549981551150` — share targets |
| `…signin.RevocationBoundService` | GMS revocation perm | Google Sign-In sign-out |
| `…nearby.exposurenotification.WakeUpService` | exposure perm | GMS Nearby |
| `SessionStateBroadcastReceiver` | `INSTALL_PACKAGES` | Play Core asset-pack install |
| `ProfileInstallReceiver`, `DiagnosticsReceiver` | `DUMP` | AndroidX profileinstaller / WorkManager diagnostics |
| `PlayGamesAppShortcutsActivity`, `ApsInterstitialActivity`, `DTBInterstitialActivity`, `CustomTabActivity`, `FBUnityAppLinkActivity`, `FBUnityDeepLinkingActivity`, `NetWorkChangeReceiver` | none | Play Games shortcuts, Amazon APS ads, Chrome custom tabs, FB deep links, connectivity listener |

Initialization providers (`MobileAdsInitProvider`, `AppLovinInitProvider`,
`FirebaseInitProvider`, `FacebookInitProvider`, `PlayGamesInitProvider`,
`VungleProvider`, `AudienceNetworkContentProvider`, `MBComponentLifecycleProvider`)
mean ad/analytics stacks self-start **before** any game code runs — no user-visible
consent gate precedes them.

### 10.4 What this changes for our build

1. **No counterpart components to port.** The game is one Unity activity; all menus,
   modes and rules are Unity scene objects. There is no Android UX to imitate.
2. **Deep linking is dropped.** `lk.gggred.com` is an online invite path; irrelevant
   offline, and removing it plus `INTERNET` makes the manifest provably inert.
3. **Our target manifest stays near-empty:** one activity, no services, no receivers,
   no providers, no `<uses-permission>` except optional `VIBRATE`.
4. **DEX layer confirmed free of gameplay.** 36,720 classes are SDK plumbing; no
   `RuleSet`/`TurnManager`-style logic, consistent with IL2CPP.

## 11. Recon conclusion

Static recon (Phase 0) is complete. The reference is: one Unity IL2CPP activity,
~122 SDK components, 52 addressable cosmetic packs, 7 board skins, 17 dice skins,
DOTween + SVGA + Spine animation, `SoundManager`-driven bundled audio, and game modes
classic / 5P / 6P / quick-LMP / team-up / SNL.

Feature selection and the keep/drop decision now live in `feature-spec.md`.
