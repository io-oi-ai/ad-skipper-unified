// crypto-utils.js - 加密工具模块
// 使用浏览器原生 Web Crypto API 进行加密

class CryptoUtils {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
  }

  // 生成密钥
  async generateKey() {
    return await crypto.subtle.generateKey(
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // 从密码派生密钥
  async deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: this.algorithm, length: this.keyLength },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // 加密数据
  async encrypt(data, key) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encryptedData = await crypto.subtle.encrypt(
      {
        name: this.algorithm,
        iv: iv,
      },
      key,
      encoder.encode(data)
    );

    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encryptedData))
    };
  }

  // 解密数据
  async decrypt(encryptedData, key) {
    const decoder = new TextDecoder();
    
    const decryptedData = await crypto.subtle.decrypt(
      {
        name: this.algorithm,
        iv: new Uint8Array(encryptedData.iv),
      },
      key,
      new Uint8Array(encryptedData.data)
    );

    return decoder.decode(decryptedData);
  }

  // 生成随机盐
  generateSalt() {
    return crypto.getRandomValues(new Uint8Array(16));
  }

  // 基于设备信息生成唯一密钥
  async generateDeviceKey() {
    const deviceInfo = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      new Date().getTimezoneOffset().toString()
    ].join('|');

    const encoder = new TextEncoder();
    const data = encoder.encode(deviceInfo);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// 导出工具实例
window.cryptoUtils = new CryptoUtils();