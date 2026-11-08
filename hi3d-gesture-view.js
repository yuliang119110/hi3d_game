import * as THREE from 'three';
import {SETTINGS} from './hi3d-rules.js';

export class GestureRingView {
  constructor(scene) {
    this.group=new THREE.Group();this.group.name='gesture-tracked-arm';this.group.visible=false;scene.add(this.group);
    this.material=new THREE.MeshBasicMaterial({color:0xffedbd,transparent:true,opacity:.72,depthTest:false});
    this.joints=Array.from({length:6},()=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),this.material);m.renderOrder=30;this.group.add(m);return m;});
    const positions=new Float32Array(10*3);
    this.lines=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3)),new THREE.LineBasicMaterial({color:0xffc969,transparent:true,opacity:.7,depthTest:false}));
    this.lines.renderOrder=30;this.group.add(this.lines);
    this.ring=new THREE.Mesh(new THREE.TorusGeometry(SETTINGS.radius,SETTINGS.tube,8,56).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:0xffd56b,metalness:.6,roughness:.28,transparent:true,opacity:.85}));
    this.ring.name='gesture-held-ring';this.group.add(this.ring);
    this.arc=new THREE.Line(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(48*3),3)),new THREE.LineDashedMaterial({color:0xffe49c,dashSize:.13,gapSize:.12,transparent:true,opacity:.65}));
    this.group.add(this.arc);
  }
  update(state,{visible,radius=SETTINGS.radius,wind=0}={}) {
    this.group.visible=!!visible&&!!state?.tracked;if(!this.group.visible)return;
    this.joints.forEach((mesh,i)=>{mesh.visible=!!state.points[i];if(mesh.visible)mesh.position.fromArray(state.points[i]);});
    const edges=[[0,1],[1,2],[2,3],[2,4],[2,5]],attr=this.lines.geometry.attributes.position;
    edges.forEach(([a,b],i)=>{const p=state.points[a]??state.position,q=state.points[b]??p;attr.setXYZ(i*2,...p);attr.setXYZ(i*2+1,...q);});attr.needsUpdate=true;this.lines.frustumCulled=false;
    this.ring.visible=state.holding;this.ring.position.fromArray(state.position);this.ring.scale.setScalar(radius/SETTINGS.radius);
    this.ring.rotation.x=THREE.MathUtils.clamp(-state.velocity[1]*.025,-.28,.28);this.ring.rotation.z=THREE.MathUtils.clamp(-state.velocity[0]*.025,-.18,.18);
    this.arc.visible=state.holding&&state.power>.08;
    if(this.arc.visible) {
      const forward=Math.max(0,-state.velocity[2]),velocity=[THREE.MathUtils.clamp(state.velocity[0]*.85,-6.5,6.5),THREE.MathUtils.clamp(state.velocity[1]*.95+forward*.25,.8,11.5),-THREE.MathUtils.clamp(forward*1.25,2,12.5)];
      const points=this.arc.geometry.attributes.position;
      for(let i=0;i<48;i++){const t=i/47*1.8;points.setXYZ(i,state.position[0]+velocity[0]*t+.5*wind*t*t,state.position[1]+velocity[1]*t-.5*SETTINGS.gravity*t*t,state.position[2]+velocity[2]*t);}
      points.needsUpdate=true;this.arc.computeLineDistances();this.arc.frustumCulled=false;
    }
  }
  hide(){this.group.visible=false;}
}
