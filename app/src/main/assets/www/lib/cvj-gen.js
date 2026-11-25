/* מחולל CVJ ל-Cabinet Vision: חדר מלבני של 4 קירות + רכיבים משוכפלים מספריית הרכיבים (CVJ_LIB) */
(function(){
'use strict';
var IN=25.4,DEFH=3528,DEFT=3656,X0=-2300,Y0=-1400;
var WOFF=[
  {x:5648,y:5768,ln:5830,th:5892,h:5954,th2:[6404,6468],f:[6806,6866,6928]},
  {x:7218,y:7338,ln:7400,th:7462,h:7524,th2:[7974,8038],f:[8362,8422,8484]},
  {x:8774,y:8894,ln:8956,th:9018,h:9080,th2:[9530,9594],f:[9918,9978,10040]},
  {x:10330,y:10450,ln:10512,th:10574,h:10636,th2:[11086,11150],f:[11474,11534,11596]}];
var PK=null;
function cat(arrs){var n=0,i,o,p=0;for(i=0;i<arrs.length;i++)n+=arrs[i].length;o=new Uint8Array(n);for(i=0;i<arrs.length;i++){o.set(arrs[i],p);p+=arrs[i].length;}return o;}
function u16(s){var o=new Uint8Array(s.length*2);for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);o[2*i]=c&255;o[2*i+1]=c>>8;}return o;}
function dv(b){return new DataView(b.buffer,b.byteOffset,b.byteLength);}
function putD(b,off,mm){dv(b).setFloat64(off,mm/IN,true);}
function bytes(a){return Uint8Array.from(a);}
function strBytes(s){var o=new Uint8Array(s.length);for(var i=0;i<s.length;i++)o[i]=s.charCodeAt(i);return o;}
function load(){
  if(PK)return PK;
  var L=window.CVJ_LIB;
  if(!L||!window.JSZip)return Promise.reject(new Error('nolib'));
  PK=JSZip.loadAsync(L.z,{base64:true}).then(function(z){
    var names=['blob','tpl'].concat(L.order.filter(function(n){return n!=='Contents';}).map(function(n){return 'S/'+n;})),o={};
    return Promise.all(names.map(function(n){return z.file(n).async('uint8array').then(function(d){o[n]=d;});})).then(function(){return o;});
  });
  return PK;
}
function pieces(b,toks,start,end){
  var p=[],cur=start,i;
  for(i=0;i<toks.length;i++){var t=toks[i];if(t[0]<start||t[0]>=end)continue;p.push(['raw',b.subarray(cur,t[0])]);p.push(['tag',t[2]]);cur=t[0]+t[1];}
  p.push(['raw',b.subarray(cur,end)]);return p;
}
function emit(pcs){
  var out=[],n=1,cls={},i,p;
  for(i=0;i<pcs.length;i++){
    p=pcs[i];
    if(p[0]==='raw'){out.push(p[1]);continue;}
    if(Object.prototype.hasOwnProperty.call(cls,p[1])){out.push(bytes([cls[p[1]]&255,(cls[p[1]]>>8)|0x80]));n+=1;}
    else{
      var nm=strBytes(p[1]);out.push(bytes([255,255,220,7,nm.length&255,nm.length>>8]));out.push(nm);cls[p[1]]=n;n+=2;
    }
  }
  return cat(out);
}
function renameRaw(raw,label){
  var o=6;
  if(raw[o]!==255||raw[o+1]!==254||raw[o+2]!==255)throw new Error('name');
  var e1=o+4+2*raw[o+3];
  if(raw[e1]!==255||raw[e1+1]!==254||raw[e1+2]!==255)throw new Error('desc');
  var e2=e1+4+2*raw[e1+3],enc=cat([bytes([255,254,255,label.length]),u16(label)]);
  return cat([raw.subarray(0,o),enc,enc,raw.subarray(e2)]);
}
function replaceAll(b,from,to){
  var out=[],cur=0,i,j,hit;
  for(i=0;i+from.length<=b.length;i++){
    if(b[i]!==from[0])continue;
    hit=true;for(j=1;j<from.length;j++)if(b[i+j]!==from[j]){hit=false;break;}
    if(hit){out.push(b.subarray(cur,i));out.push(to);cur=i+from.length;i+=from.length-1;}
  }
  out.push(b.subarray(cur));return cat(out);
}
function itemPieces(pk,def,inst,wallT,newId,gen){
  var rec=pk['blob'].slice(def.o,def.o+def.n),mm={},k;
  var ph=inst.open!==undefined?inst.open:def.open;
  var dm=gen?gen.shape.dim:def.dim;
  mm.DX=inst.dx!=null?inst.dx:dm[0];mm.DY=inst.dy!=null?inst.dy:dm[1];
  mm.DZ=inst.dz!=null?inst.dz:(ph?wallT:dm[2]);
  mm.X=inst.x||0;mm.Y=inst.y||0;mm.Z=inst.z!=null?inst.z:(ph?-wallT:0);
  for(k in mm){if(def.par[k]!=null)putD(rec,def.par[k],mm[k]);}
  ['X','Y','Z'].forEach(function(a){if(def.par[a+a]!=null)putD(rec,def.par[a+a],mm[a]);});
  var pcs=pieces(rec,def.toks,0,rec.length);
  pcs[2]=['raw',renameRaw(pcs[2][1],inst.label||(gen?gen.shape.he:def.he))];
  if(gen){/* החלפת מזהה התבנית של התורם במזהה הצורה החדשה */
    var pre=[3,0xe9,5,0,1,0,0,0,0,0],f1=pre.concat([gen.from&255,(gen.from>>8)&255,0,0]),t1=pre.concat([gen.id&255,(gen.id>>8)&255,0,0]);
    pcs=pcs.map(function(p){return p[0]==='raw'?['raw',replaceAll(p[1],bytes(f1),bytes(t1))]:p;});
    var mt=gen.shape.mat&&MATS[gen.shape.mat];
    if(mt){/* החלפת החומר של התורם (חרסינה) בחומר שנבחר: קוד ושם */
      var enc=function(x){return cat([bytes([255,254,255,x.length]),u16(x)]);},
          f2=[enc('PORC'),enc('Porcelain')],t2=[enc(mt[0]),enc(mt[1])];
      pcs=pcs.map(function(p){if(p[0]!=='raw')return p;var r=p[1];r=replaceAll(r,f2[0],t2[0]);r=replaceAll(r,f2[1],t2[1]);return ['raw',r];});
    }
  }
  if(newId){
    var from=bytes([def.id&255,def.id>>8,0,7]),to=bytes([newId&255,newId>>8,0,7]);
    pcs=pcs.map(function(p){return p[0]==='raw'?['raw',replaceAll(p[1],from,to)]:p;});
  }
  return pcs;
}
function wallsPatch(T,s){
  var b=T.slice(),w=s.w,d=s.d,t=s.t,h=s.h;
  putD(b,DEFH,h[0]);putD(b,DEFT,t[0]);
  var xr=X0+w+t[1],xl=X0-t[3],yb=Y0-t[0],yt=Y0+d+t[2];
  var st=[[X0,Y0],[X0+w,Y0],[X0+w,Y0+d],[X0,Y0+d]],ln=[w,d,w,d],
      fl=[w+t[3]+t[1],d+t[0]+t[2],w+t[3]+t[1],d+t[0]+t[2]],fc=[[xr,yb],[xr,yt],[xl,yt],[xl,yb]];
  var sb=s.stub||[];/* קיר שלא קיים: קצה זעיר (1 מ"מ) במקום קיר מלא */
  WOFF.forEach(function(W,i){
    var tt=sb[i]?1:t[i],hh=sb[i]?1:h[i],ll=sb[i]?1:ln[i];
    putD(b,W.x,st[i][0]);putD(b,W.y,st[i][1]);putD(b,W.ln,ll);putD(b,W.th,tt);putD(b,W.h,hh);
    W.th2.forEach(function(o){putD(b,o,tt);});
    putD(b,W.f[0],fc[i][0]);putD(b,W.f[1],fc[i][1]);putD(b,W.f[2],fl[i]);
  });
  return b;
}
/* ---- חדר עם מספר קירות כלשהו (1..9 קירות, כל זווית), לפי פענוח קובץ אמיתי של CV ----
   כל קיר הוא רשומה באורך קבוע בתבנית; קירות נוספים מוכפלים מרשומת קיר אמצעי, וכל רשומה מקבלת מזהה, קישורים לשכנים, זוויות ופינות.
   poly={walls:[{x,y,len,ang,th,h}],closed}: x,y תחילת הקיר (מ"מ, כפי שמוצג ב-CV: y למטה), ang זווית במעלות (שמאל-ימין 0, מטה -90),
   הקווים הם הפן הפנימי והעובי יוצא החוצה (שמאל כיוון ההליכה); קירות בכיוון השעון על המסך. */
var PW0=5624,PW1=7194,PW2=8750,PWL=10306,PBLK=[1319,1383],PINS=[1054,1040];
function normA(a){while(a>180)a-=360;while(a<=-180)a+=360;return a;}
function polyGeom(ws,closed){
  var n=ws.length,i;
  ws.forEach(function(w){var a=w.ang*Math.PI/180;w.d=[Math.cos(a),-Math.sin(a)];w.S=[w.x,w.y];w.E=[w.x+w.len*w.d[0],w.y+w.len*w.d[1]];w.n=[w.d[1],-w.d[0]];});
  function inter(a,b){
    var p1=[a.S[0]+a.n[0]*a.th,a.S[1]+a.n[1]*a.th],p2=[b.S[0]+b.n[0]*b.th,b.S[1]+b.n[1]*b.th],d1=a.d,d2=b.d,den=d1[0]*d2[1]-d1[1]*d2[0];
    if(Math.abs(den)<1e-9)return null;
    var s=((p2[0]-p1[0])*d2[1]-(p2[1]-p1[1])*d2[0])/den;return [p1[0]+d1[0]*s,p1[1]+d1[1]*s];
  }
  for(i=0;i<n;i++){
    var w=ws[i],pv=(i>0||closed)?ws[(i+n-1)%n]:null,nx=(i<n-1||closed)?ws[(i+1)%n]:null;
    w.prev=pv;w.next=nx;
    w.So=(pv&&inter(pv,w))||[w.S[0]+w.n[0]*w.th,w.S[1]+w.n[1]*w.th];
    w.Eo=(nx&&inter(w,nx))||[w.E[0]+w.n[0]*w.th,w.E[1]+w.n[1]*w.th];
    w.f2=Math.hypot(w.Eo[0]-w.So[0],w.Eo[1]-w.So[1]);
    w.alpha=pv?180-normA(pv.ang-w.ang):0;
  }
}
function polyTemplate(T0,tk0,poly){
  var ws=poly.walls.map(function(w){return {x:w.x,y:w.y,len:w.len,ang:w.ang,th:w.th,h:w.h};}),N=ws.length,closed=!!poly.closed,i;
  if(N<2||N>9)throw new Error('walls:'+N);
  polyGeom(ws,closed);
  var head=T0.slice(0,PW0),recs=[T0.slice(PW0,PW1)],mid=T0.slice(PW1,PW2),last=T0.slice(PWL);
  for(i=1;i<N-1;i++)recs.push(mid.slice());
  if(!closed){var l2=new Uint8Array(last.length-(PBLK[1]-PBLK[0]));l2.set(last.subarray(0,PBLK[0]));l2.set(last.subarray(PBLK[1]-0),PBLK[0]);last=l2;}
  recs.push(last);
  var v16=function(b,o,x){dv(b).setUint16(o,x,true);},
      D=function(b,o,x){dv(b).setFloat64(o,x,true);},
      mm=function(b,o,x){D(b,o,x/IN);};
  mm(head,DEFH,Math.max.apply(null,ws.map(function(w){return w.h;})));mm(head,DEFT,Math.max.apply(null,ws.map(function(w){return w.th;})));v16(head,5536,N);
  v16(head,5088,N);/* מונה קירות נוסף בראש הקובץ (בקובץ אמיתי של CV עם 3 קירות: 3) */
  ws.forEach(function(w,i){
    var b=recs[i],sh=i===0?14:0,x=24,pv=w.prev?(i>0?i:N):0,nx=w.next?(i<N-1?i+2:1):0;
    mm(b,x,w.x);mm(b,x+120,w.y);mm(b,x+182,w.len);mm(b,x+244,w.th);mm(b,x+306,w.h);
    D(b,x+430,w.ang);D(b,x+692,w.alpha);
    mm(b,x+756,w.next?w.th/Math.tan(w.next.alpha*Math.PI/360):0);
    mm(b,x+820,w.prev&&w.alpha?w.th/Math.tan(w.alpha*Math.PI/360):0);
    mm(b,x+1144+sh,w.Eo[0]);mm(b,x+1204+sh,w.Eo[1]);mm(b,x+1266+sh,w.f2);D(b,x+1328+sh,normA(w.ang+180));
    if(i<N-1)D(b,1416+sh,w.next?-w.next.alpha:0);
    v16(b,890,i+1);v16(b,896,pv);v16(b,898,nx);
    v16(b,1030+sh,i+1);v16(b,1032+sh,pv?1:0);/* 0 כשאין קיר לפני (תחילת שרשרת פתוחה) */
    b[1120+sh]=nx?5:4;/* 4 כשאין קיר אחרי (סוף שרשרת פתוחה), כמו בקובץ של CV */
    if(i>0&&i<N-1)b[1488]=5+i;/* מזהה רץ לכל קיר אמצעי (5,6,7...). בהעתקה מהקיר האמצעי של התבנית כולם קיבלו 6, ו-CV קישר קירות לא נכונים */v16(b,1034+sh,pv);v16(b,1036+sh,nx?1:0);v16(b,1038+sh,nx);
    var s3=sh-((!closed&&i===N-1)?(PBLK[1]-PBLK[0]):0);/* בשרשרת פתוחה הרשומה האחרונה קצרה ב-64 בתים לפני הקבוצה השלישית */
    v16(b,1464+s3,i+1);v16(b,1466+s3,nx?2:0);v16(b,1468+s3,nx);v16(b,1470+s3,pv?2:0);v16(b,1472+s3,pv);
  });
  var starts=[],tot=head.length;
  recs.forEach(function(r){starts.push(tot);tot+=r.length;});
  var T=new Uint8Array(tot);T.set(head,0);recs.forEach(function(r,k){T.set(r,starts[k]);});
  /* שמות הקירות: "<מספר> קיר" */
  var nameAt=0;
  for(i=0;i+14<T.length&&nameAt<N;i++){
    if(T[i]===255&&T[i+1]===254&&T[i+2]===255&&T[i+3]===5&&T[i+5]===0&&T[i+6]===32&&T[i+7]===0&&T[i+8]===0xe7&&T[i+9]===5&&T[i+10]===0xd9&&T[i+11]===5&&T[i+12]===0xe8&&T[i+13]===5){T[i+4]=0x31+nameAt;nameAt++;}
  }
  /* תגי מחלקה: ראש, קיר ראשון, קיר אמצעי לכל קיר, קיר אחרון */
  var tk=[],blkLen=PBLK[1]-PBLK[0];
  tk0.forEach(function(t){if(t[0]<PW0)tk.push(t.slice());else if(t[0]<PW1)tk.push([t[0]-PW0+starts[0],t[1],t[2]]);});
  for(i=1;i<N-1;i++)tk0.forEach(function(t){if(t[0]>=PW1&&t[0]<PW2)tk.push([t[0]-PW1+starts[i],t[1],t[2]]);});
  tk0.forEach(function(t){
    if(t[0]<PWL)return;var r=t[0]-PWL;
    if(!closed&&r>=PBLK[0]&&r<PBLK[1])return;
    tk.push([starts[N-1]+r-((!closed&&r>=PBLK[1])?blkLen:0),t[1],t[2]]);
  });
  var ins=starts.map(function(s,k){return s+PINS[k===0?0:1];});
  return {T:T,tk:tk,ins:ins,n:N};
}
function contents(pk,s,ctx){
  var L=window.CVJ_LIB,SH=window.CVJ_SHAPES,PT=s.poly?polyTemplate(pk['tpl'],L.tpl.toks,s.poly):null,T=PT?PT.T:wallsPatch(pk['tpl'],s),N=PT?PT.n:4,byKey={},i;
  L.items.forEach(function(d){byKey[d.k]=d;});
  var perWall=[],seen={},nid=2032;for(i=0;i<N;i++)perWall.push([]);
  (s.items||[]).forEach(function(it){
    var shp=SH&&SH[it.key]&&SH[it.key].build?SH[it.key]:null,gen=null;
    var d=shp?byKey[SH_DONOR]:byKey[it.key];if(!d)throw new Error('nokey:'+it.key);
    if(shp){
      if(!ctx.tpl[it.key]){ctx.tpl[it.key]={id:ctx.next++,shape:shp};}
      gen={from:SH_DONOR_TPL,id:ctx.tpl[it.key].id,shape:shp};
    }
    var w=Math.max(0,Math.min(N-1,it.wall|0)),newId=0,sk=shp?'~'+it.key:d.k;
    if(seen[sk])newId=nid++;else seen[sk]=1;
    perWall[w].push(itemPieces(pk,d,it,PT?s.poly.walls[w].th:s.t[w],newId,gen));
  });
  var pcs=[],cur=0,ins=PT?PT.ins:L.tpl.ins,tk=PT?PT.tk:L.tpl.toks;
  for(i=0;i<N;i++){
    var its=perWall[i];if(!its.length)continue;
    var h=ins[i];
    Array.prototype.push.apply(pcs,pieces(T,tk,cur,h));
    var hb=T.slice(h,h+10);hb[4]=its.length&255;hb[5]=its.length>>8;pcs.push(['raw',hb]);
    its.forEach(function(p){Array.prototype.push.apply(pcs,p);});
    cur=h+10;
  }
  Array.prototype.push.apply(pcs,pieces(T,tk,cur,T.length));
  return emit(pcs);
}
/* ---- כתיבת קובץ CFB (מכולה) ---- */
function writeCFB(streams){
  var SS=512,MSS=64,CUT=4096,FREE=0xFFFFFFFF,EOC=0xFFFFFFFE,FATSECT=0xFFFFFFFD,DIFSECT=0xFFFFFFFC,NOS=0xFFFFFFFF;
  var mini=[],minifat=[],info={},sectors=[],fat=[],i,j;
  streams.forEach(function(s){
    var n=s[0],d=s[1];
    if(d.length<CUT){
      var start=minifat.length,cnt=Math.ceil(d.length/MSS);
      for(i=0;i<cnt;i++)minifat.push(i<cnt-1?start+i+1:EOC);
      var pad=new Uint8Array(cnt*MSS);pad.set(d);mini.push(pad);info[n]=[start,d.length];
    }
  });
  function alloc(d){
    if(!d.length)return EOC;
    var cnt=Math.ceil(d.length/SS),start=sectors.length;
    for(var k=0;k<cnt;k++){var sec=new Uint8Array(SS);sec.set(d.subarray(k*SS,(k+1)*SS));sectors.push(sec);fat.push(k<cnt-1?start+k+1:EOC);}
    return start;
  }
  streams.forEach(function(s){if(s[1].length>=CUT)info[s[0]]=[alloc(s[1]),s[1].length];});
  var miniB=cat(mini),ministart=miniB.length?alloc(miniB):EOC;
  var mf=new Uint8Array(minifat.length*4);for(i=0;i<minifat.length;i++)dv(mf).setUint32(i*4,minifat[i],true);
  var mfstart=minifat.length?alloc(mf):EOC,nmf=minifat.length?Math.ceil(mf.length/SS):0;
  var ents=[{name:'Root Entry',typ:5,start:ministart,size:miniB.length,l:NOS,r:NOS,c:NOS}];
  streams.forEach(function(s){ents.push({name:s[0],typ:2,start:info[s[0]][0],size:info[s[0]][1],l:NOS,r:NOS,c:NOS});});
  var idx=[];for(i=1;i<ents.length;i++)idx.push(i);
  idx.sort(function(a,b){var A=ents[a].name,B=ents[b].name;if(A.length!==B.length)return A.length-B.length;A=A.toUpperCase();B=B.toUpperCase();return A<B?-1:(A>B?1:0);});
  function build(l){if(!l.length)return NOS;var m=l.length>>1,k=l[m];ents[k].l=build(l.slice(0,m));ents[k].r=build(l.slice(m+1));return k;}
  ents[0].c=build(idx);
  function packent(e){
    var o=new Uint8Array(128),v=dv(o),nm=u16(e.name),k;
    o.set(nm,0);
    var nlen=nm.length+2;
    v.setUint16(64,nlen,true);o[66]=e.typ;o[67]=1;
    v.setUint32(68,e.l,true);v.setUint32(72,e.r,true);v.setUint32(76,e.c,true);
    v.setUint32(116,e.start,true);v.setUint32(120,e.size>>>0,true);v.setUint32(124,Math.floor(e.size/4294967296),true);
    return o;
  }
  var dp=ents.map(packent);
  while(dp.length%4)dp.push(packent({name:'',typ:0,start:0,size:0,l:NOS,r:NOS,c:NOS}));
  var dirstart=alloc(cat(dp));
  var nonfat=sectors.length,nfat=1,ndif=0,need,nd;
  for(;;){
    need=Math.ceil((nonfat+nfat+ndif)/128);nd=need<=109?0:Math.ceil((need-109)/127);
    if(need===nfat&&nd===ndif)break;nfat=need;ndif=nd;
  }
  var fatsecs=[],difsecs=[];
  for(i=0;i<nfat;i++){fatsecs.push(nonfat+i);fat.push(FATSECT);}
  for(i=0;i<ndif;i++){difsecs.push(nonfat+nfat+i);fat.push(DIFSECT);}
  while(fat.length<nfat*128)fat.push(FREE);
  var fb=new Uint8Array(nfat*512);for(i=0;i<fat.length;i++)dv(fb).setUint32(i*4,fat[i],true);
  for(i=0;i<nfat;i++)sectors.push(fb.subarray(i*512,(i+1)*512));
  var rest=fatsecs.slice(109);
  for(j=0;j<ndif;j++){
    var sec=new Uint8Array(512),sv=dv(sec),ch=rest.slice(j*127,(j+1)*127);
    for(i=0;i<127;i++)sv.setUint32(i*4,i<ch.length?ch[i]:FREE,true);
    sv.setUint32(508,j+1<ndif?difsecs[j+1]:EOC,true);sectors.push(sec);
  }
  var hdr=new Uint8Array(512),hv=dv(hdr);
  hdr.set([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1],0);
  hv.setUint16(24,0x3E,true);hv.setUint16(26,3,true);hv.setUint16(28,0xFFFE,true);hv.setUint16(30,9,true);hv.setUint16(32,6,true);
  hv.setUint32(44,nfat,true);hv.setUint32(48,dirstart,true);hv.setUint32(52,0,true);hv.setUint32(56,CUT,true);
  hv.setUint32(60,mfstart,true);hv.setUint32(64,nmf,true);hv.setUint32(68,ndif?difsecs[0]:EOC,true);hv.setUint32(72,ndif,true);
  for(i=0;i<109;i++)hv.setUint32(76+i*4,i<fatsecs.length?fatsecs[i]:FREE,true);
  return cat([hdr].concat(sectors));
}
var MATS={porc:['PORC','Porcelain'],wood:['WOOD','Wood'],glass:['GLASS','Glass'],iron:['CHROME','Chrome']};
var SH_DONOR='Bidet',SH_DONOR_TPL=6434,SH_PREFIX=[0x4d,0x80,1,0xcf,0,0,0,0,0xff,0xfe,0xff,0,0xff,0xfe,0xff,0,1,0,0,0,1,0xe9,0x1a,0,0,0,0,0,1,0xe9,0,0,0,0,8,0,0,0];
/* מוסיף תבניות חדשות לסוף זרם Shapes ומעדכן את מונה התבניות בראשו */
function shapesWith(base,ctx){
  var list=[],k;
  for(k in ctx.tpl){
    var t=ctx.tpl[k],M=window.CVJ_SHAPES._tools,m=M.fit(M.scale(t.shape.build(),1/IN));
    list.push(window.CVJ_SHAPES._tools.template(SH_PREFIX,t.id,m));
  }
  if(!list.length)return base;
  var out=cat([base].concat(list));
  var n=dv(out).getUint16(2,true);dv(out).setUint16(2,n+list.length,true);
  return out;
}
function build(spec){
  return load().then(function(pk){
    var L=window.CVJ_LIB,ctx={tpl:{},next:9100},c=contents(pk,spec,ctx);
    var shp=shapesWith(pk['S/Shapes'],ctx);
    return writeCFB(L.order.map(function(n){return [n,n==='Contents'?c:(n==='Shapes'?shp:pk['S/'+n])];}));
  });
}
window.cvjBuild=build;
window.cvjLibItems=function(){return window.CVJ_LIB?window.CVJ_LIB.items:[];};
window.cvjTest={writeCFB:writeCFB,contents:contents,load:load};
if(typeof module!=='undefined')module.exports={build:build,load:load,contents:contents,writeCFB:writeCFB};
})();
