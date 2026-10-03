import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

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

/// WhatsApp (wa.me), phone, email and any non-app website open in their own apps.
bool shouldOpenOutside(Uri uri) {
  const inApp = {'http', 'https', 'about', 'data', 'blob', 'javascript'};
  if (!inApp.contains(uri.scheme)) return true;
  if (uri.scheme != 'http' && uri.scheme != 'https') return false;
  return !isAppHost(uri.host);
}

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
  late final WebViewController _web;
  int _progress = 0;
  bool _firstLoadDone = false;
  String? _error;
  Timer? _splashTimer;

  // Never keep the splash up for long: the web app shows its own loading state.
  void _hideSplash() {
    if (!_firstLoadDone && mounted) setState(() => _firstLoadDone = true);
  }

  @override
  void dispose() {
    _splashTimer?.cancel();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _splashTimer = Timer(const Duration(seconds: 4), _hideSplash);
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFEEF3F1))
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (request) {
          // Only whole-page navigations can leave the app; frames inside the page always load.
          if (!request.isMainFrame) return NavigationDecision.navigate;
          final uri = Uri.tryParse(request.url);
          if (uri != null && shouldOpenOutside(uri)) {
            _openOutside(uri);
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
        onProgress: (p) {
          setState(() => _progress = p);
          if (p >= 60) _hideSplash();
        },
        onPageFinished: (_) => _hideSplash(),
        onWebResourceError: (error) {
          if (error.isForMainFrame ?? false) setState(() => _error = error.description);
        },
      ))
      ..loadRequest(Uri.parse(appUrl));
  }

  Future<void> _openOutside(Uri uri) async {
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) _toast('Could not open this link.');
    } catch (_) {
      if (mounted) _toast('Could not open this link.');
    }
  }

  void _toast(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  Future<void> _retry() async {
    setState(() {
      _error = null;
      _firstLoadDone = false;
    });
    await _web.loadRequest(Uri.parse(appUrl));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _web.canGoBack()) {
          await _web.goBack();
        } else {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: brand,
        body: SafeArea(
          bottom: false,
          child: Stack(children: [
            WebViewWidget(controller: _web),
            if (_progress < 100)
              LinearProgressIndicator(value: _progress / 100, minHeight: 3, color: const Color(0xFFD99A24), backgroundColor: Colors.transparent),
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
