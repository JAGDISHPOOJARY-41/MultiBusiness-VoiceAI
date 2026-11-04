require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { getApps, getApp, initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const engine = require('./workflows');
const workflowEngine = require('./services/ai/workflowEngine');
const ExotelProvider = require('./services/telephony/ExotelProvider');
const GoogleCalendarService = require('./services/calendar/googleCalendarService');
const SpeechToTextProvider = require('./services/speech/speechToText');
const TextToSpeechProvider = require('./services/speech/textToSpeech');
const { normalizePhoneNumber, isValidPhone, digitsOnly } = require('./utils/phone');

const PORT = Number(process.env.PORT || 8000);
const app = express();
app.use(cors({
  origin(origin, callback) {
    // Allow Vite's local ports, including 5174 when another dev server is already using 5173.
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    return callback(new Error('Local development origin is not allowed'));
  },
}));
app.use(express.json({ limit: '1mb' }));

const memory = { conversations: new Map(), appointments: new Map(), cakeOrders: new Map(), businesses: new Map(), customers: new Map(), followups: new Map(), voiceCalls: new Map(), missedCalls: new Map(), voiceSettings: new Map() };
let firestore = null;
const exotel = new ExotelProvider();
const calendar = new GoogleCalendarService();
const speechToText = new SpeechToTextProvider();
const textToSpeech = new TextToSpeechProvider();
const voiceSessions = new Map();
const defaultVoiceSettings = { enabled: true, businessId: 'clinic', businessPhone: process.env.EXOTEL_VIRTUAL_NUMBER || '', assistantName: 'Maya', language: 'en-IN', timezone: process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata', recordCalls: false, transcript: true, businessHours: { start: '09:00', end: '18:00' }, afterHoursBehavior: 'ai_answers', maxCallDurationSeconds: 900, enabledWorkflows: ['clinic-appointment', 'clinic-reschedule', 'clinic-cancel', 'clinic-enquiry'] };

function initFirestore() {
  try {
    if (getApps().length) return getFirestore(getApp());
    let credential;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) credential = cert(JSON.parse(fs.readFileSync(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8')));
    else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) credential = cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') });
    else if (process.env.GOOGLE_CLOUD_PROJECT) credential = applicationDefault();
    else return null;
    return getFirestore(initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID }));
  } catch (error) { console.warn('Firebase Admin unavailable; using memory storage.', error.message); return null; }
}

firestore = initFirestore();
function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function collectionFor(name) { return firestore ? firestore.collection(name) : null; }

async function writeDocument(collection, documentId, data) {
  const payload = { ...data, updatedAt: now() };
  if (firestore) await collectionFor(collection).doc(documentId).set(payload, { merge: true });
  else { if (!memory[collection]) memory[collection] = new Map(); memory[collection].set(documentId, { ...(memory[collection].get(documentId) || {}), ...payload }); }
  return { id: documentId, ...payload };
}

async function listDocuments(collection) {
  if (firestore) { const snapshot = await collectionFor(collection).orderBy('updatedAt', 'desc').limit(100).get(); return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })); }
  return [...(memory[collection] || new Map()).entries()].map(([id, value]) => ({ id, ...value }));
}

async function readDocument(collection, documentId) {
  if (firestore) { const snapshot = await collectionFor(collection).doc(documentId).get(); return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null; }
  const value = memory[collection]?.get(documentId); return value ? { id: documentId, ...value } : null;
}

function maskPhone(value) { const phone = String(value || ''); return phone.length > 4 ? `${'*'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone; }
function callIdFrom(body) { return String(body.callId || body.call_id || body.callSid || body.call_sid || body.sid || id('call')); }
function providerCallIdFrom(body) { return String(body.providerCallId || body.call_sid || body.callSid || body.sid || body.CallSid || ''); }
function callerPhoneFrom(body) { return normalizePhoneNumber(body.callerPhone || body.caller_phone || body.from || body.From || body.phone || body.customerPhone); }
function businessIdFrom(body) { return String(body.businessId || body.business_id || 'clinic'); }
function voiceStatus(value) {
  const status = String(value || '').toLowerCase().replace(/[_ -]+/g, '');
  if (status === 'ringing' || status === 'queued' || status === 'inprogress') return status === 'ringing' ? 'RINGING' : 'ANSWERED';
  if (status === 'answered' || status === 'connected') return 'ANSWERED';
  if (status === 'busy' || status === 'noanswer') return 'MISSED';
  if (status === 'failed') return 'FAILED';
  if (status === 'completed' || status === 'terminated' || status === 'hangup') return 'COMPLETED';
  return String(value || 'IN_PROGRESS').toUpperCase();
}

async function saveVoiceCall(callId, patch) { return writeDocument('voiceCalls', callId, { provider: 'exotel', ...patch }); }
async function saveMissedCall(callId, patch) { return writeDocument('missedCalls', callId, { ...patch, status: patch.status || 'MISSED' }); }

async function saveCustomerFromCall({ businessId, callerPhone, name }) {
  if (!callerPhone) return null;
  const customerId = `customer_${businessId}_${digitsOnly(callerPhone)}`;
  const existing = await readDocument('customers', customerId);
  return writeDocument('customers', customerId, { businessId, phone: callerPhone, name: name || existing?.name || null, lastCallAt: now(), totalCalls: Number(existing?.totalCalls || 0) + 1 });
}

function settingsFor(businessId = 'clinic') { return memory.voiceSettings.get(businessId) || { ...defaultVoiceSettings, businessId }; }

function isYes(text) { return /^(yes|y|okay|ok|confirm|confirmed|please do|do it|sure)$/i.test(String(text || '').trim()); }
function isNo(text) { return /^(no|n|not now|change|wrong)$/i.test(String(text || '').trim()); }
function priorityFor(data) { return ['today', 'tomorrow'].includes(String(data.appointment_date || data.required_date || '').toLowerCase()) ? 'URGENT' : 'NORMAL'; }

async function performAction(workflow, data, userId) {
  const timestamp = now();
  if (workflow.id === 'clinic-appointment') {
    let calendarEventId = null;
    if (calendar.isConfigured()) {
      const start = `${data.appointment_date}T${data.appointment_time}:00`;
      const endDate = new Date(`${start}+05:30`); endDate.setMinutes(endDate.getMinutes() + 30);
      const end = `${endDate.toISOString().slice(0, 19)}`;
      const availability = await calendar.checkAvailability({ start: `${start}+05:30`, end: `${end}+05:30` });
      if (!availability.available) return { actionStatus: 'calendar_conflict', reply: 'That time is no longer available. Please choose another appointment time.' };
      const event = await calendar.createEvent({ summary: `${data.doctor_specialty} appointment - ${data.patient_name}`, description: data.reason_for_visit || 'Booked by Voxly AI', start, end, metadata: { workflowId: workflow.id, patientName: data.patient_name } });
      calendarEventId = event.id || null;
    }
    const appointmentId = id('apt');
    await writeDocument('appointments', appointmentId, { userId, businessId: workflow.businessId, appointmentId, patientName: data.patient_name, phoneNumber: data.phone_number, specialty: data.doctor_specialty, date: data.appointment_date, time: data.appointment_time, reason: data.reason_for_visit || null, status: 'confirmed', calendarEventId, source: calendarEventId ? 'google_calendar' : 'browser_simulation', createdAt: timestamp });
    await writeDocument('customers', data.phone_number || id('customer'), { userId, businessId: workflow.businessId, name: data.patient_name, phone: data.phone_number, updatedAt: timestamp });
    return { actionStatus: 'appointment_created', calendarEventId, reply: calendarEventId ? `Your appointment has been confirmed for ${data.appointment_date} at ${data.appointment_time} with ${data.doctor_specialty}.` : `Your appointment has been saved for ${data.appointment_date} at ${data.appointment_time} with ${data.doctor_specialty}. It is stored in the browser simulation because Google Calendar is not connected yet.` };
  }
  if (workflow.id === 'cake-order' || workflow.id === 'cake-custom') {
    const orderId = id('cake');
    await writeDocument('cakeOrders', orderId, { userId, businessId: workflow.businessId, orderId, ...data, priority: priorityFor(data).toLowerCase(), status: 'new', workflow: workflow.id, createdAt: timestamp });
    await writeDocument('customers', data.phone_number || id('customer'), { userId, businessId: workflow.businessId, name: data.customer_name, phone: data.phone_number, updatedAt: timestamp });
    await writeDocument('followups', id('followup'), { userId, businessId: workflow.businessId, orderId, title: `Follow up on cake order ${orderId}`, status: 'open', priority: priorityFor(data).toLowerCase(), createdAt: timestamp });
    return { actionStatus: 'cake_order_created', reply: `Your cake order has been recorded successfully. Your order ID is ${orderId}.` };
  }
  if (workflow.id === 'clinic-reschedule') return { actionStatus: 'appointment_rescheduled', reply: `Your appointment has been rescheduled to ${data.new_date} at ${data.new_time}.` };
  if (workflow.id === 'clinic-cancel') return { actionStatus: 'appointment_cancelled', reply: 'Your appointment has been cancelled successfully.' };
  return { actionStatus: 'completed', reply: 'Done — I’ve saved the details.' };
}

async function polishReply(workflow, text, response) {
  if (!process.env.OPENAI_API_KEY) return response;
  try {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0.2, messages: [
      { role: 'system', content: `You are ${workflow.assistant} for ${workflow.businessName}. Return JSON with only assistant_reply. Follow this exact workflow state and ask only the current field. Never invent prices, availability, or appointments.` },
      { role: 'user', content: JSON.stringify({ user_message: text, current_field: response.currentFieldKey, missing_fields: response.missingFields, state: response.state, deterministic_reply: response.reply }) },
    ] });
    const parsed = JSON.parse(result.choices[0].message.content || '{}');
    if (parsed.assistant_reply) response.reply = parsed.assistant_reply;
  } catch (error) { console.warn('OpenAI polish skipped:', error.message); }
  return response;
}

app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'voxly-api', storage: firestore ? 'firestore' : 'memory' }));
app.get('/api/workflows', (_request, response) => response.json(Object.values(engine.workflows).map(engine.publicWorkflow)));

app.post('/api/ai/chat', async (request, response) => {
  try {
    const body = request.body || {};
    const callerPhone = callerPhoneFrom(body);
    const workflowId = engine.detectWorkflow(body.message || '', body.workflow_id || 'auto', body.history || []);
    const workflow = engine.workflows[workflowId];
    const initialFields = { ...(body.fields || {}) };
    if (!initialFields.phone_number && callerPhone && isValidPhone(callerPhone) && workflow.fields.some(([key]) => key === 'phone_number')) initialFields.phone_number = callerPhone;
    const data = engine.extractData(body.message || '', initialFields, workflow, body.current_field_key, body.history || []);
    const state = engine.buildState(workflow, data, body.current_field_key);
    const intent = workflow.intent;
    let result;
    if (workflow.fields.length === 0) {
      result = engine.replyFor(workflow, data, state, intent);
    } else if (body.state === 'awaiting_confirmation' && isYes(body.message)) {
      const action = await performAction(workflow, data, body.user_id || 'demo-user');
      result = { ...action, state: 'completed', currentFieldKey: null, completedFields: state.completedFields, missingFields: [], action: 'perform_action', actionStatus: action.actionStatus };
    } else if (body.state === 'awaiting_confirmation' && isNo(body.message)) {
      result = { reply: 'No problem. Tell me which detail you would like to change.', state: 'collecting', currentFieldKey: state.currentFieldKey, completedFields: state.completedFields, missingFields: state.missingFields, action: 'edit_details', actionStatus: 'editing' };
    } else {
      result = engine.replyFor(workflow, data, state, intent);
      result = { ...result, currentFieldKey: state.currentFieldKey, completedFields: state.completedFields, missingFields: state.missingFields };
    }
    const polished = await polishReply(workflow, body.message || '', result);
    const conversationId = body.conversation_id || id('conv');
    const record = { userId: body.user_id || 'demo-user', businessId: workflow.businessId, businessName: workflow.businessName, workflowId: workflow.id, workflowName: workflow.name, intent, currentFieldKey: polished.currentFieldKey || null, collectedData: data, completedFields: polished.completedFields || state.completedFields, missingFields: polished.missingFields || state.missingFields, state: polished.state || 'collecting', actionStatus: polished.actionStatus || 'collecting', priority: priorityFor(data), summary: polished.reply, updatedAt: now(), createdAt: now() };
    if (firestore) {
      const conversation = collectionFor('conversations').doc(conversationId);
      await conversation.set(record, { merge: true });
      await conversation.collection('messages').add({ role: 'user', content: body.message, createdAt: FieldValue.serverTimestamp() });
      await conversation.collection('messages').add({ role: 'assistant', content: polished.reply, createdAt: FieldValue.serverTimestamp() });
    } else {
      const previous = memory.conversations.get(conversationId) || { transcript: [] };
      memory.conversations.set(conversationId, { ...previous, ...record, transcript: [...previous.transcript, { role: 'user', content: body.message, createdAt: now() }, { role: 'assistant', content: polished.reply, createdAt: now() }] });
    }
    response.json({ conversation_id: conversationId, workflow_id: workflow.id, workflow_name: workflow.name, business_name: workflow.businessName, workflow_fields: engine.fieldsFor(workflow), intent, extracted_fields: data, assistant_reply: polished.reply, action_required: polished.action || 'ask_for_field', is_complete: polished.state === 'completed', current_field_key: polished.currentFieldKey || null, completed_fields: polished.completedFields || state.completedFields, missing_fields: polished.missingFields || state.missingFields, state: polished.state || 'collecting', action_status: polished.actionStatus || 'collecting', priority: priorityFor(data) });
  } catch (error) { response.status(500).json({ error: 'Unable to process workflow conversation', detail: error.message }); }
});

// Telephone integration. These endpoints are provider-neutral at the HTTP boundary and
// store the complete call state in voiceCalls so the dashboard and the WSS session share one source of truth.
app.post('/api/voice/incoming', async (request, response) => {
  try {
    const body = request.body || {};
    const callId = callIdFrom(body);
    const providerCallId = providerCallIdFrom(body) || callId;
    const businessId = businessIdFrom(body);
    const callerPhone = callerPhoneFrom(body);
    const businessPhone = normalizePhoneNumber(body.businessPhone || process.env.EXOTEL_VIRTUAL_NUMBER || defaultVoiceSettings.businessPhone);
    const customer = await saveCustomerFromCall({ businessId, callerPhone });
    const settings = settingsFor(businessId);
    await saveVoiceCall(callId, { providerCallId, businessId, customerId: customer?.id || null, callerPhone, businessPhone, assistantName: settings.assistantName, status: 'RINGING', direction: 'INBOUND', workflowId: null, intent: null, currentState: 'RINGING', currentField: null, collectedData: {}, completedFields: [], missingFields: [], transcript: [], summary: '', actionStatus: 'NONE', calendarEventId: null, recordingUrl: null, startedAt: now(), answeredAt: null, endedAt: null, durationSeconds: 0 });
    response.json({ ok: true, callId, providerCallId, assistantName: settings.assistantName, greeting: `Hello! Thank you for calling ${settings.businessId === 'cake' ? 'Sweet Crumbs Cake Shop' : 'Mangalore Smile Clinic'}. I'm ${settings.assistantName}. How can I help you today?`, websocketUrl: process.env.VOICE_WS_URL || (process.env.BACKEND_PUBLIC_URL ? `${process.env.BACKEND_PUBLIC_URL.replace(/^http/, 'ws')}/api/voice/stream/${encodeURIComponent(callId)}` : null), configured: { exotel: exotel.isConfigured(), speechToText: speechToText.isConfigured(), textToSpeech: textToSpeech.isConfigured() } });
  } catch (error) { response.status(500).json({ error: 'Unable to initialize incoming call', detail: error.message }); }
});

app.post('/api/voice/status', async (request, response) => {
  try {
    const body = request.body || {};
    const callId = callIdFrom(body);
    const status = voiceStatus(body.status || body.event || body.call_status || body.CallStatus);
    const current = await readDocument('voiceCalls', callId);
    const patch = { providerCallId: providerCallIdFrom(body) || current?.providerCallId || callId, status, failureReason: body.failureReason || body.reason || body.detailed_status || null };
    if (status === 'ANSWERED') patch.answeredAt = current?.answeredAt || now();
    if (['COMPLETED', 'MISSED', 'FAILED'].includes(status)) { patch.endedAt = now(); patch.durationSeconds = Number(body.duration || body.durationSeconds || current?.durationSeconds || 0); patch.recordingUrl = body.recordingUrl || body.recording_url || body.RecordingUrl || current?.recordingUrl || null; }
    await saveVoiceCall(callId, patch);
    if (status === 'MISSED') await saveMissedCall(callId, { businessId: current?.businessId || businessIdFrom(body), callerPhone: current?.callerPhone || callerPhoneFrom(body), timestamp: now(), providerCallId: patch.providerCallId, reason: patch.failureReason || status, customerId: current?.customerId || null, callbackStatus: 'NOT_REQUESTED', notes: '' });
    response.json({ ok: true, callId, status });
  } catch (error) { response.status(500).json({ error: 'Unable to update call status', detail: error.message }); }
});

app.post('/api/voice/recording', async (request, response) => {
  const body = request.body || {};
  const callId = callIdFrom(body);
  const recordingUrl = body.recordingUrl || body.recording_url || body.RecordingUrl || null;
  if (!recordingUrl) return response.status(400).json({ error: 'recordingUrl is required' });
  await saveVoiceCall(callId, { recordingUrl });
  return response.json({ ok: true, callId, recordingUrl });
});

app.post('/api/voice/callback', async (request, response) => {
  try {
    const body = request.body || {};
    const customerPhone = normalizePhoneNumber(body.customerPhone || body.callerPhone || body.phone);
    if (!isValidPhone(customerPhone)) return response.status(400).json({ error: 'A valid customerPhone is required' });
    const callId = id('callback');
    const streamUrl = process.env.VOICE_WS_URL || (process.env.BACKEND_PUBLIC_URL ? `${process.env.BACKEND_PUBLIC_URL.replace(/^http/, 'ws')}/api/voice/stream/${callId}` : '');
    if (!streamUrl.startsWith('wss://')) return response.status(503).json({ error: 'A public wss:// VOICE_WS_URL is required before starting a real callback' });
    const call = await exotel.startCall({ customerPhone, streamUrl, statusCallback: `${process.env.BACKEND_PUBLIC_URL || ''}/api/voice/status`, record: settingsFor(body.businessId).recordCalls, customField: callId });
    await saveVoiceCall(callId, { providerCallId: call.sid || call.id || null, businessId: businessIdFrom(body), callerPhone: customerPhone, businessPhone: normalizePhoneNumber(process.env.EXOTEL_VIRTUAL_NUMBER), status: 'RINGING', direction: 'OUTBOUND', startedAt: now(), transcript: [], collectedData: {}, completedFields: [], missingFields: [] });
    response.status(201).json({ ok: true, callId, providerCallId: call.sid || call.id || null });
  } catch (error) { response.status(503).json({ error: 'Callback could not be started', detail: error.message }); }
});

app.post('/api/voice/transfer', async (request, response) => {
  const destination = process.env.HANDOFF_PHONE;
  if (!destination) return response.status(409).json({ transferred: false, message: 'Human handoff is not configured. The assistant should collect a callback request instead.' });
  response.json({ transferred: false, message: 'Handoff destination is configured, but live transfer depends on the Exotel flow configured for this account.', destinationConfigured: true });
});

app.get('/api/voice/calls', async (_request, response) => response.json(await listDocuments('voiceCalls')));
app.get('/api/voice/calls/:callId', async (request, response) => { const call = await readDocument('voiceCalls', request.params.callId); return call ? response.json(call) : response.status(404).json({ error: 'Call not found' }); });
app.get('/api/voice/missed-calls', async (_request, response) => response.json(await listDocuments('missedCalls')));
app.get('/api/voice/settings', async (request, response) => response.json({ ...settingsFor(request.query.businessId || 'clinic'), providers: { exotel: exotel.isConfigured(), speechToText: speechToText.isConfigured(), textToSpeech: textToSpeech.isConfigured(), googleCalendar: calendar.isConfigured() } }));
app.put('/api/voice/settings', async (request, response) => { const businessId = businessIdFrom(request.body || {}); const next = { ...settingsFor(businessId), ...(request.body || {}), businessId }; memory.voiceSettings.set(businessId, next); await writeDocument('businesses', businessId, { voiceSettings: next }); response.json(next); });

app.get('/api/calendar/auth-url', (request, response) => { try { response.json({ url: calendar.authorizationUrl(request.query.state || 'voxly-calendar') }); } catch (error) { response.status(503).json({ error: error.message }); } });
app.get('/api/calendar/oauth/callback', async (request, response) => { try { const tokens = await calendar.exchangeCode(request.query.code); if (tokens.refresh_token) { calendar.setRefreshToken(tokens.refresh_token); response.type('html').send(`<h2>Google Calendar connected</h2><p>Copy this value into backend/.env to keep the connection after restart:</p><pre>GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}</pre><p>You can close this window and return to Voxly.</p>`); } else response.type('html').send('<h2>Google Calendar connected for this backend session.</h2><p>No new refresh token was returned. Keep the existing refresh token configured in backend/.env.</p>'); } catch (error) { response.status(500).type('html').send(`<h2>Google Calendar connection failed</h2><pre>${String(error.message).replace(/[<>]/g, '')}</pre>`); } });
app.get('/api/calendar/availability', async (request, response) => { try { if (!calendar.isConfigured()) return response.status(503).json({ error: 'Google Calendar is not configured' }); response.json(await calendar.checkAvailability({ start: request.query.start, end: request.query.end })); } catch (error) { response.status(502).json({ error: 'Calendar availability check failed', detail: error.message }); } });
app.post('/api/calendar/events', async (request, response) => { try { if (!calendar.isConfigured()) return response.status(503).json({ error: 'Google Calendar is not configured' }); response.status(201).json(await calendar.createEvent(request.body)); } catch (error) { response.status(502).json({ error: 'Calendar event creation failed', detail: error.message }); } });
app.put('/api/calendar/events/:eventId', async (request, response) => { try { if (!calendar.isConfigured()) return response.status(503).json({ error: 'Google Calendar is not configured' }); response.json(await calendar.updateEvent(request.params.eventId, request.body)); } catch (error) { response.status(502).json({ error: 'Calendar event update failed', detail: error.message }); } });
app.delete('/api/calendar/events/:eventId', async (request, response) => { try { if (!calendar.isConfigured()) return response.status(503).json({ error: 'Google Calendar is not configured' }); await calendar.cancelEvent(request.params.eventId); response.json({ ok: true }); } catch (error) { response.status(502).json({ error: 'Calendar event cancellation failed', detail: error.message }); } });

app.get('/api/conversations', async (_request, response) => response.json(await listDocuments('conversations')));
app.put('/api/conversations/:conversationId', async (request, response) => { try { const current = await readDocument('conversations', request.params.conversationId); const next = await writeDocument('conversations', request.params.conversationId, { ...(current || {}), ...(request.body || {}), updatedAt: now() }); response.json(next); } catch (error) { response.status(500).json({ error: 'Unable to update conversation', detail: error.message }); } });
app.get('/api/analytics', async (_request, response) => response.json({ total_conversations: 246, conversion_rate: 72.8, avg_response_minutes: 1.8, satisfaction: 4.9, generated_at: now() }));
for (const collection of ['businesses', 'customers', 'followups', 'appointments', 'cakeOrders']) {
  app.get(`/api/${collection}`, async (_request, response) => response.json(await listDocuments(collection)));
  app.post(`/api/${collection}`, async (request, response) => response.status(201).json(await writeDocument(collection, id(collection.slice(0, -1)), { ...request.body, userId: request.body.userId || 'demo-user', createdAt: now() })));
}
app.use((_request, response) => response.status(404).json({ error: 'Route not found' }));

const server = http.createServer(app);
const websocketServer = new WebSocketServer({ noServer: true });

async function processVoiceText(callId, message, socket) {
  const current = await readDocument('voiceCalls', callId);
  if (!current) return;
  const history = (current.transcript || []).map((turn) => ({ from: turn.speaker === 'assistant' ? 'ai' : 'user', text: turn.text }));
  const result = workflowEngine.processMessage({ message, workflowId: current.workflowId || 'auto', fields: current.collectedData || {}, currentFieldKey: current.currentField, state: current.currentState || 'COLLECTING_INFORMATION', history, callerPhone: current.callerPhone });
  const transcript = [...(current.transcript || []), { speaker: 'customer', text: message, timestamp: now() }, { speaker: 'assistant', text: result.response, timestamp: now() }];
  await saveVoiceCall(callId, { workflowId: result.workflowId, intent: result.intent, currentState: result.requiresConfirmation ? 'WAITING_CONFIRMATION' : 'COLLECTING_INFORMATION', currentField: result.currentField, collectedData: result.collectedData, completedFields: result.completedFields, missingFields: result.missingFields, summary: result.response, actionStatus: result.actionStatus || 'COLLECTING', transcript });
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({ event: 'assistant_text', text: result.response, workflowId: result.workflowId, intent: result.intent, currentField: result.currentField, collectedData: result.collectedData, missingFields: result.missingFields }));
    if (textToSpeech.isConfigured()) {
      const activeSession = voiceSessions.get(callId); if (activeSession) activeSession.speaking = true;
      const audio = await textToSpeech.synthesize(result.response);
      for (let offset = 0; offset < audio.length && socket.readyState === 1; offset += 1600) socket.send(JSON.stringify({ event: 'media', media: { payload: audio.subarray(offset, offset + 1600).toString('base64') } }));
      if (activeSession) activeSession.speaking = false;
    } else socket.send(JSON.stringify({ event: 'configuration_warning', component: 'tts', message: 'Set TTS_PROVIDER=elevenlabs, TTS_API_KEY, and TTS_VOICE_ID to send spoken audio back to Exotel.' }));
  }
  return result;
}

websocketServer.on('connection', (socket, request, context) => {
  const callId = context.callId;
  const session = { socket, connectedAt: now(), streamId: null, speaking: false, warnedStt: false };
  session.stt = speechToText.createLiveSession({ onTranscript: (text) => { if (text) void processVoiceText(callId, text, socket); }, onError: (error) => console.error(`[voice:${callId}] STT error`, error.message) });
  voiceSessions.set(callId, session);
  void saveVoiceCall(callId, { currentState: 'ANSWERED', status: 'ANSWERED', answeredAt: now() });
  socket.on('message', (raw) => {
    void (async () => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      const eventName = String(event.event || event.type || '').toLowerCase();
      if (eventName === 'start' || eventName === 'connected') { voiceSessions.get(callId).streamId = event.start?.streamSid || event.streamSid || event.stream_id || null; return; }
      if (eventName === 'stop' || eventName === 'closed' || eventName === 'disconnect') { await saveVoiceCall(callId, { status: 'COMPLETED', currentState: 'ENDED', endedAt: now() }); socket.close(); return; }
      // Provider adapters or test clients can submit finalized transcripts as text events.
      if (eventName === 'transcript' || eventName === 'text' || event.transcript) { await processVoiceText(callId, event.text || event.transcript || event.data?.text || '', socket); return; }
      if (eventName === 'media' || event.media?.payload || event.payload) {
        const activeSession = voiceSessions.get(callId);
        if (activeSession?.speaking && socket.readyState === 1) { socket.send(JSON.stringify({ event: 'clear' })); activeSession.speaking = false; }
        if (activeSession?.stt) activeSession.stt.sendAudio(Buffer.from(event.media?.payload || event.payload, 'base64'));
        else if (!speechToText.isConfigured() && activeSession && !activeSession.warnedStt) { activeSession.warnedStt = true; socket.send(JSON.stringify({ event: 'configuration_warning', component: 'stt', message: 'Set STT_PROVIDER=deepgram and STT_API_KEY to convert caller audio into text.' })); }
      }
    })().catch((error) => { console.error(`[voice:${callId}] stream error`, error.message); if (socket.readyState === 1) socket.send(JSON.stringify({ event: 'error', message: 'Voice session could not process that turn.' })); });
  });
  socket.on('close', () => { const activeSession = voiceSessions.get(callId); activeSession?.stt?.close(); voiceSessions.delete(callId); void saveVoiceCall(callId, { status: 'COMPLETED', currentState: 'ENDED', endedAt: now() }); });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/api\/voice\/stream\/([^/]+)$/);
  if (!match) { socket.destroy(); return; }
  websocketServer.handleUpgrade(request, socket, head, (ws) => websocketServer.emit('connection', ws, request, { callId: decodeURIComponent(match[1]) }));
});

server.listen(PORT, () => console.log(`Voxly API running at http://127.0.0.1:${PORT} (${firestore ? 'Firestore' : 'memory'} storage)`));
