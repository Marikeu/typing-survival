/** Canvas-only effects. Never modifies HP, kills, score, XP, or enemy positions. */
export type Point={x:number;y:number};
type Vfx =
 | {kind:'burst';x:number;y:number;start:number;life:number;radius:number;color:string}
 | {kind:'text';x:number;y:number;start:number;life:number;text:string;color:string}
 | {kind:'bolt';points:Point[];start:number;life:number;color:string}
 | {kind:'slash';x:number;y:number;start:number;life:number;angle:number}
 | {kind:'spark';x:number;y:number;start:number;life:number;color:string;seed:number;count:number}
 | {kind:'boom';x:number;y:number;tx:number;ty:number;start:number;life:number}
 | {kind:'shield';x:number;y:number;start:number;life:number}
 | {kind:'typed-shot';x:number;y:number;tx:number;ty:number;px:number;py:number;speed:number;targetId:number;start:number;life:number;boss:boolean};
const TAU=Math.PI*2;
// Native 1920×1080 playfield: distance from player is doubled; icon sizes remain compact.
const WORLD_SCALE=2;
const color={orange:'#d68c57',blue:'#668da7',green:'#65977b',gold:'#c29c55',white:'#fdf6e6'};
export class EffectSystem {
  private effects:Vfx[]=[];
  clear(){this.effects=[]}
  /** 정답 제출 시 타깃을 추적하는 작은 네모 탄환 1개 생성. 적은 아직 제거하지 않습니다. */
  typedProjectile(x:number,y:number,tx:number,ty:number,_glyph:string,_delay=0,boss=false,targetId=-1){
    const distance=Math.hypot(tx-x,ty-y);
    // v11.8의 650~1000ms 이동에 비해 정확히 1.5배 빠른 초기 이동 속도
    const oldDuration=Math.max(650,Math.min(1000,distance/2.0));
    const speed=distance/(oldDuration/1000)*1.5;
    this.effects.push({kind:'typed-shot',x,y,tx,ty,px:x,py:y,speed,targetId,boss,start:performance.now(),life:5000});
    if(this.effects.length>260)this.effects.splice(0,this.effects.length-260);
  }
  /** 이미 탄환이 향하고 있는 적은 정답 제출 대상으로 중복 선택하지 않습니다. */
  hasTypedShotFor(targetId:number){
    return this.effects.some(e=>e.kind==='typed-shot'&&e.targetId===targetId);
  }
  /** 이동하는 단어의 현재 위치를 추적해서 충돌하면 적 ID를 돌려줍니다. */
  advanceTypedProjectiles(dt:number,enemies:{id:number;x:number;y:number;boss?:boolean}[]):number[]{
    const hits:number[]=[];
    const impactEffects:{x:number;y:number;boss:boolean}[]=[];
    const living=new Map(enemies.map(e=>[e.id,e]));
    const now=performance.now();
    this.effects=this.effects.filter(e=>{
      if(e.kind!=='typed-shot')return true;
      const target=living.get(e.targetId);
      if(!target||now>e.start+e.life)return false;
      const tx=target.x,ty=target.y-(target.boss?72:53);
      const dx=tx-e.px,dy=ty-e.py,dist=Math.hypot(dx,dy);
      const step=e.speed*dt;
      if(dist<=Math.max(14,step)){
        hits.push(e.targetId);
        impactEffects.push({x:tx,y:ty,boss:!!target.boss});
        return false;
      }
      e.px+=dx/dist*step;
      e.py+=dy/dist*step;
      e.tx=tx;e.ty=ty;
      return true;
    });
    for(const hit of impactEffects)this.burst(hit.x,hit.y,hit.boss?28:19,hit.boss?'#c29c55':'#668da7');
    return hits;
  }
  burst(x:number,y:number,radius=70,paint=color.orange){this.effects.push({kind:'burst',x,y,radius,color:paint,start:performance.now(),life:530})}
  text(x:number,y:number,text:string,paint=color.green){this.effects.push({kind:'text',x,y,text,color:paint,start:performance.now(),life:1100})}
  slash(x:number,y:number,angle:number){this.effects.push({kind:'slash',x,y,angle,start:performance.now(),life:340})}
  chain(points:Point[],paint=color.blue){if(points.length>1)this.effects.push({kind:'bolt',points:points.map(p=>({...p})),color:paint,start:performance.now(),life:430})}
  ring(x:number,y:number,radius:number,paint='#c29c55'){this.burst(x,y,radius,paint)}
  beam(points:Point[],paint='#baaa71'){this.chain(points,paint)}
  sparkles(x:number,y:number,count=10,paint='#c29c55'){
    this.effects.push({kind:'spark',x,y,count,color:paint,seed:Math.random()*TAU,start:performance.now(),life:820})
  }
  freeze(x:number,y:number){this.burst(x,y,43,'#7daebc');this.sparkles(x,y,10,'#7daebc')}
  shieldHit(x:number,y:number){this.effects.push({kind:'shield',x,y,start:performance.now(),life:540})}
  boomerang(x:number,y:number,tx:number,ty:number){this.effects.push({kind:'boom',x,y,tx,ty,start:performance.now(),life:800})}
  powerUp(x:number,y:number,id:string){
    const paints:Record<string,string>={drone:'#b5a66f',blades:'#b8ada0',mines:'#b7826c',chain:'#76a7c7',growth:'#977eb0',freeze:'#7daebc',lightning:'#91aeda',pierce:'#b9a179',boomerang:'#b6a07e',leech:'#78a48b',regen:'#78a48b',luck:'#c29c55'};
    this.sparkles(x,y,12,paints[id]||'#c29c55');this.text(x,y-24,'POWER UP',paints[id]||'#c29c55')
  }
  frostOverlay(ctx:CanvasRenderingContext2D,x:number,y:number,now:number){
    ctx.save();ctx.strokeStyle='rgba(113,171,195,.64)';ctx.lineWidth=1.3;
    for(let i=0;i<6;i++){
      const a=now/1800+i*TAU/6;const px=x+Math.cos(a)*18,py=y+Math.sin(a)*18;
      ctx.beginPath();ctx.moveTo(px-3,py);ctx.lineTo(px+3,py);ctx.moveTo(px,py-3);ctx.lineTo(px,py+3);ctx.stroke()
    }ctx.restore()
  }
  /** Persistent auras render under all enemies, and are not stored as timed effects. */
  underlay(ctx:CanvasRenderingContext2D,now:number,cx:number,cy:number,slowLevel:number,bladeLevel:number,upgrades:Record<string,number>={},elapsed=0,enemies:Point[]=[]){
    ctx.save();
    if(slowLevel>0){
      const pulse=(Math.sin(now/430)+1)/2;
      const r=(125+slowLevel*7)*WORLD_SCALE;
      ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.fillStyle='rgba(90,151,180,0.065)';ctx.fill();
      ctx.strokeStyle=`rgba(91,153,187,${.36+pulse*.25})`;ctx.lineWidth=2;ctx.setLineDash([7,8]);ctx.lineDashOffset=-now/50;ctx.stroke();ctx.setLineDash([]);
      ctx.strokeStyle='rgba(91,153,187,0.16)';ctx.beginPath();ctx.arc(cx,cy,r-8*WORLD_SCALE+pulse*5,0,TAU);ctx.stroke();
    }
    if(bladeLevel>0){
      const count=Math.min(6,2+bladeLevel);
      const orbit=(72+Math.min(3,bladeLevel)*6)*WORLD_SCALE;
      for(let i=0;i<count;i++){
        const a=now/660+i*TAU/count;
        const x=cx+Math.cos(a)*orbit,y=cy+Math.sin(a)*orbit;
        ctx.save();ctx.translate(x,y);ctx.rotate(a+Math.PI/2);
        ctx.fillStyle='#c3bbb0';ctx.strokeStyle='#706b64';ctx.lineWidth=1.6;
        ctx.beginPath();ctx.moveTo(0,-15);ctx.quadraticCurveTo(8,-5,5,10);ctx.lineTo(-4,10);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
      }
    }
    // Continuous, subtle icons; visual-only (no game state changes).
    if(upgrades.wall){ctx.strokeStyle='rgba(189,148,82,.5)';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(cx,cy,44+Math.sin(now/550)*2.5,0,TAU);ctx.stroke()}
    if(upgrades.comboGuard){ctx.strokeStyle='rgba(116,139,184,.42)';ctx.lineWidth=1.9;ctx.setLineDash([4,5]);ctx.beginPath();ctx.arc(cx,cy,62,0,TAU);ctx.stroke();ctx.setLineDash([])}
    if(upgrades.regen||upgrades.leech){
      for(let i=0;i<Math.min(5,2+(upgrades.regen||0)+(upgrades.leech||0));i++){
        const a=now/2300+i*TAU/5,r=66+Math.sin(now/700+i)*7;
        ctx.fillStyle='rgba(91,155,107,.6)';ctx.beginPath();ctx.arc(cx+Math.cos(a)*r,cy+Math.sin(a)*r,2.5,0,TAU);ctx.fill()
      }
    }
    if(upgrades.drone){for(let i=0;i<Math.min(3,upgrades.drone);i++){
      const a=now/900+i*TAU/Math.min(3,upgrades.drone),x=cx+Math.cos(a)*100,y=cy+Math.sin(a)*100;
      ctx.fillStyle='#a79b70';ctx.strokeStyle='#756e57';ctx.lineWidth=1.3;
      ctx.beginPath();ctx.arc(x,y,6,0,TAU);ctx.fill();ctx.stroke();ctx.fillStyle='#efe7cb';ctx.fillRect(x-2,y-2,4,4)
    }}
    if(upgrades.mines){for(let i=0;i<Math.min(4,upgrades.mines+1);i++){
      const a=i*TAU/Math.min(4,upgrades.mines+1)+.3,x=cx+Math.cos(a)*294,y=cy+Math.sin(a)*294;
      ctx.fillStyle='#a96e60';ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x+6,y+5);ctx.lineTo(x-6,y+5);ctx.closePath();ctx.fill();
      ctx.strokeStyle='rgba(165,100,85,.33)';ctx.beginPath();ctx.arc(x,y,10+Math.sin(now/400+i)*3,0,TAU);ctx.stroke()
    }}
    if(upgrades.boomerang){const a=now/950,x=cx+Math.cos(a)*230,y=cy+Math.sin(a)*230;
      ctx.save();ctx.translate(x,y);ctx.rotate(-a+now/200);ctx.strokeStyle='#af9978';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-9,-6);ctx.lineTo(0,6);ctx.lineTo(9,-6);ctx.stroke();ctx.restore()
    }
    if(upgrades.score){ctx.font='bold 11px sans-serif';ctx.fillStyle='rgba(169,131,63,.78)';ctx.textAlign='center';ctx.fillText('SCORE x'+(1+.2*upgrades.score).toFixed(1),cx,cy-116)}
    if(upgrades.growth){ctx.font='bold 11px sans-serif';ctx.fillStyle='rgba(135,99,164,.78)';ctx.textAlign='center';ctx.fillText('EXP+',cx+122,cy-112)}
    if(upgrades.luck){for(let i=0;i<3;i++){
      const a=now/1350+i*TAU/3,x=cx+Math.cos(a)*124,y=cy+Math.sin(a)*124;
      ctx.fillStyle='#c6ab64';ctx.font='bold 13px sans-serif';ctx.fillText('✦',x,y)
    }}
    if(upgrades.lightning&&enemies.length){const target=enemies[Math.floor(elapsed*2)%enemies.length];if(target){ctx.strokeStyle='rgba(100,150,197,.18)';ctx.beginPath();ctx.moveTo(target.x-8,0);ctx.lineTo(target.x,target.y-16);ctx.stroke()}}
    ctx.restore();
  }
  overlay(ctx:CanvasRenderingContext2D,now:number){
    this.effects=this.effects.filter(e=>now<e.start+e.life);
    ctx.save();
    for(const e of this.effects){
      if(now<e.start)continue;
      const t=Math.min(1,Math.max(0,(now-e.start)/e.life)),alpha=1-t;
      ctx.save();ctx.globalAlpha=alpha;
      if(e.kind==='burst'){
        const r=e.radius*(.12+.88*t);
        ctx.strokeStyle=e.color;ctx.lineWidth=4*(1-t)+1;
        ctx.beginPath();ctx.arc(e.x,e.y,r,0,TAU);ctx.stroke();
        for(let i=0;i<9;i++){
          const a=TAU*i/9+(e.x+e.y)%3;
          const pr=r*(.55+(i%3)*.13),x=e.x+Math.cos(a)*pr,y=e.y+Math.sin(a)*pr;
          ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(x,y,3.2*(1-t)+.8,0,TAU);ctx.fill();
        }
      } else if(e.kind==='text'){
        ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=e.color;ctx.fillText(e.text,e.x,e.y-38*t);
      } else if(e.kind==='bolt'){
        ctx.strokeStyle=e.color;ctx.lineWidth=5*(1-t)+1;ctx.lineCap='round';ctx.lineJoin='round';
        ctx.beginPath();ctx.moveTo(e.points[0].x,e.points[0].y);
        for(let i=1;i<e.points.length;i++){
          const p=e.points[i-1],q=e.points[i];
          const dx=q.x-p.x,dy=q.y-p.y,dist=Math.hypot(dx,dy)||1;
          for(let j=1;j<=6;j++){
            const f=j/6,jitter=j===6?0:Math.sin(j*23+i*17+e.start)*7;
            ctx.lineTo(p.x+dx*f-dy/dist*jitter,p.y+dy*f+dx/dist*jitter);
          }
        }
        ctx.stroke();
      } else if(e.kind==='spark'){
        for(let i=0;i<e.count;i++){
          const a=e.seed+i*2.3999632297,r=8+t*(25+(i%4)*11),xx=e.x+Math.cos(a)*r,yy=e.y+Math.sin(a)*r;
          ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(xx,yy,(i%3===0?3:2)*(1-t)+.4,0,TAU);ctx.fill()
        }
      } else if(e.kind==='boom'){
        const out=t<.5?t*2:(1-t)*2;
        const x=e.x+(e.tx-e.x)*out,y=e.y+(e.ty-e.y)*out-33*Math.sin(Math.PI*out);
        ctx.save();ctx.translate(x,y);ctx.rotate(t*TAU*2);ctx.strokeStyle='#b69c7c';ctx.lineWidth=4;
        ctx.beginPath();ctx.moveTo(-9,-6);ctx.lineTo(0,6);ctx.lineTo(9,-6);ctx.stroke();ctx.restore()
      } else if(e.kind==='typed-shot'){
        const x=e.px,y=e.py;
        const angle=Math.atan2(e.ty-y,e.tx-x);
        const paint=e.boss?'#b98b42':'#507c9e';
        ctx.globalAlpha=1;
        ctx.strokeStyle=e.boss?'rgba(185,139,66,.35)':'rgba(80,124,158,.30)';
        ctx.lineCap='round';ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(x-Math.cos(angle)*18,y-Math.sin(angle)*18);ctx.lineTo(x,y);ctx.stroke();
        const size=e.boss?17:15;
        ctx.fillStyle=paint;
        ctx.fillRect(x-size/2,y-size/2,size,size);
        ctx.strokeStyle='#fffaf0';ctx.lineWidth=1;
        ctx.strokeRect(x-size/2+.5,y-size/2+.5,size-1,size-1);
      } else if(e.kind==='shield'){
        ctx.strokeStyle='#7b8db6';ctx.lineWidth=5*(1-t)+1;ctx.beginPath();ctx.arc(e.x,e.y,24+t*36,0,TAU);ctx.stroke();
        ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillStyle='#7b8db6';ctx.fillText('BLOCK',e.x,e.y-55*t)
      } else if(e.kind==='slash'){
        ctx.translate(e.x,e.y);ctx.rotate(e.angle);ctx.strokeStyle=color.white;ctx.lineWidth=5*(1-t)+1;
        ctx.beginPath();ctx.arc(0,0,22+t*18,-1.15,.9);ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
}
