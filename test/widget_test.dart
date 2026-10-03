import 'package:flutter_test/flutter_test.dart';
import 'package:sadhna_healing/main.dart';

void main() {
  test('app link points at the deployed Sadhna Healing web app', () {
    expect(appUrl, startsWith('https://script.google.com/macros/s/'));
    expect(appUrl, endsWith('/exec'));
  });

  test('app pages stay inside the app; WhatsApp and other sites open outside', () {
    expect(isAppHost('script.google.com'), isTrue);
    expect(isAppHost('n-abc123-0lu-script.googleusercontent.com'), isTrue);
    expect(isAppHost('wa.me'), isFalse);
    expect(isAppHost('api.whatsapp.com'), isFalse);
    expect(isAppHost('docs.google.com'), isFalse);
  });
}
