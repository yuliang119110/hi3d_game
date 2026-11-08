export const SETTINGS = Object.freeze({duration:120, rings:36, required:8, gravity:9.81, step:1/90, radius:.74, tube:.047, maxLive:5, cooldown:.38, grace:9});
export const LEVELS = Object.freeze([
 {id:0,name:'新手关 · 高抛入门',short:'新手关',duration:120,rings:36,required:8,motion:0,wind:0,star:false,desc:'奖品不动，专心练高抛落点'},
 {id:1,name:'第一关 · 走马灯会',short:'第一关',duration:100,rings:28,required:8,motion:1,wind:1,star:false,desc:'中排木凳像走马灯来回滑动，老板开风扇'},
 {id:2,name:'第二关 · 舞狮闹春',short:'第二关',duration:90,rings:24,required:9,motion:2,wind:1.35,star:true,desc:'三排交错游走，套中金光福星三倍分'}
]);
export const ZODIAC = ['rat','ox','tiger','rabbit','dragon','snake','horse','goat','monkey','rooster','dog','pig'];
export const LABELS = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
export const UPGRADES = [
 {id:'wide',icon:'◎',name:'宽圈有福',detail:'之后投出的圈半径增大12%，碰撞与外观同步。'},
 {id:'supply',icon:'＋',name:'再来五圈',detail:'立即补充5个圈，多一次翻盘机会。'},
 {id:'calm',icon:'≋',name:'定风如意',detail:'风扇对圈的影响减少65%。'},
 {id:'rescue',icon:'↶',name:'空圈回响',detail:'每累计3次空圈，返还1个普通圈。'},
 {id:'streak',icon:'✦',name:'喝彩连台',detail:'连击积分提高30%，声浪积累更快。'},
 {id:'fever',icon:'焰',name:'红火不停',detail:'热场时间从6秒延长至10秒。'}
];
export class GameState {
 constructor(){this.reset('challenge');this.phase='ready';}
 reset(mode='challenge',level=0){
  this.mode=mode;this.level=LEVELS[level]??LEVELS[0];this.star=null;this.phase='playing';this.time=this.level.duration;this.elapsed=0;this.rings=this.level.rings;
  this.score=0;this.combo=0;this.maxCombo=0;this.hits=0;this.shots=0;this.misses=0;this.collected=new Set();
  this.perks=new Set();this.choices=[];this.offered=new Set();this.noise=0;this.fever=0;this.cooldown=0;
  this.silence=0;this.ending=0;this.endReason='';this.goldReady=false;this.betUsed=false;this.usedGold=false;
 }
 tick(dt,live){
  if(this.phase!=='playing')return;
  this.elapsed+=dt;this.cooldown=Math.max(0,this.cooldown-dt);this.silence=Math.max(0,this.silence-dt);
  this.fever=Math.max(0,this.fever-dt);this.noise=Math.max(0,this.noise-dt*1.0);
  if(this.mode==='practice')return;
  this.time=Math.max(0,this.time-dt);
  if((this.time<=0 || (this.rings===0&&!this.goldReady&&this.fever<=0))){
   this.ending+=dt;
   if(live===0 || this.ending>SETTINGS.grace)this.finish(this.time<=0?'time':'empty');
  }else this.ending=0;
 }
 canThrow(live){return this.phase==='playing'&&this.cooldown<=0&&live<SETTINGS.maxLive&&(this.mode==='practice'||this.time>0&&(this.rings>0||this.goldReady||this.fever>0));}
 consume(live){
  if(!this.canThrow(live))return null;
  const gold=this.goldReady;this.goldReady=false;
  if(this.mode!=='practice'&&this.fever<=0&&!gold)this.rings--;
  this.shots++;this.cooldown=SETTINGS.cooldown;return {gold,radius:SETTINGS.radius*(this.perks.has('wide')?1.12:1)*(gold?1.18:1)};
 }
 hit(id,gold=false){
  if(this.phase!=='playing')return null;
  const fresh=!this.collected.has(id);this.collected.add(id);this.hits++;this.combo++;this.maxCombo=Math.max(this.maxCombo,this.combo);
  const row=Math.floor(ZODIAC.indexOf(id)/4);let points=Math.round((100+row*60)*(1+Math.min(this.combo-1,8)*.20)*(this.perks.has('streak')?1.3:1)*(gold?3:1)*(this.star===id?3:1));const starHit=this.star===id;
  let effect=starHit?'福星高照 ×3':'';if(starHit)this.star=null;this.score+=points;this.noise=Math.min(100,this.noise+(this.perks.has('streak')?30:23));
  const index=ZODIAC.indexOf(id);
  if(fresh&&[0,3,8].includes(index)){this.rings+=2;effect='巧手回圈 +2';}
  if(fresh&&[2,5,10].includes(index)){this.silence=8;effect='定风 8秒';}
  if(fresh&&[4,6,9].includes(index)){this.noise=Math.min(100,this.noise+18);effect='声浪大涨';}
  if(fresh&&[1,7,11].includes(index)){this.score+=40;points+=40;effect='稳稳有福 +40分';}
  if(this.noise>=100&&this.fever<=0){this.fever=this.perks.has('fever')?10:6;this.noise=0;effect='满堂喝彩！热场免耗圈';}
  const milestone=this.collected.size>=this.level.required?this.level.required:this.collected.size>=4?4:0;
  if(this.mode!=='practice'&&milestone&&!this.offered.has(milestone)&&this.collected.size<12){
   this.offered.add(milestone);this.choices=UPGRADES.filter(x=>!this.perks.has(x.id)).slice();
   // Deterministic rotation makes a replay inspectable while offering different stages.
   const n=(this.hits+this.shots)%this.choices.length;this.choices=[...this.choices.slice(n),...this.choices.slice(0,n)].slice(0,3);this.phase='upgrade';
  }
  if(this.mode!=='practice'&&this.collected.size===12)this.finish('complete');
  return {fresh,points,effect};
 }
 miss(){
  if(this.phase!=='playing')return;
  this.combo=0;this.misses++;if(this.perks.has('rescue')&&this.misses%3===0)this.rings++;
 }
 choose(id){
  if(this.phase!=='upgrade'||!this.choices.some(x=>x.id===id))return false;
  this.perks.add(id);if(id==='supply')this.rings+=5;this.choices=[];this.phase='playing';return true;
 }
 exchange(){if(this.phase!=='playing'||this.mode==='practice'||this.betUsed||this.rings!==5||this.fever>0)return false;this.rings=0;this.goldReady=true;this.betUsed=true;return true;}
 finish(reason){this.phase='result';this.endReason=reason;}
 snapshot(){return {...this,collected:[...this.collected],perks:[...this.perks],offered:[...this.offered]};}
}
