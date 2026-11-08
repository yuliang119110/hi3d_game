import {PoseThrowTracker} from './hi3d-gesture-motion.js';
const POSE_ROOT=new URL('./vendor/mediapipe-pose/',import.meta.url);
let library;
const loadLibrary=()=>library??=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=new URL('pose.js',POSE_ROOT).href;
  script.onload=()=>window.Pose?resolve(window.Pose):reject(Error('识别组件未能启动'));
  script.onerror=()=>{library=null;script.remove();reject(Error('本地识别组件加载失败，关闭后重试'));};document.head.appendChild(script);
});

export class GestureThrowController {
  constructor({onFrame,onThrow,onCancel,canThrow,onToggle=()=>{}}) {
    this.onFrame=onFrame;this.onThrow=onThrow;this.onCancel=onCancel;this.canThrow=canThrow;this.onToggle=onToggle;
    this.tracker=new PoseThrowTracker();this.active=false;this.starting=false;this.generation=0;this.processing=false;this.frames=0;this.lastSend=-1000;this.phase='ready';this.throwCount=0;
    const $=id=>document.getElementById(id);this.button=$('gesture-toggle');this.panel=$('gesture-panel');this.video=$('gesture-video');this.canvas=$('gesture-canvas');this.ctx=this.canvas.getContext('2d');this.status=$('gesture-status');this.message=$('gesture-instruction');
    this.button.onclick=()=>this.active||this.starting?this.stop():this.start();
    $('gesture-close').onclick=()=>this.stop();
    $('gesture-minimize').onclick=()=>{this.panel.classList.toggle('compact');$('gesture-minimize').setAttribute('aria-expanded',String(!this.panel.classList.contains('compact')));};
    $('gesture-hand').onchange=e=>{this.tracker.setHand(e.target.value);this.onCancel();};
    $('gesture-retry').onclick=()=>this.start();
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancelHold();});
    window.addEventListener('blur',()=>this.cancelHold());window.addEventListener('pagehide',()=>this.stop());
  }
  setStatus(text){this.status.textContent=text;}
  async start() {
    if(this.active||this.starting)return;
    const generation=++this.generation;this.starting=true;this.panel.hidden=false;this.button.setAttribute('aria-pressed','false');this.button.setAttribute('aria-busy','true');this.setStatus('正在开启摄像头');document.getElementById('gesture-retry').hidden=true;
    try {
      if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('请通过本机预览或 HTTPS 使用摄像头');
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:480,max:640},height:{ideal:360,max:480},frameRate:{ideal:20,max:24},facingMode:'user'},audio:false});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video.srcObject=stream;await this.video.play();
      this.setStatus('正在加载本地识别模型');
      const Pose=await loadLibrary();if(generation!==this.generation)return;
      if(!this.pose) {
        this.pose=new Pose({locateFile:file=>new URL(file,POSE_ROOT).href});
        this.pose.setOptions({modelComplexity:0,smoothLandmarks:true,enableSegmentation:false,minDetectionConfidence:.6,minTrackingConfidence:.6});
        this.pose.onResults(results=>{if(this.active&&this.sendingGeneration===this.generation)this.handleResults(results);});
      }
      this.active=true;this.starting=false;this.onToggle(true);this.button.setAttribute('aria-pressed','true');this.button.setAttribute('aria-label','关闭摄像头手势模式');this.button.removeAttribute('aria-busy');this.setStatus('寻找肩膀、手肘和手腕');
      stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(this.active)this.fail('摄像头已断开，可点击重试');},{once:true}));
      this.loop();
    } catch(error) {
      if(generation!==this.generation)return;
      const reasons={NotAllowedError:'摄像头权限未允许，请在地址栏允许后重试',NotFoundError:'没有找到摄像头，仍可使用鼠标投圈',NotReadableError:'摄像头正被其他程序占用，请释放后重试'};
      this.fail(reasons[error.name]||error.message||'摄像头启动失败');
    }
  }
  fail(message){this.stop({keepPanel:true});this.setStatus(message);document.getElementById('gesture-retry').hidden=false;}
  stop({keepPanel=false}={}) {
    ++this.generation;this.active=false;this.starting=false;cancelAnimationFrame(this.raf);
    if(this.stream)this.stream.getTracks().forEach(t=>t.stop());this.stream=null;this.video.pause();this.video.srcObject=null;
    this.panel.hidden=!keepPanel;this.button.setAttribute('aria-pressed','false');this.button.setAttribute('aria-label','开启摄像头手势模式');this.button.removeAttribute('aria-busy');this.onToggle(false);this.cancelHold();this.setStatus('摄像头已关闭');
  }
  cancelHold(){this.tracker.reset();this.state=null;this.onCancel();this.onFrame({tracked:false,holding:false});}
  setPhase(phase) {if(this.phase!==phase){this.phase=phase;this.cancelHold();}}
  async loop() {
    if(!this.active)return;
    const generation=this.generation,now=performance.now();
    if(!this.testInferencePaused&&!document.hidden&&!this.processing&&this.video.readyState>=2&&now-this.lastSend>=60) {
      this.processing=true;this.lastSend=now;
      try {
        this.inference??=Object.assign(document.createElement('canvas'),{width:384,height:288});
        this.inference.getContext('2d').drawImage(this.video,0,0,384,288);
        this.sendingGeneration=generation;await this.pose.send({image:this.inference});this.frames++;
      } catch(error) {if(generation===this.generation)this.fail('姿态识别未能运行，请点击重试：'+error.message);}
      finally {this.processing=false;}
    }
    if(this.active&&generation===this.generation)this.raf=requestAnimationFrame(()=>this.loop());
  }
  handleResults(results,now=performance.now()/1000) {
    if(!this.active)return;
    this.lastResult=performance.now();
    const landmarks=results.poseLandmarks;
    const state=this.tracker.update(landmarks,now,{canThrow:this.canThrow()&&!document.hidden});
    this.state=state;this.draw(landmarks);this.onFrame(state);
    if(state.tracked) {
      this.setStatus(this.phase==='playing'?'手臂已识别':'已识别 · 开始游戏即可投圈');
      this.message.textContent=this.phase!=='playing'?'选关并开始游戏，再收手持圈':state.holding?'已持圈 · 向前上方挥手出圈':state.launch?'已出圈 · 收手准备下一圈':'手腕收回肩前，停一下取圈';
    } else {this.setStatus('请让肩膀、手肘和手腕进入画面');this.message.textContent='退后一些，保持上半身和整条手臂可见';}
    document.getElementById('gesture-power').style.width=`${Math.round((state.power??0)*100)}%`;
    if(state.launch){if(this.onThrow(state.launch)!==false)this.throwCount++;}
  }
  draw(landmarks) {
    const c=this.ctx,w=this.canvas.width,h=this.canvas.height;c.clearRect(0,0,w,h);if(!landmarks)return;
    c.save();c.translate(w,0);c.scale(-1,1);c.lineWidth=3;c.lineCap='round';c.strokeStyle='#ffe291';c.fillStyle='#fff6ce';
    for(const [a,b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[15,17],[15,19],[15,21],[16,18],[16,20],[16,22]]) {
      const p=landmarks[a],q=landmarks[b];if(!p||!q||(p.visibility??1)<.5||(q.visibility??1)<.5)continue;
      c.beginPath();c.moveTo(p.x*w,p.y*h);c.lineTo(q.x*w,q.y*h);c.stroke();
    }
    for(const i of [11,12,13,14,15,16]){const p=landmarks[i];if(p&&(p.visibility??1)>.5){c.beginPath();c.arc(p.x*w,p.y*h,i>=15?5:3,0,Math.PI*2);c.fill();}}
    c.restore();
  }
  watchdog(now) {
    if(this.active&&this.lastResult&&now-this.lastResult>350&&this.state?.tracked){this.cancelHold();this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);this.setStatus('识别暂时丢失，请重新收手');this.message.textContent='保持整条手臂可见，重新收手取圈';document.getElementById('gesture-power').style.width='0%';}
  }
  snapshot(){return {active:this.active,starting:this.starting,frames:this.frames,throwCount:this.throwCount,holding:!!this.state?.holding,tracked:!!this.state?.tracked,tracks:this.stream?.getTracks().map(t=>t.readyState)??[],status:this.status.textContent};}
}
