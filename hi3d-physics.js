import * as THREE from 'three';
import RAPIER from './vendor/rapier.es.js';
import {SETTINGS} from './hi3d-rules.js';

export async function initPhysics(){await RAPIER.init();}
const V=new THREE.Vector3();
export class FairPhysics{
 constructor(scene,characters,onHit,onMiss,onBounce){this.scene=scene;this.characters=characters;this.onHit=onHit;this.onMiss=onMiss;this.onBounce=onBounce;this.items=[];this.sparks=[];this.reset();}
 reset(){
  for(const r of this.items){this.scene.remove(r.mesh);r.mesh.geometry.dispose();r.mesh.material.dispose();}
  this.items=[];if(this.world)this.world.free();if(this.events)this.events.free();
  this.world=new RAPIER.World({x:0,y:-SETTINGS.gravity,z:0});this.world.timestep=SETTINGS.step;
  this.world.integrationParameters.numSolverIterations=8;this.world.integrationParameters.maxCcdSubsteps=4;
  this.events=new RAPIER.EventQueue(true);this.targetBodies=[];
  this.world.createCollider(RAPIER.ColliderDesc.cuboid(20,.1,20).setTranslation(0,-.1,0).setFriction(.65));
  this.world.createCollider(RAPIER.ColliderDesc.cuboid(10.8,.13,5).setTranslation(0,.09,-1.6).setFriction(.65));
  this.world.createCollider(RAPIER.ColliderDesc.cuboid(10.8,3,.06).setTranslation(0,3.15,-6.45));
  for(const c of this.characters){
   const [x,y,z]=c.position,k=c.dollScale??1;
   const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x,y,z));
   const size=c.stoolSize??[1.8,.18,1.8];
   this.world.createCollider(RAPIER.ColliderDesc.cuboid(size[0]/2,size[1]/2,size[2]/2).setTranslation(0,-size[1]/2,0).setFriction(.55).setRestitution(.14),body);
   for(const proxy of c.proxySpheres??[{center:[0,.36,0],radius:c.bodyRadius},{center:[0,.77,0],radius:c.headRadius}])this.world.createCollider(RAPIER.ColliderDesc.ball(proxy.radius*k).setTranslation(...proxy.center.map(v=>v*k)).setFriction(.35).setRestitution(.12),body);
   this.world.createCollider(RAPIER.ColliderDesc.cylinder(.13,.14).setTranslation(0,.12,0).setFriction(.55),body);
   this.targetBodies.push({c,body,x});
  }
 }
 get live(){return this.items.filter(r=>!r.done).length;}
 relayout(previous){
  for(const target of this.targetBodies){target.x=target.c.position[0];const [x,y,z]=target.c.position;target.body.setTranslation({x,y,z},true);target.body.setNextKinematicTranslation({x,y,z});}
  for(const ring of this.items){if(!ring.anchor)continue;const target=this.targetBodies.find(target=>target.c.id===ring.anchor.id),old=previous.get(target.c.id);ring.anchor.y+=target.c.position[1]-old[1];ring.anchor.z+=target.c.position[2]-old[2];const position={x:target.x+ring.anchor.dx,y:ring.anchor.y,z:ring.anchor.z};ring.body.setTranslation(position,true);ring.body.setNextKinematicTranslation(position);this.syncOne(ring);}
 }
 solution(aim,mode='high'){
  const start=new THREE.Vector3(aim.x*.18,1.5,6.15);const end=new THREE.Vector3(aim.x,aim.y+.075,aim.z);
  const d=Math.hypot(end.x-start.x,end.z-start.z);const t=(mode==='high'?1.8+d*.070:1.04+d*.018);
  return {start,end,t,velocity:new THREE.Vector3((end.x-start.x)/t,(end.y-start.y)/t+.5*SETTINGS.gravity*t,(end.z-start.z)/t)};
 }
 launch(aim,mode,token){
  const sol=this.solution(aim,mode);const radius=token.radius;
  const mesh=new THREE.Mesh(new THREE.TorusGeometry(radius,SETTINGS.tube,8,56),new THREE.MeshStandardMaterial({color:token.gold?0xffd551:0xffae42,metalness:.65,roughness:.27,emissive:0xa33e02,emissiveIntensity:token.gold?.6:.15}));
  // Ring local XZ plane, with a real empty center in both mesh and compound collider.
  mesh.geometry.rotateX(-Math.PI/2);mesh.castShadow=true;mesh.receiveShadow=true;this.scene.add(mesh);
  const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...sol.start.toArray()).setLinearDamping(0).setAngularDamping(.8).setCcdEnabled(true).setCanSleep(true));
  const segments=24;let colliderHandles=[];
  for(let i=0;i<segments;i++){
   const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments;
   const p=new THREE.Vector3(Math.cos(a)*radius,0,Math.sin(a)*radius),q=new THREE.Vector3(Math.cos(b)*radius,0,Math.sin(b)*radius);
   const dir=q.clone().sub(p);const mid=p.clone().add(q).multiplyScalar(.5);
   const rot=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());
   const col=this.world.createCollider(RAPIER.ColliderDesc.capsule(p.distanceTo(q)/2,SETTINGS.tube).setTranslation(mid.x,mid.y,mid.z).setRotation(rot).setDensity(.35).setRestitution(mode==='high'?.16:.28).setFriction(.48).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),body);
   colliderHandles.push(col.handle);
  }
  const descent=new THREE.Vector3(-sol.velocity.x,SETTINGS.gravity*sol.t-sol.velocity.y,-sol.velocity.z).normalize();
  // A spun high throw stays horizontal until contact, matching the vertical target.
  // Low throws retain their inclined entry and more pronounced bounce.
  if(mode==='high')descent.set(0,1,0);
  const tilt=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),descent);
  body.setRotation(tilt,true);body.setLinvel(sol.velocity,true);body.setAngvel({x:descent.x*3,y:descent.y*3,z:descent.z*3},true);
  const r={body,mesh,radius,age:0,done:false,settle:0,candidate:null,gold:token.gold,colliderHandles,bounces:0,mode};this.items.push(r);this.syncOne(r);return r;
 }
 moveTargets(elapsed,closing){
  for(const t of this.targetBodies){
   // Short, visible, bounded motion; stool and animal move as one unit.
   const i=this.characters.indexOf(t.c),row=t.c.layoutRow??Math.floor(i/4),m=this.motion||0;let dx=closing&&row>=2?Math.sin(elapsed*1.65+i)*.38:0;
   if(m===1&&row===1)dx=Math.sin(elapsed*.9)*1.15;
   if(m===2)dx=Math.sin(elapsed*(row===0?.7:row===1?1.05:1.4)*(row===1?-1:1)+row*1.3)*(row===0?.7:row===1?1.15:1.2);
   dx*=t.c.layoutMotionScale??1;t.velocity=(t.c.position[0]+dx-t.x)/SETTINGS.step;t.x=t.c.position[0]+dx;t.body.setNextKinematicTranslation({x:t.x,y:t.c.position[1],z:t.c.position[2]});
  }
  for(const r of this.items){if(r.anchor){const t=this.targetBodies.find(t=>t.c.id===r.anchor.id);r.body.setNextKinematicTranslation({x:t.x+r.anchor.dx,y:r.anchor.y,z:r.anchor.z});}}
 }
 step(dt,wind,elapsed,closing){
  this.moveTargets(elapsed,closing);
  for(const r of this.items){if(r.done)continue;r.age+=dt;r.body.resetForces(false);if(r.age<3.5)r.body.addForce({x:r.body.mass()*wind,y:0,z:0},true);}
  this.world.step(this.events);
  let sound=false;
  this.events.drainCollisionEvents((a,b,start)=>{if(start&&!sound){const r=this.items.find(r=>!r.done&&(r.colliderHandles.includes(a)||r.colliderHandles.includes(b)));if(r&&r.age>.12){r.bounces++;sound=true;this.onBounce(r);}}});
  for(const r of this.items){
   this.syncOne(r);
   if(r.done)continue;
   const p=r.body.translation(),v=r.body.linvel(),q=r.body.rotation();
   const normal=V.set(0,1,0).applyQuaternion(q);let candidate=null;
   for(const t of this.targetBodies){
    const c=t.c,dx=t.x-p.x,dz=c.position[2]-p.z;
    const intersectionY=p.y-(normal.x*dx+normal.z*dz)/normal.y;
    const dy=intersectionY-c.position[1],d=Math.hypot(dx,dz,intersectionY-p.y);
    // Enclosure on the final ring plane, not distance-to-mesh or random hit odds.
    const clearance=r.radius-SETTINGS.tube-c.captureRadius/Math.abs(normal.y);
    if(d<clearance && dy>-.02 && dy<.64 && Math.abs(normal.y)>.68){candidate=c;break;}
   }
   const carrier=candidate?this.targetBodies.find(target=>target.c===candidate):null;
   const speed=Math.hypot(v.x-(carrier?.velocity??0),v.y,v.z);
   if(candidate&&speed<.45){r.settle+=dt;r.candidate=candidate;}else {r.settle=0;r.candidate=null;}
   if(r.settle>.30){
    if(this.onHit(candidate,r)===false)continue;
    r.done=true;const t=this.targetBodies.find(t=>t.c.id===candidate.id);r.anchor={id:candidate.id,dx:p.x-t.x,y:p.y,z:p.z};
    r.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);
   }
   else if(r.age>7.2||p.y<-1.5||Math.abs(p.x)>12||Math.abs(p.z)>14||(r.age>1.5&&speed<.10&&r.body.isSleeping())){
    if(this.onMiss(r)===false)continue;
    r.done=true;r.body.setBodyType(RAPIER.RigidBodyType.Fixed,true);
   }
   this.syncOne(r);
  }
  // Keep scored rings visible, but bound memory during long practice sessions.
  while(this.items.filter(r=>r.done).length>32){const i=this.items.findIndex(r=>r.done);const r=this.items.splice(i,1)[0];this.scene.remove(r.mesh);this.world.removeRigidBody(r.body);r.mesh.geometry.dispose();r.mesh.material.dispose();}
 }
 syncOne(r){r.mesh.position.copy(r.body.translation());r.mesh.quaternion.copy(r.body.rotation());}
 sync(){for(const r of this.items)this.syncOne(r);}
}
