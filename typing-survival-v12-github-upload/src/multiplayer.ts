import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, onValue, runTransaction, set, update, remove, onDisconnect, push, query, limitToLast, serverTimestamp } from 'firebase/database';
import { firebaseConfig } from './firebase-config';

export const ROOM_IDS = Array.from({ length: 10 }, (_, i) => `room${String(i + 1).padStart(2, '0')}`);
export const multiplayerConfigured = !firebaseConfig.apiKey.startsWith('YOUR_') && !firebaseConfig.databaseURL.includes('YOUR_');
export type Member = { nickname: string; score: number; finished: boolean; joinedAt: number };
export type Room = { members?: Record<string, Member>; match?: { id: string; startedAt: number; status: 'playing' | 'finished' } };
export type ChatItem = { uid: string; nickname: string; text: string; at?: number };
let db: ReturnType<typeof getDatabase> | null = null;
let myUid = '';

export async function connectMultiplayer() {
  if (!multiplayerConfigured) throw new Error('src/firebase-config.ts에 Firebase 설정값을 먼저 입력해 주세요.');
  if (db && myUid) return myUid;
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  myUid = user.uid;
  db = getDatabase(app);
  return myUid;
}
function database() { if (!db) throw new Error('멀티 서버 연결 전입니다.'); return db; }
export function getUid() { return myUid; }
export function watchRooms(callback: (rooms: Record<string, Room>) => void) {
  return onValue(ref(database(), 'rooms'), s => callback((s.val() || {}) as Record<string, Room>));
}
export function watchRoom(roomId: string, callback: (room: Room | null) => void) {
  return onValue(ref(database(), `rooms/${roomId}`), s => callback(s.val() as Room | null));
}
export function watchChat(roomId: string, callback: (rows: ChatItem[]) => void) {
  return onValue(query(ref(database(), `chats/${roomId}`), limitToLast(60)), s => {
    const data = s.val() || {};
    callback(Object.values(data) as ChatItem[]);
  });
}
export async function joinRoom(roomId: string, nickname: string) {
  if (!ROOM_IDS.includes(roomId)) throw new Error('없는 방입니다.');
  const uid = await connectMultiplayer();
  const r = ref(database(), `rooms/${roomId}`);
  const outcome = await runTransaction(r, (current: Room | null) => {
    const room: Room = current || {};
    const members = { ...(room.members || {}) };
    if (!members[uid] && Object.keys(members).length >= 2) return;
    if (room.match?.status === 'playing' && !members[uid] && Object.keys(members).length >= 2) return;
    const oldCount = Object.keys(members).length;
    members[uid] = members[uid] || { nickname: nickname.trim(), score: 0, finished: false, joinedAt: Date.now() };
    members[uid].nickname = nickname.trim();
    room.members = members;
    if (room.match?.status === 'finished' || (room.match?.status === 'playing' && oldCount < 2 && !current?.members?.[uid])) delete room.match;
    return room;
  }, { applyLocally: false });
  if (!outcome.committed) throw new Error('방이 가득 찼거나 이미 경기가 진행 중입니다.');
  await onDisconnect(ref(database(), `rooms/${roomId}/members/${uid}`)).remove();
  return uid;
}
export async function leaveRoom(roomId: string) {
  if (!db || !myUid) return;
  await onDisconnect(ref(database(), `rooms/${roomId}/members/${myUid}`)).cancel();
  await remove(ref(database(), `rooms/${roomId}/members/${myUid}`));
}
export async function beginMatch(roomId: string) {
  const r = ref(database(), `rooms/${roomId}`);
  const outcome = await runTransaction(r, (current: Room | null) => {
    if (!current || Object.keys(current.members || {}).length !== 2) return;
    if (current.match?.status === 'playing' && !Object.values(current.members || {}).every(m => m.finished)) return;
    const members: Record<string, Member> = {};
    for (const [uid, m] of Object.entries(current.members || {})) members[uid] = { ...m, score: 0, finished: false };
    return { ...current, members, match: { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, startedAt: Date.now(), status: 'playing' as const } };
  }, { applyLocally: false });
  if (!outcome.committed) throw new Error('두 명이 입장해야 시작할 수 있습니다.');
}
export async function publishScore(roomId: string, score: number, finished = false) {
  if (!db || !myUid) return;
  await update(ref(database(), `rooms/${roomId}/members/${myUid}`), { score: Math.max(0, Math.floor(score)), ...(finished ? { finished: true } : {}) });
}
export async function sendChat(roomId: string, nickname: string, message: string) {
  const text = message.trim().slice(0, 150);
  if (!text) return;
  await set(push(ref(database(), `chats/${roomId}`)), { uid: myUid, nickname, text, at: serverTimestamp() });
}
