const TelephonyProvider = require('./TelephonyProvider');

class ExotelProvider extends TelephonyProvider {
  constructor(config = {}) {
    super(config);
    this.accountSid = config.accountSid || process.env.EXOTEL_ACCOUNT_SID;
    this.apiKey = config.apiKey || process.env.EXOTEL_API_KEY;
    this.apiToken = config.apiToken || process.env.EXOTEL_API_TOKEN;
    this.virtualNumber = config.virtualNumber || process.env.EXOTEL_VIRTUAL_NUMBER;
    this.baseUrl = config.baseUrl || process.env.EXOTEL_BASE_URL || 'https://api.exotel.com';
  }

  get name() { return 'exotel'; }
  isConfigured() { return Boolean(this.accountSid && this.apiKey && this.apiToken && this.virtualNumber); }

  authHeader() { return `Basic ${Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64')}`; }

  async startCall({ customerPhone, streamUrl, statusCallback, record = false, customField }) {
    if (!this.isConfigured()) throw new Error('Exotel is not configured. Set EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, and EXOTEL_VIRTUAL_NUMBER.');
    const form = new URLSearchParams({
      from: customerPhone,
      callerid: this.virtualNumber,
      streamtype: 'bidirectional',
      streamurl: streamUrl,
      statuscallback: statusCallback,
      'statuscallbackevents[]': 'answered,terminal',
      record: String(record),
    });
    if (customField) form.set('customfield', String(customField).slice(0, 128));
    const result = await fetch(`${this.baseUrl}/v1/accounts/${encodeURIComponent(this.accountSid)}/calls/connect`, { method: 'POST', headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    const body = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(`Exotel call failed (${result.status}): ${body?.message || body?.response?.message || 'unknown error'}`);
    return body.call || body;
  }

  async getCall(callId) {
    if (!this.isConfigured()) throw new Error('Exotel is not configured');
    const result = await fetch(`${this.baseUrl}/v1/accounts/${encodeURIComponent(this.accountSid)}/calls/${encodeURIComponent(callId)}`, { headers: { Authorization: this.authHeader() } });
    const body = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(`Exotel lookup failed (${result.status})`);
    return body.call || body;
  }
}

module.exports = ExotelProvider;
