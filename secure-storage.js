// secure-storage.js - 安全存储模块
// 管理敏感数据的加密存储

class SecureStorage {
  constructor() {
    this.isInitialized = false;
    this.encryptionKey = null;
  }

  // 初始化安全存储
  async initialize() {
    if (this.isInitialized) return;

    try {
      // 基于设备信息生成唯一密钥
      const deviceKey = await cryptoUtils.generateDeviceKey();
      const salt = cryptoUtils.generateSalt();
      
      // 派生加密密钥
      this.encryptionKey = await cryptoUtils.deriveKey(deviceKey, salt);
      
      // 存储盐值（用于后续解密）
      chrome.storage.local.set({ 
        'crypto_salt': Array.from(salt),
        'storage_initialized': true 
      });
      
      this.isInitialized = true;
      console.log('[SecureStorage] 安全存储已初始化');
    } catch (error) {
      console.error('[SecureStorage] 初始化失败:', error);
      throw error;
    }
  }

  // 获取存储的加密密钥
  async getEncryptionKey() {
    if (this.encryptionKey) return this.encryptionKey;

    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['crypto_salt', 'storage_initialized'], async (result) => {
        try {
          if (!result.storage_initialized || !result.crypto_salt) {
            await this.initialize();
            resolve(this.encryptionKey);
            return;
          }

          const deviceKey = await cryptoUtils.generateDeviceKey();
          const salt = new Uint8Array(result.crypto_salt);
          this.encryptionKey = await cryptoUtils.deriveKey(deviceKey, salt);
          this.isInitialized = true;
          resolve(this.encryptionKey);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  // 安全存储敏感数据
  async setSecureData(key, value) {
    try {
      const encryptionKey = await this.getEncryptionKey();
      const encryptedData = await cryptoUtils.encrypt(JSON.stringify(value), encryptionKey);
      
      chrome.storage.local.set({
        [`secure_${key}`]: encryptedData
      });
      
      console.log(`[SecureStorage] 安全存储 ${key} 成功`);
    } catch (error) {
      console.error(`[SecureStorage] 存储 ${key} 失败:`, error);
      throw error;
    }
  }

  // 获取安全存储的数据
  async getSecureData(key) {
    return new Promise(async (resolve, reject) => {
      try {
        const encryptionKey = await this.getEncryptionKey();
        
        chrome.storage.local.get([`secure_${key}`], async (result) => {
          try {
            const encryptedData = result[`secure_${key}`];
            if (!encryptedData) {
              resolve(null);
              return;
            }

            const decryptedData = await cryptoUtils.decrypt(encryptedData, encryptionKey);
            resolve(JSON.parse(decryptedData));
          } catch (error) {
            console.error(`[SecureStorage] 解密 ${key} 失败:`, error);
            resolve(null);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // 删除安全存储的数据
  async removeSecureData(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([`secure_${key}`], () => {
        console.log(`[SecureStorage] 已删除 ${key}`);
        resolve();
      });
    });
  }

  // 清除所有安全存储
  async clearSecureStorage() {
    return new Promise((resolve) => {
      chrome.storage.local.clear(() => {
        this.isInitialized = false;
        this.encryptionKey = null;
        console.log('[SecureStorage] 已清除所有安全存储');
        resolve();
      });
    });
  }
}

// 导出存储实例
window.secureStorage = new SecureStorage();