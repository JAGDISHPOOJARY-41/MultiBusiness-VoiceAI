import { useEffect, useMemo, useRef, useState } from 'react';
import * as I from 'lucide-react';

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
type Tab = 'overview' | 'conversations' | 'missed' | 'settings';
type Message = { from: 'ai' | 'user'; text: string };
type ConversationLanguage = 'en-IN' | 'hi-IN';
type Call = {
  id?: string; callId?: string; callerPhone?: string; status?: string;
  workflowName?: string; workflowId?: string; currentState?: string;
  durationSeconds?: number; collectedData?: Record<string, unknown>;
  transcript?: { speaker: string; text: string; timestamp?: string }[];
  recordingUrl?: string | null;
};
type StoredConversation = {
  id: string;
  service?: string;
  source?: string;
  workflowId?: string;
  workflowName?: string;
  state?: string;
  status?: string;
  priority?: string;
  updatedAt?: string;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  collectedData?: Record<string, unknown>;
  transcript?: { speaker?: string; from?: string; text: string; timestamp?: string }[];
};

function normalizeCall(value: any): Call {
  return {
    ...value,
    id: value.id || value.call_id || value.callId,
    callId: value.callId || value.call_id || value.id,
    callerPhone: value.callerPhone || value.caller_phone,
    workflowName: value.workflowName || value.workflow_name,
    workflowId: value.workflowId || value.workflow_id,
    currentState: value.currentState || value.current_state || value.state,
    durationSeconds: value.durationSeconds || value.duration_seconds,
    collectedData: value.collectedData || value.collected_data,
  };
}

function normalizeConversation(value: any): StoredConversation {
  return {
    ...value,
    workflowId: value.workflowId || value.workflow_id,
    workflowName: value.workflowName || value.workflow_name,
    updatedAt: value.updatedAt || value.updated_at,
    startedAt: value.startedAt || value.started_at,
    endedAt: value.endedAt || value.ended_at,
    collectedData: value.collectedData || value.collected_data,
  };
}

function titleCase(value: string) {
  return String(value || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDuration(seconds = 0) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function VoiceAiPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [calls, setCalls] = useState<Call[]>([]);
  const [missed, setMissed] = useState<Call[]>([]);
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [selected, setSelected] = useState<Call | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<StoredConversation | null>(null);
  const [missedCallToStart, setMissedCallToStart] = useState<Call | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [callsResponse, missedResponse, settingsResponse, conversationsResponse] = await Promise.all([
        fetch(`${API}/api/voice/calls`),
        fetch(`${API}/api/voice/missed-calls`),
        fetch(`${API}/api/voice/settings`),
        fetch(`${API}/api/conversations`),
      ]);
      if (!callsResponse.ok || !missedResponse.ok || !settingsResponse.ok || !conversationsResponse.ok) throw new Error('Voice API is not reachable');
      setCalls((await callsResponse.json()).map(normalizeCall));
      setMissed((await missedResponse.json()).map(normalizeCall));
      setSettings(await settingsResponse.json());
      setConversations((await conversationsResponse.json()).map(normalizeConversation).sort((a: StoredConversation, b: StoredConversation) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
    } catch (loadError) {
      setError(loadError instanceof TypeError ? `Cannot connect to the Voice API at ${API}. Start the FastAPI backend on port 8000, then click Refresh.` : loadError instanceof Error ? loadError.message : 'Unable to load Voice AI data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const answered = useMemo(() => calls.filter((call) => ['ANSWERED', 'COMPLETED'].includes(String(call.status))).length, [calls]);
  const active = useMemo(() => calls.filter((call) => ['RINGING', 'ANSWERED', 'IN_PROGRESS'].includes(String(call.status))).length, [calls]);
  const appointments = useMemo(() => calls.filter((call) => call.workflowId === 'clinic-appointment' && call.status === 'COMPLETED').length, [calls]);
  const updateSetting = (key: string, value: unknown) => setSettings((previous: any) => ({ ...previous, [key]: value }));
  const saveSettings = async () => {
    const response = await fetch(`${API}/api/voice/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    if (!response.ok) { setError('Voice settings could not be saved'); return; }
    setSettings(await response.json());
  };
  const connectCalendar = async () => {
    const response = await fetch(`${API}/api/calendar/auth-url`);
    const data = await response.json();
    if (!response.ok) { setError(data.error || 'Google Calendar is not configured'); return; }
    window.open(data.url, '_blank', 'noopener,noreferrer');
  };

  return <>
    <div className="voice-ai-title">
      <div><div className="eyebrow">BROWSER VOICE ASSISTANT</div><h1>Voice AI</h1><p>Talk to your assistant directly from the browser using your microphone. No phone number is required.</p></div>
      <div className="voice-ai-actions"><button className="btn secondary" onClick={() => void load()}><I.RefreshCw size={15}/> Refresh</button></div>
    </div>
    {error && <div className="voice-alert"><I.AlertTriangle size={17}/><span>{error}</span></div>}
    {loading && !settings ? <div className="panel voice-empty">Loading Voice AI data...</div> : <>
      <CallbackControl />
      <BrowserVoiceSimulator assistantName={settings?.assistantName || 'Maya'} missedCall={missedCallToStart} onMissedCallStarted={() => setMissedCallToStart(null)} onConversationSaved={() => void load()} />
      <div className="voice-tabs">{(['overview', 'conversations', 'missed', 'settings'] as Tab[]).map((item) => <button key={item} className={tab === item ? 'selected' : ''} onClick={() => setTab(item)}>{titleCase(item)}</button>)}</div>
      {tab === 'overview' && <Overview settings={settings} calls={calls} active={active} answered={answered} missed={missed.length} appointments={appointments} onSelect={setSelected}/>} 
      {tab === 'conversations' && <ConversationTable conversations={conversations} onSelect={setSelectedConversation}/>} 
      {tab === 'missed' && <CallTable calls={missed} missed onSelect={setSelected} onStartConversation={(call) => { setMissedCallToStart(call); setTab('overview'); }}/>} 
      {tab === 'settings' && <Settings settings={settings} updateSetting={updateSetting} save={saveSettings} connectCalendar={connectCalendar}/>} 
    </>}
    {selected && <CallDetails call={selected} close={() => setSelected(null)}/>} 
    {selectedConversation && <ConversationDetails conversation={selectedConversation} close={() => setSelectedConversation(null)}/>} 
  </>;
}

function CallbackControl() {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void fetch(`${API}/api/callback-settings`).then((response) => response.json()).then(setSettings).catch(() => setError('Callback settings are unavailable')); }, []);
  const update = async (patch: Record<string, unknown>) => {
    const next = { ...settings, ...patch };
    setSettings(next); setSaving(true); setError('');
    try {
      const response = await fetch(`${API}/api/callback-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error('Could not save callback settings');
      setSettings(await response.json());
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save callback settings'); }
    finally { setSaving(false); }
  };
  if (!settings) return null;
  return <section className="panel callback-control"><div><span className="eyebrow">AUTOMATION CONTROL</span><h2>AI Callback System</h2><p>{settings.enabled ? 'Incoming missed calls can enter the callback workflow.' : 'Callback automation is paused. Missed calls will still be logged.'}</p></div><div className="callback-controls"><label className="callback-toggle"><input type="checkbox" checked={Boolean(settings.enabled)} onChange={(event) => void update({ enabled: event.target.checked })}/><span>{settings.enabled ? 'ON' : 'OFF'}</span></label><select value={settings.mode} onChange={(event) => void update({ mode: event.target.value })}><option value="after_hours">After business hours</option><option value="during_hours">During business hours</option><option value="always">Always</option></select><input type="time" value={settings.business_hours_start} onChange={(event) => void update({ business_hours_start: event.target.value })}/><input type="time" value={settings.business_hours_end} onChange={(event) => void update({ business_hours_end: event.target.value })}/></div>{saving && <small>Saving...</small>}{error && <small className="save-error">{error}</small>}</section>;
}

function BrowserVoiceSimulator({ assistantName = 'Maya', missedCall, onMissedCallStarted, onConversationSaved }: { assistantName?: string; missedCall?: Call | null; onMissedCallStarted?: () => void; onConversationSaved?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([{ from: 'ai', text: `Hi! I’m ${assistantName}. How can I help you today?` }]);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [workflowId, setWorkflowId] = useState('auto');
  const [currentFieldKey, setCurrentFieldKey] = useState<string | null>(null);
  const [conversationState, setConversationState] = useState('collecting');
  const [callerPhone, setCallerPhone] = useState('+919876543210');
  const [language, setLanguage] = useState<ConversationLanguage>('en-IN');
  const [liveTranscript, setLiveTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoConversationRef = useRef(false);
  const voiceSessionIdRef = useRef<string | undefined>(undefined);

  const saveVoiceSession = async (payload: Record<string, unknown>) => {
    const sessionId = voiceSessionIdRef.current;
    if (!sessionId) return;
    try {
      await fetch(`${API}/api/voice/sessions/${sessionId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch { /* The workflow response remains usable if persistence is temporarily unavailable. */ }
  };

  const createVoiceSession = async (phone: string, workflow = 'clinic-appointment') => {
    try {
      const response = await fetch(`${API}/api/voice/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caller_phone: phone, workflow_id: workflow, status: 'IN_PROGRESS', state: 'collecting', language, source: 'browser' }) });
      if (response.ok) {
        const data = await response.json();
        voiceSessionIdRef.current = data.id;
      }
    } catch { setNotice('The conversation started, but could not be saved. Check that the backend is running.'); }
  };

  const speakInBrowser = (text: string) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    synthesis.resume();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = 1;
    utterance.volume = 1;
    const voicePattern = language === 'hi-IN' ? /hi-IN|hi/i : /en-IN|en-GB|en-US/i;
    const voice = synthesis.getVoices().find((item) => voicePattern.test(item.lang));
    if (voice) utterance.voice = voice;
    utterance.onerror = () => setNotice('The browser could not play the assistant voice. Check your output device and tab volume.');
    utterance.onend = () => { if (autoConversationRef.current) window.setTimeout(() => startListening(), 350); };
    synthesis.speak(utterance);
    return true;
  };

  const speak = async (text: string) => {
    try {
      const form = new FormData();
      form.append('text', text);
      form.append('language', language);
      const response = await fetch(`${API}/api/voice/synthesize`, { method: 'POST', body: form });
      if (!response.ok) throw new Error('Server-side TTS is not configured. Set TTS_PROVIDER=elevenlabs and TTS_API_KEY in backend/.env.');
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); if (autoConversationRef.current) window.setTimeout(() => startListening(), 350); };
      await audio.play();
    } catch (voiceError) {
      if (!speakInBrowser(text)) setNotice(voiceError instanceof Error ? voiceError.message : 'Unable to play the assistant voice');
    }
  };

  const sendText = async (text: string) => {
    if (!text || busy) return;
    const history = [...messages, { from: 'user' as const, text }];
    setMessages(history);
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(`${API}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ message: text, conversation_id: conversationId, workflow_id: workflowId, fields, current_field_key: currentFieldKey, state: conversationState, caller_phone: callerPhone, language, history }),
      });
      if (!response.ok) throw new Error('AI API request failed');
      const data = await response.json();
      const reply = data.assistant_reply || 'I’m ready. What would you like to arrange?';
      setMessages([...history, { from: 'ai', text: reply }]);
      setConversationId(data.conversation_id);
      setFields(data.extracted_fields || {});
      setWorkflowId(data.workflow_id || 'auto');
      setCurrentFieldKey(data.current_field_key || null);
       setConversationState(data.state || 'collecting');
       setLiveTranscript('');
       await saveVoiceSession({ conversation_id: data.conversation_id, caller_phone: callerPhone, workflow_id: data.workflow_id, workflow_name: data.workflow_name, status: data.is_complete ? 'COMPLETED' : 'IN_PROGRESS', state: data.state, collected_data: data.collected_data, transcript: [...history, { from: 'ai', text: reply }].map((item) => ({ speaker: item.from === 'ai' ? 'assistant' : 'customer', text: item.text })) });
       onConversationSaved?.();
       await speak(reply);
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : 'Unable to reach the AI workflow API');
    } finally {
      setBusy(false);
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('audio', audioBlob, 'voice.webm');
      if (conversationId) form.append('conversation_id', conversationId);
      form.append('workflow_id', workflowId);
      form.append('fields', JSON.stringify(fields));
      form.append('state', conversationState);
      form.append('caller_phone', callerPhone);
      form.append('language', language);
      const response = await fetch(`${API}/api/voice/simulate`, { method: 'POST', body: form });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Server-side speech recognition failed');
      const data = await response.json();
      const transcript = data.transcript || '';
      const reply = data.assistant_reply || 'I am ready. What would you like to arrange?';
      setMessages((previous) => [...previous, { from: 'user', text: transcript }, { from: 'ai', text: reply }]);
      setConversationId(data.conversation_id);
      setFields(data.extracted_fields || {});
      setWorkflowId(data.workflow_id || 'auto');
       setCurrentFieldKey(data.current_field_key || null);
       setConversationState(data.state || 'collecting');
       await saveVoiceSession({ conversation_id: data.conversation_id, caller_phone: callerPhone, workflow_id: data.workflow_id, workflow_name: data.workflow_name, status: data.is_complete ? 'COMPLETED' : 'IN_PROGRESS', state: data.state, collected_data: data.collected_data, transcript: [...messages, { from: 'user', text: transcript }, { from: 'ai', text: reply }].map((item) => ({ speaker: item.from === 'ai' ? 'assistant' : 'customer', text: item.text })) });
       onConversationSaved?.();
       await speak(reply);
    } catch (voiceError) {
      setNotice(voiceError instanceof Error ? voiceError.message : 'Unable to process the recorded voice');
    } finally {
      setBusy(false);
    }
  };

  const startRecorderListening = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setNotice('Audio recording is not supported in this browser.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); void processAudio(new Blob(chunksRef.current, { type: mimeType })); };
      recorder.start();
      setNotice('');
      setListening(true);
    } catch (recordingError) {
      setNotice(recordingError instanceof Error ? recordingError.message : 'Microphone permission is required');
    }
  };

  const startListening = async () => {
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (Recognition) {
      try {
        const recognition = new Recognition();
        recognition.lang = language;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          let interim = '';
          let finalText = '';
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const text = event.results[index][0].transcript;
            if (event.results[index].isFinal) finalText += text;
            else interim += text;
          }
          setLiveTranscript(interim || finalText);
          if (finalText.trim()) void sendText(finalText.trim());
        };
        recognition.onerror = (event: any) => {
          autoConversationRef.current = false;
          setListening(false);
          setNotice(event?.error === 'not-allowed' ? 'Microphone permission was denied. Allow microphone access and try again.' : 'Voice recognition stopped. Please try again.');
        };
        recognition.onend = () => { recognitionRef.current = null; setListening(false); };
        recognitionRef.current = recognition;
        recognition.start();
        setLiveTranscript('Listening…');
        setNotice('');
        setListening(true);
        return;
      } catch { /* Fall through to MediaRecorder/Deepgram. */ }
    }
    await startRecorderListening();
  };

  const startConversation = async (missedConversation?: Call | null) => {
    if (busy || listening) return;

    // Start with a deterministic first question so the assistant collects
    // details one at a time instead of waiting for an unstructured opening.
    const phone = missedConversation?.callerPhone || callerPhone;
    const firstQuestion = missedConversation ? `Hi, I’m ${assistantName}. I’m returning your missed call. May I know your name?` : 'Great, let\'s get started. May I know your name?';
    const openingQuestion = missedConversation ? `Hi! I’m ${assistantName}. I’m returning your missed call. Would you like to book a clinic appointment or order a cake?` : 'Hello! Welcome. I can help you book a clinic appointment or place a cake order. What would you like to do today?';
    autoConversationRef.current = true;
    const localizedOpeningQuestion = language === 'hi-IN'
      ? (missedConversation ? `नमस्ते! मैं ${assistantName} हूँ और आपकी मिस्ड कॉल का जवाब दे रही हूँ। क्या आप क्लिनिक अपॉइंटमेंट बुक करना चाहते हैं या केक ऑर्डर करना चाहते हैं?` : 'नमस्ते! मैं क्लिनिक अपॉइंटमेंट बुक करने या केक ऑर्डर करने में आपकी मदद कर सकती हूँ। आप आज क्या करना चाहते हैं?')
      : openingQuestion;
    setMessages([{ from: 'ai', text: localizedOpeningQuestion }]);
    setConversationId(undefined);
    setCallerPhone(phone || callerPhone);
    voiceSessionIdRef.current = undefined;
    setFields({});
    setWorkflowId('auto');
    setCurrentFieldKey(null);
    setConversationState('collecting');
    setNotice('');
    setLiveTranscript('');
    await createVoiceSession(phone || callerPhone, 'auto');
    await speak(localizedOpeningQuestion);
    onMissedCallStarted?.();
  };
  useEffect(() => { if (missedCall) void startConversation(missedCall); }, [missedCall]);
  const stopListening = () => { autoConversationRef.current = false; recognitionRef.current?.stop(); recognitionRef.current = null; mediaRecorderRef.current?.stop(); mediaRecorderRef.current = null; mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); setListening(false); setLiveTranscript(''); };
  const testVoice = () => { autoConversationRef.current = false; speak(language === 'hi-IN' ? `नमस्ते, मैं ${assistantName} हूँ। आपकी ब्राउज़र आवाज़ सही से काम कर रही है।` : `Hello, I’m ${assistantName}. Your browser voice output is working.`); };
  const reset = () => {
    autoConversationRef.current = false;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.pause();
    recognitionRef.current?.stop();
    setMessages([{ from: 'ai', text: language === 'hi-IN' ? `नमस्ते! मैं ${assistantName} हूँ। मैं आपकी कैसे मदद कर सकती हूँ?` : `Hi! I’m ${assistantName}. How can I help you today?` }]);
    setConversationId(undefined); setFields({}); setWorkflowId('auto'); setCurrentFieldKey(null); setConversationState('collecting'); setNotice(''); setLiveTranscript(''); voiceSessionIdRef.current = undefined;
  };

  return <section className="panel browser-voice-simulator">
    <div className="panel-head"><div><h2>Talk to {assistantName}</h2><p>Use your microphone to test the AI workflow without a phone number.</p></div><span className="live-pill"><i className="live-dot"></i> {busy ? 'Thinking...' : listening ? 'Listening...' : 'Ready'}</span></div>
     <div className="browser-voice-content"><div className="browser-voice-orb"><I.Waves size={28}/></div><div className="browser-voice-actions"><label className="voice-language-select"><span><I.Languages size={14}/> Conversation language</span><select value={language} onChange={(event) => setLanguage(event.target.value as ConversationLanguage)} disabled={listening || busy}><option value="en-IN">English</option><option value="hi-IN">हिन्दी</option></select></label><button className={listening ? 'btn danger' : 'btn call'} onClick={listening ? stopListening : () => void startConversation()} disabled={busy}>{listening ? <><I.Square size={15}/> Stop</> : <><I.PhoneCall size={15}/> Call</>}</button><button className="btn secondary" onClick={testVoice} disabled={busy}><I.Volume2 size={15}/> Test voice</button><button className="btn secondary" onClick={reset}>Reset</button></div></div><label className="browser-voice-phone">Pre-captured caller phone<input value={callerPhone} onChange={(event) => setCallerPhone(event.target.value)} placeholder="+91 98765 43210"/></label>
    {notice && <div className="voice-alert"><I.AlertTriangle size={16}/><span>{notice}</span></div>}
     <div className="browser-voice-transcript"><div className="voice-transcript-label">LIVE VOICE-TO-TEXT TRANSCRIPT</div>{messages.slice(-6).map((message, index) => <div className={`browser-voice-message ${message.from}`} key={`${message.from}-${index}`}><b>{message.from === 'ai' ? assistantName : 'You'}</b><span>{message.text}</span></div>)}{liveTranscript && <div className="browser-voice-message user live"><b>You</b><span>{liveTranscript}</span></div>}</div>
    <small className="voice-note"><I.Volume2 size={14}/> Replies use your browser's built-in voice output.</small>
  </section>;
}

function Overview({ settings, calls, active, answered, missed, appointments, onSelect }: any) {
  return <><div className="voice-number-card panel"><div className="voice-number-icon"><I.Mic size={22}/></div><div><span className="eyebrow">VOICE AI STATUS</span><h2><i className="live-dot"/> {settings?.enabled ? 'Active' : 'Disabled'}</h2><p>Browser microphone · Assistant <b>{settings?.assistantName || 'Maya'}</b></p></div><div className="voice-config-status"><span className="configured"><i/> Browser voice ready</span><span className="configured"><i/> Workflow API connected</span></div></div><div className="voice-stats">{[['Conversations', calls.length, ''], ['Answered', answered, ''], ['Active', active, ''], ['Missed records', missed, ''], ['Appointments', appointments, '']].map((stat) => <div className="panel voice-stat" key={stat[0]}><span>{stat[0]}</span><b>{stat[1]}</b></div>)}</div><div className="voice-columns"><section className="panel"><div className="panel-head"><div><h2>Live sessions</h2><p>Browser and telephone records</p></div></div>{calls.filter((call: Call) => ['RINGING', 'ANSWERED', 'IN_PROGRESS'].includes(String(call.status))).slice(0, 5).map((call: Call) => <CallRow key={call.id || call.callId} call={call} onClick={() => onSelect(call)}/>)}{!calls.some((call: Call) => ['RINGING', 'ANSWERED', 'IN_PROGRESS'].includes(String(call.status))) && <div className="voice-empty-small">No active sessions.</div>}</section><section className="panel"><div className="panel-head"><div><h2>Recent records</h2><p>Saved by the backend</p></div></div>{calls.slice(0, 5).map((call: Call) => <CallRow key={call.id || call.callId} call={call} onClick={() => onSelect(call)}/>)}{!calls.length && <div className="voice-empty-small">No records yet.</div>}</section></div></>;
}

function CallRow({ call, onClick }: { call: Call; onClick: () => void }) {
  return <button className="voice-call-row" onClick={onClick}><span className="avatar purple">AI</span><span className="voice-call-main"><b>{call.callerPhone || 'Browser voice session'}</b><small>{call.workflowName || titleCase(call.workflowId || 'Unknown workflow')} · {call.currentState ? titleCase(call.currentState) : '—'}</small></span><span className={`voice-status ${String(call.status || '').toLowerCase()}`}>{titleCase(call.status || 'Unknown')}</span><span className="voice-duration">{formatDuration(call.durationSeconds)}</span><I.ChevronRight size={15}/></button>;
}

function ConversationTable({ conversations, onSelect }: { conversations: StoredConversation[]; onSelect: (conversation: StoredConversation) => void }) {
  return <div className="panel voice-table conversation-history-panel"><div className="panel-head"><div><h2>Conversation history</h2><p>Every voice conversation is saved progressively with its transcript and collected data.</p></div><span className="live-pill">{conversations.length} saved</span></div>{conversations.map((conversation) => <button className="stored-conversation-row" key={conversation.id} onClick={() => onSelect(conversation)}><span className="conversation-service-icon"><I.Stethoscope size={16}/></span><span className="voice-call-main"><b>{conversation.workflowName || titleCase(conversation.service || 'Voice conversation')}</b><small>{conversation.summary || 'Conversation in progress'} · {conversation.transcript?.length || 0} messages</small></span><span className={`voice-status ${String(conversation.state || '').toLowerCase()}`}>{titleCase(conversation.state || 'collecting')}</span><I.ChevronRight size={15}/></button>)}{!conversations.length && <div className="voice-empty">No saved conversations yet.</div>}</div>;
}

function ConversationDetails({ conversation, close }: { conversation: StoredConversation; close: () => void }) {
  return <div className="voice-detail-backdrop" onClick={close}><aside className="voice-detail panel" onClick={(event) => event.stopPropagation()}><button className="icon-btn voice-close" onClick={close}><I.X size={18}/></button><div className="eyebrow">SAVED CONVERSATION</div><h2>{conversation.workflowName || titleCase(conversation.service || 'Voice conversation')}</h2><p>{titleCase(conversation.state || 'collecting')} · {conversation.source || 'voice'} · {conversation.priority || 'NORMAL'}</p><div className="voice-detail-fields">{Object.entries(conversation.collectedData || {}).map(([key, value]) => <div key={key}><span>{titleCase(key)}</span><b>{String(value || '—')}</b></div>)}</div><h3>Transcript</h3><div className="voice-transcript">{(conversation.transcript || []).map((turn, index) => <div key={`${turn.timestamp || ''}-${index}`} className={(turn.speaker || turn.from) === 'assistant' || turn.from === 'ai' ? 'assistant' : 'customer'}><b>{(turn.speaker || turn.from) === 'assistant' || turn.from === 'ai' ? 'AI' : 'Customer'}</b><span>{turn.text}</span></div>)}{!conversation.transcript?.length && <span>No transcript saved.</span>}</div></aside></div>;
}

function CallTable({ calls, missed = false, onSelect, onStartConversation }: { calls: Call[]; missed?: boolean; onSelect: (call: Call) => void; onStartConversation?: (call: Call) => void }) {
  return <div className="panel voice-table"><div className="panel-head"><div><h2>{missed ? 'Missed records' : 'Conversation history'}</h2><p>{missed ? 'Missed telephone calls saved by the backend.' : 'Saved voice conversation records.'}</p></div></div>{calls.map((call) => <div className="voice-record-with-action" key={call.id || call.callId}><CallRow call={call} onClick={() => onSelect(call)}/>{missed && <button className="btn secondary missed-start" onClick={() => onStartConversation?.(call)}><I.PhoneCall size={14}/> Start conversation</button>}</div>)}{!calls.length && <div className="voice-empty">No records yet.</div>}</div>;
}

function CallDetails({ call, close }: { call: Call; close: () => void }) {
  return <div className="voice-detail-backdrop" onClick={close}><aside className="voice-detail panel" onClick={(event) => event.stopPropagation()}><button className="icon-btn voice-close" onClick={close}><I.X size={18}/></button><div className="eyebrow">SESSION DETAILS</div><h2>{call.callerPhone || 'Browser voice session'}</h2><p>{titleCase(call.status || 'unknown')} · {formatDuration(call.durationSeconds)} · {call.workflowName || titleCase(call.workflowId || 'Unknown workflow')}</p><div className="voice-detail-fields">{Object.entries(call.collectedData || {}).map(([key, value]) => <div key={key}><span>{titleCase(key)}</span><b>{String(value || '—')}</b></div>)}</div><h3>Transcript</h3><div className="voice-transcript">{(call.transcript || []).map((turn, index) => <div key={`${turn.timestamp || ''}-${index}`} className={turn.speaker === 'assistant' ? 'assistant' : 'customer'}><b>{turn.speaker === 'assistant' ? 'AI' : 'Customer'}</b><span>{turn.text}</span></div>)}{!call.transcript?.length && <span>No transcript saved.</span>}</div>{call.recordingUrl && <a href={call.recordingUrl} target="_blank" rel="noreferrer">Open recording</a>}</aside></div>;
}

function Settings({ settings, updateSetting, save, connectCalendar }: any) {
  if (!settings) return <div className="panel voice-empty">Voice settings unavailable.</div>;
  return <div className="panel voice-settings"><div className="panel-head"><div><h2>Voice AI settings</h2><p>Configure the browser assistant. No telephone provider is required.</p></div><button className="btn" onClick={() => void save()}><I.Save size={15}/> Save settings</button></div><div className="form-grid"><label>Assistant name<input value={settings.assistantName || ''} onChange={(event) => updateSetting('assistantName', event.target.value)}/></label><label>Language<input value={settings.language || 'en-IN'} onChange={(event) => updateSetting('language', event.target.value)}/></label><label>Timezone<input value={settings.timezone || ''} onChange={(event) => updateSetting('timezone', event.target.value)}/></label><label className="toggle-label"><input type="checkbox" checked={Boolean(settings.enabled)} onChange={(event) => updateSetting('enabled', event.target.checked)}/> Voice AI enabled</label></div><div className="voice-setup-checklist"><b>Browser readiness</b><span className="configured">Microphone: provided by your browser</span><span className="configured">Voice output: provided by your browser</span><span className="configured">Workflow API: connected through the backend</span><button className="btn secondary" onClick={() => void connectCalendar()}><I.CalendarDays size={15}/> Connect Google Calendar</button></div></div>;
}
