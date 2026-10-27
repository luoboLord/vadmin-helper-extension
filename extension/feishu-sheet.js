(function(root){
  'use strict';
  const utf8=new TextDecoder('utf-8',{fatal:true});
  const clean=v=>String(v??'').trim();
  const lines=v=>clean(v).split(/\r\n|\r|\n/).map(clean).filter(Boolean);
  const norm=v=>clean(v).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
  function varint(buf,cursor){
    let value=0n;
    for(let shift=0n;shift<70n;shift+=7n){
      if(cursor.p>=buf.length)throw Error('protobuf varint 截断');
      const b=buf[cursor.p++];if(shift===63n&&b>1)throw Error('protobuf uint64 溢出');
      value|=BigInt(b&127)<<shift;
      if(b<128){if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('protobuf 整数超出精确范围');return Number(value);}
    }
    throw Error('protobuf varint 过长');
  }
  function wire(buf){
    const fields=[],c={p:0};
    while(c.p<buf.length){
      const key=varint(buf,c),f=Math.floor(key/8),w=key%8;
      if(f<1||f>=2**29)throw Error('protobuf 字段号无效');
      let v;
      if(w===0)v=varint(buf,c);
      else if([1,2,5].includes(w)){
        const size=w===2?varint(buf,c):w===1?8:4;
        if(size>buf.length-c.p)throw Error('protobuf 字段截断');
        v=buf.subarray(c.p,c.p+size);c.p+=size;
      }else throw Error('不支持的 protobuf wire '+w);
      fields.push({f,w,v});
    }
    return fields;
  }
  const all=(fields,f)=>fields.filter(x=>x.f===f).map(x=>x.v);
  function one(fields,f,fallback){
    const vs=all(fields,f);if(vs.length>1)throw Error('protobuf 重复单值字段 '+f);
    if(!vs.length){if(fallback!==undefined)return fallback;throw Error('protobuf 缺少字段 '+f);}
    return vs[0];
  }
  function at(array,index,what){if(!Number.isInteger(index)||index<0||index>=array.length)throw Error(what+'下标越界');return array[index];}
  function packed(buf){const c={p:0},out=[];while(c.p<buf.length)out.push(varint(buf,c));return out;}
  async function gunzip(encoded){
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  function url(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw Error('来源包含非 HTTP(S) 链接');return value;}
  function parseBlock(bytes){
    const l12=wire(one(wire(one(wire(one(wire(bytes),1)),2)),12));
    const region=wire(one(l12,1));
    const bounds={rowStart:one(region,1,0),colStart:one(region,2,0),rowEnd:one(region,3),colEnd:one(region,4)};
    const sheetId=utf8.decode(one(region,5));
    const strings=wire(one(l12,2)),plain=all(strings,2).map(b=>utf8.decode(b)),rich=all(strings,3);
    const resources=wire(one(l12,3)),hyperlinks=all(resources,5),mentionRefs=all(resources,3),mentions=all(resources,4),attachments=all(resources,6);
    const grid=wire(one(l12,6)),indices=all(grid,1).flatMap(packed),descriptors=all(grid,2);
    const rows=bounds.rowEnd-bounds.rowStart,cols=bounds.colEnd-bounds.colStart;
    if(rows<=0||cols<=0||indices.length!==rows*cols)throw Error('来源格子数量与范围不符');
    const warnings=[],cells=[];
    const decoded=descriptors.map(b=>{
      const d=wire(b),kind=one(d,1,0);
      if(kind===0)return {text:'',links:[]};
      const index=one(d,2);
      if(kind===7){warnings.push('图片单元格未作为链接解析');return {text:'',links:[],image:true};}
      if(kind===3)return {text:at(plain,index,'文字池'),links:[]};
      if(kind!==6)throw Error('未知单元格类型 '+kind);
      const item=wire(at(rich,index,'富文本池')),text=at(plain,one(item,1),'富文本原文');
      const links=[];let start=0,attachment=false;
      for(const b of all(item,2)){
        const segment=wire(b),type=one(segment,1),end=one(segment,2);
        if(end<=start||end>text.length)throw Error('富文本片段范围无效');
        let target;
        if(type===4)target=utf8.decode(one(wire(at(hyperlinks,one(segment,4),'链接表')),1));
        else if(type===2){
          const ref=wire(at(mentionRefs,one(segment,4),'文档引用表'));
          const mention=wire(at(mentions,one(ref,2),'文档表'));
          if(one(mention,1)!==2)throw Error('未知文档引用类型');
          target=utf8.decode(one(wire(one(mention,3)),2));
        }else if(type===3){at(attachments,one(segment,4),'附件表');attachment=true;warnings.push('附件保留名称作为备注');}
        else if(type!==1)throw Error('未知富文本片段类型 '+type);
        if(target){
          url(target);
          const previous=links[links.length-1];
          if(previous?.url===target&&previous.end===start){previous.end=end;previous.name=text.slice(previous.start,end);}
          else links.push({start,end,name:text.slice(start,end),url:target});
        }
        start=end;
      }
      if(start!==text.length)throw Error('富文本片段没有覆盖完整文字');
      return {text,links,...(attachment?{attachment:true}:{})};
    });
    for(let n=0;n<indices.length;n++){
      const cell=at(decoded,indices[n],'格子描述');
      if(cell.text||cell.image)cells.push({row:bounds.rowStart+Math.floor(n/cols),col:bounds.colStart+n%cols,...cell});
    }
    return {sheetId,bounds,cells,warnings};
  }
  function parseMerges(bytes,sheetId){
    const merges=[];let found=false;
    for(const b of all(wire(bytes),1)){
      const envelope=wire(b);
      if(utf8.decode(one(envelope,3))!==sheetId)continue;
      found=true;
      for(const op of all(envelope,2)){
        const fields=wire(op);
        if(one(fields,1)!==10)continue;
        for(const m of all(fields,10))for(const b of all(wire(m),2)){
          const f=wire(b);
          merges.push({rowStart:one(f,1,0),colStart:one(f,2,0),rowEnd:one(f,3),colEnd:one(f,4)});
        }
      }
    }
    if(!found)throw Error('缺少目标工作表资源');
    return merges;
  }
  async function sheetIds(snapshot){
    if(!snapshot?.gzipBlockMeta)throw Error('原表快照不完整');
    const meta=JSON.parse(utf8.decode(await gunzip(snapshot.gzipBlockMeta)));
    return Object.keys(meta).filter(id=>meta[id]?.cellBlockMetas?.length);
  }
  // gzipTopSnapshot 的 1→2(1:3)→3→1 是工作表属性 {1:id,2:序号,3:名称}；结构对不上的条目跳过。
  async function sheetNames(snapshot){
    if(!snapshot?.gzipTopSnapshot)return [];
    const out=[];
    for(const entry of all(wire(await gunzip(snapshot.gzipTopSnapshot)),1)){
      try{
        const op=wire(one(wire(entry),2));if(one(op,1)!==3)continue;
        const props=wire(one(wire(one(op,3)),1));
        out.push({id:utf8.decode(one(props,1)),index:one(props,2,0),name:utf8.decode(one(props,3))});
      }catch{}
    }
    return out;
  }
  async function decodeSnapshot(snapshot,sheetId){
    if(!sheetId)throw Error('缺少工作表ID');
    if(!snapshot?.gzipResource||!snapshot.gzipBlockMeta||!snapshot.blocks)throw Error('原表快照不完整');
    const meta=JSON.parse(utf8.decode(await gunzip(snapshot.gzipBlockMeta)));
    const blocks=meta[sheetId]?.cellBlockMetas;
    if(!blocks?.length)throw Error('原表没有目标工作表数据');
    const merged={sheetId,cells:[],merges:parseMerges(await gunzip(snapshot.gzipResource),sheetId),warnings:[],bounds:{rowStart:0,colStart:0,rowEnd:0,colEnd:0}};
    const occupied=new Set();
    for(const block of blocks){
      if(!snapshot.blocks[block.blockId])throw Error('原表快照缺少数据块，拒绝使用不完整结果');
      const bytes=await gunzip(snapshot.blocks[block.blockId]);
      if(bytes.length!==block.size)throw Error('原表数据块大小不符');
      const parsed=parseBlock(bytes);
      if(parsed.sheetId!==sheetId||Object.keys(parsed.bounds).some(k=>parsed.bounds[k]!==block.range[k]))throw Error('原表数据块范围不符');
      for(const cell of parsed.cells){const key=cell.row+','+cell.col;if(occupied.has(key))throw Error('原表数据块重叠');occupied.add(key);merged.cells.push(cell);}
      merged.bounds.rowEnd=Math.max(merged.bounds.rowEnd,parsed.bounds.rowEnd);merged.bounds.colEnd=Math.max(merged.bounds.colEnd,parsed.bounds.colEnd);
      merged.warnings.push(...parsed.warnings);
    }
    merged.warnings=[...new Set(merged.warnings)];
    merged.complete=true; // 已验证目标工作表元数据列出的全部数据块。
    return merged;
  }
  const categories=['后台','日志后台','礼包','冠名表','额外表','定制称号','转区转游','扶持','累充','道具ID','其他'];
  function categorize(col,text){
    const fixed={2:'后台',3:'额外表',4:'冠名表',5:'礼包'};
    if(fixed[col])return fixed[col];
    if(/\d{1,2}\.\d{1,2}-\d{1,2}\.\d{1,2}/.test(text))return '礼包';
    for(const [word,category]of [['日志后台','日志后台'],['道具ID','道具ID'],['扶持','扶持'],['转区','转区转游'],['转游','转区转游'],['继承','转区转游'],['称号','定制称号'],['定制','定制称号'],['头衔','定制称号'],['累充','累充'],['礼包','礼包'],['方案','礼包'],['冠名','冠名表']])if(text.includes(word))return category;
    return '其他';
  }
  function splitGame(full){const m=/^(.*?)[（(](.*?)[）)]\s*(.*)$/.exec(full);return m?[m[1].trim(),[m[2].trim(),m[3].trim()].filter(Boolean).join(' ')]:[full,''];}
  function toRows(sheet){
    const cells=new Map(sheet.cells.map(c=>[c.row+','+c.col,c])),merges=new Map(),rows=[],origins=[],publicLinks=[],channels=[],serverRoster=Object.create(null),gameIssues=Object.create(null);
    const get=(r,c)=>cells.get(r+','+c)||{text:'',links:[]};
    for(const range of sheet.merges){
      const {rowStart:r1,rowEnd:r2,colStart:c1,colEnd:c2}=range;
      if(r1<0||c1<0||r2<=r1||c2<=c1||r2>sheet.bounds.rowEnd||c2>sheet.bounds.colEnd)throw Error('合并范围越界');
      for(let r=r1;r<r2;r++)for(let c=c1;c<c2;c++){
        const key=r+','+c;if(merges.has(key))throw Error('合并范围重叠');merges.set(key,range);
      }
    }
    let lastRow=1;
    for(const cell of sheet.cells)if(cell.col<2&&clean(cell.text))lastRow=Math.max(lastRow,cell.row);
    for(let c=0;c<sheet.bounds.colEnd;c++){
      const cell=get(0,c),text=clean(cell.text);
      if(!text)continue;
      if(cell.links.length)for(const link of cell.links)publicLinks.push([clean(link.name)||text,link.url]);
      else if(text.includes('-')){const at=text.indexOf('-');channels.push([text.slice(0,at).trim(),text.slice(at+1).trim()]);}
    }
    function add(row,r,c){rows.push(row);origins.push({row:r+1,col:c+1});}
    for(let start=2;start<=lastRow;){
      const nameLines=lines(get(start,0).text);
      if(!nameLines.length){start++;continue;}
      const full=nameLines[0],[game,version]=splitGame(full),aNote=nameLines.slice(1).join(' '),end=merges.get(start+',0')?.rowEnd??start+1;
      // 名单包括没有链接的专服，不能仅从成功解析出的链接推断整款游戏的专服范围。
      if(!serverRoster[full])serverRoster[full]=[];
      // 图片/附件只阻止所属游戏的自动改名，不能让其他游戏的完整数据失效。
      const issues=sheet.cells.filter(c=>c.row>=start&&c.row<end&&(c.image||c.attachment));
      if(issues.length)gameIssues[full]=[...new Set([...(gameIssues[full]||[]),...issues.map(c=>c.image?'本游戏含图片单元格，无法完整核对内容':'本游戏含附件，需人工核对内容')])];
      for(let r=start;r<end;r++)for(const s of lines(get(merges.get(r+',1')?.rowStart??r,1).text))if(!serverRoster[full].includes(s))serverRoster[full].push(s);
      if(aNote)add([game,version,full,'','备注',aNote,'',''],start,0);
      // 跨多个游戏合并的格子（如同一后台覆盖几个版本）按游戏分别计入，专服只取本游戏范围内的行。
      const seen=new Set();
      for(let r=start;r<end;r++)for(let c=2;c<sheet.bounds.colEnd;c++){
        const merged=merges.get(r+','+c),top=merged?.rowStart??r;if(seen.has(top+','+c))continue;seen.add(top+','+c);
        const cell=get(top,c),textLines=lines(cell.text);
        if(!textLines.length&&!cell.links.length)continue;
        const r1=Math.max(top,start),r2=Math.min(merged?.rowEnd??top+1,end),servers=[];
        for(let sr=r1;sr<r2;sr++)for(const server of lines(get(merges.get(sr+',1')?.rowStart??sr,1).text))if(!servers.includes(server))servers.push(server);
        const server=servers.join('/');
        if(!cell.links.length){add([game,version,full,server,'备注',textLines.join(' '),'',''],top,c);continue;}
        const entries=cell.links.map(link=>({name:lines(link.name)[0]||'',url:clean(link.url)})),names=new Set(entries.slice(1).map(e=>e.name));
        const note=textLines.slice(1).filter(line=>!names.has(line)).join(' / ');
        entries.forEach((entry,index)=>{
          let category=index===0?categorize(c,entry.name):categorize(-1,entry.name);
          if(category==='其他'&&index>0)category=categorize(c,entry.name);
          let name=entry.name||category;if(c===2&&name==='后台地址')name='后台';
          add([game,version,full,server,category,name,entry.url,note],top,c);
        });
      }
      start=end;
    }
    if(!rows.some(r=>r[6]))throw Error('原表解析没有可用链接');
    const rosterUnreadable=sheet.cells.some(c=>c.row>=2&&c.col<2&&(c.image||c.attachment));
    return {rows,origins,public:publicLinks,channels,warnings:sheet.warnings,serverRoster,gameIssues,complete:sheet.complete===true&&!rosterUnreadable};
  }
  const api={wire,packed,parseBlock,parseMerges,sheetIds,sheetNames,decodeSnapshot,toRows,categorize,splitGame,lines,norm,categories};
  root.WorkToolFeishuSheet=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
