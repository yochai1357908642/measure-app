/* ספריית רכיבים משותפת: אפליקציית האלמנטים שומרת רכיבים, אפליקציית המדידות קוראת אותם ומייצאת ל-CVJ.
   האחסון: תיקייה ב-Drive דרך components.gs (google.script.run). בלי Apps Script: קובץ ‎.cvjc‎ להורדה וטעינה.
   מבנה רכיב (v1):
   {v:1,id,name,y,dim:[w,h,d],thumb,updated,
    parts:[{label,mat,lo:[x,y,z],dim:[w,h,d],nv,nf,v:<b64 Float32 x,y,z>,f:<b64 Uint16 i,j,k>,e:<b64 Uint8 דגל קצה לכל פינה>}]}
   יחידות: מ"מ, מערכת CV (X רוחב, Y גובה, Z עומק מהקיר). נקודות כל חלק יחסיות ל-lo שלו. */
(function(root){
'use strict';
var MAT_HE={porc:'חרסינה',wood:'עץ',glass:'זכוכית',iron:'ברזל'};
function b64(u8){var s='',i,C=0x8000;for(i=0;i<u8.length;i+=C)s+=String.fromCharCode.apply(null,u8.subarray(i,i+C));return btoa(s);}
function unb64(s){var bin=atob(s),o=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)o[i]=bin.charCodeAt(i);return o;}
function newId(){return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
/* groups: מ-ELCore.groupsFor. info: {id?,name,y,thumb} */
function encode(info,G){
  var parts=G.groups.map(function(g){
    var M=g.mesh,nv=M.v.length,nf=M.f.length,V=new Float32Array(nv*3),F=new Uint16Array(nf*3),E=new Uint8Array(nf*3),i,j;
    if(nv>65535)throw new Error('יותר מדי נקודות בחלק '+g.plabel);
    for(i=0;i<nv;i++){V[3*i]=M.v[i][0];V[3*i+1]=M.v[i][1];V[3*i+2]=M.v[i][2];}
    for(i=0;i<nf;i++)for(j=0;j<3;j++){F[3*i+j]=M.f[i][j][0];E[3*i+j]=M.f[i][j][1];}
    return {label:g.plabel,mat:g.mat,lo:g.lo.map(r1),dim:g.dim.map(r1),nv:nv,nf:nf,v:b64(new Uint8Array(V.buffer)),f:b64(new Uint8Array(F.buffer)),e:b64(E)};
  });
  return {v:1,id:info.id||newId(),name:info.name,y:+info.y||0,dim:G.dim.map(r1),thumb:info.thumb||'',updated:new Date().toISOString(),parts:parts};
}
function r1(x){return Math.round(x*10)/10;}
var cache={};
/* רשת בפורמט cvj-shapes: {v:[[x,y,z]], f:[[[i,flag]x3]]} */
function decodePart(p){
  var V=new Float32Array(unb64(p.v).buffer),F=new Uint16Array(unb64(p.f).buffer),E=unb64(p.e),v=[],f=[],i;
  for(i=0;i<p.nv;i++)v.push([V[3*i],V[3*i+1],V[3*i+2]]);
  for(i=0;i<p.nf;i++)f.push([[F[3*i],E[3*i]],[F[3*i+1],E[3*i+1]],[F[3*i+2],E[3*i+2]]]);
  return {v:v,f:f};
}
function meshOf(comp,i){var k=comp.id+'|'+comp.updated+'|'+i;if(!cache[k])cache[k]=decodePart(comp.parts[i]);return cache[k];}
function keyOf(comp,i){return 'c_'+comp.id+'_'+i;}
/* רושם את חלקי הרכיב ב-CVJ_SHAPES (או במאגר אחר) ומחזיר את המפתחות */
function register(comp,reg){
  reg=reg||root.CVJ_SHAPES;
  return comp.parts.map(function(p,i){
    var key=keyOf(comp,i);
    reg[key]={he:comp.name+(comp.parts.length>1?' - '+p.label:''),dim:p.dim.slice(),y:0,mat:p.mat,gen:1,comp:comp.id,
      build:function(){return meshOf(comp,i);}};
    return key;
  });
}
/* פריטים ל-cvjBuild: place = {wall,x,y,z,dx,dy,dz,label}. מידות שונות מהרכיב מותחות את כל החלקים באותו יחס */
function items(comp,place,reg){
  place=place||{};var keys=register(comp,reg),D=comp.dim;
  var s=[place.dx>0&&D[0]>0?place.dx/D[0]:1,place.dy>0&&D[1]>0?place.dy/D[1]:1,place.dz>0&&D[2]>0?place.dz/D[2]:1];
  var name=place.label||comp.name,y0=place.y!=null?+place.y:comp.y;
  return comp.parts.map(function(p,i){
    return {wall:place.wall|0,key:keys[i],label:(name+(comp.parts.length>1?' - '+p.label:'')).slice(0,60),
      dx:p.dim[0]*s[0],dy:p.dim[1]*s[1],dz:p.dim[2]*s[2],
      x:(+place.x||0)+p.lo[0]*s[0],y:y0+p.lo[1]*s[1],z:(+place.z||0)+p.lo[2]*s[2],open:false};
  });
}
function meta(comp){return {id:comp.id,name:comp.name,y:comp.y,dim:comp.dim,thumb:comp.thumb,updated:comp.updated,
  mats:comp.parts.map(function(p){return p.mat;})};}
/* ---- שרת (Apps Script) ---- */
function hasServer(){return !!(root.google&&root.google.script&&root.google.script.run);}
function call(fn){
  var args=Array.prototype.slice.call(arguments,1);
  return new Promise(function(res,rej){
    if(!hasServer())return rej(new Error('האפליקציה לא רצה מתוך Apps Script, אז אין גישה לספרייה ב-Drive.'));
    var r=root.google.script.run.withSuccessHandler(res).withFailureHandler(function(e){rej(new Error(e&&e.message||String(e)));});
    r[fn].apply(r,args);
  });
}
var api={MAT_HE:MAT_HE,encode:encode,decodePart:decodePart,register:register,items:items,meta:meta,hasServer:hasServer,
  list:function(){return call('cvjcList').then(JSON.parse);},
  get:function(id){return call('cvjcGet',id).then(JSON.parse);},
  save:function(comp){return call('cvjcSave',JSON.stringify(comp)).then(JSON.parse);},
  remove:function(id){return call('cvjcDelete',id);},
  /* קבצים מקומיים */
  download:function(comp){
    var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(comp)],{type:'application/json'}));
    a.download=comp.name.replace(/[\\/:*?"<>|]/g,'_')+'.cvjc';document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},2000);
  },
  readFile:function(file){
    return file.text().then(function(t){var c=JSON.parse(t);if(c.v!==1||!c.parts)throw new Error(file.name+' אינו קובץ רכיב.');return c;});
  }
};
root.CVJComp=api;
if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
