/* מחולל צורות תלת-ממדיות ל-Cabinet Vision: בונה רשתות (mesh) מפרימיטיבים וכותב אותן כתבניות CVTemplate3d בזרם Shapes של CVJ.
   יחידות הרשת: אינץ' (כמו בקובץ). הצורות נבנות כאן במ"מ ומומרות. ציר Y הוא גובה, Z עומק (אחורי = 0, צמוד לקיר), X רוחב. */
(function(){
'use strict';
var TAU=Math.PI*2,IN=25.4;
/* ---------- פרימיטיבים ---------- */
function sgn(v){return v<0?-1:1;}
function sp(c,p){return sgn(c)*Math.pow(Math.abs(c),2/p);}
/* חתך סגלגל (סופר-אליפסה) סביב (cx,cz) בגובה y. rzf = חצי עומק קדמי, rzb = אחורי. p=2 אליפסה, גדול יותר = מלבני */
function sec(y,cx,cz,rx,rzf,rzb,p,n){
  var a=[],i,t,c,s;
  for(i=0;i<n;i++){t=TAU*i/n;c=Math.cos(t);s=Math.sin(t);a.push([cx+rx*sp(c,p),y,cz+(s>=0?rzf:rzb)*sp(s,p)]);}
  return a;
}
function circ(cx,y,cz,r,n){return sec(y,cx,cz,r,r,r,2,n);}
function tri(M,a,b,c,fa,fb,fc){M.f.push([[a,fa],[b,fb],[c,fc]]);}
/* שיפוע בין חתכים סמוכים. wrap: חיבור החתך האחרון לראשון (טבעת). caps: סגירת הקצוות במניפה */
function loft(secs,o){
  o=o||{};var M={v:[],f:[]},n=secs[0].length,K=secs.length,k,i;
  secs.forEach(function(s){s.forEach(function(p){M.v.push(p);});});
  function id(k,i){return k*n+((i%n)+n)%n;}
  var last=o.wrap?K:K-1;
  for(k=0;k<last;k++){
    var k2=(k+1)%K;
    for(i=0;i<n;i++){
      var a=id(k,i),b=id(k,i+1),c=id(k2,i+1),d=id(k2,i);
      tri(M,a,b,c,1,1,0);tri(M,a,c,d,0,1,1);
    }
  }
  if(!o.wrap&&o.caps!==false){
    [0,K-1].forEach(function(kk,w){
      var cx=0,cy=0,cz=0;
      secs[kk].forEach(function(p){cx+=p[0];cy+=p[1];cz+=p[2];});
      var ci=M.v.length;M.v.push([cx/n,cy/n,cz/n]);
      for(i=0;i<n;i++){
        if(w===0)tri(M,ci,id(kk,i+1),id(kk,i),0,1,0);else tri(M,ci,id(kk,i),id(kk,i+1),0,1,0);
      }
    });
  }
  return orient(M);
}
function volume(M){
  var s=0,i,j;
  M.f.forEach(function(f){
    var a=M.v[f[0][0]];
    for(j=1;j<f.length-1;j++){
      var b=M.v[f[j][0]],c=M.v[f[j+1][0]];
      s+=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
    }
  });
  return s/6;
}
function orient(M){
  if(volume(M)<0)M.f=M.f.map(function(f){return f.slice().reverse();});
  return M;
}
function box(x0,y0,z0,x1,y1,z1){
  var M={v:[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],f:[]};
  [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]].forEach(function(q){
    tri(M,q[0],q[1],q[2],1,1,0);tri(M,q[0],q[2],q[3],0,1,1);
  });
  return orient(M);
}
/* צינור לאורך מסלול: נקודות P[k] ורדיוס r[k] */
function sweep(P,R,n,caps){
  var secs=[],k,i,tg,u,v,t0;
  function norm(a){var l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  var prevU=null,rf=typeof R==='function'?R:function(){return R;};
  for(k=0;k<P.length;k++){
    var a=P[Math.max(0,k-1)],b=P[Math.min(P.length-1,k+1)];
    tg=norm([b[0]-a[0],b[1]-a[1],b[2]-a[2]]);
    if(!prevU){u=Math.abs(tg[1])<0.9?cross(tg,[0,1,0]):cross(tg,[1,0,0]);u=norm(u);}
    else{u=prevU;var d=u[0]*tg[0]+u[1]*tg[1]+u[2]*tg[2];u=norm([u[0]-d*tg[0],u[1]-d*tg[1],u[2]-d*tg[2]]);}
    v=norm(cross(tg,u));prevU=u;
    var s=[];
    for(i=0;i<n;i++){
      t0=TAU*i/n;var rr=rf(k/(P.length-1)),c=Math.cos(t0)*rr,sn=Math.sin(t0)*rr;
      s.push([P[k][0]+c*u[0]+sn*v[0],P[k][1]+c*u[1]+sn*v[1],P[k][2]+c*u[2]+sn*v[2]]);
    }
    secs.push(s);
  }
  return loft(secs,{caps:caps!==false});
}
/* קשת חלקה: נקודות לאורך מסלול עם עיגול פינות (רדיוס rr) */
function path(pts,rr,seg){
  var out=[pts[0]],i,k;
  for(i=1;i<pts.length-1;i++){
    var a=pts[i-1],b=pts[i],c=pts[i+1];
    function un(p,q){var l=Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2])||1;return [(q[0]-p[0])/l,(q[1]-p[1])/l,(q[2]-p[2])/l];}
    var d1=un(b,a),d2=un(b,c),r=Math.min(rr,Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])/2,Math.hypot(c[0]-b[0],c[1]-b[1],c[2]-b[2])/2);
    var p0=[b[0]+d1[0]*r,b[1]+d1[1]*r,b[2]+d1[2]*r],p1=[b[0]+d2[0]*r,b[1]+d2[1]*r,b[2]+d2[2]*r];
    for(k=0;k<=seg;k++){var t=k/seg,m=(1-t)*(1-t),m2=2*(1-t)*t,m3=t*t;
      out.push([m*p0[0]+m2*b[0]+m3*p1[0],m*p0[1]+m2*b[1]+m3*p1[1],m*p0[2]+m2*b[2]+m3*p1[2]]);}
  }
  out.push(pts[pts.length-1]);return out;
}
function merge(list){
  var M={v:[],f:[]};
  list.forEach(function(m){
    var off=M.v.length;
    m.v.forEach(function(p){M.v.push(p);});
    m.f.forEach(function(f){M.f.push(f.map(function(q){return [q[0]+off,q[1]];}));});
  });
  return M;
}
function bounds(M){
  var lo=[1e30,1e30,1e30],hi=[-1e30,-1e30,-1e30];
  M.v.forEach(function(p){for(var i=0;i<3;i++){if(p[i]<lo[i])lo[i]=p[i];if(p[i]>hi[i])hi[i]=p[i];}});
  return {lo:lo,hi:hi,d:[hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]]};
}
/* הזזה כך שהמינימום ב-0, ואם נתון dims מתיחה לגודל המדויק */
function fit(M,dims){
  var b=bounds(M),s=[1,1,1];
  if(dims)for(var i=0;i<3;i++)s[i]=b.d[i]>1e-9?dims[i]/b.d[i]:1;
  return {v:M.v.map(function(p){return [(p[0]-b.lo[0])*s[0],(p[1]-b.lo[1])*s[1],(p[2]-b.lo[2])*s[2]];}),f:M.f};
}
function scale(M,k){return {v:M.v.map(function(p){return [p[0]*k,p[1]*k,p[2]*k];}),f:M.f};}
function move(M,x,y,z){return {v:M.v.map(function(p){return [p[0]+x,p[1]+y,p[2]+z];}),f:M.f};}
/* בדיקת סגירות: כל קשת מכוונת מופיעה פעם אחת והקשת ההפוכה פעם אחת */
function check(M){
  var e={},bad=0;
  M.f.forEach(function(f){for(var i=0;i<f.length;i++){var a=f[i][0],b=f[(i+1)%f.length][0],k=a+'>'+b;e[k]=(e[k]||0)+1;}});
  for(var k in e){var p=k.split('>'),r=p[1]+'>'+p[0];if(e[k]!==1||e[r]!==1)bad++;}
  return bad;
}
/* ---------- סריאליזציה לתבנית CVTemplate3d ---------- */
function toBytes(M,id,hdr){
  var n=M.v.length,nf=M.f.length,size=hdr.length+0,i,j,len=0;
  var fl=0;M.f.forEach(function(f){fl+=6+4+4*f.length+4;});
  var total=4+hdr.length+6+n*(2+24+4)+4+fl;
  var b=new Uint8Array(total),dv=new DataView(b.buffer),p=4;
  b[0]=1;/* כל רשומה ברשימה נפתחת ב-01 00 00 00 */
  b.set(hdr,4);dv.setUint32(8,id,true);p=4+hdr.length;
  /* הגדרת הגבולות נעשית ע"י הקורא (כבר בתוך hdr) */
  b[p++]=1;b[p++]=0xe9;dv.setUint16(p,n,true);p+=2;b[p++]=0;b[p++]=0;
  for(i=0;i<n;i++){
    b[p++]=0x4f;b[p++]=0x80;
    for(j=0;j<3;j++){dv.setFloat64(p,Math.fround(M.v[i][j]),true);p+=8;}
    b[p++]=0;b[p++]=0;b[p++]=1;b[p++]=0;
  }
  dv.setUint32(p,nf,true);p+=4;
  M.f.forEach(function(f){
    b[p++]=0x68;b[p++]=0x80;b[p++]=2;b[p++]=0xe9;dv.setUint16(p,f.length,true);p+=2;
    b[p++]=0x0f;b[p++]=0x0f;b[p++]=0;b[p++]=5;
    f.forEach(function(q){dv.setUint16(p,q[0],true);p+=2;dv.setUint16(p,q[1],true);p+=2;});
    p+=4;
  });
  return b;
}
/* כותרת תבנית: 38 בתים קבועים (prefix), אז מידות (inch) ויחס */
function template(prefix,id,M){
  var hdr=new Uint8Array(86),dv=new DataView(hdr.buffer),b=bounds(M),i;
  hdr.set(prefix,0);
  for(i=0;i<3;i++){dv.setFloat64(38+8*i,b.d[i],true);dv.setFloat64(62+8*i,1,true);}
  return toBytes(M,id,hdr);
}
/* ---------- צורות ---------- */
var S={};/* שם -> {he, dim:[mm רוחב,גובה,עומק], y: גובה ברירת מחדל מהרצפה (mm), build:function()->mesh (במ"מ)} */
/* גליל לאורך Z */
function cylZ(x,y,z0,z1,r,n){
  var c=circ(0,0,0,r,n||20);
  return loft([c.map(function(p){return [p[0]+x,p[2]+y,z0];}),c.map(function(p){return [p[0]+x,p[2]+y,z1];})]);
}
/* גליל לאורך Y */
function cylY(x,z,y0,y1,r,n){
  var c=circ(0,0,0,r,n||20);
  return loft([c.map(function(p){return [p[0]+x,y0,p[2]+z];}),c.map(function(p){return [p[0]+x,y1,p[2]+z];})]);
}
S.faucet={he:'ברז',dim:[64,115,100],y:1000,build:function(){
  var n=20,parts=[];
  parts.push(cylZ(32,70,0,7,30,n));               /* רוזטה בקיר */
  parts.push(cylZ(32,70,7,36,13,n));              /* גוף */
  parts.push(sweep(path([[32,70,30],[32,70,78],[32,52,88],[32,20,88],[32,8,88]],16,8),function(t){return 11;},n));/* זרבובית קשתית */
  parts.push(cylY(32,88,0,10,14,n));              /* פיית יציאה */
  parts.push(cylY(32,36,70,92,7,16));             /* גזע הידית */
  parts.push(box(6,88,28,58,100,44));             /* ידית */
  return merge(parts);
}};
/* ---- עזרים לצורות ---- */
function rrect(y,x0,x1,z0,z1,r,n){/* מלבן מעוגל כחתך סופר-אליפסה */
  var cx=(x0+x1)/2,cz=(z0+z1)/2,rx=(x1-x0)/2,rz=(z1-z0)/2,p=Math.max(2.2,Math.min(12,rx/Math.max(r,1)*1.1));
  return sec(y,cx,cz,rx,rz,rz,p,n);
}
function slab(x0,y0,z0,x1,y1,z1,r){/* מלבן מעוגל מאונך מוגבה */
  return loft([rrect(y0,x0,x1,z0,z1,r,40),rrect(y1,x0,x1,z0,z1,r,40)]);
}
function tube(xs){return loft(xs);}
/* קערה חלולה: חתכים חיצוניים מלמטה למעלה ואז פנימיים מלמעלה למטה */
function hollow(outer,inner){return loft(outer.concat(inner));}
/* טבעת (מושב): חתך חיצוני ופנימי */
function ringSeat(y0,y1,cx,cz,rxO,rzfO,rzbO,rxI,rzfI,rzbI,p,n){
  return loft([sec(y0,cx,cz,rxO,rzfO,rzbO,p,n),sec(y1,cx,cz,rxO,rzfO,rzbO,p,n),sec(y1,cx,cz,rxI,rzfI,rzbI,p,n),sec(y0,cx,cz,rxI,rzfI,rzbI,p,n)],{wrap:true});
}
/* ---- כיור קיר ---- */
S.sink={he:'כיור',dim:[560,190,450],y:850,build:function(){
  var n=48,cz=60,O=function(y,rx,rzf,rzb,p){return sec(y,280,cz,rx,rzf,rzb,p,n);};
  var bowl=hollow([O(0,120,130,25,2.4),O(40,190,200,30,2.6),O(120,265,330,35,3),O(180,280,390,40,3.2)],
                  [O(180,245,355,18,3),O(140,225,320,18,2.8),O(60,170,230,18,2.4),O(30,120,150,18,2.2)]);
  return merge([bowl,cylY(280,cz-30,2,32,28,20)]);
}};
/* ---- אסלה תלויה ---- */
function bowlWall(rimY){
  var n=48,cz=265,O=function(y,rx,rzf,rzb,p){return sec(y,180,cz,rx,rzf,rzb,p,n);};
  return hollow([O(10,90,200,210,2.2),O(110,150,255,230,2.4),O(250,175,270,245,2.6),O(rimY,180,275,250,2.8)],
                [O(rimY,142,232,208,2.4),O(rimY-60,128,215,195,2.2),O(rimY-180,85,165,150,2.2),O(rimY-220,60,120,110,2.2)]);
}
function seatWall(y0,y1){return ringSeat(y0,y1,180,265,185,282,258,138,226,200,2.5,48);}
S.wcw={he:'אסלה תלויה',dim:[370,400,560],y:40,build:function(){
  return merge([bowlWall(340),seatWall(340,372)]);
}};
/* ---- אסלה סמויה: גוף מכוסה בקיר עם לחצן הדחה ---- */
S.wcc={he:'אסלה סמויה (מיכל בקיר)',dim:[500,1150,640],y:0,build:function(){
  var casing=slab(0,0,0,500,1150,140,20);
  var bowl=move(bowlWall(340),70,380,130),seat=move(seatWall(340,372),70,380,130);
  var plate=slab(125,820,138,375,1000,150,10);
  var b1=cylZ(190,910,150,158,32,24),b2=cylZ(310,910,150,158,32,24);
  return merge([casing,bowl,seat,plate,b1,b2]);
}};
/* ---- שקע חשמל ---- */
S.socket={he:'שקע חשמל',dim:[80,80,25],y:300,build:function(){
  var plate=slab(0,0,0,80,80,8,8);
  var ring=cylZ(40,40,8,14,27,32);
  var inner=cylZ(40,40,14,20,22,32);
  var ph=cylZ(28,40,20,22,4,12),ph2=cylZ(52,40,20,22,4,12);
  return merge([rot90(plate),rot90(ring),rot90(inner),rot90(ph),rot90(ph2)]);
}};
function rot90(M){return M;}/* שמור לעתיד: צירים כבר תואמים (Z=עומק) */
/* ---- מתג חשמל ---- */
S.switch={he:'מתג',dim:[80,80,18],y:1100,build:function(){
  var plate=slab(0,0,0,80,80,6,8),frame=slab(14,14,6,66,66,9,4);
  var rock=slab(22,22,9,58,58,15,4);
  return merge([plate,frame,rock]);
}};
/* ---- נקודת תאורה (פלפון תקרה) ---- */
S.light={he:'גוף תאורה',dim:[200,60,200],y:2640,build:function(){
  var n=40,sc=function(y,r){return circ(100,y,100,r,n);};
  return loft([sc(0,100),sc(8,100),sc(22,92),sc(40,70),sc(55,40),sc(60,8)]);
}};
/* ---- ניקוז רצפה ---- */
S.fdrain={he:'ניקוז רצפתי',dim:[110,12,110],y:0,build:function(){
  var n=36,parts=[];
  parts.push(loft([circ(55,0,55,55,n),circ(55,10,55,55,n)]));
  var grate=loft([circ(55,10,55,50,n),circ(55,12,55,50,n)]);
  parts.push(grate);
  for(var i=0;i<3;i++)parts.push(cylY(55,55,12,14,12+i*13,n));
  return merge(parts);
}};
/* ---- ניקוז קיר (צינור ביוב עם אוגן) ---- */
S.drain={he:'ניקוז קירי',dim:[120,120,110],y:200,build:function(){
  return merge([cylZ(60,60,0,12,60,32),cylZ(60,60,12,95,50,32),cylZ(60,60,95,110,56,32)]);
}};
/* ---- צינור מים ביציאה מהקיר ---- */
S.pipe={he:'צינור מים',dim:[40,40,90],y:400,build:function(){
  return merge([cylZ(20,20,0,10,20,24),cylZ(20,20,10,85,11,24),cylZ(20,20,85,90,14,24)]);
}};
/* ---- נקודת גז: צינור וברז כדורי ---- */
S.gas={he:'נקודת גז',dim:[60,50,100],y:550,build:function(){
  return merge([cylZ(25,25,0,10,22,24),cylZ(25,25,10,95,10,20),slab(6,15,40,44,35,62,5),box(2,22,62,48,28,98)]);
}};
/* ---- מזגן עילי ---- */
S.ac={he:'מזגן',dim:[900,290,220],y:2100,build:function(){
  var n=40,body=loft([rrect(0,0,900,0,170,40,n),rrect(60,0,900,0,205,40,n),rrect(230,0,900,0,215,40,n),rrect(290,0,900,0,190,40,n)]);
  var vent=slab(30,16,200,870,50,214,10);
  return merge([body,vent]);
}};
/* ---- רדיאטור פאנל ---- */
S.rad={he:'רדיאטור',dim:[800,600,100],y:150,build:function(){
  var parts=[slab(0,30,0,800,570,40,8)],i;
  for(i=0;i<16;i++)parts.push(box(10+i*48,50,40,40+i*48,550,95));
  parts.push(cylY(30,45,0,30,12,16),cylY(770,45,0,30,12,16));
  return merge(parts);
}};
/* ---- ארון חשמל / תקשורת ---- */
S.panel={he:'ארון',dim:[400,600,100],y:1300,build:function(){
  return merge([slab(0,0,0,400,600,60,8),slab(18,18,60,382,582,92,6),box(330,280,92,350,330,100)]);
}};
/* ---- עמוד עגול ---- */
S.column={he:'עמוד עגול',dim:[300,2600,300],y:0,build:function(){
  var n=40,sc=function(y,r){return circ(150,y,150,r,n);};
  return loft([sc(0,150),sc(60,150),sc(70,140),sc(2530,140),sc(2540,150),sc(2600,150)]);
}};
/* ---- צורות כלליות למחולל הרכיבים (נמתחות לכל מידה) ---- */
S.g_cylY={he:'גליל עומד',dim:[300,1000,300],y:0,gen:1,build:function(){return cylY(150,150,0,1000,150,40);}};
S.g_cylZ={he:'גליל אופקי',dim:[300,300,1000],y:0,gen:1,build:function(){return cylZ(150,150,0,1000,150,40);}};
S.g_dome={he:'כיפה',dim:[400,200,400],y:0,gen:1,build:function(){
  var n=40,k=[0,0.38,0.7,0.9,1],a=k.map(function(t){return [Math.sqrt(Math.max(0,1-t*t)),t];});
  return loft(a.map(function(q){return circ(200,200*q[1],200,Math.max(q[0]*200,1),n);}));
}};
S.g_box={he:'קופסה',dim:[600,876.3,400],y:0,gen:1,build:function(){return box(0,0,0,600,876.3,400);}};
S.g_rbox={he:'קופסה מעוגלת',dim:[600,600,600],y:0,gen:1,build:function(){return slab(0,0,0,600,600,600,60);}};
S.g_bowl={he:'קערה',dim:[500,200,400],y:0,gen:1,build:function(){
  var n=48,O=function(y,rx,rz,p){return sec(y,250,200,rx,rz,rz,p,n);};
  return hollow([O(0,110,90,2.2),O(60,190,150,2.2),O(200,250,200,2.4)],[O(200,232,182,2.4),O(70,172,132,2.2),O(20,95,75,2.2)]);
}};
S.g_tub={he:'אמבט',dim:[1500,500,700],y:0,gen:1,build:function(){
  var n=56,R=function(y,i){return rrect(y,i,1500-i,i,700-i,120-i*0.6,n);};
  return hollow([R(0,60),R(100,20),R(500,0)],[R(500,60),R(380,100),R(120,220)]);
}};
S._tools={rrect:rrect,slab:slab,cylZ:cylZ,cylY:cylY,sec:sec,circ:circ,loft:loft,box:box,sweep:sweep,path:path,merge:merge,fit:fit,move:move,scale:scale,bounds:bounds,check:check,volume:volume,template:template};
/* המידות הרשומות = תיבת התוחמת האמיתית של הרשת, כדי שאין מתיחה */
Object.keys(S).forEach(function(k){if(!S[k].build)return;var d=bounds(S[k].build()).d;S[k].dim=d.map(function(v){return Math.round(v*10)/10;});});
window.CVJ_SHAPES=S;
if(typeof module!=='undefined')module.exports=S;
})();
