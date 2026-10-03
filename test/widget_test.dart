import 'package:flutter_test/flutter_test.dart';
import 'package:sadhna_healing/main.dart';

void main() {
  test('app link points at the deployed Sadhna Healing web app', () {
    expect(appUrl, 'https://sitemaintenance-commits.github.io/diwakar-suite/');
    expect(fallbackUrl, startsWith('https://script.google.com/macros/s/'));
    expect(fallbackUrl, endsWith('/exec'));
    expect(isAppHost(Uri.parse(appUrl).host), isTrue);
  });

  test('app pages stay inside the app; WhatsApp and other sites open outside', () {
    expect(isAppHost('script.google.com'), isTrue);
    expect(isAppHost('n-abc123-0lu-script.googleusercontent.com'), isTrue);
    expect(isAppHost('wa.me'), isFalse);
    expect(isAppHost('api.whatsapp.com'), isFalse);
    expect(isAppHost('docs.google.com'), isFalse);
  });

  test('WhatsApp, phone and email links leave the app', () {
    expect(shouldOpenOutside(Uri.parse('https://wa.me/919876543210?text=hi')), isTrue);
    expect(shouldOpenOutside(Uri.parse('tel:9876543210')), isTrue);
    expect(shouldOpenOutside(Uri.parse('mailto:a@b.com')), isTrue);
    expect(shouldOpenOutside(Uri.parse('whatsapp://send?phone=91')), isTrue);
    expect(shouldOpenOutside(Uri.parse('https://script.google.com/macros/s/x/exec')), isFalse);
    expect(shouldOpenOutside(Uri.parse('about:blank')), isFalse);
  });
}
