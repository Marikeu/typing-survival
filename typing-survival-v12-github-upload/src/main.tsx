import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import {EffectSystem} from './effects';
import { ROOM_IDS, multiplayerConfigured, connectMultiplayer, getUid, watchRooms, watchRoom, watchChat, joinRoom, leaveRoom, beginMatch, publishScore, sendChat, type Room, type ChatItem } from './multiplayer';
import { BOSS_WORDS, pickGameWord, splitBossPhrase } from './words';
import {fetchRanking,fetchPlayerRank,receiptExists,submitScore,onlineReady, type OnlineRank, type PlayerRank} from './online';

type Enemy = { id:number; x:number; y:number; word:string; speed:number; kind:number; boss?:boolean; phases?:string[]; phaseIndex?:number; maxPhases?:number; projectile?:boolean; supply?:boolean; ttl?:number; frozenUntil?:number };
type Difficulty = 'easy'|'normal'|'hard';
type DifficultyConfig={label:string;spawn:number;minSpawn:number;speed:number;boss:number;bossGap:number;rush:number;rushGap:number;rushSize:number;shot:number;shotGap:number;supply:number;spawnRamp:number;speedRamp:number;bossSpeed:number};
const DIFFICULTIES:Record<Difficulty,DifficultyConfig> = {
  easy:{label:'쉬움',spawn:4.1,minSpawn:2.3,speed:.56,boss:110,bossGap:130,rush:48,rushGap:78,rushSize:4,shot:38,shotGap:38,supply:28,spawnRamp:220,speedRamp:.50,bossSpeed:.65},
  normal:{label:'보통',spawn:2.4,minSpawn:.8,speed:1,boss:45,bossGap:65,rush:24,rushGap:48,rushSize:6,shot:17,shotGap:24,supply:35,spawnRamp:120,speedRamp:1,bossSpeed:1},
  hard:{label:'어려움',spawn:1.05,minSpawn:.28,speed:1.85,boss:23,bossGap:37,rush:13,rushGap:24,rushSize:10,shot:10,shotGap:12,supply:52,spawnRamp:65,speedRamp:1.7,bossSpeed:1.65}
};
type Loot = { id:string; name:string; word:string; description:string };
type GameState = { enemies:Enemy[];score:number;hp:number;maxHp:number;seconds:number;hits:number;kills:number;combo:number;bestCombo:number;mistakes:number;nextId:number;spawnClock:number;ended:boolean; level:number;xp:number;xpNeeded:number;loot:Loot[]|null;nextBossAt:number;bossCount:number;power:number;shield:number;slow:number;scoreBoost:number; bossKills:number; rushAt:number;supplyAt:number;shotsAt:number;projectilesStopped:number;supplyCollected:number;rushCount:number; upgrades:Record<string,number>; powerClocks:Record<string,number>; typedKills:number; rerolls:number; };
type Result = { nickname:string;score:number;seconds:number;accuracy:number;kills:number;level?:number;bossKills?:number;difficulty?:string;projectilesStopped?:number;supplyCollected?:number };

const LOOT_POOL:Loot[] = [
  {id:'drone',name:'수호자 드론',word:'드론',description:'일정 간격마다 가까운 일반 몬스터를 자동 처치'},
  {id:'blast',name:'폭발 사격',word:'폭발',description:'타자 처치 때 주변 적도 함께 공격'},
  {id:'slow',name:'감속장',word:'서리',description:'몬스터의 이동 속도를 지속적으로 감소'},
  {id:'heal',name:'의료 팩',word:'치유',description:'체력을 즉시 2 회복'},
  {id:'wall',name:'강화 성벽',word:'성벽',description:'최대 체력 +1 및 체력 +1'},
  {id:'score',name:'점수 증폭',word:'보너스',description:'직접 타자 공격 점수 +20%'},
  {id:'blades',name:'회전 칼날',word:'칼날',description:'가까운 적을 주기적으로 제거'},
  {id:'mines',name:'지뢰 설치',word:'지뢰',description:'일정 간격마다 플레이어 주변 폭발'},
  {id:'chain',name:'연쇄 광선',word:'광선',description:'타자 처치 시 근처 적에게 연쇄 공격'},
  {id:'comboGuard',name:'콤보 보호막',word:'집중',description:'오타 시 콤보 유지 기회 획득'},
  {id:'leech',name:'흡수',word:'흡수',description:'일정 수의 직접 처치마다 체력 회복'},
  {id:'growth',name:'성장 촉진',word:'성장',description:'직접 처치 경험치 추가 획득'},
  {id:'freeze',name:'냉동탄',word:'냉동',description:'타자 처치 후 주변 적 잠시 얼림'},
  {id:'lightning',name:'번개 폭풍',word:'번개',description:'일정 시간마다 일반 적을 연속 제거'},
  {id:'pierce',name:'관통 사격',word:'관통',description:'타자 처치 방향의 뒤쪽 적도 제거'},
  {id:'boomerang',name:'부메랑',word:'회전',description:'주기적으로 가까운 적을 제거'},
  {id:'regen',name:'재생',word:'회복',description:'시간이 지날수록 체력 자동 회복'},
  {id:'luck',name:'행운',word:'행운',description:'보급 상자가 더 자주 등장하고 카드 재추첨 가능'}
];
// v11.2: 모든 적 좌표, 이동 속도, 충돌 및 공격 거리는 1920×1080 기준.
// 기존 960×540 게임의 시간적 난이도를 유지하기 위해 이동/거리만 2배 환산.
// 캐릭터·몬스터·글씨는 2배로 키우지 않고 상대적으로 더 작게 표시.
const W=1920,H=1080,CX=W/2,CY=H/2;
const WORLD_SCALE=2;
const SUDDEN_DEATH_AT=20*60;
const MAX_ACTIVE_ENEMIES=220;
// 20분 이후에는 시간이 지날수록 적 밀도·속도·러시가 가파르게 증가합니다.
const suddenDeathPower=(seconds:number)=>seconds<SUDDEN_DEATH_AT?0:Math.min(1,(seconds-SUDDEN_DEATH_AT)/90);
const PATCH_NOTES=[
  'v12: 1:1 멀티플레이 · 10개 방 · 실시간 채팅 · 상대 점수 · 5분 승부',
  '몬스터·보스 단어 글씨 확대',
  '일반 몬스터 단어 최대 4글자 · 보스 어절 길이 제한 해제',
  '오답은 Enter/Space 제출 시 입력창 자동 삭제',
  '점수 저장하고 그만두기 버튼 추가',
  '20분부터 서든 데스: 적 속도·등장·러시 폭증',
  '정답을 입력하고 Enter 또는 Space를 누르면 네모 탄환 1개 발사',
  '오답 제출 시 입력창 전체 즉시 삭제 · Backspace 없이 재입력 가능',
  '정답 탄환이 단어에 도착한 순간 적 처치 · 탄환 속도 1.5배'
];
const fresh=():GameState=>({enemies:[],score:0,hp:5,maxHp:5,seconds:0,hits:0,kills:0,combo:0,bestCombo:0,mistakes:0,nextId:1,spawnClock:0,ended:false,level:1,xp:0,xpNeeded:3,loot:null,nextBossAt:45,bossCount:0,power:0,shield:0,slow:0,scoreBoost:1,bossKills:0,rushAt:24,supplyAt:35,shotsAt:17,projectilesStopped:0,supplyCollected:0,rushCount:0,upgrades:{},powerClocks:{},typedKills:0,rerolls:0});
const loadScores=():Result[]=>{try{const v=JSON.parse(localStorage.getItem('typing-survival-local-scores')||'[]');return Array.isArray(v)?v:[]}catch{return []}};
const rand=(a:number,b:number)=>a+Math.random()*(b-a);
const edgePosition=()=>{const e=Math.floor(Math.random()*4);return e===0?{x:rand(0,W),y:-28*WORLD_SCALE}:e===1?{x:W+28*WORLD_SCALE,y:rand(0,H)}:e===2?{x:rand(0,W),y:H+28*WORLD_SCALE}:{x:-28*WORLD_SCALE,y:rand(0,H)}};
// 18장 중 중복 없이 3장씩 제시하고, 6회 선택 이후 새 덱으로 섞습니다.
const shuffledLoot=()=>{
  const list=[...LOOT_POOL];
  for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]]}
  return list;
};

function App(){
  const [screen,setScreen]=useState<'start'|'game'|'over'|'ranking'|'lootbook'|'lobby'|'room'|'multiResult'>('start');
  const [nickname,setNickname]=useState('');
  const [rooms,setRooms]=useState<Record<string,Room>>({});
  const [roomId,setRoomId]=useState('');
  const [currentRoom,setCurrentRoom]=useState<Room|null>(null);
  const [chat,setChat]=useState<ChatItem[]>([]);
  const [chatDraft,setChatDraft]=useState('');
  const [multiError,setMultiError]=useState('');
  const [multiResult,setMultiResult]=useState('');
  const [opponentScore,setOpponentScore]=useState(0);
  const modeRef=useRef<'single'|'multi'>('single');
  const roomIdRef=useRef('');
  const matchIdRef=useRef('');
  const matchedRef=useRef('');
  const publishedAtRef=useRef(0);
  const multiStartAtRef=useRef(0);

  const [difficulty,setDifficulty]=useState<Difficulty>('normal');
  const [draft,setDraft]=useState('');
  const [mistyped,setMistyped]=useState(false);
  const [stats,setStats]=useState<GameState>(fresh());
  const [feedback,setFeedback]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const [scores,setScores]=useState<Result[]>(loadScores);
  const [schoolRank,setSchoolRank]=useState<OnlineRank[]>([]);
  const [onlineStatus,setOnlineStatus]=useState('');
  const [rankStatus,setRankStatus]=useState('');
  const [playerRank,setPlayerRank]=useState<PlayerRank|null>(null);
  const [rankRefresh,setRankRefresh]=useState(0);
  const [rankSearch,setRankSearch]=useState('');
  const [rankOrigin,setRankOrigin]=useState<'start'|'over'>('start');
  const world=useRef<GameState>(fresh());
  const lootDeck=useRef<Loot[]>([]);
  const inputRef=useRef<HTMLInputElement>(null);
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const lastRef=useRef(0);
  const finalRef=useRef(false);
  const composingRef=useRef(false);
  const typingResetVersionRef=useRef(0);
  const targetRef=useRef<number|null>(null);
  const draftRef=useRef('');
  const firedDraftRef=useRef('');
  const mistakeActiveRef=useRef(false);
  const noticeRef=useRef<number|undefined>(undefined);
  const playIdRef=useRef('');
  const fx=useRef(new EffectSystem());

  const lootOptions=()=>{
    if(lootDeck.current.length<3)lootDeck.current=shuffledLoot();
    return lootDeck.current.splice(0,3);
  };
  const update=()=>setStats({...world.current,enemies:[...world.current.enemies]});
  const clearTyping=()=>{
    // React 상태뿐 아니라 실제 입력 요소도 즉시 비워, 다음 한글 입력에 이전 글자가 남지 않게 합니다.
    typingResetVersionRef.current++;
    if(inputRef.current)inputRef.current.value='';
    targetRef.current=null;
    draftRef.current='';
    firedDraftRef.current='';
    mistakeActiveRef.current=false;
    setMistyped(false);
    setDraft('');
  };
  const registerTypo=()=>{
    if(mistakeActiveRef.current)return;
    mistakeActiveRef.current=true;setMistyped(true);
    const g=world.current;g.mistakes++;
    if(g.upgrades.comboGuard&&g.powerClocks.comboGuard!==-1){
      g.powerClocks.comboGuard=-1;fx.current.shieldHit(CX,CY);fx.current.text(CX,CY-25,'COMBO SAVE!','#7b8db6');
      message('오타! 콤보 보호 · Backspace로 수정하세요.');
    }else{g.combo=0;g.powerClocks.comboGuard=0;message('오타! Backspace로 수정하세요.')}
    update();
  };
  const clearTypoState=()=>{mistakeActiveRef.current=false;setMistyped(false)};
  const quitAndSave=()=>{
    if(finalRef.current||world.current.ended)return;
    if(!window.confirm('지금까지의 점수를 저장하고 게임을 종료할까요?')){inputRef.current?.focus();return}
    world.current.ended=true;
    message('점수를 저장하고 게임을 종료합니다.');
    update();
  };
  const message=(s:string)=>{setFeedback(s);window.clearTimeout(noticeRef.current);noticeRef.current=window.setTimeout(()=>setFeedback(''),1100)};
  const nicknameValid=/^[가-힣A-Za-z0-9_]{2,16}$/.test(nickname.trim());
  const openLobby=async()=>{
    if(!nicknameValid){setMultiError('닉네임을 먼저 2~16글자로 입력해 주세요.');return;}
    try {setMultiError('연결 중...');await connectMultiplayer();setMultiError('');setScreen('lobby');}
    catch(error){setMultiError(String(error instanceof Error?error.message:error));}
  };
  useEffect(()=>{
    if(screen!=='lobby')return;
    if(!multiplayerConfigured)return;
    const off=watchRooms(setRooms);
    return ()=>off();
  },[screen]);
  useEffect(()=>{
    if(!roomId)return;
    let off1=()=>{},off2=()=>{};
    try {off1=watchRoom(roomId,setCurrentRoom);off2=watchChat(roomId,setChat)}
    catch(error){setMultiError(String(error))}
    return()=>{off1();off2()};
  },[roomId]);
  const enterRoom=async(id:string)=>{
    try{setMultiError('입장 중...');await joinRoom(id,nickname.trim());roomIdRef.current=id;setRoomId(id);setScreen('room');setMultiError('')}
    catch(error){setMultiError(String(error instanceof Error?error.message:error))}
  };
  const exitRoom=async()=>{
    if(modeRef.current==='multi'&&screen==='game')return;
    try{if(roomIdRef.current)await leaveRoom(roomIdRef.current)}
    catch(error){setMultiError(String(error))}
    roomIdRef.current='';setRoomId('');setCurrentRoom(null);setChat([]);matchIdRef.current='';matchedRef.current='';modeRef.current='single';setScreen('lobby');
  };
  const postChat=async()=>{
    if(!chatDraft.trim()||!roomIdRef.current)return;
    try{await sendChat(roomIdRef.current,nickname.trim(),chatDraft);setChatDraft('')}
    catch(error){setMultiError(String(error))}
  };
  const members=Object.entries(currentRoom?.members||{});
  const opponent=members.find(([id])=>id!==getUid())?.[1];
  // Realtime Database 방에서 경기 시작을 공유합니다. 같은 경기 ID로 두 번 시작하지 않습니다.
  useEffect(()=>{
    if(!roomId || !currentRoom)return;
    const match=currentRoom.match;
    const myMembership=!!currentRoom.members?.[getUid()];
    if(!myMembership && (screen==='room'||screen==='game')){
      setMultiError('방에서 연결이 끊겼습니다.');return;
    }
    setOpponentScore(opponent?.score||0);
    if(match?.status==='playing' && myMembership && match.id!==matchedRef.current && screen==='room'){
      matchedRef.current=match.id;matchIdRef.current=match.id;multiStartAtRef.current=match.startedAt;
      publishedAtRef.current=0;setMultiResult('');start('multi');
    }
  },[roomId,currentRoom,screen]);
  // 1초마다 자신의 점수를 상대방에게 전송합니다.
  useEffect(()=>{
    if(screen!=='game'||modeRef.current!=='multi')return;
    const timer=window.setInterval(()=>{
      if(world.current.ended||!roomIdRef.current)return;
      publishScore(roomIdRef.current,world.current.score).catch(()=>{});
    },1000);
    return()=>window.clearInterval(timer);
  },[screen]);
  const start=(mode:'single'|'multi'='single')=>{
    if(!/^[가-힣A-Za-z0-9_]{2,16}$/.test(nickname.trim())){setOnlineStatus('닉네임은 한글·영문·숫자·_ 2~16자로 입력하세요.');return;}
    modeRef.current=mode;
    if(mode==='multi')setDifficulty('normal');
    playIdRef.current=(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `play-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;setOnlineStatus('');lootDeck.current=shuffledLoot();fx.current.clear();
    world.current=fresh();world.current.nextBossAt=mode==='multi'?25:DIFFICULTIES[difficulty].boss;world.current.rushAt=DIFFICULTIES[mode==='multi'?'normal':difficulty].rush;world.current.shotsAt=DIFFICULTIES[mode==='multi'?'normal':difficulty].shot;world.current.supplyAt=DIFFICULTIES[mode==='multi'?'normal':difficulty].supply;lastRef.current=0;finalRef.current=false;composingRef.current=false;
    clearTyping();setFeedback('');setResult(null);setStats({...world.current});setScreen('game');
    window.setTimeout(()=>inputRef.current?.focus(),30);
  };
  useEffect(()=>{if(screen==='game')inputRef.current?.focus()},[screen]);
  useEffect(()=>{
    if(screen==='game')return;
    if(!onlineReady){setRankStatus('연결 대기: .env에 Apps Script 주소를 등록해 주세요.');return;}
    let active=true;
    setRankStatus('학교 전체 랭킹 불러오는 중...');
    const timer=window.setTimeout(()=>{
      fetchRanking(difficulty).then(rows=>{if(active){setSchoolRank(rows);setRankStatus('')}}).catch(err=>{if(active)setRankStatus(String(err.message||err))});
      if(/^[가-힣A-Za-z0-9_]{2,16}$/.test(nickname.trim())) {
        fetchPlayerRank(difficulty,nickname.trim()).then(r=>{if(active)setPlayerRank(r)}).catch(()=>{if(active)setPlayerRank(null)});
      }else setPlayerRank(null);
    },300);
    return()=>{active=false;window.clearTimeout(timer)};
  },[screen,difficulty,rankRefresh,nickname]);

  useEffect(()=>()=>window.clearTimeout(noticeRef.current),[]);

  const chooseLoot=(item:Loot)=>{
    const g=world.current;
    if(!g.loot || !g.loot.some(x=>x.id===item.id))return;
    const n=(g.upgrades[item.id]||0)+1;
    g.upgrades[item.id]=n;
    if(item.id==='heal'){const amount=Math.min(2,g.maxHp-g.hp);g.hp+=amount;fx.current.burst(CX,CY,78,'#65977b');fx.current.text(CX,CY-24,`HP +${amount}`);}
    else if(item.id==='wall'){g.maxHp++;g.hp=Math.min(g.maxHp,g.hp+1);fx.current.burst(CX,CY,65,'#c29c55');fx.current.text(CX,CY-24,'MAX HP +1','#c29c55')}
    else if(item.id==='score'){g.scoreBoost=Math.round((g.scoreBoost+.2)*100)/100;fx.current.sparkles(CX,CY,12,'#c29c55');fx.current.text(CX,CY-32,`SCORE x${g.scoreBoost.toFixed(1)}`,'#c29c55')}
    else if(item.id==='slow'){g.slow=Math.min(.6,g.slow+.12);fx.current.burst(CX,CY,145*WORLD_SCALE,'#668da7');fx.current.text(CX,CY-24,'SLOW FIELD','#668da7')}
    else if(item.id==='comboGuard'){fx.current.ring(CX,CY,55,'#7b8db6');fx.current.text(CX,CY-20,'COMBO GUARD','#7b8db6')} // 콤보 보호 효과는 오타 발생 시 적용
    else if(item.id==='luck'){g.supplyAt=Math.min(g.supplyAt,g.seconds+15);g.rerolls+=2;fx.current.sparkles(CX,CY,14,'#d2b25f');fx.current.text(CX,CY-18,'LUCK UP','#b18d3e')}
    else {fx.current.powerUp(CX,CY,item.id)}
    g.loot=null;clearTyping();update();message(`${item.name} 획득! Lv.${n}`);
    window.setTimeout(()=>inputRef.current?.focus(),0);
  };
  const rerollLoot=()=>{
    const g=world.current;
    if(!g.loot||g.rerolls<1)return;
    g.rerolls--;g.loot=lootOptions();clearTyping();update();
    window.setTimeout(()=>inputRef.current?.focus(),0);
  };
  const passiveRemove=(enemies:Enemy[])=>{
    // 자동 공격은 타수, 경험치, 점수에 포함하지 않음: 학교 타자 랭킹 보호
    const g=world.current;
    const candidates=enemies.filter(e=>!e.boss&&!e.supply&&!e.projectile);
    for(const e of candidates){
      g.enemies=g.enemies.filter(x=>x.id!==e.id);
      if(targetRef.current===e.id)clearTyping();
    }
    return candidates;
  };
  const gainXp=()=>{
    const g=world.current;g.xp++;
    if(g.xp>=g.xpNeeded){g.xp=0;g.level++;g.xpNeeded=Math.min(12,3+Math.floor(g.level/2));g.loot=lootOptions();clearTyping();update()}
  };
  const processInput=(raw:string,composing=false,submit=false)=>{
    const g=world.current;if(g.ended)return;
    const value=raw.replace(/\s/g,'');draftRef.current=value;setDraft(value);
    // 한글 IME 조합 중간에는 오타를 판정하지 않습니다.
    if(composing)return;
    if(!value){firedDraftRef.current='';clearTypoState();targetRef.current=null;return}
    if(Array.from(value).length<Array.from(firedDraftRef.current).length){firedDraftRef.current=value}
    if(g.loot){
      const option=g.loot.find(o=>o.word===value);
      if(option){chooseLoot(option);return}
      if(g.loot.some(o=>o.word.startsWith(value))){clearTypoState();return}
      if(submit){registerTypo();clearTyping();message('잘못된 전리품 단어입니다. 다시 입력하세요.')}
      else setMistyped(true);
      return;
    }
    let enemy=g.enemies.find(e=>e.id===targetRef.current&&!fx.current.hasTypedShotFor(e.id));
    if(!enemy){
      // 보스의 현재 단어가 일치하면 우선 선택, 그 외에는 가까운 적을 선택
      const candidates=g.enemies.filter(e=>e.word.startsWith(value)&&!fx.current.hasTypedShotFor(e.id));
      candidates.sort((a,b)=>Number(!!b.boss)-Number(!!a.boss)||Math.hypot(a.x-CX,a.y-CY)-Math.hypot(b.x-CX,b.y-CY));
      enemy=candidates[0];if(enemy)targetRef.current=enemy.id;
    }
    if(!enemy||!enemy.word.startsWith(value)){
      // 오답은 제출할 때만 확정 판정하고 입력창을 비웁니다.
      if(submit){registerTypo();clearTyping();message('오답! 입력 내용이 지워졌습니다.')}
      else setMistyped(true);
      return;
    }
    clearTypoState();
    // 타이핑만으로는 공격하지 않습니다. 정답 제출(Enter/Space) 시에만 한 발 발사합니다.
    if(!submit)return;
    if(value!==enemy.word){
      registerTypo();clearTyping();message('오답! 입력 내용이 지워졌습니다.');return;
    }
    // 정답 제출 시 네모 탄환은 딱 한 발만 발사합니다.
    // 이전과 달리 몬스터는 즉시 사라지지 않고 탄환이 단어에 명중한 순간 처리합니다.
    if(fx.current.hasTypedShotFor(enemy.id)){
      clearTyping();return;
    }
    fx.current.typedProjectile(CX,CY-6,enemy.x,enemy.y-(enemy.boss?72:53),'',0,!!enemy.boss,enemy.id);
    clearTyping();
    update();
  };
  // 직접 타자 공격의 점수·콤보·전리품 효과는 탄환 충돌 후에 적용합니다.
  const resolveTypedHit=(enemyId:number)=>{
    const g=world.current;
    if(g.ended)return;
    const enemy=g.enemies.find(e=>e.id===enemyId);
    if(!enemy)return; // 비행 중 다른 능력으로 적이 사라진 경우
    g.hits++;g.combo++;g.bestCombo=Math.max(g.bestCombo,g.combo);
    g.score+=Math.round((Array.from(enemy.word).length*10+Math.min(g.combo,20)*5+g.power)*g.scoreBoost);
    if(enemy.boss&&enemy.phases&&((enemy.phaseIndex??0)+1)<enemy.phases.length){
      enemy.phaseIndex=(enemy.phaseIndex??0)+1;enemy.word=enemy.phases[enemy.phaseIndex];
      message(`보스 공격 성공! ${enemy.phaseIndex}/${enemy.maxPhases}`);update();return;
    }
    g.enemies=g.enemies.filter(e=>e.id!==enemy!.id);g.kills++;
    if(!enemy.boss&&!enemy.projectile&&!enemy.supply){
      g.typedKills++;
      const level=(id:string)=>g.upgrades[id]||0;
      const others=g.enemies.filter(e=>!e.boss&&!e.projectile&&!e.supply);
      if(level('blast')){const targets=others.filter(e=>Math.hypot(e.x-enemy!.x,e.y-enemy!.y)<(70+20*level('blast'))*WORLD_SCALE).slice(0,level('blast'));fx.current.burst(enemy.x,enemy.y,(70+20*level('blast'))*WORLD_SCALE);targets.forEach(t=>fx.current.burst(t.x,t.y,26));passiveRemove(targets);}
      if(level('chain')){const targets=[...others].filter(e=>g.enemies.some(a=>a.id===e.id)).sort((a,b)=>Math.hypot(a.x-enemy!.x,a.y-enemy!.y)-Math.hypot(b.x-enemy!.x,b.y-enemy!.y)).slice(0,level('chain'));fx.current.chain([{x:enemy.x,y:enemy.y},...targets.map(t=>({x:t.x,y:t.y}))]);passiveRemove(targets);}
      if(level('pierce')){
        const vx=enemy.x-CX,vy=enemy.y-CY,len=Math.hypot(vx,vy)||1;
        const pierced=others.filter(e=>{const dx=e.x-enemy!.x,dy=e.y-enemy!.y;const along=(dx*vx+dy*vy)/len;const across=Math.abs(dx*vy-dy*vx)/len;return along>0&&along<190*WORLD_SCALE&&across<(22+level('pierce')*6)*WORLD_SCALE}).slice(0,level('pierce'));fx.current.beam([{x:CX,y:CY},{x:enemy.x+vx/len*205*WORLD_SCALE,y:enemy.y+vy/len*205*WORLD_SCALE}],'#c2a87c');pierced.forEach(e=>fx.current.slash(e.x,e.y,Math.atan2(vy,vx)));passiveRemove(pierced);
      }
      if(level('freeze'))others.sort((a,b)=>Math.hypot(a.x-enemy!.x,a.y-enemy!.y)-Math.hypot(b.x-enemy!.x,b.y-enemy!.y)).slice(0,level('freeze')*2).forEach(e=>{e.frozenUntil=g.seconds+3;fx.current.freeze(e.x,e.y)});
      if(level('leech')&&g.typedKills%Math.max(3,9-2*level('leech'))===0&&g.hp<g.maxHp){g.hp++;fx.current.chain([{x:enemy.x,y:enemy.y},{x:CX,y:CY}],'#65977b');fx.current.text(CX,CY-20,'HP +1');}
    }
    if(enemy.projectile){g.projectilesStopped++;fx.current.burst(enemy.x,enemy.y,32,'#668da7');message('투사체 요격!');}
    if(enemy.supply){g.supplyCollected++;g.hp=Math.min(g.maxHp,g.hp+1);g.score+=100;fx.current.sparkles(enemy.x,enemy.y,12,'#c29c55');fx.current.text(CX,CY-30,'HP +1','#65977b');message('보급 상자 획득! 체력 +1, 점수 +100');}
    if(enemy.boss){g.bossKills++;g.score+=Math.round(300*g.scoreBoost);fx.current.burst(enemy.x,enemy.y,140,'#c07266');fx.current.sparkles(enemy.x,enemy.y,16,'#c29c55');message('보스 처치! +300점')}
    else if(!enemy.projectile&&!enemy.supply) message(g.combo>=5?`${g.combo} COMBO!`:'처치 성공!');
    if(!enemy.projectile&&!enemy.supply){gainXp();if(g.upgrades.growth&&g.typedKills%Math.max(2,5-g.upgrades.growth)===0){gainXp();fx.current.sparkles(CX,CY,7,'#977eb0');fx.current.text(CX,CY-20,'EXP +1','#977eb0')}}update();
  };

  const inputChange=(e:React.ChangeEvent<HTMLInputElement>)=>processInput(e.target.value,composingRef.current||(e.nativeEvent as InputEvent).isComposing);
  const submitInput=()=>{
    if(composingRef.current || world.current.ended)return;
    // 제출 순간의 입력값을 기준으로 정답 여부를 판정합니다.
    const raw=(inputRef.current?.value ?? draftRef.current).trim();
    if(!raw){clearTyping();return;}
    processInput(raw,false,true);
  };

  useEffect(()=>{
    if(screen!=='game')return;
    let raf=0;
    const frame=(now:number)=>{
      const g=world.current;
      if(!lastRef.current)lastRef.current=now;
      const dt=Math.min((now-lastRef.current)/1000,.05);lastRef.current=now;
      if(!g.ended&&!g.loot){
        const previousSeconds=g.seconds;
        g.seconds+=dt;g.spawnClock+=dt;
        if(modeRef.current==='multi' && multiStartAtRef.current){
          g.seconds=Math.max(g.seconds,(Date.now()-multiStartAtRef.current)/1000);
          if(g.seconds>=300){g.seconds=300;g.ended=true;g.loot=null;}
        }
        const surge=suddenDeathPower(g.seconds);
        if(previousSeconds<SUDDEN_DEATH_AT&&g.seconds>=SUDDEN_DEATH_AT){
          g.rushAt=Math.min(g.rushAt,g.seconds+2);
          g.shotsAt=Math.min(g.shotsAt,g.seconds+1);
          fx.current.burst(CX,CY,440,'#b64e49');
          message('⚠ 20분 경과! 서든 데스 시작!');
        }
        const tickPower=(id:string,period:number,fn:()=>void)=>{
          if(!g.upgrades[id])return;
          g.powerClocks[id]=(g.powerClocks[id]||0)+dt;
          if(g.powerClocks[id]>=period){g.powerClocks[id]=0;fn()}
        };
        const nearest=(n:number,condition:(e:Enemy)=>boolean=()=>true)=>[...g.enemies].filter(e=>!e.boss&&!e.projectile&&!e.supply&&condition(e)).sort((a,b)=>Math.hypot(a.x-CX,a.y-CY)-Math.hypot(b.x-CX,b.y-CY)).slice(0,n);
        tickPower('drone',Math.max(2.5,8-g.upgrades.drone),()=>{const targets=nearest(g.upgrades.drone);targets.forEach(e=>{fx.current.beam([{x:CX+100,y:CY-65},{x:e.x,y:e.y}],'#baaa71');fx.current.burst(e.x,e.y,20,'#baaa71')});passiveRemove(targets)});
        tickPower('blades',Math.max(1.5,4.5-g.upgrades.blades*.6),()=>{const targets=nearest(g.upgrades.blades,e=>Math.hypot(e.x-CX,e.y-CY)<115*WORLD_SCALE);targets.forEach(e=>fx.current.slash(e.x,e.y,Math.atan2(e.y-CY,e.x-CX)));passiveRemove(targets)});
        tickPower('mines',Math.max(5,12-g.upgrades.mines),()=>{const targets=nearest(g.upgrades.mines*3,e=>Math.hypot(e.x-CX,e.y-CY)<170*WORLD_SCALE);fx.current.burst(CX,CY,170*WORLD_SCALE,'#ad7565');targets.forEach(e=>fx.current.burst(e.x,e.y,28,'#ad7565'));passiveRemove(targets)});
        tickPower('lightning',Math.max(4,14-g.upgrades.lightning*1.5),()=>{const targets=nearest(g.upgrades.lightning*2);targets.forEach(e=>fx.current.chain([{x:e.x-27,y:-20},{x:e.x+10,y:e.y-33},{x:e.x,y:e.y}],'#87a8d3'));passiveRemove(targets)});
        tickPower('boomerang',Math.max(2,7-g.upgrades.boomerang),()=>passiveRemove(nearest(g.upgrades.boomer,e=>Math.hypot(e.x-CX,e.y-CY)<205*WORLD_SCALE)));
        tickPower('regen',Math.max(8,26-g.upgrades.regen*3),()=>{if(g.hp<g.maxHp){g.hp++;fx.current.burst(CX,CY,62,'#65977b');fx.current.text(CX,CY-24,'REGEN +1')}});

        const difficultyConfig=DIFFICULTIES[modeRef.current==='multi'?'normal':difficulty];
        const baseInterval=Math.max(difficultyConfig.minSpawn,difficultyConfig.spawn-g.seconds/difficultyConfig.spawnRamp);
        const interval=surge>0?Math.max(.09,baseInterval/(4+surge*8)):baseInterval;
        if(g.spawnClock>=interval){
          g.spawnClock=0;
          const amount=surge>0?Math.floor(2+surge*5):1;
          for(let i=0;i<amount&&g.enemies.length<MAX_ACTIVE_ENEMIES;i++){
            const pos=edgePosition();
            g.enemies.push({...pos,id:g.nextId++,word:pickGameWord(),speed:(25+Math.min(55,g.seconds/8)*difficultyConfig.speedRamp)*difficultyConfig.speed*WORLD_SCALE*(surge>0?2.8+surge*5:1),kind:Math.floor(Math.random()*3)});
          }
        }
        if(g.seconds>=g.rushAt){
          const side=Math.floor(Math.random()*4);
          for(let i=0,n=Math.min(65,difficultyConfig.rushSize+(surge>0?Math.floor(18+surge*35):0));i<n&&g.enemies.length<MAX_ACTIVE_ENEMIES;i++){
            const f=(i+.5)/n;
            const pos=side===0?{x:W*f,y:-20*WORLD_SCALE}:side===1?{x:W+20*WORLD_SCALE,y:H*f}:side===2?{x:W*f,y:H+20*WORLD_SCALE}:{x:-20*WORLD_SCALE,y:H*f};
            g.enemies.push({...pos,id:g.nextId++,word:pickGameWord(),speed:(30+g.seconds/12)*difficultyConfig.speed*WORLD_SCALE*(surge>0?2.8+surge*5:1),kind:i%3});
          }
          g.rushCount++;g.rushAt+=surge>0?Math.max(3,9-surge*6):difficultyConfig.rushGap;message(surge>0?'⚠ 서든 데스 몬스터 폭주!':'⚠ 몬스터 무리 등장!');
        }
        if(g.seconds>=g.supplyAt){
          const pos=edgePosition();g.enemies.push({...pos,id:g.nextId++,word:'보급',speed:15*WORLD_SCALE,kind:1,supply:true});
          g.supplyAt+=Math.max(25,55-(g.upgrades.luck||0)*8);message('📦 보급 상자 등장!');
        }
        if(g.seconds>=g.shotsAt){
          const pos=edgePosition();g.enemies.push({...pos,id:g.nextId++,word:'막아',speed:85*difficultyConfig.speed*WORLD_SCALE*(surge>0?2.8+surge*5:1),kind:0,projectile:true});
          g.shotsAt+=surge>0?Math.max(1.5,4-surge*2.5):Math.max(6,difficultyConfig.shotGap-g.seconds/(difficulty==='hard'?150:450));message('⚠ 적 투사체! 막아를 입력하세요.');
        }
        if(g.seconds>=g.nextBossAt){
          const pos=edgePosition();const text=BOSS_WORDS[g.bossCount%BOSS_WORDS.length];const phases=splitBossPhrase(text);
          g.enemies.push({...pos,id:g.nextId++,word:phases[0],speed:(17+g.bossCount*2)*difficultyConfig.bossSpeed*WORLD_SCALE*(surge>0?2.8+surge*5:1),kind:3,boss:true,phases,phaseIndex:0,maxPhases:phases.length});
          g.bossCount++;g.nextBossAt+=modeRef.current==='multi'?36:(surge>0?Math.max(8,15-surge*7):difficultyConfig.bossGap);message('⚠ 보스 등장! 여러 단어를 순서대로 입력하세요.');
        }
        g.enemies=g.enemies.filter(e=>{
          const dx=CX-e.x,dy=CY-e.y,dist=Math.hypot(dx,dy);
          if(dist<26*WORLD_SCALE){
            if(g.shield>0){g.shield--;fx.current.shieldHit(CX,CY);message('보호막이 공격을 막았습니다!')}
            else{g.hp-=e.boss?2:1;g.combo=0;fx.current.burst(CX,CY,45,'#b76a68')}
            if(targetRef.current===e.id)clearTyping();
            if(g.hp<=0){g.hp=0;g.ended=true}return false;
          }
          if(dist>.1){const slow=(e.frozenUntil&&e.frozenUntil>g.seconds)?0:1-g.slow;e.x+=dx/dist*e.speed*slow*dt;e.y+=dy/dist*e.speed*slow*dt}return true;
        });
        // 매 프레임 움직이는 단어의 위치를 추적하여 실제 탄환 충돌을 판정합니다.
        // 자동 공격으로 제거된 적을 향한 탄환은 안전하게 사라집니다.
        const hitIds=fx.current.advanceTypedProjectiles(dt,g.enemies);
        for(const enemyId of hitIds){
          if(g.ended)break;
          resolveTypedHit(enemyId);
        }
        update();
      }
      if(modeRef.current==='multi' && !g.ended && multiStartAtRef.current && Date.now()-multiStartAtRef.current>=300000){g.seconds=300;g.ended=true;g.loot=null;}
      const canvas=canvasRef.current;
      if(canvas){const ctx=canvas.getContext('2d');if(ctx){
        ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);ctx.clearRect(0,0,W,H);ctx.fillStyle='#e9e6df';ctx.fillRect(0,0,W,H);
        ctx.strokeStyle='#d6d2c8';ctx.lineWidth=1;for(const r of [105*WORLD_SCALE,230*WORLD_SCALE]){ctx.beginPath();ctx.arc(CX,CY,r,0,Math.PI*2);ctx.stroke()}
        fx.current.underlay(ctx,now,CX,CY,g.upgrades.slow||0,g.upgrades.blades||0,g.upgrades,g.seconds,g.enemies);
        ctx.strokeStyle='#3f3d3a';ctx.lineWidth=3;ctx.beginPath();ctx.arc(CX,CY,19,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle='#3f3d3a';ctx.font='bold 26px sans-serif';ctx.textAlign='center';ctx.fillText('C',CX,CY+9);
        ctx.font='20px sans-serif';ctx.fillStyle='#8b8880';ctx.fillText(`${g.hp} / ${g.maxHp}${g.shield?' 🛡'+g.shield:''}`,CX,CY+49);
        for(const e of g.enemies){
          const selected=e.id===targetRef.current;
          if(selected){ctx.strokeStyle='#a04a4a';ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(e.x,e.y,e.boss?45:22,0,Math.PI*2);ctx.stroke()}
          ctx.fillStyle=selected?'#a04a4a':'#8b8880';ctx.font=e.boss?'bold 40px sans-serif':'bold 34px sans-serif';ctx.fillText(e.word,e.x,e.y-(e.boss?59:40));
          if(selected&&draftRef.current){ctx.font='bold 22px sans-serif';ctx.fillText('⌨ '+draftRef.current,e.x,e.y-(e.boss?96:72))}
          if(e.frozenUntil&&e.frozenUntil>g.seconds){fx.current.frostOverlay(ctx,e.x,e.y,now);ctx.strokeStyle='#62a6b6';ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,20,0,Math.PI*2);ctx.stroke()}
          ctx.fillStyle=e.supply?'#92764f':e.projectile?'#4d7094':e.boss?'#923e3e':'#a04a4a';ctx.beginPath();
          if(e.boss){ctx.lineWidth=4;ctx.strokeStyle='#923e3e';ctx.arc(e.x,e.y,34,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#923e3e';ctx.font='bold 20px sans-serif';ctx.fillText('BOSS',e.x,e.y+7);ctx.font='16px sans-serif';ctx.fillText(`${(e.phaseIndex??0)+1}/${e.maxPhases}`,e.x,e.y+57)}
          else if(e.supply){ctx.fillRect(e.x-14,e.y-14,28,28);ctx.fillStyle='#f5eee1';ctx.font='bold 23px sans-serif';ctx.fillText('+',e.x,e.y+8)}
          else if(e.projectile){ctx.arc(e.x,e.y,12,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#4d7094';ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,19,0,Math.PI*2);ctx.stroke()}
          else if(e.kind===0){ctx.arc(e.x,e.y,10,0,Math.PI*2);ctx.fill()}
          else if(e.kind===1){ctx.moveTo(e.x,e.y-13);ctx.lineTo(e.x-13,e.y+11);ctx.lineTo(e.x+13,e.y+11);ctx.closePath();ctx.fill()}
          else{ctx.moveTo(e.x,e.y-14);ctx.lineTo(e.x+14,e.y);ctx.lineTo(e.x,e.y+14);ctx.lineTo(e.x-14,e.y);ctx.closePath();ctx.fill()}
        }
        fx.current.overlay(ctx,now);
      }}
      if(g.ended&&!finalRef.current){
        finalRef.current=true;
        const r:Result={nickname:nickname.trim(),score:g.score,seconds:Math.floor(g.seconds),accuracy:g.hits+g.mistakes?Math.round(g.hits/(g.hits+g.mistakes)*100):100,kills:g.kills,level:g.level,bossKills:g.bossKills,difficulty:DIFFICULTIES[difficulty].label,projectilesStopped:g.projectilesStopped,supplyCollected:g.supplyCollected};
        if(modeRef.current==='multi'){
          void publishScore(roomIdRef.current,g.score,true).catch(()=>{});
          setResult(r);setMultiResult('경기 종료 · 상대의 최종 점수를 확인하세요.');setScreen('multiResult');
          return;
        }
        const next=[...loadScores(),r];localStorage.setItem('typing-survival-local-scores',JSON.stringify(next));setScores(next);setResult(r);setScreen('over');
        if(onlineReady){
          setOnlineStatus('온라인 기록 전송 중...');
          const sentPlayId=playIdRef.current;
          submitScore({nickname:r.nickname,difficulty,score:r.score,seconds:r.seconds,accuracy:r.accuracy,kills:r.kills,
            level:r.level??1,bossKills:r.bossKills??0,projectilesStopped:r.projectilesStopped??0,
            supplyCollected:r.supplyCollected??0,playId:sentPlayId})
            .then(async()=>{
              setOnlineStatus('점수 전송됨 · 서버 저장 확인 중...');
              let confirmed=false;
              for(let tries=0;tries<6;tries++){
                await new Promise(resolve=>window.setTimeout(resolve,1600+tries*300));
                try {if(await receiptExists(sentPlayId)){confirmed=true;break}}catch { /* 다음 회차에 재시도 */ }
              }
              setOnlineStatus(confirmed?'✓ 구글 스프레드시트 저장 확인 완료':'저장 확인 지연 · 잠시 후 시트를 확인해 주세요.');
              refreshRanks();
            })
            .catch(err=>setOnlineStatus('전송 오류: '+String(err.message||err)));
        }else setOnlineStatus('오프라인 기록만 저장됨 · Apps Script 주소가 필요합니다.');
        return;
      }
      raf=requestAnimationFrame(frame);
    };
    raf=requestAnimationFrame(frame);
    return()=>{cancelAnimationFrame(raf);lastRef.current=0};
  },[screen,nickname,difficulty]);
  const openRanking=(origin:'start'|'over')=>{setRankOrigin(origin);setRankSearch('');setScreen('ranking')};
  const rank=[...scores].filter(r=>r.difficulty===DIFFICULTIES[difficulty].label).sort((a,b)=>b.score-a.score).slice(0,5);
  const ranked=onlineReady?schoolRank.slice(0,5):rank.map(r=>({nickname:r.nickname,score:r.score}));
  const loot=stats.loot;
  const allRanked=onlineReady?schoolRank:rank.map(r=>({nickname:r.nickname,score:r.score}));
  const filteredRank=allRanked.filter(r=>r.nickname.toLowerCase().includes(rankSearch.trim().toLowerCase()));
  const refreshRanks=()=>setRankRefresh(n=>n+1);
  const myFinalScore=currentRoom?.members?.[getUid()]?.score??result?.score??0;
  const bothFinished=!!currentRoom?.members?.[getUid()]?.finished&&!!opponent?.finished;
  const verdict=!bothFinished?'상대 경기 종료 대기':myFinalScore>(opponent?.score||0)?'승리!':myFinalScore<(opponent?.score||0)?'패배':'무승부';
  const renderChatPanel=()=> <aside className="multi-chat"><h2>💬 대결방 채팅</h2><div className="multi-chat-messages">{chat.length?chat.map((line,i)=><div key={i} className={line.uid===getUid()?'mine':''}><b>{line.nickname}</b><span>{line.text}</span></div>):<p>인사말을 입력해 보세요.</p>}</div><form className="multi-chat-form" onSubmit={e=>{e.preventDefault();void postChat()}}><input value={chatDraft} maxLength={150} onChange={e=>setChatDraft(e.target.value)} placeholder="채팅 입력 (최대 150자)"/><button type="submit">전송</button></form></aside>;
  return <main>
    {screen==='start'&&<div className="overlay"><div className="eyebrow">SCHOOL TYPING SURVIVAL · GOOGLE v12 · 1:1 멀티플레이 · 게임 좌표 1920×1080</div><h1>타자 <em>서바이벌</em></h1><p>정답 입력 후 Enter 또는 Space로 공격!<br/>전리품을 선택하고 투사체·무리 러시·보스에 도전하세요.</p><section className="panel"><h2>🏆 학교 전체 TOP 5</h2>{ranked.length?ranked.map((r,i)=><div className="rank" key={i}><span>{i+1}위 · {r.nickname}</span><strong>{r.score.toLocaleString()}점</strong></div>):<p className="muted">아직 기록이 없습니다.</p>}<small>{rankStatus||(!onlineReady?'※ 연동 전에는 이 기기의 기록만 보입니다.':`※ ${DIFFICULTIES[difficulty].label} 난이도 기준 · 학생별 최고 점수`)}</small><button className="link-button" onClick={()=>openRanking('start')}>전체 순위 보기</button>{playerRank?.rank&&<p className="my-rank">내 최고 기록: {playerRank.score?.toLocaleString()}점 · 전체 {playerRank.rank}위</p>}</section><div className="difficulty-picker"><span>난이도 선택</span>{(Object.keys(DIFFICULTIES) as Difficulty[]).map(d=><button key={d} className={difficulty===d?'active':''} onClick={()=>setDifficulty(d)}>{DIFFICULTIES[d].label}</button>)}</div><p className="difficulty-note">{difficulty==='easy'?'쉬움 · 천천히 등장하는 연습 모드':difficulty==='normal'?'보통 · 기존 기준의 표준 전투':'어려움 · 매우 빠른 적, 10마리 러시, 이른 보스'}</p><details className="patch-notes" open><summary>📋 최신 패치노트 · v12</summary><ul>{PATCH_NOTES.map((note,i)=><li key={i}>{note}</li>)}</ul></details><input className="nick" value={nickname} maxLength={16} onChange={e=>setNickname(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')start()}} placeholder="닉네임 입력" aria-label="닉네임"/><button className="primary" disabled={!/^[가-힣A-Za-z0-9_]{2,16}$/.test(nickname.trim())} onClick={()=>start()}>게임 시작</button><button className="primary multiplayer-entry" onClick={openLobby}>⚔ 1:1 멀티플레이 · 방 10개</button><small className="multi-warning">{multiError}</small><button className="link-button" onClick={()=>setScreen('lootbook')}>전리품 도감 · 18종 전부 보기</button><small>{onlineStatus}</small></div>}
    {screen==='lobby'&&<div className="overlay multi-lobby"><div className="eyebrow">1 VS 1 · MULTIPLAYER</div><h1>멀티 <em>대결방</em></h1><p>닉네임: <b>{nickname}</b> · 보통 난이도 · 최대 5분 · 보스 25초부터 36초 간격</p><div className="room-grid">{ROOM_IDS.map((id,i)=>{const room=rooms[id];const count=Object.keys(room?.members||{}).length;const running=room?.match?.status==='playing';return <button key={id} className="room-tile" disabled={count>=2||running} onClick={()=>enterRoom(id)}><strong>{i+1}번 방</strong><span>{running?'경기 중':count===2?'인원 마감':`${count} / 2명`}</span><small>{Object.values(room?.members||{}).map(m=>m.nickname).join(' · ')||'입장 가능'}</small></button>})}</div><small className="multi-warning">{multiError}</small><button onClick={()=>setScreen('start')}>시작 화면으로</button></div>}
    {screen==='room'&&<div className="multi-room-shell"><section className="multi-wait-panel"><div className="eyebrow">1 VS 1 · ROOM {roomId.slice(-2)}</div><h1>{Number(roomId.slice(-2))}번 <em>대결방</em></h1><div className="player-names"><div><small>나</small><strong>{nickname}</strong></div><b>VS</b><div><small>상대</small><strong>{opponent?.nickname||'상대 대기 중'}</strong></div></div><p>난이도: 보통 · 경기 시간 5분 · 첫 보스 25초 · 이후 36초마다 등장</p><button className="primary" disabled={members.length!==2||currentRoom?.match?.status==='playing'} onClick={()=>beginMatch(roomId).catch(error=>setMultiError(String(error)))}>두 명 입장 완료 · 대결 시작</button><small className="multi-warning">{multiError}</small><button onClick={exitRoom}>방 나가기</button></section>{renderChatPanel()}</div>}
    {screen==='multiResult'&&<div className="multi-room-shell"><section className="multi-wait-panel"><div className="eyebrow">MULTIPLAYER · RESULT</div><h1>{verdict}</h1><div className="player-names"><div><small>{nickname}</small><strong>{(currentRoom?.members?.[getUid()]?.score??result?.score??0).toLocaleString()}점</strong></div><b>VS</b><div><small>{opponent?.nickname||'상대'}</small><strong>{(opponent?.score||0).toLocaleString()}점</strong></div></div><p>{multiResult} {opponent?.finished?'상대도 종료했습니다.':'상대의 경기 진행 중일 수 있어요.'}</p><button className="primary" onClick={exitRoom}>대결방 나가기</button></section>{renderChatPanel()}</div>}
    {screen==='game'&&<div className={modeRef.current==='multi'?'multi-active':'single-active'}><div className="game"><div className="version-hint">v12 · 1920×1080 실제 좌표 · 전리품 18종</div><header><span>{stats.seconds<stats.nextBossAt?`보스 등장까지 ${Math.max(0,Math.ceil(stats.nextBossAt-stats.seconds))}초`:'보스 등장!'} · {DIFFICULTIES[difficulty].label}</span><strong className={stats.seconds>=SUDDEN_DEATH_AT?'sudden-timer':''}>{Math.floor(stats.seconds/60).toString().padStart(2,'0')}:{Math.floor(stats.seconds%60).toString().padStart(2,'0')}</strong>{stats.seconds>=SUDDEN_DEATH_AT&&<span className="sudden-alert">⚠ 서든 데스 · 살아남을 수 없습니다!</span>}<span>레벨 {stats.level} · 경험치 {stats.xp}/{stats.xpNeeded} · 점수 {stats.score.toLocaleString()} · 콤보 {stats.combo}</span>{modeRef.current==='multi'&&<div className="multi-opponent-score">상대 {opponent?.nickname||'대기'} · {opponentScore.toLocaleString()}점 <small>남은 시간 {Math.max(0,300-Math.floor(stats.seconds))}초</small></div>}</header><div className="gamefield"><canvas width={W} height={H} ref={canvasRef}/>{loot&&<div className="loot-overlay"><div className="loot-panel"><div className="eyebrow">LEVEL UP</div><h2>전리품을 선택하세요! <small className="loot-count">(전체 {LOOT_POOL.length}종 중 3종)</small></h2><p>원하는 카드의 단어를 입력하면 선택돼요. (게임 일시정지)</p><button className="loot-reroll" onClick={rerollLoot} disabled={stats.rerolls<1}>카드 다시 뽑기 · 남은 {stats.rerolls}회</button><div className="loot-grid">{loot.map(item=><button className="loot-card" key={item.id} onClick={()=>chooseLoot(item)}><strong>{item.name}</strong><span>{item.description}</span><b>{item.word}</b></button>)}</div></div></div>}</div><div className="upgrades-bar">{Object.entries(stats.upgrades).map(([id,n])=><span key={id} title={LOOT_POOL.find(x=>x.id===id)?.description}>{LOOT_POOL.find(x=>x.id===id)?.name} Lv.{n}</span>)}</div><div className="inputbar"><input className={mistyped?'input-error':''} ref={inputRef} value={draft} onChange={inputChange} onCompositionStart={()=>{composingRef.current=true}} onCompositionEnd={e=>{
      composingRef.current=false;
      const input=e.currentTarget;
      const version=typingResetVersionRef.current;
      processInput(input.value,false);
      // 이전 단어를 제출해 초기화한 이후에는 늦게 도착한 IME 이벤트로 복원하지 않습니다.
      window.setTimeout(()=>{
        if(version!==typingResetVersionRef.current)return;
        if(input.isConnected && !composingRef.current && draftRef.current!==input.value){
          processInput(input.value,false);
        }
      },0);
    }} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!e.repeat&&!e.nativeEvent.isComposing&&e.keyCode!==229)submitInput()}}} placeholder={loot?'전리품 카드의 단어를 입력하세요':'단어 입력 후 Enter 또는 Space를 눌러 공격!'} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="타자 입력"/></div><div className="typing-status" aria-live="polite">{mistyped?'오답입니다. Enter/Space로 전체 삭제하거나 Backspace로 수정하세요.':feedback||(loot?'카드를 클릭해도 선택할 수 있어요.':targetRef.current!==null?'공격 대상 선택됨 · Enter/Space로 발사':'몬스터 단어를 입력하세요.')}</div><button className="quit-save" onClick={quitAndSave}>{modeRef.current==='multi'?'경기 포기하고 종료':'점수 저장하고 그만두기'}</button><p className="hint">보스: 단어 순서대로 입력 · 파란 투사체: '막아' · 갈색 상자: '보급'</p></div>{modeRef.current==='multi'&&renderChatPanel()}</div>}
    {screen==='lootbook'&&<div className="overlay lootbook-screen"><div className="eyebrow">LOOT COLLECTION · v11.9</div><h1>전리품 <em>도감</em></h1><p>게임에서 등장하는 강화 능력은 총 {LOOT_POOL.length}종입니다.</p><section className="lootbook-list">{LOOT_POOL.map((item,index)=><div className="lootbook-card" key={item.id}><b>{String(index+1).padStart(2,'0')} · {item.name}</b><span>{item.description}</span><small>선택 단어: {item.word}</small></div>)}</section><button className="primary" onClick={()=>setScreen('start')}>시작 화면으로</button></div>}
    {screen==='ranking'&&<div className="overlay"><div className="eyebrow">SCHOOL LEADERBOARD</div><h1>학교 전체 <em>랭킹</em></h1><section className="panel full-rank"><div className="rank-heading"><h2>🏆 전체 순위 · {DIFFICULTIES[difficulty].label}</h2><button onClick={refreshRanks}>새로고침</button></div><div className="difficulty-picker">{(Object.keys(DIFFICULTIES) as Difficulty[]).map(d=><button key={d} className={difficulty===d?'active':''} onClick={()=>setDifficulty(d)}>{DIFFICULTIES[d].label}</button>)}</div><input className="rank-search" placeholder="닉네임 검색 (상위 100명)" value={rankSearch} onChange={e=>setRankSearch(e.target.value)} />{playerRank?.rank&&<div className="my-ranking">내 기록: {playerRank.score?.toLocaleString()}점 · <strong>{playerRank.rank}위</strong> / {playerRank.total}명</div>}<div className="ranking-scroll">{filteredRank.length?filteredRank.map((r,i)=><div className={'rank '+(r.nickname.toLowerCase()===nickname.trim().toLowerCase()?'rank-me':'')} key={r.nickname}><span>{rankSearch?allRanked.findIndex(x=>x.nickname===r.nickname)+1:i+1}위 · {r.nickname}</span><strong>{r.score.toLocaleString()}점</strong></div>):<p className="muted">{rankStatus||'표시할 기록이 없습니다.'}</p>}</div><small>{rankStatus||'닉네임별 최고 점수 기준 · 상위 100명까지 표시됩니다.'}</small></section><button className="primary" onClick={()=>setScreen(rankOrigin)}>이전 화면으로</button></div>}
    {screen==='over'&&<div className="overlay"><div className="eyebrow">GAME OVER</div><h1>게임 <em>종료</em></h1><section className="panel result"><p>{result?.nickname}님의 결과</p><strong>{result?.score.toLocaleString()}점</strong><div>생존 {result?.seconds}초 · 정확도 {result?.accuracy}% · 처치 {result?.kills}마리</div><div>도달 레벨 {result?.level} · 보스 처치 {result?.bossKills}마리</div><div>{result?.difficulty} · 투사체 요격 {result?.projectilesStopped}회 · 보급 획득 {result?.supplyCollected}회</div></section><section className="panel"><h2>🏆 학교 전체 TOP 5</h2>{ranked.map((r,i)=><div className="rank" key={i}><span>{i+1}위 · {r.nickname}</span><strong>{r.score.toLocaleString()}점</strong></div>)}<small>{rankStatus||`※ ${DIFFICULTIES[difficulty].label} 난이도 기준 · 학생별 최고 점수`}</small><button className="link-button" onClick={()=>openRanking('over')}>전체 순위 보기</button>{playerRank?.rank&&<p className="my-rank">내 최고 기록: {playerRank.score?.toLocaleString()}점 · 전체 {playerRank.rank}위</p>}</section><p className="muted">{onlineStatus}</p><div className="actions"><button className="primary" onClick={()=>start()}>다시 도전하기</button><button onClick={()=>setScreen('start')}>시작 화면</button></div></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
