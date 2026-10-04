/** 地下庭園の環境音・音楽・効果音。外部音源を使わないオリジナル合成。 */
export class AudioEngine {
  constructor() { this.enabled = true; this.volume=.7; this.ctx = null; this.time = 0; this.note = 0; this.nextNote = 0; this.last = {};this.worldId=null;this.lastSeq=0; }
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.enabled ? .35*this.volume : 0; this.master.connect(this.ctx.destination);
      this.delay = this.ctx.createDelay(1); this.delay.delayTime.value = .43;
      const feedback = this.ctx.createGain(); feedback.gain.value = .32;
      const wet = this.ctx.createGain(); wet.gain.value = .22;
      this.delay.connect(feedback); feedback.connect(this.delay); this.delay.connect(wet); wet.connect(this.master);
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const noise = this.noiseBuffer.getChannelData(0); let v = 0;
      for (let i=0; i<noise.length; i++) { v = (v + (Math.random()*2-1)*.025)/1.015; noise[i] = v; }
      const source = this.ctx.createBufferSource(); source.buffer = this.noiseBuffer; source.loop = true;
      const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400;
      const gain = this.ctx.createGain(); gain.gain.value = .07;
      source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(); this.ambient = source;
      this.nextNote = this.ctx.currentTime + .1;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }
  setEnabled(value) {
    this.enabled = !!value;
    if (this.ctx) this.master.gain.setTargetAtTime(value ? .35*this.volume : 0, this.ctx.currentTime, .08);
  }
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));this.setEnabled(this.enabled);}
  tone(frequency, duration, volume=.12, type='sine', when, pan=0, sweep=1) {
    if (!this.ctx || !this.enabled) return;
    const now = when ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain(), stereo = this.ctx.createStereoPanner();
    osc.type = type; osc.frequency.setValueAtTime(frequency, now); osc.frequency.exponentialRampToValueAtTime(Math.max(20,frequency*sweep),now+duration);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume), now + Math.min(.06,duration/8)); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    stereo.pan.value = pan; osc.connect(gain); gain.connect(stereo); stereo.connect(this.master); gain.connect(this.delay);
    osc.start(now); osc.stop(now+duration+.05); osc.onended = () => { osc.disconnect(); gain.disconnect(); stereo.disconnect(); };
  }
  noise(duration=.15, volume=.15, frequency=1000) {
    if (!this.ctx || !this.enabled) return;
    const src=this.ctx.createBufferSource(), filter=this.ctx.createBiquadFilter(), gain=this.ctx.createGain();
    src.buffer=this.noiseBuffer; filter.type='highpass'; filter.frequency.value=frequency;
    gain.gain.setValueAtTime(volume,this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.0001,this.ctx.currentTime+duration);
    src.connect(filter);filter.connect(gain);gain.connect(this.master);src.start();src.stop(this.ctx.currentTime+duration);src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();};
  }
  play(name) {
    if (!this.enabled || !this.ctx) return;
    const aliases={ui_move:'ui',ui_confirm:'ui',ui_back:'ui',ui_error:'hurt',ui_tab:'ui',hit_enemy:'hit',hit_player:'hurt',enemy_die:'hit',mine_hit:'mine',mine_break:'pickup',mine_blocked:'ui',tree_fall:'chop',place:'build',remove:'chop',chest_open:'ui',chest_close:'ui',fish_cast:'fish',fish_bite:'pickup',fish_catch:'craft',fish_miss:'ui',plant:'build',harvest:'pickup',sleep:'craft',telegraph:'boss',boss_intro:'boss',boss_phase:'boss',boss_defeat:'victory',gate_open:'craft',core_restore:'victory',achievement:'craft',objective:'pickup',death:'hurt',respawn:'craft',save:'ui',error:'hurt'};
    name=aliases[name]||name;
    if(name.startsWith('step_')){this.noise(.05,.05,name==='step_moss'?300:800);return;}
    const now=this.ctx.currentTime;
    if (now-(this.last[name]??-10)<.09) return; this.last[name]=now;
    switch(name) {
      case 'mine': case 'hit': this.noise(.12,.5,500);this.tone(145,.13,.2,'triangle',now,0,.6);break;
      case 'chop': this.noise(.08,.4,300);this.tone(90,.09,.16,'triangle');break;
      case 'attack': case 'swing': this.noise(.18,.6,1600);break;
      case 'hurt': this.tone(160,.3,.22,'sawtooth',now,0,.35);break;
      case 'pickup': case 'gather': this.tone(660,.2,.12);this.tone(990,.4,.08,'sine',now+.08);break;
      case 'craft': case 'build': [220,330,440,660].forEach((f,i)=>this.tone(f,.6,.11,'triangle',now+i*.08));break;
      case 'eat': this.noise(.1,.3,500);this.tone(440,.25,.1);break;
      case 'dodge': this.noise(.1,.3,2000);break;
      case 'fish': this.tone(800,.6,.09,'sine',now,0,.4);this.noise(.3,.2,600);break;
      case 'boss': this.tone(55,2,.2,'triangle');this.tone(82.4,2,.08);break;
      case 'victory': [261.63,329.63,392,523.25,659.25,783.99].forEach((f,i)=>this.tone(f,2,.13,'sine',now+i*.2));break;
      case 'ui': this.tone(480,.09,.06,'sine');break;
      default: break;
    }
  }
  update(game, dt) {
    if(game.worldId!==this.worldId){this.worldId=game.worldId;this.lastSeq=game.eventSeq||0;}
    const events=game.pollEvents?.(this.lastSeq)||[];
    const sounds={swing:'swing',hit:'hit_enemy',playerHurt:'hit_player',enemyDie:'enemy_die',dodge:'dodge',mineHit:'mine_hit',mineBlocked:'mine_blocked',tileBreak:'mine_break',chop:'chop',treeFall:'tree_fall',gather:'gather',harvest:'harvest',pickup:'pickup',craft:'craft',place:'place',remove:'remove',eat:'eat',chestOpen:'chest_open',chestClose:'chest_close',fishCast:'fish_cast',fishBite:'fish_bite',fishCatch:'fish_catch',fishMiss:'fish_miss',plant:'plant',sleep:'sleep',bossIntro:'boss_intro',bossPhase:'boss_phase',bossDefeated:'boss_defeat',gateOpen:'gate_open',death:'death',respawn:'respawn',satchelRecovered:'pickup',channelDone:'craft',objective:'objective',achievement:'achievement',coreRestore:'core_restore',save:'save'};
    for(const e of events){this.lastSeq=e.seq;if(e.type==='step')this.play('step_'+(e.surface||'moss'));else if(sounds[e.type])this.play(sounds[e.type]);}
    if (!this.ctx || !this.enabled || this.ctx.state!=='running') return;
    this.time += dt;
    const now=this.ctx.currentTime;
    if (now<this.nextNote) return;
    // Dマイナーの広い音域。静かなモチーフと洞窟の長い余韻。
    const melody=[0,7,12,3,10,7,15,12,0,5,10,12,7,3,5,0];
    const semi=melody[this.note%melody.length], base=game.progress?.coreRestored?164.81:game.player?.biome===3?155.56:game.player?.biome===2?138.59:146.83,vol=game.paused?.25:1;
    this.tone(base*2**(semi/12),3.2,.075*vol,'sine',now,(this.note%3-1)*.45);
    if(this.note%4===0) { this.tone(base/2,5,.07*vol,'sine',now);this.tone(base*1.5,4,.025*vol,'triangle',now); }
    if(this.note%3===1) this.tone(base*2**((semi+12)/12),1.4,.035*vol,'sine',now+.3,.6);
    if(game.boss&&this.note%2===0){this.tone(73.42,1.6,.09*vol,'triangle',now);this.noise(.2,.08,80);}
    this.nextNote=now+(this.note%4===3?2.8:1.5);this.note++;
  }
}
