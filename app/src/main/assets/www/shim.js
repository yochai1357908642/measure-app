/* שכבת אחסון מקומית: מחליפה את מסד הנתונים של Claude באחסון שבתוך המכשיר (IndexedDB) */
(function(){
'use strict';
var DB_NAME='mp-measure',DB_VER=1,idb=null,docs={},blobs={},blobUrls={},listeners=[];
function clone(x){return x==null?x:JSON.parse(JSON.stringify(x));}
function openDb(){
  return new Promise(function(res,rej){
    if(!window.indexedDB){rej(new Error('no idb'));return;}
    var r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=function(){
      var d=r.result;
      if(!d.objectStoreNames.contains('docs'))d.createObjectStore('docs',{keyPath:'path'});
      if(!d.objectStoreNames.contains('blobs'))d.createObjectStore('blobs',{keyPath:'id'});
    };
    r.onsuccess=function(){res(r.result);};
    r.onerror=function(){rej(r.error);};
  });
}
function req(store,mode,fn){
  return new Promise(function(res,rej){
    var q=fn(idb.transaction(store,mode).objectStore(store));
    q.onsuccess=function(){res(q.result);};
    q.onerror=function(){rej(q.error);};
  });
}
var ready=openDb().then(function(d){
  idb=d;
  return Promise.all([req('docs','readonly',function(s){return s.getAll();}),req('blobs','readonly',function(s){return s.getAll();})]);
}).then(function(r){
  r[0].forEach(function(x){docs[x.path]=x.data;});
  r[1].forEach(function(x){blobs[x.id]=x;try{blobUrls[x.id]=URL.createObjectURL(x.blob);}catch(_){}});
}).catch(function(){idb=null;});
try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();}catch(_){}

function docSnap(p){return {exists:Object.prototype.hasOwnProperty.call(docs,p),data:function(){return clone(docs[p]);}};}
function colSnap(n){
  var out=[];
  Object.keys(docs).forEach(function(p){
    if(p.indexOf(n+'/')===0&&p.indexOf('/',n.length+1)<0)out.push({id:p.slice(n.length+1),data:function(){return clone(docs[p]);}});
  });
  return {docs:out};
}
function notify(path){
  listeners.slice().forEach(function(l){
    try{
      if(l.kind==='doc'&&l.path===path)l.cb(docSnap(path));
      else if(l.kind==='col'&&path.indexOf(l.name+'/')===0)l.cb(colSnap(l.name));
    }catch(_){}
  });
}
var db={
  doc:function(p){
    return {
      onSnapshot:function(cb){
        var l={kind:'doc',path:p,cb:cb};listeners.push(l);
        setTimeout(function(){cb(docSnap(p));},0);
        return function(){listeners=listeners.filter(function(x){return x!==l;});};
      },
      set:function(d){
        docs[p]=clone(d);
        return req('docs','readwrite',function(s){return s.put({path:p,data:clone(d)});}).then(function(){setTimeout(function(){notify(p);},0);});
      },
      delete:function(){
        delete docs[p];
        return req('docs','readwrite',function(s){return s['delete'](p);}).then(function(){setTimeout(function(){notify(p);},0);});
      }
    };
  },
  collection:function(n){
    return {onSnapshot:function(cb){
      var l={kind:'col',name:n,cb:cb};listeners.push(l);
      setTimeout(function(){cb(colSnap(n));},0);
      return function(){listeners=listeners.filter(function(x){return x!==l;});};
    }};
  }
};
function rid(){
  var a=new Uint8Array(18),s='',c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  (window.crypto||window.msCrypto).getRandomValues(a);
  for(var i=0;i<a.length;i++)s+=c[a[i]%c.length];
  return s;
}
var assets={
  upload:function(blob,opts){
    var id=rid(),rec={id:id,blob:blob,type:(opts&&opts.type)||blob.type||'application/octet-stream',size:blob.size};
    blobs[id]=rec;
    try{blobUrls[id]=URL.createObjectURL(blob);}catch(_){}
    return req('blobs','readwrite',function(s){return s.put(rec);}).then(function(){return {id:id,contentType:rec.type,sizeBytes:rec.size};});
  },
  'delete':function(id){
    delete blobs[id];
    if(blobUrls[id]){try{URL.revokeObjectURL(blobUrls[id]);}catch(_){}delete blobUrls[id];}
    return req('blobs','readwrite',function(s){return s['delete'](id);});
  }
};
window.__mpBlobUrl=function(id){return blobUrls[id]||'';};
function mimeFor(n){
  var e=(/\.([a-z0-9]+)$/i.exec(n||'')||[])[1];
  return {csv:'text/csv;charset=utf-8',pdf:'application/pdf',zip:'application/zip',dxf:'application/dxf',html:'text/html',json:'application/json'}[(e||'').toLowerCase()]||'application/octet-stream';
}
var downloads={
  save:function(o){
    if(window.Android&&window.Android.saveFile){
      return new Promise(function(res,rej){
        var d=o.data,isCsv=/\.csv$/i.test(o.filename||''),blob=(typeof Blob!=='undefined'&&d instanceof Blob)?d:new Blob([isCsv?'﻿'+d:d],{type:mimeFor(o.filename)}),r=new FileReader();
        r.onload=function(){var s=String(r.result),i=s.indexOf(',');window.Android.saveFile(o.filename||'file',blob.type||mimeFor(o.filename),s.slice(i+1));res({});};
        r.onerror=function(){rej(r.error);};
        r.readAsDataURL(blob);
      });
    }
    return new Promise(function(res){
      var d=o.data,isCsv=/\.csv$/i.test(o.filename||''),blob=(typeof Blob!=='undefined'&&d instanceof Blob)?d:new Blob([isCsv?'﻿'+d:d],{type:mimeFor(o.filename)});
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download=o.filename||'file';a.style.display='none';
      document.body.appendChild(a);a.click();
      setTimeout(function(){try{URL.revokeObjectURL(a.href);}catch(_){}a.remove();},6000);
      res({});
    });
  }
};
var user={canEdit:function(){return Promise.resolve(true);}};
window.claude={use:function(n){
  if(n==='db')return ready.then(function(){if(!idb)throw new Error('no storage');return db;});
  if(n==='assets')return ready.then(function(){if(!idb)throw new Error('no storage');return assets;});
  if(n==='downloads')return Promise.resolve(downloads);
  if(n==='user')return Promise.resolve(user);
  return Promise.reject(new Error('unsupported'));
}};

/* גיבוי ושחזור */
function el(tag,attrs,kids){
  var e=document.createElement(tag);
  Object.keys(attrs||{}).forEach(function(k){if(k==='text')e.textContent=attrs[k];else if(k==='class')e.className=attrs[k];else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),attrs[k]);else e.setAttribute(k,attrs[k]);});
  (kids||[]).forEach(function(c){if(c)e.appendChild(c);});
  return e;
}
function stamp(){var d=new Date(),p=function(n){return n<10?'0'+n:''+n;};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
function backup(msg){
  if(!window.JSZip){msg.textContent='רכיב הגיבוי לא נטען.';return;}
  msg.textContent='מכין גיבוי…';
  var zip=new JSZip(),meta=[];
  zip.file('data.json',JSON.stringify({version:1,docs:docs,blobs:Object.keys(blobs).map(function(id){return {id:id,type:blobs[id].type,size:blobs[id].size};})}));
  Object.keys(blobs).forEach(function(id){zip.file('blobs/'+id,blobs[id].blob);});
  zip.generateAsync({type:'blob'}).then(function(b){
    return downloads.save({filename:'גיבוי מדידות '+stamp()+'.zip',data:b});
  }).then(function(){
    try{localStorage.setItem('mp.lastBackup',stamp());}catch(_){}
    msg.textContent='הגיבוי נשמר בתיקיית ההורדות.';
  },function(){msg.textContent='הגיבוי נכשל.';});
}
function restore(file,msg){
  if(!window.JSZip||!file)return;
  if(!window.confirm('לשחזר מהגיבוי? כל המדידות הנוכחיות במכשיר יוחלפו.'))return;
  msg.textContent='משחזר…';
  JSZip.loadAsync(file).then(function(z){
    var f=z.file('data.json');
    if(!f)throw new Error('bad');
    return f.async('string').then(function(t){
      var data=JSON.parse(t),ids=(data.blobs||[]);
      return Promise.all(ids.map(function(m){return z.file('blobs/'+m.id).async('blob').then(function(b){return {id:m.id,blob:new Blob([b],{type:m.type}),type:m.type,size:m.size};});})).then(function(recs){return {data:data,recs:recs};});
    });
  }).then(function(r){
    var oldDocs=Object.keys(docs),oldBlobs=Object.keys(blobs),chain=Promise.resolve();
    oldDocs.forEach(function(p){chain=chain.then(function(){return req('docs','readwrite',function(s){return s['delete'](p);});});});
    oldBlobs.forEach(function(id){chain=chain.then(function(){return req('blobs','readwrite',function(s){return s['delete'](id);});});});
    Object.keys(r.data.docs||{}).forEach(function(p){chain=chain.then(function(){return req('docs','readwrite',function(s){return s.put({path:p,data:r.data.docs[p]});});});});
    r.recs.forEach(function(rec){chain=chain.then(function(){return req('blobs','readwrite',function(s){return s.put(rec);});});});
    return chain;
  }).then(function(){location.reload();},function(){msg.textContent='קובץ הגיבוי לא תקין.';});
}
var updMsg=null;
window.__mpAndroid=function(m){
  var t=m==='uptodate'?'האפליקציה מעודכנת.':m==='nourl'?'לא הוגדרה כתובת עדכון.':m.indexOf('updated:')===0?'עודכן לגרסה '+m.slice(8)+'. טוען את הגרסה החדשה…':m.indexOf('error:')===0?'העדכון נכשל: '+m.slice(6):'';
  if(updMsg&&t)updMsg.textContent=t;
  if(m.indexOf('updated:')===0){
    try{setTimeout(function(){window.Android.reload();},400);}catch(_){}
  }
};
(function(){
  try{
    if(window.Android&&window.Android.getUpdateUrl&&window.Android.checkUpdate){
      var u=window.Android.getUpdateUrl();
      if(u&&u.trim())setTimeout(function(){try{window.Android.checkUpdate();}catch(_){}},1500);
    }
  }catch(_){}
})();
function updateCard(){
  updMsg=el('p',{'class':'sec-hint'});
  var inp=el('input',{type:'text','class':'sk-in',dir:'ltr',placeholder:'https://script.google.com/macros/s/…/exec','aria-label':'כתובת העדכון',value:window.Android.getUpdateUrl()});
  return el('section',{'class':'card','aria-label':'עדכון האפליקציה'},[
    el('h3',{'class':'card-t',text:'עדכון האפליקציה'}),
    el('p',{'class':'sec-hint',text:'גרסה נוכחית: '+window.Android.getVersion()+'. האפליקציה בודקת עדכון בכל פתיחה כשיש אינטרנט, ומורידה אותו לבד. הכתובת היא של סקריפט Google או של אחסון באינטרנט (ראה הוראות). את הגרסה החדשה מפעילים בפתיחה הבאה, או מכאן.'}),
    inp,
    el('div',{'class':'row'},[
      el('button',{type:'button','class':'btn',text:'שמירת הכתובת',onclick:function(){window.Android.setUpdateUrl(inp.value);updMsg.textContent='הכתובת נשמרה.';}}),
      el('button',{type:'button','class':'btn primary',text:'בדיקת עדכון עכשיו',onclick:function(){window.Android.setUpdateUrl(inp.value);updMsg.textContent='בודק…';window.Android.checkUpdate();}}),
      el('button',{type:'button','class':'btn',text:'הפעלת הגרסה החדשה',onclick:function(){window.Android.reload();}}),
      el('button',{type:'button','class':'btn',text:'בדיקת הכתובת בדפדפן',onclick:function(){var u=inp.value.trim();if(u)window.location.href=u+(u.indexOf('?')<0?'?':'&')+'action=version';else updMsg.textContent='קודם מדביקים כתובת.';}})
    ]),
    updMsg
  ]);
}
window.__mpExtra=function(){
  var msg=el('p',{class:'sec-hint'}),last='';
  try{last=localStorage.getItem('mp.lastBackup')||'';}catch(_){}
  var pick=el('input',{type:'file',accept:'.zip,application/zip',style:'display:none',onchange:function(ev){var f=ev.target.files&&ev.target.files[0];ev.target.value='';restore(f,msg);}});
  var backupCard=el('section',{'class':'card','aria-label':'גיבוי ושחזור'},[
    el('h3',{'class':'card-t',text:'גיבוי ושחזור'}),
    el('p',{'class':'sec-hint',text:'המדידות נשמרות בתוך המכשיר הזה בלבד. כדי להעביר לטלפון או טאבלט אחר, או כדי לשמור עותק למקרה שהנתונים יימחקו, שומרים גיבוי ומשחזרים אותו במכשיר השני.'+(last?' גיבוי אחרון: '+last+'.':' עדיין לא נשמר גיבוי.')}),
    el('div',{'class':'row'},[el('button',{type:'button','class':'btn primary',text:'שמירת גיבוי',onclick:function(){backup(msg);}}),el('button',{type:'button','class':'btn',text:'שחזור מגיבוי',onclick:function(){pick.click();}}),pick]),
    msg
  ]);
  return window.Android?el('div',{},[backupCard,updateCard()]):backupCard;
};
})();
