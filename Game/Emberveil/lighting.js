/** ピクセルの照明。マスクもnative resolutionのImageDataから生成する。 */
import { canvas } from './visuals.js';

export function pixelEllipse(ctx,x,y,rx,ry,color){
  ctx.fillStyle=color;
  x=Math.round(x);y=Math.round(y);rx=Math.round(rx);ry=Math.round(ry);
  for(let dy=-ry;dy<=ry;dy++){
    const half=Math.floor(rx*Math.sqrt(Math.max(0,1-dy*dy/(ry*ry||1))));
    ctx.fillRect(x-half,y+dy,half*2+1,1);
  }
}

export class PixelLighting {
  constructor(){this.mask=canvas(1,1);this.ctx=this.mask.getContext('2d');this.cache=new Map();}
  resize(w,h){if(this.mask.width!==w||this.mask.height!==h){this.mask.width=w;this.mask.height=h;this.ctx.imageSmoothingEnabled=false;}}
  radial(radius,color,opacity=1){
    radius=Math.round(radius);const key=`${radius}/${color}/${opacity}`;if(this.cache.has(key))return this.cache.get(key);
    const c=canvas(radius*2+1,radius*2+1),ctx=c.getContext('2d'),data=ctx.createImageData(c.width,c.height);
    const rgb=color.match(/\w\w/g).map(s=>parseInt(s,16));
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const dist=Math.hypot(x-radius,y-radius)/radius,fall=Math.max(0,1-dist),i=(y*c.width+x)*4;
      data.data[i]=rgb[0];data.data[i+1]=rgb[1];data.data[i+2]=rgb[2];
      data.data[i+3]=Math.round(Math.pow(fall,1.7)*opacity*255/8)*8;
    }
    ctx.putImageData(data,0,0);this.cache.set(key,c);return c;
  }
  draw(ctx,lights,ambient=.24){
    this.resize(ctx.canvas.width,ctx.canvas.height);
    const c=this.ctx;c.globalCompositeOperation='source-over';c.clearRect(0,0,this.mask.width,this.mask.height);
    c.fillStyle=`rgba(9,15,25,${Math.min(.65,ambient)})`;c.fillRect(0,0,this.mask.width,this.mask.height);
    c.globalCompositeOperation='destination-out';
    for(const light of lights){
      const r=Math.round(light.radius),mask=this.radial(r,'ffffff',light.strength??.8);
      c.drawImage(mask,Math.round(light.x-r),Math.round(light.y-r));
    }
    c.globalCompositeOperation='source-over';ctx.drawImage(this.mask,0,0);
    ctx.save();ctx.globalCompositeOperation='screen';
    for(const l of lights){
      if(!l.color)continue;const r=Math.max(8,Math.round(l.radius*.55));
      ctx.drawImage(this.radial(r,l.color,l.glow??.1),Math.round(l.x-r),Math.round(l.y-r));
    }
    ctx.restore();
  }
}
