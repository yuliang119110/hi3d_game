import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {GameState,SETTINGS,ZODIAC,LABELS,UPGRADES,LEVELS} from './hi3d-rules.js';
import {FairPhysics,initPhysics} from './hi3d-physics.js';
import {configureCharacters,arrangeCharacters} from './hi3d-responsive-layout.js';
import {FairSoundscape} from './hi3d-soundscape.js';
import {GestureThrowController} from './hi3d-gesture-controller.js';
import {GestureRingView} from './hi3d-gesture-view.js';

const $=id=>document.getElementById(id), show=(id,on)=>$(id).classList.toggle('hidden',!on);
const game=new GameState(), loader=new GLTFLoader(), scene=new THREE.Scene();
const soundscape=new FairSoundscape({onWarning:message=>toast(message)});
const gestureView=new GestureRingView(scene);
let gestureFrame=null,lastGestureRing=null,lastGestureStats=null,lastGestureUI=0;
const gestures=new GestureThrowController({canThrow:()=>ready&&!inspecting&&game.canThrow(physics?.live??0),onFrame:state=>{gestureFrame=state;},onThrow:launch=>releaseGestureThrow(launch),onCancel:()=>{gestureFrame=null;gestureView.hide();},onToggle:enabled=>{clearDrag();$('high').disabled=enabled;$('low').disabled=enabled;$('input-hint').textContent=enabled?'收手持圈 · 前上方挥手出圈':'点选玩偶 · 拖动微调 · 松手投圈';if(enabled)ensureAudio();}});
const sceneRoot=new THREE.Group();scene.add(sceneRoot);
let renderer,camera,physics,characters=[],mode='high',pointerDown=null,acc=0,last=performance.now(),sim=0;
let currentWind=0,windPhase='off',previousPhase='ready',closingAnnounced=false,toastUntil=0,callUntil=0,slow=0,lastSound=0;
let ready=false,audio=null,audioMaster=null,soundOn=true,assetFailures=[],externalLoads=0,layout,environmentTarget,controls,inspecting=false,inspectionPrevious;
let currentLevel=0,unlocked=1,camShake=0,starMesh=null,starTimer=0;const DOLL=1.3,camBase={pos:new THREE.Vector3(),look:new THREE.Vector3(),fov:40},camLook=new THREE.Vector3(),camWant=new THREE.Vector3(),lookWant=new THREE.Vector3();try{unlocked=Number(localStorage.getItem('hi3d-ring-fair-unlocked'))||1;}catch{}
let best=0;try{best=Number(localStorage.getItem('hi3d-ring-fair-best-v1'))||0;}catch{}
let boardPortrait=null,pendingPortrait=null,followEnabled=!matchMedia('(prefers-reduced-motion: reduce)').matches;
let viewportWidth=0,viewportHeight=0,modalFocus=null;
const aim=new THREE.Vector3(-1.325,.65,.7),ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-1);
const normal=new THREE.Vector3(),tmp=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
async function loadGLB(path){
 const url=new URL(path,location.href),response=await fetch(url.href);
 if(!response.ok)throw Error(`模型读取失败：HTTP ${response.status}`);
 const bytes=await response.arrayBuffer();
 if(bytes.byteLength<12)throw Error('模型文件不完整');
 const header=new DataView(bytes);
 if(header.getUint32(0,true)!==0x46546c67||header.getUint32(8,true)!==bytes.byteLength)throw Error('GLB文件长度或格式校验失败');
 return loader.parseAsync(bytes,new URL('.',url).href);
}
const arc=new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:48},()=>new THREE.Vector3())),new THREE.LineDashedMaterial({color:0xffe6a1,dashSize:.14,gapSize:.13,transparent:true,opacity:.62,depthTest:false}));
arc.renderOrder=20;scene.add(arc);
const marker=new THREE.Mesh(new THREE.RingGeometry(.53,.59,56),new THREE.MeshBasicMaterial({color:0xffd16f,side:THREE.DoubleSide,transparent:true,opacity:.9,depthTest:false}));marker.rotation.x=-Math.PI/2;marker.renderOrder=21;scene.add(marker);
const markerDot=new THREE.Mesh(new THREE.CircleGeometry(.035,16),new THREE.MeshBasicMaterial({color:0xffefd0,side:THREE.DoubleSide,depthTest:false}));markerDot.rotation.x=-Math.PI/2;scene.add(markerDot);
let fan,fanBlades,keeperArm;const effects=[];

function toast(message){$('toast').textContent=message;$('toast').style.opacity='1';toastUntil=performance.now()+2400;}
function call(message,sub=''){const el=$('callout');el.replaceChildren(document.createTextNode(message));if(sub){const s=document.createElement('small');s.textContent=sub;el.append(s);}el.style.opacity='1';callUntil=performance.now()+1800;}
function ensureAudio(){
 soundscape.unlock();audio=soundscape.context;audioMaster=soundscape.effectsGain;
}
function tone(freq=440,length=.12,type='sine',vol=.4,delay=0){
 if(!audio||!soundOn)return;const t=audio.currentTime+delay,o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.001,t);g.gain.exponentialRampToValueAtTime(vol,t+.009);g.gain.exponentialRampToValueAtTime(.001,t+length);o.connect(g);g.connect(audioMaster);o.start(t);o.stop(t+length+.02);o.onended=()=>{o.disconnect();g.disconnect();};
}
function hitSound(){soundscape.effect('applause',{volume:.65});[523,659,784,1047].forEach((n,i)=>tone(n,.19,'sine',.5,i*.045));}
function confetti(position,color=0xffce69,count=24){
 const geo=new THREE.BufferGeometry(),positions=new Float32Array(count*3),vel=[];
 for(let i=0;i<count;i++){positions.set(position.toArray(),i*3);const a=i*2.39996;vel.push(new THREE.Vector3(Math.cos(a)*(1+i%3*.3),2+i%5*.3,Math.sin(a)*(1+i%3*.3)));}
 geo.setAttribute('position',new THREE.BufferAttribute(positions,3));const mesh=new THREE.Points(geo,new THREE.PointsMaterial({color,size:.07,transparent:true,opacity:1,sizeAttenuation:true}));scene.add(mesh);effects.push({mesh,vel,age:0});
}
function addLocalProps(){
 const red=new THREE.MeshStandardMaterial({color:0x802311,roughness:.7}),gold=new THREE.MeshStandardMaterial({color:0xdba454,metalness:.5,roughness:.4}),dark=new THREE.MeshStandardMaterial({color:0x273e36,roughness:.55});
 fan=new THREE.Group();fan.position.set(6.2,.22,-2.1);scene.add(fan);
 function mesh(g,m,p,parent=fan){const o=new THREE.Mesh(g,m);o.position.set(...p);parent.add(o);return o;}
 mesh(new THREE.CylinderGeometry(.28,.34,.09,16),dark,[0,.05,0]);mesh(new THREE.CylinderGeometry(.045,.065,.8,12),dark,[0,.48,0]);
 const rim=mesh(new THREE.TorusGeometry(.43,.025,8,40),gold,[0,1.22,0]);
 fanBlades=new THREE.Group();fanBlades.position.set(0,1.22,0);fan.add(fanBlades);
 for(let i=0;i<3;i++){const g=new THREE.Group();g.rotation.z=i*Math.PI*2/3;fanBlades.add(g);mesh(new THREE.SphereGeometry(1,8,6),dark,[0,.21,0],g).scale.set(.11,.23,.026);}
 mesh(new THREE.SphereGeometry(.09,12,8),gold,[0,1.22,.05]);
 for(let i=0;i<6;i++){const m=mesh(new THREE.CylinderGeometry(.007,.007,.82,5),gold,[0,1.22,.07]);m.rotation.z=i*Math.PI/6;}
 fan.position.set(9.5,.22,-2.1);fan.visible=false;
 const keeper=new THREE.Group();keeper.position.set(11,.22,-4.4);keeper.visible=false;scene.add(keeper);
 mesh(new THREE.SphereGeometry(.25,12,8),new THREE.MeshStandardMaterial({color:0xc78653}),[0,1.3,0],keeper);
 mesh(new THREE.CapsuleGeometry(.25,.45,3,8),red,[0,.72,0],keeper);
 for(const x of [-.13,.13])mesh(new THREE.CylinderGeometry(.075,.07,.55,8),dark,[x,.27,0],keeper);
 keeperArm=mesh(new THREE.CapsuleGeometry(.065,.39,3,8),red,[-.34,.83,.03],keeper);keeperArm.rotation.z=-.3;
 const hand=mesh(new THREE.SphereGeometry(.08,8,6),gold,[-.4,.6,.08],keeper);
 mesh(new THREE.TorusGeometry(.12,.022,6,20),gold,[0,1.0,.24],keeper);
}
function updateCamera(dt){
 if(inspecting||!camera||pointerDown||game.phase==='paused'||game.phase==='upgrade')return;const k=1-Math.exp(-dt*3.2);
 const flying=physics?.items.filter(r=>!r.done&&r.age>.08).at(-1);
 camWant.copy(camBase.pos);lookWant.copy(camBase.look);let fov=camBase.fov;
 if(followEnabled&&flying&&game.phase==='playing'){const p=flying.body.translation();const strength=boardPortrait?.035:.065;lookWant.lerp(tmp.set(p.x,Math.min(Math.max(p.y,1),4),p.z),strength);camWant.x+=p.x*.035;camWant.z-=Math.min(.55,flying.age*.25);fov=camBase.fov-.6;}
 camera.position.lerp(camWant,k);camLook.lerp(lookWant,k);camera.fov+=(fov-camera.fov)*k;
 if(camShake>0){camShake=Math.max(0,camShake-dt);camera.position.x+=Math.sin(performance.now()*.09)*camShake*.25;camera.position.y+=Math.cos(performance.now()*.11)*camShake*.18;}
 camera.lookAt(camLook);camera.updateProjectionMatrix();
}
function updateStar(dt){
 if(!game.level.star||game.mode==='practice'){if(starMesh)starMesh.visible=false;return;}
 if(!starMesh){starMesh=new THREE.Group();const m=new THREE.MeshBasicMaterial({color:0xffe27a,transparent:true,opacity:.85,depthWrite:false,blending:THREE.AdditiveBlending});const ring=new THREE.Mesh(new THREE.TorusGeometry(.75,.05,8,48),m);ring.rotation.x=-Math.PI/2;starMesh.add(ring);const beam=new THREE.Mesh(new THREE.CylinderGeometry(.62,.75,2.6,32,1,true),new THREE.MeshBasicMaterial({color:0xffc84a,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));beam.position.y=1.3;starMesh.add(beam);scene.add(starMesh);}
 starTimer-=dt;const open=characters.filter(c=>!game.collected.has(c.id));
 if((starTimer<=0||!open.some(c=>c.id===game.star))&&open.length){const c=open[Math.floor(Math.random()*open.length)];game.star=c.id;starTimer=7;toast(`福星落在「${c.label}」上 · 套中三倍分`);tone(880,.12,'triangle',.3);}
 const c=characters.find(c=>c.id===game.star);starMesh.visible=!!c;if(c){starMesh.position.set(c.currentX,c.position[1]+.03,c.position[2]);starMesh.rotation.y+=dt*1.6;starMesh.children[0].scale.setScalar(1+Math.sin(performance.now()*.008)*.06);}
}
function renderLevels(){const box=$('level-select');box.replaceChildren();LEVELS.forEach(level=>{const button=document.createElement('button');button.className='level-card'+(level.id===currentLevel?' active':'');button.disabled=level.id>=unlocked;button.setAttribute('aria-pressed',String(level.id===currentLevel));button.innerHTML=`<b>${level.short}</b><span>${level.name.split(' · ')[1]}</span><small>${level.id>=unlocked?'通关后解锁':`${level.duration}秒 · ${level.rings}圈`}</small>${level.id>=unlocked?'<svg class="icon" aria-hidden="true"><use href="#icon-lock"/></svg>':''}`;button.onclick=()=>{currentLevel=level.id;renderLevels();};box.append(button);});$('level-description').textContent=LEVELS[currentLevel].desc;}
function prepareStand(character){
 const stand=character.stand;if(!stand)return;
 const bounds=new THREE.Box3().setFromObject(stand),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 const holder=new THREE.Group();holder.name='responsive_stand_'+character.id;sceneRoot.add(holder);holder.attach(stand);
 stand.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));
 character.stand=holder;character.standSourceSize=size;
}
function compactStall(asset){
 for(const name of ['stage_and_paving','foreground_timber_fence','left_timber_fence','right_timber_fence','keeper_furniture']){const group=asset.getObjectByName(name);if(group)group.scale.x*=.78;}
 for(const name of ['timber_pavilion_and_canopy','embroidered_fabric_backdrop','warm_incandescent_string']){const group=asset.getObjectByName(name);if(group){group.scale.x*=.78;group.scale.y*=.76;}}
 const sign=asset.getObjectByName('carved_three_dimensional_sign');if(sign){sign.scale.multiplyScalar(.78);sign.position.add(new THREE.Vector3(0,-.65,-1.1));}
 const market=asset.getObjectByName('surrounding_night_market');if(market){market.scale.x*=.8;market.scale.y*=.85;}
 asset.traverse(object=>{if(/^(main_lantern_|inner_lantern_)/.test(object.name)&&object.isGroup){object.scale.multiplyScalar(.78);object.position.z-=.8;}if(object.name.startsWith('glow_anchor_bulb_')){object.position.x*=.78;object.position.y*=.76;}else if(object.name.startsWith('glow_anchor_')){object.position.multiplyScalar(.78);object.position.z-=.8;}});
}
function arrangeBoard(portrait){
 const previous=new Map(characters.map(character=>[character.id,[...character.position]]));
 arrangeCharacters(characters,portrait);boardPortrait=portrait;pendingPortrait=null;
 for(const character of characters){
  character.root.position.fromArray(character.position);character.originalPosition.copy(character.root.position);character.currentX=character.position[0];
  if(character.stand){const size=character.standSourceSize;character.stand.scale.set(character.stoolSize[0]/size.x,(character.position[1]-.24)/size.y,character.stoolSize[2]/size.z);character.stand.position.set(character.position[0],.24,character.position[2]);character.standBaseX=character.position[0];}
 }
 physics?.relayout(previous);
 layout.bounds={x:portrait?4.55:7.1,nearZ:3,farZ:-5.9};
 $('game').dataset.board=portrait?'portrait':'landscape';
 if(characters.length)aim.fromArray(characters[1].position);
 fitCamera();
}
function fitCamera(){
 if(!camera||!characters.length)return;
 const bounds=new THREE.Box3();
 for(const character of characters){const [x,y,z]=character.position;bounds.expandByPoint(new THREE.Vector3(x-1.5,.24,z-1.1));bounds.expandByPoint(new THREE.Vector3(x+1.5,y+character.height*character.dollScale+.35,z+1.45));}
 const center=bounds.getCenter(new THREE.Vector3());center.y-=.15;
 const direction=new THREE.Vector3(0,boardPortrait?1.05:.48,1).normalize();
 camera.position.copy(center).add(direction);camera.lookAt(center);camera.updateMatrixWorld();
 const rotation=camera.quaternion.clone().invert(),tangent=Math.tan(THREE.MathUtils.degToRad(46)/2);let distance=0;
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const corner=new THREE.Vector3(x,y,z).sub(center).applyQuaternion(rotation);distance=Math.max(distance,corner.z+Math.abs(corner.x)/(tangent*camera.aspect*.9),corner.z+Math.abs(corner.y)/(tangent*.76));}
 if(!boardPortrait){const signTop=new THREE.Vector3(0,5.6,-5.2).sub(center).applyQuaternion(rotation);distance=Math.max(distance,signTop.z+signTop.y/(tangent*.95));}
 camBase.pos.copy(center).addScaledVector(direction,distance);camBase.look.copy(center);camBase.fov=46;
 camera.position.copy(camBase.pos);camLook.copy(center);camera.lookAt(center);camera.fov=camBase.fov;camera.updateProjectionMatrix();camera.updateMatrixWorld();
 if(controls){controls.target.copy(center);controls.maxDistance=Math.max(42,distance*2);controls.update();controls.saveState();}
}
function resize(){
 if(!renderer)return;const w=$('viewport').clientWidth,h=$('viewport').clientHeight;
 if(!w||!h)return;const sizeChanged=w!==viewportWidth||h!==viewportHeight;viewportWidth=w;viewportHeight=h;
 renderer.setSize(w,h);renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
 camera.aspect=w/h;camera.updateProjectionMatrix();
 if(sizeChanged)clearDrag();
 if(!characters.length)return;
 const portrait=matchMedia('(orientation: portrait)').matches;
 if(boardPortrait!==portrait){if(physics?.live){pendingPortrait=portrait;}else arrangeBoard(portrait);}
 else pendingPortrait=null;
 if(!inspecting&&sizeChanged)fitCamera();
}
function targetProjection(c,offset=.5){return new THREE.Vector3(c.currentX??c.position[0],c.position[1]+offset,c.position[2]).project(camera);}
function screenAim(clientX,clientY){
 if(inspecting)return aim;
 const rect=$('viewport').getBoundingClientRect();mouse.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);ray.setFromCamera(mouse,camera);
 let nearest=null,dist=Infinity;
 for(const c of characters){const p=targetProjection(c,.45),dx=(p.x-mouse.x)*rect.width/2,dy=(p.y-mouse.y)*rect.height/2;const d=Math.hypot(dx,dy);if(d<dist){dist=d;nearest=c;}}
 // A single horizontal plane per stool row; no screen-space "hit" checks.
 const y=nearest?nearest.position[1]:.65;plane.constant=-y;ray.ray.intersectPlane(plane,tmp);
 aim.set(THREE.MathUtils.clamp(tmp.x,-layout.bounds.x,layout.bounds.x),y,THREE.MathUtils.clamp(tmp.z,layout.bounds.farZ,layout.bounds.nearZ));
 // Pointing at a character's face chooses its footing; dragging still adjusts it.
 if(nearest&&dist<Math.max(24,Math.min(36,rect.width*.025))){aim.set(nearest.currentX??nearest.position[0],y,nearest.position[2]);}
 return aim;
}
function aimVisual(){
 const visible=ready&&!inspecting&&game.phase==='playing'&&!gestures.active;arc.visible=visible;marker.visible=visible;markerDot.visible=visible;
 show('aim-label',visible);if(!visible)return;
 const solution=physics.solution(aim,mode),attr=arc.geometry.attributes.position;
 for(let i=0;i<48;i++){const t=i/47*solution.t;attr.setXYZ(i,solution.start.x+solution.velocity.x*t+.5*currentWind*t*t,solution.start.y+solution.velocity.y*t-.5*SETTINGS.gravity*t*t,solution.start.z+solution.velocity.z*t);}
 attr.needsUpdate=true;arc.computeLineDistances();marker.position.set(aim.x,aim.y+.025,aim.z);markerDot.position.set(aim.x,aim.y+.03,aim.z);
 const s=(game.perks.has('wide')?1.12:1)*SETTINGS.radius/.6;marker.scale.set(s,s,s);marker.material.color.setHex(game.goldReady?0xfff58e:0xffd16f);
 const p=aim.clone().add(new THREE.Vector3(0,.12,0)).project(camera);const rect=$('viewport').getBoundingClientRect();$('aim-label').style.left=`${(p.x+1)/2*rect.width}px`;$('aim-label').style.top=`${(1-p.y)/2*rect.height}px`;
 $('aim-label').textContent=`${mode==='high'?'高抛':'低抛'}落点${currentWind?' · 有侧风':''}`;
}
function setMode(next){mode=next;$('high').classList.toggle('active',mode==='high');$('low').classList.toggle('active',mode==='low');$('high').setAttribute('aria-pressed',String(mode==='high'));$('low').setAttribute('aria-pressed',String(mode==='low'));}
function releaseThrow(){
 if(!pointerDown)return;pointerDown=null;show('drag-power',false);
 const token=game.consume(physics.live);if(!token){if(physics.live>=SETTINGS.maxLive)toast('场上圈太多，等一圈落定再投');return;}
 physics.launch(aim,mode,token);soundscape.effect('throw',{volume:.8,rate:mode==='high'?1:1.15});syncHud();
}
function clearDrag(){pointerDown=null;show('drag-power',false);}
function releaseGestureThrow(launch){
 if(!ready||inspecting||document.hidden)return false;
 const token=game.consume(physics.live);if(!token)return false;
 lastGestureRing=physics.launchGesture(launch,token);lastGestureStats=physics.telemetry(lastGestureRing);soundscape.effect('throw',{volume:.8});syncHud();return true;
}
function updateGestureDisplay(now){
 gestures.setPhase(game.phase);gestures.watchdog(now);
 const radius=SETTINGS.radius*(game.perks.has('wide')?1.12:1)*(game.goldReady?1.18:1);
 gestureView.update(gestureFrame,{visible:gestures.active&&!inspecting&&game.phase==='playing',radius,wind:currentWind});
 if(!gestures.active||now-lastGestureUI<100)return;lastGestureUI=now;
 if(lastGestureRing)lastGestureStats=physics.telemetry(lastGestureRing)??lastGestureStats;
 const stats=lastGestureStats;if(!stats)return;
 $('gesture-speed').textContent=stats.speed.toFixed(2)+' m/s';$('gesture-height').textContent=stats.height.toFixed(2)+' m';$('gesture-kinetic').textContent=stats.kinetic.toFixed(2)+' J';$('gesture-potential').textContent=stats.potential.toFixed(2)+' J';
}
function bindInput(){
 const canvas=renderer.domElement;
 canvas.addEventListener('pointerdown',e=>{
  if(gestures.active||inspecting||e.button!==0||!ready||game.phase!=='playing')return;ensureAudio();screenAim(e.clientX,e.clientY);
  if(!game.canThrow(physics.live)){toast(game.cooldown>0?'稍等一下，马上可以再投':'等场上的圈落定');return;}
  pointerDown={id:e.pointerId,x:e.clientX,y:e.clientY,aim:aim.clone()};canvas.setPointerCapture(e.pointerId);show('drag-power',true);
 });
 canvas.addEventListener('pointermove',e=>{
  if(gestures.active||inspecting||!ready||game.phase!=='playing')return;
  if(pointerDown&&pointerDown.id===e.pointerId){
   const rect=canvas.getBoundingClientRect(),dx=(e.clientX-pointerDown.x)/rect.width*10,dy=(e.clientY-pointerDown.y)/rect.height;
   aim.copy(pointerDown.aim);aim.x=THREE.MathUtils.clamp(aim.x+dx,-layout.bounds.x,layout.bounds.x);aim.z=THREE.MathUtils.clamp(aim.z-dy*5.5,layout.bounds.farZ,layout.bounds.nearZ);
   const row=characters.reduce((a,c)=>Math.abs(c.position[2]-aim.z)<Math.abs(a.position[2]-aim.z)?c:a);aim.y=row.position[1];
   $('drag-power').querySelector('i').style.width=`${THREE.MathUtils.clamp(50+dy*160,8,100)}%`;
  }else if(e.pointerType==='mouse')screenAim(e.clientX,e.clientY);
 });
 canvas.addEventListener('pointerup',e=>{if(pointerDown?.id===e.pointerId){releaseThrow();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}});
 canvas.addEventListener('pointercancel',clearDrag);canvas.addEventListener('lostpointercapture',clearDrag);
 window.addEventListener('keydown',e=>{
  if(e.repeat)return;
  if(e.code==='Tab'&&!$('modal').classList.contains('hidden')){const buttons=[...$('modal').querySelectorAll('button:not(:disabled),a')],first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;}
  if(inspecting){if(e.code==='Escape')toggleInspection();return;}
  if(e.code==='Escape'||e.code==='KeyP'){e.preventDefault();if($('help-close'))$('help-close').click();else togglePause();return;}
  if(e.target.closest('button,a,input,select,textarea,[contenteditable="true"]')||gestures.active)return;
  if(e.code==='Digit1')setMode('high');if(e.code==='Digit2')setMode('low');
  if(e.code==='Space'&&game.phase==='playing'&&!gestures.active){e.preventDefault();ensureAudio();pointerDown={id:-1};releaseThrow();}
  if(e.code==='ArrowLeft'){aim.x=Math.max(-layout.bounds.x,aim.x-.16);e.preventDefault();}if(e.code==='ArrowRight'){aim.x=Math.min(layout.bounds.x,aim.x+.16);e.preventDefault();}
  if(e.code==='ArrowUp'){aim.z=Math.max(layout.bounds.farZ,aim.z-.18);e.preventDefault();}if(e.code==='ArrowDown'){aim.z=Math.min(layout.bounds.nearZ,aim.z+.18);e.preventDefault();}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&game.phase==='playing')pauseGame();last=performance.now();acc=0;clearDrag();});
 window.addEventListener('blur',()=>{clearDrag();if(game.phase==='playing')pauseGame();});
}
function onHit(c,ring){
 const result=game.hit(c.id,ring.gold);if(!result)return false;
 if(game.mode!=='practice'&&game.time<=15&&['monkey','rooster','dog','pig'].includes(c.id)){game.score+=120;result.points+=120;result.effect='收摊移动靶 +120分';}
 c.flash=1;confetti(new THREE.Vector3(c.currentX??c.position[0],c.position[1]+.7,c.position[2]),ring.gold?0xffee93:0xffc95b);
 call(`${c.label}到福到！ +${result.points}`,result.effect||(game.combo>=2?`${game.combo}连中，围观叫好！`:'圈已落定，稳稳套中'));
 hitSound();if(navigator.vibrate)navigator.vibrate(25);
 camShake=.25;if(game.collected.size===game.level.required)toast('已经通关！继续挑战十二生肖全收集');
 syncHud();syncPhase();return true;
}
function onMiss(r){if(game.phase!=='playing')return false;game.miss();if(game.misses%3===0)toast(game.perks.has('rescue')?'空圈回响：返还1圈':'别急，对准脚下再投一次');syncHud();return true;}
function onBounce(r){
 if(performance.now()-lastSound>85){soundscape.effect('bounce',{volume:.6,rate:1+Math.min(r.bounces,5)*.05});lastSound=performance.now();}
 if(r.bounces===1){const p=r.body.translation();const near=characters.some(c=>Math.hypot((c.currentX??c.position[0])-p.x,c.position[2]-p.z)<.85&&p.y>c.position[1]+.4);if(near&&game.combo>=2)slow=.22;}
}
function windUpdate(){
 const t=game.elapsed%23,old=windPhase;
 windPhase=game.mode==='practice'||!game.level.wind||game.elapsed<12?'off':t>14&&t<16?'warning':t>=16&&t<21?'active':'off';
 if(game.silence>0)windPhase='silenced';
 currentWind=windPhase==='active'?(Math.floor(game.elapsed/23)%2===0?1:-1)*.72*game.level.wind*(game.perks.has('calm')?.35:1):0;
 if(windPhase==='warning'&&old!=='warning'){toast('老板伸手开风扇了！注意看风向');tone(392,.13,'triangle',.3);}
 const closing=game.mode!=='practice'&&game.time<=15;
 if(closing&&!closingAnnounced){closingAnnounced=true;call('收摊抢投！','后排奖品开始移动 · 移动靶额外加分');tone(130,.25,'triangle',.55);}
 const text=windPhase==='warning'?'风扇即将开启 · 看准再投':windPhase==='active'?`侧风 ${currentWind>0?'→':'←'} · ${game.perks.has('calm')?'定风如意生效':'高抛更容易受风影响'}`:windPhase==='silenced'?`定风生效 · ${Math.ceil(game.silence)}秒`:closing?'最后15秒 · 后排移动抢投':'';
 $('weather').textContent=text;show('weather',!!text&&game.phase==='playing');$('weather').classList.toggle('warn',windPhase==='warning'||closing);
 if(fan){fan.visible=windPhase==='warning'||windPhase==='active';fan.rotation.y=Math.sin(game.elapsed*.7)*.32;if(windPhase==='active')fanBlades.rotation.z+=.7;keeperArm.rotation.z=windPhase==='warning'?-.95:-.3;}
 return closing;
}
function syncHud(){
 soundscape.setState(game.phase);
 gestures.setPhase(game.phase);
 $('game').dataset.phase=game.phase;
 $('score').textContent=game.score.toLocaleString('zh-CN');$('rings').textContent=game.mode==='practice'?'∞':game.goldReady?'金圈':game.rings;
 const t=Math.ceil(game.time);$('timer').textContent=game.mode==='practice'?'练习':`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
 $('timer').parentElement.classList.toggle('urgent',game.mode!=='practice'&&game.time<=15);
 $('collected').textContent=`${game.collected.size} / 12`;$('goal').textContent=game.mode==='practice'?'不限时 · 不限圈 · 无侧风':game.collected.size>=game.level.required?'已通关 · 挑战十二生肖全收集':'套齐 '+game.level.required+' 种生肖即可通关';
 for(const id of ZODIAC)$('badge-'+id).classList.toggle('got',game.collected.has(id));
 $('noise').style.width=`${game.noise}%`;$('crowd-text').textContent=game.noise>65?'全场喝彩':game.noise>30?'围观渐多':'好戏开场';
 $('combo').replaceChildren();if(game.combo>=2){$('combo').append(`${game.combo} 连中`);const s=document.createElement('small');s.textContent='好手气 · 别停';$('combo').append(s);}
 show('fever',game.fever>0&&game.phase==='playing');$('fever').querySelector('span').textContent=`免耗圈 · ${Math.ceil(game.fever)}秒`;
 show('gold',game.rings===5&&!game.betUsed&&game.fever<=0&&game.mode!=='practice'&&game.phase==='playing');
 $('perk-list').textContent=[...game.perks].map(id=>UPGRADES.find(p=>p.id===id).name).join(' · ');
 $('pause').querySelector('use').setAttribute('href',game.phase==='paused'?'#icon-play':'#icon-pause');$('pause').setAttribute('aria-label',game.phase==='paused'?'继续游戏':'暂停游戏');
}
function syncTargetPositions(){for(const t of physics.targetBodies){t.c.currentX=t.x;t.c.root.position.x=t.x;if(t.c.stand)t.c.stand.position.x=t.c.standBaseX+t.x-t.c.position[0];}}
function startGame(practice=false,level=currentLevel){
 gestures.cancelHold();lastGestureRing=null;lastGestureStats=null;
 if(!ready)return;currentLevel=practice?0:level;ensureAudio();clearDrag();game.reset(practice?'practice':'challenge',currentLevel);physics.motion=game.level.motion;physics.reset();starTimer=0;if(starMesh)starMesh.visible=false;$('level-name').textContent=practice?'练习场 · 不限圈':game.level.name;
 for(const c of characters){c.root.position.copy(c.originalPosition);c.root.scale.setScalar(1);c.currentX=c.position[0];c.flash=0;if(c.stand)c.stand.position.x=c.standBaseX;}
 for(const e of effects){scene.remove(e.mesh);e.mesh.geometry.dispose();e.mesh.material.dispose();}effects.length=0;
 sim=0;acc=0;last=performance.now();slow=0;windPhase='off';currentWind=0;closingAnnounced=false;previousPhase='playing';
 show('panel',false);show('modal',false);show('weather',false);setMode('high');aim.fromArray(characters[1].position);if(fan)fan.visible=false;syncHud();call(practice?'先练练手':game.level.name,practice?'不限时间与圈数，放心试投':`${game.level.desc} · 套齐${game.level.required}种过关`);
 tone(523,.16,'triangle',.4);tone(784,.25,'triangle',.4,.13);
}
function pauseGame(){if(game.phase!=='playing')return;clearDrag();game.phase='paused';acc=0;renderPause();syncHud();}
function resumeGame(){if(game.phase!=='paused')return;game.phase='playing';show('modal',false);acc=0;last=performance.now();syncHud();renderer.domElement.focus({preventScroll:true});}
function togglePause(){if(!ready)return;if(game.phase==='playing')pauseGame();else if(game.phase==='paused')resumeGame();}
function modalHTML(html){modalFocus=document.activeElement;$('modal-content').innerHTML=html;const heading=$('modal-content').querySelector('h2');if(heading)heading.id='modal-title';show('modal',true);$('modal-content').querySelector('button')?.focus({preventScroll:true});}
function renderPause(){
 modalHTML('<span class="eyebrow">灯火还在 · 不必着急</span><h2>歇一歇，再套个好彩头</h2><p>计时、风力和场上的圈都已暂停。</p><div class="actions"><button class="primary" id="resume">继续游戏</button><button class="secondary" id="restart">重新开局</button><button class="secondary" id="back-menu">返回选关</button></div>');
 $('resume').onclick=resumeGame;$('restart').onclick=()=>startGame(game.mode==='practice',currentLevel);$('back-menu').onclick=returnToMenu;
}
function returnToMenu(){clearDrag();physics.reset();game.reset();game.phase='ready';previousPhase='ready';show('modal',false);show('panel',true);show('weather',false);$('callout').style.opacity='0';callUntil=0;if(starMesh)starMesh.visible=false;arrangeBoard(matchMedia('(orientation: portrait)').matches);renderLevels();syncHud();resize();}
function showHelp(){
 const previous=game.phase;if(previous==='upgrade'||previous==='result')return;if(previous==='playing'){clearDrag();game.phase='paused';}
 modalHTML('<span class="eyebrow">摊位玩法</span><h2>套圈也有门道</h2><div class="help-grid"><p><b>瞄准与出手</b><br>点选玩偶，按住拖动微调落点，松手投圈。键盘方向键调整，空格出手。</p><p><b>高抛 / 低抛</b><br>高抛越过前排，受风更明显；低抛速度快，留意前排遮挡。数字1、2切换。</p><p><b>套中才算</b><br>圈包围玩偶底部并稳定落定才计分。擦边、碰头不算命中。</p><p><b>三关集福</b><br>新手关和第一关收集8种过关，第二关收集9种过关。先集4种选强化，达到通关数量再选一次。</p><p><b>生肖好彩头</b><br>鼠兔猴返圈；虎蛇狗定风；龙马鸡涨声浪；牛羊猪额外加分。首次集齐对应生肖时触发。</p><p><b>热场与福星</b><br>声浪满后短时免耗圈，剩5圈可换大金圈。第二关金光福星轮换，套中三倍分。</p><p><b>横屏竖屏都能玩</b><br>横屏四列三排，竖屏三列四排。转屏时保留这一圈，落定后重排。跟圈镜头可随时关闭。</p><p><b>暂停与选关</b><br>Esc / P 暂停，切到后台也会暂停。暂停页可重开或返回选关；练习场不限时间与圈数。</p></div><div class="actions"><button id="help-close" class="primary">知道了</button></div>');
 $('help-close').onclick=()=>{show('modal',false);if(previous==='playing'){game.phase='playing';last=performance.now();acc=0;}else if(previous==='paused')renderPause();};
}
function syncPhase(){
 if(game.phase==='upgrade'&&previousPhase!=='upgrade'){
  clearDrag();modalHTML(`<span class="eyebrow">已集福 ${game.collected.size} 种 · 计时已暂停</span><h2>挑一个好彩头</h2><p>本局生效。选好后，接着把福气套回来。</p><div class="upgrade-cards">${game.choices.map(p=>`<button class="upgrade-card" data-perk="${p.id}"><i>${p.icon}</i><b>${p.name}</b><small>${p.detail}</small></button>`).join('')}</div>`);
  document.querySelectorAll('[data-perk]').forEach(b=>b.onclick=()=>{if(game.choose(b.dataset.perk)){show('modal',false);last=performance.now();acc=0;syncHud();previousPhase='playing';toast('好彩头已生效');}});
 }
 if(game.phase==='result'&&previousPhase!=='result'){
  clearDrag();best=Math.max(best,game.score);try{localStorage.setItem('hi3d-ring-fair-best-v1',String(best));}catch{}
  const success=game.collected.size>=game.level.required&&game.mode!=='practice';if(success&&currentLevel<2){unlocked=Math.max(unlocked,currentLevel+2);try{localStorage.setItem('hi3d-ring-fair-unlocked',String(unlocked));}catch{}}renderLevels();
  modalHTML(`<span class="eyebrow">${game.level.name}</span><h2>${game.collected.size===12?'十二齐聚 · 满堂彩':success?'八方来福 · 挑战通关':'好戏未尽 · 再来一局'}</h2><div class="result-number">${game.score.toLocaleString('zh-CN')}</div><p>${game.endReason==='time'?'收摊时间到':game.endReason==='complete'?'十二生肖全收集':'圈已投完'} · 最高纪录 ${best.toLocaleString('zh-CN')}</p><div class="result-grid"><span>生肖收集<b>${game.collected.size} / 12</b></span><span>最高连中<b>${game.maxCombo}</b></span><span>命中圈数<b>${game.hits} / ${game.shots}</b></span></div><div class="actions">${success&&currentLevel<2?'<button class="primary" id="next-level">闯下一关</button>':''}<button class="${success&&currentLevel<2?'secondary':'primary'}" id="again">再来本关</button><button class="secondary" id="result-practice">练练手</button></div>`);
  $('again').onclick=()=>startGame(false,currentLevel);if($('next-level'))$('next-level').onclick=()=>startGame(false,currentLevel+1);$('result-practice').onclick=()=>startGame(true);
 }
 previousPhase=game.phase;
}
function frame(now){
 soundscape.setState(game.phase);
 updateGestureDisplay(now);
 requestAnimationFrame(frame);if(!ready)return;if(controls&&inspecting)controls.update();
 let dt=Math.min((now-last)/1000,.08);last=now;
 if(game.phase==='playing'){
  const closing=windUpdate();if(slow>0){slow-=dt;dt*=.45;}
  acc+=dt;let loops=0;
  while(acc>=SETTINGS.step&&loops++<9&&game.phase==='playing'){
   sim+=SETTINGS.step;game.tick(SETTINGS.step,physics.live);
   if(game.phase==='playing')physics.step(SETTINGS.step,currentWind,game.elapsed,closing);
   acc-=SETTINGS.step;
  }
  syncTargetPositions();updateStar(dt);
  syncHud();syncPhase();
 }else acc=0;
 if(pendingPortrait!==null&&physics.live===0&&!inspecting)arrangeBoard(pendingPortrait);
 for(const c of characters){if(c.flash>0&&game.phase==='playing'){c.flash=Math.max(0,c.flash-dt*2);c.root.scale.setScalar(1+Math.sin(c.flash*Math.PI)*.08);}}
 for(let i=effects.length-1;i>=0;i--){const e=effects[i];if(game.phase!=='playing')continue;e.age+=dt;const p=e.mesh.geometry.attributes.position;for(let j=0;j<e.vel.length;j++){const v=e.vel[j];v.y-=dt*3;p.setXYZ(j,p.getX(j)+v.x*dt,p.getY(j)+v.y*dt,p.getZ(j)+v.z*dt);}p.needsUpdate=true;e.mesh.material.opacity=Math.max(0,1-e.age/.9);if(e.age>.9){scene.remove(e.mesh);e.mesh.geometry.dispose();e.mesh.material.dispose();effects.splice(i,1);}}
 updateCamera(dt);aimVisual();if(now>toastUntil)$('toast').style.opacity='0';if(now>callUntil)$('callout').style.opacity='0';renderer.render(scene,camera);
}
async function loadCharacter(c){
 if(!c.model)return;
 try{
  const url=new URL(c.model,location.href);if(url.origin!==location.origin)throw Error('角色必须使用随包提供的本地资源');
  const asset=await loadGLB(url.href);const visual=asset.scene;visual.name=`asset_${c.id}`;visual.scale.setScalar((c.scale??1)*c.dollScale);visual.rotation.y=c.rotationY??0;visual.position.fromArray((c.offset??[0,0,0]).map(v=>v*c.dollScale));
  // Validate before hiding the placeholder. Original GLB is preserved.
  visual.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(visual);if(bounds.isEmpty())throw Error('角色模型没有可显示网格');
  visual.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;}});
  for(const child of [...c.root.children])child.visible=false;c.root.add(visual);externalLoads++;
  const shadowMat=new THREE.MeshStandardMaterial({colorWrite:false,depthWrite:false});
  for(const p of c.proxySpheres??[]){const caster=new THREE.Mesh(new THREE.SphereGeometry(p.radius*c.dollScale,12,8),shadowMat);caster.position.fromArray(p.center.map(value=>value*c.dollScale));caster.castShadow=true;caster.name='shadow_proxy_'+c.id;c.root.add(caster);}
 }catch(e){assetFailures.push(`${c.label}模型加载失败，保留占位角色`);console.warn('Character fallback:',c.id,e.message);}
}
async function boot(){
 try{
  const getJSON=async path=>{const r=await fetch(path);if(!r.ok)throw Error('配置读取失败：'+path);return r.json();};
  layout=await getJSON('./hi3d-scene-layout.json');
  renderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'high-performance'});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.setClearColor(0x21170e,1);scene.background=new THREE.Color(0x21170e);scene.fog=new THREE.FogExp2(0x2b1d10,.013);$('viewport').appendChild(renderer.domElement);
  renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','套圈场地：点击玩偶投圈，方向键调整落点，空格投掷');renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(game.phase==='playing')pauseGame();toast('图形上下文中断，请刷新恢复；场景仍可下载');});
  camera=new THREE.PerspectiveCamera(layout.camera.fov,16/9,.1,150);camera.position.fromArray(layout.camera.position);camera.lookAt(...layout.camera.lookAt);resize();camera.updateMatrixWorld();controls=new OrbitControls(camera,renderer.domElement);controls.target.fromArray(layout.camera.lookAt);controls.enablePan=false;controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=10;controls.maxDistance=42;controls.minPolarAngle=.35;controls.maxPolarAngle=1.48;controls.enabled=false;controls.update();controls.saveState();camBase.pos.copy(camera.position);camBase.look.fromArray(layout.camera.lookAt);camBase.fov=layout.camera.fov;camLook.copy(camBase.look);
  scene.add(new THREE.HemisphereLight(0xffeed6,0x9a482d,1.35));
  const key=new THREE.DirectionalLight(0xffdcaf,2.5);key.position.set(-3,9,7);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-12,right:12,top:13,bottom:-10,near:1,far:40});key.shadow.normalBias=.025;key.shadow.bias=-.0002;key.shadow.radius=4;scene.add(key);
  const fill=new THREE.DirectionalLight(0xffa354,.75);fill.position.set(7,5,-4);scene.add(fill);
  for(const x of [-9.5,9.5]){const l=new THREE.PointLight(0xff8b32,6,10,2);l.position.set(x,4.8,-3.2);scene.add(l);}
  const [asset,manifest,environment]=await Promise.all([loadGLB(layout.geometry),getJSON('./hi3d-characters-v3.json'),new THREE.TextureLoader().loadAsync(layout.environment),initPhysics()]);
  environment.mapping=THREE.EquirectangularReflectionMapping;environment.colorSpace=THREE.SRGBColorSpace;const pmrem=new THREE.PMREMGenerator(renderer);environmentTarget=pmrem.fromEquirectangular(environment);scene.environment=environmentTarget.texture;scene.environmentIntensity=.65;environment.dispose();pmrem.dispose();
  sceneRoot.add(asset.scene);asset.scene.traverse(o=>{
   if(o.name.startsWith('matte_'))o.visible=false;
   if(o.isMesh){o.castShadow=true;o.receiveShadow=true;let ancestor=o;while(ancestor){if(/^(main_lantern_|inner_lantern_)/.test(ancestor.name)){o.castShadow=false;o.receiveShadow=false;break;}ancestor=ancestor.parent;}}
   if(o.name==='shadow_receiver'){o.material=new THREE.ShadowMaterial({opacity:.24});o.castShadow=false;}
  });
  compactStall(asset.scene);
  if(!Array.isArray(manifest.characters)||manifest.characters.length!==12)throw Error('需要12个生肖配置');
  const seen=new Set();characters=configureCharacters(manifest.characters);
  for(const c of characters){
   if(!ZODIAC.includes(c.id)||seen.has(c.id)||!c.position?.every(Number.isFinite))throw Error('生肖配置ID或位置无效');seen.add(c.id);
   c.root=asset.scene.getObjectByName('target_'+c.id);if(!c.root)throw Error(`场景缺少${c.id}占位节点`);
   c.originalPosition=c.root.position.clone();c.stand=asset.scene.getObjectByName('stand_'+c.id);c.standBaseX=c.stand?.position.x??0;c.currentX=c.position[0];c.flash=0;prepareStand(c);
  }
  arrangeBoard(matchMedia('(orientation: portrait)').matches);
  for(let i=0;i<characters.length;i+=2){$('load-detail').textContent=`加载生肖模型 ${i+1}—${Math.min(i+2,12)} / 12`;await Promise.all(characters.slice(i,i+2).map(loadCharacter));}
  if(assetFailures.length)throw Error(assetFailures.join('；'));
  addLampGlows();
  if(assetFailures.length){$('asset-warning').textContent=assetFailures.join('；');show('asset-warning',true);}
  physics=new FairPhysics(scene,characters,onHit,onMiss,onBounce);addLocalProps();
  ZODIAC.forEach((id,i)=>{const badge=document.createElement('span');badge.id='badge-'+id;badge.textContent=LABELS[i];badge.title=LABELS[i];$('zodiac').append(badge);});
  bindInput();ready=true;$('start').disabled=false;$('practice').disabled=false;$('start').querySelector('span').textContent='开始游戏';renderLevels();show('loading',false);game.phase='ready';syncHud();new ResizeObserver(resize).observe($('viewport'));resize();
  // Read-only diagnostics and real launch controls, available only to explicit local tests.
  if(new URLSearchParams(location.search).has('test'))window.__fair={
   state:()=>({...game.snapshot(),live:physics.live,wind:currentWind,ringStates:physics.items.map(r=>({done:r.done,age:r.age,pos:r.body.translation(),candidate:r.candidate?.id,bounces:r.bounces})),renderer:renderer.info.render,externalLoads,inspecting,camera:camera.position.toArray()}),
   start:(mode,level=0)=>startGame(mode==='practice',level),aim:(id)=>{const c=characters.find(c=>c.id===id);aim.set(c.currentX,c.position[1],c.position[2]);},
   project:id=>{const c=characters.find(c=>c.id===id),p=targetProjection(c,.45),r=$('viewport').getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};},
   advance:seconds=>{for(let i=0;i<seconds/SETTINGS.step&&game.phase==='playing';i++){const closing=windUpdate();game.tick(SETTINGS.step,physics.live);if(game.phase==='playing')physics.step(SETTINGS.step,currentWind,game.elapsed,closing);}syncTargetPositions();syncHud();syncPhase();},
   choose:id=>{const result=game.choose(id);if(result){show('modal',false);previousPhase='playing';syncHud();}return result;},
   fire:()=>{pointerDown={id:-1};releaseThrow();},setMode,
   assets:()=>characters.map(c=>({id:c.id,position:c.root.position.toArray(),expected:c.position,stand:!!c.stand,model:c.model,height:c.height*c.dollScale,stool:new THREE.Box3().setFromObject(c.stand).getSize(new THREE.Vector3()).toArray(),loaded:!!c.root.getObjectByName('asset_'+c.id)})),
   layout:()=>({portrait:boardPortrait,pending:pendingPortrait,base:camBase.pos.toArray(),size:[viewportWidth,viewportHeight],positions:characters.map(c=>({id:c.id,position:c.position,projection:targetProjection(c,.45).toArray()}))}),
   inspectRing:()=>physics.items.map(r=>({meshRadius:r.radius,colliders:r.colliderHandles.length})),
   forceTimerForTest:t=>{game.time=t;},forceRingsForTest:n=>{game.rings=n;},
   scene:()=>({matteNodes:scene.getObjectsByProperty('visible',true).filter(o=>o.name.startsWith('matte_')).length,environmentMeshes:sceneRoot.getObjectsByProperty('isMesh',true).length,backgroundIsColor:scene.background?.isColor,models:characters.map(c=>({id:c.id,model:c.model,triangles:c.triangles}))}),
   inspect:toggleInspection,render:()=>renderer.render(scene,camera),audio:()=>soundscape.snapshot(),
   gesture:{state:()=>gestures.snapshot(),freezeInference:on=>{gestures.testInferencePaused=!!on;},feed:(landmarks,time)=>gestures.handleResults({poseLandmarks:landmarks},time),telemetry:()=>lastGestureRing?physics.telemetry(lastGestureRing):null,held:()=>({visible:gestureView.ring.visible&&gestureView.group.visible,position:gestureView.ring.position.toArray()}),launch:spec=>releaseGestureThrow(spec),step:seconds=>{for(let i=0;i<seconds/SETTINGS.step;i++)physics.step(SETTINGS.step,0,game.elapsed,false);return physics.telemetry(lastGestureRing);}}
  };
 }catch(e){$('load-detail').textContent=`加载失败：${e.message}。可重新加载，或下载场景。`;$('loading').querySelector('.loading-ring').style.animation='none';show('retry-load',true);console.error(e);}
}
function toggleInspection(){
 if(!ready)return;
 if(!inspecting){inspectionPrevious=game.phase;if(game.phase==='playing')pauseGame();show('modal',false);clearDrag();inspecting=true;controls.enabled=true;}
 else{inspecting=false;controls.enabled=false;fitCamera();if(inspectionPrevious==='playing')resumeGame();else if(inspectionPrevious==='paused')renderPause();}
 $('game').dataset.inspecting=String(inspecting);$('inspect-scene').querySelector('span').textContent=inspecting?'返回投圈':'环视摊位';show('scene-hint',inspecting);resize();
}
function addLampGlows(){
 const cv=document.createElement('canvas');cv.width=cv.height=64;const ctx=cv.getContext('2d'),g=ctx.createRadialGradient(32,32,1,32,32,32);g.addColorStop(0,'rgba(255,203,104,.5)');g.addColorStop(.25,'rgba(255,136,35,.15)');g.addColorStop(1,'rgba(255,93,9,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);const texture=new THREE.CanvasTexture(cv);
 const anchors=[];sceneRoot.traverse(o=>{if(o.name.startsWith('glow_anchor_'))anchors.push(o);});
 for(const a of anchors){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,color:0xffca7a,transparent:true,opacity:.65,depthWrite:false,blending:THREE.AdditiveBlending}));sprite.position.copy(a.getWorldPosition(new THREE.Vector3()));const size=a.userData.glowSize??.5;sprite.scale.set(size,size,1);scene.add(sprite);}
}
$('inspect-scene').onclick=toggleInspection;
$('start').onclick=()=>startGame(false);$('practice').onclick=()=>startGame(true);$('pause').onclick=togglePause;$('help').onclick=showHelp;
$('sound').onclick=()=>{soundOn=!soundOn;soundscape.setEnabled(soundOn);ensureAudio();$('sound').querySelector('use').setAttribute('href',soundOn?'#icon-music':'#icon-mute');$('sound').setAttribute('aria-label',soundOn?'关闭声音':'开启声音');toast(soundOn?'声音已开启 · 轻音乐与人群氛围':'声音已关闭');};
$('follow-camera').onclick=()=>{followEnabled=!followEnabled;syncFollowButton();};
function syncFollowButton(){$('follow-camera').textContent=`跟圈镜头 · ${followEnabled?'开':'关'}`;$('follow-camera').setAttribute('aria-pressed',String(followEnabled));}
syncFollowButton();
$('high').onclick=()=>setMode('high');$('low').onclick=()=>setMode('low');
$('gold').onclick=()=>{if(game.exchange()){toast('乾坤金圈：圈更大，命中三倍分；只有一次机会');syncHud();}};
$('retry-load').onclick=()=>location.reload();window.addEventListener('resize',resize);
requestAnimationFrame(frame);boot();
