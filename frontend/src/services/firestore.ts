import { addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db, ensureFirebaseUser } from '../config/firebase';

type ConversationInput = {
  workflowId: string;
  transcript: { from: 'ai' | 'user'; text: string }[];
  extractedFields?: Record<string, unknown>;
  priority?: 'URGENT' | 'NORMAL';
  status?: string;
};

async function userScope() {
  const user = await ensureFirebaseUser();
  if (!db || !user) return null;
  return { user, database: db };
}

export async function saveConversation(input: ConversationInput) {
  const scope = await userScope();
  if (!scope) return null;
  const ref = await addDoc(collection(scope.database, 'conversations'), {
    userId: scope.user.uid,
    businessId: 'mangalore-smile-clinic',
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateConversation(conversationId: string, input: Record<string, unknown>) {
  const scope = await userScope();
  if (!scope) return null;
  await setDoc(doc(scope.database, 'conversations', conversationId), { userId: scope.user.uid, ...input, updatedAt: serverTimestamp() }, { merge: true });
  return conversationId;
}

export async function listConversations() {
  const scope = await userScope();
  if (!scope) return [];
  const snapshot = await getDocs(query(collection(scope.database, 'conversations'), where('userId', '==', scope.user.uid), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

export async function saveBusiness(input: { name: string; type: string; phone?: string; language?: string }) {
  const scope = await userScope();
  if (!scope) return null;
  const ref = await addDoc(collection(scope.database, 'businesses'), { userId: scope.user.uid, ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}

export async function saveCustomer(input: { name: string; phone: string; email?: string }) {
  const scope = await userScope();
  if (!scope) return null;
  const ref = await addDoc(collection(scope.database, 'customers'), { userId: scope.user.uid, ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}

export async function saveFollowup(input: { title: string; dueAt: string; priority: 'URGENT' | 'NORMAL'; conversationId?: string }) {
  const scope = await userScope();
  if (!scope) return null;
  const ref = await addDoc(collection(scope.database, 'followups'), { userId: scope.user.uid, ...input, status: 'open', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}
