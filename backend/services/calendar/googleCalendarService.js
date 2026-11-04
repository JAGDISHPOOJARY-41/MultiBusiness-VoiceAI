const { google } = require('googleapis');

class GoogleCalendarService {
  constructor(config = {}) {
    this.calendarId = config.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
    this.timeZone = config.timeZone || process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';
    this.auth = null;
    this.clientId = config.clientId || process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret = config.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';
    this.redirectUri = config.redirectUri || process.env.GOOGLE_REDIRECT_URI || '';
    if (this.clientId && this.clientSecret && process.env.GOOGLE_REFRESH_TOKEN) this.setRefreshToken(process.env.GOOGLE_REFRESH_TOKEN);
  }

  isConfigured() { return Boolean(this.auth); }
  hasOAuthClient() { return Boolean(this.clientId && this.clientSecret && this.redirectUri); }
  authorizationUrl(state = 'voxly-calendar') { if (!this.hasOAuthClient()) throw new Error('Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI first'); const oauth = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri); return oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/calendar'] , state }); }
  async exchangeCode(code) { if (!this.hasOAuthClient()) throw new Error('Google OAuth client is not configured'); const oauth = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri); const result = await oauth.getToken(code); this.auth = oauth; return result.tokens; }
  setRefreshToken(refreshToken) { const oauth = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri); oauth.setCredentials({ refresh_token: refreshToken }); this.auth = oauth; }
  calendar() { if (!this.auth) throw new Error('Google Calendar is not configured'); return google.calendar({ version: 'v3', auth: this.auth }); }

  async checkAvailability({ start, end }) {
    const response = await this.calendar().freebusy.query({ requestBody: { timeMin: start, timeMax: end, timeZone: this.timeZone, items: [{ id: this.calendarId }] } });
    const busy = response.data.calendars?.[this.calendarId]?.busy || [];
    return { available: busy.length === 0, busy };
  }

  async createEvent({ summary, description, start, end, attendeeEmail, metadata = {} }) {
    const event = { summary, description, start: { dateTime: start, timeZone: this.timeZone }, end: { dateTime: end, timeZone: this.timeZone }, extendedProperties: { private: metadata } };
    if (attendeeEmail) event.attendees = [{ email: attendeeEmail }];
    const response = await this.calendar().events.insert({ calendarId: this.calendarId, requestBody: event, sendUpdates: attendeeEmail ? 'all' : 'none' });
    return response.data;
  }

  async updateEvent(eventId, patch) { return (await this.calendar().events.patch({ calendarId: this.calendarId, eventId, requestBody: patch, sendUpdates: 'all' })).data; }
  async cancelEvent(eventId) { await this.calendar().events.delete({ calendarId: this.calendarId, eventId }); return true; }
}

module.exports = GoogleCalendarService;
