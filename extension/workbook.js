(function(root){
  'use strict';
  const SS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG='http://schemas.openxmlformats.org/package/2006/relationships';
  const CT='http://schemas.openxmlformats.org/package/2006/content-types';
  const enc=new TextEncoder(),dec=new TextDecoder();
  const E=root.WorkToolEntries,C=root.WorkToolCore;
  const nodes=(doc,name)=>Array.from(doc.getElementsByTagNameNS('*',name));
  function xml(bytes){
    const doc=new DOMParser().parseFromString(typeof bytes==='string'?bytes:dec.decode(bytes),'application/xml');
    if(nodes(doc,'parsererror').length)throw Error('工作簿 XML 格式错误');
    return doc;
  }
  const serialize=doc=>enc.encode(new XMLSerializer().serializeToString(doc));
  const path=target=>new URL(target,'https://workbook.local/xl/workbook.xml').pathname.slice(1);
  function open(bytes){
    if(bytes.byteLength>20*1024*1024)throw Error('链接表过大（上限20MB）');
    const files=root.fflate.unzipSync(new Uint8Array(bytes),{filter:entry=>{
      if(entry.originalSize>50*1024*1024)throw Error('工作簿解压大小超过限制');return true;
    }});
    if(!files['xl/workbook.xml']||!files['xl/_rels/workbook.xml.rels'])throw Error('请选择有效的 .xlsx 链接表');
    if(Object.keys(files).some(p=>p.startsWith('_xmlsignatures/')))throw Error('不支持修改带数字签名的工作簿，请使用普通 links.xlsx');
    const book=xml(files['xl/workbook.xml']),rels=xml(files['xl/_rels/workbook.xml.rels']);
    const shared=files['xl/sharedStrings.xml']?nodes(xml(files['xl/sharedStrings.xml']),'si').map(n=>nodes(n,'t').map(t=>t.textContent).join('')):[];
    const sheets=new Map();
    for(const sheet of nodes(book,'sheet')){
      const rel=nodes(rels,'Relationship').find(r=>r.getAttribute('Id')===sheet.getAttributeNS(R,'id'));
      if(!rel||rel.getAttribute('TargetMode')==='External')throw Error('工作表关系无效');
      const file=path(rel.getAttribute('Target'));if(!files[file])throw Error('找不到工作表内容');
      sheets.set(sheet.getAttribute('name'),{file,doc:xml(files[file])});
    }
    function rows(name){
      const sheet=sheets.get(name);if(!sheet)return [];
      return nodes(sheet.doc,'row').map(row=>{
        const values=[];
        for(const cell of nodes(row,'c')){
          const col=/^[A-Z]+/.exec(cell.getAttribute('r')||'')?.[0];if(!col)throw Error('工作表单元格地址无效');
          let index=0;for(const char of col)index=index*26+char.charCodeAt(0)-64;
          const type=cell.getAttribute('t'),v=nodes(cell,'v')[0]?.textContent || '';
          values[index-1]=type==='s'?(shared[Number(v)]||''):type==='inlineStr'?nodes(cell,'t').map(n=>n.textContent).join(''):v;
        }
        return values.map(v=>String(v??'').trim());
      });
    }
    function table(name,required=[]){
      const matrix=rows(name),header=matrix.shift()||[];
      if(required.some(key=>!header.includes(key)))throw Error('「'+name+'」工作表缺少字段：'+required.filter(k=>!header.includes(k)).join('、'));
      return matrix.filter(row=>row.some(Boolean)).map(row=>Object.fromEntries(header.map((h,i)=>[h,row[i]||''])));
    }
    if(!sheets.has('链接'))throw Error('缺少「链接」工作表，请选择规范的 links.xlsx');
    const links=table('链接',E.HEADERS),aliases=table('别名'),manual=table('手动新增',sheets.has('手动新增')?E.MANUAL:[]);
    if(!links.some(r=>r['游戏']&&/^https?:\/\//i.test(r['URL'])))throw Error('链接表没有有效链接记录');
    return {files,book,rels,sheets,rows,table,links,aliases,manual};
  }
  function payload(wb){
    const games=new Map();
    for(const r of wb.links){
      if(!r['游戏'])continue;
      if(!games.has(r['游戏']))games.set(r['游戏'],{name:r['游戏'],aliases:[r['游戏']],versions:Object.create(null)});
      const game=games.get(r['游戏']),full=r['完整名称']||r['游戏'];
      if(!game.versions[full])game.versions[full]={full,version:r['版本'],links:[],notes:[]};
      const v=game.versions[full];
      if(r['URL'])v.links.push({server:r['专服'],category:r['类别']||'其他',name:r['链接名称']||r['URL'],url:r['URL'],note:r['备注']});
      else if(r['链接名称'])v.notes.push([r['专服'],r['链接名称']]);
    }
    for(const r of wb.aliases){
      const g=games.get(r['游戏']);if(!g)continue;
      for(const word of [r['别名'],r['自定义别名']].filter(Boolean).join(',').split(/[,，、;；/\s]+/))if(word&&!g.aliases.includes(word))g.aliases.push(word);
    }
    const versionKeywords=Object.create(null),globalCount=new Map();
    for(const g of games.values()){
      const per=new Map(),aliases=new Set(g.aliases.map(C.normalize));
      for(const v of Object.values(g.versions)){
        const parts=v.version.trim().split(/\s+/).filter(Boolean),core=(parts[0]||'').replace(/^(首续)?\d+(\.\d+)?折?/,'');
        const words=new Set([v.full,v.version,core,core.replace(/版$/,''),...parts.slice(1)]);
        for(const word of words){const w=C.normalize(word);if(w.length<2||aliases.has(w))continue;if(!per.has(w))per.set(w,new Set());per.get(w).add(v.full);}
      }
      versionKeywords[g.name]=[];
      for(const [w,fulls]of per){globalCount.set(w,(globalCount.get(w)||0)+fulls.size);if(fulls.size===1)versionKeywords[g.name].push([w,[...fulls][0]]);}
    }
    const globalVersionKeywords=[];
    for(const [game,words]of Object.entries(versionKeywords))for(const [w,full]of words)if(globalCount.get(w)===1&&w.length>=3&&!/^bt\d+$/.test(w))globalVersionKeywords.push([w,game,full]);
    const gameBindings=Object.create(null);
    for(const r of wb.manual){
      const id=r['后台游戏ID'],game=r['游戏'],version=r['完整名称'];if(!id)continue;
      if(!games.get(game)?.versions[version])throw Error('手动新增记录的游戏或版本不存在');
      if(gameBindings[id]&&(gameBindings[id].game!==game||gameBindings[id].version!==version))throw Error('手动新增记录中同一个游戏ID绑定了不同版本');
      gameBindings[id]={game,version};
    }
    return {games:[...games.values()],versionKeywords,globalVersionKeywords,gameBindings};
  }
  function colName(index){let out='';for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;}
  function appendRow(sheet,values){
    const doc=sheet.doc,body=nodes(doc,'sheetData')[0];if(!body)throw Error('工作表缺少数据区域');
    const index=Math.max(0,...nodes(body,'row').map(r=>Number(r.getAttribute('r'))||0))+1;
    if(index>1048576)throw Error('工作表行数已达到上限');
    const row=doc.createElementNS(SS,'row');row.setAttribute('r',String(index));
    values.forEach((value,i)=>{const cell=doc.createElementNS(SS,'c');cell.setAttribute('r',colName(i)+index);cell.setAttribute('t','inlineStr');const is=doc.createElementNS(SS,'is'),t=doc.createElementNS(SS,'t');t.textContent=String(value??'');is.append(t);cell.append(is);row.append(cell);});
    body.append(row);
    let dim=nodes(doc,'dimension')[0];if(dim){const old=dim.getAttribute('ref')||'A1';const right=old.split(':').pop();const lastCol=right.replace(/\d+/g,'');const newCol=colName(Math.max(values.length-1,0));const col=lastCol.length>newCol.length||(lastCol.length===newCol.length&&lastCol>newCol)?lastCol:newCol;dim.setAttribute('ref','A1:'+col+index);}
    const filter=nodes(doc,'autoFilter')[0];if(filter)filter.setAttribute('ref',(filter.getAttribute('ref')||'A1:H1').replace(/\d+$/,String(index)));
    return index;
  }
  function addSheet(wb,name){
    let index=1;while(wb.files['xl/worksheets/sheet'+index+'.xml'])index++;
    const file='xl/worksheets/sheet'+index+'.xml',doc=xml('<worksheet xmlns="'+SS+'"><sheetData/></worksheet>');
    const ids=new Set(nodes(wb.rels,'Relationship').map(r=>r.getAttribute('Id')));let id='rIdWorkTool1';while(ids.has(id))id+='x';
    const rel=wb.rels.createElementNS(PKG,'Relationship');rel.setAttribute('Id',id);rel.setAttribute('Type',R+'/worksheet');rel.setAttribute('Target','worksheets/sheet'+index+'.xml');wb.rels.documentElement.append(rel);
    const sheet=wb.book.createElementNS(SS,'sheet');sheet.setAttribute('name',name);sheet.setAttribute('sheetId',String(Math.max(...nodes(wb.book,'sheet').map(s=>Number(s.getAttribute('sheetId'))))+1));sheet.setAttributeNS(R,'r:id',id);nodes(wb.book,'sheets')[0].append(sheet);
    const types=xml(wb.files['[Content_Types].xml']),override=types.createElementNS(CT,'Override');override.setAttribute('PartName','/'+file);override.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');types.documentElement.append(override);
    wb.files['[Content_Types].xml']=serialize(types);wb.files['xl/workbook.xml']=serialize(wb.book);wb.files['xl/_rels/workbook.xml.rels']=serialize(wb.rels);
    const result={file,doc};wb.sheets.set(name,result);return result;
  }
  function hyperlink(wb,sheet,cell,url){
    const relPath=sheet.file.replace(/\/([^/]+)$/, '/_rels/$1.rels');
    const rels=wb.files[relPath]?xml(wb.files[relPath]):xml('<Relationships xmlns="'+PKG+'"/>');
    const ids=new Set(nodes(rels,'Relationship').map(r=>r.getAttribute('Id')));let id='rIdWorkTool1';while(ids.has(id))id+='x';
    const rel=rels.createElementNS(PKG,'Relationship');for(const [k,v]of Object.entries({Id:id,Type:R+'/hyperlink',Target:url,TargetMode:'External'}))rel.setAttribute(k,v);rels.documentElement.append(rel);
    let list=nodes(sheet.doc,'hyperlinks')[0];if(!list){list=sheet.doc.createElementNS(SS,'hyperlinks');const following=Array.from(sheet.doc.documentElement.children).find(n=>['printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','drawing','legacyDrawing','tableParts','extLst'].includes(n.localName));sheet.doc.documentElement.insertBefore(list,following||null);}
    const link=sheet.doc.createElementNS(SS,'hyperlink');link.setAttribute('ref',cell);link.setAttributeNS(R,'r:id',id);list.append(link);wb.files[relPath]=serialize(rels);
  }
  function prepare(bytes,value){
    const entry=E.validate(value),wb=open(bytes),existing=wb.manual.find(r=>r['记录ID']===entry.id);
    if(existing){const old=E.validate(E.fromManual(existing));if(JSON.stringify(old)!==JSON.stringify(entry))throw Error('此请求编号已用于其他内容，请重新新增');return {bytes:new Uint8Array(bytes),data:payload(wb),duplicate:true,changed:false};}
    for(const row of wb.links)if(row['完整名称']===entry.full&&row['游戏']!==entry.game)throw Error('此完整名称已属于另一游戏，请检查所属信息');
    const binding=payload(wb).gameBindings[entry.gameId];if(binding&&(binding.game!==entry.game||binding.version!==entry.full))throw Error('当前游戏ID已绑定其他游戏或版本，请检查所属信息');
    const duplicate=wb.links.some(row=>E.sameLink(row,entry));
    if(!duplicate){const sheet=wb.sheets.get('链接'),header=wb.rows('链接')[0],values=Object.fromEntries(E.HEADERS.map((h,i)=>[h,E.linkRow(entry)[i]]));const index=appendRow(sheet,header.map(h=>values[h]||''));hyperlink(wb,sheet,colName(header.indexOf('URL'))+index,entry.url);wb.files[sheet.file]=serialize(sheet.doc);}
    let manual=wb.sheets.get('手动新增');if(!manual){manual=addSheet(wb,'手动新增');appendRow(manual,E.MANUAL);}
    const record=[entry.id,entry.gameId,...E.linkRow(entry),new Date().toISOString(),entry.label];const byName=Object.fromEntries(E.MANUAL.map((h,i)=>[h,record[i]]));
    appendRow(manual,wb.rows('手动新增')[0]?.map(h=>byName[h]||'') || record);wb.files[manual.file]=serialize(manual.doc);
    const output=root.fflate.zipSync(wb.files,{level:6});const checked=open(output),data=payload(checked);
    if(!checked.manual.some(r=>r['记录ID']===entry.id)||!checked.links.some(r=>E.sameLink(r,entry)))throw Error('生成工作簿后的校验失败，未写入原表格');
    return {bytes:output,data,duplicate,changed:true};
  }
  root.WorkToolWorkbook={open,payload,prepare};
})(globalThis);
