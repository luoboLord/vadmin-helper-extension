(function(root){
  'use strict';
  // “对比并写入新增”的新增清单：只生成补充行和新游戏配置，不修改已有格子。纯函数，不读写飞书。
  const F=root.WorkToolFeishu,S=root.WorkToolSourceCompare,C=root.WorkToolCore;
  const clean=v=>String(v??'').trim();
  const {norm,urlKey,part,line,ORDER}=S;
  const LIMIT=1000;
  const key=(...parts)=>JSON.stringify(parts);
  // 与运行时 filterServer 一致：整格为空或“通用/共用”等为共用；否则按“/”拆分，去掉登录提示后比较。
  function scope(text){
    if(C.isShared(text))return {shared:true,keys:[]};
    return {shared:false,keys:[...new Set(C.splitServers(text).map(C.serverKey))].sort()};
  }
  const scopeKey=s=>s.shared?'*':s.keys.join('/');
  const overlaps=(a,b)=>a.shared||b.shared||a.keys.some(k=>b.keys.includes(k));
  const isEmpty=s=>!s.shared&&!s.keys.length;
  // 目标范围减去已有范围的并集；已有共用记录则全部覆盖。原表为共用而已有记录只覆盖部分专服时返回 null。
  function remaining(target,covered){
    if(covered.some(s=>s.shared))return {shared:false,keys:[]};
    if(target.shared)return covered.length?null:target;
    const have=new Set(covered.flatMap(s=>s.keys));
    return {shared:false,keys:target.keys.filter(k=>!have.has(k))};
  }
  const noteKeys=e=>[norm(part(e.name)),...(e.note?[norm(part(e.name+' | '+e.note))]:[])];
  // 逐条展开链接库记录，保留记录编号和状态（含停用、待核对）。
  function entries(library,settings){
    const out=[];
    library.rows.forEach((row,i)=>{
      if(!Object.values(row).some(Boolean))return;
      for(const e of F.expandCompact([row],settings.rows)){
        const type=e['记录类型'],full=clean(e['完整名称']);
        out.push({recordId:library.ids[i],type,full,nf:norm(full),game:type==='公共链接'?'':norm(F.identity(e).game),
          status:clean(e['状态'])||'启用',name:clean(e['链接名称']),url:clean(e['URL']),note:clean(e['备注']),server:clean(e['专服']),scope:scope(e['专服']),order:clean(e['排序'])});
      }
    });
    return out;
  }
  function index(library,settings){
    const all=entries(library,settings),known=new Map(),games=new Map();
    for(const row of settings.rows){
      const full=clean(row['完整名称']);if(!full)continue;
      if(!known.has(norm(full)))known.set(norm(full),full);
      games.set(norm(full),norm(F.identity(row).game));
    }
    for(const e of all)if(e.nf){if(!known.has(e.nf))known.set(e.nf,e.full);if(!games.has(e.nf))games.set(e.nf,e.game);}
    return {all,known,games,configured:new Set(settings.rows.map(r=>norm(r['完整名称'])).filter(Boolean))};
  }
  const sameLink=(e,nf,uk)=>e.nf===nf&&e.type==='游戏链接'&&e.url&&urlKey(e.url)===uk;
  const sameNote=(e,nf,text)=>e.nf===nf&&e.type==='游戏备注'&&noteKeys(e).includes(text);
  const colName=n=>{let s='';for(let x=n;x>0;x=Math.floor((x-1)/26))s=String.fromCharCode(65+(x-1)%26)+s;return s;};
  function plan({sheet,library,settings,sourceField=false,stamp=''}){
    const idx=index(library,settings),{all,known,games}=idx;
    const items=[],seen=new Set(),planned=[];
    // 新游戏的网址全在链接库同一个游戏版本下，多半是改了名称，整款跳过。
    const renamed=new Map();
    for(const [,,full,,,,url]of sheet.rows){
      const nf=norm(full);if(!nf||known.has(nf)||!clean(url))continue;
      const owners=new Set(all.filter(e=>e.type==='游戏链接'&&e.url&&urlKey(e.url)===urlKey(url)).map(e=>e.full));
      renamed.set(nf,renamed.has(nf)?[...renamed.get(nf)].filter(f=>owners.has(f)):[...owners]);
    }
    sheet.rows.forEach((r,i)=>{
      const [game,version,full,server,category,name,url,note]=r.map(clean);
      const nf=norm(full);if(!nf)return;
      const isNote=!url;if(isNote&&category!=='备注')return;
      const text=isNote?part(name):'';if(isNote&&!text)return;
      const target=scope(server),match=isNote?norm(text):urlKey(url),newGame=!known.has(nf);
      const at=sheet.origins?.[i];
      const item={kind:isNote?'note':'link',key:key(isNote?'note':'link',nf,match,scopeKey(target)),nf,full:known.get(nf)||full,game,version,server,
        category:isNote?'游戏备注':ORDER.includes(category)?category:'其他',name:isNote?text:part(name)||category,url,note:isNote?'':part(note),
        origin:at?colName(at.col)+at.row:'',newGame,match};
      if(seen.has(item.key))return;seen.add(item.key);items.push(item);
      const skip=reason=>{item.state='skip';item.reason=reason;};
      if(newGame&&renamed.get(nf)?.length)return skip('疑似由「'+renamed.get(nf).join('、')+'」改名，请人工确认');
      const same=e=>isNote?sameNote(e,nf,match):sameLink(e,nf,match);
      const covered=[...all.filter(e=>same(e)&&e.status==='启用').map(e=>e.scope),...planned.filter(p=>p.nf===nf&&p.kind===item.kind&&p.match===match).map(p=>p.rest)];
      const rest=remaining(target,covered);
      if(!rest)return skip('链接库已有部分专服的同一'+(isNote?'备注':'网址')+'，原表为共用，无法确定还缺哪些专服');
      if(isEmpty(rest)){item.state='exists';return;}
      const game_=games.get(nf)||norm(game);
      const blocked=all.filter(e=>e.status!=='启用'&&e.game===game_&&(isNote?e.type==='游戏备注'&&noteKeys(e).includes(match):e.type==='游戏链接'&&e.url&&urlKey(e.url)===match)&&overlaps(e.scope,rest));
      if(blocked.length)return skip('同游戏已有'+(isNote?'此备注':'此网址')+'的'+[...new Set(blocked.map(e=>e.status))].join('/')+'记录（'+[...new Set(blocked.map(e=>e.full+' · '+(e.server||'共用')))].join('；')+'）');
      if(!isNote){
        const others=[...new Set(all.filter(e=>e.status==='启用'&&e.type==='游戏链接'&&e.url&&urlKey(e.url)===match&&e.game!==game_).map(e=>e.full))];
        if(others.length)return skip('网址已属于其他游戏「'+others.join('、')+'」，请人工确认归属');
      }
      item.state='add';item.rest=rest;planned.push(item);
    });
    // 新增行：同完整名称、同剩余专服范围合并为一行。
    const rows=new Map();
    for(const item of items.filter(x=>x.state==='add')){
      const k=key('row',item.nf,scopeKey(item.rest));
      if(!rows.has(k)){
        const libraryTokens=all.filter(e=>e.nf===item.nf).flatMap(e=>C.splitServers(e.server));
        const pick=sk=>libraryTokens.find(t=>C.serverKey(t)===sk)||C.splitServers(item.server).find(t=>C.serverKey(t)===sk)||sk;
        const orders=all.filter(e=>e.nf===item.nf&&e.order!==''&&Number.isFinite(Number(e.order))).map(e=>Number(e.order));
        const sourceKeys=C.splitServers(item.server).map(C.serverKey),keys=[...item.rest.keys].sort((a,b)=>(sourceKeys.indexOf(a)+1||99)-(sourceKeys.indexOf(b)+1||99));
        rows.set(k,{id:k,nf:item.nf,full:item.full,server:item.rest.shared?'':keys.map(pick).join('/'),order:orders.length?String(Math.max(...orders)):'',newGame:item.newGame,items:[]});
      }
      rows.get(k).items.push(item);
    }
    const ops=[],configs=new Map();
    for(const row of rows.values())if(row.newGame&&!configs.has(row.nf)){
      const first=row.items[0];
      configs.set(row.nf,{id:key('config',row.nf),table:'settings',kind:'config',nf:row.nf,full:row.full,values:{'完整名称':row.full,'游戏':first.game,'版本':first.version},items:[],dependsOn:[]});
    }
    ops.push(...configs.values());
    const sourceText=list=>['插件自动补录'+(stamp?' '+stamp:''),...list.filter(x=>x.origin).map(x=>x.category+' / '+x.name+'：原表 '+x.origin)].join('\n');
    for(const row of rows.values()){
      const values={'完整名称':row.full,'专服':row.server,'记录类型':'游戏链接','状态':'启用','排序':row.order};
      for(const category of ORDER){const lines=row.items.filter(x=>x.kind==='link'&&x.category===category);if(lines.length)values[category]=lines.map(x=>line(x.name,x.url,x.note)).join('\n');}
      const notes=row.items.filter(x=>x.kind==='note');if(notes.length)values['游戏备注']=notes.map(x=>x.name).join('\n');
      if(sourceField)values['来源']=sourceText(row.items);
      ops.push({id:row.id,table:'library',kind:'row',nf:row.nf,full:row.full,server:row.server,values,items:row.items.map(x=>x.key),
        checks:row.items.map(x=>({kind:x.kind,nf:x.nf,match:x.match,rest:x.rest})),dependsOn:row.newGame?[key('config',row.nf)]:[]});
    }
    // 公共链接：同网址任一记录启用即已存在；停用、待核对的跳过。
    const publicItems=[],publicSeen=new Set();
    for(const [name,url]of sheet.public||[]){
      const uk=urlKey(url);if(!clean(url)||publicSeen.has(uk))continue;publicSeen.add(uk);
      const item={kind:'public',key:key('public',uk),name:part(name),url:clean(url),category:'其他',match:uk};
      const same=all.filter(e=>e.type==='公共链接'&&e.url&&urlKey(e.url)===uk);
      if(same.some(e=>e.status==='启用'))item.state='exists';
      else if(same.length){item.state='skip';item.reason='已有此网址的'+[...new Set(same.map(e=>e.status))].join('/')+'公共链接';}
      else{item.state='add';publicItems.push(item);}
      items.push(item);
    }
    if(publicItems.length){
      const values={'记录类型':'公共链接','状态':'启用','其他':publicItems.map(x=>line(x.name,x.url,'')).join('\n')};
      if(sourceField)values['来源']=['插件自动补录'+(stamp?' '+stamp:''),'公共链接：原表第 1 行'].join('\n');
      ops.push({id:key('public'),table:'library',kind:'public',values,items:publicItems.map(x=>x.key),checks:publicItems.map(x=>({kind:'public',match:x.match})),dependsOn:[]});
    }
    const add=items.filter(x=>x.state==='add');
    return {items,ops,counts:{links:add.filter(x=>x.kind==='link').length,notes:add.filter(x=>x.kind==='note').length,public:add.filter(x=>x.kind==='public').length,
      configs:configs.size,rows:ops.filter(o=>o.table==='library').length,skipped:items.filter(x=>x.state==='skip').length,existing:items.filter(x=>x.state==='exists').length}};
  }
  // 写入前在最新数据上复核：返回已被他人补录的条目（任一条存在则整行跳过，避免重复）。
  function covered(op,library,settings){
    const idx=index(library,settings);
    if(op.kind==='config')return idx.configured.has(op.nf)?[op.full]:[];
    return op.checks.filter(c=>{
      if(c.kind==='public')return idx.all.some(e=>e.type==='公共链接'&&e.url&&urlKey(e.url)===c.match);
      const same=idx.all.filter(e=>(c.kind==='note'?sameNote(e,c.nf,c.match):sameLink(e,c.nf,c.match))&&e.status==='启用').map(e=>e.scope);
      const rest=remaining(c.rest,same);return !rest||rest.shared!==c.rest.shared||rest.keys.length!==c.rest.keys.length;
    }).map(c=>c.match);
  }
  // 模拟全部新增后的完整数据：必须能被现有读取和索引链路接受，且再次对比没有新增。
  function simulate(result,{sheet,library,settings,sourceField=false}){
    const blank=names=>Object.fromEntries(names.map(n=>[n,'']));
    const libRows=[...library.rows,...result.ops.filter(o=>o.table==='library').map(o=>({...blank(F.COMPACT_FIELDS),...o.values}))];
    const cfgRows=[...settings.rows,...result.ops.filter(o=>o.table==='settings').map(o=>({...blank(F.CONFIG_FIELDS),...o.values}))];
    if(libRows.length>LIMIT)throw Error('写入后链接库将超过 '+LIMIT+' 条，已整批停止');
    if(cfgRows.length>LIMIT)throw Error('写入后游戏配置将超过 '+LIMIT+' 条，已整批停止');
    const data=F.payload(F.expandCompact(libRows,cfgRows),cfgRows).data;
    const fake=(list,n)=>[...list.ids,...Array.from({length:n-list.ids.length},(_,i)=>'recSimulated'+i)];
    const again=plan({sheet,library:{ids:fake(library,libRows.length),rows:libRows},settings:{ids:fake(settings,cfgRows.length),rows:cfgRows},sourceField});
    if(again.ops.length)throw Error('模拟写入后仍有 '+again.ops.length+' 行待新增，已停止，请反馈此问题');
    for(const item of result.items.filter(x=>x.state==='add'&&x.kind==='link')){
      const version=data.games.flatMap(g=>Object.values(g.versions)).find(v=>norm(v.full)===item.nf);
      if(!version?.links.some(l=>urlKey(l.url)===item.match))throw Error('模拟写入后读取不到「'+item.full+'」的 '+item.name+'，已停止');
    }
    return {libraryRows:libRows.length,configRows:cfgRows.length};
  }
  // 按实时字段定义生成单元格；字段或选项不存在时报错，不让服务端静默写空。
  function segments(text,links){
    const out=[],push=s=>{const last=out[out.length-1];if(s.type==='text'&&last?.type==='text')last.text+=s.text;else out.push(s);};
    text.split('\n').forEach((ln,i)=>{
      if(i)push({type:'text',text:'\n'});
      const parts=ln.split('|').map(clean);
      if(!links||!/^https?:\/\//i.test(parts.length===1?parts[0]:parts[1]||'')){push({type:'text',text:ln});return;}
      const url=parts.length===1?parts[0]:parts[1];
      if(parts.length>1)push({type:'text',text:parts[0]+' | '});
      push({type:'url',text:url,link:url});
      if(parts.length>2)push({type:'text',text:' | '+parts.slice(2).join(' | ')});
    });
    return out;
  }
  function fieldsByName(fieldMap){
    const map=new Map();
    for(const [id,f]of Object.entries(fieldMap||{})){if(map.has(f.name))throw Error('表格存在重名字段');map.set(f.name,{id,...f});}
    return map;
  }
  function cells(values,fieldMap){
    const fields=fieldsByName(fieldMap),out={};
    for(const [name,v]of Object.entries(values)){
      const text=clean(v);if(!text)continue;
      const f=fields.get(name);if(!f)throw Error('目标表缺少字段：'+name);
      if(f.type===1)out[f.id]={type:1,value:segments(text,F.COMPACT_CATEGORIES.includes(name))};
      else if(f.type===3){
        const options=(f.property?.options||[]).filter(o=>o.name===text);
        if(options.length!==1)throw Error('字段「'+name+'」没有唯一的选项「'+text+'」，未写入');
        out[f.id]={type:3,value:options[0].id};
      }else if(f.type===2){
        const n=Number(text);if(!Number.isFinite(n))throw Error('字段「'+name+'」需要数字');
        out[f.id]={type:2,value:n};
      }else throw Error('字段「'+name+'」的类型不支持自动写入');
    }
    return out;
  }
  // 读回核实：写入的每个字段解析后必须与预期一致。返回不一致的字段名。
  function mismatches(record,values,fieldMap){
    const fields=fieldsByName(fieldMap);
    return Object.entries(values).filter(([name,v])=>{
      const f=fields.get(name);if(!f)return true;
      let actual;try{actual=F.cellValue(record?.[f.id],f);}catch{return true;}
      return clean(actual)!==clean(v);
    }).map(([name])=>name);
  }
  const api={LIMIT,scope,remaining,entries,plan,covered,simulate,segments,cells,mismatches};
  root.WorkToolFeishuSync=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
