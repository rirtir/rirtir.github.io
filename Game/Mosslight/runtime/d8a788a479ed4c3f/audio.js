// 専用の合成音源。ユーザー操作後にだけAudioContextを開始する。
const MODES = {
  day: { bpm: 76, root: 50, notes: [0,7,12,14,7,4,9,7,0,4,7,12,9,7,4,2], color: 'sine', volume:.13 },
  night: { bpm: 59, root: 45, notes: [0,7,10,14,12,7,3,7,0,3,7,10,14,12,7,3], color:'sine', volume:.105 },
  cave: { bpm: 57, root: 38, notes: [0,7,12,15,7,2,10,7,0,5,7,12,10,7,5,2], color:'triangle',volume:.10 },
  ruin: { bpm: 63, root: 43, notes: [0,7,12,14,10,7,5,2,0,5,10,12,14,10,7,5], color:'sine',volume:.10 },
  boss: { bpm: 116, root: 38, notes: [0,0,7,0,3,0,10,7,0,0,5,0,7,10,7,3], color:'triangle',volume:.13 },
  ending: { bpm: 73, root: 50, notes: [0,4,7,12,14,12,9,7,4,7,12,16,14,12,7,4], color:'sine',volume:.14 },
};
const frequency = note => 440 * 2 ** ((note - 69) / 12);
export function createAudio() {
  let ctx, master, music, effects, reverb, reverbSend;
  let enabled = false, paused = true, mode = 'day', nextBeat = 0, beat = 0, timer = null;
  let currentModeGain = null, transition = null, noiseBuffer = null;
  const volumes = { master:.65, music:.45, sfx:.7 };
  const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
  function init() {
    if (ctx) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    ctx = new Audio();
    master=ctx.createGain(); music=ctx.createGain(); effects=ctx.createGain();
    music.connect(master); effects.connect(master); master.connect(ctx.destination);
    reverb = ctx.createConvolver(); reverbSend=ctx.createGain(); reverbSend.gain.value=.18;
    const impulse=ctx.createBuffer(2,Math.floor(ctx.sampleRate*1.7),ctx.sampleRate);
    for (let c=0;c<2;c++) {
      const samples=impulse.getChannelData(c);
      let seed=931+c;
      for(let i=0;i<samples.length;i++){seed=(seed*1664525+1013904223)>>>0;samples[i]=(seed/2147483648-1)*(1-i/samples.length)**3*.5;}
    }
    reverb.buffer=impulse; music.connect(reverbSend);reverbSend.connect(reverb);reverb.connect(master);
    noiseBuffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
    const data=noiseBuffer.getChannelData(0);let seed=831;
    for(let i=0;i<data.length;i++){seed=(seed*1664525+1013904223)>>>0;data[i]=seed/2147483648-1;}
    applyVolumes();
  }
  function applyVolumes() {
    if(!ctx)return;const at=ctx.currentTime;
    master.gain.setTargetAtTime(volumes.master,at,.05);music.gain.setTargetAtTime(volumes.music,at,.05);effects.gain.setTargetAtTime(volumes.sfx,at,.03);
  }
  function tone(freq, time, duration, gain, type='sine', destination=effects, pan=0, endFrequency=null) {
    if(!ctx || gain<=0)return;
    const osc=ctx.createOscillator(), envelope=ctx.createGain(), stereo=ctx.createStereoPanner();
    osc.type=type;osc.frequency.setValueAtTime(Math.max(20,freq),time);
    if(endFrequency)osc.frequency.exponentialRampToValueAtTime(Math.max(20,endFrequency),time+duration);
    envelope.gain.setValueAtTime(.0001,time);envelope.gain.exponentialRampToValueAtTime(gain,time+Math.min(.014,duration/4));
    envelope.gain.exponentialRampToValueAtTime(.0001,time+duration);
    stereo.pan.value=Math.max(-1,Math.min(1,pan));osc.connect(envelope);envelope.connect(stereo);stereo.connect(destination);
    osc.start(time);osc.stop(time+duration+.02);
    osc.onended=()=>{osc.disconnect();envelope.disconnect();stereo.disconnect();};
  }
  function noise(duration, gain, filter=1300, pan=0) {
    if(!ctx)return;
    const at=ctx.currentTime,source=ctx.createBufferSource(),envelope=ctx.createGain(),low=ctx.createBiquadFilter(),stereo=ctx.createStereoPanner();
    source.buffer=noiseBuffer;low.type='lowpass';low.frequency.value=filter;stereo.pan.value=Math.max(-1,Math.min(1,pan));
    envelope.gain.setValueAtTime(gain,at);envelope.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(low);low.connect(envelope);envelope.connect(stereo);stereo.connect(effects);source.start(at);source.stop(at+duration);
    source.onended=()=>{source.disconnect();low.disconnect();envelope.disconnect();stereo.disconnect();};
  }
  function play(name, opts={}) {
    if(!ctx||ctx.state!=='running'||!enabled)return;
    const at=ctx.currentTime,pan=opts.pan||0;
    switch(name){
      case 'step':case 'footstep':
        noise(.045,opts.water?.032:.021,opts.water?3300:700,pan);tone(opts.water?320:95,at,.035,.021,'sine',effects,pan);break;
      case 'chop':case 'wood':
        noise(.10,.10,1000,pan);tone(160,at,.11,.16,'triangle',effects,pan,75);tone(360,at,.035,.045,'sine',effects,pan);break;
      case 'mine':case 'stone':
        noise(.075,.065,3800,pan);tone(1250,at,.13,.075,'sine',effects,pan,900);tone(1900,at,.10,.024,'sine',effects,pan);break;
      case 'collect':case 'pickup':case 'harvest':
        tone(659,at,.14,.085,'sine',effects,pan);tone(988,at+.045,.18,.055,'sine',effects,pan);break;
      case 'craft':case 'build':
        noise(.055,.065,900,pan);[0,4,7].forEach((n,i)=>tone(frequency(67+n),at+i*.055,.24,.065,'triangle',effects,pan));break;
      case 'swing':case 'attack':case 'dash':case 'roll':
        noise(.11,name==='dash'?.07:.05,2400,pan);tone(230,at,.10,.035,'triangle',effects,pan,80);break;
      case 'hit':
        noise(.075,.12,1200,pan);tone(130,at,.12,.16,'triangle',effects,pan,45);break;
      case 'hurt':case 'damage':
        tone(185,at,.18,.14,'triangle',effects,pan,62);noise(.08,.06,650,pan);break;
      case 'eat':
        noise(.045,.05,2600);noise(.08,.027,1800);tone(530,at+.08,.12,.03,'sine');break;
      case 'light':case 'restore':case 'victory':case 'clear':
        [0,7,12,16,19,24].forEach((n,i)=>tone(frequency(62+n),at+i*.14,1.2,.075,'sine',music,(i-2.5)*.15));break;
      case 'death':
        [0,-3,-7,-12].forEach((n,i)=>tone(frequency(57+n),at+i*.18,.6,.075,'triangle'));break;
      case 'warning':case 'telegraph':
        tone(200,at,.3,.05,'sine',effects,pan,480);tone(95,at,.25,.07,'triangle');break;
      case 'bird':
        tone(2100,at,.16,.025,'sine',effects,pan,3300);tone(3000,at+.19,.12,.021,'sine',effects,pan,2400);break;
      case 'ui':case 'click':
        tone(740,at,.055,.027,'sine');break;
      case 'error':
        tone(170,at,.08,.055,'triangle');tone(140,at+.09,.09,.035,'triangle');break;
    }
  }
  function schedule() {
    if(!ctx || paused || ctx.state!=='running')return;
    const config=MODES[mode]||MODES.day, interval=60/config.bpm/2;
    if(nextBeat<ctx.currentTime-.5)nextBeat=ctx.currentTime+.05;
    while(nextBeat<ctx.currentTime+.25){
      const step=beat%16, note=config.root+12+config.notes[step], destination=currentModeGain||music;
      const accent=step%4===0?1:.72;
      tone(frequency(note),nextBeat,mode==='boss'?.16:.72,config.volume*.36*accent,config.color,destination,Math.sin(beat*.8)*.35);
      if(step%4===0){
        const chordRoot=config.root+[0,5,7,0][Math.floor(step/4)];
        tone(frequency(chordRoot),nextBeat,interval*3.8,config.volume*.24,'triangle',destination,-.12);
        tone(frequency(chordRoot+7),nextBeat+.03,interval*3.4,config.volume*.12,'sine',destination,.25);
      }
      if(mode==='boss' && step%2===0)tone(63,nextBeat,.14,.035,'triangle',destination,0,31);
      if(mode==='day' && beat%96===47)play('bird',{pan:Math.sin(beat)});
      nextBeat+=interval;beat++;
    }
  }
  function setMusic(next) {
    next=MODES[next]?next:'day';if(next===mode && currentModeGain)return;
    mode=next;beat=0;if(!ctx)return;
    const previous=currentModeGain,at=ctx.currentTime;
    currentModeGain=ctx.createGain();currentModeGain.gain.setValueAtTime(.0001,at);currentModeGain.gain.linearRampToValueAtTime(1,at+2);currentModeGain.connect(music);
    if(previous){previous.gain.cancelScheduledValues(at);previous.gain.setValueAtTime(previous.gain.value,at);previous.gain.linearRampToValueAtTime(.0001,at+2);const old=previous;setTimeout(()=>old.disconnect(),4000);}
    nextBeat=at+.08;
  }
  async function unlock() {
    try{init();if(!ctx)return false;await ctx.resume();enabled=true;paused=false;if(!currentModeGain)setMusic(mode);if(!timer)timer=setInterval(schedule,90);return true;}catch{return false;}
  }
  function setVolumes(values) {
    if(typeof values==='number')volumes.master=clamp(values);
    else if(values){for(const name of ['master','music','sfx'])if(name in values)volumes[name]=clamp(values[name]);if('bgm' in values)volumes.music=clamp(values.bgm);if('se' in values)volumes.sfx=clamp(values.se);}
    applyVolumes();
  }
  function handleEvents(events=[]) {
    for(const event of events){if(event.sound)play(event.sound,event);else if(event.type==='sound'||event.type==='sfx')play(event.name||event.id,event);}
  }
  function setPaused(value) {
    paused=Boolean(value);if(ctx)music.gain.setTargetAtTime(paused?0:volumes.music,ctx.currentTime,.15);
    if(!paused && ctx)nextBeat=ctx.currentTime+.08;
  }
  function destroy(){if(timer)clearInterval(timer);timer=null;if(ctx)ctx.close();ctx=null;}
  return {unlock,play,setMusic,setVolumes,handleEvents,setPaused,destroy,get available(){return Boolean(window.AudioContext||window.webkitAudioContext);},get volumes(){return {...volumes};}};
}
