class TelephonyProvider {
  constructor(config = {}) { this.config = config; }

  get name() { return 'unknown'; }
  isConfigured() { return false; }
  async startCall() { throw new Error(`${this.name} telephony provider is not configured`); }
  async getCall() { throw new Error(`${this.name} telephony provider is not configured`); }
  async hangup() { throw new Error(`${this.name} telephony provider is not configured`); }
}

module.exports = TelephonyProvider;
