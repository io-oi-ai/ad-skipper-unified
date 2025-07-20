// invite-validator.js - 邀请码验证模块
// 使用客户端算法验证邀请码，避免硬编码

class InviteValidator {
  constructor() {
    // 邀请码生成算法的种子
    this.seeds = [
      'UniAd2025',
      'SkipAI#%',
      'BiliTube@',
      'SecKey!$'
    ];
  }

  // 基于算法生成有效邀请码
  async generateValidCodes(count = 100) {
    const codes = new Set();
    
    for (let i = 0; i < count * 10 && codes.size < count; i++) {
      const code = await this.generateCode(i);
      if (code && code.length === 6) {
        codes.add(code);
      }
    }
    
    return Array.from(codes);
  }

  // 生成单个邀请码
  async generateCode(index) {
    const seed = this.seeds[index % this.seeds.length];
    const input = seed + index.toString();
    
    // 使用 SHA-256 生成哈希
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    // 转换为6位数字码
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += (hashArray[i] % 10).toString();
    }
    
    return code;
  }

  // 验证邀请码
  async validateCode(inputCode) {
    if (!inputCode || inputCode.length !== 6 || !/^\d{6}$/.test(inputCode)) {
      return false;
    }

    // 生成前500个可能的有效码进行匹配
    const validCodes = await this.generateValidCodes(500);
    return validCodes.includes(inputCode);
  }

  // 获取一些示例邀请码（用于测试）
  async getSampleCodes(count = 10) {
    const codes = await this.generateValidCodes(count);
    return codes.slice(0, count);
  }
}

// 导出验证器实例
window.inviteValidator = new InviteValidator();