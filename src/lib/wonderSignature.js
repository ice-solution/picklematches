import crypto from 'crypto';

export class WonderSignature {
  static generateRandomString(length) {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let randomString = '';
    for (let i = 0; i < length; i++) {
      randomString += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return randomString;
  }

  parseCredential(credential) {
    const parts = credential.split('/');
    if (parts.length !== 3) throw new Error('Invalid credential format');
    return { appid: parts[0], request_time: parts[1], algorithm: parts[2] };
  }

  generateSignatureMessage(credential, nonce, method, uri, body = null) {
    const parsedCredential = this.parseCredential(credential);
    let signatureKey = crypto.createHmac('sha256', nonce).update(parsedCredential.request_time).digest();
    signatureKey = crypto.createHmac('sha256', signatureKey).update(parsedCredential.algorithm).digest();
    let content = method.toUpperCase() + '\n' + uri;
    if (body !== null && body.trim().length > 0) content += '\n' + body;
    return crypto.createHmac('sha256', signatureKey).update(content).digest('hex');
  }

  signature(privateKey, credential, nonce, method, uri, body = null) {
    const plainSignature = this.generateSignatureMessage(credential, nonce, method, uri, body);
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(plainSignature);
    sign.end();
    return sign.sign(privateKey, 'base64');
  }
}
