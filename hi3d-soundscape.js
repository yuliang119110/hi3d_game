const MUSIC = new URL('./assets/audio/hi3d-year-of-the-iron-dragon.mp3',import.meta.url);
const CROWD = new URL('./assets/audio/hi3d-crowd-murmur.mp3',import.meta.url);
const CHILDREN = new URL('./assets/audio/hi3d-children-playful.mp3',import.meta.url);
const EFFECTS = {
  throw: new URL('./assets/audio/hi3d-ring-whoosh.mp3',import.meta.url),
  bounce: new URL('./assets/audio/hi3d-ring-tap.mp3',import.meta.url),
  applause: new URL('./assets/audio/hi3d-short-applause.mp3',import.meta.url)
};

export class FairSoundscape {
  constructor({onWarning=()=>{}}={}) {
    this.enabled=true;this.phase='ready';this.context=null;this.onWarning=onWarning;
    this.buffers=new Map();this.loading=new Map();this.active=new Set();this.warned=new Set();
    this.duckUntil=0;this.lastApplause=-10;this.stateKey='';this.playing=false;
    document.addEventListener('visibilitychange',()=>this.setState(this.phase,document.hidden,true));
    window.addEventListener('pagehide',()=>this.stop());
  }
  unlock() {
    try {
      if(!this.context) {
        const AudioClass=window.AudioContext||window.webkitAudioContext;
        this.context=new AudioClass();
        const c=this.context;
        this.output=c.createDynamicsCompressor();this.output.threshold.value=-12;this.output.knee.value=12;this.output.ratio.value=4;
        this.output.connect(c.destination);
        this.effectsGain=c.createGain();this.effectsGain.gain.value=.16;this.effectsGain.connect(this.output);
        this.music=this.createLoop('music',MUSIC);this.crowd=this.createLoop('crowd',CROWD);this.children=this.createLoop('children',CHILDREN);
      }
      if(this.context.state==='suspended')this.context.resume().catch(()=>this.warning('unlock','点击声音按钮可重新开启声音。'));
      for(const [name,url] of Object.entries(EFFECTS))this.loadEffect(name,url);
      this.setState(this.phase,document.hidden,true);
    } catch {this.warning('unsupported','此浏览器暂不支持音频，游戏可以继续。');}
  }
  createLoop(name,url) {
    const element=document.createElement('audio');element.src=url.href;element.loop=true;element.preload='none';element.hidden=true;
    element.dataset.hi3dAudio=name;element.setAttribute('aria-hidden','true');document.body.appendChild(element);
    const source=this.context.createMediaElementSource(element),gain=this.context.createGain(),analyser=this.context.createAnalyser();
    analyser.fftSize=256;gain.gain.value=0;source.connect(gain);gain.connect(analyser);analyser.connect(this.output);
    element.addEventListener('error',()=>this.warning(name,`${name==='music'?'背景音乐':name==='children'?'孩童嬉闹声':'人群氛围'}未能加载；游戏可继续，关闭再开启声音可重试。`));
    return {element,gain,analyser,pending:false};
  }
  warning(key,message) {if(!this.warned.has(key)){this.warned.add(key);this.onWarning(message);}}
  loadEffect(name,url) {
    if(this.buffers.has(name)||this.loading.has(name))return;
    const task=fetch(url).then(r=>{if(!r.ok)throw Error('Audio HTTP '+r.status);return r.arrayBuffer();})
      .then(bytes=>this.context.decodeAudioData(bytes)).then(buffer=>this.buffers.set(name,buffer))
      .catch(()=>this.warning(name,'部分音效未能加载；游戏仍可继续，关闭再开启声音可重试。'))
      .finally(()=>this.loading.delete(name));
    this.loading.set(name,task);
  }
  setEnabled(value) {this.enabled=!!value;this.setState(this.phase,document.hidden,true);}
  setState(phase,hidden=document.hidden,force=false) {
    this.phase=phase;
    const key=`${phase}:${hidden}:${this.enabled}`;
    if(key===this.stateKey&&!force)return;
    this.stateKey=key;
    if(!this.context)return;
    this.playing=this.enabled&&!hidden&&!['paused','loading'].includes(phase);
    const t=this.context.currentTime;
    this.effectsGain.gain.cancelScheduledValues(t);this.effectsGain.gain.setTargetAtTime(this.playing?.16:0,t,.025);
    if(!this.playing) {
      this.stop();
      return;
    }
    for(const bus of [this.music,this.crowd,this.children]) {
      if(bus.element.error)bus.element.load();
      if(bus.element.paused&&!bus.pending) {
        bus.pending=true;
        bus.element.play().catch(error=>{
          if(error.name!=='AbortError')this.warning('play','点击声音按钮可重新开启背景音乐。');
        }).finally(()=>{bus.pending=false;if(!this.playing)bus.element.pause();});
      }
    }
    const target=phase==='playing'?.05:.0325;
    this.music.gain.gain.cancelScheduledValues(t);this.music.gain.gain.setTargetAtTime(t<this.duckUntil?target*.5:target,t,.3);
    if(t<this.duckUntil)this.music.gain.gain.setTargetAtTime(target,this.duckUntil,.25);
    this.children.gain.gain.cancelScheduledValues(t);this.children.gain.gain.setTargetAtTime(phase==='playing'?.06:.035,t,.4);
    this.crowd.gain.gain.cancelScheduledValues(t);this.crowd.gain.gain.setTargetAtTime(phase==='playing'?.06:.035,t,.4);
  }
  stop() {
    this.playing=false;
    if(!this.context)return;
    for(const bus of [this.music,this.crowd,this.children])if(bus) {
      bus.element.pause();bus.gain.gain.cancelScheduledValues(this.context.currentTime);bus.gain.gain.value=0;
    }
    for(const source of this.active){try{source.stop();}catch{}}
    this.active.clear();
  }
  effect(name,{volume=1,rate=1}={}) {
    if(!this.playing||!this.enabled||!this.context)return;
    const t=this.context.currentTime;
    if(name==='applause') {
      this.duckUntil=t+.75;
      const gain=this.music.gain.gain;
      gain.cancelScheduledValues(t);gain.setTargetAtTime(.0225,t,.025);
      gain.setTargetAtTime(this.phase==='playing'?.05:.0325,t+.7,.25);
      if(t-this.lastApplause<2)return;
      this.lastApplause=t;
    }
    const buffer=this.buffers.get(name);if(!buffer)return;
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;source.playbackRate.value=rate;
    gain.gain.value=volume;source.connect(gain);gain.connect(this.effectsGain);this.active.add(source);
    source.onended=()=>{this.active.delete(source);source.disconnect();gain.disconnect();};source.start();
  }
  snapshot() {
    const bus=value=>{
      if(!value)return null;
      const samples=new Float32Array(value.analyser.fftSize);value.analyser.getFloatTimeDomainData(samples);
      return {paused:value.element.paused,time:value.element.currentTime,readyState:value.element.readyState,
        gain:value.gain.gain.value,rms:Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length)};
    };
    return {enabled:this.enabled,phase:this.phase,context:this.context?.state??'locked',effects:this.buffers.size,music:bus(this.music),crowd:bus(this.crowd),children:bus(this.children)};
  }
}
