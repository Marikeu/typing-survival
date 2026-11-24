/** Google Apps Script JSONP 조회 + no-cors 기록 저장. 서버의 반영 여부는 receipt 조회로 검증. */
export type OnlineRank = {nickname:string;score:number};
export type PlayerRank = {nickname:string; rank:number|null; score:number|null; total:number};
const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbyz70rWnHg0zLFwcWfiTfybK7MArpftjwkpXql19l46VYpBUqcnrmhesJ9Nl3-nA4rLFQ/exec';
const URL = String(import.meta.env.VITE_APPS_SCRIPT_URL || DEFAULT_URL).trim();
export const onlineReady = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(URL);

type ApiResponse = {ok:boolean;error?:string;ranking?:OnlineRank[];player?:PlayerRank;found?:boolean};
function getJsonp(params:Record<string,string>):Promise<ApiResponse> {
 if(!onlineReady) return Promise.reject(new Error('Apps Script 주소가 설정되지 않았습니다.'));
 return new Promise((resolve,reject)=>{
  const callback='typingRank_'+Date.now()+'_'+Math.floor(Math.random()*1e7);
  const script=document.createElement('script'); let settled=false;
  const timer=window.setTimeout(()=>finish(()=>reject(new Error('서버 응답 시간 초과'))),15000);
  function finish(fn:()=>void){if(settled)return;settled=true;clearTimeout(timer);script.remove();delete (window as unknown as Record<string,unknown>)[callback];fn()}
  (window as unknown as Record<string,unknown>)[callback]=(res:ApiResponse)=>finish(()=>res?.ok?resolve(res):reject(new Error(res?.error||'조회 실패')));
  script.onerror=()=>finish(()=>reject(new Error('서버 연결 오류')));
  script.src=URL+'?'+new URLSearchParams({...params,callback,_:String(Date.now())}).toString();
  document.head.appendChild(script);
 });
}
export async function fetchRanking(difficulty:string):Promise<OnlineRank[]> {
 const data=await getJsonp({action:'ranking',difficulty});return data.ranking||[];
}
export async function fetchPlayerRank(difficulty:string,nickname:string):Promise<PlayerRank> {
 const data=await getJsonp({action:'player',difficulty,nickname});
 return data.player||{nickname,rank:null,score:null,total:0};
}
export async function receiptExists(playId:string):Promise<boolean>{
 const data=await getJsonp({action:'receipt',playId});return Boolean(data.found);
}
export async function submitScore(record:{nickname:string;difficulty:string;score:number;seconds:number;accuracy:number;kills:number;level:number;bossKills:number;projectilesStopped:number;supplyCollected:number;playId:string}):Promise<void>{
 if(!onlineReady)throw new Error('Apps Script 주소가 설정되지 않았습니다.');
 await fetch(URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'save',...record})});
}
