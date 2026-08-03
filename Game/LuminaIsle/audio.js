(function(){
  "use strict";
  const LI=window.LI=window.LI||{};
  const BGM_PATH="assets/audio/bgm/",SFX_PATH="assets/audio/sfx/";
  const trackNames=["meadow-day","lantern-dusk","guardian","homecoming"];
  const sfxNames=["ui_confirm","ui_cancel","pickup","chop","mine","craft","build","fish_bite","fish_catch","attack","hit","dodge","cook","discover","sleep"];

  class AudioManager{
    constructor(){this.settings=LI.Save.loadSettings();this.unlocked=false;this.current=null;this.wanted="meadow-day";this.tracks={};this.effects={};this.failures=[];}
    preload(){
      trackNames.forEach(name=>{const a=new Audio(`${BGM_PATH}${name}.ogg`);a.preload="auto";a.loop=name!=="homecoming";a.addEventListener("error",()=>this.failures.push(name),{once:true});this.tracks[name]=a;});
      sfxNames.forEach(name=>{const a=new Audio(`${SFX_PATH}${name}.ogg`);a.preload="auto";a.addEventListener("error",()=>this.failures.push(name),{once:true});this.effects[name]=a;});
    }
    async unlock(){
      if(this.unlocked)return;this.unlocked=true;
      const a=this.effects.ui_confirm;
      if(a){a.volume=0;try{await a.play();a.pause();a.currentTime=0;}catch(_){}a.volume=1;}
      this.playMusic(this.wanted,true);
    }
    setSettings(settings){this.settings=settings||this.settings;if(this.current)this.current.volume=this.musicVolume();if(this.settings.muted)this.stopAll();else if(this.unlocked)this.playMusic(this.wanted,true);}
    musicVolume(){return this.settings.muted?0:(this.settings.master??.8)*(this.settings.music??.62)*.6;}
    sfxVolume(){return this.settings.muted?0:(this.settings.master??.8)*(this.settings.sfx??.82);}
    playMusic(name,force=false){
      if(!this.tracks[name])return;this.wanted=name;if(!this.unlocked||this.settings.muted)return;
      if(this.current===this.tracks[name]&&!force)return;
      if(this.current&&this.current!==this.tracks[name]){this.current.pause();this.current.currentTime=0;}
      this.current=this.tracks[name];this.current.volume=this.musicVolume();
      const p=this.current.play();if(p?.catch)p.catch(()=>{});
    }
    stopAll(){if(this.current)this.current.pause();}
    effect(name,rate=1){
      const source=this.effects[name];if(!this.unlocked||!source||this.settings.muted)return;
      const a=source.cloneNode();a.volume=this.sfxVolume();a.playbackRate=Math.max(.75,Math.min(1.3,rate));const p=a.play();if(p?.catch)p.catch(()=>{});
    }
    ambientLevel(){return this.settings.muted?0:(this.settings.master??.8)*(this.settings.ambient??.5);}
  }
  LI.audio=new AudioManager();
})();
