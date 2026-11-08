// Adapted for ring throwing from the user's F:/game06/1 MediaPipe Pose workflow.
// Coordinates are gameplay mappings of monocular pose estimates, not body measurements.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const length=v=>Math.hypot(...v);
const subtract=(a,b)=>a.map((n,i)=>n-b[i]);
const joint=p=>[p.x,p.y,p.z??0];
const angle=(a,b,c)=>{
  const u=subtract(joint(a),joint(b)),v=subtract(joint(c),joint(b));
  return Math.acos(clamp(u.reduce((s,n,i)=>s+n*v[i],0)/Math.max(1e-8,length(u)*length(v)),-1,1))*180/Math.PI;
};

export function validateGestureLaunch(value) {
  if(!value||!['position','velocity'].every(key=>Array.isArray(value[key])&&value[key].length===3&&value[key].every(Number.isFinite)))throw Error('手势出手数据无效');
  const position=[clamp(value.position[0],-6,6),clamp(value.position[1],.95,4.2),clamp(value.position[2],2.8,8)];
  const speed=length(value.velocity),velocity=value.velocity.map(n=>n*Math.min(1,18/Math.max(speed,1e-9)));
  const rotation=Array.isArray(value.rotation)&&value.rotation.length===4&&value.rotation.every(Number.isFinite)?value.rotation.slice():[0,0,0,1];
  const norm=length(rotation);if(norm<1e-6)throw Error('手势出手角度无效');
  const angularVelocity=(value.angularVelocity??[0,4,0]).map(n=>Number.isFinite(n)?clamp(n,-16,16):0);
  return {position,velocity,rotation:rotation.map(n=>n/norm),angularVelocity,mass:clamp(Number.isFinite(value.mass)?value.mass:.18,.05,1)};
}

export function ringEnergy(mass,position,velocity,gravity=9.81) {
  if(![mass,gravity,...position,...velocity].every(Number.isFinite)||mass<=0||gravity<=0)throw Error('物理数据无效');
  const speed=length(velocity),height=Math.max(0,position[1]);
  return {mass,speed,height,kinetic:.5*mass*speed*speed,potential:mass*gravity*height};
}

export class PoseThrowTracker {
  constructor({hand='right'}={}){this.hand=hand;this.lastRelease=-10;this.reset();}
  reset(){this.samples=[];this.holding=false;this.holdSince=null;this.triggerFrames=0;this.lastSeen=-10;this.position=null;this.backZ=0;this.span=null;}
  setHand(hand){this.hand=hand==='left'?'left':'right';this.reset();}
  update(landmarks,now,{canThrow=true}={}) {
    const ids=this.hand==='right'?[12,14,16,20,18,22]:[11,13,15,19,17,21];
    const valid=p=>p&&[p.x,p.y,p.z??0].every(Number.isFinite)&&(p.visibility??1)>=.58;
    if(!landmarks||landmarks.length<25||![11,12,...ids.slice(0,3)].every(i=>valid(landmarks[i]))) {
      this.reset();
      return {tracked:false,holding:false};
    }
    if(now-this.lastSeen>.25||this.samples.at(-1)?.t>=now)this.reset();
    this.lastSeen=now;
    const left=landmarks[11],right=landmarks[12],rawSpan=Math.hypot(left.x-right.x,left.y-right.y);
    if(rawSpan<.055)return {tracked:false,holding:false};
    this.span=this.span===null?rawSpan:this.span*.92+rawSpan*.08;
    const center={x:(left.x+right.x)/2,y:(left.y+right.y)/2,z:((left.z??0)+(right.z??0))/2};
    const map=p=>[clamp((center.x-p.x)/this.span*2.2,-6,6),clamp(2.35+(center.y-p.y)/this.span*1.55,1.2,4.2),clamp(5.9+((p.z??0)-center.z)/this.span*1.05,2.8,8)];
    const [shoulder,elbow,wrist]=ids.map(i=>landmarks[i]);
    const raw=map(wrist);
    this.position=this.position?raw.map((v,i)=>this.position[i]*.25+v*.75):raw;
    this.samples.push({t:now,p:this.position.slice()});
    this.samples=this.samples.filter(s=>now-s.t<=.22);
    let velocity=[0,0,0];
    if(this.samples.length>=3) {
      const meanT=this.samples.reduce((s,p)=>s+p.t,0)/this.samples.length;
      const variance=this.samples.reduce((s,p)=>s+(p.t-meanT)**2,0);
      if(variance>1e-6)velocity=[0,1,2].map(i=>this.samples.reduce((s,p)=>s+(p.t-meanT)*p.p[i],0)/variance);
    }
    const elbowAngle=angle(shoulder,elbow,wrist);
    const bent=elbowAngle<139&&Math.abs(wrist.y-shoulder.y)<this.span*1.05&&Math.hypot(wrist.x-shoulder.x,wrist.y-shoulder.y)<this.span*1.85;
    if(!canThrow){this.holding=false;this.holdSince=null;this.triggerFrames=0;}
    if(canThrow&&!this.holding&&now-this.lastRelease>.8) {
      if(bent){this.holdSince??=now;if(now-this.holdSince>=.24){this.holding=true;this.backZ=this.position[2];}}
      else this.holdSince=null;
    }
    let launch=null;
    const forward=Math.max(0,-velocity[2]),rise=velocity[1];
    const power=clamp(Math.hypot(forward,Math.max(0,rise))/11,0,1);
    if(this.holding) {
      this.backZ=Math.max(this.backZ,this.position[2]);
      const pushed=this.backZ-this.position[2]>.16&&forward>1.65&&rise>.15;
      const extended=elbowAngle>136||forward>3.2&&rise>1;
      this.triggerFrames=pushed&&extended?this.triggerFrames+1:0;
      if(this.triggerFrames>=2) {
        const vx=clamp(velocity[0]*.85,-6.5,6.5),vy=clamp(rise*.95+forward*.25,.8,11.5),vz=-clamp(forward*1.25,2,12.5);
        const pitch=clamp(-vy*.025,-.28,.28),roll=clamp(-vx*.025,-.18,.18),sp=Math.sin(pitch/2),cp=Math.cos(pitch/2),sr=Math.sin(roll/2),cr=Math.cos(roll/2);
        launch=validateGestureLaunch({position:this.position.slice(),velocity:[vx,vy,vz],rotation:[sp*cr,-sp*sr,cp*sr,cp*cr],angularVelocity:[0,clamp(forward*.65,2,9),-vx*.12],mass:.18});
        this.lastRelease=now;this.holding=false;this.holdSince=null;this.triggerFrames=0;
      }
    }
    return {tracked:true,holding:this.holding,position:this.position.slice(),velocity,elbowAngle,power,launch,
      points:ids.map(i=>valid(landmarks[i])?map(landmarks[i]):null)};
  }
}
