(function(root){
  'use strict';
  // 只读对比原表与链接库：列出缺少的游戏、链接及专服名称差异，不写飞书。
  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
  const decode=v=>{try{return decodeURIComponent(v);}catch{return v;}};
  const SHEET_NAME='游戏后台';
  function source(value){
    let u;try{u=new URL(clean(value));}catch{throw Error('请填写客服资料大全的飞书地址');}
    const m=/^\/(wiki|sheets)\/([A-Za-z0-9]+)\/?$/.exec(u.pathname),sheet=u.searchParams.get('sheet')||'';
    if(u.protocol!=='https:'||!u.hostname.endsWith('.feishu.cn')||u.username||u.password||u.port||!m)throw Error('请填写 HTTPS 飞书电子表格或知识库地址');
    if(sheet&&!/^[A-Za-z0-9]+$/.test(sheet))throw Error('地址中的 sheet 参数无效');
    const page=u.origin+'/'+m[1]+'/'+m[2];
    return {url:page+(sheet?'?sheet='+sheet:''),page,sheet};
  }
  // 从网页 HTML 截取 clientVars JSON 中的表格快照，不执行页面脚本。
  function extractSnapshot(html){
    const marker=/\bclientVars\s*:\s*/g;let match;
    while((match=marker.exec(html))){
      let start=marker.lastIndex;
      const wrapper=/^Object\s*\(\s*/.exec(html.slice(start));if(wrapper)start+=wrapper[0].length;
      if(html[start]!=='{')continue;
      let depth=0,quoted=false,escaped=false;
      for(let p=start;p<html.length;p++){
        const ch=html[p];
        if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
        if(ch==='"'){quoted=true;continue;}
        if(ch==='{')depth++;
        if(ch==='}'&&--depth===0){
          let cv;try{cv=JSON.parse(html.slice(start,p+1));}catch{break;}
          const snap=cv?.data?.snapshot;
          if(!snap?.blocks||typeof snap.blocks!=='object'||Array.isArray(snap.blocks))break;
          const blocks=Object.entries(snap.blocks);
          if(!blocks.length||blocks.some(([,v])=>typeof v!=='string'||!v))break;
          const snapshot={blocks:Object.fromEntries(blocks)};
          for(const key of ['gzipBlockMeta','gzipResource','gzipTopSnapshot'])if(typeof snap[key]==='string')snapshot[key]=snap[key];
          if(!snapshot.gzipBlockMeta||!snapshot.gzipResource)throw Error('原表快照不完整，未进行对比');
          return snapshot;
        }
      }
    }
    throw Error('飞书没有返回原表数据（可能未登录、无权限或页面格式已变）');
  }
  async function read(value,fetcher=fetch){
    const src=source(value),S=root.WorkToolFeishuSheet;
    const response=await fetcher(src.url,{credentials:'include',redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('读取客服资料大全失败（HTTP '+response.status+'），请检查登录和访问权限');
    if(response.url&&!response.url.startsWith(src.page))throw Error('飞书跳转到了其他页面，请先在此浏览器打开客服资料大全并登录');
    const snapshot=extractSnapshot(await response.text()),ids=await S.sheetIds(snapshot);
    const named=(await S.sheetNames(snapshot)).filter(s=>s.name===SHEET_NAME&&ids.includes(s.id));
    const sheetId=src.sheet||(named.length===1?named[0].id:ids.length===1?ids[0]:'');
    if(!sheetId)throw Error('没有找到唯一的“'+SHEET_NAME+'”工作表，请打开该工作表，复制地址栏中带 ?sheet= 的完整地址');
    if(!ids.includes(sheetId))throw Error('飞书没有返回地址中 sheet 对应的工作表数据，请确认地址');
    return {...S.toRows(await S.decodeSnapshot(snapshot,sheetId)),source:src.url,sheetId};
  }
  // 路径按段、参数按键值对分别解码后结构化比较：编码差异视为同一链接，但 %2F、%26、%3D 等编码的分隔符不与真实分隔符混淆。
  function urlKey(value){
    try{const u=new URL(clean(value));return JSON.stringify([u.protocol,u.host,u.pathname.split('/').map(decode),[...u.searchParams],decode(u.hash.slice(1))]);}
    catch{return clean(value);}
  }
  // 精简表一格一行“名称 | 网址 | 备注”，名称和备注中的竖线、换行会破坏格式；网址中的竖线编码为 %7C，含义不变。
  const part=v=>clean(v).replace(/\s*\|\s*/g,' / ').replace(/\s*[\r\n]+\s*/g,' ');
  const line=(name,url,note)=>[part(name),clean(url).replace(/\|/g,'%7C'),part(note)].filter(Boolean).join(' | ');
  const ORDER=['后台','日志后台','礼包','冠名表','额外表','定制称号','转区转游','扶持','累充','道具ID','其他'];
  function compare(sheet,data){
    const versions=new Map(),owners=new Map(),serverScopes=new Map(),C=root.WorkToolCore;
    for(const game of data?.games||[])for(const v of Object.values(game.versions||{})){
      const urls=new Set(v.links.map(l=>urlKey(l.url)));versions.set(norm(v.full),urls);
      if(C)serverScopes.set(norm(v.full),[...new Set([...v.links.map(l=>l.server),...(v.notes||[]).map(n=>n[0])].filter(s=>!C.isShared(s)).flatMap(s=>C.splitServers(s)))]);
      for(const u of urls){if(!owners.has(u))owners.set(u,new Set());owners.get(u).add(v.full);}
    }
    const groups=new Map();let sourceLinks=0,missingLinks=0;
    for(const [game,version,full,server,category,name,url,note]of sheet.rows){
      const known=versions.get(norm(full));
      if(url){sourceLinks++;if(known?.has(urlKey(url)))continue;}
      else if(known||category!=='备注')continue;
      const key=norm(full)+'\n'+server;
      if(!groups.has(key))groups.set(key,{full,game,version,server,newGame:!known,links:[],notes:[]});
      const group=groups.get(key);
      if(url){missingLinks++;group.links.push({category,name:part(name)||category,url,note:part(note),elsewhere:[...owners.get(urlKey(url))||[]]});}
      else group.notes.push(part(name));
    }
    const list=[...groups.values()].map(g=>{
      const categories=[];
      for(const link of g.links){let c=categories.find(x=>x.category===link.category);if(!c)categories.push(c={category:link.category,links:[]});c.links.push(link);}
      categories.sort((a,b)=>(ORDER.indexOf(a.category)+1||99)-(ORDER.indexOf(b.category)+1||99));
      for(const c of categories)c.text=c.links.map(l=>line(l.name,l.url,l.note)).join('\n');
      // 新游戏的网址全在链接库同一个游戏下，多半是改了名称，而不是漏录。
      let renamed=[];
      if(g.newGame&&g.links.length)renamed=g.links.map(l=>l.elsewhere).reduce((a,b)=>a.filter(x=>b.includes(x)));
      return {...g,categories,noteText:g.notes.join('\n'),renamed};
    });
    const newGames=[],seen=new Set();
    for(const g of list)if(g.newGame&&!seen.has(g.full)){seen.add(g.full);newGames.push({full:g.full,game:g.game,version:g.version,renamed:g.renamed});}
    const publicURLs=new Set((data?.public||[]).map(l=>urlKey(l.url)));
    const publicLinks=(sheet.public||[]).filter(([,url])=>!publicURLs.has(urlKey(url))).map(([name,url])=>({name:part(name),url}));
    const tsv=[['完整名称','专服','类别','链接名称','URL','备注'].join('\t')];
    for(const g of list){
      for(const c of g.categories)for(const l of c.links)tsv.push([g.full,g.server,c.category,l.name,l.url,l.note].join('\t'));
      for(const note of g.notes)tsv.push([g.full,g.server,'游戏备注',note,'',''].join('\t'));
    }
    for(const l of publicLinks)tsv.push(['','','公共链接',l.name,l.url,''].join('\t'));
    const serverChanges=C?Object.entries(sheet.serverRoster||{}).flatMap(([full,source])=>{
      const library=serverScopes.get(norm(full));if(!library)return [];
      const names=source.filter(s=>!C.isShared(s)).flatMap(s=>C.splitServers(s)),keys=list=>new Set(list.map(C.serverKey)),a=keys(names),b=keys(library);
      return [...a].some(k=>!b.has(k))||[...b].some(k=>!a.has(k))?[{full,source:names,library}]:[];
    }):[];
    return {groups:list,newGames,serverChanges,public:publicLinks,tsv:tsv.length>1?tsv.join('\n'):'',warnings:sheet.warnings||[],
      counts:{sourceLinks,missingLinks,newGames:newGames.length,publicMissing:publicLinks.length}};
  }
  const api={source,extractSnapshot,read,urlKey,norm,part,line,ORDER,compare};
  root.WorkToolSourceCompare=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
