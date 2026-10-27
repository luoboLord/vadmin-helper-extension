(function(root){
  'use strict';
  const DEFAULT_URL='';
  const clean=v=>String(v??'').trim();
  const COMPACT_CATEGORIES=['后台','日志后台','礼包','冠名表','额外表','定制称号','转区转游','扶持','累充','道具ID','其他'];
  function expandCompact(rows,settings){
    const identities=new Map(settings.map(row=>[clean(row['完整名称']),row]));
    const out=[];
    for(const [index,row]of rows.entries()){
      if(!Object.values(row).some(Boolean))continue;
      const type=clean(row['记录类型'])||'游戏链接';
      if(!['游戏链接','公共链接'].includes(type))throw Error('精简表记录类型应为游戏链接或公共链接');
      const conf=identities.get(clean(row['完整名称']));
      const base={...row,'游戏':row['游戏']||conf?.['游戏']||'','版本':row['版本']||conf?.['版本']||''};
      if(type==='公共链接'){
        if(clean(row['完整名称'])||clean(row['专服'])||clean(row['游戏'])||clean(row['版本'])||clean(row['游戏备注']))throw Error('公共链接行请留空游戏、完整名称、专服和游戏备注');
      }
      let entries=0;
      for(const category of [...COMPACT_CATEGORIES,'游戏备注']){
        for(const line of clean(row[category]).split(/\r?\n/).map(clean).filter(Boolean)){
          const parts=line.split('|').map(clean);
          let name,url='',note='';
          if(category==='游戏备注'){
            name=parts.shift();note=parts.join(' | ');
          }else if(parts.length===1){
            name=category;url=parts[0];
          }else{
            name=parts.shift();url=parts.shift();note=parts.join(' | ');
          }
          if(!name)throw Error('精简表第'+(index+1)+'行的'+category+'缺少链接名称');
          if(category!=='游戏备注'){
            let parsed;try{parsed=new URL(url);}catch{throw Error(category+' 请每行填写“名称 | 完整网址”，也可只填网址');}
            if(!['http:','https:'].includes(parsed.protocol))throw Error(category+' 只支持 HTTP(S) 网址');
          }
          out.push({...base,'记录类型':category==='游戏备注'?'游戏备注':type,'类别':category==='游戏备注'?'备注':category,'链接名称':name,'URL':url,'备注':note});entries++;
        }
      }
      if(!entries)throw Error('精简表第'+(index+1)+'行没有链接或游戏备注，请补充内容或删除空记录');
    }
    return out;
  }
  const split=value=>clean(value).split(/[,，、;；/\s]+/).filter(Boolean);
  function source(value){
    if(!clean(value||DEFAULT_URL))throw Error('请先在数据管理配置飞书链接库地址');
    const u=new URL(value||DEFAULT_URL),m=/^\/(base|wiki)\/([A-Za-z0-9]+)\/?$/.exec(u.pathname);
    if(u.protocol!=='https:'||!u.hostname.endsWith('.feishu.cn')||u.username||u.password||u.port||!m)throw Error('请填写 HTTPS 飞书多维表格或知识库地址');
    return {url:u.origin+'/'+m[1]+'/'+m[2],origin:u.origin,kind:m[1],token:m[2]};
  }
  function wikiBaseToken(html,wikiToken=''){
    // 不使用可能来自旧SSR缓存的SERVER_DATA.meta；只读当前地址的显式注入标识。
    let matches=[...html.matchAll(/\bwindow\.__injected_wiki_base_token__\s*=\s*["']([A-Za-z0-9]+)["']/g)].map(m=>m[1]);
    // 2026-10起飞书不再注入该标识，改从当前知识库节点信息中成对的 wiki_token / obj_token 读取。
    if(!matches.length&&/^[A-Za-z0-9]+$/.test(wikiToken))matches=[...html.matchAll(new RegExp('["\']wiki_token["\']\\s*:\\s*["\']'+wikiToken+'["\']\\s*,\\s*["\']obj_token["\']\\s*:\\s*["\']([A-Za-z0-9]+)["\']','g'))].map(m=>m[1]);
    const tokens=[...new Set(matches)];
    if(tokens.length!==1)throw Error('无法确认知识库对应的多维表格，请使用其 /base/ 直达地址');
    return tokens[0];
  }
  async function unzip(b64){
    if(typeof b64!=='string')throw Error('飞书没有返回压缩表格数据');
    const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  function value(cell,asURL=false,links=false){
    const v=cell?.value;if(v==null)return '';
    if(typeof v==='string'||typeof v==='number')return clean(v);
    let before='';
    const segment=s=>{
      if(typeof s==='string')return s;
      if(s&&typeof s==='object'){
        // 链接栏目里 @ 的飞书文档只有标题是文字：已写“名称 |”时取文档网址，否则写成“标题 | 网址”。
        if(links&&s.type==='mention'&&typeof s.link==='string'&&/^https?:\/\//i.test(s.link)){
          if(/\|\s*$/.test(before.split(/\r?\n/).pop()))return s.link;
          return (clean(s.text)?clean(s.text)+' | ':'')+s.link;
        }
        const t=asURL?(s.link??s.text):(s.text??s.link);
        if(typeof t==='string')return t;
      }
      throw Error('飞书字段类型不支持，请将字段改成文本或超链接');
    };
    return clean(Array.isArray(v)?v.reduce((text,s)=>{before=text;return text+segment(s);},''):segment(v));
  }
  function cellValue(cell,field){
    if(![3,4].includes(field.type))return value(cell,field.name==='URL',COMPACT_CATEGORIES.includes(field.name));
    const raw=cell?.value;if(raw==null||raw==='')return '';
    const options=field.property?.options;
    if(!Array.isArray(options))throw Error('选项字段缺少定义：'+field.name);
    const names=new Map(options.map(o=>[o.id,o.name]));
    const items=Array.isArray(raw)?raw:[raw];
    if(field.type===3&&items.length!==1)throw Error('单选字段返回多值：'+field.name);
    return items.map(id=>{
      if(typeof id!=='string'||!names.has(id)||typeof names.get(id)!=='string')throw Error('选项值不在字段定义中：'+field.name);
      return names.get(id);
    }).join('\n');
  }
  // 按表格排序返回记录编号及解析后的行；records() 只要行。
  function recordList(table,required){
    const fields=Object.entries(table.fieldMap||{}),names=fields.map(([,f])=>f.name);
    if(new Set(names).size!==names.length)throw Error('表格存在重名字段');
    const missing=required.filter(name=>!names.includes(name));if(missing.length)throw Error('表格缺少字段：'+missing.join('、'));
    const ranks=table.rankInfo?.rankMap||{},ids=Object.keys(table.recordMap||{});
    if(!Number.isInteger(table.recordCount)||table.recordCount!==ids.length||table.recordCount>1000)throw Error('表格未完整读取或超过1000条，已保留旧数据；请勿继续使用不完整结果');
    ids.sort((a,b)=>{const x=ranks[a]??'',y=ranks[b]??'';return x<y?-1:x>y?1:0;});
    return {ids,rows:ids.map(id=>Object.fromEntries(fields.map(([key,f])=>[f.name,cellValue(table.recordMap[id][key],f)])))};
  }
  const records=(table,required)=>recordList(table,required).rows;
  // 字段结构摘要：字段编号、名称、类型及选项任一变化都视为目标改变。
  function schema(table){
    return JSON.stringify(Object.entries(table.fieldMap||{}).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,f])=>[id,f.name,f.type,(f.property?.options||[]).map(o=>[o.id,o.name])]));
  }
  function identity(row){
    const full=clean(row['完整名称']);if(!full)throw Error('游戏记录缺少完整名称');
    const m=/^(.*?)[（(](.*?)[）)]\s*(.*)$/.exec(full);
    const game=clean(row['游戏'])||(m?m[1].trim():full);
    const version=clean(row['版本'])||(m?[m[2].trim(),m[3].trim()].filter(Boolean).join(' '):'');
    return {game,version,full};
  }
  function payload(library,settings){
    const links=[],publicLinks=[],aliases=[],manual=[],pending=[];
    const configured=new Map();
    for(const row of settings){
      if(!Object.values(row).some(Boolean))continue;
      const id=identity(row),prior=configured.get(id.full);
      if(prior&&(prior.game!==id.game||prior.version!==id.version))throw Error('游戏配置中的同一完整名称归属冲突');
      configured.set(id.full,id);
      const auto=[id.game,...id.game.split(/[：:\-—]/).map(clean).filter(s=>s.length>=2)];
      aliases.push({'游戏':id.game,'别名':[...new Set([...auto,...split(row['游戏别名'])])].join(',')});
      for(const gid of split(row['后台游戏ID'])){
        if(!/^\d+$/.test(gid))throw Error('后台游戏ID必须为数字，多个ID用逗号分隔');
        manual.push({'后台游戏ID':gid,'游戏':id.game,'完整名称':id.full});
      }
    }
    const rows=library.map((row,i)=>{
      const order=clean(row['排序'])===''?Number.MAX_SAFE_INTEGER:Number(row['排序']);
      if(!Number.isFinite(order))throw Error('排序字段必须为数字');return {row,i,order};
    }).sort((a,b)=>a.order-b.order||a.i-b.i);
    const activeFulls=new Set();
    for(const {row}of rows){
      if(!Object.values(row).some(Boolean))continue;
      const status=clean(row['状态'])||'启用';
      if(!['启用','停用','待核对'].includes(status))throw Error('未知状态：'+status+'；请使用启用、停用或待核对');
      if(status!=='启用'){if(status==='待核对')pending.push(row['链接名称']);continue;}
      const type=clean(row['记录类型']),name=clean(row['链接名称']),target=clean(row['URL']);
      if(!name)throw Error('启用记录缺少链接名称');
      if(!['游戏链接','公共链接','游戏备注'].includes(type))throw Error('未知记录类型：'+type);
      if(type!=='游戏备注'){
        let u;try{u=new URL(target);}catch{throw Error(name+' 的 URL 无效');}
        if(!['http:','https:'].includes(u.protocol))throw Error(name+' 需要完整 HTTP(S) 地址');
      }else if(target)throw Error(name+' 为游戏备注，应清空 URL 或改成游戏链接');
      if(type==='公共链接'){
        if(row['完整名称']||row['游戏']||row['专服'])throw Error('公共链接不应填写游戏或专服');
        publicLinks.push({name,url:target});continue;
      }
      const id=identity(row),conf=configured.get(id.full);
      if(conf&&(conf.game!==id.game||conf.version!==id.version))throw Error('链接与游戏配置的归属不一致：'+id.full);
      activeFulls.add(id.full);
      links.push({'游戏':id.game,'版本':id.version,'完整名称':id.full,'专服':clean(row['专服']),'类别':clean(row['类别'])||'其他','链接名称':name,'URL':target,'备注':clean(row['备注'])});
      if(!conf)aliases.push({'游戏':id.game,'别名':[id.game,...id.game.split(/[：:\-—]/).filter(s=>s.length>=2)].join(',')});
    }
    if(!links.some(r=>r['URL']))throw Error('链接库没有启用的游戏链接，已保留旧数据');
    const data=root.WorkToolWorkbook.payload({links,aliases,manual:manual.filter(r=>activeFulls.has(r['完整名称']))});
    return {data:{...data,categories:root.WorkToolData?.categories||[],public:publicLinks},counts:{records:library.length,links:links.filter(r=>r['URL']).length,public:publicLinks.length,games:data.games.length,pending:pending.length}};
  }
  // 读取一张数据表的最新快照；写入流程用它取版本、排序和按记录编号核实。
  async function readTable(src,tableId='',needBase=false,fetcher=fetch){
    const u=new URL(src.origin+'/space/api/v1/bitable/'+src.token+'/clientvars');
    u.searchParams.set('recordLimit','1000');u.searchParams.set('needBase',String(needBase));if(tableId)u.searchParams.set('tableID',tableId);
    const response=await fetcher(u.href,{credentials:'include',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(response.type==='opaqueredirect'||[301,302,401].includes(response.status))throw Error('请先在当前浏览器登录飞书，再刷新数据');
    if(!response.ok)throw Error('飞书读取失败（HTTP '+response.status+'），请检查登录和表格访问权限');
    let json;try{json=JSON.parse(await response.text());}catch{throw Error('请先在当前浏览器登录飞书，再刷新数据');}
    if(json.code!==0||!json.data?.table)throw Error('飞书拒绝读取，请检查登录、表格地址和访问权限');
    return {table:await unzip(json.data.table),base:json.data.base?await unzip(json.data.base):null};
  }
  const LIBRARY_FIELDS=['链接名称','记录类型','完整名称','专服','类别','URL','状态','排序'];
  const COMPACT_FIELDS=['完整名称','专服','记录类型','状态','排序',...COMPACT_CATEGORIES,'游戏备注'];
  const CONFIG_FIELDS=['完整名称','游戏','版本','游戏别名','后台游戏ID'];
  // requireCompact：写入只支持精简表，且三张表都必须本次完整读取，不退回缓存。
  async function readTables(config,{requireCompact=false}={},fetcher=fetch){
    if(!clean(config?.url))throw Error('请先在数据管理配置飞书链接库地址');
    let src=source(config?.url);
    if(src.kind==='wiki'){
      const response=await fetcher(src.url,{credentials:'include',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
      if(!response.ok||response.type==='opaqueredirect')throw Error('知识库解析失败，请先登录飞书并确认访问权限');
      src=source(src.origin+'/base/'+wikiBaseToken(await response.text(),src.token));
    }
    const first=await readTable(src,'',true,fetcher);
    const tables=Object.entries(first.base?.blockInfos||{}).map(([key,b])=>({id:b.id||key,name:b.name})).filter(t=>t.id.startsWith('tbl'));
    const find=name=>{const matches=tables.filter(t=>t.name===name);if(matches.length!==1)throw Error('请先导入并保留唯一的“'+name+'”数据表');return matches[0].id;};
    const compact=tables.filter(t=>t.name==='链接库_精简');
    if(compact.length>1)throw Error('请保留唯一的“链接库_精简”数据表');
    if(requireCompact&&!compact.length)throw Error('自动写入只支持“链接库_精简”数据表，请先迁移到精简表');
    const libId=compact.length?compact[0].id:find('链接库'),settingsId=find('游戏配置');
    const library=await readTable(src,libId,false,fetcher),settings=await readTable(src,settingsId,false,fetcher);
    const configList=recordList(settings.table,CONFIG_FIELDS);
    const isCompact=compact.length>0;
    const libraryList=recordList(library.table,isCompact?COMPACT_FIELDS:LIBRARY_FIELDS);
    const result=payload(isCompact?expandCompact(libraryList.rows,configList.rows):libraryList.rows,configList.rows);
    if(isCompact)result.counts.records=libraryList.rows.length;
    const describe=(id,name,table,list)=>({id,name,table,ids:list.ids,rows:list.rows,schema:schema(table)});
    return {result,source:src.url,origin:src.origin,base:src.token,compact:isCompact,editorURL:src.url+'?table='+encodeURIComponent(libId),
      library:describe(libId,isCompact?'链接库_精简':'链接库',library.table,libraryList),settings:describe(settingsId,'游戏配置',settings.table,configList)};
  }
  async function read(config,fetcher=fetch){
    const r=await readTables(config,{},fetcher);
    return {...r.result,source:r.source,editorURL:r.editorURL};
  }
  const api={DEFAULT_URL,COMPACT_CATEGORIES,COMPACT_FIELDS,CONFIG_FIELDS,expandCompact,source,wikiBaseToken,value,cellValue,recordList,records,schema,identity,payload,readTable,readTables,read};root.WorkToolFeishu=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
