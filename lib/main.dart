import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:url_launcher/url_launcher.dart';

/// The Sadhna Healing web app (Google Apps Script). Change this if you redeploy
/// to a new link; existing installs pick up any change you publish to the same link.
const String appUrl =
    'https://script.google.com/macros/s/AKfycbw2f_qA7-79cAV1a6fjQtrwoblaM8Siprp9vEHbTTzgzrtdCwqG-CWVAU_VnIAw5gva/exec';

const Color brand = Color(0xFF1F4D46);
const Color brandInk = Color(0xFFFFFFFF);

/// Hosts the app itself runs on. Everything else (WhatsApp, maps, other sites)
/// opens outside the app.
bool isAppHost(String host) =>
    host == 'script.google.com' ||
    host.endsWith('.googleusercontent.com') ||
    host == 'accounts.google.com' ||
    host.endsWith('.gstatic.com') ||
    host == 'fonts.googleapis.com';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: brand,
    statusBarIconBrightness: Brightness.light,
    statusBarBrightness: Brightness.dark,
  ));
  runApp(const SadhnaApp());
}

class SadhnaApp extends StatelessWidget {
  const SadhnaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Sadhna Healing',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: brand), useMaterial3: true),
      home: const WebShell(),
    );
  }
}

class WebShell extends StatefulWidget {
  const WebShell({super.key});

  @override
  State<WebShell> createState() => _WebShellState();
}

class _WebShellState extends State<WebShell> {
  InAppWebViewController? _web;
  late final PullToRefreshController _refresh;
  double _progress = 0;
  bool _firstLoadDone = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh = PullToRefreshController(
      settings: PullToRefreshSettings(color: brand),
      onRefresh: () async => _web?.reload(),
    );
  }

  Future<void> _openOutside(Uri uri) async {
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) _toast('Could not open ${uri.scheme == 'https' ? uri.host : uri.scheme}.');
    } catch (_) {
      if (mounted) _toast('Could not open this link.');
    }
  }

  void _toast(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  /// WhatsApp (wa.me), phone, email and any non-app website open in their own apps.
  bool _shouldOpenOutside(Uri? uri) {
    if (uri == null) return false;
    if (uri.scheme != 'http' && uri.scheme != 'https') {
      return uri.scheme != 'about' && uri.scheme != 'data' && uri.scheme != 'blob' && uri.scheme != 'javascript';
    }
    return !isAppHost(uri.host);
  }

  Future<void> _retry() async {
    setState(() => _error = null);
    await _web?.loadUrl(urlRequest: URLRequest(url: WebUri(appUrl)));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (_web != null && await _web!.canGoBack()) {
          await _web!.goBack();
        } else {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: brand,
        body: SafeArea(
          bottom: false,
          child: Stack(children: [
            InAppWebView(
              initialUrlRequest: URLRequest(url: WebUri(appUrl)),
              pullToRefreshController: _refresh,
              initialSettings: InAppWebViewSettings(
                javaScriptEnabled: true,
                domStorageEnabled: true,
                databaseEnabled: true,
                useShouldOverrideUrlLoading: true,
                supportMultipleWindows: true,
                javaScriptCanOpenWindowsAutomatically: true,
                thirdPartyCookiesEnabled: true,
                mediaPlaybackRequiresUserGesture: true,
                allowsInlineMediaPlayback: true,
                transparentBackground: false,
                supportZoom: false,
                useWideViewPort: true,
                loadWithOverviewMode: true,
              ),
              onWebViewCreated: (c) => _web = c,
              shouldOverrideUrlLoading: (c, action) async {
                final uri = action.request.url;
                if (_shouldOpenOutside(uri)) {
                  await _openOutside(uri!);
                  return NavigationActionPolicy.CANCEL;
                }
                return NavigationActionPolicy.ALLOW;
              },
              // Links with target="_blank" (WhatsApp buttons, "Open the Google Sheet").
              onCreateWindow: (c, action) async {
                final uri = action.request.url;
                if (uri != null) await _openOutside(uri);
                return true;
              },
              onProgressChanged: (c, p) {
                setState(() => _progress = p / 100);
                if (p == 100) _refresh.endRefreshing();
              },
              onLoadStop: (c, url) {
                _refresh.endRefreshing();
                setState(() => _firstLoadDone = true);
              },
              onReceivedError: (c, request, error) {
                _refresh.endRefreshing();
                if (request.isForMainFrame ?? false) {
                  setState(() => _error = error.description);
                }
              },
            ),
            if (_progress < 1) LinearProgressIndicator(value: _progress, minHeight: 3, color: const Color(0xFFD99A24), backgroundColor: Colors.transparent),
            if (!_firstLoadDone && _error == null) const _Splash(),
            if (_error != null) _Offline(onRetry: _retry),
          ]),
        ),
      ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: brand,
      alignment: Alignment.center,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Image.asset('assets/icon/foreground.png', width: 120, height: 120),
        const SizedBox(height: 12),
        const Text('Sadhna Healing',
            style: TextStyle(color: brandInk, fontSize: 30, fontWeight: FontWeight.w700, fontFamily: 'serif')),
        const SizedBox(height: 6),
        const Text('Therapy sessions with our healers', style: TextStyle(color: Color(0xDDFFFFFF), fontSize: 15)),
        const SizedBox(height: 28),
        const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(color: brandInk, strokeWidth: 2.5)),
      ]),
    );
  }
}

class _Offline extends StatelessWidget {
  const _Offline({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFEEF3F1),
      padding: const EdgeInsets.all(32),
      alignment: Alignment.center,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.wifi_off_rounded, size: 56, color: brand),
        const SizedBox(height: 16),
        const Text('No internet connection',
            textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFF16221F))),
        const SizedBox(height: 8),
        const Text('Sadhna Healing needs the internet to show your bookings. Check your connection and try again.',
            textAlign: TextAlign.center, style: TextStyle(fontSize: 15, color: Color(0xFF5B6B66))),
        const SizedBox(height: 24),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: brand, padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14)),
          onPressed: onRetry,
          child: const Text('Try again', style: TextStyle(fontSize: 16)),
        ),
      ]),
    );
  }
}
