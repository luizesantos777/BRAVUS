'use client';
import {useEffect,useRef,useState} from 'react';
import {colors} from '@/lib/store';
// A live fabric-color simulation; colored graphics and bright print remain unchanged.
export default function ColorPreview({src,color,original,name}:{src:string;color:string;original:string;name:string}){
 const ref=useRef<HTMLCanvasElement>(null),cache=useRef<HTMLImageElement|null>(null);const [ready,setReady]=useState(false);
 useEffect(()=>{let cancelled=false;const img=new Image();img.onload=()=>{if(cancelled)return;cache.current=img;setReady(true)};img.onerror=()=>setReady(false);img.src=src;return()=>{cancelled=true;cache.current=null;setReady(false)}},[src]);
 useEffect(()=>{const c=ref.current,img=cache.current;if(!c||!img||!ready)return;const w=img.naturalWidth,h=img.naturalHeight;c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)return;ctx.drawImage(img,0,0);if(color===original)return;
 const target=[...colors,{name:'Bege',hex:'#d4bd91'},{name:'Roxo',hex:'#773d99'}].find(x=>x.name===color);if(!target)return;const rgb=[1,3,5].map(i=>parseInt(target.hex.slice(i,i+2),16));const base=[...colors,{name:'Bege',hex:'#d4bd91'},{name:'Roxo',hex:'#773d99'}].find(x=>x.name===original);const baseRgb=[1,3,5].map(i=>parseInt((base?.hex||'#141414').slice(i,i+2),16));const baseHi=Math.max(...baseRgb),baseLo=Math.min(...baseRgb);const baseChromatic=baseHi-baseLo>35;const normalizedBase=baseRgb.map(v=>v/Math.max(1,baseHi));const mask=document.createElement('canvas');mask.width=w;mask.height=h;const m=mask.getContext('2d')!;
 const shapes=src.includes('texas')?[
 [[.235,.025],[.36,.025],[.375,.07],[.405,.10],[.45,.16],[.48,.37],[.50,.82],[.444,.84],[.412,.48],[.414,.85],[.132,.85],[.15,.48],[.12,.84],[.075,.84],[.09,.47],[.115,.21],[.16,.12],[.22,.08]],
 [[.625,.035],[.75,.035],[.77,.09],[.85,.14],[.91,.23],[.955,.83],[.898,.85],[.866,.48],[.87,.85],[.587,.85],[.58,.47],[.55,.84],[.51,.83],[.53,.35],[.55,.19],[.61,.10]]
 ]:[[[.16,.10],[.37,.10],[.46,.23],[.49,.87],[.41,.89],[.38,.50],[.39,.91],[.10,.91],[.11,.50],[.07,.89],[.015,.87],[.05,.26]],[[.65,.10],[.82,.10],[.93,.24],[.99,.87],[.92,.89],[.88,.50],[.89,.91],[.60,.91],[.61,.50],[.56,.89],[.51,.87],[.55,.26]]];
 m.fillStyle='white';for(const shape of shapes){m.beginPath();shape.forEach(([x,y],i)=>i?m.lineTo(x*w,y*h):m.moveTo(x*w,y*h));m.closePath();m.fill()}
 const pixels=ctx.getImageData(0,0,w,h),a=pixels.data,b=m.getImageData(0,0,w,h).data;
 for(let i=0;i<a.length;i+=4){if(!b[i+3])continue;const hi=Math.max(a[i],a[i+1],a[i+2]),lo=Math.min(a[i],a[i+1],a[i+2]),lum=(a[i]*.2126+a[i+1]*.7152+a[i+2]*.0722);const saturation=(hi-lo)/Math.max(hi,1);const sameBase=baseChromatic&&Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]/Math.max(1,hi)-normalizedBase[k])))<.19; if((saturation>.24&&!sameBase)||lum>140)continue;const strength=(sameBase?1:Math.min(1,(.24-saturation)/.09))*Math.min(1,(140-lum)/45);const shade=.43+.54*Math.min(1,lum/62);for(let k=0;k<3;k++){const tinted=Math.min(255,rgb[k]*shade+Math.max(0,lum-62)*.2);a[i+k]=Math.round(a[i+k]*(1-strength)+tinted*strength)}}ctx.putImageData(pixels,0,0);
 },[src,color,original,ready]);
 return <figure className="live-preview">{!ready&&<img src={src} alt={name}/>}<canvas ref={ref} style={{display:ready?'block':'none'}} aria-label={name+' na cor '+color} role="img"/><figcaption><strong>{color}</strong><span>Simulação da cor do tecido · estampa de referência</span></figcaption></figure>;
}
