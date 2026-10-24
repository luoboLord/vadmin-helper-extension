(function(root){
  'use strict';
  let dbPromise;
  function db(){return dbPromise ||= new Promise((resolve,reject)=>{const request=indexedDB.open('work-tool-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function state(key,value){
    const database=await db(),write=arguments.length>1;
    return new Promise((resolve,reject)=>{const tx=database.transaction('state',write?'readwrite':'readonly'),store=tx.objectStore('state');const request=write?store.put(value,key):store.get(key);let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('本地存储操作已取消'));});
  }
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  async function read(handle){const file=await handle.getFile();const bytes=new Uint8Array(await file.arrayBuffer());return {bytes,hash:await digest(bytes),data:root.WorkToolWorkbook.payload(root.WorkToolWorkbook.open(bytes)),name:file.name};}
  async function save(handle,entry){
    return navigator.locks.request('work-tool-workbook',async()=>{
      if(await handle.queryPermission({mode:'readwrite'})!=='granted')throw Error('需要重新授权：请在表格管理页点击“重新授权”');
      const current=await read(handle),prepared=root.WorkToolWorkbook.prepare(current.bytes,entry);
      if(!prepared.changed)return {...prepared,name:current.name,hash:current.hash};
      await state('backup',{bytes:current.bytes,name:current.name,hash:current.hash,createdAt:new Date().toISOString()});
      const before=await digest(await (await handle.getFile()).arrayBuffer());
      if(before!==current.hash)throw Error('表格已被其他程序修改，请重试，原表格未覆盖');
      const writer=await handle.createWritable();let closed=false;
      try{
        await writer.write(prepared.bytes);
        if(await digest(await (await handle.getFile()).arrayBuffer())!==current.hash)throw Error('保存期间表格被其他程序修改，请重新加载后重试');
        await writer.close();closed=true;
      }finally{if(!closed)await writer.abort().catch(()=>{});}
      const verified=await read(handle);
      if(verified.hash!==await digest(prepared.bytes))throw Error('写回后的内容与预期不同，已保留修改前备份，请检查表格后重试');
      return {...prepared,data:verified.data,name:verified.name,hash:verified.hash};
    });
  }
  root.WorkToolFiles={state,read,save,digest};
})(globalThis);
