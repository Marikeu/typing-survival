import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, onValue, runTransaction, set, update, remove, onDisconnect, push, query, limitToLast, serverTimestamp } from 'firebase/database';
import { firebaseConfig } from './firebase-config';

export const ROOM_IDS = Array.from({ length: 10 }, (_, i) => `room${String(i + 1).padStart(2, '0')}`);
export const multiplayerConfigured = !firebaseConfig.apiKey.startsWith('YOUR_') && !firebaseConfig.databaseURL.includes('YOUR_');
export type MultiplayerDifficulty = 'easy' | 'normal' | 'hard';
export type Member = { nickname: string; score: number; finished: boolean; joinedAt: number };
export type Room = { members?: Record<string, Member>; difficulty?: MultiplayerDifficulty; match?: { id: string; startedAt: number; difficulty?: MultiplayerDifficulty; status: 'playing' | 'finished'; endedAt?: number; reason?: 'opponent_left'; winnerUid?: string } };
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
  return onValue(ref(database(), `rooms/${roomId}`), s => {
    const room = s.val() as Room | null;
    callback(room);
    if (room?.match?.status === 'playing' && Object.keys(room.members || {}).length === 2 && Object.values(room.members || {}).every(m => m.finished)) {
      void settleFinishedMatch(roomId).catch(error => console.warn('대결 완료 정리:', error));
    }
    // onDisconnect는 한 명의 접속자만 제거할 수 있으므로 남은 학생이 경기 상태를 정리합니다.
    if (room?.match?.status === 'playing' && room.members?.[myUid] && Object.keys(room.members).length === 1) {
      void settleDisconnectedMatch(roomId).catch(error => console.warn('경기 정리 지연:', error));
    }
  });
}
export function watchChat(roomId: string, callback: (rows: ChatItem[]) => void) {
  return onValue(query(ref(database(), `chats/${roomId}`), limitToLast(60)), s => {
    const data = s.val() || {};
    callback(Object.values(data) as ChatItem[]);
  });
}
// 양측 종료 후에도 playing 상태가 남지 않도록 트랜잭션으로 마무리합니다.
export async function settleFinishedMatch(roomId: string) {
  if (!db || !ROOM_IDS.includes(roomId)) return;
  await runTransaction(ref(database(), `rooms/${roomId}`), (room: Room | null) => {
    if (!room || room.match?.status !== 'playing') return;
    const players = Object.values(room.members || {});
    if (players.length !== 2 || !players.every(p => p.finished)) return;
    return { ...room, match: { ...room.match, status: 'finished' as const, endedAt: Date.now() } };
  }, { applyLocally: false });
}

export async function changeRoomDifficulty(roomId: string, difficulty: MultiplayerDifficulty) {
  if (!ROOM_IDS.includes(roomId) || !['easy','normal','hard'].includes(difficulty)) throw new Error('잘못된 난이도입니다.');
  const outcome = await runTransaction(ref(database(), `rooms/${roomId}`), (room: Room | null) => {
    if (!room || !room.members?.[myUid] || room.match?.status === 'playing') return;
    return { ...room, difficulty };
  }, { applyLocally: false });
  if (!outcome.committed) throw new Error('경기 진행 중에는 난이도를 변경할 수 없습니다.');
}

// 이전 경기 중 브라우저가 닫혀 한 명만 남으면 기권 종료 처리합니다.
// Firebase 트랜잭션으로 경기 시작 및 재입장과의 경합을 방지합니다.
export async function settleDisconnectedMatch(roomId: string) {
  if (!db || !myUid || !ROOM_IDS.includes(roomId)) return;
  await runTransaction(ref(database(), `rooms/${roomId}`), (current: Room | null) => {
    if (!current || current.match?.status !== 'playing') return;
    const members = current.members || {};
    const ids = Object.keys(members);
    if (ids.length !== 1 || ids[0] !== myUid) return;
    return {
      ...current,
      match: { ...current.match, status: 'finished' as const, endedAt: Date.now(), reason: 'opponent_left' as const, winnerUid: myUid }
    };
  }, { applyLocally: false });
}

// 방 참여자만 대화 기록을 삭제할 수 있습니다. Firebase 규칙에서 chats/$room 삭제를 허용해야 합니다.
export async function clearRoomChat(roomId: string) {
  if (!db || !myUid || !ROOM_IDS.includes(roomId)) throw new Error('방에 입장한 뒤 채팅을 초기화할 수 있습니다.');
  await remove(ref(database(), `chats/${roomId}`));
}

export async function joinRoom(roomId: string, nickname: string) {
  if (!ROOM_IDS.includes(roomId)) throw new Error('없는 방입니다.');
  const uid = await connectMultiplayer();
  const r = ref(database(), `rooms/${roomId}`);
  let enteredEmptyRoom = false;
  const outcome = await runTransaction(r, (current: Room | null) => {
    const room: Room = current ? { ...current } : {};
    const members = { ...(room.members || {}) };
    const count = Object.keys(members).length;
    enteredEmptyRoom = count === 0;
    // 경기 진행 중에는 새 사람이 들어와 기존 대결을 덮어쓰지 못하도록 합니다.
    if (room.match?.status === 'playing' && count > 0 && !members[uid]) return;
    if (!members[uid] && count >= 2) return;
    // 모두 나간 방이나 끝난 경기는 다음 대결을 위해 초기화합니다.
    if (!count) { delete room.match; room.difficulty = 'normal'; }
    // 종료된 경기 결과는 재대결을 시작할 때까지 유지합니다.
    members[uid] = members[uid] || { nickname: nickname.trim(), score: 0, finished: false, joinedAt: Date.now() };
    members[uid] = { ...members[uid], nickname: nickname.trim() };
    room.members = members;
    return room;
  }, { applyLocally: false });
  if (!outcome.committed) throw new Error('방이 가득 찼거나 경기가 진행 중입니다.');
  await onDisconnect(ref(database(), `rooms/${roomId}/members/${uid}`)).remove();
  // 기존 인원이 모두 끊기고 채팅만 남았다면 새 이용자의 첫 입장에서 초기화합니다.
  if (enteredEmptyRoom) {
    try { await clearRoomChat(roomId); } catch (error) { console.warn('지난 채팅 삭제 실패: Firebase 규칙을 확인하세요.', error); }
  }
  return uid;
}

export async function leaveRoom(roomId: string) {
  if (!db || !myUid || !ROOM_IDS.includes(roomId)) return;
  const uid = myUid;
  // 퇴장할 때 채팅도 초기화해 이전 대결의 기록이 남지 않게 합니다.
  // Firebase 규칙 오류가 있더라도 퇴장 자체는 진행합니다.
  try { await clearRoomChat(roomId); } catch (error) { console.warn('채팅 초기화 실패:', error); }
  await runTransaction(ref(database(), `rooms/${roomId}`), (current: Room | null) => {
    if (!current || !current.members?.[uid]) return;
    const members = { ...current.members };
    delete members[uid];
    const remaining = Object.keys(members);
    // 마지막 이용자가 나가면 방 전체(경기 상태 포함)를 삭제합니다.
    if (!remaining.length) return null;
    const next: Room = { ...current, members };
    if (current.match?.status === 'playing') {
      next.match = { ...current.match, status: 'finished', reason: 'opponent_left', winnerUid: remaining[0], endedAt: Date.now() };
    } else if (current.match?.status === 'finished') {
      delete next.match;
    }
    return next;
  }, { applyLocally: false });
  // DB에서 탈퇴가 확정된 뒤에만 자동 연결 종료 처리를 취소합니다.
  await onDisconnect(ref(database(), `rooms/${roomId}/members/${uid}`)).cancel();
}

export async function beginMatch(roomId: string) {
  const r = ref(database(), `rooms/${roomId}`);
  const outcome = await runTransaction(r, (current: Room | null) => {
    if (!current || Object.keys(current.members || {}).length !== 2) return;
    if (current.match?.status === 'playing') return;
    const members: Record<string, Member> = {};
    for (const [uid, m] of Object.entries(current.members || {})) members[uid] = { ...m, score: 0, finished: false };
    return { ...current, members, match: { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, startedAt: Date.now(), difficulty: current.difficulty || 'normal', status: 'playing' as const } };
  }, { applyLocally: false });
  if (!outcome.committed) throw new Error('두 명이 입장하고 이전 경기가 끝나야 시작할 수 있습니다.');
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
