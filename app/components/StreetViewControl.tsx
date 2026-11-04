'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Map as LtsMap } from 'maplibre-gl';
import { googleStreetViewUrl, streetViewCanvasPoint } from '@/lib/google-maps';

type Gesture = {pointerId:number;start:[number,number];dragged:boolean};

function Figure(){
  return <svg viewBox="0 0 32 42" aria-hidden="true" focusable="false">
    <g fill="#f7b900" stroke="#8a6000" strokeWidth="1.3" strokeLinejoin="round">
      <circle cx="16" cy="7" r="5" />
      <path d="M12 14h8c2 0 3 1 3.5 3l3 9c.7 2.2-2.8 3.1-3.5 1l-3-7v9l3 9c.8 2.4-3.1 3.3-4 1l-3-8-3 8c-.9 2.3-4.8 1.4-4-1l3-9v-9l-3 7c-.7 2.1-4.2 1.2-3.5-1l3-9c.5-2 1.5-3 3.5-3Z" />
    </g>
  </svg>;
}

/** Public Maps URLs keep the workshop open without adding a Google map or API key. */
export function StreetViewControl({map,disabled=false}:{map:LtsMap|null;disabled?:boolean}){
  const [armed,setArmed]=useState(false),[drag,setDrag]=useState<[number,number]|null>(null);
  const [lastUrl,setLastUrl]=useState(''),[message,setMessage]=useState('');
  const gesture=useRef<Gesture|null>(null),armedRef=useRef(false);
  const chooseRef=useRef<(x:number,y:number)=>void>(()=>undefined);
  const available=Boolean(map&&!disabled);

  useEffect(()=>{
    if(!map||disabled)return;
    const canvas=map.getCanvas();
    const cancel=()=>{armedRef.current=false;gesture.current=null;setArmed(false);setDrag(null);canvas.style.cursor='';};
    const choose=(x:number,y:number)=>{
      if(!canvas.isConnected)return;
      const local=streetViewCanvasPoint(canvas.getBoundingClientRect(),[x,y]);
      if(!local||document.elementFromPoint(x,y)!==canvas){cancel();setLastUrl('');setMessage('Drop onto the map to choose a location.');return;}
      const location=map.unproject(local),url=googleStreetViewUrl([location.lng,location.lat]);
      cancel();setMessage('Street View selected.');setLastUrl(url);
      window.open(url,'_blank','noopener,noreferrer');
    };
    chooseRef.current=choose;
    const click=(event:MouseEvent)=>{
      if(!armedRef.current)return;
      event.preventDefault();event.stopImmediatePropagation();choose(event.clientX,event.clientY);
    };
    const move=(event:MouseEvent)=>{
      if(!armedRef.current)return;
      canvas.style.cursor='crosshair';event.stopImmediatePropagation();
    };
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){cancel();setMessage('');}};
    canvas.addEventListener('click',click,true);canvas.addEventListener('mousemove',move,true);
    window.addEventListener('keydown',key);map.on('remove',cancel);
    return()=>{
      chooseRef.current=()=>undefined;armedRef.current=false;gesture.current=null;canvas.style.cursor='';
      canvas.removeEventListener('click',click,true);canvas.removeEventListener('mousemove',move,true);
      window.removeEventListener('keydown',key);map.off('remove',cancel);
    };
  },[map,disabled]);

  const arm=()=>{const next=!armedRef.current;armedRef.current=next;setArmed(next);setMessage('');};
  const pointerDown=(event:ReactPointerEvent<HTMLButtonElement>)=>{
    if(!available||event.button!==0)return;
    gesture.current={pointerId:event.pointerId,start:[event.clientX,event.clientY],dragged:false};
    event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
  };
  const pointerMove=(event:ReactPointerEvent<HTMLButtonElement>)=>{
    const active=gesture.current;if(!active||active.pointerId!==event.pointerId)return;
    if(Math.hypot(event.clientX-active.start[0],event.clientY-active.start[1])>5)active.dragged=true;
    if(active.dragged){setDrag([event.clientX,event.clientY]);setMessage('');}
  };
  const pointerUp=(event:ReactPointerEvent<HTMLButtonElement>)=>{
    const active=gesture.current;if(!active||active.pointerId!==event.pointerId)return;
    gesture.current=null;setDrag(null);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(active.dragged)chooseRef.current(event.clientX,event.clientY);else arm();
  };

  return <div className="workshop-street-view-control">
    <button type="button" disabled={!available} aria-label="Street View: drag onto the map or click to choose a location" aria-pressed={armed}
      title="Drag onto a street, or click then choose a point. Opens Google Street View in a new tab."
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={()=>{gesture.current=null;setDrag(null);}}
      onClick={event=>{if(event.detail===0)arm();}}>
      <Figure/><span>Street View</span>
    </button>
    {(armed||drag)&&<div className="workshop-street-view-tip" role="status">
      {drag?'Drop on a street to open Google Street View.':'Choose a point on the map. Opens Google Street View in a new tab.'}
      <button type="button" onClick={()=>{armedRef.current=false;setArmed(false);setDrag(null);}} aria-label="Cancel Street View selection">Cancel</button>
    </div>}
    {!armed&&!drag&&(lastUrl||message)&&<div className="workshop-street-view-tip" role="status">{message}{lastUrl&&<> <a href={lastUrl} target="_blank" rel="noreferrer">Open in Google ↗</a></>}</div>}
    {drag&&<div className="workshop-street-view-ghost" style={{left:drag[0],top:drag[1]}}><Figure/><i/></div>}
  </div>;
}
